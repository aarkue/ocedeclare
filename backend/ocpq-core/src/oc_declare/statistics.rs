use std::collections::{HashMap, HashSet};

use process_mining::core::{
    event_data::object_centric::linked_ocel::{
        slim_linked_ocel::ObjectIndex, LinkedOCELAccess, SlimLinkedOCEL,
    },
    process_models::oc_declare::*,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[ts(export)]
pub struct ActivityStatistics {
    pub num_evs_per_ot_type: HashMap<String, Vec<usize>>,
    pub num_obs_of_ot_per_ev: HashMap<String, Vec<usize>>,
}

pub fn get_activity_statistics(locel: &SlimLinkedOCEL, activity: &str) -> ActivityStatistics {
    if activity.starts_with(INIT_EVENT_PREFIX) || activity.starts_with(EXIT_EVENT_PREFIX) {
        let ob_type = if activity.starts_with(INIT_EVENT_PREFIX) {
            &activity[INIT_EVENT_PREFIX.len() + 1..]
        } else {
            &activity[EXIT_EVENT_PREFIX.len() + 1..]
        };
        return ActivityStatistics {
            num_evs_per_ot_type: vec![(
                ob_type.to_string(),
                vec![1; locel.get_obs_of_type(ob_type).count()],
            )]
            .into_iter()
            .collect(),
            num_obs_of_ot_per_ev: vec![(
                ob_type.to_string(),
                vec![1; locel.get_obs_of_type(ob_type).count()],
            )]
            .into_iter()
            .collect(),
        };
    }
    // Number of activity events per object (of a type)
    let mut num_evs_per_type: HashMap<String, Vec<usize>> = HashMap::new();
    let mut relevant_object_types = HashSet::new();
    // Number of objects (of a type) per activity
    let mut num_objects_per_type: HashMap<&str, Vec<usize>> = HashMap::new();

    for ev in locel.get_evs_of_type(activity) {
        let mut num_obs_of_type_for_ev = HashMap::new();
        for (_q, ob) in locel.get_e2o(ev) {
            let ot = locel.get_ob_type_of(ob);
            *num_obs_of_type_for_ev.entry(ot).or_default() += 1
        }
        for (a, b) in num_obs_of_type_for_ev {
            relevant_object_types.insert(a);
            num_objects_per_type.entry(a).or_default().push(b);
        }
    }

    for ot in relevant_object_types {
        num_evs_per_type.insert(
            ot.to_string(),
            locel
                .get_obs_of_type(ot)
                .map(|o| {
                    locel
                        .get_e2o_rev(o)
                        .filter(|(_q, e)| locel.get_ev_type_of(*e) == activity)
                        .count()
                })
                .collect(),
        );
    }
    ActivityStatistics {
        num_obs_of_ot_per_ev: num_objects_per_type
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect(),
        num_evs_per_ot_type: num_evs_per_type,
    }
}

/// Pre-binned histogram data for edge duration statistics
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[ts(export)]
pub struct BinnedEdgeDurationStats {
    /// Bin center values (in milliseconds)
    pub bin_centers_ms: Vec<f64>,
    /// Percentage of total for each bin
    pub percentages: Vec<f64>,
    /// Human-readable bin edge labels
    pub bin_labels: Vec<String>,
    /// Total number of duration values
    pub total_count: usize,
    /// Minimum duration in milliseconds
    pub min_ms: f64,
    /// Maximum duration in milliseconds
    pub max_ms: f64,
}

/// The events of type `etype` a binding's object filters select. Mirrors `process_mining`'s
/// `pub(crate)` `target_events_for_binding`; an empty filter list, or `All` of an empty list, is vacuously true and selects every event of the type.
fn target_events_for_binding(
    objs: &[SetFilter<&ObjectIndex>],
    locel: &SlimLinkedOCEL,
    etype: &str,
) -> Vec<EventOrSynthetic> {
    let for_ob = |ob: ObjectIndex| EventOrSynthetic::get_all_of_et_for_ob(locel, etype, ob);
    let initial: Vec<EventOrSynthetic> = match objs.first() {
        None => EventOrSynthetic::get_all_syn_evs(locel, etype),
        Some(SetFilter::Any(items)) => {
            let mut seen: HashSet<EventOrSynthetic> = HashSet::new();
            items
                .iter()
                .flat_map(|o| for_ob(**o))
                .filter(|e| seen.insert(*e))
                .collect()
        }
        Some(SetFilter::All(items)) => match items.split_first() {
            // Vacuously true for an empty `All`: no constraint, so every event of the type is a candidate.
            None => EventOrSynthetic::get_all_syn_evs(locel, etype),
            Some((first, rest)) => for_ob(**first)
                .filter(|e| {
                    let obs = e.get_e2o_set(locel);
                    rest.iter().all(|o| obs.contains(o))
                })
                .collect(),
        },
    };
    initial
        .into_iter()
        .filter(|e| {
            let obs = e.get_e2o_set(locel);
            objs.iter().all(|o| o.check(&obs))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use process_mining::core::event_data::object_centric::{
        appendable::AppendableOCEL, OCELRelationship, OCELType,
    };

    fn empty_type(name: &str) -> OCELType {
        OCELType {
            name: name.into(),
            attributes: Vec::new(),
        }
    }

    /// One "place" event with no e2o relationships and one with some, so `All(&[])` (vacuously
    /// true, no constraint) is distinguishable from `All` of an actually-present object.
    fn sample_locel() -> SlimLinkedOCEL {
        let mut s = SlimLinkedOCEL::new();
        s.declare_event_type(empty_type("place")).unwrap();
        s.declare_object_type(empty_type("order")).unwrap();
        s.append_object("o1".into(), "order", Vec::new(), Vec::new())
            .unwrap();
        s.append_event(
            "e0".into(),
            "place",
            chrono::DateTime::parse_from_rfc3339("2024-01-01T00:00:00Z").unwrap(),
            Vec::new(),
            Vec::new(),
        )
        .unwrap();
        s.append_event(
            "e1".into(),
            "place",
            chrono::DateTime::parse_from_rfc3339("2024-01-02T00:00:00Z").unwrap(),
            Vec::new(),
            vec![OCELRelationship {
                object_id: "o1".into(),
                qualifier: "q".into(),
            }],
        )
        .unwrap();
        s.finalize().unwrap();
        s
    }

    // `SetFilter::check` is vacuously true for `All(&[])`, so `target_events_for_binding` must
    // not special-case it to an empty candidate set. See the identical fix in `process_mining`.
    #[test]
    fn all_of_empty_items_matches_every_event_of_the_type() {
        let locel = sample_locel();
        let no_objs: Vec<SetFilter<&ObjectIndex>> = Vec::new();
        let empty_all: Vec<SetFilter<&ObjectIndex>> = vec![SetFilter::All(Vec::new())];

        let via_no_objs: HashSet<_> =
            target_events_for_binding(&no_objs, &locel, "place").into_iter().collect();
        let via_empty_all: HashSet<_> =
            target_events_for_binding(&empty_all, &locel, "place").into_iter().collect();

        assert_eq!(via_empty_all, via_no_objs);
        assert_eq!(via_empty_all.len(), locel.get_evs_of_type("place").count());
    }
}

pub fn get_edge_stats(locel: &SlimLinkedOCEL, arc: &OCDeclareArc) -> BinnedEdgeDurationStats {
    let durations: Vec<i64> = EventOrSynthetic::get_all_syn_evs(locel, arc.from.as_str())
        .iter()
        .flat_map(|ev_index| {
            let ev_time = ev_index.get_timestamp(locel);
            arc.label
                .get_bindings(ev_index, locel)
                .flat_map(move |binding| {
                    let target_ev_iterator =
                        target_events_for_binding(&binding, locel, arc.to.as_str())
                            .into_iter()
                            .filter(|ev2| {
                            let ev2_time = ev2.get_timestamp(locel);
                            match arc.arc_type {
                                OCDeclareArcType::EF | OCDeclareArcType::DF => ev_time < ev2_time,
                                OCDeclareArcType::EP | OCDeclareArcType::DP => ev_time > ev2_time,
                                OCDeclareArcType::AS => true,
                            }
                        });
                    let first_ev = target_ev_iterator.min_by_key(|e| e.get_timestamp(locel));
                    first_ev.map(|ev2| (ev2.get_timestamp(locel) - ev_time).num_milliseconds())
                })
        })
        .collect();

    bin_durations(&durations)
}

fn bin_durations(durations: &[i64]) -> BinnedEdgeDurationStats {
    let total_count = durations.len();
    if total_count == 0 {
        return BinnedEdgeDurationStats {
            bin_centers_ms: vec![],
            percentages: vec![],
            bin_labels: vec![],
            total_count: 0,
            min_ms: 0.0,
            max_ms: 0.0,
        };
    }

    let min_ms = durations.iter().copied().min().unwrap() as f64;
    let max_ms = durations.iter().copied().max().unwrap() as f64;

    if min_ms == max_ms {
        return BinnedEdgeDurationStats {
            bin_centers_ms: vec![min_ms],
            percentages: vec![100.0],
            bin_labels: vec![format!("[{min_ms}, {max_ms})")],
            total_count,
            min_ms,
            max_ms,
        };
    }

    let target_bins: usize = 25;
    let data_range = max_ms - min_ms;
    let rough_bin_size = data_range / target_bins as f64;

    let exponent = rough_bin_size.log10().floor();
    let power_of_10 = 10.0_f64.powf(exponent);
    let mantissa = rough_bin_size / power_of_10;

    let nice_mantissa = if mantissa < 1.5 {
        1.0
    } else if mantissa < 3.0 {
        2.0
    } else if mantissa < 7.0 {
        5.0
    } else {
        10.0
    };

    let bin_size = nice_mantissa * power_of_10;
    let chart_min = (min_ms / bin_size).floor() * bin_size;
    let chart_max = (max_ms / bin_size).ceil() * bin_size;
    let epsilon = bin_size * 0.001;
    let bin_count = ((chart_max - chart_min) / bin_size).round().max(1.0) as usize;

    let mut bins = vec![0usize; bin_count];
    for &val in durations {
        let v = val as f64;
        if v >= chart_max - epsilon {
            bins[bin_count - 1] += 1;
        } else {
            let idx = ((v - chart_min) / bin_size).floor() as isize;
            if idx >= 0 && (idx as usize) < bin_count {
                bins[idx as usize] += 1;
            }
        }
    }

    let precision = (-exponent).max(0.0) as usize;
    let mut bin_centers_ms = Vec::new();
    let mut percentages = Vec::new();
    let mut bin_labels = Vec::new();

    for (i, &count) in bins.iter().enumerate().take(bin_count) {
        if count > 0 {
            let bin_start = chart_min + i as f64 * bin_size;
            let bin_end = bin_start + bin_size;
            bin_centers_ms.push(bin_start + bin_size / 2.0);
            percentages.push((count as f64 / total_count as f64) * 100.0);
            bin_labels.push(format!(
                "[{:.prec$}, {:.prec$})",
                bin_start,
                bin_end,
                prec = precision
            ));
        }
    }

    BinnedEdgeDurationStats {
        bin_centers_ms,
        percentages,
        bin_labels,
        total_count,
        min_ms,
        max_ms,
    }
}
