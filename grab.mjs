#!/usr/bin/env node
// grab.mjs — fetch a YouTube video's transcript/captions. By default it saves a
// plain-text file to the Desktop; flags let an AI agent stream it to stdout or
// emit JSON instead. Zero npm dependencies; plain Node ESM.
//
// Usage:  node grab.mjs [--stdout|--json] [--out <path>] "<youtube-url>"
//         node grab.mjs --help
//
// How it works
// ------------
// YouTube now walls the classic anonymous caption feeds behind a Proof-of-Origin
// token (the timedtext feed returns HTTP 200 with an empty body, and
// /get_transcript returns 400 "failedPrecondition"). The one client whose player
// response still hands back working, POT-free caption URLs is the Android VR /
// Oculus client. So we POST to the InnerTube /player endpoint impersonating that
// client, read videoDetails + captionTracks, pick the best English track, fetch
// its timedtext feed as json3, and flatten it into readable paragraphs.
//
// See CLAUDE.md for the "why this and not X" history and AGENTS.md for the
// AI-agent contract.

import { writeFileSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Ordered list of InnerTube clients whose /player response still hands out
// working, POT-free caption URLs. We try them in order and stop at the first that
// returns a playable video with captions. The bot-check ("confirm you're not a
// bot") is partly client-specific, so a second/third client sometimes succeeds
// when the first is blocked. To add a client later, append one entry here.
//
// `client` is the InnerTube context.client object; `userAgent` must match it;
// `thirdParty` (optional) is merged into context. Bump clientVersion / userAgent
// versions together if YouTube starts rejecting a client.
export const CLIENTS = [
  {
    name: "ANDROID_VR",
    client: {
      clientName: "ANDROID_VR",
      clientVersion: "1.62.27",
      deviceMake: "Oculus",
      deviceModel: "Quest 3",
      osName: "Android",
      osVersion: "12L",
      androidSdkVersion: 32,
      hl: "en",
      gl: "US",
    },
    userAgent:
      "com.google.android.apps.youtube.vr.oculus/1.62.27 " +
      "(Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
  },
  {
    name: "IOS",
    client: {
      clientName: "IOS",
      clientVersion: "19.45.4",
      deviceMake: "Apple",
      deviceModel: "iPhone16,2",
      osName: "iOS",
      osVersion: "18.1.0.22B83",
      hl: "en",
      gl: "US",
    },
    userAgent:
      "com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)",
  },
  {
    name: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
    client: {
      clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
      clientVersion: "2.0",
      hl: "en",
      gl: "US",
    },
    thirdParty: { embedUrl: "https://www.youtube.com" },
    userAgent:
      "Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 " +
      "(KHTML, like Gecko) Version/16.0 Safari/605.1.15",
  },
];

// Friendly, non-scary message for the transient per-IP anti-bot throttle.
const RATE_LIMIT_MSG =
  'YouTube is temporarily rate-limiting this network ("confirm you\'re not a ' +
  "bot\"). This usually clears within an hour — try again later. (Not a bug in " +
  "this tool.)";

// Set from --json in main(); routes runtime failures to JSON-on-stdout for agents.
let outputJsonErrors = false;

const HELP = `yt-transcript — grab a YouTube video's transcript

Usage:
  node grab.mjs [options] "<youtube-url>"

Options:
  (no flags)      Save "<title> - transcript.txt" to ~/Desktop, print "Saved: <path>".
  --stdout        Print the transcript (header + text) to stdout. No file is written.
  --json          Print a JSON object to stdout and write no file. Fields:
                  { videoId, title, channel, url, captionKind, grabbedAt, transcript }
  --out <path>    Write to <path>. If <path> is a directory, an auto filename is
                  created inside it; otherwise <path> is used as the file itself.
                  Combine with --stdout/--json to also print (the "Saved" line then
                  goes to stderr, keeping stdout clean for machines).
  -h, --help      Show this help and exit.

URL forms accepted: watch?v=, youtu.be/, shorts/, embed/, live/, extra query
params, and bare 11-char video IDs.

Exit codes: 0 success; 1 usage error, no captions, or video inaccessible.
Errors print "Error: <reason>" to stderr — except under --json, where a runtime
failure prints {"error":"<reason>"} to stdout (still exit 1) so agents can parse it.`;

class UsageError extends Error {}

// Runtime failure: JSON error object on stdout for agents (--json), else a plain
// "Error: <reason>" on stderr. Exit 1 either way.
function die(msg, code = 1) {
  if (outputJsonErrors) {
    process.stdout.write(JSON.stringify({ error: msg }) + "\n");
  } else {
    console.error(`Error: ${msg}`);
  }
  process.exit(code);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isBotBlock(reason) {
  return /not a bot|sign in to confirm|confirm you.?re not/i.test(reason || "");
}

// ---- arg parsing (pure, unit-testable) ------------------------------------
// Returns { help, stdout, json, out, url } or throws UsageError.
export function parseArgs(argv) {
  const opts = { help: false, stdout: false, json: false, out: null, url: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "--stdout") opts.stdout = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--out") {
      const val = argv[++i];
      if (!val || val.startsWith("--")) {
        throw new UsageError("--out requires a path argument");
      }
      opts.out = val;
    } else if (a.startsWith("--out=")) {
      const val = a.slice("--out=".length);
      if (!val) throw new UsageError("--out requires a path argument");
      opts.out = val;
    } else if (a.startsWith("-")) {
      throw new UsageError(`unknown option: ${a}`);
    } else if (opts.url === null) {
      opts.url = a;
    } else {
      throw new UsageError(`unexpected extra argument: ${a}`);
    }
  }
  if (!opts.help && !opts.url) throw new UsageError("no YouTube URL provided");
  if (opts.stdout && opts.json) {
    throw new UsageError("--stdout and --json cannot be combined");
  }
  return opts;
}

// ---- URL -> video id -------------------------------------------------------
export function extractVideoId(input) {
  if (!input) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input; // bare id
  let u;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = u.pathname.split("/").filter(Boolean)[0];
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }
  if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    const v = u.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex((p) =>
      ["shorts", "embed", "live", "v"].includes(p),
    );
    if (idx !== -1 && parts[idx + 1]) {
      const id = parts[idx + 1];
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
  }
  return null;
}

// ---- InnerTube player response for a given client --------------------------
async function getPlayerResponse(videoId, clientDef) {
  const context = { client: clientDef.client };
  if (clientDef.thirdParty) context.thirdParty = clientDef.thirdParty;
  const res = await fetch(
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": clientDef.userAgent,
        "X-Goog-Api-Format-Version": "2",
        "Accept-Language": "en-US,en;q=0.9",
      },
      body: JSON.stringify({
        videoId,
        context,
        contentCheckOk: true,
        racyCheckOk: true,
        playbackContext: {
          contentPlaybackContext: { html5Preference: "HTML5_PREF_WANTS" },
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---- caption track selection ----------------------------------------------
function pickTrack(tracks) {
  const isEng = (t) => (t.languageCode || "").toLowerCase().startsWith("en");
  const manualEng = tracks.find((t) => isEng(t) && t.kind !== "asr");
  if (manualEng) return { track: manualEng, kind: "manual English" };
  const autoEng = tracks.find((t) => isEng(t) && t.kind === "asr");
  if (autoEng) return { track: autoEng, kind: "auto-generated English" };
  const manualAny = tracks.find((t) => t.kind !== "asr");
  if (manualAny)
    return { track: manualAny, kind: `manual (${manualAny.languageCode})` };
  return {
    track: tracks[0],
    kind: `${tracks[0].languageCode || "unknown"}${tracks[0].kind === "asr" ? " auto-generated" : ""}`,
  };
}

// ---- timedtext fetch + parse ----------------------------------------------
async function fetchTranscriptText(baseUrl, userAgent) {
  const url = baseUrl.replace(/&fmt=[^&]*/g, "") + "&fmt=json3";
  const res = await fetch(url, {
    headers: { "User-Agent": userAgent, "Accept-Language": "en" },
  });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text.trim()) return null;

  if (text.trimStart().startsWith("{")) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (data && Array.isArray(data.events)) {
      const lines = [];
      for (const ev of data.events) {
        if (!ev.segs) continue;
        const line = ev.segs.map((s) => s.utf8 || "").join("");
        if (line.trim()) lines.push(line);
      }
      const joined = lines.join(" ");
      if (joined.trim()) return joined;
    }
  }
  if (text.includes("<p ") || text.includes("<text")) {
    return parseXmlTranscript(text);
  }
  return null;
}

function decodeEntities(s) {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&#34;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&"); // decode ampersand last
}

function parseXmlTranscript(xml) {
  const out = [];
  const re = /<(?:p|text)\b[^>]*>([\s\S]*?)<\/(?:p|text)>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const inner = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
    const t = decodeEntities(inner).trim();
    if (t) out.push(t);
  }
  const joined = out.join(" ");
  return joined.trim() ? joined : null;
}

// ---- text cleanup: fragments -> readable paragraphs ------------------------
function cleanTranscript(raw) {
  let t = decodeEntities(raw)
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
  const sentences = t.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g);
  if (!sentences) return t;
  const paras = [];
  let cur = [];
  for (const s of sentences) {
    cur.push(s.trim());
    if (cur.length >= 4) {
      paras.push(cur.join(" "));
      cur = [];
    }
  }
  if (cur.length) paras.push(cur.join(" "));
  return paras.join("\n\n");
}

// ---- filesystem-safe title + dedupe ---------------------------------------
function sanitizeTitle(title) {
  return (
    (title || "youtube video")
      .replace(/[\/\\:*?"<>|]/g, " ")
      .replace(/[\x00-\x1f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 150) || "youtube video"
  );
}

function uniquePath(dir, base, ext) {
  let p = join(dir, `${base}${ext}`);
  let n = 2;
  while (existsSync(p)) {
    p = join(dir, `${base} (${n})${ext}`);
    n++;
  }
  return p;
}

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Resolve the --out value to a concrete file path.
function resolveOutPath(out, defaultBase) {
  const abs = isAbsolute(out) ? out : resolve(process.cwd(), out);
  if (isDir(abs) || out.endsWith("/")) {
    return uniquePath(abs, defaultBase, ".txt");
  }
  return abs; // explicit file path (may overwrite)
}

// ---- transcript fetch (tries each client in order) -------------------------
async function grabTranscript(videoId) {
  let sawPlayableNoTracks = false; // a client played the video but had no captions
  let sawEmptyFeed = false; // captions existed but the feed came back empty
  let botBlocked = false; // a client hit the "not a bot" wall
  let lastReason = null; // last non-bot inaccessibility reason

  for (let i = 0; i < CLIENTS.length; i++) {
    if (i > 0) await sleep(500); // brief spacing; keeps ≤3 player requests/grab

    const clientDef = CLIENTS[i];
    let pr;
    try {
      pr = await getPlayerResponse(videoId, clientDef);
    } catch (e) {
      lastReason = e.message || String(e);
      continue; // network/HTTP hiccup on this client — try the next
    }

    const status = pr?.playabilityStatus?.status;
    if (status && status !== "OK") {
      const reason =
        pr?.playabilityStatus?.reason ||
        pr?.playabilityStatus?.errorScreen?.playerErrorMessageRenderer?.reason
          ?.simpleText ||
        status;
      if (isBotBlock(reason)) botBlocked = true;
      else lastReason = reason;
      continue;
    }

    const tracks =
      pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    if (tracks.length === 0) {
      sawPlayableNoTracks = true; // genuinely no captions from a playable client
      continue;
    }

    const picked = pickTrack(tracks);
    const raw = await fetchTranscriptText(picked.track.baseUrl, clientDef.userAgent);
    if (!raw) {
      sawEmptyFeed = true; // likely POT/rate-limit on the feed — try next client
      continue;
    }

    // Success.
    const details = pr?.videoDetails || {};
    const now = new Date();
    return {
      videoId,
      title: details.title || "youtube video",
      channel: details.author || "Unknown channel",
      url: `https://www.youtube.com/watch?v=${videoId}`,
      captionKind: picked.kind,
      grabbedAt: now.toISOString(),
      grabbedAtHuman: now.toString(),
      transcript: cleanTranscript(raw),
    };
  }

  // All clients exhausted — report the most informative cause.
  if (sawPlayableNoTracks) die("no captions available for this video");
  if (botBlocked || sawEmptyFeed) die(RATE_LIMIT_MSG);
  die(`Video is not accessible: ${lastReason || "unknown reason"}`);
}

function renderText(d) {
  const header =
    `${d.title}\n` +
    `Channel: ${d.channel}\n` +
    `URL: ${d.url}\n` +
    `Captions: ${d.captionKind}\n` +
    `Grabbed: ${d.grabbedAtHuman}\n` +
    `${"=".repeat(64)}\n\n`;
  return header + d.transcript + "\n";
}

// ---- main ------------------------------------------------------------------
async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`Error: ${e.message}\n`);
      console.error(HELP);
      process.exit(1);
    }
    throw e;
  }

  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }

  // From here on, runtime failures should honor --json (JSON error on stdout).
  outputJsonErrors = opts.json;

  const videoId = extractVideoId(opts.url);
  if (!videoId) die(`Could not parse a YouTube video id from: ${opts.url}`);

  const data = await grabTranscript(videoId);
  const rendered = renderText(data);

  // Decide whether we write a file: default (no --stdout/--json) writes to the
  // Desktop; --out always writes; --stdout/--json alone suppress the file.
  const writeFile = !!opts.out || (!opts.stdout && !opts.json);

  // stdout payload (kept machine-clean for --stdout/--json).
  if (opts.json) {
    const { grabbedAtHuman, ...jsonOut } = data;
    process.stdout.write(JSON.stringify(jsonOut, null, 2) + "\n");
  } else if (opts.stdout) {
    process.stdout.write(rendered);
  }

  if (writeFile) {
    const defaultBase = `${sanitizeTitle(data.title)} - transcript`;
    const outPath = opts.out
      ? resolveOutPath(opts.out, defaultBase)
      : uniquePath(join(homedir(), "Desktop"), defaultBase, ".txt");
    writeFileSync(outPath, rendered, "utf8");
    // In default mode print to stdout (unchanged). When also printing machine
    // output, send the confirmation to stderr so stdout stays clean.
    if (opts.stdout || opts.json) console.error(`Saved: ${outPath}`);
    else console.log(`Saved: ${outPath}`);
  }
}

// Only run when executed directly (so tests can import parseArgs/extractVideoId).
const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main().catch((e) => die(e?.message || String(e)));
}
