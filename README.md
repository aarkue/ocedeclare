# OCPQ (Object-Centric Process Querying)

[Download the latest release](https://github.com/aarkue/ocpq/releases/latest), or see
[ocpq.aarkue.eu](https://ocpq.aarkue.eu) for guides, examples, and documentation.

## Installation

Installers are cross-compiled for each release and published at
[github.com/aarkue/ocpq/releases/latest](https://github.com/aarkue/ocpq/releases/latest):

| file | platform |
| --- | --- |
| `[...].AppImage` | Linux, recommended |
| `[...]-setup.exe` | Windows, recommended |
| `[...].dmg` | macOS, recommended |
| `[...].deb` | Linux (Debian) |
| `[...].msi` | Windows |
| `[...].app.tar.gz` | macOS |

Windows Defender sometimes flags Tauri-packaged installers as a threat. The warning is a false
positive, see https://github.com/tauri-apps/tauri/issues/2486. Try a different variant (`.exe`
instead of `.msi`) or run it under Docker.

### Docker

Docker builds and runs the project locally, starting the backend web server and serving the
frontend. Open [http://localhost:4567/](http://localhost:4567/) once the containers are up.

Run `docker compose up --build` in the project root, or build the two images separately:

- backend, with the repo root as build context so the Cargo workspace paths resolve:
  1. `docker build -f backend/Dockerfile -t ocpq-backend .`
  2. `docker run --init -p 3000:3000 ocpq-backend`
- frontend:
  1. `docker build ./frontend -t ocpq-frontend`
  2. `docker run --init -p 4567:4567 ocpq-frontend`

Paths resolve inside the container, so OCPQ can only load files exposed to it, e.g., through a
mounted folder.

## Usage

OCPQ reads OCEL 2.0 logs as JSON, XML, SQLite, CSV and ZIP, plus XES, which it interprets with the
single object type `Case`. The examples on the website use the order management log from
https://zenodo.org/records/8428112.

[ocpq.aarkue.eu](https://ocpq.aarkue.eu) walks through building queries, filter predicates and
constraints, discovering constraints automatically, and the OC-DECLARE editor.

Queries are not saved automatically. Press the save button in the editor to keep one across reloads.

## Development

OCPQ needs `cargo` and `pnpm`, so install Rust and Node first. Then install the dependencies, e.g.,
with `pnpm i` inside `frontend/`.

### Layout

The repository is a Cargo workspace:

- `backend/ocpq-core`: the query engine. Binding boxes, evaluation, OC-DECLARE, and the SQL/Cypher translation.
- `backend/app-bindings`: every function a frontend can reach, as `#[register_binding]` wrappers over `ocpq-core`.
- `backend/backend-shared`: the glue each target shares, including binding dispatch and the loaded-object registry.
- `backend/ocpq-native`: the parts needing a live OS, such as the tokio runtime and an SSH session to an HPC cluster.
- `backend/web-server`: axum process that serves the frontend and exposes the bindings over HTTP.
- `backend/wasm`: the same entry points compiled for the browser.
- `backend/ocpq_cli`: standalone CLI, see below.
- `backend/meta-gen`: dumps the binding registry metadata to JSON for the frontend codegen.

The frontend lives in `frontend/`, the desktop app in `tauri/`, and the end-to-end suite in `e2e/`.

### Running it

For the web application, start the backend with `cargo run --release` in `backend/web-server`, and
the frontend with `pnpm run dev` in `frontend/`. The backend listens on `http://localhost:3000` and
the frontend on `http://localhost:5173/`.

The desktop app uses [tauri](https://tauri.app/). Run `pnpm run tauri dev -- --release` inside
`tauri/`.

### CLI

Evaluate a `BindingBoxTree` against an OCEL file:

```sh
cargo run --release -p ocpq_cli -- evaluate --ocel <path> --bbox-tree <path>
```

Translate a `BindingBoxTree`, the JSON the frontend exports, to SQL or Cypher (experimental):

```sh
cargo run --release -p ocpq_cli -- translate --tree <path> --target sqlite|duckdb|cypher \
  [--mappings <path>] [--output <path>]
```

`--mappings` maps OCEL event and object types to table or graph-label names, e.g.,
`{"event_tables": {"pick item": "pickitem"}, "object_tables": {}}`. A type with no entry keeps its
raw name.

### Tests

`scripts/test.sh` runs the groups, or pass names to pick some:

```sh
./scripts/test.sh              # rust, unit, types, lint
./scripts/test.sh rust unit    # just those two
./scripts/test.sh e2e          # drives the real desktop app, rebuilds it first
```

| group | what it runs |
| --- | --- |
| `rust` | `cargo test --workspace --release`, including the query corpus |
| `unit` | vitest in `frontend/` |
| `types` | `tsc --noEmit` for `frontend/` and `tauri/` |
| `lint` | biome on the frontend plus `cargo clippy -D warnings` |
| `e2e` | the WebDriver suite in `e2e/` |

The `rust` group runs in release because the corpus evaluates a 1.2M-event log, which takes minutes
unoptimised and seconds otherwise.

Most of the Rust coverage is a query corpus under `backend/ocpq-core/tests/queries`. Each case is a
JSON file holding a `BindingBoxTree`, the fixture log to run it against, and the expected situation
and violation counts. Adding a regression means dropping in a file:

```sh
UPDATE_EXPECTED=1 cargo test -p ocpq-core --release --test query_corpus   # record the counts
CASE=orders-price cargo test -p ocpq-core --release --test query_corpus   # run a subset
```

`tests/fixtures.rs` pins each fixture log's scale, so a corrupt or regenerated file fails there
instead of as a wall of unexplained corpus diffs. `tests/plan_invariance.rs` re-runs every case with
its filters permuted, since filter order is presentation and must not change a result.

`e2e/` drives the real desktop app through WebDriver, with the shipped frontend talking to the real
engine. [`e2e/README.md`](e2e/README.md) covers how it gets a log into the app, why it needs Xvfb,
and what each spec asserts.

### Shared UI components (`@r4pm/components`)

The visualisations come from the published `@r4pm/components` package: OC-DECLARE, the charts, and
the extraction-blueprint editor. To try a change to that package before releasing it, point the repo
at a local checkout:

```sh
scripts/components-source.sh status          # which source is in use
scripts/components-source.sh local           # link ../propel/packages/components
scripts/components-source.sh local /path/to/propel/packages/components
scripts/components-source.sh npm             # published, at whatever package.json pins
scripts/components-source.sh npm 0.3.2       # published, pinning that version
```

Passing a version to `npm` rewrites the dependency range in both `package.json` files, which is what
you want after publishing a release. Without one it installs whatever they already allow. Name an
exact version: both projects set `minimumReleaseAge`, which filters a same-day release out of range
resolution, so a tag like `latest` quietly resolves to the previous version.

`local` builds the package first, because the entry points resolve into its `dist/`. Rebuild it
after every edit (`pnpm build` in that folder) and rebuild the app. The link points at the package
directory, not at its sources, and nothing arrives until the rebuild.

Restart any running dev server after switching. Vite pre-bundles dependencies and does not notice a
linked one changing underneath it. The script clears `node_modules/.vite` so the next start
re-optimises, and both vite configs skip pre-bundling the package while it is linked.

`frontend/` and `tauri/` install separately and both depend on the package, so the script writes a
`pnpm` override into each one's `pnpm-workspace.yaml` and reinstalls both. The repo-root
`pnpm-workspace.yaml` has no `package.json` beside it, and pnpm never applies overrides from there.

Switching leaves a marked block in those two files. Run `scripts/components-source.sh npm` before
committing, unless you mean to check the link in.

Vite prints a few warnings when running or building the frontend. They come from the offline copy of
the monaco editor used for writing CEL scripts. Removing or updating `initEditorLoader` in
`editor-loader.ts` switches to an online copy, at the cost of needing a connection to edit.

### Backend context

OCPQ runs against several backends, so `BackendProvider` in
`frontend/src/BackendProviderContext.ts` abstracts what they expose. That type lists the available
functionality with its parameters and return types.

Two implementations exist. `getAPIServerBackendProvider`, in the same file, fetches the routes
defined in `backend/web-server/src/main.rs`. `tauriBackend`, in `tauri/src/main.tsx`, invokes the
commands in `tauri/src-tauri/src/main.rs`.

The frontend reaches a backend through the context: `const backend = useContext(BackendProviderContext);`,
then `backend['function_name'](parameters, ...)`.

To add functionality, declare the call in the `BackendProvider` type. Implement it in
`backend/ocpq-core` and expose it with a `#[register_binding]` wrapper in `backend/app-bindings`.
Wire it up in the web server and tauri backends, then add the field to both `BackendProvider`
implementations.
