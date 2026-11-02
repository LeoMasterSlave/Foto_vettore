// Fluidità di zoom/pan: vecchia versione (SVG) contro dev (canvas), CPU rallentata 4× come un telefono
const { chromium } = require('playwright');
async function measure(url, target, prep, label, vw, vh){
  const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:vw,height:vh},deviceScaleFactor:3}); const pg=await ctx.newPage();
  await pg.goto(url); await pg.setInputFiles('#file',process.env.FOTO||'foto.png'); await pg.waitForTimeout(2500);
  await prep(pg); await pg.waitForTimeout(4000);
  const n=await pg.evaluate(()=>window.__fv?window.__fv.S.paths.length:document.querySelectorAll('#vec path').length);
  const cdp=await ctx.newCDPSession(pg); await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  const box=await pg.locator(target).boundingBox(); const cx=box.x+box.width/2, cy=box.y+box.height/2;
  // zoom in prima, poi trascinamenti e zoom alternati
  await pg.mouse.move(cx,cy); for(let i=0;i<6;i++){ await pg.mouse.wheel(0,-120); }
  await pg.waitForTimeout(500);
  await pg.evaluate(()=>{ window.__fr=[]; let last=performance.now(); window.__on=true; const f=(t)=>{ window.__fr.push(t-last); last=t; if(window.__on) requestAnimationFrame(f); }; requestAnimationFrame(f); });
  const t0=Date.now();
  await pg.mouse.move(cx,cy); await pg.mouse.down();
  for(let i=0;i<60;i++){ await pg.mouse.move(cx+Math.sin(i/6)*140, cy+Math.cos(i/7)*110); }
  await pg.mouse.up();
  for(let i=0;i<20;i++){ await pg.mouse.wheel(0,i%2?90:-90); }
  const dur=Date.now()-t0;
  const fr=await pg.evaluate(()=>{ window.__on=false; return window.__fr.slice(2); });
  fr.sort((a,b)=>a-b); const avg=fr.reduce((a,b)=>a+b,0)/fr.length;
  console.log(label, 'paths',n,'frames',fr.length,'in',dur,'ms | fps medio',(1000/avg).toFixed(1),'| p95',fr[Math.floor(fr.length*0.95)].toFixed(0),'ms | frame >50ms',fr.filter(x=>x>50).length);
  await b.close();
}
(async()=>{
  for (const [vw,vh] of [[390,844],[1440,900]]) {
    await measure((process.env.BASE||'http://127.0.0.1:8765')+'/old/index.html','#frame',async()=>{},'VECCHIA '+vw,vw,vh);
    await measure((process.env.BASE||'http://127.0.0.1:8765')+'/dev/index.html?ort=/mock_ort.js','#cv',async(pg)=>{ await pg.click('[data-mode="classic"]'); await pg.click('[data-act="convert"]'); },'DEV     '+vw,vw,vh);
  }
})();
