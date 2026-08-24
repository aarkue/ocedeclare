use std::{
    borrow::Cow,
    collections::{HashMap, HashSet},
    fmt::Display,
    hash::Hash,
};

use itertools::Itertools;
use ordered_float::OrderedFloat;
use process_mining::core::event_data::object_centric::{
    linked_ocel::{
        slim_linked_ocel::{EventIndex, EventOrObjectIndex, ObjectIndex},
        LinkedOCELAccess, SlimLinkedOCEL,
    },
    OCELAttributeValue, OCELEvent, OCELObject,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_with::serde_as;
use ts_rs::TS;

use crate::cel::{add_cel_label, check_cel_predicate, get_vars_in_cel_program};
#[derive(TS)]
#[ts(export)]
#[derive(Debug, Clone, Hash, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema)]
pub enum Variable {
    Event(EventVariable),
    Object(ObjectVariable),
}

impl Variable {
    pub fn to_inner(&self) -> usize {
        match self {
            Variable::Event(ev) => ev.0,
            Variable::Object(ov) => ov.0,
        }
    }
}

#[derive(TS)]
#[ts(export)]
#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq, Serialize, Deserialize, PartialOrd, Ord, JsonSchema)]
pub struct EventVariable(pub usize);
impl From<usize> for EventVariable {
    fn from(value: usize) -> Self {
        Self(value)
    }
}
#[derive(TS)]
#[ts(export)]
#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq, Serialize, Deserialize, PartialOrd, Ord, JsonSchema)]
pub struct ObjectVariable(pub usize);
impl From<usize> for ObjectVariable {
    fn from(value: usize) -> Self {
        Self(value)
    }
}

pub type Qualifier = Option<String>;

#[derive(TS)]
#[ts(export)]
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    // #[ts(as = "BTreeMap<EventVariable, usize>")]
    // pub event_map: FxHashMap<EventVariable, EventIndex>,
    #[ts(as = "Vec<(EventVariable, usize)>")]
    pub event_map: Vec<(EventVariable, EventIndex)>,
    // #[ts(as = "BTreeMap<ObjectVariable, usize>")]
    // pub object_map: FxHashMap<ObjectVariable, ObjectIndex>,
    #[ts(as = "Vec<(ObjectVariable, usize)>")]
    pub object_map: Vec<(ObjectVariable, ObjectIndex)>,
    // pub label_map: FxHashMap<String, LabelValue>,
    pub label_map: Vec<(String, LabelValue)>,
}

#[derive(TS)]
#[ts(export)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "type", content = "value")]
pub enum LabelValue {
    String(std::sync::Arc<String>),
    Int(i64),
    Float(#[ts(as = "f64")] #[schemars(with = "f64")] OrderedFloat<f64>),
    Bool(bool),
    Null,
}

impl std::fmt::Display for LabelValue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LabelValue::String(arc) => write!(f, "{arc}"),
            LabelValue::Int(i) => write!(f, "{i}"),
            LabelValue::Float(fl) => write!(f, "{fl}"),
            LabelValue::Bool(b) => write!(f, "{b}"),
            LabelValue::Null => write!(f, "null"),
        }
    }
}

pub(crate) enum EvInsertion {
    Inserted { pos: usize },
    Replaced { pos: usize, prev: EventIndex },
}

pub(crate) enum ObInsertion {
    Inserted { pos: usize },
    Replaced { pos: usize, prev: ObjectIndex },
}

impl Binding {
    pub fn expand_with_ev(mut self, ev_var: EventVariable, ev_index: EventIndex) -> Self {
        match self.event_map.binary_search_by_key(&ev_var, |x| x.0) {
            Ok(i) => self.event_map[i] = (ev_var, ev_index),
            Err(i) => self.event_map.insert(i, (ev_var, ev_index)),
        }
        self
    }

    pub(crate) fn extend_with_ev_in_place(
        &mut self,
        ev_var: EventVariable,
        ev_index: EventIndex,
    ) -> EvInsertion {
        match self.event_map.binary_search_by_key(&ev_var, |x| x.0) {
            Ok(i) => {
                let prev = self.event_map[i].1;
                self.event_map[i] = (ev_var, ev_index);
                EvInsertion::Replaced { pos: i, prev }
            }
            Err(i) => {
                self.event_map.insert(i, (ev_var, ev_index));
                EvInsertion::Inserted { pos: i }
            }
        }
    }

    pub(crate) fn revert_ev(&mut self, insertion: EvInsertion, ev_var: EventVariable) {
        match insertion {
            EvInsertion::Inserted { pos } => {
                self.event_map.remove(pos);
            }
            EvInsertion::Replaced { pos, prev } => {
                self.event_map[pos] = (ev_var, prev);
            }
        }
    }

    pub fn expand_with_ob(mut self, ob_var: ObjectVariable, ob_index: ObjectIndex) -> Self {
        match self.object_map.binary_search_by_key(&ob_var, |x| x.0) {
            Ok(i) => self.object_map[i] = (ob_var, ob_index),
            Err(i) => self.object_map.insert(i, (ob_var, ob_index)),
        }
        self
    }

    pub(crate) fn extend_with_ob_in_place(
        &mut self,
        ob_var: ObjectVariable,
        ob_index: ObjectIndex,
    ) -> ObInsertion {
        match self.object_map.binary_search_by_key(&ob_var, |x| x.0) {
            Ok(i) => {
                let prev = self.object_map[i].1;
                self.object_map[i] = (ob_var, ob_index);
                ObInsertion::Replaced { pos: i, prev }
            }
            Err(i) => {
                self.object_map.insert(i, (ob_var, ob_index));
                ObInsertion::Inserted { pos: i }
            }
        }
    }

    pub(crate) fn revert_ob(&mut self, insertion: ObInsertion, ob_var: ObjectVariable) {
        match insertion {
            ObInsertion::Inserted { pos } => {
                self.object_map.remove(pos);
            }
            ObInsertion::Replaced { pos, prev } => {
                self.object_map[pos] = (ob_var, prev);
            }
        }
    }
    pub fn add_label(&mut self, label: String, value: LabelValue) {
        match self.label_map.binary_search_by_key(&&label, |x| &x.0) {
            Ok(i) => self.label_map[i] = (label, value),
            Err(i) => self.label_map.insert(i, (label, value)),
        }
    }

    /// get all object variables in this binding
    /// guarantees that result is sorted
    pub fn get_all_ob_vars(&self) -> impl Iterator<Item = &ObjectVariable> {
        self.object_map.iter().map(|x| &x.0)
    }
    /// get all event variables in this binding
    /// guarantees that result is sorted
    pub fn get_all_ev_vars(&self) -> impl Iterator<Item = &EventVariable> {
        self.event_map.iter().map(|x| &x.0)
    }

    pub fn get_label_value(&self, label: impl AsRef<str>) -> Option<&LabelValue> {
        match self
            .label_map
            .binary_search_by_key(&label.as_ref(), |x| &x.0)
        {
            Ok(i) => Some(&self.label_map[i].1),
            Err(_) => None,
        }
    }
    pub fn get_ev<'a>(
        &self,
        ev_var: &EventVariable,
        ocel: &'a SlimLinkedOCEL,
    ) -> Option<Cow<'a, OCELEvent>> {
        let ev_index = self.get_ev_index(ev_var)?;
        Some(ocel.get_full_ev(ev_index))
    }
    pub fn get_ob<'a>(
        &self,
        ob_var: &ObjectVariable,
        ocel: &'a SlimLinkedOCEL,
    ) -> Option<Cow<'a, OCELObject>> {
        let ob_index = self.get_ob_index(ob_var)?;
        Some(ocel.get_full_ob(ob_index))
    }

    pub fn to_id_string(&self, ocel: &SlimLinkedOCEL) -> String {
        let mut ret = String::new();
        for (_ev_var, ev_val) in &self.event_map {
            ret.push_str(ocel.get_ev_id(ev_val));
            ret.push_str(", ");
        }
        for (_ob_var, ob_val) in &self.object_map {
            ret.push_str(ocel.get_ob_id(ob_val));
            ret.push_str(", ");
        }

        ret
    }

    #[inline]
    pub fn get_ev_index(&self, ev_var: &EventVariable) -> Option<&EventIndex> {
        if let Ok(index) = self.event_map.binary_search_by_key(ev_var, |x| x.0) {
            return Some(&self.event_map[index].1);
        }
        None
        // self.event_map.get(ev_var)
    }
    #[inline]
    pub fn get_ob_index(&self, ob_var: &ObjectVariable) -> Option<&ObjectIndex> {
        if let Ok(index) = self.object_map.binary_search_by_key(ob_var, |x| x.0) {
            return Some(&self.object_map[index].1);
        }
        None
        // self.object_map.get(ob_var)
    }

    pub fn get_any_index(&self, var: &Variable) -> Option<EventOrObjectIndex> {
        match var {
            Variable::Event(ev) => self.get_ev_index(ev).map(|r| EventOrObjectIndex::Event(*r)),
            Variable::Object(ov) => self
                .get_ob_index(ov)
                .map(|r: &ObjectIndex| EventOrObjectIndex::Object(*r)),
        }
    }
}

/// Maps a variable to the set of types it may be bound to.
pub type NewObjectVariables = HashMap<ObjectVariable, HashSet<String>>;
pub type NewEventVariables = HashMap<EventVariable, HashSet<String>>;

#[derive(TS)]
#[ts(export)]
#[derive(Debug, Clone, Serialize, Deserialize, Default, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BindingBox {
    pub new_event_vars: NewEventVariables,
    pub new_object_vars: NewObjectVariables,
    pub filters: Vec<Filter>,
    pub size_filters: Vec<SizeFilter>,
    pub constraints: Vec<Constraint>,
    #[serde(default)]
    #[ts(optional)]
    #[ts(as = "Option<HashMap<EventVariable,FilterLabel>>")]
    pub ev_var_labels: HashMap<EventVariable, FilterLabel>,
    #[serde(default)]
    #[ts(optional)]
    #[ts(as = "Option<HashMap<EventVariable,FilterLabel>>")]
    pub ob_var_labels: HashMap<ObjectVariable, FilterLabel>,
    #[serde(default)]
    #[ts(optional)]
    #[ts(as = "Option<Vec<LabelFunction>>")]
    pub labels: Vec<LabelFunction>,
}

#[derive(TS)]
#[ts(export)]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, JsonSchema)]
pub enum FilterLabel {
    #[default]
    IGNORED,
    INCLUDED,
    EXCLUDED,
}

#[derive(TS)]
#[ts(export)]
#[derive(Debug, Clone, Serialize, Deserialize, Default, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LabelFunction {
    pub label: String,
    pub cel: String,
}

#[derive(TS)]
#[ts(export)]
#[serde_as]
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BindingBoxTree {
    pub nodes: Vec<BindingBoxTreeNode>,
    #[serde_as(as = "Vec<(_, _)>")]
    #[ts(as = "Vec<((usize, usize), String)>")]
    #[schemars(with = "Vec<((usize, usize), String)>")]
    pub edge_names: HashMap<(usize, usize), String>, // #[serde_as(as = "Vec<(_, _)>")]
                                                     // #[ts(as = "Vec<((usize, usize), (Option<usize>, Option<usize>))>")]
                                                     // pub size_constraints: HashMap<(usize, usize), (Option<usize>, Option<usize>)>,
}

impl BindingBoxTree {
    /// Single source of truth for edge names, so gate constraints and child-result keys always agree.
    pub fn edge_name(&self, parent: usize, child: usize) -> String {
        self.edge_names
            .get(&(parent, child))
            .cloned()
            .unwrap_or_else(|| format!("{UNNAMED}{child}"))
    }

    pub fn compute_step_cache(&self, ocel: &SlimLinkedOCEL) -> Vec<Vec<BindingStep>> {
        self.nodes
            .iter()
            .enumerate()
            .map(|(idx, n)| {
                let (bbox, _children) = n.to_box(idx, self);
                BindingStep::get_binding_order(&bbox, None, ocel)
            })
            .collect()
    }

    pub fn evaluate(&self, ocel: &SlimLinkedOCEL) -> Result<(EvaluationResults, bool), String> {
        if self.nodes.is_empty() {
            return Ok((vec![], false));
        }
        let mut is_child = vec![false; self.nodes.len()];
        for node in &self.nodes {
            match node {
                BindingBoxTreeNode::Box(_, children) => {
                    for &c in children {
                        if c < is_child.len() {
                            is_child[c] = true;
                        }
                    }
                }
                BindingBoxTreeNode::OR(a, b) | BindingBoxTreeNode::AND(a, b) => {
                    if *a < is_child.len() {
                        is_child[*a] = true;
                    }
                    if *b < is_child.len() {
                        is_child[*b] = true;
                    }
                }
                BindingBoxTreeNode::NOT(a) => {
                    if *a < is_child.len() {
                        is_child[*a] = true;
                    }
                }
            }
        }

        let step_cache = self.compute_step_cache(ocel);
        let mut combined = Vec::new();
        let mut any_skipped = false;
        for (idx, node) in self.nodes.iter().enumerate() {
            if is_child[idx] {
                continue;
            }
            let ((ret, _violation), skipped) =
                node.evaluate(idx, Binding::default(), self, ocel, &step_cache)?;
            combined.extend(ret);
            any_skipped = any_skipped || skipped;
        }
        Ok((combined, any_skipped))
    }

    pub fn get_ev_vars(&self) -> HashSet<EventVariable> {
        self.nodes
            .iter()
            .filter_map(|n| match n {
                BindingBoxTreeNode::Box(b, _) => Some(b.new_event_vars.keys()),
                _ => None,
            })
            .flatten()
            .copied()
            .collect()
    }

    pub fn get_ob_vars(&self) -> HashSet<ObjectVariable> {
        self.nodes
            .iter()
            .filter_map(|n| match n {
                BindingBoxTreeNode::Box(b, _) => Some(b.new_object_vars.keys()),
                _ => None,
            })
            .flatten()
            .copied()
            .collect()
    }
}
#[derive(TS)]
#[ts(export)]
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
// Boxing the large variant would add an indirection on the evaluation hot path to save memory a
// tree of a few dozen nodes never needs.
#[allow(clippy::large_enum_variant)]
pub enum BindingBoxTreeNode {
    Box(BindingBox, Vec<usize>),
    OR(usize, usize),
    AND(usize, usize),
    NOT(usize),
}
const UNNAMED: &str = "UNNAMED - ";
impl BindingBoxTreeNode {
    pub fn to_box(
        &self,
        self_index: usize,
        tree: &BindingBoxTree,
    ) -> (Cow<'_, BindingBox>, Cow<'_, Vec<usize>>) {
        match self {
            BindingBoxTreeNode::Box(b, children) => (Cow::Borrowed(b), Cow::Borrowed(children)),
            BindingBoxTreeNode::OR(c1, c2) => (
                Cow::Owned(BindingBox {
                    constraints: vec![Constraint::OR {
                        child_names: vec![
                            tree.edge_name(self_index, *c1),
                            tree.edge_name(self_index, *c2),
                        ],
                    }],
                    ..Default::default()
                }),
                Cow::Owned(vec![*c1, *c2]),
            ),
            BindingBoxTreeNode::AND(c1, c2) => (
                Cow::Owned(BindingBox {
                    constraints: vec![Constraint::AND {
                        child_names: vec![
                            tree.edge_name(self_index, *c1),
                            tree.edge_name(self_index, *c2),
                        ],
                    }],
                    ..Default::default()
                }),
                Cow::Owned(vec![*c1, *c2]),
            ),
            BindingBoxTreeNode::NOT(c1) => (
                Cow::Owned(BindingBox {
                    constraints: vec![Constraint::NOT {
                        child_names: vec![tree.edge_name(self_index, *c1)],
                    }],
                    ..Default::default()
                }),
                Cow::Owned(vec![*c1]),
            ),
        }
    }

    pub fn as_box(&self) -> Option<&BindingBox> {
        match self {
            BindingBoxTreeNode::Box(b, _children) => Some(b),
            _ => None,
        }
    }
}

#[derive(TS)]
#[ts(export)]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
pub enum ViolationReason {
    TooFewMatchingEvents(usize),
    TooManyMatchingEvents(usize),
    NoChildrenOfORSatisfied,
    LeftChildOfANDUnsatisfied,
    RightChildOfANDUnsatisfied,
    BothChildrenOfANDUnsatisfied,
    ChildrenOfNOTSatisfied,
    ChildNotSatisfied,

    ConstraintNotSatisfied(usize),
    UnknownChildSet,
}

pub type EvaluationResult = (usize, std::sync::Arc<Binding>, Option<ViolationReason>);
pub type EvaluationResults = Vec<EvaluationResult>;
pub type BindingViolations = Vec<(std::sync::Arc<Binding>, Option<ViolationReason>)>;
pub type ChildResults = HashMap<String, BindingViolations>;
pub type NodeEvaluation = ((EvaluationResults, BindingViolations), bool);
use rayon::prelude::*;

fn check_constraints(
    constraints: &[Constraint],
    binding: &Binding,
    child_res: &ChildResults,
    ocel: &SlimLinkedOCEL,
) -> Result<Option<ViolationReason>, String> {
    for (constr_index, constr) in constraints.iter().enumerate() {
        let viol = match constr {
            Constraint::Filter { filter } => {
                if filter.check_binding(binding, ocel)? {
                    None
                } else {
                    Some(ViolationReason::ConstraintNotSatisfied(constr_index))
                }
            }
            Constraint::SizeFilter { filter } => {
                if filter.check(binding, child_res, ocel)? {
                    None
                } else {
                    Some(ViolationReason::ConstraintNotSatisfied(constr_index))
                }
            }
            Constraint::SAT { child_names } => {
                let violated = child_names.iter().any(|child_name| {
                    if let Some(c_res) = child_res.get(child_name) {
                        c_res.iter().any(|(_b, v)| v.is_some())
                    } else {
                        true
                    }
                });
                if violated {
                    Some(ViolationReason::ConstraintNotSatisfied(constr_index))
                } else {
                    None
                }
            }
            Constraint::ANY { child_names } => {
                let violated = child_names.iter().any(|child_name| {
                    if let Some(c_res) = child_res.get(child_name) {
                        c_res.iter().all(|(_b, v)| v.is_some())
                    } else {
                        true
                    }
                });
                if violated {
                    Some(ViolationReason::ConstraintNotSatisfied(constr_index))
                } else {
                    None
                }
            }
            Constraint::NOT { child_names } => {
                let violated = child_names.iter().all(|child_name| {
                    if let Some(c_res) = child_res.get(child_name) {
                        c_res.iter().any(|(_b, v)| v.is_none())
                    } else {
                        true
                    }
                });
                if violated {
                    Some(ViolationReason::ConstraintNotSatisfied(constr_index))
                } else {
                    None
                }
            }
            Constraint::OR { child_names } => {
                let any_sat = child_names.iter().any(|child_name| {
                    if let Some(c_res) = child_res.get(child_name) {
                        c_res.iter().all(|(_b, v)| v.is_none())
                    } else {
                        true
                    }
                });
                if any_sat {
                    None
                } else {
                    Some(ViolationReason::ConstraintNotSatisfied(constr_index))
                }
            }
            Constraint::AND { child_names } => {
                let any_sat = child_names.iter().all(|child_name| {
                    if let Some(c_res) = child_res.get(child_name) {
                        c_res.iter().all(|(_b, v)| v.is_none())
                    } else {
                        true
                    }
                });
                if any_sat {
                    None
                } else {
                    Some(ViolationReason::ConstraintNotSatisfied(constr_index))
                }
            }
        };
        if let Some(vr) = viol {
            return Ok(Some(vr));
        }
    }
    Ok(None)
}

/// Describes how much child evaluation a binding box requires during streaming evaluation.
pub(crate) enum ChildDemand {
    /// No children need evaluation (no constraints or labels reference them).
    None,
    /// Only child counts are needed, bounded per child: `max+1` when max is set (detects exceeding it), else `min`.
    Counts(HashMap<String, usize>),
    /// Full child evaluation required (labels or non-NumChilds constraints present).
    Full,
}

enum BindingEmission {
    FilteredOut,
    Emit(Option<ViolationReason>),
}

fn num_childs_count_limit(min: Option<usize>, max: Option<usize>) -> usize {
    max.map(|m| m.saturating_add(1)).unwrap_or(min.unwrap_or(0))
}

fn add_num_childs_count_limit(
    counts: &mut HashMap<String, usize>,
    child_name: &str,
    min: Option<usize>,
    max: Option<usize>,
) {
    let limit = num_childs_count_limit(min, max);
    counts
        .entry(child_name.to_string())
        .and_modify(|existing| *existing = (*existing).max(limit))
        .or_insert(limit);
}

impl ChildDemand {
    pub(crate) fn required_for(bbox: &BindingBox) -> Self {
        if !bbox.labels.is_empty() {
            return Self::Full;
        }

        let mut counts = HashMap::new();
        for sf in &bbox.size_filters {
            match sf {
                SizeFilter::NumChilds {
                    child_name,
                    min,
                    max,
                } => add_num_childs_count_limit(&mut counts, child_name, *min, *max),
                _ => return Self::Full,
            }
        }

        for constraint in &bbox.constraints {
            match constraint {
                Constraint::Filter { .. } => {}
                Constraint::SizeFilter {
                    filter:
                        SizeFilter::NumChilds {
                            child_name,
                            min,
                            max,
                        },
                } => add_num_childs_count_limit(&mut counts, child_name, *min, *max),
                _ => return Self::Full,
            }
        }

        if counts.is_empty() {
            Self::None
        } else {
            Self::Counts(counts)
        }
    }
}

fn check_num_childs_count(count: Option<usize>, min: Option<usize>, max: Option<usize>) -> bool {
    if let Some(count) = count {
        min.is_none_or(|min| count >= min) && max.is_none_or(|max| count <= max)
    } else {
        false
    }
}

fn check_size_filter_with_counts(
    filter: &SizeFilter,
    child_counts: &HashMap<String, usize>,
) -> bool {
    match filter {
        SizeFilter::NumChilds {
            child_name,
            min,
            max,
        } => check_num_childs_count(child_counts.get(child_name).copied(), *min, *max),
        _ => false,
    }
}

fn check_constraints_with_counts(
    constraints: &[Constraint],
    binding: &Binding,
    child_counts: &HashMap<String, usize>,
    ocel: &SlimLinkedOCEL,
) -> Result<Option<ViolationReason>, String> {
    for (constr_index, constr) in constraints.iter().enumerate() {
        let violated = match constr {
            Constraint::Filter { filter } => !filter.check_binding(binding, ocel)?,
            Constraint::SizeFilter { filter } => {
                !check_size_filter_with_counts(filter, child_counts)
            }
            _ => true,
        };
        if violated {
            return Ok(Some(ViolationReason::ConstraintNotSatisfied(constr_index)));
        }
    }
    Ok(None)
}

impl BindingBoxTreeNode {
    pub fn evaluate(
        &self,
        own_index: usize,
        mut parent_binding: Binding,
        tree: &BindingBoxTree,
        ocel: &SlimLinkedOCEL,
        step_cache: &[Vec<BindingStep>],
    ) -> Result<NodeEvaluation, String> {
        self.evaluate_in_place(own_index, &mut parent_binding, tree, ocel, step_cache)
    }

    fn evaluate_in_place(
        &self,
        own_index: usize,
        parent_binding: &mut Binding,
        tree: &BindingBoxTree,
        ocel: &SlimLinkedOCEL,
        step_cache: &[Vec<BindingStep>],
    ) -> Result<NodeEvaluation, String> {
        use std::sync::Arc;
        let (bbox, children) = self.to_box(own_index, tree);
        let child_edges: Vec<(usize, String)> = children
            .iter()
            .map(|c| (*c, tree.edge_name(own_index, *c)))
            .collect();
        let (expanded, expanding_skipped_bindings): (Vec<Binding>, bool) =
            bbox.expand_with_steps_in_place(parent_binding, ocel, &step_cache[own_index])?;
        enum BindingResult {
            FilteredOutBySizeFilter(std::sync::Arc<Binding>, EvaluationResults),
            Sat(std::sync::Arc<Binding>, EvaluationResults),
            Viol(std::sync::Arc<Binding>, ViolationReason, EvaluationResults),
        }
        let expanded_len = expanded.len();
        let it = rayon_cancel::CancelAdapter::new(expanded.into_par_iter().with_min_len(256));
        let canceller = it.canceller();
        let re: Vec<BindingResult> = it
            .map(|mut b| {
                let mut all_res = Vec::new();
                let mut child_res = HashMap::with_capacity(child_edges.len());
                for (c, c_name) in &child_edges {
                    let ((c_res, violations), _c_skipped) =
                        tree.nodes[*c].evaluate_in_place(*c, &mut b, tree, ocel, step_cache)?;
                    child_res.insert(c_name.clone(), violations);
                    if child_edges.len() * c_res.len() * expanded_len > 150_000_000 {
                        canceller.cancel();
                        println!(
                            "Too much to handle! {}*{}*{}={}",
                            child_res.len(),
                            c_res.len(),
                            expanded_len,
                            child_edges.len() * c_res.len() * expanded_len
                        );
                    }
                    all_res.extend(c_res);
                }
                for label_fun in &bbox.labels {
                    add_cel_label(&mut b, Some(&child_res), ocel, label_fun)?;
                }
                for sf in &bbox.size_filters {
                    if !sf.check(&b, &child_res, ocel)? {
                        return Ok::<BindingResult, String>(
                            BindingResult::FilteredOutBySizeFilter(Arc::new(b), Vec::default()),
                        );
                    }
                }
                if let Some(vr) = check_constraints(&bbox.constraints, &b, &child_res, ocel)? {
                    let arc_b = Arc::new(b);
                    all_res.push((own_index, Arc::clone(&arc_b), Some(vr)));
                    return Ok(BindingResult::Viol(arc_b, vr, all_res));
                }
                let arc_b = Arc::new(b);
                all_res.push((own_index, Arc::clone(&arc_b), None));
                Ok(BindingResult::Sat(arc_b, all_res))
            })
            .collect::<Result<_, _>>()?;
        let recursive_calls_cancelled = canceller.is_cancelled();
        Ok((
            re.into_par_iter()
                .fold(
                    || (EvaluationResults::new(), Vec::new()),
                    |(mut a, mut b), x| match x {
                        BindingResult::FilteredOutBySizeFilter(_binding, r) => {
                            a.extend(r);
                            (a, b)
                        }
                        BindingResult::Sat(binding, r) => {
                            a.extend(r);
                            b.push((binding, None));
                            (a, b)
                        }
                        BindingResult::Viol(binding, v, r) => {
                            a.extend(r);
                            b.push((binding, Some(v)));
                            (a, b)
                        }
                    },
                )
                .reduce(
                    || (EvaluationResults::new(), Vec::new()),
                    |(mut a, mut b), (x, y)| {
                        a.extend(x);
                        b.extend(y);
                        (a, b)
                    },
                ),
            expanding_skipped_bindings || recursive_calls_cancelled,
        ))
    }

    #[allow(clippy::too_many_arguments)]
    fn evaluate_no_descendants_binding(
        &self,
        bbox: &BindingBox,
        binding: &mut Binding,
        tree: &BindingBoxTree,
        ocel: &SlimLinkedOCEL,
        step_cache: &[Vec<BindingStep>],
        child_edges: &[(usize, String)],
        child_demand: &ChildDemand,
    ) -> Result<BindingEmission, String> {
        use std::sync::Arc;

        match child_demand {
            ChildDemand::Full => {
                let mut child_res = HashMap::with_capacity(child_edges.len());
                for (c, c_name) in child_edges {
                    let mut violations: BindingViolations = Vec::new();
                    let mut child_sink =
                        |bd: Arc<Binding>, vr: Option<ViolationReason>| -> Result<(), String> {
                            violations.push((bd, vr));
                            Ok(())
                        };
                    let _c_skipped = tree.nodes[*c].evaluate_no_descendants_in_place(
                        *c,
                        binding,
                        tree,
                        ocel,
                        step_cache,
                        &mut child_sink,
                    )?;
                    child_res.insert(c_name.clone(), violations);
                }
                for label_fun in &bbox.labels {
                    add_cel_label(binding, Some(&child_res), ocel, label_fun)?;
                }
                for sf in &bbox.size_filters {
                    if !sf.check(binding, &child_res, ocel)? {
                        return Ok(BindingEmission::FilteredOut);
                    }
                }
                Ok(
                    match check_constraints(&bbox.constraints, binding, &child_res, ocel)? {
                        Some(vr) => BindingEmission::Emit(Some(vr)),
                        None => BindingEmission::Emit(None),
                    },
                )
            }
            ChildDemand::Counts(count_limits) => {
                let mut child_counts = HashMap::with_capacity(count_limits.len());
                for (c, c_name) in child_edges {
                    if let Some(&limit) = count_limits.get(c_name) {
                        let (count, _skipped) = tree.nodes[*c]
                            .evaluate_no_descendants_count_limited(
                                *c, binding, tree, ocel, step_cache, limit,
                            )?;
                        child_counts.insert(c_name.clone(), count);
                    }
                }
                for sf in &bbox.size_filters {
                    if !check_size_filter_with_counts(sf, &child_counts) {
                        return Ok(BindingEmission::FilteredOut);
                    }
                }
                Ok(
                    match check_constraints_with_counts(
                        &bbox.constraints,
                        binding,
                        &child_counts,
                        ocel,
                    )? {
                        Some(vr) => BindingEmission::Emit(Some(vr)),
                        None => BindingEmission::Emit(None),
                    },
                )
            }
            ChildDemand::None => {
                let child_res = HashMap::new();
                Ok(
                    match check_constraints(&bbox.constraints, binding, &child_res, ocel)? {
                        Some(vr) => BindingEmission::Emit(Some(vr)),
                        None => BindingEmission::Emit(None),
                    },
                )
            }
        }
    }

    fn evaluate_no_descendants_count_limited(
        &self,
        own_index: usize,
        parent_binding: &mut Binding,
        tree: &BindingBoxTree,
        ocel: &SlimLinkedOCEL,
        step_cache: &[Vec<BindingStep>],
        limit: usize,
    ) -> Result<(usize, bool), String> {
        if limit == 0 {
            return Ok((0, false));
        }

        let (bbox, children) = self.to_box(own_index, tree);
        if children.is_empty()
            && bbox.labels.is_empty()
            && bbox.size_filters.is_empty()
            && bbox.constraints.is_empty()
        {
            return bbox.count_with_steps_in_place(
                parent_binding,
                ocel,
                &step_cache[own_index],
                limit,
            );
        }

        let child_edges: Vec<(usize, String)> = children
            .iter()
            .map(|c| (*c, tree.edge_name(own_index, *c)))
            .collect();
        let child_demand = ChildDemand::required_for(&bbox);
        let (expanded, expanding_skipped_bindings): (Vec<Binding>, bool) =
            bbox.expand_with_steps_in_place(parent_binding, ocel, &step_cache[own_index])?;

        let mut count = 0;
        for mut b in expanded {
            if matches!(
                self.evaluate_no_descendants_binding(
                    bbox.as_ref(),
                    &mut b,
                    tree,
                    ocel,
                    step_cache,
                    &child_edges,
                    &child_demand,
                )?,
                BindingEmission::Emit(_)
            ) {
                count += 1;
                if count >= limit {
                    return Ok((count, expanding_skipped_bindings));
                }
            }
        }

        Ok((count, expanding_skipped_bindings))
    }

    /// Like `evaluate`, but streams (binding, violation) pairs into `sink` instead of accumulating per-node descendant bindings into a `Vec`.
    pub fn evaluate_no_descendants(
        &self,
        own_index: usize,
        mut parent_binding: Binding,
        tree: &BindingBoxTree,
        ocel: &SlimLinkedOCEL,
        step_cache: &[Vec<BindingStep>],
        sink: &mut dyn FnMut(
            std::sync::Arc<Binding>,
            Option<ViolationReason>,
        ) -> Result<(), String>,
    ) -> Result<bool, String> {
        self.evaluate_no_descendants_in_place(
            own_index,
            &mut parent_binding,
            tree,
            ocel,
            step_cache,
            sink,
        )
    }

    // `sink` is type-erased (`&mut dyn FnMut`) to prevent issues with recursion limits
    fn evaluate_no_descendants_in_place(
        &self,
        own_index: usize,
        parent_binding: &mut Binding,
        tree: &BindingBoxTree,
        ocel: &SlimLinkedOCEL,
        step_cache: &[Vec<BindingStep>],
        sink: &mut dyn FnMut(
            std::sync::Arc<Binding>,
            Option<ViolationReason>,
        ) -> Result<(), String>,
    ) -> Result<bool, String> {
        use std::sync::Arc;
        let (bbox, children) = self.to_box(own_index, tree);
        let child_demand = ChildDemand::required_for(&bbox);
        let child_edges: Vec<(usize, String)> = children
            .iter()
            .map(|c| (*c, tree.edge_name(own_index, *c)))
            .collect();
        let (expanded, expanding_skipped_bindings): (Vec<Binding>, bool) =
            bbox.expand_with_steps_in_place(parent_binding, ocel, &step_cache[own_index])?;
        enum BindingResult {
            FilteredOutBySizeFilter,
            Sat(std::sync::Arc<Binding>),
            Viol(std::sync::Arc<Binding>, ViolationReason),
        }

        if child_edges.is_empty()
            && bbox.labels.is_empty()
            && bbox.size_filters.is_empty()
            && bbox.constraints.is_empty()
        {
            for b in expanded {
                sink(Arc::new(b), None)?;
            }
            return Ok(expanding_skipped_bindings);
        }

        let it = expanded.into_par_iter().with_min_len(256);
        let re: Vec<BindingResult> = it
            .map(|mut b| {
                match self.evaluate_no_descendants_binding(
                    bbox.as_ref(),
                    &mut b,
                    tree,
                    ocel,
                    step_cache,
                    &child_edges,
                    &child_demand,
                )? {
                    BindingEmission::FilteredOut => {
                        Ok::<BindingResult, String>(BindingResult::FilteredOutBySizeFilter)
                    }
                    BindingEmission::Emit(Some(vr)) => {
                        Ok::<BindingResult, String>(BindingResult::Viol(Arc::new(b), vr))
                    }
                    BindingEmission::Emit(None) => {
                        Ok::<BindingResult, String>(BindingResult::Sat(Arc::new(b)))
                    }
                }
            })
            .collect::<Result<_, _>>()?;

        for x in re {
            match x {
                BindingResult::FilteredOutBySizeFilter => {}
                BindingResult::Sat(b) => sink(b, None)?,
                BindingResult::Viol(b, v) => sink(b, Some(v))?,
            }
        }
        Ok(expanding_skipped_bindings)
    }
}

#[derive(TS)]
#[ts(export)]
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type")]
pub enum Filter {
    /// Object is associated with event (optionally through a qualifier)
    O2E {
        object: ObjectVariable,
        event: EventVariable,
        qualifier: Qualifier,
        #[serde(default)]
        #[ts(optional)]
        #[serde(rename = "filterLabel")]
        filter_label: Option<FilterLabel>,
    },
    /// Object1 is associated with object2 (optionally through a qualifier)
    O2O {
        object: ObjectVariable,
        other_object: ObjectVariable,
        qualifier: Qualifier,
        #[serde(default)]
        #[ts(optional)]
        #[serde(rename = "filterLabel")]
        filter_label: Option<FilterLabel>,
    },
    /// Time duration betweeen event1 and event2 is in the specified interval (min,max) (given in Some(seconds); where None represents no restriction)
    TimeBetweenEvents {
        from_event: EventVariable,
        to_event: EventVariable,
        min_seconds: Option<f64>,
        max_seconds: Option<f64>,
    },
    NotEqual {
        var_1: Variable,
        var_2: Variable,
    },
    EventAttributeValueFilter {
        event: EventVariable,
        attribute_name: String,
        value_filter: ValueFilter,
    },
    ObjectAttributeValueFilter {
        object: ObjectVariable,
        attribute_name: String,
        at_time: ObjectValueFilterTimepoint,
        value_filter: ValueFilter,
    },
    BasicFilterCEL {
        cel: String,
    },
}

impl Filter {
    pub fn check_binding(&self, b: &Binding, ocel: &SlimLinkedOCEL) -> Result<bool, String> {
        match self {
            Filter::O2E {
                object,
                event,
                qualifier,
                filter_label: _,
            } => {
                let ob_index = b
                    .get_ob_index(object)
                    .ok_or_else(|| format!("Object Variable {object} without value."))?;
                let ev_index = b
                    .get_ev_index(event)
                    .ok_or_else(|| format!("Event Variable {event} without value."))?;
                let ob_type = ocel.get_ob_type_of(ob_index);
                Ok(ocel
                    .get_e2o_of_type(ev_index, ob_type)
                    .any(|(q, o)| o == ob_index && qualifier.as_ref().is_none_or(|qual| q == qual)))
            }
            Filter::O2O {
                object,
                other_object,
                qualifier,
                filter_label: _,
            } => {
                let ob1 = b
                    .get_ob_index(object)
                    .ok_or_else(|| format!("Object Variable {object} without value"))?;
                let ob2 = b
                    .get_ob_index(other_object)
                    .ok_or_else(|| format!("Object Variable {other_object} without value"))?;
                let ob2_type = ocel.get_ob_type_of(ob2);
                Ok(ocel
                    .get_o2o_of_type(ob1, ob2_type)
                    .any(|(q, o)| o == ob2 && qualifier.as_ref().is_none_or(|qual| q == qual)))
            }
            Filter::TimeBetweenEvents {
                from_event: ev_var_1,
                to_event: ev_var_2,
                min_seconds: min_sec,
                max_seconds: max_sec,
            } => {
                let e1 = b
                    .get_ev_index(ev_var_1)
                    .ok_or_else(|| format!("Event Variable {ev_var_1} without value"))?;
                let e2 = b
                    .get_ev_index(ev_var_2)
                    .ok_or_else(|| format!("Event Variable {ev_var_2} without value"))?;
                let e1_time = e1.get_time(ocel);
                let e2_time = e2.get_time(ocel);
                let diff = *e2_time - e1_time;
                let duration_diff = match diff.num_microseconds() {
                    Some(us) => us as f64 / 1_000_000.0,
                    None => diff.num_milliseconds() as f64 / 1000.0,
                };
                Ok(!min_sec.is_some_and(|min_sec| duration_diff < min_sec)
                    && !max_sec.is_some_and(|max_sec| duration_diff > max_sec))
            }
            Filter::NotEqual { var_1, var_2 } => {
                let val_1 = b.get_any_index(var_1);
                let val_2 = b.get_any_index(var_2);
                Ok(!(val_1.is_none() || val_2.is_none() || val_1 == val_2))
            }
            Filter::EventAttributeValueFilter {
                event,
                attribute_name,
                value_filter,
            } => {
                let e_opt = b.get_ev(event, ocel);
                if let Some(e) = e_opt {
                    if attribute_name == "ocel:id" {
                        if let ValueFilter::String { is_in } = value_filter {
                            return Ok(is_in.contains(&e.id));
                        }
                        return Ok(false);
                    }
                    if attribute_name == "ocel:time" {
                        return Ok(value_filter.check_value(&OCELAttributeValue::Time(e.time)));
                    }
                    if let Some(attr) = e.attributes.iter().find(|at| &at.name == attribute_name) {
                        Ok(value_filter.check_value(&attr.value))
                    } else {
                        Ok(false)
                    }
                } else {
                    Ok(false)
                }
            }
            Filter::ObjectAttributeValueFilter {
                object,
                attribute_name,
                at_time,
                value_filter,
            } => {
                let o_opt = b.get_ob(object, ocel);
                if let Some(o) = o_opt {
                    if attribute_name == "ocel:id" {
                        if let ValueFilter::String { is_in } = value_filter {
                            return Ok(is_in.contains(&o.id));
                        }
                        return Ok(false);
                    }
                    match at_time {
                        ObjectValueFilterTimepoint::Always => Ok(o
                            .attributes
                            .iter()
                            .filter(|at| &at.name == attribute_name)
                            .all(|at| value_filter.check_value(&at.value))),
                        ObjectValueFilterTimepoint::Sometime => Ok(o
                            .attributes
                            .iter()
                            .filter(|at| &at.name == attribute_name)
                            .any(|at| value_filter.check_value(&at.value))),
                        ObjectValueFilterTimepoint::AtEvent { event } => {
                            if let Some(ev) = b.get_ev_index(event) {
                                let ev_time = ocel.get_ev_time(ev);
                                // Find last attribute value update _before_ the event occured (or at the same time)
                                if let Some(last_val_before) = o
                                    .attributes
                                    .iter()
                                    .filter(|at| &at.name == attribute_name && &at.time <= ev_time)
                                    .sorted_by_key(|x| x.time)
                                    .last()
                                {
                                    Ok(value_filter.check_value(&last_val_before.value))
                                } else {
                                    Ok(false)
                                }
                            } else {
                                Ok(false)
                            }
                        }
                    }
                } else {
                    Ok(false)
                }
            }
            Filter::BasicFilterCEL { cel } => {
                Ok(check_cel_predicate(cel, b, None, ocel)?)
            }
        }
    }
}

#[derive(TS, Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum ValueFilter {
    Float {
        min: Option<f64>,
        max: Option<f64>,
    },
    Integer {
        // Prevent BigInt as TS/JS type
        // We do not really care about such large values + it messes with JSON
        #[ts(as = "Option<i32>")]
        min: Option<i64>,
        #[ts(as = "Option<i32>")]
        max: Option<i64>,
    },
    Boolean {
        is_true: bool,
    },
    String {
        is_in: Vec<String>,
    },
    Time {
        from: Option<chrono::DateTime<chrono::Utc>>,
        to: Option<chrono::DateTime<chrono::Utc>>,
    },
}

impl ValueFilter {
    pub fn check_value(&self, val: &OCELAttributeValue) -> bool {
        match self {
            ValueFilter::Float { min, max } => match val {
                OCELAttributeValue::Float(v) => {
                    !min.is_some_and(|min_v| v < &min_v) && !max.is_some_and(|max_v| v > &max_v)
                }
                OCELAttributeValue::Integer(v) => {
                    !min.is_some_and(|min_v| (*v as f64) < min_v)
                        && !max.is_some_and(|max_v| (*v as f64) > max_v)
                }
                _ => false,
            },
            ValueFilter::Integer { min, max } => match val {
                OCELAttributeValue::Integer(v) => {
                    !min.is_some_and(|min_v| v < &min_v) && !max.is_some_and(|max_v| v > &max_v)
                }
                OCELAttributeValue::Float(v) => {
                    !min.is_some_and(|min_v| *v < (min_v as f64))
                        && !max.is_some_and(|max_v| *v > (max_v as f64))
                }
                _ => false,
            },
            ValueFilter::Boolean { is_true } => match val {
                OCELAttributeValue::Boolean(b) => is_true == b,
                _ => false,
            },
            ValueFilter::String { is_in } => match val {
                OCELAttributeValue::String(s) => is_in.contains(s),
                _ => false,
            },
            ValueFilter::Time { from, to } => match val {
                OCELAttributeValue::Time(v) => {
                    !from.is_some_and(|min_v| v < &min_v) && !to.is_some_and(|max_v| v > &max_v)
                }
                _ => false,
            },
        }
    }
}

#[derive(TS, Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum ObjectValueFilterTimepoint {
    Always,
    Sometime,
    AtEvent { event: EventVariable },
}

#[derive(TS)]
#[ts(export)]
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type")]
pub enum SizeFilter {
    // The nth child should be between (min,max) interval, where None represent no bound
    NumChilds {
        child_name: NodeEdgeName,
        min: Option<usize>,
        max: Option<usize>,
    },
    BindingSetEqual {
        child_names: Vec<NodeEdgeName>,
    },
    BindingSetProjectionEqual {
        child_name_with_var_name: Vec<(NodeEdgeName, Variable)>,
    },
    NumChildsProj {
        child_name: NodeEdgeName,
        var_name: Variable,
        min: Option<usize>,
        max: Option<usize>,
    },
    AdvancedCEL {
        cel: String,
    },
}

impl SizeFilter {
    pub fn check(
        &self,
        binding: &Binding,
        child_res: &ChildResults,
        ocel: &SlimLinkedOCEL,
    ) -> Result<bool, String> {
        match self {
            SizeFilter::NumChilds {
                child_name,
                min,
                max,
            } => {
                // println!("{child_index} {c} Min: {:?} Max: {:?} Len: {}",min,max,violations.len());
                if let Some(c_res) = child_res.get(child_name) {
                    if min.is_some_and(|min| c_res.len() < min) {
                        Ok(false)
                    } else {
                        Ok(!max.is_some_and(|max| c_res.len() > max))
                    }
                } else {
                    Ok(false)
                }
            }
            SizeFilter::NumChildsProj {
                child_name,
                var_name,
                min,
                max,
            } => {
                if let Some(c_res) = child_res.get(child_name) {
                    let set: HashSet<_> = c_res
                        .iter()
                        .flat_map(|(b, _)| b.get_any_index(var_name))
                        .collect();
                    if min.is_some_and(|min| set.len() < min) {
                        Ok(false)
                    } else {
                        Ok(!max.is_some_and(|max| set.len() > max))
                    }
                } else {
                    Ok(false)
                }
            }
            SizeFilter::BindingSetEqual { child_names } => {
                if child_names.is_empty() {
                    Ok(true)
                } else if let Some(c_res) = child_res.get(&child_names[0]) {
                    let set1: HashSet<_> = c_res.iter().map(|(binding, _)| binding).collect();
                    for other_c in child_names.iter().skip(1) {
                        if let Some(c2_res) = child_res.get(other_c) {
                            let set2: HashSet<_> =
                                c2_res.iter().map(|(binding, _)| binding).collect();
                            if set1 != set2 {
                                return Ok(false);
                            }
                        } else {
                            return Ok(false);
                        }
                    }
                    Ok(true)
                } else {
                    Ok(false)
                }
            }
            SizeFilter::BindingSetProjectionEqual {
                child_name_with_var_name,
            } => {
                if child_name_with_var_name.is_empty() {
                    Ok(true)
                } else if let Some(c_res) = child_res.get(&child_name_with_var_name[0].0) {
                    let set: HashSet<_> = c_res
                        .iter()
                        .map(|(binding, _)| match child_name_with_var_name[0].1 {
                            Variable::Event(e_var) => binding
                                .get_ev_index(&e_var)
                                .map(|e| EventOrObjectIndex::from(*e)),
                            Variable::Object(o_var) => binding
                                .get_ob_index(&o_var)
                                .map(|o| EventOrObjectIndex::from(*o)),
                        })
                        .collect();
                    for (other_c, var) in child_name_with_var_name.iter().skip(1) {
                        if let Some(c2_res) = child_res.get(other_c) {
                            let set2: HashSet<_> = c2_res
                                .iter()
                                .map(|(binding, _)| match var {
                                    Variable::Event(e_var) => binding
                                        .get_ev_index(e_var)
                                        .map(|e| EventOrObjectIndex::from(*e)),
                                    Variable::Object(o_var) => binding
                                        .get_ob_index(o_var)
                                        .map(|o| EventOrObjectIndex::from(*o)),
                                })
                                .collect();
                            if set != set2 {
                                return Ok(false);
                            }
                        } else {
                            return Ok(false);
                        }
                    }
                    Ok(true)
                } else {
                    Ok(false)
                }
            }
            SizeFilter::AdvancedCEL { cel } => {
                Ok(check_cel_predicate(cel, binding, Some(child_res), ocel)?)
            }
        }
    }
}

type NodeEdgeName = String;

#[derive(TS)]
#[ts(export)]
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type")]
pub enum Constraint {
    Filter { filter: Filter },
    SizeFilter { filter: SizeFilter },
    SAT { child_names: Vec<NodeEdgeName> },
    ANY { child_names: Vec<NodeEdgeName> },
    NOT { child_names: Vec<NodeEdgeName> },
    OR { child_names: Vec<NodeEdgeName> },
    AND { child_names: Vec<NodeEdgeName> },
}

impl Filter {
    pub fn get_involved_variables(&self) -> HashSet<Variable> {
        match self {
            Filter::O2E {
                object,
                event,
                qualifier: _,
                filter_label: _,
            } => vec![Variable::Object(*object), Variable::Event(*event)]
                .into_iter()
                .collect(),
            Filter::O2O {
                object,
                other_object,
                qualifier: _,
                filter_label: _,
            } => vec![Variable::Object(*object), Variable::Object(*other_object)]
                .into_iter()
                .collect(),
            Filter::TimeBetweenEvents {
                from_event,
                to_event,
                min_seconds: _,
                max_seconds: _,
            } => vec![Variable::Event(*from_event), Variable::Event(*to_event)]
                .into_iter()
                .collect(),
            Filter::NotEqual { var_1, var_2 } => {
                vec![var_1.clone(), var_2.clone()].into_iter().collect()
            }
            Filter::EventAttributeValueFilter {
                event,
                attribute_name: _,
                value_filter: _,
            } => vec![Variable::Event(*event)].into_iter().collect(),
            Filter::ObjectAttributeValueFilter {
                object,
                attribute_name: _,
                at_time,
                value_filter: _,
            } => {
                let mut ret: HashSet<_> = vec![Variable::Object(*object)].into_iter().collect();
                if let ObjectValueFilterTimepoint::AtEvent { event } = at_time {
                    ret.insert(Variable::Event(*event));
                }
                ret
            }
            Filter::BasicFilterCEL { cel } => get_vars_in_cel_program(cel),
        }
    }
}

type DurationIntervalSeconds = (Option<f64>, Option<f64>);

#[derive(Debug, Clone)]
pub enum BindingStep {
    BindEv(
        EventVariable,
        Option<Vec<(EventVariable, DurationIntervalSeconds)>>,
    ),
    BindOb(ObjectVariable),
    /// Bind ob
    BindObFromEv(ObjectVariable, EventVariable, Qualifier),
    // bool: reversed?
    BindObFromOb(ObjectVariable, ObjectVariable, Qualifier, bool),
    BindEvFromOb(EventVariable, ObjectVariable, Qualifier),
    Filter(Filter),
}

//
// Display Implementations
//

impl Display for Binding {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "Binding [")?;
        write!(f, "\tEvents: {{ ")?;
        for (i, (ev_var, ev_index)) in self.event_map.iter().enumerate() {
            write!(f, "{ev_var} => {ev_index:?}")?;
            if i < self.event_map.len() - 1 {
                write!(f, ", ")?;
            }
        }
        write!(f, " }}\n\tObjects: {{ ")?;
        for (i, (ob_var, ob_index)) in self.object_map.iter().enumerate() {
            write!(f, "{ob_var} => {ob_index:?}")?;
            if i < self.object_map.len() - 1 {
                write!(f, ", ")?;
            }
        }
        write!(f, " }}")?;
        write!(f, "\n]")?;
        Ok(())
    }
}

impl Display for ObjectVariable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "o{}", self.0 + 1)
    }
}

impl Display for EventVariable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "e{}", self.0 + 1)
    }
}
