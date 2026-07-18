# yt-transcript — project context

Tiny **personal** tool. Give it a YouTube URL, it returns that video's transcript —
saved to the Desktop by default, or streamed to stdout / emitted as JSON for AI
agents. Entry points: a Node CLI (`grab.mjs`) and an optional Spotlight-launchable
AppleScript wrapper (`YT Transcript.app`).

Repo: **`github.com/kb-gardner/yt-transcript`** — **PUBLIC**, MIT licensed. AI-agent
contract lives in **`AGENTS.md`**; a local Claude Code skill points at this project
(see below).

**One-command install** (`install.sh` at repo root):
`curl -fsSL https://raw.githubusercontent.com/kb-gardner/yt-transcript/main/install.sh | bash`
— installs to `~/.yt-transcript`, drops a `yt-transcript` wrapper in `~/.local/bin`,
and on macOS osacompiles the Spotlight app into `~/Applications` with the installing
machine's resolved node + script paths (parameterized from the `.applescript`).
Idempotent, no sudo, never auto-installs Node. This is Kyle's own dev checkout at
`~/dev/personal/yt-transcript`; the installer is for clean end-user machines.
Installed users self-update with `yt-transcript --update` (the generated wrapper
intercepts it and re-runs the installer); `grab.mjs --update` just prints how to
update a checkout. Existing installs need one manual re-install before `--update` exists.

## What it is
- **`grab.mjs`** — the core. Plain Node ESM, **zero npm dependencies** (uses the
  built-in global `fetch`). Node 18+ (Kyle has v26). Runs on macOS and Linux.
- **`AGENTS.md`** — AI-facing usage contract (setup, recipes, failure modes).
- **`YT Transcript.applescript`** + **`build-app.sh`** — source + builder for the
  optional macOS Spotlight app. The compiled `.app` is **gitignored** (local-only,
  macOS-only); run `./build-app.sh` to (re)create it.
- **`url.test.mjs`** — offline self-check for URL + arg parsing (`node url.test.mjs`).

## Run it
```bash
node grab.mjs "https://www.youtube.com/watch?v=VIDEO_ID"   # save to ~/Desktop
node grab.mjs --stdout "<url>"     # print text to stdout, no file
node grab.mjs --json   "<url>"     # JSON to stdout, no file
node grab.mjs --out ./f.txt "<url>"  # explicit path; dir → auto filename inside
node grab.mjs --help
npm run grab -- "<url>"            # default mode via npm
```
Default mode prints `Saved: /Users/kyleg/Desktop/<title> - transcript.txt` (exit 0);
`--stdout`/`--json` write no file and keep stdout machine-clean (any "Saved:" line
from a combined `--out` goes to stderr). `Error: <reason>` → stderr, exit 1. Handles
`watch?v=`, `youtu.be/`, `shorts/`, `embed/`, `live/`, extra query params, bare IDs.

`--json` fields: `{ videoId, title, channel, url, captionKind, grabbedAt, transcript }`
(`grabbedAt` is ISO 8601). Default file: `~/Desktop/<sanitized title> - transcript.txt`,
a small header (title / channel / URL / caption type / date) then the transcript
flattened into readable paragraphs (~4 sentences each; no timestamps).

**Agents:** prefer `--stdout`/`--json`; don't write to the Desktop unless Kyle asks
for a saved file. There's a Claude Code skill (`~/.claude/skills/yt-transcript/`,
local, not in the repo) that routes transcript requests here.

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
  path to `grab.mjs`). If node or the project moves, edit the two `set` lines at
  the top of `YT Transcript.applescript`, then rerun `./build-app.sh`. The `.app`
  is gitignored, so a fresh clone has no app until you build it.
- Duplicate auto-generated filenames get ` (2)`, ` (3)`, … appended. An explicit
  `--out <file>` path is used as-is (may overwrite).

## Files
- `grab.mjs` — CLI / core logic (exports `parseArgs`, `extractVideoId` for tests)
- `install.sh` — one-command installer (curl | bash); git-clone or tarball, builds app
- `LICENSE` — MIT, © 2026 Kyle Gardner
- `AGENTS.md` — AI-agent contract (setup, recipes, failure modes)
- `YT Transcript.applescript` — Spotlight app source; `build-app.sh` / `install.sh` compile it
- `url.test.mjs` — offline self-check (`node url.test.mjs`)
- `README.md` — human usage: install one-liner, Spotlight, hotkey, flags, uninstall
- `package.json` — `npm run grab`, no dependencies
- `YT Transcript.app/` — built app, **gitignored / local-only**
