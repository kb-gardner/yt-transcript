# yt-transcript

A tiny local tool for grabbing a YouTube video's transcript. Paste a URL, get the
transcript — as a Desktop file, streamed to stdout, or as JSON. Zero dependencies,
just Node. AI-agent friendly (see [AGENTS.md](AGENTS.md)).

Repo: `github.com/kb-gardner/yt-transcript` (private).

## Requirements
- Node 18+ (uses the built-in `fetch`). Built/tested on Node 26. macOS or Linux.
- No npm install needed. No API key, no login. Just clone and run:
  ```bash
  git clone https://github.com/kb-gardner/yt-transcript.git && cd yt-transcript
  node grab.mjs --help
  ```

## CLI usage
```bash
# Save "<title> - transcript.txt" to ~/Desktop (default):
node grab.mjs "https://www.youtube.com/watch?v=VIDEO_ID"
npm run grab -- "https://youtu.be/VIDEO_ID"      # same, via npm

# Print the transcript to stdout, no file:
node grab.mjs --stdout "https://youtu.be/VIDEO_ID"

# Structured JSON to stdout, no file:
node grab.mjs --json "https://youtu.be/VIDEO_ID"

# Write to an explicit path or into a directory:
node grab.mjs --out ./notes/talk.txt "https://youtu.be/VIDEO_ID"
node grab.mjs --out ./notes/        "https://youtu.be/VIDEO_ID"   # auto filename

node grab.mjs --help                              # full flag reference
```

**Flags:** `--stdout` (print text, no file), `--json` (`{ videoId, title, channel,
url, captionKind, grabbedAt, transcript }`, no file), `--out <path>` (explicit file
or directory), `--help`. `--stdout`/`--json` can each combine with `--out` to also
save (the "Saved:" line then goes to stderr, keeping stdout clean). `--stdout` and
`--json` cannot be combined.

Accepts every common URL shape: `youtube.com/watch?v=…`, `youtu.be/…`,
`youtube.com/shorts/…`, `/embed/…`, `/live/…`, URLs with extra query params, and
bare 11-character video IDs.

Default mode prints `Saved: /Users/you/Desktop/<video title> - transcript.txt`. The
file has a short header (title, channel, URL, caption type, date) followed by the
transcript flattened into readable paragraphs — no timestamps. Manual English
captions are preferred, then auto-generated English, then anything available. A
video with no captions exits with a clear `Error: no captions available for this
video` (exit 1).

## The Spotlight app (optional, macOS-only, local)
`YT Transcript.app` is a small AppleScript wrapper for launching the tool from
Spotlight. It's **not** in the repo (a compiled macOS bundle isn't worth
versioning) — build it locally from the committed source:
```bash
./build-app.sh        # runs osacompile, produces "YT Transcript.app" in this folder
```
Then:
1. Launch it — from **Spotlight** (⌘-Space → type "YT Transcript"), or by
   double-clicking it. To make it appear in Spotlight everywhere, drag it into
   **/Applications** (optional).
2. A dialog asks for a URL. Paste and click **Grab**.
3. A macOS notification shows the saved filename (or the error) when it finishes.

The app calls the CLI using absolute paths baked in at build time
(`/opt/homebrew/bin/node` and this folder's `grab.mjs`). If you move the project
or upgrade to a different node install, edit the two `set nodeBin`/`set grabScript`
lines at the top of `YT Transcript.applescript`, then rerun `./build-app.sh`.

### First launch (Gatekeeper)
Because the app isn't notarized, the first time you open it macOS may block it.
Right-click the app → **Open** → **Open** in the dialog (only needed once). You
may also be asked to allow **Notifications** for it — allow, so the "Saved …"
message can appear.

## Bind a global keyboard shortcut

macOS doesn't let you assign a hotkey directly to an app, but the **Shortcuts**
app does. Steps (current macOS, Sequoia/Tahoe-era):

1. Open the **Shortcuts** app (⌘-Space → "Shortcuts").
2. Click **+** (top toolbar) to create a new shortcut. Name it e.g. `YT Transcript`.
3. In the right-hand action search box, find **Open App**, drag it into the
   shortcut, and set the app to **YT Transcript**.
   - (Alternative that needs no app at all: use the **Run Shell Script** action
     with `/opt/homebrew/bin/node "/Users/kyleg/dev/personal/yt-transcript/grab.mjs"`
     — but the Open-App route is simpler because the app provides the URL prompt.)
4. With the shortcut still selected, open the **Shortcut Details** panel on the
   right (the ⓘ / sliders icon) and check **Use as Quick Action** →
   **Services Menu** (optional), then click **Add Keyboard Shortcut** and press
   your desired combo (e.g. ⌃⌥⌘Y).
5. Close Shortcuts. Your combo now launches the app (and its URL prompt) from
   anywhere.

If the keyboard-shortcut field isn't in Shortcut Details on your macOS version,
you can instead set it under **System Settings → Keyboard → Keyboard Shortcuts →
Services / Shortcuts**, where Shortcuts you've created appear and can be assigned
a key combo.

## How it works / caveats
See `CLAUDE.md`. Short version: YouTube now blocks the old anonymous caption
endpoints, so this impersonates the Android VR client (the one whose player
response still returns working caption URLs) — the same trick `yt-dlp` uses. It's
inherently a bit fragile: if grabs start failing, bump `VR_CLIENT.clientVersion`
in `grab.mjs`. Fetching many videos in quick succession can trip a temporary
"confirm you're not a bot" rate-limit that clears on its own.
