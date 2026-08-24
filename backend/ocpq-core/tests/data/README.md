# Fixture logs

Committed as `.xml.gz` because OCEL 2.0 XML compresses roughly 20:1, which keeps real logs small
enough to live in the repo. `tests/fixtures.rs` pins each one's scale, so a corrupt or regenerated
file fails there instead of as a wall of unexplained corpus diffs.

| file | events | objects | object types |
| --- | --- | --- | --- |
| `order-management.xml.gz` | 21,008 | 10,840 | orders, items, packages, customers, products, employees |
| `p2p.xml.gz` | 14,671 | 9,543 | purchase requisition, quotation, invoice receipt, ... |
| `bpic2017.xml.gz` | 1,202,267 | 106,162 | Application, Offer, Workflow, Case_R |

`order-management` and `p2p` are the OCEL 2.0 sample logs from <https://www.ocel-standard.org/>,
gzipped unchanged.

`bpic2017` is the BPI Challenge 2017 handoff export with every `<attributes>` payload stripped. No
query in the corpus reads a BPIC2017 attribute, and dropping them takes the log from 1.4 GB to
311 MB uncompressed (15 MB gzipped). Event and object identities, types, timestamps and
relationships are untouched, so the counts below are the real ones.

Importing `p2p` prints `dropping O2O reference to unknown object id "invoice receipt:..."`. That is
the published log's own dangling references, not damage from packaging it here.
