import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
const H="/root/http-nu-pty-projection/target/release/http-nu", S="/root/ghostty-web-nu-projection/serve-sessions.nu", C="/root/.cache/ms-playwright/chromium-1181/chrome-linux/chrome";
const P=5092,B=`http://127.0.0.1:${P}`,ST="/tmp/xs-recon"; rmSync(ST,{recursive:true,force:true});
const srv=spawn(H,["--datastar","--store",ST,`127.0.0.1:${P}`,S],{stdio:["ignore","pipe","pipe"]});
process.on("exit",()=>{try{srv.kill("SIGKILL")}catch{}});
for(let i=0;i<60;i++){try{if((await fetch(B)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
const br=await chromium.launch({executablePath:C,headless:true});

// Client A: make 2 sessions, type markers
const a=await(await br.newContext({viewport:{width:1000,height:700}})).newPage();
await a.goto(B); await a.waitForFunction(()=>document.querySelector('#doc .pane [data-cols]'),{timeout:8000});
await new Promise(r=>setTimeout(r,600));
await a.keyboard.press('Enter'); await new Promise(r=>setTimeout(r,200));
await a.keyboard.type('echo AMARK'); await a.keyboard.press('Enter'); await new Promise(r=>setTimeout(r,500));
await a.keyboard.press('Alt+Escape'); await a.keyboard.press('Alt+t');
await a.waitForSelector('.modal-backdrop[data-show] .picker',{state:'visible',timeout:3000}).catch(()=>{});
await a.click('.picker-row:has-text("Terminal")');
await a.waitForFunction(()=>document.querySelectorAll('#doc .pane').length>=2,{timeout:5000});
await new Promise(r=>setTimeout(r,600));
console.log("A panes:", await a.evaluate(()=>document.querySelectorAll('#doc .pane').length));

// Client B: fresh connect to same server -- should show current state
const b=await(await br.newContext({viewport:{width:1000,height:700}})).newPage();
await b.goto(B); 
await new Promise(r=>setTimeout(r,1200));
const bstate = await b.evaluate(()=>({
  panes: document.querySelectorAll('#doc .pane').length,
  withContent: [...document.querySelectorAll('#doc .pane')].filter(p=>p.textContent.includes('$')).length,
  hasAMARK: [...document.querySelectorAll('#doc .pane')].some(p=>p.textContent.includes('AMARK')),
}));
console.log("B (fresh connect) state:", JSON.stringify(bstate));

// Reconnect A's /sse via visibilitychange (datastar reopens on visible)
await a.evaluate(async ()=>{
  Object.defineProperty(document,'hidden',{value:true,configurable:true});
  document.dispatchEvent(new Event('visibilitychange'));
  await new Promise(r=>setTimeout(r,300));
  Object.defineProperty(document,'hidden',{value:false,configurable:true});
  document.dispatchEvent(new Event('visibilitychange'));
});
await new Promise(r=>setTimeout(r,1200));
const aAfter = await a.evaluate(()=>({
  panes: document.querySelectorAll('#doc .pane').length,
  withContent: [...document.querySelectorAll('#doc .pane')].filter(p=>p.textContent.includes('$')).length,
}));
console.log("A after reconnect:", JSON.stringify(aAfter));
await br.close(); process.exit(0);
