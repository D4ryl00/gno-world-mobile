#!/usr/bin/env bash
# A local chain to play on (Settings → Local gnodev): gnodev built from the gno revision gnonative pins (the
# gno.land mainnet line, so the realms deployed there type-check), with every Bubble Rumble realm — v1–v5,
# bubble, wbubble — and their dependencies fetched from gno.land. RPC on 127.0.0.1:26657.
# Extra arguments go to gnodev (e.g. -node-rpc-listener 127.0.0.1:46658). Needs network access at start.
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

NS=gno.land/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr
PATHS=$NS/bubblerumble,$NS/bubblerumble2,$NS/bubblerumble3,$NS/bubblerumble4,$NS/bubblerumble5,$NS/bubble,$NS/wbubble

mkdir -p "$E/gnohome"
exec "$BIN" local -home "$E/gnohome" -no-web -no-watch -empty-blocks \
  -remote gno.land=https://rpc.gno.land:443 -paths "$PATHS" "$@"
