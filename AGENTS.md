# AGENTS.md — yt-transcript

**What it is:** a zero-dependency Node CLI that fetches a YouTube video's transcript (captions) and either prints it or saves it as a text file.

This file is the contract for AI agents. Read it before using the tool.

## Requirements
- Node **≥ 18** (uses the built-in global `fetch`). No `npm install` — there are **zero dependencies**.
- Works on **macOS and Linux** (and anywhere Node runs). The optional `YT Transcript.app` Spotlight wrapper is macOS-only and not needed to use the CLI.
- Network access to `youtube.com`.

## Setup from scratch
```bash
git clone https://github.com/kb-gardner/yt-transcript.git
cd yt-transcript
node grab.mjs --help            # no build, no install needed
```
If the repo is already present locally, the script is at:
`/Users/kyleg/dev/personal/yt-transcript/grab.mjs`

## Usage recipes

**Read a transcript into your context (preferred for agents):**
```bash
node grab.mjs --stdout "<youtube-url>"
```
Prints header + transcript to stdout. Writes no file.

**Get structured output (preferred when you need fields):**
```bash
node grab.mjs --json "<youtube-url>"
```
Prints one JSON object to stdout (and writes no file):
```json
{
  "videoId": "…",
  "title": "…",
  "channel": "…",
  "url": "https://www.youtube.com/watch?v=…",
  "captionKind": "manual English",
  "grabbedAt": "2026-07-17T21:56:41.771Z",
  "transcript": "…readable paragraphs…"
}
```
stdout is machine-clean in `--stdout`/`--json` mode. Any "Saved:" confirmation (when `--out` is combined) goes to **stderr**.

**Save a file for the user (only when the user asked for a saved file):**
```bash
node grab.mjs "<youtube-url>"                 # saves to ~/Desktop, prints "Saved: <path>"
node grab.mjs --out /path/to/file.txt "<url>" # explicit file
node grab.mjs --out /path/to/dir/  "<url>"    # auto filename inside a directory
```

**Combine** `--out` with `--stdout` or `--json` to both print and save.

Accepted URL forms: `watch?v=`, `youtu.be/`, `shorts/`, `embed/`, `live/`, URLs with extra query params, and bare 11-char video IDs.

## Default-behavior rule for agents
**Prefer `--stdout` or `--json`. Do NOT write to the user's Desktop (default mode or `--out`) unless the user explicitly asked for a saved file.** Reading into context should leave no file side effects.

## Failure modes and how to respond
All errors print `Error: <reason>` to **stderr** and exit **1**. stdout stays empty on failure.

1. **No captions** — `Error: no captions available for this video`.
   The video genuinely has no captions/subtitles. Tell the user; do not retry — retrying won't help.

2. **Rate limit** — `Error: Video is not accessible: Sign in to confirm you're not a bot`.
   Transient, **IP-scoped** anti-bot throttle triggered by many requests in a short window.
   **Do NOT hammer.** Wait (minutes, not seconds) and retry once later, or tell the user the IP is
   temporarily throttled. Rapid retries make it worse and prolong the block.

3. **Video inaccessible** — `Error: Video is not accessible: <reason>` (private, removed, age/region
   restricted, etc.). Surface the reason to the user; not retryable.

4. **Usage error** — `Error: <reason>` followed by the help text (e.g. bad flag, missing URL,
   `--stdout` + `--json` together). Fix the command and rerun.

5. **Stale client (rare, future)** — if grabs start failing with empty feeds or the player rejects
   the request across many videos, YouTube likely changed its API. Fix: bump `VR_CLIENT.clientVersion`
   in `grab.mjs` (and the matching version string inside `VR_CLIENT.userAgent`) to a current Android VR
   / Oculus YouTube app version. See CLAUDE.md for the full rationale.

## How it works (one paragraph)
YouTube walls the classic anonymous caption endpoints behind a Proof-of-Origin token. The one client
whose `/youtubei/v1/player` response still returns working, POT-free caption URLs is the Android VR /
Oculus client, so `grab.mjs` impersonates it, reads `captionTracks`, picks the best English track
(manual > auto-generated), fetches the timedtext as json3, and flattens it into paragraphs. No API key,
no login. This is inherently a bit fragile — see failure mode 5.

## Self-check
`node url.test.mjs` runs an offline (no-network) check of URL parsing and arg parsing. Expect
`url.test.mjs: 25 checks passed`.
