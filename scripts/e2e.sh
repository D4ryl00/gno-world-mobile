#!/usr/bin/env bash
# End-to-end: gnodev (gno from ~/gno) with bubblerumble6, gnonative goserver (from ~/gnonative feat/sign-bytes),
# gnokey as the desktop signer. Ports 46657 (node) and 46660 (goserver) must be free.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
E=$ROOT/.e2e
GNO=${GNO:-$HOME/gno}
GNONATIVE=${GNONATIVE:-$HOME/gnonative}
mkdir -p "$E/bin" "$E/home"

# One run at a time (a second one would kill the first's node), on free ports. The trap below kills only this
# script's binaries (anchored), never npm run gnodev's .e2e/bin/gnodev-<rev>.
if ! mkdir "$E/e2e.lock" 2>/dev/null; then
  echo "another e2e run holds $E/e2e.lock (remove it if no run is going on)"; exit 1
fi
trap 'rmdir "$E/e2e.lock" 2>/dev/null || true' EXIT
for port in 46657 46660; do
  if lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; then echo "port $port is in use"; exit 1; fi
done

rm -rf "$E/gnohome" "$E/goroot"
mkdir -p "$E/gnohome" "$E/goroot"

(cd "$GNO" && go build -o "$E/bin/gnokey" ./gno.land/cmd/gnokey)
(cd "$GNO/contribs/gnodev" && go build -o "$E/bin/gnodev" .)
# Build the goserver against $GNO so client and node share one gno commit (same amino types, e.g. bank.TransferEvent).
# A throwaway modfile keeps ~/gnonative untouched.
cp "$GNONATIVE/go.mod" "$E/goserver.mod"; cp "$GNONATIVE/go.sum" "$E/goserver.sum"
(cd "$GNONATIVE" && go mod edit -modfile="$E/goserver.mod" -replace "github.com/gnolang/gno=$GNO" \
  && { go mod tidy -modfile="$E/goserver.mod" >"$E/gomod.log" 2>&1 || { cat "$E/gomod.log"; exit 1; }; } \
  && go build -modfile="$E/goserver.mod" -o "$E/bin/goserver" ./goserver)

SEED="source bonus chronic canvas draft south burst lottery vacant surface solve popular case indicate oppose farm nothing bullet exhibit title speed wink action roast"
printf '%s\n\n\n' "$SEED" | "$E/bin/gnokey" add test1 --recover --insecure-password-stdin -home "$E/gnohome" >/dev/null

[ -d "$E/realms/br6" ] || node "$ROOT/scripts/fetch-realm.mjs" gno.land/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/bubblerumble6 "$E/realms/br6"

"$E/bin/gnodev" local -home "$E/gnohome" -no-web -no-watch -node-rpc-listener 127.0.0.1:46657 -empty-blocks \
  -C "$E/realms" "$E/realms/br6" >"$E/gnodev.log" 2>&1 &
GNODEV=$!
(cd "$E/goroot" && TMPDIR="$E/goroot" "$E/bin/goserver" -remote http://127.0.0.1:46657 tcp -addr 127.0.0.1:46660 >"$E/goserver.log" 2>&1) &
GOSERVER=$!
trap 'kill $GNODEV $GOSERVER 2>/dev/null || true; pkill -f "^$E/bin/goserver " 2>/dev/null || true; pkill -f "^$E/bin/gnodev " 2>/dev/null || true; rmdir "$E/e2e.lock" 2>/dev/null || true' EXIT

for i in $(seq 1 120); do grep -q 'node is ready' "$E/gnodev.log" && break; sleep 1; done
grep -q 'node is ready' "$E/gnodev.log" || { echo "gnodev did not start"; tail -30 "$E/gnodev.log"; exit 1; }
for i in $(seq 1 30); do grep -q 'server TCP address' "$E/goserver.log" && break; sleep 1; done

E2E_GNOKEY="$E/bin/gnokey" E2E_HOME="$E/gnohome" E2E_RPC=http://127.0.0.1:46657 E2E_GOSERVER=http://127.0.0.1:46660 \
  npx jest -c "$ROOT/jest.e2e.config.js" --runInBand
