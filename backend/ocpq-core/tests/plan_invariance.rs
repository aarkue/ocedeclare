//! Filters inside a box are conjunctive, so their order is presentation, not meaning. The binding
//! planner still reads that order when choosing which variable to bind first, and a plan bug
//! shows up as a result that depends on how the user happened to arrange the filter list.
//!
//! Runs over the whole query corpus, not a bespoke tree, which puts every shape the corpus covers
//! through every filter permutation.

mod common;

use common::{case_files, case_filter, case_name, fixture, load_case, summarize};
use ocpq_core::binding_box::{
    evaluate_box_tree, structs::BindingBoxTreeNode, BindingBoxTree,
};

/// Deterministic permutations, not random ones: a failure has to be reproducible from the
/// case name alone. Reversing and rotating between them move every filter off its original index.
fn permute(tree: &BindingBoxTree, how: Permutation) -> BindingBoxTree {
    let mut out = tree.clone();
    for node in &mut out.nodes {
        if let BindingBoxTreeNode::Box(bbox, _) = node {
            match how {
                Permutation::Reverse => bbox.filters.reverse(),
                Permutation::Rotate => {
                    if !bbox.filters.is_empty() {
                        bbox.filters.rotate_left(1);
                    }
                }
            }
        }
    }
    out
}

#[derive(Clone, Copy, Debug)]
enum Permutation {
    Reverse,
    Rotate,
}

#[test]
fn results_do_not_depend_on_filter_order() {
    let filter = case_filter();
    let mut failures = Vec::new();
    let mut checked = 0usize;

    for path in case_files() {
        let name = case_name(&path);
        if filter.as_ref().is_some_and(|f| !name.contains(f)) {
            continue;
        }
        let case = load_case(&path);
        // Nothing to permute, and re-evaluating would only re-assert the corpus.
        let permutable = case.tree.nodes.iter().any(|n| match n {
            BindingBoxTreeNode::Box(b, _) => b.filters.len() > 1,
            _ => false,
        });
        if !permutable {
            continue;
        }
        let ocel = fixture(&case.ocel);
        let baseline = match evaluate_box_tree(case.tree.clone(), &ocel, false) {
            Ok(r) => summarize(&r),
            Err(e) => {
                failures.push(format!("{name}: baseline evaluation failed: {e}"));
                continue;
            }
        };
        for how in [Permutation::Reverse, Permutation::Rotate] {
            checked += 1;
            match evaluate_box_tree(permute(&case.tree, how), &ocel, false) {
                Ok(r) => {
                    let got = summarize(&r);
                    if got != baseline {
                        failures.push(format!(
                            "{name} under {how:?}:\n  baseline {baseline:?}\n  permuted {got:?}"
                        ));
                    }
                }
                Err(e) => failures.push(format!("{name} under {how:?}: evaluation failed: {e}")),
            }
        }
    }

    assert!(
        failures.is_empty(),
        "{} permutation(s) changed the result:\n\n{}",
        failures.len(),
        failures.join("\n\n")
    );
    assert!(checked > 0, "no case had more than one filter to permute");
}
