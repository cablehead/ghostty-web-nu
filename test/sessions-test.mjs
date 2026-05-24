import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
const HTTP_NU = "/root/http-nu-pty-projection/target/release/http-nu";
const SERVE = "/root/ghostty-web-nu-projection/serve-sessions.nu";
const CHROMIUM = "/root/.cache/ms-playwright/chromium-1181/chrome-linux/chrome";
const PORT = 5098, BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(HTTP_NU, ["--datastar", `127.0.0.1:${PORT}`, SERVE], { stdio: ["ignore","pipe","pipe"] });
const log = []; srv.stdout.on("data",b=>log.push(b.toString())); srv.stderr.on("data",b=>log.push(b.toString()));
process.on("exit", () => { try { srv.kill("SIGKILL"); } catch {} });
for (let i=0;i<50;i++){ try { if ((await fetch(BASE)).ok) break; } catch {} await new Promise(r=>setTimeout(r,100)); }
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
const page = await (await browser.newContext({ viewport:{width:1200,height:700} })).newPage();
page.on("pageerror", e => console.log("[err]", e.message));

await page.goto(BASE);
// Wait for the sidebar to render a session and the grid to get content.
await page.waitForFunction(() => {
  const li = document.querySelectorAll('#sessions-list li').length;
  const cols = document.getElementById('grid')?.dataset.cols;
  return li >= 1 && cols;
}, { timeout: 8000 });
await new Promise(r=>setTimeout(r,700));

async function snap(label) {
  const i = await page.evaluate(() => {
    const sel = document.querySelector('#sessions-list li.selected .row');
    return {
      sessions: document.querySelectorAll('#sessions-list li').length,
      selectedSidAttr: document.getElementById('screen').dataset.sid?.slice(0,8),
      gridCols: document.getElementById('grid').dataset.cols,
      gridRows: document.getElementById('grid').dataset.rows,
      statusDims: document.querySelector('.statusbar span:last-child').textContent,
      gridHasPrompt: [...document.querySelectorAll('#grid .row')].some(r => r.textContent.includes('$')),
    };
  });
  console.log(label, JSON.stringify(i));
  return i;
}
const s1 = await snap("initial");

// Type a marker into the focused session
await page.keyboard.type('echo TAB_ONE');
await page.keyboard.press('Enter');
await new Promise(r=>setTimeout(r,600));
const afterType = await page.evaluate(() =>
  [...document.querySelectorAll('#grid .row')].some(r => r.textContent.includes('TAB_ONE')));
console.log("typed TAB_ONE visible:", afterType);

// Alt+T -> new session
await page.keyboard.press('Alt+t');
await page.waitForFunction((prev) => document.querySelectorAll('#sessions-list li').length > prev, s1.sessions, { timeout: 5000 });
await new Promise(r=>setTimeout(r,700));
const s2 = await snap("after Alt+T");

// The new session should be selected and NOT show TAB_ONE
const tabTwoFresh = await page.evaluate(() =>
  ![...document.querySelectorAll('#grid .row')].some(r => r.textContent.includes('TAB_ONE')));
console.log("new tab is fresh (no TAB_ONE):", tabTwoFresh);

// Alt+K -> previous session (back to tab one), should show TAB_ONE again
await page.keyboard.press('Alt+k');
await new Promise(r=>setTimeout(r,700));
const backToOne = await page.evaluate(() =>
  [...document.querySelectorAll('#grid .row')].some(r => r.textContent.includes('TAB_ONE')));
console.log("Alt+K back to tab one shows TAB_ONE:", backToOne);

await browser.close();
process.on("exit", () => process.stdout.write(log.join("")));
process.exit(0);
