#!/usr/bin/env node
// Offline self-check for URL parsing + arg parsing (no network).
// Run: node url.test.mjs
import assert from "node:assert/strict";
import { extractVideoId, parseArgs } from "./grab.mjs";

const ID = "dQw4w9WgXcQ";

// --- URL -> video id ---
const urlCases = [
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
for (const [input, expected] of urlCases) {
  assert.equal(extractVideoId(input), expected, `parse failed for: ${input}`);
  pass++;
}

// --- arg parsing ---
const U = "https://youtu.be/dQw4w9WgXcQ";
assert.deepEqual(parseArgs([U]), {
  help: false,
  stdout: false,
  json: false,
  out: null,
  url: U,
});
assert.equal(parseArgs(["--stdout", U]).stdout, true);
assert.equal(parseArgs(["--json", U]).json, true);
assert.equal(parseArgs(["--out", "/tmp/x.txt", U]).out, "/tmp/x.txt");
assert.equal(parseArgs([`--out=/tmp/y.txt`, U]).out, "/tmp/y.txt");
assert.equal(parseArgs([U, "--json"]).json, true); // order independent
assert.equal(parseArgs(["--help"]).help, true); // help without url ok
pass += 7;

// --- arg parsing errors ---
const errCases = [
  [[], "no url"],
  [["--stdout", "--json", U], "stdout+json combined"],
  [["--out"], "out missing path"],
  [["--bogus", U], "unknown flag"],
  [[U, "extra", "arg"], "extra positional"],
];
for (const [argv, label] of errCases) {
  assert.throws(() => parseArgs(argv), /.*/, `should have thrown: ${label}`);
  pass++;
}

console.log(
  `url.test.mjs: ${pass} checks passed (${urlCases.length} URL, 7 arg, ${errCases.length} arg-error)`,
);
