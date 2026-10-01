#!/usr/bin/env bash
# End-to-end: gnodev (gno from ~/gno) with bubblerumble5, gnonative goserver (from ~/gnonative feat/sign-bytes),
# gnokey as the desktop signer. Ports 46657 (node) and 46660 (goserver) must be free.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
E=$ROOT/.e2e
GNO=${GNO:-$HOME/gno}
GNONATIVE=${GNONATIVE:-$HOME/gnonative}
mkdir -p "$E/bin" "$E/home"
rm -rf "$E/gnohome" "$E/goroot"
mkdir -p "$E/gnohome" "$E/goroot"

(cd "$GNO" && go build -o "$E/bin/gnokey" ./gno.land/cmd/gnokey)
(cd "$GNO/contribs/gnodev" && go build -o "$E/bin/gnodev" .)
# gnonative pins an older gno; build the goserver against $GNO so it decodes the node's events (bank.TransferEvent).
# A throwaway modfile keeps ~/gnonative untouched.
cp "$GNONATIVE/go.mod" "$E/goserver.mod"; cp "$GNONATIVE/go.sum" "$E/goserver.sum"
(cd "$GNONATIVE" && go mod edit -modfile="$E/goserver.mod" -replace "github.com/gnolang/gno=$GNO" \
  && go mod tidy -modfile="$E/goserver.mod" >/dev/null 2>&1 \
  && go build -modfile="$E/goserver.mod" -o "$E/bin/goserver" ./goserver)

SEED="source bonus chronic canvas draft south burst lottery vacant surface solve popular case indicate oppose farm nothing bullet exhibit title speed wink action roast"
printf '%s\n\n\n' "$SEED" | "$E/bin/gnokey" add test1 --recover --insecure-password-stdin -home "$E/gnohome" >/dev/null

[ -d "$E/realms/br5" ] || node "$ROOT/scripts/fetch-realm.mjs" gno.land/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/bubblerumble5 "$E/realms/br5"

"$E/bin/gnodev" local -home "$E/gnohome" -no-web -no-watch -node-rpc-listener 127.0.0.1:46657 -empty-blocks \
  -C "$E/realms" "$E/realms/br5" >"$E/gnodev.log" 2>&1 &
GNODEV=$!
(cd "$E/goroot" && TMPDIR="$E/goroot" "$E/bin/goserver" -remote http://127.0.0.1:46657 tcp -addr 127.0.0.1:46660 >"$E/goserver.log" 2>&1) &
GOSERVER=$!
trap 'kill $GNODEV $GOSERVER 2>/dev/null || true; pkill -f "$E/bin/goserver" 2>/dev/null || true; pkill -f "$E/bin/gnodev" 2>/dev/null || true' EXIT

for i in $(seq 1 120); do grep -q 'node is ready' "$E/gnodev.log" && break; sleep 1; done
grep -q 'node is ready' "$E/gnodev.log" || { echo "gnodev did not start"; tail -30 "$E/gnodev.log"; exit 1; }
for i in $(seq 1 30); do grep -q 'server TCP address' "$E/goserver.log" && break; sleep 1; done

E2E_GNOKEY="$E/bin/gnokey" E2E_HOME="$E/gnohome" E2E_RPC=http://127.0.0.1:46657 E2E_GOSERVER=http://127.0.0.1:46660 \
  npx jest -c "$ROOT/jest.e2e.config.js" --runInBand
