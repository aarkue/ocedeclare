//! Fixpoint tests for query evaluation. Every file in `tests/queries` pairs a `BindingBoxTree`
//! with the per-node result it must produce against a fixture log.
//!
//! Add a regression case by dropping in a file with `expected` omitted, then run
//! `UPDATE_EXPECTED=1 cargo test -p ocpq-core --test query_corpus` to fill it in and eyeball the
//! numbers before committing. `CASE=<substring>` narrows a run to one case.

mod common;

use common::{
    case_files, case_filter, case_name, fixture, load_case, summarize, write_expected, NodeResult,
};
use ocpq_core::binding_box::evaluate_box_tree;

#[test]
fn corpus_matches_expected_results() {
    let update = std::env::var("UPDATE_EXPECTED").is_ok_and(|v| v == "1");
    let filter = case_filter();
    let mut failures: Vec<String> = Vec::new();
    let mut checked = 0usize;

    for path in case_files() {
        let name = case_name(&path);
        if filter.as_ref().is_some_and(|f| !name.contains(f)) {
            continue;
        }
        let case = load_case(&path);
        let ocel = fixture(&case.ocel);
        let result = match evaluate_box_tree(case.tree.clone(), &ocel, false) {
            Ok(r) => r,
            Err(e) => {
                failures.push(format!("{name}: evaluation failed: {e}"));
                continue;
            }
        };
        let actual = summarize(&result);

        match (&case.expected, update) {
            (_, true) => write_expected(&path, &actual),
            (None, false) => failures.push(format!(
                "{name}: no `expected` block; run UPDATE_EXPECTED=1 to record one"
            )),
            (Some(expected), false) => {
                checked += 1;
                if expected != &actual {
                    failures.push(format!("{name}:\n{}", diff(expected, &actual)));
                }
            }
        }
    }

    assert!(
        failures.is_empty(),
        "{} corpus case(s) failed:\n\n{}",
        failures.len(),
        failures.join("\n\n")
    );
    if !update {
        assert!(checked > 0, "case filter {filter:?} matched nothing");
    }
}

fn diff(expected: &[NodeResult], actual: &[NodeResult]) -> String {
    if expected.len() != actual.len() {
        return format!(
            "  node count: expected {}, got {}",
            expected.len(),
            actual.len()
        );
    }
    expected
        .iter()
        .zip(actual)
        .enumerate()
        .filter(|(_, (e, a))| e != a)
        .map(|(i, (e, a))| format!("  node {i}: expected {e:?}\n           got      {a:?}"))
        .collect::<Vec<_>>()
        .join("\n")
}
