const { chromium } = require('playwright');
(async()=>{ const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1280,height:800}}); const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
 // 1) ORT irraggiungibile: messaggio chiaro e ritorno al riquadro
 await pg.goto((process.env.BASE||'http://127.0.0.1:8765')+'/dev/index.html?ort=/manca.js'); await pg.setInputFiles('#file',process.env.FOTO2||process.env.FOTO||'foto.png'); await pg.waitForTimeout(1200);
 await pg.click('[data-mode="fast"]'); await pg.click('[data-act="convert"]'); await pg.waitForTimeout(4000);
 console.log('no-ort:', await pg.evaluate(()=>window.__fv.S.phase), '|', await pg.textContent('#toast'));
 // 2) metodo classico + regolazione dal vivo
 await pg.goto((process.env.BASE||'http://127.0.0.1:8765')+'/dev/index.html?ort=/mock_ort.js'); await pg.setInputFiles('#file',process.env.FOTO||'foto.png'); await pg.waitForTimeout(1200);
 await pg.click('[data-mode="classic"]'); await pg.click('[data-act="convert"]'); await pg.waitForFunction(()=>window.__fv.S.phase==='result',null,{timeout:60000});
 const n1=await pg.evaluate(()=>window.__fv.S.paths.length);
 await pg.click('#adv summary'); await pg.click('[data-cmode="edges"]'); await pg.waitForTimeout(3000);
 const n2=await pg.evaluate(()=>window.__fv.S.paths.length);
 console.log('classic paths', n1, '-> edges', n2); await pg.screenshot({path:'d_classic.png'});
 // 3) annulla durante la conversione
 await pg.click('[data-act="again"]'); await pg.click('[data-mode="detail"]'); await pg.click('[data-act="convert"]'); await pg.waitForTimeout(6000);
 await pg.click('[data-act="stop"]'); await pg.waitForTimeout(1500);
 console.log('after stop:', await pg.evaluate(()=>window.__fv.S.phase));
 // 4) riparte dopo l'interruzione
 await pg.click('[data-mode="fast"]'); await pg.click('[data-act="convert"]'); await pg.waitForFunction(()=>window.__fv.S.phase==='result',null,{timeout:120000});
 console.log('rerun ok, paths', await pg.evaluate(()=>window.__fv.S.paths.length), 'errors', errs); await b.close(); })();
