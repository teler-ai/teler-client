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

# Reuse a booted simulator, or boot the newest iPhone available.
device=$(xcrun simctl list devices booted -j | /usr/bin/python3 -c '
import json, sys
for runtime, devices in json.load(sys.stdin)["devices"].items():
    for device in devices:
        print(device["udid"]); sys.exit()')
if [[ -z "$device" ]]; then
  device=$(xcrun simctl list devices available -j | /usr/bin/python3 -c '
import json, sys
iphones = [d for r, ds in json.load(sys.stdin)["devices"].items() if "iOS" in r
           for d in ds if d["name"].startswith("iPhone")]
print(iphones[-1]["udid"] if iphones else "")')
  [[ -n "$device" ]] || { echo "No iPhone simulator is installed" >&2; exit 1; }
  xcrun simctl boot "$device"
  xcrun simctl bootstatus "$device" -b >/dev/null
fi

xcrun simctl install "$device" "$app"
xcrun simctl launch --terminate-running-process "$device" ai.teler.app >/dev/null
sleep 3
mkdir -p .build/screenshots
shot=".build/screenshots/teler-$(date +%Y%m%d-%H%M%S).png"
xcrun simctl io "$device" screenshot "$shot" >/dev/null
echo "$PWD/$shot"
