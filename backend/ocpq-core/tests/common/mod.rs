//! Shared plumbing for the integration tests: fixture logs and the query-corpus case format.
// Compiled separately into each test binary, so anything only one of them uses reads as dead here.
#![allow(dead_code)]

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};

use ocpq_core::{
    binding_box::{BindingBoxTree, EvaluateBoxTreeResult, ViolationReason},
    process_mining::{
        core::event_data::object_centric::linked_ocel::SlimLinkedOCEL, Importable, OCEL,
    },
};
use serde::{Deserialize, Serialize};

pub fn tests_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests")
}

/// Importing `order-management` takes long enough that re-reading it per case would dominate the
/// run, so each fixture is parsed once and shared across every test in the binary.
pub fn fixture(name: &str) -> Arc<SlimLinkedOCEL> {
    static CACHE: OnceLock<Mutex<BTreeMap<String, Arc<SlimLinkedOCEL>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Mutex::default);
    if let Some(hit) = cache.lock().unwrap().get(name) {
        return Arc::clone(hit);
    }
    let path = tests_dir().join("data").join(name);
    let ocel = Arc::new(
        SlimLinkedOCEL::import_from_path(&path)
            .unwrap_or_else(|e| panic!("import fixture {}: {e:?}", path.display())),
    );
    cache
        .lock()
        .unwrap()
        .insert(name.to_string(), Arc::clone(&ocel));
    ocel
}

/// The same fixture as a plain `OCEL`, for tests that need to re-export it.
pub fn fixture_ocel(name: &str) -> OCEL {
    let path = tests_dir().join("data").join(name);
    OCEL::import_from_path(&path)
        .unwrap_or_else(|e| panic!("import fixture {}: {e:?}", path.display()))
}

/// One corpus case: a tree, the log to run it against, and the result it must produce.
#[derive(Deserialize)]
pub struct Case {
    #[allow(dead_code)]
    pub description: String,
    pub ocel: String,
    pub tree: BindingBoxTree,
    /// Absent until `UPDATE_EXPECTED=1` fills it in.
    pub expected: Option<Vec<NodeResult>>,
    /// Cases whose SQL translation is not expected to match the engine, with the reason why.
    #[serde(default)]
    pub sql_differs: Option<String>,
}

/// Per-node fixpoint. `reasons` is a histogram over violation reasons, keyed including the payload,
/// A box with several constraints therefore fails here if the wrong one starts firing.
#[derive(Serialize, Deserialize, PartialEq, Eq, Debug)]
pub struct NodeResult {
    pub situations: usize,
    pub violated: usize,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub reasons: BTreeMap<String, usize>,
}

pub fn case_files() -> Vec<PathBuf> {
    let dir = tests_dir().join("queries");
    let mut files: Vec<PathBuf> = fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("read {}: {e}", dir.display()))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no cases in {}", dir.display());
    files
}

pub fn load_case(path: &Path) -> Case {
    let raw = fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()))
}

pub fn case_name(path: &Path) -> String {
    path.file_stem().unwrap().to_string_lossy().into_owned()
}

/// `CASE=<substring>` narrows a run to the matching cases.
pub fn case_filter() -> Option<String> {
    std::env::var("CASE").ok().filter(|s| !s.is_empty())
}

pub fn summarize(result: &EvaluateBoxTreeResult) -> Vec<NodeResult> {
    result
        .evaluation_results
        .iter()
        .map(|r| {
            let mut reasons: BTreeMap<String, usize> = BTreeMap::new();
            for (_, reason) in &r.situations {
                if let Some(reason) = reason {
                    *reasons.entry(reason_key(reason)).or_default() += 1;
                }
            }
            NodeResult {
                situations: r.situation_count,
                violated: r.situation_violated_count,
                reasons,
            }
        })
        .collect()
}

/// Matched, not derived from serde, so the corpus files do not silently change meaning if
/// the wire representation of `ViolationReason` ever does. The payload of the parameterised
/// variants is part of the key: `ConstraintNotSatisfied` carries the index of the constraint that
/// failed, which is the difference between "some constraint fired" and "the right one did".
///
/// Today the engine only ever produces `ConstraintNotSatisfied`; the other nine variants survive in
/// the type (and in the generated TS) but nothing constructs them.
fn reason_key(reason: &ViolationReason) -> String {
    match reason {
        ViolationReason::TooFewMatchingEvents(n) => format!("TooFewMatchingEvents({n})"),
        ViolationReason::TooManyMatchingEvents(n) => format!("TooManyMatchingEvents({n})"),
        ViolationReason::ConstraintNotSatisfied(i) => format!("ConstraintNotSatisfied({i})"),
        ViolationReason::NoChildrenOfORSatisfied => "NoChildrenOfORSatisfied".into(),
        ViolationReason::LeftChildOfANDUnsatisfied => "LeftChildOfANDUnsatisfied".into(),
        ViolationReason::RightChildOfANDUnsatisfied => "RightChildOfANDUnsatisfied".into(),
        ViolationReason::BothChildrenOfANDUnsatisfied => "BothChildrenOfANDUnsatisfied".into(),
        ViolationReason::ChildrenOfNOTSatisfied => "ChildrenOfNOTSatisfied".into(),
        ViolationReason::ChildNotSatisfied => "ChildNotSatisfied".into(),
        ViolationReason::UnknownChildSet => "UnknownChildSet".into(),
    }
}

/// Rewrite only the `expected` key, leaving the tree and prose in the file untouched.
pub fn write_expected(path: &Path, expected: &[NodeResult]) {
    let raw = fs::read_to_string(path).unwrap();
    let mut doc: serde_json::Value = serde_json::from_str(&raw).unwrap();
    doc.as_object_mut()
        .expect("case file must be an object")
        .insert("expected".into(), serde_json::to_value(expected).unwrap());
    let mut out = serde_json::to_string_pretty(&doc).unwrap();
    out.push('\n');
    fs::write(path, out).unwrap_or_else(|e| panic!("write {}: {e}", path.display()));
}
