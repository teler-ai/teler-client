#!/usr/bin/env bash
# From Linux (or any machine), copies ios/ to a Mac over SSH, runs
# scripts/build.sh there and copies back the screenshot when --run is given.
#
#   TELER_MAC_HOST=user@mac-host [TELER_MAC_KEY=~/.ssh/key] scripts/remote-build.sh [--run]
#
# The Mac needs Xcode and XcodeGen, and nothing else: no GitHub access and no
# credentials. Source is copied into ~/teler-ios on the Mac.
set -euo pipefail

cd "$(dirname "$0")/.."
host=${TELER_MAC_HOST:?Set TELER_MAC_HOST to user@host of the build Mac}
ssh_args=(-o BatchMode=yes)
[[ -n "${TELER_MAC_KEY:-}" ]] && ssh_args+=(-i "$TELER_MAC_KEY" -o IdentitiesOnly=yes)

rsync -az --delete -e "ssh ${ssh_args[*]}" \
  --exclude .build --exclude Teler.xcodeproj --exclude '.swiftpm' \
  ./ "$host:teler-ios/"

output=$(ssh "${ssh_args[@]}" "$host" "cd teler-ios && PATH=/opt/homebrew/bin:\$PATH scripts/build.sh ${1:-}")
echo "$output"

if [[ "${1:-}" == "--run" ]]; then
  shot=$(echo "$output" | tail -n 1)
  mkdir -p .build/screenshots
  scp "${ssh_args[@]}" "$host:$shot" .build/screenshots/
  echo "Screenshot: $PWD/.build/screenshots/$(basename "$shot")"
fi
