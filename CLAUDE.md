# yt-transcript — project context

Tiny **personal** tool for Kyle's Mac. Give it a YouTube URL, it saves that
video's transcript as a plain-text file on the Desktop. Two entry points: a Node
CLI (`grab.mjs`) and a Spotlight-launchable AppleScript wrapper (`YT Transcript.app`).

## What it is
- **`grab.mjs`** — the core. Plain Node ESM, **zero npm dependencies** (uses the
  built-in global `fetch`). Node 18+ required (Kyle has v26).
- **`YT Transcript.app`** — an `osacompile`-built AppleScript app that pops a
  "Paste a YouTube URL" dialog, runs the CLI with absolute paths, and shows a
  macOS notification with the saved filename on success (or the error on failure).
- **`YT Transcript.applescript`** — the app's source; edit + recompile to change it.

## Run it
```bash
node grab.mjs "https://www.youtube.com/watch?v=VIDEO_ID"
# or
npm run grab -- "https://youtu.be/VIDEO_ID"
```
Prints `Saved: /Users/kyleg/Desktop/<title> - transcript.txt` (exit 0), or
`Error: <reason>` to stderr (exit 1). Handles `watch?v=`, `youtu.be/`,
`shorts/`, `embed/`, `live/`, extra query params, and bare 11-char IDs.

Output file: `~/Desktop/<sanitized title> - transcript.txt`, with a small header
(title / channel / URL / caption type / date) then the transcript flattened into
readable paragraphs (~4 sentences each; no timestamps).

## How it fetches captions — and why this way (important)
As of 2026 YouTube walls the classic anonymous caption paths:
- the **timedtext** feed returns HTTP 200 with an **empty body**, and
- **`/youtubei/v1/get_transcript`** returns **400 "failedPrecondition"**,

both behind a Proof-of-Origin (POT) token — even with a freshly generated POT
(via `bgutils-js` + BotGuard) the caption/transcript endpoints stayed blocked.

The one client whose `/youtubei/v1/player` response still returns **working,
POT-free caption URLs** is the **Android VR / Oculus client** (`clientName:
ANDROID_VR`). So `grab.mjs` POSTs to `/player` impersonating that client, reads
`videoDetails` + `captionTracks`, picks the best English track (manual > auto),
fetches the track's timedtext as `json3`, and flattens it. This is exactly the
trick `yt-dlp` uses. No API key, no login, no dependencies.

Track preference: manual English → auto-generated English → any manual → first
available. No captions at all → clean error "no captions available for this video".

## Gotchas / fragility
- **This depends on an undocumented YouTube client quirk.** If grabs suddenly
  fail (empty feed, or player rejects the client), YouTube likely changed
  something. First thing to try: bump `VR_CLIENT.clientVersion` in `grab.mjs`
  (and the matching version in `userAgent`) to a current Android VR app version.
  If that client dies entirely, the fallback is to shell out to `yt-dlp`
  (`--skip-download --write-auto-sub --write-sub --sub-format json3`), which
  tracks these changes upstream — but it isn't installed and needs a separate
  install (standalone binary, not Homebrew).
- **Rate limiting:** hammering the `/player` endpoint fast (many requests in a
  row) trips a transient per-IP "Sign in to confirm you're not a bot" response.
  Normal occasional use is fine; it clears itself after a short wait.
- The `.app` hardcodes absolute paths (`/opt/homebrew/bin/node` and the repo
  path to `grab.mjs`). If node or the project moves, recompile the app:
  `osacompile -o "YT Transcript.app" "YT Transcript.applescript"` (update the
  paths in the `.applescript` first).
- Duplicate Desktop filenames get ` (2)`, ` (3)`, … appended automatically.

## Files
- `grab.mjs` — CLI / core logic
- `YT Transcript.app` — Spotlight app (built artifact, committed)
- `YT Transcript.applescript` — app source
- `README.md` — usage + how to bind a global hotkey
- `package.json` — `npm run grab`, no dependencies
