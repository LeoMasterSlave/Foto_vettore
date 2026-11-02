const { chromium } = require('playwright'); const fs=require('fs');
(async()=>{
  const b=await chromium.launch(); const errs=[];
  for (const scheme of ['light','dark']) {
  const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,colorScheme:scheme});
  const pg=await ctx.newPage(); pg.on('pageerror',e=>errs.push(e.message));
  await pg.goto((process.env.BASE||'http://127.0.0.1:8765')+'/dev/index.html?ort=/mock_ort.js');
  await pg.setInputFiles('#file',process.env.FOTO2||process.env.FOTO||'foto.png'); await pg.waitForTimeout(1500);
  await pg.click('[data-mode="fast"]'); await pg.click('[data-act="convert"]');
  await pg.waitForFunction(()=>window.__fv.S.phase==='result',null,{timeout:200000}); await pg.waitForTimeout(900);
  await pg.screenshot({path:`u_${scheme}_1result.png`});
  if (scheme==='light') {
    // foglio aperto
    await pg.tap('#grab'); await pg.waitForTimeout(900); await pg.screenshot({path:'u_2sheet.png'});
    await pg.tap('#grab'); await pg.waitForTimeout(900);
    // modifica: tocco su una linea
    await pg.tap('#b-edit'); await pg.waitForTimeout(300);
    const pt=await pg.evaluate(()=>{ const f=window.__fv, p=f.S.paths.find(q=>q.l===1)||f.S.paths[0]; const x=p.v[0],y=p.v[1]; return {x:x*f.V.s+f.V.tx, y:y*f.V.s+f.V.ty, n:f.S.paths.length}; });
    const r=await pg.locator('#cv').boundingBox(); await pg.tap('#cv',{position:{x:pt.x,y:pt.y}}); await pg.waitForTimeout(400);
    const sel=await pg.evaluate(()=>window.__fv.S.sel); await pg.screenshot({path:'u_3edit.png'});
    await pg.tap('#b-del'); await pg.waitForTimeout(200); const n1=await pg.evaluate(()=>window.__fv.S.paths.length);
    await pg.tap('#b-undo'); await pg.waitForTimeout(200); const n2=await pg.evaluate(()=>window.__fv.S.paths.length);
    console.log('edit: sel',sel,'paths',pt.n,'-> del',n1,'-> undo',n2);
    // pinch zoom via CDP touch
    const cdp=await ctx.newCDPSession(pg); const s0=await pg.evaluate(()=>window.__fv.V.s);
    const cx=r.x+r.width/2, cy=r.y+r.height/3;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cx-40,y:cy,id:1},{x:cx+40,y:cy,id:2}]});
    for(let i=1;i<=10;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cx-40-i*10,y:cy,id:1},{x:cx+40+i*10,y:cy,id:2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await pg.waitForTimeout(400);
    console.log('pinch scale', s0.toFixed(3),'->',(await pg.evaluate(()=>window.__fv.V.s)).toFixed(3));
    await pg.screenshot({path:'u_4pinch.png'});
  }
  await ctx.close(); }
  console.log('errors',errs); await b.close();
})();
