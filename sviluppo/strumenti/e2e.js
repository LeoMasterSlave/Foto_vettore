// E2E della versione dev: node e2e.js <foto> <x0,y0,x1,y1> <mode> <w> <h> <prefisso>
const { chromium, devices } = require('playwright'); const fs=require('fs');
const [foto, boxs, mode, vw, vh, pre] = process.argv.slice(2);
(async()=>{
  const b=await chromium.launch();
  const mobile = +vw < 900;
  const ctx=await b.newContext(mobile?{viewport:{width:+vw,height:+vh},deviceScaleFactor:3,isMobile:true,hasTouch:true}:{viewport:{width:+vw,height:+vh},deviceScaleFactor:2,acceptDownloads:true});
  const pg=await ctx.newPage(); const errs=[];
  pg.on('pageerror',e=>errs.push('PE '+e.message)); pg.on('console',m=>{ if(m.type()==='error') errs.push('CE '+m.text()); });
  await pg.addInitScript(()=>{ window.__lt=[]; try{ new PerformanceObserver(l=>{ for(const e of l.getEntries()) window.__lt.push(e.duration); }).observe({type:'longtask',buffered:true}); }catch(e){} });
  await pg.goto((process.env.BASE||'http://127.0.0.1:8765')+'/dev/index.html?ort=/mock_ort.js');
  await pg.waitForTimeout(600); await pg.screenshot({path:pre+'_1empty.png'});
  await pg.setInputFiles('#file', foto); await pg.waitForTimeout(1500);
  await pg.screenshot({path:pre+'_2box.png'});
  const det = await pg.evaluate(()=>window.__fv.S.box);
  console.log('detected box', JSON.stringify(det.map(Math.round)));
  if (boxs!=='auto') await pg.evaluate((bx)=>{ window.__fv.S.box=bx; window.__fv.fitView(false,true); }, boxs.split(',').map(Number));
  await pg.click(`[data-mode="${mode}"]`); await pg.waitForTimeout(200);
  const t0=Date.now(); await pg.click('[data-act="convert"]');
  let shot=false;
  for(let i=0;i<120;i++){ await pg.waitForTimeout(5000); const st=await pg.evaluate(()=>({ph:window.__fv.S.phase, msg:(document.getElementById('pmsg')||{}).textContent, n:window.__fv.S.paths.length}));
    if(i%6===0) console.log(Math.round((Date.now()-t0)/1000)+'s', JSON.stringify(st));
    if(!shot && st.ph==='run'){ await pg.screenshot({path:pre+'_3run.png'}); shot=true; }
    if(st.ph!=='run') break; }
  console.log('total', Math.round((Date.now()-t0)/1000),'s');
  await pg.waitForTimeout(800);
  await pg.screenshot({path:pre+'_4result.png'});
  const info=await pg.evaluate(()=>({info:window.__fv.S.info, timings:window.__fv.S.timings, lt:window.__lt, perf:document.getElementById('perf').textContent, ai:window.__fv.AIW.mode}));
  const lt=info.lt; console.log('info',JSON.stringify(info.info)); console.log('perf',info.perf,'| AI mode',info.ai);
  console.log('longtasks n',lt.length,'max',Math.round(Math.max(0,...lt)),'sum',Math.round(lt.reduce((a,b)=>a+b,0)));
  fs.writeFileSync(pre+'_paths.json', JSON.stringify(await pg.evaluate(()=>window.__fv.S.paths)));
  fs.writeFileSync(pre+'.dxf', await pg.evaluate(()=>window.__fv.buildDXF()));
  // vista insieme
  await pg.click('[data-view="over"]'); await pg.waitForTimeout(300); await pg.screenshot({path:pre+'_5over.png'});
  await pg.click('[data-view="draw"]');
  console.log('errors',errs.slice(0,8));
  await b.close();
})();
