-- YT Transcript.app
-- Spotlight-launchable wrapper around grab.mjs. Prompts for a YouTube URL,
-- runs the CLI with absolute paths, then reports the saved filename (or error)
-- via a macOS notification.
--
-- Paths are hardcoded to absolute locations resolved at build time:
--   node:   /opt/homebrew/bin/node   (from `which node`)
--   script: /Users/kyleg/dev/personal/yt-transcript/grab.mjs
-- If either moves, rebuild the app (see README.md) so these stay correct.

set nodeBin to "/opt/homebrew/bin/node"
set grabScript to "/Users/kyleg/dev/personal/yt-transcript/grab.mjs"

-- Prompt for the URL.
set dlg to display dialog "Paste a YouTube URL:" default answer "" ¬
	with title "YT Transcript" buttons {"Cancel", "Grab"} default button "Grab" ¬
	with icon note
set theURL to text returned of dlg

-- Trim leading/trailing whitespace.
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
	display notification fileName with title "YT Transcript ✓" subtitle "Saved to Desktop"
on error errMsg number errNum
	if errNum is -128 then return -- user cancelled somewhere
	-- errMsg carries grab.mjs's stderr (e.g. "Error: no captions available...").
	set cleanMsg to my trimText(errMsg)
	display notification cleanMsg with title "YT Transcript ✗ — failed"
	display dialog cleanMsg with title "YT Transcript — failed" ¬
		buttons {"OK"} default button "OK" with icon caution
end try

-- Helpers ---------------------------------------------------------------

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
