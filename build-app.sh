#!/usr/bin/env bash
# build-app.sh — (re)compile the optional macOS Spotlight wrapper "YT Transcript.app"
# from its AppleScript source. macOS only; the .app is local-only (gitignored).
#
# The app hardcodes absolute paths to node and grab.mjs. If node lives somewhere
# other than /opt/homebrew/bin/node, or you cloned the repo to a different path,
# edit the two `set nodeBin`/`set grabScript` lines at the top of
# "YT Transcript.applescript" first, then run this.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v osacompile >/dev/null 2>&1; then
  echo "osacompile not found — this step only works on macOS." >&2
  exit 1
fi

rm -rf "YT Transcript.app"
osacompile -o "YT Transcript.app" "YT Transcript.applescript"
echo "Built: $(pwd)/YT Transcript.app"
echo "Launch it from Spotlight (⌘-Space → \"YT Transcript\") or drag it to /Applications."
