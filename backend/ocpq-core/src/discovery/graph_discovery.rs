use core::f64;
use itertools::Itertools;
use process_mining::core::event_data::object_centric::linked_ocel::{
    slim_linked_ocel::{EventOrObjectIndex, ObjectIndex},
    LinkedOCELAccess, SlimLinkedOCEL,
};
use rand::{rngs::StdRng, seq::IteratorRandom, SeedableRng};
use std::{
    borrow::Borrow,
    collections::{HashMap, HashSet},
};

use crate::{
    binding_box::{
        structs::{
            BindingBoxTreeNode, Constraint, EventVariable, Filter, ObjectVariable, SizeFilter,
            Variable,
        },
        Binding, BindingBox, BindingBoxTree,
    },
    discovery::{
        advanced::{binding_to_instances, generate_sample_bindings, label_bindings},
        RNG_SEED, SAMPLE_FRAC, SAMPLE_MIN_NUM_INSTANCES,
    },
    preprocessing::linked_ocel::{event_or_object_from_index, OCELNode},
};

use super::advanced::EventOrObjectType;

#[derive(PartialEq, Eq, Debug, Clone, Copy, Hash)]
pub enum RefType {
    Object,
    ObjectReversed,
    Event,
    EventReversed,
}

pub fn get_instances(
    ocel: &SlimLinkedOCEL,
    ocel_type: &EventOrObjectType,
) -> Vec<EventOrObjectIndex> {
    let mut rng = StdRng::seed_from_u64(RNG_SEED);
    let instances: Option<Vec<_>> = match &ocel_type {
        EventOrObjectType::Event(et) => {
            let o_indices: Vec<_> = ocel.get_evs_of_type(et).collect();
            let instances = if o_indices.len() >= SAMPLE_MIN_NUM_INSTANCES {
                let sample_count = (o_indices.len() as f32 * SAMPLE_FRAC).ceil() as usize;
                o_indices.iter().choose_multiple(&mut rng, sample_count)
            } else {
                o_indices.iter().collect()
            };
            Some(
                instances
                    .into_iter()
                    .map(|i| EventOrObjectIndex::Event(**i))
                    .collect(),
            )
        }
        EventOrObjectType::Object(ot) => {
            let o_indices: Vec<_> = ocel.get_obs_of_type(ot).collect();
            let instances = if o_indices.len() >= SAMPLE_MIN_NUM_INSTANCES {
                let sample_count = (o_indices.len() as f32 * SAMPLE_FRAC).ceil() as usize;
                o_indices.iter().choose_multiple(&mut rng, sample_count)
            } else {
                o_indices.iter().collect()
            };
            Some(
                instances
                    .into_iter()
                    .map(|i| EventOrObjectIndex::Object(**i))
                    .collect(),
            )
        }
    };
    instances.unwrap_or_default()
}

pub struct SymmetricRel {
    pub index: EventOrObjectIndex,
    pub reversed: bool,
    pub qualifier: String,
}
pub fn get_symmetric_rels(index: &EventOrObjectIndex, locel: &SlimLinkedOCEL) -> Vec<SymmetricRel> {
    match index {
        EventOrObjectIndex::Event(event_index) => locel
            .get_e2o(event_index)
            .map(|(q, o)| SymmetricRel {
                index: (*o).into(),
                reversed: false,
                qualifier: q.to_string(),
            })
            .collect(),
        EventOrObjectIndex::Object(object_index) => locel
            .get_o2o(object_index)
            .map(|(q, o)| SymmetricRel {
                index: (*o).into(),
                reversed: false,
                qualifier: q.to_string(),
            })
            .chain(locel.get_e2o_rev(object_index).map(|(q, e)| SymmetricRel {
                index: (*e).into(),
                reversed: true,
                qualifier: q.to_string(),
            }))
            .chain(locel.get_o2o_rev(object_index).map(|(q, o)| SymmetricRel {
                index: (*o).into(),
                reversed: true,
                qualifier: q.to_string(),
            }))
            .collect(),
    }
}
pub fn discover_count_constraints(
    ocel: &SlimLinkedOCEL,
    coverage: f32,
    ocel_type: EventOrObjectType,
) -> Vec<CountConstraint> {
    let mut ret = Vec::new();
    let instances: Vec<_> = get_instances(ocel, &ocel_type);
    ret.extend(discover_count_constraints_for_supporting_instances(
        ocel,
        coverage,
        instances.into_iter(),
        &ocel_type,
    ));
    ret
}

pub fn discover_count_constraints_for_supporting_instances<
    It: Borrow<EventOrObjectIndex>,
    I: Iterator<Item = It>,
>(
    ocel: &SlimLinkedOCEL,
    coverage: f32,
    supporting_instances: I,
    supporting_instance_type: &EventOrObjectType,
) -> Vec<CountConstraint> {
    let mut ret = Vec::new();
    let mut total_map: HashMap<_, Vec<usize>> = HashMap::new();
    for o_index in supporting_instances {
        let mut map: HashMap<_, usize> = ocel
            .get_ev_types()
            .map(|et| ((RefType::Event, et.to_string()), 0))
            .chain(ocel.get_ob_types().flat_map(|ot| {
                vec![
                    ((RefType::Object, ot.to_string()), 0),
                    ((RefType::ObjectReversed, ot.to_string()), 0),
                ]
            }))
            .collect();
        let rels = get_symmetric_rels(o_index.borrow(), ocel);
        for SymmetricRel {
            index, reversed, ..
        } in rels
        {
            let (ref_type, ocel_type) = match event_or_object_from_index(index, ocel) {
                OCELNode::Event(e) => (
                    if reversed {
                        RefType::EventReversed
                    } else {
                        RefType::Event
                    },
                    e.event_type.clone(),
                ),
                OCELNode::Object(o) => (
                    if reversed {
                        RefType::ObjectReversed
                    } else {
                        RefType::Object
                    },
                    o.object_type.clone(),
                ),
            };
            *map.entry((ref_type, ocel_type)).or_default() += 1;
        }
        for (k, val) in map {
            total_map.entry(k).or_default().push(val);
        }
    }
    // println!("\n=== {} ===", ot);
    total_map
        .iter()
        .for_each(|((ref_type, ocel_type), counts)| {
            let n = counts.len() as f32;
            let mean = counts.iter().sum::<usize>() as f32 / n;
            let min = counts.iter().min().unwrap_or(&0);
            let max = counts.iter().max().unwrap_or(&usize::MAX);

            if mean > 0.0 && mean <= 30.0 {
                // Otherwise, not interesting (i.e., no values > 0)
                let std_deviation = (counts
                    .iter()
                    .map(|c| {
                        let diff = mean - *c as f32;
                        diff * diff
                    })
                    .sum::<f32>()
                    / n)
                    .sqrt();
                // TODO: Decide if > 0?
                if std_deviation >= 0.0 {
                    // if mean > 2.0 {
                    //     plot_histogram(
                    //         counts,
                    //         format!("{supporting_instance_type:?} {ref_type:?} {ocel_type:?} MEAN: {mean}"),
                    //         format!("{supporting_instance_type:?} {ref_type:?} {ocel_type:?}.svg"),
                    //     );
                    // }
                    // Otherwise, not interesting (no deviation between values)
                    for (c_min, c_max) in
                        get_range_with_coverage(counts, coverage, mean, std_deviation)
                    {
                        // println!("Counts {} Mean {} stdDev {} for min {} max {} FOR {ref_type:?} {ocel_type}",counts.len(),mean, std_deviation,min,max);
                        ret.push(CountConstraint {
                            min_count: if c_min > 0 && c_min < *min {
                                None
                            } else {
                                Some(c_min)
                            },
                            max_count: if c_max > *max { None } else { Some(c_max) },
                            root_type: supporting_instance_type.clone(),
                            related_type: match &ref_type {
                                RefType::Object | RefType::ObjectReversed => {
                                    EventOrObjectType::Object(ocel_type.clone())
                                }
                                RefType::Event | RefType::EventReversed => {
                                    EventOrObjectType::Event(ocel_type.clone())
                                }
                            },
                            ocel_relation_flipped: matches!(
                                ref_type,
                                RefType::ObjectReversed | RefType::EventReversed
                            ),
                        });
                    }
                }
            }
        });
    ret
}

fn get_range_with_coverage(
    values: &[usize],
    coverage: f32,
    mean: f32,
    std_deviation: f32,
) -> HashSet<(usize, usize)> {
    let mean_usize = mean.floor() as usize;
    let step_size = (0.01 * std_deviation).round().max(1.0) as usize;
    let mut ret: HashSet<_> = vec![
        get_range_with_coverage_inner(
            values,
            coverage,
            mean_usize,
            step_size,
            Direction::Symmetric,
        ),
        get_range_with_coverage_inner(values, coverage, 0, step_size, Direction::Increase),
        get_range_with_coverage_inner(
            values,
            coverage,
            10 + 10 * mean_usize,
            step_size,
            Direction::Decrease,
        ),
    ]
    .into_iter()
    .flatten()
    .collect();
    let mut remove_from_ret = HashSet::new();
    for (min, max) in &ret {
        if ret
            .iter()
            .any(|(min2, max2)| min2 >= min && max2 <= max && (min, max) != (min2, max2))
        {
            remove_from_ret.insert((*min, *max));
        }
    }
    for k in remove_from_ret {
        ret.remove(&k);
    }
    ret
}

#[derive(PartialEq)]
enum Direction {
    Decrease,
    Increase,
    Symmetric,
}

fn get_range_with_coverage_inner(
    values: &[usize],
    coverage: f32,
    start: usize,
    step_size: usize,
    direction: Direction,
) -> Vec<(usize, usize)> {
    let mut min = start;
    let mut max = start;
    let mut steps = 0;
    let coverage_min_count = (values.len() as f32 * coverage).ceil() as usize;
    while steps < 1000
        && values.iter().filter(|v| **v >= min && **v <= max).count() < coverage_min_count
    {
        // Watch out for overflows!
        if direction != Direction::Increase {
            if min >= step_size {
                min -= step_size;
            } else {
                min = 0;
            }
        }

        if direction != Direction::Decrease {
            max += step_size;
        }
        steps += 1;
    }
    if steps >= 1000 {
        println!("[Warning!] Could not find coverage range after 1000 steps.");
        return Vec::default();
    }
    vec![(min, max)]
}

fn get_seconds_range_with_coverage(
    values: &[Option<f64>],
    coverage: f32,
    start: f64,
    step_size: f64,
    direction: Direction,
) -> Option<(f64, f64)> {
    let mut min = start;
    let mut max = start;
    let mut steps = 0;
    let coverage_min_count = (values.len() as f32 * coverage).ceil() as usize;
    while steps < 1000
        && values
            .iter()
            .filter(|v| v.is_some_and(|v| v >= min && v <= max))
            .count()
            < coverage_min_count
    {
        // Watch out for overflows!
        if direction != Direction::Increase {
            if min >= step_size {
                min -= step_size;
            } else {
                min = 0.0;
            }
        }

        if direction != Direction::Decrease {
            max += step_size;
        }
        steps += 1;
    }
    if steps >= 1000 {
        println!("[Warning!] Could not find coverage range after 1000 steps.");
        return None;
    }
    Some((min, max))
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CountConstraint {
    pub min_count: Option<usize>,
    pub max_count: Option<usize>,
    pub root_type: EventOrObjectType,
    // This is the types of items we constraint in their count!
    pub related_type: EventOrObjectType,
    pub ocel_relation_flipped: bool,
}

impl CountConstraint {
    pub fn get_constraint_name(&self) -> String {
        let range = match (self.min_count, self.max_count) {
            (None, None) => "any number of".to_string(),
            (_, Some(0)) => "=0".to_string(),
            (None, Some(max)) => format!("≤{max}"),
            (Some(0), Some(max)) => format!("≤{max}"),
            (Some(min), Some(max)) if min == max => format!("={min}"),
            (Some(min), None) => format!("≥{min}"),
            (Some(min), Some(max)) => format!("{min}-{max}"),
        };
        format!(
            "{range} '{}' per '{}'",
            self.related_type.inner(),
            self.root_type.inner()
        )
    }
    pub fn get_full_tree(&self) -> BindingBoxTree {
        // let child_name = "A".to_string();
        let inner_child_name = "A".to_string();
        let inner_variable = 0;
        let mut subtree = self.to_subtree(inner_child_name.clone(), inner_variable, 1);
        match &mut subtree.nodes[0] {
            BindingBoxTreeNode::Box(bbox, _) => {
                match &self.root_type {
                    EventOrObjectType::Event(et) => bbox.new_event_vars.insert(
                        EventVariable(inner_variable),
                        vec![et.clone()].into_iter().collect(),
                    ),
                    EventOrObjectType::Object(ot) => bbox.new_object_vars.insert(
                        ObjectVariable(inner_variable),
                        vec![ot.clone()].into_iter().collect(),
                    ),
                };
            }
            _ => todo!("Expected a BindingBox"),
        }
        subtree
    }
    pub fn to_subtree(
        &self,
        child_name: String,
        inner_variable: usize,
        new_variable: usize,
    ) -> BindingBoxTree {
        let bbox0 = BindingBoxTreeNode::Box(
            BindingBox {
                constraints: vec![Constraint::SizeFilter {
                    filter: SizeFilter::NumChilds {
                        child_name: child_name.clone(),
                        min: self.min_count,
                        max: self.max_count,
                    },
                }],
                ..Default::default()
            },
            vec![1],
        );

        let new_ob1 = match &self.related_type {
            EventOrObjectType::Object(_t) => {
                vec![(
                    ObjectVariable(new_variable),
                    vec![self.related_type.inner().to_string()]
                        .into_iter()
                        .collect(),
                )]
            }
            _ => Vec::default(),
        };
        let new_ev1 = match &self.related_type {
            EventOrObjectType::Event(_t) => {
                vec![(
                    EventVariable(new_variable),
                    vec![self.related_type.inner().to_string()]
                        .into_iter()
                        .collect(),
                )]
            }
            _ => Vec::default(),
        };

        let bbox1 = BindingBoxTreeNode::Box(
            BindingBox {
                new_event_vars: new_ev1.into_iter().collect(),
                new_object_vars: new_ob1.into_iter().collect(),
                filters: vec![match self.root_type {
                    // Must be object, as there are no E2E
                    EventOrObjectType::Event(_) => Filter::O2E {
                        object: ObjectVariable(new_variable),
                        event: EventVariable(inner_variable),
                        qualifier: None,
                        filter_label: None,
                    },

                    EventOrObjectType::Object(_) => match self.related_type {
                        EventOrObjectType::Event(_) => Filter::O2E {
                            object: ObjectVariable(inner_variable),
                            event: EventVariable(new_variable),
                            qualifier: None,
                            filter_label: None,
                        },
                        EventOrObjectType::Object(_) => Filter::O2O {
                            object: if !self.ocel_relation_flipped {
                                ObjectVariable(inner_variable)
                            } else {
                                ObjectVariable(new_variable)
                            },
                            other_object: if !self.ocel_relation_flipped {
                                ObjectVariable(new_variable)
                            } else {
                                ObjectVariable(inner_variable)
                            },
                            qualifier: None,
                            filter_label: None,
                        },
                    },
                }],
                ..Default::default()
            },
            vec![],
        );
        BindingBoxTree {
            nodes: vec![bbox0, bbox1],
            edge_names: vec![((0, 1), child_name)].into_iter().collect(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct EFConstraint {
    pub from_ev_type: String,
    pub to_ev_type: String,
    pub min_duration_sec: Option<f64>,
    pub max_duration_sec: Option<f64>,
    pub for_object_type: String,
}

pub fn discover_ef_constraints(
    ocel: &SlimLinkedOCEL,
    coverage: f32,
    object_type: &str,
) -> Vec<EFConstraint> {
    let _now = crate::timing::Timer::start();
    let mut ret = Vec::new();
    let instances: Vec<_> = get_instances(ocel, &EventOrObjectType::Object(object_type.to_owned()));
    ret.extend(discover_ef_constraints_for_supporting_instances(
        ocel,
        coverage,
        instances.into_iter().flat_map(|i| match i {
            EventOrObjectIndex::Object(oi) => Some(oi),
            _ => None,
        }),
        object_type,
    ));

    // println!("Graph Count Discovery took {:?}", now.elapsed());
    ret
}

pub fn discover_ef_constraints_for_supporting_instances<
    It: Borrow<ObjectIndex>,
    I: Iterator<Item = It>,
>(
    ocel: &SlimLinkedOCEL,
    coverage: f32,
    supporting_instances: I,
    supporting_object_type: &str,
) -> Vec<EFConstraint> {
    let _now = crate::timing::Timer::start();
    let mut ret = Vec::new();
    let mut rng = StdRng::seed_from_u64(RNG_SEED);
    let mut total_map: HashMap<String, HashMap<String, Vec<Option<f64>>>> = ocel
        .get_ev_types()
        .map(|et1| {
            (
                et1.to_string(),
                ocel.get_ev_types()
                    .map(|et2| (et2.to_string(), Vec::default()))
                    .collect(),
            )
        })
        .collect();
    for o_index in supporting_instances {
        let rels = get_symmetric_rels(&(*o_index.borrow()).into(), ocel);
        let evs = rels
            .iter()
            .flat_map(
                |SymmetricRel {
                     index,
                     reversed: _,
                     qualifier: _,
                 }| match index {
                    EventOrObjectIndex::Event(ei) => Some(ocel.get_full_ev(ei)),
                    EventOrObjectIndex::Object(_) => None,
                },
            )
            .collect_vec();
        let evs_num = evs.len();
        let evs = if evs_num >= 1000 {
            evs.into_iter()
                .choose_multiple(&mut rng, (SAMPLE_FRAC * evs_num as f32).ceil() as usize)
        } else {
            evs
        };
        // println!("Selected {} out of {} events",evs.len(), evs_num);
        for i in 0..evs.len() {
            let mut min_delay_to: HashMap<String, Option<f64>> =
                ocel.get_ev_types().map(|t| (t.to_string(), None)).collect();
            for j in 0..evs.len() {
                if i != j && evs[i].time <= evs[j].time {
                    let time_diff = (evs[j].time - evs[i].time).num_milliseconds() as f64 / 1000.0;

                    if let Some(v) = min_delay_to.get_mut(&evs[j].event_type) {
                        if v.is_none() || v.unwrap() > time_diff {
                            *v = Some(time_diff);
                        }
                    }
                }
            }
            for (to_ev_type, min_delay) in &min_delay_to {
                if let Some(x) = total_map
                    .get_mut(&evs[i].event_type)
                    .and_then(|x| x.get_mut(to_ev_type))
                {
                    x.push(*min_delay);
                }
            }
        }
    }
    // println!("Count finished after {:?}",now.elapsed());
    for (from_ev_type, x) in total_map {
        for (to_ev_type, seconds) in x {
            let num_ef_with_any_delay = seconds.iter().filter(|s| s.is_some()).count() as f32;
            let fraction_ef_with_any_delay = num_ef_with_any_delay / seconds.len() as f32;
            // println!("EF Fraction: {fraction_ef_with_any_delay} of {coverage}");
            if fraction_ef_with_any_delay >= coverage {
                let n = seconds.iter().flatten().count() as f64;
                let mean = seconds.iter().flatten().sum::<f64>() / n;
                // Otherwise, not interesting (i.e., no values > 0)
                let std_deviation = (seconds
                    .iter()
                    .flatten()
                    .map(|c| {
                        let diff = mean - *c;
                        diff * diff
                    })
                    .sum::<f64>()
                    / n)
                    .sqrt();
                // TODO: Decide if > 0?
                if std_deviation >= 0.0 {
                    // Otherwise, not interesting (no deviation between values)
                    if let Some((min, max)) = get_seconds_range_with_coverage(
                        &seconds,
                        coverage,
                        0.0,
                        std_deviation,
                        Direction::Increase,
                    ) {
                        ret.push(EFConstraint {
                            from_ev_type: from_ev_type.to_string(),
                            to_ev_type: to_ev_type.to_string(),
                            min_duration_sec: Some(min),
                            max_duration_sec: Some(max),
                            for_object_type: supporting_object_type.to_owned(),
                        });
                    }
                }
            }
        }
    }
    // println!("total_map finished after {:?}",now.elapsed());
    ret
}

impl EFConstraint {
    pub fn get_constraint_name(&self) -> String {
        format!(
            "Quick '{}' -> '{}' for '{}'",
            self.from_ev_type, self.to_ev_type, self.for_object_type,
        )
    }
    pub fn get_full_tree(&self) -> BindingBoxTree {
        // let child_name = "A".to_string();
        let inner_child_name = "A".to_string();
        let inner_variable = 0;
        let mut subtree = self.to_subtree(inner_child_name.clone(), inner_variable, 1, 2);
        match &mut subtree.nodes[0] {
            BindingBoxTreeNode::Box(bbox, _) => {
                bbox.new_object_vars.insert(
                    ObjectVariable(inner_variable),
                    vec![self.for_object_type.clone()].into_iter().collect(),
                );
            }
            _ => todo!("Expected a BindingBox"),
        }
        subtree
    }
    pub fn to_subtree(
        &self,
        child_name: String,
        inner_variable: usize,
        new_from_ev_var: usize,
        new_to_ev_var: usize,
    ) -> BindingBoxTree {
        let bbox0 = BindingBoxTreeNode::Box(
            BindingBox {
                new_event_vars: vec![(
                    EventVariable(new_from_ev_var),
                    vec![self.from_ev_type.clone()].into_iter().collect(),
                )]
                .into_iter()
                .collect(),
                new_object_vars: HashMap::default(),
                filters: vec![Filter::O2E {
                    object: ObjectVariable(inner_variable),
                    event: EventVariable(new_from_ev_var),
                    qualifier: None,
                    filter_label: None,
                }],
                size_filters: vec![],
                constraints: vec![Constraint::SizeFilter {
                    filter: SizeFilter::NumChilds {
                        child_name: child_name.clone(),
                        min: Some(1),
                        max: None,
                    },
                }],
                ..Default::default()
            },
            vec![1],
        );

        let bbox1 = BindingBoxTreeNode::Box(
            BindingBox {
                new_event_vars: vec![(
                    EventVariable(new_to_ev_var),
                    vec![self.to_ev_type.clone()].into_iter().collect(),
                )]
                .into_iter()
                .collect(),
                new_object_vars: HashMap::default(),
                filters: vec![
                    Filter::O2E {
                        object: ObjectVariable(inner_variable),
                        event: EventVariable(new_to_ev_var),
                        qualifier: None,
                        filter_label: None,
                    },
                    Filter::TimeBetweenEvents {
                        from_event: EventVariable(new_from_ev_var),
                        to_event: EventVariable(new_to_ev_var),
                        min_seconds: self.min_duration_sec,
                        max_seconds: self.max_duration_sec,
                    },
                ],
                size_filters: vec![],
                constraints: vec![],
                ..Default::default()
            },
            vec![],
        );
        BindingBoxTree {
            nodes: vec![bbox0, bbox1],
            edge_names: vec![((0, 1), child_name)].into_iter().collect(),
        }
    }
}

pub fn discover_or_constraints_new(
    ocel: &SlimLinkedOCEL,
    ocel_type: &EventOrObjectType,
    coverage: f32,
) -> Vec<(String, BindingBoxTree)> {
    let mut ret = Vec::new();
    let instances: Vec<_> = get_instances(ocel, ocel_type);
    let mut count_constraints: HashSet<CountConstraint> =
        discover_count_constraints_for_supporting_instances(
            ocel,
            0.11 * coverage,
            instances.iter(),
            ocel_type,
        )
        .into_iter()
        .collect();
    count_constraints.extend(discover_count_constraints_for_supporting_instances(
        ocel,
        0.7 * coverage,
        instances.iter(),
        ocel_type,
    ));
    count_constraints.extend(discover_count_constraints_for_supporting_instances(
        ocel,
        coverage,
        instances.iter(),
        ocel_type,
    ));
    let variable = match ocel_type {
        EventOrObjectType::Event(_) => Variable::Event(EventVariable(0)),
        EventOrObjectType::Object(_) => Variable::Object(ObjectVariable(0)),
    };
    let bindings = generate_sample_bindings(ocel, std::slice::from_ref(ocel_type), variable.clone());
    let max_sat_count: usize = (1.1 * coverage * bindings.len() as f32).ceil() as usize;
    let b_instances = binding_to_instances(&bindings, variable.clone());
    count_constraints.into_iter().for_each(|cc| {
        // for cc in &count_constraints {
        let cc_subtree: BindingBoxTree = cc.to_subtree("Y".to_string(), variable.to_inner(), 1);
        let cc_labeled_bindings = label_bindings(ocel, &bindings, &cc_subtree);
        let cc_sat_count = cc_labeled_bindings.iter().filter(|x| **x).count();

        if let EventOrObjectType::Object(object_type) = ocel_type {
            // First check EF constraints
            let ef_constraints: Vec<EFConstraint> =
                discover_ef_constraints_for_supporting_instances(
                    ocel,
                    0.9 * coverage,
                    cc_labeled_bindings
                        .iter()
                        .zip(b_instances.iter())
                        .filter(|(satisfied, _instance)| !**satisfied)
                        .flat_map(|(_satisfied, instance)| instance)
                        .flat_map(|i| match i {
                            EventOrObjectIndex::Object(oi) => Some(oi),
                            EventOrObjectIndex::Event(_) => None,
                        }),
                    object_type,
                );
            ef_constraints.into_iter().take(20).for_each(|ef_c| {
                // Check if cc OR ef_c is a good candidate
                // for that, first get labeled results for ef_c
                let ef_c_subtree = ef_c.to_subtree("X".to_string(), variable.to_inner(), 2, 3);
                if let Some(or_tree) = check_or_compat(
                    ocel,
                    &bindings,
                    &cc_labeled_bindings,
                    &cc_subtree,
                    cc_sat_count,
                    ef_c_subtree,
                    ocel_type,
                    &coverage,
                ) {
                    ret
                        // .write().unwrap()
                        .push((
                            format!(
                                "Quick '{}' after '{}' OR {}",
                                ef_c.to_ev_type,
                                ef_c.from_ev_type,
                                cc.get_constraint_name()
                            ),
                            or_tree,
                        ));
                }
            });
        }
        // Count constraints
        let cc2_constraints: Vec<CountConstraint> =
            discover_count_constraints_for_supporting_instances(
                ocel,
                coverage,
                cc_labeled_bindings
                    .iter()
                    .zip(b_instances.iter())
                    .filter(|(satisfied, _instance)| !**satisfied)
                    .flat_map(|(_satisfied, instance)| instance),
                ocel_type,
            );
        cc2_constraints
            .into_iter()
            .filter(|cc2| cc2.related_type != cc.related_type)
            .for_each(|cc_2| {
                // Check if cc OR ef_c is a good candidate
                // for that, first get labeled results for ef_c
                let cc2_subtree = cc_2.to_subtree("X".to_string(), variable.to_inner(), 2);
                if let Some(or_tree) = check_or_compat(
                    ocel,
                    &bindings,
                    &cc_labeled_bindings,
                    &cc_subtree,
                    cc_sat_count,
                    cc2_subtree,
                    ocel_type,
                    &coverage,
                ) {
                    ret
                        // .write().unwrap()
                        .push((
                            format!(
                                "{} OR {}",
                                cc_2.get_constraint_name(),
                                cc.get_constraint_name(),
                            ),
                            or_tree,
                        ));
                }
            })
    });
    if let EventOrObjectType::Object(object_type) = ocel_type {
        //
        let ef_constraints = discover_ef_constraints_for_supporting_instances(
            ocel,
            0.8 * coverage,
            instances.iter().flat_map(|i| match i {
                EventOrObjectIndex::Object(oi) => Some(oi),
                EventOrObjectIndex::Event(_) => None,
            }),
            object_type,
        );
        ef_constraints.into_iter().take(20).for_each(|ef_1| {
            let ef1_subtree = ef_1.to_subtree("Y".to_string(), variable.to_inner(), 2, 3);
            let ef1_labeled_bindings = label_bindings(ocel, &bindings, &ef1_subtree);
            let ef1_sat_count: usize = ef1_labeled_bindings.iter().filter(|x| **x).count();
            if ef1_sat_count < max_sat_count {
                let ef2_constraints: Vec<EFConstraint> =
                    discover_ef_constraints_for_supporting_instances(
                        ocel,
                        coverage,
                        ef1_labeled_bindings
                            .iter()
                            .zip(b_instances.iter())
                            .filter(|(satisfied, _instance)| !**satisfied)
                            .flat_map(|(_satisfied, instance)| instance)
                            .flat_map(|i| match i {
                                EventOrObjectIndex::Object(oi) => Some(oi),
                                EventOrObjectIndex::Event(_) => None,
                            })
                            .cloned(),
                        object_type,
                    );
                // println!("\t{} ef2_constraints",ef2_constraints.len());
                ef2_constraints.into_iter().take(20).for_each(|ef_2| {
                    // println!("Next EF combination");
                    // Check if cc OR ef_c is a good candidate
                    // for that, first get labeled results for ef_c
                    let ef2_subtree = ef_2.to_subtree("X".to_string(), variable.to_inner(), 2, 3);
                    if let Some(or_tree) = check_or_compat(
                        ocel,
                        &bindings,
                        &ef1_labeled_bindings,
                        &ef1_subtree,
                        ef1_sat_count,
                        ef2_subtree,
                        ocel_type,
                        &coverage,
                    ) {
                        ret
                            // .write().unwrap()
                            .push((
                                format!(
                                    "Quick '{}' after '{}' OR Quick '{}' after '{}' for '{}'",
                                    ef_2.to_ev_type,
                                    ef_2.from_ev_type,
                                    ef_1.to_ev_type,
                                    ef_1.from_ev_type,
                                    object_type
                                ),
                                or_tree,
                            ));
                    }
                })
            }
        });
    }
    ret
}

#[allow(clippy::too_many_arguments)]
pub fn check_or_compat(
    ocel: &SlimLinkedOCEL,
    bindings: &Vec<Binding>,
    st1_labeled_bindings: &[bool],
    st1: &BindingBoxTree,
    st1_sat_count: usize,
    st2: BindingBoxTree,
    ocel_type: &EventOrObjectType,
    coverage: &f32,
) -> Option<BindingBoxTree> {
    let ef_c_labeled_bindings = label_bindings(ocel, bindings, &st2);
    let or_sat_count = ef_c_labeled_bindings
        .iter()
        .zip(st1_labeled_bindings.iter())
        .filter(|(ef_sat, cc_sat)| **ef_sat || **cc_sat)
        .count();
    let st2_sat_count = ef_c_labeled_bindings.iter().filter(|x| **x).count();
    let n = bindings.len() as f32;
    // If independent, expected combined violation rate = violation1% * violation2%; this ratio measures the deviation from that.
    let independent_factor = (or_sat_count as f32 / n)
        / (1.0 - ((1.0 - (st1_sat_count as f32 / n)) * (1.0 - (st2_sat_count as f32 / n))));
    let good_sat_frac = or_sat_count as f32 / bindings.len() as f32;
    // println!("Independent Factor: {independent_factor} {good_or_frac} {good_sat_frac} {coverage}");
    if good_sat_frac >= *coverage && independent_factor >= 1.1 {
        let or_tree = merge_or_tree(
            st2,
            st1.clone(),
            ocel_type.clone(),
            Variable::Object(ObjectVariable(0)),
        );
        return Some(or_tree);
    }
    None
}

pub fn merge_or_tree(
    tree1: BindingBoxTree,
    tree2: BindingBoxTree,
    ocel_type: EventOrObjectType,
    input_variable: Variable,
) -> BindingBoxTree {
    let name1 = "A".to_string();
    let name2: String = "B".to_string();
    let mut bbox = BindingBox {
        new_event_vars: HashMap::new(),
        new_object_vars: HashMap::new(),
        filters: Vec::default(),
        size_filters: Vec::default(),
        constraints: vec![Constraint::OR {
            child_names: vec![name1.clone(), name2.clone()],
        }],
        ..Default::default()
    };
    match ocel_type {
        EventOrObjectType::Event(et) => bbox.new_event_vars.insert(
            EventVariable(input_variable.to_inner()),
            vec![et.clone()].into_iter().collect(),
        ),
        EventOrObjectType::Object(ot) => bbox.new_object_vars.insert(
            ObjectVariable(input_variable.to_inner()),
            vec![ot.clone()].into_iter().collect(),
        ),
    };
    let or_box = BindingBoxTreeNode::Box(bbox, vec![1, 1 + tree1.nodes.len()]);
    let mut or_tree = BindingBoxTree {
        nodes: vec![or_box],
        edge_names: HashMap::default(),
    };
    for tn in &tree1.nodes {
        if let BindingBoxTreeNode::Box(tn_box, tn_children) = tn {
            or_tree.nodes.push(BindingBoxTreeNode::Box(
                tn_box.clone(),
                tn_children.iter().map(|c| c + 1).collect(),
            ))
        }
    }
    for tn in &tree2.nodes {
        if let BindingBoxTreeNode::Box(tn_box, tn_children) = tn {
            or_tree.nodes.push(BindingBoxTreeNode::Box(
                tn_box.clone(),
                tn_children
                    .iter()
                    .map(|c| c + 1 + tree1.nodes.len())
                    .collect(),
            ))
        }
    }
    or_tree.edge_names.insert((0, 1), name1.clone());
    or_tree
        .edge_names
        .insert((0, 1 + tree1.nodes.len()), name2.clone());
    or_tree.edge_names.extend(
        tree1
            .edge_names
            .iter()
            .map(|((from, to), name)| ((*from + 1, to + 1), name.clone())),
    );
    or_tree
        .edge_names
        .extend(tree2.edge_names.iter().map(|((from, to), name)| {
            (
                (*from + 1 + tree1.nodes.len(), to + 1 + tree1.nodes.len()),
                name.clone(),
            )
        }));
    or_tree
}
