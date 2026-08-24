#!/usr/bin/env bash
# Switch `@r4pm/components` between the published npm release and a local propel checkout.
#
#   scripts/components-source.sh status
#   scripts/components-source.sh local [PATH_TO_PACKAGE]   # default ../propel/packages/components
#   scripts/components-source.sh npm                       # published, at whatever package.json pins
#   scripts/components-source.sh npm 0.3.2                 # published, pinning that version
#
# `frontend/` and `tauri/` both depend on the package and install separately, so a switch covers
# both. The repo root has a `pnpm-workspace.yaml` but no `package.json`, and pnpm never applies
# overrides from it; each project's own workspace file is what counts.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$PWD"

PKG='@r4pm/components'
BEGIN="# >>> local ${PKG} (scripts/components-source.sh) >>>"
END="# <<< local ${PKG} <<<"
WORKSPACES=("frontend/pnpm-workspace.yaml" "tauri/pnpm-workspace.yaml")
PROJECTS=("frontend" "tauri")

has_block() { grep -qF "$BEGIN" "$1"; }

strip_block() {
  python3 - "$1" "$BEGIN" "$END" <<'PY'
import sys, pathlib
path, begin, end = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
lines, out, skipping = path.read_text().splitlines(keepends=True), [], False
for line in lines:
    if line.strip() == begin:
        skipping = True
        continue
    if line.strip() == end:
        skipping = False
        continue
    if not skipping:
        out.append(line)
path.write_text("".join(out).rstrip("\n") + "\n")
PY
}

add_block() {
  local file="$1" target="$2"
  if grep -qE '^overrides:' "$file" && ! has_block "$file"; then
    echo "error: $file already defines 'overrides:'; merge by hand" >&2
    exit 1
  fi
  strip_block "$file"
  {
    echo ""
    echo "$BEGIN"
    echo "overrides:"
    echo "  '${PKG}': link:${target}"
    echo "$END"
  } >>"$file"
}

install_all() {
  for p in "${PROJECTS[@]}"; do
    echo "=== pnpm install in $p ==="
    (cd "$p" && pnpm install)
    # Vite pre-bundles dependencies into node_modules/.vite and does not notice that a linked one
    # changed underneath it, and a running dev server keeps serving the previous copy. Dropping the
    # cache makes the next start re-optimise.
    rm -rf "$p/node_modules/.vite"
  done
}

case "${1:-status}" in
  status)
    for i in "${!WORKSPACES[@]}"; do
      w="${WORKSPACES[$i]}"
      if has_block "$w"; then
        echo "${PROJECTS[$i]}: local -> $(grep -F "${PKG}': link:" "$w" | sed "s|.*link:||")"
      else
        echo "${PROJECTS[$i]}: npm (published)"
      fi
    done
    resolved=$(cd frontend && node -e "console.log(require('fs').realpathSync('node_modules/${PKG}'))" 2>/dev/null || echo "not installed")
    echo "installed at: $resolved"
    ;;
  local)
    target="${2:-$REPO/../propel/packages/components}"
    target="$(cd "$target" 2>/dev/null && pwd)" || {
      echo "error: no package at ${2:-$REPO/../propel/packages/components}" >&2
      exit 1
    }
    [ -f "$target/package.json" ] || { echo "error: $target has no package.json" >&2; exit 1; }
    # The published entry points resolve into dist/, and a link is only usable once it is built.
    echo "=== building $target ==="
    (cd "$target" && pnpm build)
    for w in "${WORKSPACES[@]}"; do add_block "$w" "$target"; done
    install_all
    echo
    echo "Now using the local checkout at $target."
    echo "Rebuild it (pnpm build there) after each change."
    echo "Restart any running vite dev server: it pre-bundles deps and will not see the change."
    echo "Switch back with: scripts/components-source.sh npm   (do this before committing)"
    ;;
  npm)
    want="${2:-}"
    if [ "$want" = "latest" ]; then
      # `minimumReleaseAge` filters a fresh release out of range resolution, so a tag silently
      # resolves to the previous version. An exact version skips that.
      echo "error: name an exact version, e.g. $0 npm 0.3.2" >&2
      exit 2
    fi
    for w in "${WORKSPACES[@]}"; do strip_block "$w"; done
    if [ -n "$want" ]; then
      # `pnpm up` rewrites the dependency range in each package.json, which a plain install would not.
      for p in "${PROJECTS[@]}"; do
        echo "=== $p -> ${PKG}@${want} ==="
        (cd "$p" && pnpm up "${PKG}@${want}")
      done
    fi
    install_all
    echo
    echo "Back on the published ${PKG}. Restart any running vite dev server."
    ;;
  *)
    echo "usage: $0 <status|local [PATH]|npm [VERSION]>" >&2
    exit 2
    ;;
esac
