#!/usr/bin/env bash
# Builds the app for the iOS Simulator and, with --run, installs and launches it
# on a booted simulator and saves a screenshot. Run on a Mac with Xcode and
# XcodeGen. No signing is needed for the simulator.
set -euo pipefail

cd "$(dirname "$0")/.."
run=false
[[ "${1:-}" == "--run" ]] && run=true

xcodegen=$(command -v xcodegen || echo /opt/homebrew/bin/xcodegen)
"$xcodegen" generate --quiet

derived=.build/DerivedData
xcodebuild -project Teler.xcodeproj -scheme Teler -configuration Debug \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath "$derived" \
  CODE_SIGNING_ALLOWED=NO -quiet build

app="$derived/Build/Products/Debug-iphonesimulator/Teler.app"
[[ -x "$app/Teler" ]] || { echo "The build produced no Teler.app" >&2; exit 1; }
echo "Built $app with $(xcodebuild -version | head -n 1)" >&2

$run || exit 0

# Reuse a booted simulator, or boot $TELER_SIMULATOR (default: an iPhone 18 Pro,
# the size the designs use), or else the last iPhone available.
device=$(xcrun simctl list devices booted -j | /usr/bin/python3 -c '
import json, sys
for runtime, devices in json.load(sys.stdin)["devices"].items():
    for device in devices:
        print(device["udid"]); sys.exit()')
if [[ -z "$device" ]]; then
  device=$(xcrun simctl list devices available -j | TELER_SIMULATOR="${TELER_SIMULATOR:-iPhone 18 Pro}" /usr/bin/python3 -c '
import json, os, sys
iphones = [d for r, ds in json.load(sys.stdin)["devices"].items() if "iOS" in r
           for d in ds if d["name"].startswith("iPhone")]
wanted = [d for d in iphones if d["name"] == os.environ["TELER_SIMULATOR"]]
print((wanted or iphones or [{"udid": ""}])[-1]["udid"])')
  [[ -n "$device" ]] || { echo "No iPhone simulator is installed" >&2; exit 1; }
  xcrun simctl boot "$device"
  xcrun simctl bootstatus "$device" -b >/dev/null
  # A fresh boot keeps setting up the home screen after it reports ready.
  sleep 30
fi

xcrun simctl install "$device" "$app"
launch_args=()
[[ -n "${TELER_DEMO:-}" ]] && launch_args+=(-TelerDemo YES)
[[ -n "${TELER_ROUTE:-}" ]] && launch_args+=(-TelerRoute "$TELER_ROUTE")
# macOS's bash 3.2 treats an empty array as unset under `set -u`.
xcrun simctl launch --terminate-running-process "$device" ai.teler.app \
  ${launch_args[@]+"${launch_args[@]}"} >/dev/null
sleep "${TELER_SCREENSHOT_DELAY:-4}"
mkdir -p .build/screenshots
shot=".build/screenshots/teler-$(date +%Y%m%d-%H%M%S).png"
xcrun simctl io "$device" screenshot "$shot" >/dev/null 2>&1
echo "$PWD/$shot"
