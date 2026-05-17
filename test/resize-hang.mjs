// Reproduces the "hang after a few resizes" symptom without a browser.
//
// Mimics ghostty-web's protocol: SSE in, fetch /pty/input out, with a
// shim that replies to any cursor-position query (\x1b[6n) with a fake
// position (\x1b[1;1R). That's all reedline needs from the terminal to
// drive its handle_resize path.
//
// Run:
//   node ~/ghostty-web-nu/test/resize-hang.mjs

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const HTTP_NU = resolve(REPO_ROOT, "..", "http-nu-pty", "target", "debug", "http-nu");
const SERVE_NU = resolve(REPO_ROOT, "serve.nu");

const PORT = 39000 + (process.pid % 1000);
const BASE = `http://127.0.0.1:${PORT}`;

const srv = spawn(HTTP_NU, [`127.0.0.1:${PORT}`, SERVE_NU], {
  stdio: ["ignore", "pipe", "pipe"],
});
const srvLog = [];
srv.stdout.on("data", (b) => srvLog.push(b.toString()));
srv.stderr.on("data", (b) => srvLog.push(b.toString()));
const cleanup = () => { try { srv.kill("SIGKILL"); } catch {} };
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

async function waitReady() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server didn't come up");
}
await waitReady();
console.log("server up on", BASE);

// Create a pty session.
const created = await fetch(`${BASE}/pty/create`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ cols: 80, rows: 24 }),
}).then((r) => r.json());
const sid = created.sid;
console.log("sid", sid);

// Counters we'll observe to detect hang.
let outputBytes = 0;
let lastOutputAt = Date.now();
let cursorQueries = 0;

const sendInput = (data) =>
  fetch(`${BASE}/pty/input?sid=${encodeURIComponent(sid)}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: data,
  }).catch(() => {});

const sendResize = (cols, rows) =>
  fetch(`${BASE}/pty/resize?sid=${encodeURIComponent(sid)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cols, rows }),
  }).catch(() => {});

// Stream /pty/stream as SSE. Each "data: <b64>\n\n" frame is one chunk.
async function streamLoop() {
  const res = await fetch(`${BASE}/pty/stream?sid=${encodeURIComponent(sid)}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    // Split out complete events.
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (!frame.startsWith("data: ")) continue;
      const b64 = frame.slice(6);
      const bytes = Buffer.from(b64, "base64");
      outputBytes += bytes.length;
      lastOutputAt = Date.now();
      // Reply to any cursor-position query (\x1b[6n) with row 1 col 1.
      // Some queries can be sequenced (multiple [6n in one chunk).
      let i = 0;
      while ((i = bytes.indexOf(Buffer.from("\x1b[6n"), i)) !== -1) {
        cursorQueries++;
        const delay = Number(process.env.QUERY_DELAY_MS || "30");
        setTimeout(() => sendInput("\x1b[1;1R"), delay);
        i += 4;
      }
    }
  }
}
streamLoop().catch((e) => console.error("stream loop:", e));

// Helper: send a keystroke and verify reedline produces echo within timeout.
async function nudge(label, timeoutMs = 3000) {
  const startBytes = outputBytes;
  const startQueries = cursorQueries;
  await sendInput(`echo nudge-${label}\n`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (outputBytes > startBytes + 32) return { ok: true, growth: outputBytes - startBytes, q: cursorQueries - startQueries };
    await new Promise((r) => setTimeout(r, 50));
  }
  return { ok: false, growth: outputBytes - startBytes, q: cursorQueries - startQueries };
}

// Let the REPL settle (banner + first prompt).
await new Promise((r) => setTimeout(r, 1500));
console.log("settled. outputBytes=", outputBytes, " cursorQueries=", cursorQueries);

// Baseline.
const baseline = await nudge("baseline");
console.log("baseline:", baseline);
if (!baseline.ok) {
  console.error("baseline failed -- REPL never produced output");
  console.error(srvLog.join("").slice(-2000));
  cleanup();
  process.exit(2);
}

// Resize passes.
const SIZES = [
  [80, 24], [90, 28], [110, 30], [100, 26], [95, 25],
  [80, 22], [120, 32], [85, 28], [105, 30], [90, 24],
];
for (let pass = 1; pass <= 3; pass++) {
  console.log(`--- pass ${pass}: ${SIZES.length} resizes ---`);
  for (const [c, r] of SIZES) {
    sendResize(c, r);
    await new Promise((r2) => setTimeout(r2, 30));
  }
  await new Promise((r) => setTimeout(r, 800));
  const res = await nudge(`after-pass-${pass}`);
  console.log(`pass ${pass}:`, res);
  if (!res.ok) {
    console.error("HUNG after pass", pass);
    console.error("--- last server log ---");
    console.error(srvLog.join("").slice(-3000));
    cleanup();
    process.exit(3);
  }
}

console.log("PASS -- responsive across all resize passes");
cleanup();
process.exit(0);
