use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
};

use itertools::Itertools;
use process_mining::core::event_data::object_centric::linked_ocel::{
    LinkedOCELAccess, SlimLinkedOCEL,
};

use super::{
    structs::{BindingBox, BindingStep, EventVariable, Filter, Qualifier, Variable},
    Binding,
};

/// Per event variable, the other event variables it is time-constrained against, with the min and
/// max seconds allowed between them.
type TimeBetweenEventVars = HashMap<EventVariable, Vec<(EventVariable, Option<f64>, Option<f64>)>>;

impl BindingStep {
    /// Orders variable bindings so every variable is bound before a filter needs it, preferring the order that creates the fewest intermediate bindings.
    pub fn get_binding_order(
        bbox: &BindingBox,
        _parent_binding_opt: Option<&Binding>,
        ocel: &SlimLinkedOCEL,
    ) -> Vec<Self> {
        let mut ret = Vec::new();
        let card_cache: RefCell<HashMap<Variable, usize>> = RefCell::new(HashMap::new());
        let card_for_var = |v: &Variable| -> usize {
            if let Some(&c) = card_cache.borrow().get(v) {
                return c;
            }
            let c = match v {
                Variable::Event(ev) => bbox
                    .new_event_vars
                    .get(ev)
                    .map(|types| {
                        types
                            .iter()
                            .map(|t| ocel.get_evs_of_type(t).count())
                            .sum::<usize>()
                    })
                    .unwrap_or(0),
                Variable::Object(ob) => bbox
                    .new_object_vars
                    .get(ob)
                    .map(|types| {
                        types
                            .iter()
                            .map(|t| ocel.get_obs_of_type(t).count())
                            .sum::<usize>()
                    })
                    .unwrap_or(0),
            };
            card_cache.borrow_mut().insert(v.clone(), c);
            c
        };

        let mut var_requiring_bindings: BTreeSet<Variable> = bbox
            .new_event_vars
            .keys()
            .map(|v| Variable::Event(*v))
            .chain(bbox.new_object_vars.keys().map(|v| Variable::Object(*v)))
            .collect();

        let new_vars = var_requiring_bindings.clone();
        let mut bound_vars: BTreeSet<Variable> = bbox
            .filters
            .iter()
            .flat_map(|f| f.get_involved_variables())
            .filter(|var| !new_vars.contains(var))
            .collect();
        // Maps a variable A to the set of variable that can be bound based on A
        let mut var_can_bind: BTreeMap<Variable, BTreeSet<Variable>> = bound_vars
            .iter()
            .map(|v| (v.clone(), BTreeSet::new()))
            .collect();
        // Additional info, with a qualifier and the index of a filter constraint
        let mut var_can_bind_with_qualifier: BTreeMap<
            Variable,
            BTreeSet<(Variable, Qualifier, usize, bool)>,
        > = bound_vars
            .iter()
            .map(|v| (v.clone(), BTreeSet::new()))
            .collect();
        for ev_var in bbox.new_event_vars.keys() {
            var_can_bind.insert(Variable::Event(*ev_var), BTreeSet::new());
            var_can_bind_with_qualifier.insert(Variable::Event(*ev_var), BTreeSet::new());
        }
        for ob_var in bbox.new_object_vars.keys() {
            var_can_bind.insert(Variable::Object(*ob_var), BTreeSet::new());
            var_can_bind_with_qualifier.insert(Variable::Object(*ob_var), BTreeSet::new());
        }
        let mut time_between_evs: TimeBetweenEventVars = HashMap::new();
        for f in &bbox.filters {
            if let Filter::TimeBetweenEvents {
                from_event,
                to_event,
                min_seconds,
                max_seconds,
            } = f
            {
                time_between_evs.entry(*to_event).or_default().push((
                    *from_event,
                    *min_seconds,
                    *max_seconds,
                ));
                time_between_evs.entry(*from_event).or_default().push((
                    *to_event,
                    max_seconds.map(|s| -s),
                    min_seconds.map(|s| -s),
                ));
            }
        }

        // First count how many other variables depend on a variable (gather them in a set)
        for (i, f) in bbox.filters.iter().enumerate() {
            match f {
                Filter::O2E {
                    object,
                    event,
                    qualifier,
                    filter_label: _,
                } => {
                    var_can_bind
                        .entry(Variable::Object(*object))
                        .or_default()
                        .insert(Variable::Event(*event));
                    var_can_bind_with_qualifier
                        .entry(Variable::Object(*object))
                        .or_default()
                        .insert((Variable::Event(*event), qualifier.clone(), i, false));

                    var_can_bind
                        .entry(Variable::Event(*event))
                        .or_default()
                        .insert(Variable::Object(*object));
                    var_can_bind_with_qualifier
                        .entry(Variable::Event(*event))
                        .or_default()
                        .insert((Variable::Object(*object), qualifier.clone(), i, true));
                }
                Filter::O2O {
                    object,
                    other_object,
                    qualifier,
                    filter_label: _,
                } => {
                    var_can_bind
                        .entry(Variable::Object(*object))
                        .or_default()
                        .insert(Variable::Object(*other_object));
                    var_can_bind_with_qualifier
                        .entry(Variable::Object(*object))
                        .or_default()
                        .insert((Variable::Object(*other_object), qualifier.clone(), i, false));

                    var_can_bind
                        .entry(Variable::Object(*other_object))
                        .or_default()
                        .insert(Variable::Object(*object));
                    var_can_bind_with_qualifier
                        .entry(Variable::Object(*other_object))
                        .or_default()
                        .insert((Variable::Object(*object), qualifier.clone(), i, true));
                }
                _ => {}
            }
        }
        let mut filter_indices_incoporated = HashSet::new();

        fn add_supported_filters(
            bbox: &BindingBox,
            filter_indices_incoporated: &mut HashSet<usize>,
            var_requiring_bindings: &mut BTreeSet<Variable>,
            ret: &mut Vec<BindingStep>,
        ) {
            bbox.filters
                .iter()
                .enumerate()
                .filter(|(index, filter_constraint)| {
                    if !filter_indices_incoporated.contains(index) {
                        !filter_constraint
                            .get_involved_variables()
                            .iter()
                            .any(|v| var_requiring_bindings.contains(v))
                    } else {
                        false
                    }
                })
                .collect_vec()
                .into_iter()
                .for_each(|(index, filter_constraint)| {
                    ret.push(BindingStep::Filter(filter_constraint.clone()));
                    filter_indices_incoporated.insert(index);
                });
        }

        let mut expansion = var_can_bind
            .iter()
            .filter(|(v, _vs)| !bound_vars.contains(v))
            // Prefer binding events over objects first
            .sorted_by_key(|(v, vs)| {
                let can_be_bound = bound_vars
                    .iter()
                    .any(|bv| var_can_bind.get(bv).unwrap().contains(v));
                (
                    (vs.len() as i32) * 10
                        + if can_be_bound { 100 } else { 0 }
                        + if let Variable::Object(_) = v { 0 } else { 1 },
                    std::cmp::Reverse(card_for_var(v)),
                    std::cmp::Reverse(v.to_inner()),
                )
            })
            .map(|(k, _)| k)
            .collect_vec();
        while !expansion.is_empty() {
            if let Some(var) = expansion.pop() {
                if bound_vars.contains(var) {
                    continue;
                }
                if let Some((v, (_var, qualifier, filter_index, reversed))) = bound_vars
                    .iter()
                    .flat_map(|v| {
                        var_can_bind_with_qualifier
                            .get(v)
                            .unwrap()
                            .iter()
                            .find(|(x, _q, _filter_index, _reversed)| x == var)
                            .map(|t| (v, t))
                    })
                    .next()
                {
                    // `var` can be bound based on `v`!
                    filter_indices_incoporated.insert(*filter_index);
                    match v {
                        Variable::Event(v_ev) => match var {
                            Variable::Object(var_ob) => ret.push(BindingStep::BindObFromEv(
                                *var_ob,
                                *v_ev,
                                qualifier.clone(),
                            )),
                            _ => {
                                eprintln!("Can not bind an event based on another event.")
                            }
                        },
                        Variable::Object(v_ob) => match var {
                            Variable::Event(var_ev) => ret.push(BindingStep::BindEvFromOb(
                                *var_ev,
                                *v_ob,
                                qualifier.clone(),
                            )),
                            Variable::Object(var_ob) => ret.push(BindingStep::BindObFromOb(
                                *var_ob,
                                *v_ob,
                                qualifier.clone(),
                                *reversed,
                            )),
                        },
                    }
                } else {
                    match var {
                        Variable::Event(var_ev) => {
                            let constraints = time_between_evs.get(var_ev).map(|cs| {
                                cs.iter()
                                    .map(|(ref_ev, mn, mx)| (*ref_ev, (*mn, *mx)))
                                    .collect::<Vec<_>>()
                            });
                            ret.push(BindingStep::BindEv(*var_ev, constraints));
                        }
                        Variable::Object(var_ob) => ret.push(BindingStep::BindOb(*var_ob)),
                    }
                }
                var_requiring_bindings.remove(var);
                bound_vars.insert(var.clone());
                add_supported_filters(
                    bbox,
                    &mut filter_indices_incoporated,
                    &mut var_requiring_bindings,
                    &mut ret,
                );
            }
            expansion.sort_by_key(|var| {
                let can_be_bound = bound_vars
                    .iter()
                    .any(|bv| var_can_bind.get(bv).unwrap().contains(var));
                (
                    if can_be_bound { 100 } else { 0 },
                    std::cmp::Reverse(card_for_var(var)),
                    std::cmp::Reverse(var.to_inner()),
                )
            })
        }

        ret.extend(
            bbox.filters
                .iter()
                .enumerate()
                .filter(|(i, _)| !filter_indices_incoporated.contains(i))
                .map(|(_, f)| BindingStep::Filter(f.clone())),
        );
        ret
    }
}
