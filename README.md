# yt-transcript

A tiny local tool for grabbing a YouTube video's transcript. Paste a URL, get a
plain-text transcript file on your Desktop. Zero dependencies — just Node.

## Requirements
- macOS with Node 18+ (uses the built-in `fetch`). Built/tested on Node 26.
- No npm install needed. No API key, no login.

## CLI usage
```bash
node grab.mjs "https://www.youtube.com/watch?v=VIDEO_ID"
# or via npm:
npm run grab -- "https://youtu.be/VIDEO_ID"
```

Accepts every common URL shape: `youtube.com/watch?v=…`, `youtu.be/…`,
`youtube.com/shorts/…`, `/embed/…`, `/live/…`, URLs with extra query params, and
bare 11-character video IDs.

On success it prints:
```
Saved: /Users/you/Desktop/<video title> - transcript.txt
```
The file has a short header (title, channel, URL, caption type, date) followed by
the transcript flattened into readable paragraphs — no timestamps. Manual English
captions are preferred, then auto-generated English, then anything available. A
video with no captions exits with a clear `Error: no captions available for this
video`.

## The Spotlight app
`YT Transcript.app` (in this folder) is a small AppleScript wrapper:

1. Launch it — from **Spotlight** (⌘-Space → type "YT Transcript"), or by
   double-clicking it. To make it appear in Spotlight everywhere, drag it into
   **/Applications** (optional; Spotlight also indexes it here).
2. A dialog asks for a URL. Paste and click **Grab**.
3. A macOS notification shows the saved filename (or the error) when it finishes.

The app calls the CLI using absolute paths baked in at build time
(`/opt/homebrew/bin/node` and this folder's `grab.mjs`). If you move the project
or upgrade to a different node install, rebuild it:
```bash
# edit the two paths at the top of YT Transcript.applescript if needed, then:
osacompile -o "YT Transcript.app" "YT Transcript.applescript"
```

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
