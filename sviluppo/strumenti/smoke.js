const { chromium } = require('playwright');
(async()=>{ const b=await chromium.launch(); const errs=[];
 for (const [w,h] of [[390,844],[1440,900]]) { const pg=await b.newPage({viewport:{width:w,height:h}}); pg.on('pageerror',e=>errs.push(e.message));
 await pg.goto((process.env.BASE||'http://127.0.0.1:8765')+'/dev/index.html?ort=/mock_ort.js'); await pg.click('#b-sample'); await pg.waitForTimeout(1500);
 await pg.screenshot({path:`s_${w}_box.png`});
 await pg.click('[data-mode="fast"]'); await pg.click('[data-act="convert"]'); await pg.waitForFunction(()=>window.__fv.S.phase==='result',null,{timeout:120000}); await pg.waitForTimeout(700);
 await pg.screenshot({path:`s_${w}_res.png`}); console.log(w,'paths',await pg.evaluate(()=>window.__fv.S.paths.length)); await pg.close(); }
 console.log('errors',errs); await b.close(); })();
