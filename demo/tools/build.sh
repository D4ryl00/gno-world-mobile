#!/usr/bin/env bash
# npm run demo:build — everything the capture needs, built once (re-run after the app or the wallet changes):
# gnokey with sign-data and gnokey-pair (from ~/gno-gnokey-pair, feat/gnokey-pair, rebased on feat/gnokey-sign-data),
# the relay's venv, the app's Release build for the simulator, gnokey-mobile's simulator build.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
S=$ROOT/demo/.state
PAIR=${GNO_PAIR:-$HOME/gno-gnokey-pair}
WALLET=${GNOKEY_MOBILE:-$HOME/gnokey-mobile}
mkdir -p "$S/bin"

echo "• gnokey (sign-data) and gnokey-pair from $PAIR ($(git -C "$PAIR" branch --show-current))"
(cd "$PAIR" && go build -o "$S/bin/gnokey" ./gno.land/cmd/gnokey)
(cd "$PAIR/contribs/gnokey-pair" && go build -o "$S/bin/gnokey-pair" .)
# read the help first: grep -q on a pipe would cut gnokey short and pipefail would call that a failure
HELP=$("$S/bin/gnokey" sign-data -h 2>&1 || true)
grep -q 'sign-data \[flags\]' <<<"$HELP" || { echo "this gnokey has no sign-data" >&2; exit 1; }

echo "• relay venv"
[ -x "$PAIR/contribs/gnokey-pair/.venv/bin/twist" ] || make -C "$PAIR/contribs/gnokey-pair" test-deps

echo "• gno.world Release build for the simulator"
[ -d "$ROOT/ios" ] || (cd "$ROOT" && npx expo prebuild --platform ios)
xcodebuild -workspace "$ROOT/ios/gnoworld.xcworkspace" -scheme gnoworld -configuration Release \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath "$S/build" build -quiet

echo "• gnokey-mobile simulator build (its Xcode project is generated from ios/project.yml)"
make -C "$WALLET" generate >/dev/null
xcodebuild -project "$WALLET/ios/GnokeyMobile.xcodeproj" -scheme GnokeyMobile -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath "$WALLET/ios/build/DerivedData" build -quiet

ls -d "$S/build/Build/Products/Release-iphonesimulator/gnoworld.app" \
  "$WALLET/ios/build/DerivedData/Build/Products/Debug-iphonesimulator/GnokeyMobile.app"
echo "done"
