// Esegue il vettorizzatore AI di src/engine.js sugli input precalcolati da pre.py
// Uso: node run_ai.js <nome>   -> dati/<nome>.paths.json (poi: python3 render.py <nome> white)
const fs=require('fs'), path=require('path'); const D=path.join(__dirname,'dati'); const name=process.argv[2];
eval(fs.readFileSync(path.join(__dirname,'..','src','engine.js'),'utf8')+';global.makeEngine=makeEngine;');
const E=makeEngine(); const meta=JSON.parse(fs.readFileSync(path.join(D,name+'.json')));
const nb=fs.readFileSync(path.join(D,name+'.neural.f32')); const neural=new Float32Array(nb.buffer,nb.byteOffset,nb.length/4);
let gray=null; try{const g=fs.readFileSync(path.join(D,name+'.gray.u8')); gray=new Uint8Array(g.buffer,g.byteOffset,g.length);}catch(e){}
const polys=meta.polys.map(p=>Float32Array.from(p)); const [x0,y0,x1,y1]=meta.region;
const t=Date.now(); const r=E.run({mode:'ai',debug:1,ai:{rw:meta.rw,rh:meta.rh,neural,gray,polys,ox:x0,oy:y0,sx:(x1-x0)/meta.rw}});
console.log('ms',Date.now()-t,JSON.stringify(r.info)); fs.writeFileSync(path.join(D,name+'.paths.json'),JSON.stringify(r.paths));
