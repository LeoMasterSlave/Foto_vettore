// Ponte a riga di comando verso il motore di Fotovettore (sviluppo/src/engine.js), senza modificarlo.
// Uso: node motore.js <lavoro.json>   -> scrive <lavoro.json>.out.json
//   {"cmd":"detect","W":..,"H":..,"gray":"file.f32"}                         -> {"box":[x0,y0,x1,y1]}
//   {"cmd":"run","rw":..,"rh":..,"neural":"file.f32","gray":"file.u8",
//    "polys":[[x,y,...],...],"aiThr":0.5}                                      -> {"paths":[...],"info":{...}}
// "neural": mappa Float32 rw*rh con 0 = linea e 1 = bianco (come l'uscita di Informative Drawings).
const fs = require('fs'), path = require('path');
eval(fs.readFileSync(path.join(__dirname, '..', 'src', 'engine.js'), 'utf8') + ';global.makeEngine=makeEngine;');
const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const rd = (f, T) => { const b = fs.readFileSync(f); return new T(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
const E = makeEngine();
let out;
if (job.cmd === 'detect') {
  E.setImage(job.W, job.H, rd(job.gray, Float32Array));
  out = { box: E.detect() };
} else if (job.cmd === 'run') {
  const t = Date.now();
  const r = E.run({
    mode: 'ai', aiThr: job.aiThr || 0.5,
    ai: {
      rw: job.rw, rh: job.rh, neural: rd(job.neural, Float32Array),
      gray: job.gray ? rd(job.gray, Uint8Array) : null,
      polys: (job.polys || []).map((p) => Float32Array.from(p)), ox: 0, oy: 0, sx: 1,
    },
  });
  out = { paths: r.paths, info: Object.assign({ ms: Date.now() - t }, r.info, { dbg: undefined }) };
} else throw new Error('comando sconosciuto: ' + job.cmd);
fs.writeFileSync(process.argv[2] + '.out.json', JSON.stringify(out));
