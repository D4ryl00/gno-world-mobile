#!/usr/bin/env bash
# A local chain to play on (Settings → Local gnodev): gnodev built from the gno revision gnonative pins (the
# gno.land mainnet line, so the realms deployed there type-check), loading every gno.world realm — v1–v6,
# bubble, wbubble — and their dependencies from devchain/ (a copy of what gno.land runs; refresh it with
# npm run devchain:update). Works offline once gnodev is built. RPC on 127.0.0.1:26657.
# Extra arguments go to gnodev (e.g. -node-rpc-listener 127.0.0.1:46658).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
E=$ROOT/.e2e
GNO=${GNO:-$HOME/gno}
GNONATIVE=${GNONATIVE:-$HOME/gnonative}

# The revision in gnonative's pseudo-version (…-<12 hex>), unless GNO_REV is given.
GNO_REV=${GNO_REV:-$(sed -n 's|^[[:space:]]*github.com/gnolang/gno v[^ ]*-\([0-9a-f]\{12\}\)$|\1|p' "$GNONATIVE/go.mod" | head -1)}
[ -n "$GNO_REV" ] || { echo "cannot read the gno revision from $GNONATIVE/go.mod; set GNO_REV" >&2; exit 1; }

BIN=$E/bin/gnodev-$GNO_REV
if [ ! -x "$BIN" ]; then
  git -C "$GNO" cat-file -e "$GNO_REV^{commit}" 2>/dev/null ||
    { echo "$GNO has no commit $GNO_REV: run git -C $GNO fetch --all" >&2; exit 1; }
  echo "building gnodev at $GNO_REV (once)…"
  SRC=$(mktemp -d)
  trap 'rm -rf "$SRC"' EXIT
  git -C "$GNO" archive "$GNO_REV" | tar -x -C "$SRC" # leaves the ~/gno checkout untouched
  mkdir -p "$E/bin"
  (cd "$SRC/contribs/gnodev" && go build -o "$BIN" .)
fi

[ -d "$ROOT/devchain/gno.land" ] || { echo "devchain/ is missing: run npm run devchain:update" >&2; exit 1; }

# -C: run from devchain so no other workspace is picked up; -no-examples: everything comes from devchain/
# GNODEV_WEB=1 keeps gnoweb (127.0.0.1:8888, -web-listener to move it), for the demo video's realm shot.
WEB=(-no-web)
[ "${GNODEV_WEB:-}" = 1 ] && WEB=()
mkdir -p "$E/gnohome"
exec "$BIN" local -C "$ROOT/devchain" -home "$E/gnohome" ${WEB[@]+"${WEB[@]}"} -no-watch -empty-blocks \
  -no-examples -extra-root "$ROOT/devchain" "$@"
