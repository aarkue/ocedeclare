#!/usr/bin/env bash
# Local test runner. `scripts/test.sh` runs the fast groups; pass group names to pick.
#
#   ./scripts/test.sh                 rust, unit, types, lint
#   ./scripts/test.sh e2e             drives the real Tauri app (rebuilds it first, several minutes)
#
# `e2e` is not in the default set because it rebuilds the desktop binary with --features wdio, which
# also invalidates the normal release build's cache.
set -euo pipefail
cd "$(dirname "$0")/.."

# The query corpus evaluates a 1.2M-event log; unoptimised that takes minutes instead of seconds.
CARGO_TEST=(cargo test --workspace --release)

run_rust()  { "${CARGO_TEST[@]}"; }
# `tauri/` has no tests of its own: its `src` aliases to `frontend/src`, which vitest already covers.
run_unit()  { (cd frontend && pnpm vitest run); }
run_types() { (cd frontend && pnpm tsc --noEmit); (cd tauri && pnpm tsc --noEmit); }
run_lint()  { (cd frontend && pnpm biome check ./src); cargo clippy --workspace --release -- -D warnings; }
run_e2e()   { (cd e2e && pnpm install --frozen-lockfile && pnpm build:app && pnpm test); }

groups=("${@:-rust unit types lint}")
# shellcheck disable=SC2068
for g in ${groups[@]}; do
  echo "=== $g ==="
  case "$g" in
    rust)  run_rust ;;
    unit)  run_unit ;;
    types) run_types ;;
    lint)  run_lint ;;
    e2e)   run_e2e ;;
    *) echo "unknown group: $g (rust|unit|types|lint|e2e)" >&2; exit 2 ;;
  esac
done
