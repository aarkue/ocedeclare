# End-to-end tests

Drives the real desktop app: the shipped React frontend inside WebKitGTK, talking to the real Rust
engine over Tauri IPC. No mocks anywhere.

```sh
./scripts/test.sh e2e      # builds the app, then runs both suites
cd e2e && pnpm test        # both suites, against an already-built binary
cd e2e && pnpm test:p2p    # just the p2p run
```

The app holds one OCEL for its whole lifetime, and every spec in a run shares that process. There is
one run per fixture log: `specs/` against order-management, `specs-p2p/` against p2p.

## How the app gets a log

WebDriver cannot drive a native file dialog, which is the normal way in. On Linux the app turns
non-flag argv entries into `initial_files` and imports the first one at startup, so the suite passes
`backend/ocpq-core/tests/data/order-management.xml.gz` as `appArgs`. The counts the specs assert are
the ones `ocpq-core/tests/fixtures.rs` pins, so a mismatch here points at the frontend or the binding
layer, not the log.

## The wdio feature

`tauri-plugin-wdio-webdriver` embeds the WebDriver server in the app, behind the `wdio` cargo
feature. `tauri.conf.test.json` supplies the `withGlobalTauri` and capability changes it needs. A
release build enables none of that:

```sh
pnpm tauri build                                                            # ships this
pnpm tauri build --features wdio --config src-tauri/tauri.conf.test.json    # tested binary
```

Register both plugins *after* `tauri-plugin-log`, which panics if anything claimed the global logger
before it.

Building with the feature makes `tauri-build` write the wdio permissions into the tracked files under
`src-tauri/gen/schemas`. `build:app` restores them afterwards; they are generated, and the built
binary has already embedded what it needs.

The service's startup diagnostics report `tauri-driver not found` as an error, next to an
apt-install hint. Its check drops the `driverProvider` option and always tests for the external
driver. The run itself skips that check and logs `Using embedded WebDriver provider`. Do not fix it
with `autoInstallTauriDriver`, which compiles a binary nothing launches.

## Catching what unit tests cannot

Every spec asserts zero console errors. WebKitGTK has no `getLogs('browser')`, so
`helpers/console-errors.ts` patches `console.error` and the `error` and `unhandledrejection`
listeners in the page. This is the layer that catches a component which throws only once React mounts
it, e.g., a bundling regression that hands React a module object instead of a component.

Specs share one app process, so each starts with `goto()` and puts the app on a known route.
Reloading is safe: The OCEL lives in the Rust registry, not the page.

## What the specs cover

A case in `ocpq-core/tests/queries` pins every evaluated count below. A divergence means the frontend
serialised the query differently or the IPC layer mangled it, not that the engine changed.

| spec | builds | asserts |
| --- | --- | --- |
| `filter-editors` | a box with two object and two event variables | all twelve filter editors render |
| `query-editor` | one box, then an object-attribute predicate | 2,000 orders, then 1,462 with `price >= 1000` |
| `query-predicates` | three separate queries | 538 violations from a constraint, 225/15 for NotEqual, 170 for CEL |
| `query-relations` | one box, two object variables, O2O | 7,659 order/item pairs |
| `query-tree` | root -> child -> grandchild, then a second child | 443 orders with a payment reminder |
| `query-child-sets` | a child with a projection, then two sibling children | 1,008 orders with 1-3 items; 443 violations comparing two child sets |
| `ocel-info` | nothing; reads the loaded log | fixture counts, and an attribute chart renders |
| `navigation` | nothing | every route mounts without logging an error |
| `specs-p2p/event-attributes` | one box, a three-type event variable | 2,525 as a filter, 1,941 violations as a constraint |

Ten of the twelve filter types are driven all the way to a number: object attribute, event attribute,
E2O, O2O, NotEqual, CEL, child count (CBS), projected count (CBPS) and sets equal (CBE). Advanced CEL
and projected equal (CBPE) are render-checked only. The corpus covers both, CBPE in
`om-confirmed-items-match-order-items`.

`query-predicates` is the only spec that adds a constraint, which makes it the only coverage of
violation counting. It reuses the `price >= 1000` predicate from `query-editor`, so the two
cross-check: 2000 - 1462 = 538 violations.

Event-attribute filters live in the p2p run because no event type in `order-management` declares an
attribute. In p2p, `lifecycle` is the same value on all 14,671 events, and `resource` is a pure
function of event type. A resource filter therefore only discriminates across a variable bound to
several types at once, which is what the spec builds.

## Typing into the editors

Two inputs need more than `setValue`.

The numeric range comes from two different components that share `placeholder="min"`: propel's
`AttributeValueStats` once the attribute stats resolve, and OCPQ's own `NumberRangeInput` before they
do. The first redraws a Plotly histogram on every keystroke, React commits lag the typing, and
characters get dropped. Which one is on screen depends on whether an earlier spec warmed the query
cache, so the same spec can pass alone and fail in the suite. `setNumberInput` retypes until the
value survives two reads.

The CEL box is Monaco. Session-level `browser.keys` interleaves with the existing text, element
`addValue` types cleanly but rejects special keys and so cannot select-all, and `setValue` clears the
textarea without clearing Monaco's model. `setCelExpression` types, then deletes one character at a
time until the rendered text matches.

## Two editor behaviours to know about

A relational filter opens with its variables unset when no combination of the box's variables has any
relation in the log: blank pickers, "0 Supporting Relations", and a disabled submit with nothing
saying why. `query-child-sets` hits this on purpose. Its second child binds out-of-stock events,
which never attach to an order, and it picks the variables positionally.

Sibling boxes each scope their own `e1`. The corpus mirror of that query therefore uses event
variable 0 in both children.

## Building child boxes

`addChildOf` drags from a node's source handle onto empty canvas, which is how the editor creates a
child box and its edge in one gesture. Three details make it reliable:

- Fit the view and zoom out first. Nodes drift outside the pane as the tree grows and their client
  coordinates go negative, and a coordinate-based drag then misses entirely.
- Wait for the node to stop moving. Adding a variable resizes the box and the editor re-fits;
  measuring mid-animation reads coordinates from halfway through the transition.
- Split the drag across three `perform()` calls. WebDriver dispatches a single batched action faster
  than React Flow processes it, and the connection never starts.

## Timing

The engine is not the slow part. Measured through the app's own IPC on the release binary, with
order-management loaded:

| | |
| --- | --- |
| evaluate a one-box query over 2,000 orders | 4 ms |
| `ocel_info` | 22 ms |
| click "Evaluate" to the count on screen | 145 ms |
| one `browser.execute` round trip | 7 ms |
| full page reload (the bundle is ~11 MB) | ~3.6 s |

A spec's time is page reloads, drag choreography and WebDriver round trips, never the query.
`waitforInterval` is 50ms because the 500ms default turns a 145ms result into seconds of polling, and
`freshQuery` reloads once for the same reason.

## Why Xvfb, and why GDK_BACKEND=x11

Both change whether the app renders at all.

GTK picks Wayland from the inherited `WAYLAND_DISPLAY`, never receives frame callbacks, and WebKit
parks its rendering loop. Measured in that state: `requestAnimationFrame` fired 0 times in three
seconds, `ResizeObserver` never fired, React Flow left every node `visibility: hidden` because it
could not measure them, and the WebDriver Actions API delivered no input at all. The suite still
passes in that state, because mounting a component needs no frame. Anything that measures or drags
does.

Xvfb keeps the window unoccluded. On a real desktop the window opens behind whatever else is there,
`document.hidden` flips to true, and the rendering loop parks for the same reason.

## Claiming the window

`goto()` calls `browser.tauri.switchWindow("main")` once per session. The service probes window
focus before every `$`, `$$` and click, through an IPC bridge that only exists if the app imports
`@wdio/tauri-plugin`. Each probe then waits out a 5s timeout: measured, five `$` calls take 100s.
After the switch, the same five take 25ms.

`claimWindow` also points `window.__wdio_original_core__` at the real `__TAURI__.core` that
`withGlobalTauri` already exposes. That is the bridge the frontend plugin installs, and every service
call to Tauri waits out a hardcoded 5s timeout without it, once per spec file.

Taking the plugin would put a test dependency in the app's entry point. OCPQ has one window and no
spec calls `browser.tauri.*` beyond this, so the switch wins. The service still logs
`Failed to get window states` at teardown. That one is cosmetic.
