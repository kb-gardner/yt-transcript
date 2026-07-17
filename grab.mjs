#!/usr/bin/env node
// grab.mjs — fetch a YouTube video's transcript/captions and save it as a
// plain-text file on the Desktop. Zero npm dependencies; plain Node ESM.
//
// Usage:  node grab.mjs "<youtube-url>"
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
// See CLAUDE.md for the "why this and not X" history and the fragility caveats.

import { writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Android VR (Oculus) InnerTube client — the caption URLs it returns still work
// without a Proof-of-Origin token. Bump clientVersion if YouTube ever rejects it.
const VR_CLIENT = {
  clientName: "ANDROID_VR",
  clientVersion: "1.62.27",
  deviceMake: "Oculus",
  deviceModel: "Quest 3",
  osName: "Android",
  osVersion: "12L",
  androidSdkVersion: 32,
  hl: "en",
  gl: "US",
  userAgent:
    "com.google.android.apps.youtube.vr.oculus/1.62.27 " +
    "(Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
};

function die(msg, code = 1) {
  console.error(`Error: ${msg}`);
  process.exit(code);
}

// ---- URL -> video id -------------------------------------------------------
function extractVideoId(input) {
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
    // /shorts/<id>, /embed/<id>, /live/<id>, /v/<id>
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

// ---- InnerTube player response (Android VR client) -------------------------
async function getPlayerResponse(videoId) {
  const res = await fetch(
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": VR_CLIENT.userAgent,
        "X-Goog-Api-Format-Version": "2",
        "Accept-Language": "en-US,en;q=0.9",
      },
      body: JSON.stringify({
        videoId,
        context: { client: VR_CLIENT },
        contentCheckOk: true,
        racyCheckOk: true,
        playbackContext: {
          contentPlaybackContext: { html5Preference: "HTML5_PREF_WANTS" },
        },
      }),
    },
  );
  if (!res.ok) die(`YouTube player request failed (HTTP ${res.status}).`);
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
async function fetchTranscriptText(baseUrl) {
  // Force json3 (the Android VR baseUrl defaults to srv3 XML); json3 is the
  // cleanest to parse. Fall back to XML parsing if we get XML anyway.
  const url = baseUrl.replace(/&fmt=[^&]*/g, "") + "&fmt=json3";
  const res = await fetch(url, {
    headers: { "User-Agent": VR_CLIENT.userAgent, "Accept-Language": "en" },
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
  // srv3 / legacy XML fallback: text lives in <p>…</p> (or <text>…</text>).
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
    // Strip nested <s> word tags, collapse whitespace, decode entities.
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
  // Group sentences into small paragraphs for readability.
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
      .replace(/[\/\\:*?"<>|]/g, " ") // illegal on macOS/Windows filesystems
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

// ---- main ------------------------------------------------------------------
async function main() {
  const arg = process.argv[2];
  if (!arg) die('Usage: node grab.mjs "<youtube-url>"');

  const videoId = extractVideoId(arg);
  if (!videoId) die(`Could not parse a YouTube video id from: ${arg}`);

  const pr = await getPlayerResponse(videoId);

  const status = pr?.playabilityStatus?.status;
  if (status && status !== "OK") {
    const reason =
      pr?.playabilityStatus?.reason ||
      pr?.playabilityStatus?.errorScreen?.playerErrorMessageRenderer?.reason
        ?.simpleText ||
      status;
    die(`Video is not accessible: ${reason}`);
  }

  const tracks =
    pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (tracks.length === 0) die("no captions available for this video");

  const picked = pickTrack(tracks);
  const raw = await fetchTranscriptText(picked.track.baseUrl);
  if (!raw) {
    die("no captions available for this video (caption feed was empty)");
  }

  const body = cleanTranscript(raw);

  const details = pr?.videoDetails || {};
  const title = details.title || "youtube video";
  const channel = details.author || "Unknown channel";
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  const header =
    `${title}\n` +
    `Channel: ${channel}\n` +
    `URL: ${url}\n` +
    `Captions: ${picked.kind}\n` +
    `Grabbed: ${new Date().toString()}\n` +
    `${"=".repeat(64)}\n\n`;

  const desktop = join(homedir(), "Desktop");
  const outPath = uniquePath(
    desktop,
    `${sanitizeTitle(title)} - transcript`,
    ".txt",
  );
  writeFileSync(outPath, header + body + "\n", "utf8");

  console.log(`Saved: ${outPath}`);
}

main().catch((e) => die(e?.message || String(e)));
