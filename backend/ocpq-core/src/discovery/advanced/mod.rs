// Idea: given >1 (arbitrary) binding box subtrees where initial binding steps are missing
// with the same input bindings (or at least a common subset?) use sampling of bindings to evaluate the binding subtrees
// Detect patterns (e.g., OR) based on the boolean results for the sampled bindings (i..e., if the subtree is satisfied for the binding)


use itertools::Itertools;

use process_mining::core::event_data::object_centric::linked_ocel::{
    slim_linked_ocel::EventOrObjectIndex, LinkedOCELAccess, SlimLinkedOCEL,
};
use rand::{rngs::StdRng, seq::IteratorRandom, SeedableRng};
use rayon::iter::{IntoParallelRefIterator, ParallelIterator};

use crate::binding_box::{
    structs::Variable,
    Binding, BindingBoxTree,
};

use super::{
    RNG_SEED, SAMPLE_FRAC,
    SAMPLE_MIN_NUM_INSTANCES,
};

// 1st Step: Allow building of  (simple) sampled bindings based on object/event type
pub fn generate_sample_bindings(
    ocel: &SlimLinkedOCEL,
    ocel_types: &[EventOrObjectType],
    target_variable: Variable,
) -> Vec<Binding> {
    let mut rng = StdRng::seed_from_u64(RNG_SEED);
    match target_variable {
        Variable::Event(ev) => {
            let instances: Vec<_> = ocel_types
                .iter()
                .flat_map(|t| ocel.get_evs_of_type(t.inner()))
                .collect();
            let sample_count = if instances.len() >= SAMPLE_MIN_NUM_INSTANCES {
                (instances.len() as f32 * SAMPLE_FRAC).ceil() as usize
            } else {
                instances.len()
            };
            instances
                .iter()
                .choose_multiple(&mut rng, sample_count)
                .iter()
                .map(|i| Binding::default().expand_with_ev(ev, ***i))
                .collect()
        }
        Variable::Object(ov) => {
            let instances: Vec<_> = ocel_types
                .iter()
                .flat_map(|t| ocel.get_obs_of_type(t.inner()))
                .collect();
            let sample_count = if instances.len() >= SAMPLE_MIN_NUM_INSTANCES {
                (instances.len() as f32 * SAMPLE_FRAC).ceil() as usize
            } else {
                instances.len()
            };
            instances
                .iter()
                .choose_multiple(&mut rng, sample_count)
                .iter()
                .map(|i| Binding::default().expand_with_ob(ov, ***i))
                .collect()
        }
    }
}

pub fn binding_to_instances(
    bindings: &[Binding],
    variable: Variable,
) -> Vec<Option<EventOrObjectIndex>> {
    bindings
        .iter()
        .map(|b| b.get_any_index(&variable))
        .collect_vec()
}

// Given a list of bindings, check if the given subtree is violated (in some child binding)
// Results are a list of bools of the same size as the input bindings
// True: Subtree was satisfied for Binding, False: Subtree was violated for Binding
pub fn label_bindings(
    ocel: &SlimLinkedOCEL,
    bindings: &Vec<Binding>,
    subtree: &BindingBoxTree,
) -> Vec<bool> {
    let step_cache = subtree.compute_step_cache(ocel);
    bindings
        .par_iter()
        .map(|b| {
            let ((_x, y), _skipped) = subtree.nodes[0]
                .evaluate(0, (*b).clone(), subtree, ocel, &step_cache)
                .unwrap();
            let is_violated = y.iter().any(|(_, v)| v.is_some());
            !is_violated
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum EventOrObjectType {
    Event(String),
    Object(String),
}

impl EventOrObjectType {
    pub fn inner(&self) -> &String {
        match self {
            EventOrObjectType::Event(et) => et,
            EventOrObjectType::Object(ot) => ot,
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum EventOrObjectTypeRef<'a> {
    Event(&'a str),
    Object(&'a str),
}

impl<'a> EventOrObjectTypeRef<'a> {
    pub fn inner(&'a self) -> &'a str {
        match self {
            EventOrObjectTypeRef::Event(et) => et,
            EventOrObjectTypeRef::Object(ot) => ot,
        }
    }
}
