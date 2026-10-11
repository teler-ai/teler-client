#!/usr/bin/env bash
# From Linux (or any machine), copies ios/ to a Mac over SSH, runs
# scripts/build.sh there and copies back the screenshot when --run is given.
#
#   TELER_MAC_HOST=user@mac-host [TELER_MAC_KEY=~/.ssh/key] [TELER_SIMULATOR="iPhone 18 Pro"] \
#     [TELER_ROUTE="chat:<id>" | TELER_ROUTE="ask:<question>"] scripts/remote-build.sh [--run]
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

remote_env="PATH=/opt/homebrew/bin:\$PATH"
[[ -n "${TELER_SIMULATOR:-}" ]] && remote_env+=" TELER_SIMULATOR=$(printf %q "$TELER_SIMULATOR")"
[[ -n "${TELER_ROUTE:-}" ]] && remote_env+=" TELER_ROUTE=$(printf %q "$TELER_ROUTE")"
output=$(ssh "${ssh_args[@]}" "$host" "cd teler-ios && $remote_env scripts/build.sh ${1:-}")
echo "$output"

if [[ "${1:-}" == "--run" ]]; then
  shot=$(echo "$output" | tail -n 1)
  mkdir -p .build/screenshots
  scp "${ssh_args[@]}" "$host:$shot" .build/screenshots/
  echo "Screenshot: $PWD/.build/screenshots/$(basename "$shot")"
fi
