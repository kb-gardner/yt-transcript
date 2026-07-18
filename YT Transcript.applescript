-- YT Transcript.app
-- Spotlight-launchable wrapper around grab.mjs. Prompts for a YouTube URL,
-- runs the CLI with absolute paths, then reports the saved filename (or error)
-- via a macOS notification.
--
-- UX (round 4): opens frontmost and refocuses on Dock-icon click (activate);
-- a wide, scrollable, multi-line input so long pasted URLs are fully visible
-- (Cocoa NSAlert + NSTextView via AppleScriptObjC); and clipboard pre-fill when
-- the clipboard already holds a YouTube URL.
--
-- Paths are hardcoded to absolute locations resolved at build time. The two lines
-- below (set nodeBin / set grabScript) are placeholders that install.sh rewrites
-- for each machine — keep them at column 0 starting with those exact words.
--   node:   /opt/homebrew/bin/node   (from `which node`)
--   script: /Users/kyleg/dev/personal/yt-transcript/grab.mjs

use framework "Foundation"
use framework "AppKit"
use scripting additions

set nodeBin to "/opt/homebrew/bin/node"
set grabScript to "/Users/kyleg/dev/personal/yt-transcript/grab.mjs"

-- Open frontmost, and make Dock-icon clicks bring the dialog forward.
tell me to activate
current application's NSApplication's sharedApplication()'s activateIgnoringOtherApps:true

-- Pre-fill only if the clipboard looks like a YouTube URL (never show other text).
set prefill to my clipboardIfYouTube()

set theURL to my promptForURL(prefill)
if theURL is missing value then return -- cancelled

set theURL to my trimText(theURL)
if theURL is "" then
	display notification "No URL entered." with title "YT Transcript — nothing to do"
	return
end if

try
	set theOutput to do shell script quoted form of nodeBin & " " & ¬
		quoted form of grabScript & " " & quoted form of theURL

	-- On success grab.mjs prints "Saved: <absolute path>".
	set savedPath to theOutput
	if theOutput starts with "Saved: " then set savedPath to text 8 thru -1 of theOutput

	set fileName to my lastPathComponent(savedPath)
	-- Notification is a nice-to-have but unreliable for unsigned applets (macOS
	-- silently drops it without granted permission), so the guaranteed success
	-- feedback is this in-window confirmation that auto-dismisses after ~2s.
	display notification fileName with title "YT Transcript ✓" subtitle "Saved to Desktop"
	try
		display dialog ("✓  Saved to Desktop" & return & return & fileName) ¬
			with title "YT Transcript" buttons {"OK"} default button "OK" ¬
			giving up after 2 with icon note
	end try
on error errMsg number errNum
	if errNum is -128 then return -- user cancelled somewhere
	-- errMsg carries grab.mjs's stderr (e.g. "Error: no captions available...").
	set cleanMsg to my trimText(errMsg)
	display notification cleanMsg with title "YT Transcript ✗ — failed"
	display dialog cleanMsg with title "YT Transcript — failed" ¬
		buttons {"OK"} default button "OK" with icon caution
end try

-- Handlers --------------------------------------------------------------

-- Prompt for the URL. Prefer the Cocoa NSAlert (wide, scrollable, multi-line);
-- if AppleScriptObjC ever fails on some macOS, fall back to a plain display
-- dialog so the app always prompts. Returns text, or missing value on cancel.
on promptForURL(prefillText)
	try
		return my promptCocoa(prefillText)
	on error errMsg number errNum
		if errNum is -128 then return missing value -- user cancelled
		-- ASObjC unavailable/failed — plain display-dialog fallback.
		try
			set dlg to display dialog "Paste a YouTube URL:" default answer prefillText ¬
				with title "YT Transcript" buttons {"Cancel", "Grab"} default button "Grab" with icon note
			return text returned of dlg
		on error number -128
			return missing value
		end try
	end try
end promptForURL

-- Cocoa NSAlert with a scrollable, multi-line text view so a long pasted URL
-- wraps and is fully visible. Returns the entered text, or missing value if the
-- user cancelled.
on promptCocoa(prefillText)
	set theAlert to current application's NSAlert's alloc()'s init()
	theAlert's setMessageText:"YT Transcript"
	theAlert's setInformativeText:"Paste a YouTube URL, then click Grab. (Long URLs wrap and scroll.)"
	(theAlert's addButtonWithTitle:"Grab")
	(theAlert's addButtonWithTitle:"Cancel")

	set theRect to current application's NSMakeRect(0, 0, 460, 72)
	set scrollView to current application's NSScrollView's alloc()'s initWithFrame:theRect
	scrollView's setHasVerticalScroller:true
	scrollView's setHasHorizontalScroller:false
	scrollView's setBorderType:(current application's NSBezelBorder)

	set textView to current application's NSTextView's alloc()'s initWithFrame:theRect
	textView's setFont:(current application's NSFont's systemFontOfSize:13)
	textView's setRichText:false
	textView's setEditable:true
	textView's setSelectable:true
	textView's setHorizontallyResizable:false
	(textView's textContainer())'s setWidthTracksTextView:true
	if prefillText is not "" then
		textView's setString:prefillText
		-- Select all so the user can immediately overwrite or confirm.
		textView's setSelectedRange:(current application's NSMakeRange(0, (count of prefillText)))
	end if
	scrollView's setDocumentView:textView

	theAlert's setAccessoryView:scrollView
	-- Focus the text view so a paste (Cmd-V) lands in it immediately. Best-effort:
	-- the alert window only exists once laid out, and never under bare `osascript`,
	-- so guard it — the dialog must still open if focusing fails.
	try
		theAlert's layout()
		(theAlert's window()'s makeFirstResponder:textView)
	end try

	set resp to theAlert's runModal()
	if resp is (current application's NSAlertFirstButtonReturn) then
		-- NOTE: 'string' is an AppleScript keyword; the bare 'textView's string()'
		-- gets mis-parsed as an object specifier and fails to coerce, which used to
		-- throw here and trigger the display-dialog fallback (double prompt). Escape
		-- the selector with pipes so it's read as the -string method.
		return ((textView's |string|()) as text)
	end if
	return missing value
end promptCocoa

-- Return the clipboard text only when it looks like a YouTube link; else "".
-- Non-YouTube clipboard content is never returned, shown, or logged.
on clipboardIfYouTube()
	set clip to ""
	try
		set clip to (the clipboard as text)
	on error
		return ""
	end try
	if clip is missing value then return ""
	set c to clip as text
	set markers to {"youtube.com/watch", "youtu.be/", "youtube.com/shorts/", ¬
		"youtube.com/live/", "youtube.com/embed/", "youtube-nocookie.com/", "m.youtube.com/watch"}
	repeat with mk in markers
		if c contains mk then return my trimText(c)
	end repeat
	return ""
end clipboardIfYouTube

on trimText(t)
	set t to t as text
	repeat while t starts with " " or t starts with tab or t starts with return or t starts with linefeed
		if length of t is 0 then exit repeat
		set t to text 2 thru -1 of t
	end repeat
	repeat while t ends with " " or t ends with tab or t ends with return or t ends with linefeed
		if length of t is 0 then exit repeat
		set t to text 1 thru -2 of t
	end repeat
	return t
end trimText

on lastPathComponent(p)
	set oldDelims to AppleScript's text item delimiters
	set AppleScript's text item delimiters to "/"
	set comp to last text item of p
	set AppleScript's text item delimiters to oldDelims
	return comp
end lastPathComponent
