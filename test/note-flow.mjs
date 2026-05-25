import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
const HTTP_NU = "/root/http-nu-pty-projection/target/release/http-nu";
const SERVE = "/root/ghostty-web-nu-projection/serve-sessions.nu";
const CHROMIUM = "/root/.cache/ms-playwright/chromium-1181/chrome-linux/chrome";
const PORT = 5095, BASE = `http://127.0.0.1:${PORT}`, STORE = "/tmp/xs-note";
rmSync(STORE, { recursive: true, force: true });
const srv = spawn(HTTP_NU, ["--datastar","--store",STORE,`127.0.0.1:${PORT}`,SERVE], { stdio:["ignore","pipe","pipe"] });
const log=[]; srv.stdout.on("data",b=>log.push(b.toString())); srv.stderr.on("data",b=>log.push(b.toString()));
process.on("exit",()=>{try{srv.kill("SIGKILL")}catch{}});
for(let i=0;i<60;i++){try{if((await fetch(BASE)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
const ctx = await browser.newContext({viewport:{width:1200,height:800}});
let page = await ctx.newPage();
page.on("pageerror",e=>console.log("[err]",e.message));
await page.goto(BASE);
await page.waitForFunction(()=>document.querySelectorAll('#doc .pane').length>=1,{timeout:8000});
await new Promise(r=>setTimeout(r,800));

const NOTE = "first line\nsecond line";

// Alt+T -> picker -> Note. New note pane appears, selected, textarea focused.
await page.keyboard.press('Alt+t');
await page.waitForSelector('.modal-backdrop[data-show] .picker', {state:'visible', timeout:3000}).catch(()=>{});
await page.click('.picker-row:has-text("Note")');
await page.waitForFunction(()=>document.querySelector('#doc .pane[data-kind="note"]'),{timeout:5000});
await new Promise(r=>setTimeout(r,600));
const noteCid = await page.evaluate(()=>document.querySelector('#doc .pane[data-kind="note"]')?.dataset.clip);
console.log("note clip:", noteCid?.slice(0,8));
const focusedNote = await page.evaluate(()=>document.activeElement?.classList.contains('note-edit'));
console.log("note textarea focused on create:", focusedNote, "(want true)");

// Type multi-line text (Enter must insert newlines, not trigger focus action).
await page.keyboard.type("first line");
await page.keyboard.press('Enter');
await page.keyboard.type("second line");
const taVal = await page.evaluate(()=>document.querySelector('#doc .pane[data-kind="note"] .note-edit')?.value);
console.log("textarea value:", JSON.stringify(taVal), "| multiline ok:", taVal===NOTE, "(want true)");

// Escape ends editing -> renders as <pre>, hides textarea, persists.
await page.keyboard.press('Escape');
await new Promise(r=>setTimeout(r,400));
const rendered = await page.evaluate(()=>{
  const p = document.querySelector('#doc .pane[data-kind="note"]');
  const pre = p.querySelector('.note-pre'), ta = p.querySelector('.note-edit');
  return { preText: pre?.textContent, preShown: getComputedStyle(pre).display!=='none', taHidden: getComputedStyle(ta).display==='none' };
});
console.log("after blur:", JSON.stringify(rendered), "| pre matches:", rendered.preText===NOTE);

// Reload -> note pane persists with its body (CAS clip.update replayed).
await new Promise(r=>setTimeout(r,300));
page = await ctx.newPage();
await page.goto(BASE);
await page.waitForFunction(()=>document.querySelector('#doc .pane[data-kind="note"]'),{timeout:8000});
await new Promise(r=>setTimeout(r,600));
const persisted = await page.evaluate(()=>document.querySelector('#doc .pane[data-kind="note"] .note-pre')?.textContent);
console.log("after reload pre:", JSON.stringify(persisted), "| persisted:", persisted===NOTE, "(want true)");

console.log("[warnings]", log.join("").split("\n").filter(l=>/NoTargetsFound|error/i.test(l)).slice(0,3).join(" | "));
await browser.close(); process.exit(0);
