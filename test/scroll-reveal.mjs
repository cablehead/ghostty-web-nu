import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
const H="/root/http-nu-pty-projection/target/release/http-nu", S="/root/ghostty-web-nu-projection/serve-sessions.nu", C="/root/.cache/ms-playwright/chromium-1181/chrome-linux/chrome";
const P=5090,B=`http://127.0.0.1:${P}`,ST="/tmp/xs-scroll"; rmSync(ST,{recursive:true,force:true});
const srv=spawn(H,["--datastar","--store",ST,`127.0.0.1:${P}`,S],{stdio:["ignore","pipe","pipe"]});
process.on("exit",()=>{try{srv.kill("SIGKILL")}catch{}});
for(let i=0;i<60;i++){try{if((await fetch(B)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
const br=await chromium.launch({executablePath:C,headless:true});
const pg=await(await br.newContext({viewport:{width:1000,height:600}})).newPage();
pg.on("pageerror",e=>console.log("[err]",e.message));
await pg.goto(B); await pg.waitForFunction(()=>document.querySelector('#doc .pane [data-cols]'),{timeout:8000});
await new Promise(r=>setTimeout(r,500));
// 4 panes total (each ~432px, viewport 600 -> overflows)
for(let i=0;i<3;i++){ await pg.keyboard.press('Alt+t'); await new Promise(r=>setTimeout(r,500)); }
await new Promise(r=>setTimeout(r,500));
const n = await pg.evaluate(()=>document.querySelectorAll('#doc .pane').length);
console.log("panes:", n);
// Navigate down through panes (Alt+J) and check active pane bottom visible each time
async function check(label){
  const r = await pg.evaluate(()=>{
    const a=document.querySelector('#doc .pane.active'); const d=document.getElementById('doc');
    if(!a) return {none:true};
    const ar=a.getBoundingClientRect(), dr=d.getBoundingClientRect();
    return { sid:a.dataset.sid.slice(-5), bottomVisible: ar.bottom<=dr.bottom+2, topVisible: ar.top>=dr.top-2 };
  });
  console.log(label, JSON.stringify(r));
}
await check("initial active");
for(let i=0;i<3;i++){ await pg.keyboard.press('Alt+j'); await new Promise(r=>setTimeout(r,400)); await check("after Alt+J #"+(i+1)); }
for(let i=0;i<2;i++){ await pg.keyboard.press('Alt+k'); await new Promise(r=>setTimeout(r,400)); await check("after Alt+K #"+(i+1)); }
await br.close(); process.exit(0);
