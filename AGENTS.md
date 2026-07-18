# AGENTS.md — yt-transcript

**What it is:** a zero-dependency Node CLI that fetches a YouTube video's transcript (captions) and either prints it or saves it as a text file.

This file is the contract for AI agents. Read it before using the tool.

## Requirements
- Node **≥ 18** (uses the built-in global `fetch`). No `npm install` — there are **zero dependencies**.
- Works on **macOS and Linux** (and anywhere Node runs). The optional `YT Transcript.app` Spotlight wrapper is macOS-only and not needed to use the CLI.
- Network access to `youtube.com`.

## Setup from scratch

**On an end-user machine** (installs a `yt-transcript` command + macOS Spotlight app):
```bash
curl -fsSL https://raw.githubusercontent.com/kb-gardner/yt-transcript/main/install.sh | bash
```
Installs to `~/.yt-transcript`, wrapper at `~/.local/bin/yt-transcript`. Idempotent.
After install you can call `yt-transcript …` (if `~/.local/bin` is on PATH) or
`node ~/.yt-transcript/grab.mjs …` directly. Update in place with `yt-transcript --update`
(re-runs the installer); from a repo checkout just `git pull`.

**As an agent working in a repo checkout** (no global install needed):
```bash
git clone https://github.com/kb-gardner/yt-transcript.git
cd yt-transcript
node grab.mjs --help            # no build, no npm install
```
If this repo is already present locally, the script is at:
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
On failure the exit code is **1**. In normal/`--stdout` mode the error prints as `Error: <reason>` on
**stderr** (stdout empty). **Under `--json`, a runtime failure prints `{"error":"<reason>"}` to
stdout** (still exit 1) so you can parse it — check the exit code, then read `.error`.

Before failing, `grab.mjs` automatically retries the video across up to **3 InnerTube clients**
(Android VR → iOS → TV-embedded); you don't orchestrate retries, it does. The reasons below are what
you get *after* all clients were tried.

1. **No captions** — `no captions available for this video`.
   A client could play the video but it has no captions/subtitles. Tell the user; do not retry.

2. **Rate limit** — `YouTube is temporarily rate-limiting this network ("confirm you're not a bot").
   This usually clears within an hour — try again later. (Not a bug in this tool.)`
   Transient, **IP-scoped** anti-bot throttle from too many requests. **Do NOT hammer** — the tool
   already tried 3 clients. Wait (tens of minutes) and retry once later, or just relay this message
   to the user. Rapid retries prolong the block.

3. **Age-restricted** — `This video is age-restricted; YouTube requires sign-in for it, which this
   tool doesn't do.` Distinct from the rate-limit case (both once shared "Sign in to confirm…"
   phrasing). Not retryable; tell the user.

4. **Video inaccessible** — `Video is not accessible: <reason>` — the actual YouTube reason verbatim
   (private, removed, region-blocked, unavailable, etc.). Surface the reason; not retryable.

5. **Usage error** — `Error: <reason>` followed by the help text (bad flag, missing URL,
   `--stdout` + `--json` together). These always go to stderr (not JSON). Fix the command and rerun.

6. **Stale clients (rare, future)** — if grabs fail across many videos with empty feeds, YouTube
   likely changed its API. Fix: bump the `clientVersion` (and matching `userAgent` version) of the
   entries in the `CLIENTS` array in `grab.mjs`, or append a new working client. See CLAUDE.md.

## How it works (one paragraph)
YouTube walls the classic anonymous caption endpoints behind a Proof-of-Origin token. A handful of
InnerTube clients (Android VR / Oculus, iOS, TV-embedded) still return working, POT-free caption URLs,
so `grab.mjs` tries them in order (`CLIENTS` array), reads `captionTracks`, picks the best English
track (manual > auto-generated), fetches the timedtext as json3, and flattens it into paragraphs. No
API key, no login. Inherently a bit fragile — see failure mode 5.

## Self-check
`node url.test.mjs` runs an offline (no-network) check of URL parsing and arg parsing. Expect
`url.test.mjs: 25 checks passed`.
