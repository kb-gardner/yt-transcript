#!/usr/bin/env node
// Offline self-check for URL -> video id parsing (no network). Run: node url.test.mjs
// grab.mjs's extractVideoId is duplicated here in spirit via import of the module's
// behavior — kept in sync manually since grab.mjs doesn't export (tiny tool).
import assert from "node:assert/strict";

// Mirror of grab.mjs::extractVideoId (keep in sync if that changes).
function extractVideoId(input) {
  if (!input) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
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

const ID = "dQw4w9WgXcQ";
const cases = [
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", ID],
  ["https://youtube.com/watch?v=dQw4w9WgXcQ", ID],
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDxyz&index=2", ID],
  ["https://youtu.be/dQw4w9WgXcQ", ID],
  ["https://youtu.be/dQw4w9WgXcQ?si=abc123", ID],
  ["https://www.youtube.com/shorts/dQw4w9WgXcQ", ID],
  ["https://www.youtube.com/embed/dQw4w9WgXcQ", ID],
  ["https://www.youtube.com/live/dQw4w9WgXcQ", ID],
  ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", ID],
  ["dQw4w9WgXcQ", ID],
  ["https://example.com/watch?v=dQw4w9WgXcQ", null],
  ["not-a-url", null],
  ["", null],
];

let pass = 0;
for (const [input, expected] of cases) {
  assert.equal(extractVideoId(input), expected, `parse failed for: ${input}`);
  pass++;
}
console.log(`url.test.mjs: ${pass}/${cases.length} URL-shape checks passed`);
