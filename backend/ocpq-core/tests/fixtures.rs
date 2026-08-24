//! Guards the committed logs themselves: a fixture that silently fails to import, or that gets
//! regenerated at a different scale, shows up here instead of as a wall of corpus diffs.

mod common;

use common::fixture;
use ocpq_core::OCELInfo;

#[test]
fn fixtures_import_at_the_expected_scale() {
    // (file, objects, events, object types, event types)
    let expected = [
        ("order-management.xml.gz", 10840, 21008, 6, 11),
        ("p2p.xml.gz", 9543, 14671, 7, 10),
        ("bpic2017.xml.gz", 106162, 1202267, 4, 26),
        ("edge-cases.json", 8, 10, 2, 4),
    ];
    for (name, objects, events, ob_types, ev_types) in expected {
        let info = OCELInfo::from(&*fixture(name));
        println!(
            "(\"{name}\", {}, {}, {}, {}),",
            info.num_objects,
            info.num_events,
            info.object_types.len(),
            info.event_types.len()
        );
        assert_eq!(
            (
                info.num_objects,
                info.num_events,
                info.object_types.len(),
                info.event_types.len()
            ),
            (objects, events, ob_types, ev_types),
            "{name}"
        );
    }
}
