  'use strict';
  const $ = (id) => document.getElementById(id);
  const QS = new URLSearchParams(location.search);
  const ORT_URL = QS.get('ort') ? new URL(QS.get('ort'), location.href).href : 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.min.js';
  const ORT_DIR = ORT_URL.replace(/[^/]*$/, '');
  const MODEL_BASE = new URL(QS.get('models') || '../prova-ai/modelli/', location.href).href;
  const fmtInt = (n) => Math.round(n).toLocaleString('it-IT');
  const fmt1 = (n) => n.toLocaleString('it-IT', { maximumFractionDigits: 1 });
  const fmtTime = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0') + ' s'; };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const now = () => performance.now();

  const LAYERS = [
    { name: 'STRUTTURA', label: 'Struttura', desc: 'Contorni principali, cornici, fasce', w: 0.5, aci: 7, v: '--l0', px: 2.2 },
    { name: 'ELEMENTI', label: 'Elementi', desc: 'Aperture, archi, cerchi, balconi', w: 0.35, aci: 5, v: '--l1', px: 1.6 },
    { name: 'DETTAGLI', label: 'Dettagli', desc: 'Conci, mattoni, tessitura', w: 0.18, aci: 8, v: '--l2', px: 1 },
    { name: 'RICOSTRUZIONI', label: 'Ricostruzioni stimate', desc: 'Forme e giunzioni dedotte, da verificare', w: 0.25, aci: 30, v: '--l3', px: 1.5, dash: true },
  ];
  const MODES = {
    detail: { label: 'Dettagliata', desc: 'Disegno neurale e riconoscimento delle forme: conci, finestre, archi chiusi e regolarizzati. Qualche minuto (su iPhone circa 5).' },
    fast: { label: 'Rapida', desc: 'Solo disegno neurale, poi linee e archi regolarizzati. Circa un minuto su iPhone.' },
    classic: { label: 'Classica', desc: 'Metodo geometrico senza AI: immediato e senza scaricare modelli, ma meno preciso sulle murature.' },
  };

  const S = {
    phase: 'empty', mode: 'detail', view: 'draw', name: '', srcCv: null, img: null, W: 0, H: 0, gray: null,
    box: null, ref: null, paths: [], info: {}, show: [true, true, true, true], edit: false, sel: -1, undo: [],
    aiId: 0, ai: null, prog: { frac: 0, msg: '', eta: null }, t0: 0, timings: {}, sheet: 'peek', classic: 'arch',
  };

  /* ---------- avvisi ---------- */
  let toastT = 0;
  function say(msg, ms) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms || 3200); }

  /* ---------- motore geometrico (worker, con ripiego nel thread principale) ---------- */
  const Eng = (() => {
    let w = null, direct = null, seq = 0;
    const pend = new Map();
    function fallback() {
      if (direct) return;
      direct = makeEngine(); w = null;
      if (S.gray) direct.setImage(S.W, S.H, S.gray);
      for (const p of pend.values()) p.retry();
      pend.clear();
    }
    try {
      const src = makeEngine.toString() + ';var E=makeEngine();onmessage=function(ev){var m=ev.data,r=null;try{if(m.type==="img")E.setImage(m.W,m.H,m.gray);else if(m.type==="run")r=E.run(m.p);else if(m.type==="detect")r=E.detect();postMessage({id:m.id,ok:true,r:r});}catch(err){postMessage({id:m.id,ok:false,msg:String(err&&err.message||err)});}};';
      w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      w.onmessage = (ev) => { const m = ev.data, p = pend.get(m.id); if (!p) return; pend.delete(m.id); if (m.ok) p.res(m.r); else p.rej(new Error(m.msg)); };
      w.onerror = (e) => { if (e.preventDefault) e.preventDefault(); fallback(); };
    } catch (e) { w = null; }
    function runDirect(type, pl) {
      if (!direct) { direct = makeEngine(); if (S.gray && type !== 'img') direct.setImage(S.W, S.H, S.gray); }
      return type === 'img' ? direct.setImage(pl.W, pl.H, pl.gray) : type === 'run' ? direct.run(pl.p) : direct.detect();
    }
    function call(type, pl, tr) {
      if (!w) return new Promise((res, rej) => setTimeout(() => { try { res(runDirect(type, pl)); } catch (e) { rej(e); } }, 16));
      const id = ++seq;
      return new Promise((res, rej) => {
        pend.set(id, { res, rej, retry: () => setTimeout(() => { try { res(runDirect(type, pl)); } catch (e) { rej(e); } }, 0) });
        try { w.postMessage(Object.assign({ type, id }, pl), tr || []); } catch (e) { pend.delete(id); fallback(); res(runDirect(type, pl)); }
      });
    }
    return { call, get mode() { return w ? 'worker' : 'principale'; } };
  })();

  /* ---------- motore AI (worker con ONNX Runtime; ripiego nel thread principale) ---------- */
  const AIW = (() => {
    let w = null, main = null, ready = null, mode = '—';
    function src() {
      return makeAI.toString() + ';var __err=null;try{importScripts(' + JSON.stringify(ORT_URL) + ');ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths=' + JSON.stringify(ORT_DIR) + ';}catch(e){__err=String(e&&e.message||e);}' +
        'var A=null;onmessage=function(ev){var m=ev.data;if(m.type==="ping"){postMessage({type:"pong",err:__err});return;}if(!A)A=makeAI(function(msg,tr){var t=[];if(tr){if(msg.data)t.push(msg.data.buffer);if(msg.polys)msg.polys.forEach(function(p){t.push(p.buffer);});}postMessage(msg,t);},function(){return ort;});A.handle(m);};';
    }
    function startMain() {
      if (w) { try { w.terminate(); } catch (e) { /* già chiuso */ } w = null; }
      mode = 'thread principale';
      return new Promise((res, rej) => {
        const go = () => { try { ort.env.wasm.numThreads = 1; ort.env.wasm.wasmPaths = ORT_DIR; } catch (e) { /* versione diversa */ } main = makeAI((m) => setTimeout(() => onAI(m), 0), () => window.ort); res(); };
        if (window.ort) { go(); return; }
        const s = document.createElement('script'); s.src = ORT_URL; s.async = true;
        s.onload = go; s.onerror = () => rej(new Error('Non riesco a caricare il motore AI. Serve la connessione a internet la prima volta.'));
        document.head.appendChild(s);
      });
    }
    function init() {
      if (ready) return ready;
      ready = new Promise((resolve, reject) => {
        let done = false;
        const fin = (ok) => { if (done) return; done = true; if (ok) { mode = 'Web Worker'; resolve(); } else startMain().then(resolve, (e) => { ready = null; reject(e); }); };
        try {
          w = new Worker(URL.createObjectURL(new Blob([src()], { type: 'text/javascript' })));
          w.onmessage = (ev) => { const m = ev.data; if (m.type === 'pong') { fin(!m.err); return; } onAI(m); };
          w.onerror = (e) => { if (e.preventDefault) e.preventDefault(); if (!done) fin(false); else onAI({ type: 'error', id: S.aiId, msg: 'Il worker AI si è interrotto (memoria insufficiente?). Riprova con la modalità Rapida o una risoluzione più bassa.' }); };
          w.postMessage({ type: 'ping' });
          setTimeout(() => fin(false), 25000);
        } catch (e) { fin(false); }
      });
      return ready;
    }
    function post(m, tr) { if (w) w.postMessage(m, tr || []); else if (main) main.handle(m); }
    function toMain() { ready = startMain(); return ready; }
    return { init, post, toMain, get inWorker() { return !!w; }, get mode() { return mode; } };
  })();

  /* ---------- foto ---------- */
  function loadFile(file) {
    if (!file) return;
    if (file.type && !file.type.startsWith('image/')) { say('Questo file non è un\'immagine.'); return; }
    const url = URL.createObjectURL(file), im = new Image();
    im.decoding = 'async';
    im.onload = () => { setSource(im, file.name || 'foto'); URL.revokeObjectURL(url); };
    im.onerror = () => { URL.revokeObjectURL(url); say('Il browser non riesce ad aprire questo formato. Prova con JPG, PNG o HEIC da Foto.'); };
    im.src = url;
  }
  function setSource(el, name) {
    cancelRun(true);
    const w = el.naturalWidth || el.width, h = el.naturalHeight || el.height;
    const ks = Math.min(1, 2400 / Math.max(w, h)), src = document.createElement('canvas');
    src.width = Math.max(8, Math.round(w * ks)); src.height = Math.max(8, Math.round(h * ks));
    const sx = src.getContext('2d'); sx.fillStyle = '#fff'; sx.fillRect(0, 0, src.width, src.height); sx.drawImage(el, 0, 0, src.width, src.height);
    const kv = Math.min(1, 1600 / Math.max(w, h)), W = Math.max(8, Math.round(w * kv)), H = Math.max(8, Math.round(h * kv));
    const img = document.createElement('canvas'); img.width = W; img.height = H;
    const ix = img.getContext('2d', { willReadFrequently: true }); ix.imageSmoothingQuality = 'high'; ix.drawImage(src, 0, 0, W, H);
    const d = ix.getImageData(0, 0, W, H).data, g = new Float32Array(W * H);
    for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
    Object.assign(S, { srcCv: src, img, W, H, gray: g, name, paths: [], info: {}, ref: null, undo: [], sel: -1, ai: null, edit: false });
    S.box = [Math.round(W * 0.06), Math.round(H * 0.06), Math.round(W * 0.94), Math.round(H * 0.94)];
    Eng.call('img', { W, H, gray: g.slice() }).then(() => Eng.call('detect', {})).then((b) => {
      if (b && b[2] - b[0] > W * 0.2 && b[3] - b[1] > H * 0.15 && S.phase === 'box') { S.box = b; requestDraw(); }
    }).catch(() => { /* resta il riquadro predefinito */ });
    rebuild(); setEdit(false); setPhase('box'); fitView(false, true);
  }
  function makeSample() {
    const W = 1200, H = 900, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const sky = x.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#7fa8d6'); sky.addColorStop(1, '#cfdde9'); x.fillStyle = sky; x.fillRect(0, 0, W, H);
    x.fillStyle = '#b9a58a'; x.fillRect(0, 700, W, 200);
    x.fillStyle = '#d8c8a6'; x.fillRect(240, 160, 720, 560);
    x.strokeStyle = '#8c7a5c'; x.lineWidth = 3;
    for (let y = 200; y < 720; y += 40) { x.beginPath(); x.moveTo(240, y); x.lineTo(960, y); x.stroke(); const off = ((y / 40) % 2) * 45; for (let xx = 240 + off; xx < 960; xx += 90) { x.beginPath(); x.moveTo(xx, y - 40); x.lineTo(xx, y); x.stroke(); } }
    x.fillStyle = '#c9b38c'; x.fillRect(220, 140, 760, 26);
    const arch = (cx, top, w, h) => { x.fillStyle = '#2b2620'; x.beginPath(); x.moveTo(cx - w / 2, top + h); x.lineTo(cx - w / 2, top + w / 2); x.arc(cx, top + w / 2, w / 2, Math.PI, 0); x.lineTo(cx + w / 2, top + h); x.closePath(); x.fill(); };
    arch(420, 470, 130, 250); arch(780, 470, 130, 250); arch(360, 230, 70, 130); arch(600, 230, 70, 130); arch(840, 230, 70, 130);
    x.fillStyle = '#3b342b'; for (const cx of [300, 480, 720, 900]) { x.beginPath(); x.arc(cx, 400, 14, 0, 2 * Math.PI); x.fill(); }
    const im = new Image(); im.onload = () => setSource(im, 'esempio.png'); im.src = c.toDataURL('image/png');
  }

  /* ---------- conversione ---------- */
  function convert() {
    if (!S.img || S.phase === 'run') return;
    S.paths = []; S.sel = -1; S.undo = []; S.timings = {}; S.t0 = now(); S.prog = { frac: 0, msg: 'Preparazione…', eta: null };
    rebuild();
    if (S.mode === 'classic') { runClassic(true); return; }
    const [x0, y0, x1, y1] = S.box, k = S.srcCv.width / S.W, sw = (x1 - x0) * k, sh = (y1 - y0) * k;
    const L = +$('ai-res').value, f = Math.min(2, L / Math.max(sw, sh)), rw = Math.max(64, Math.round(sw * f)), rh = Math.max(64, Math.round(sh * f));
    const c = document.createElement('canvas'); c.width = rw; c.height = rh;
    const cx = c.getContext('2d', { willReadFrequently: true }); cx.imageSmoothingQuality = 'high';
    cx.drawImage(S.srcCv, x0 * k, y0 * k, sw, sh, 0, 0, rw, rh);
    const rgba = cx.getImageData(0, 0, rw, rh).data, gray = new Uint8Array(rw * rh);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = (0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]) | 0;
    S.ai = { rw, rh, gray, rgba: new Uint8ClampedArray(rgba), neural: null, polys: [], ox: x0, oy: y0, sx: (x1 - x0) / rw, detail: S.mode === 'detail' };
    S.ref = [x0, y0, x1, y1];
    const id = ++S.aiId;
    setPhase('run');
    AIW.init().then(() => {
      if (id !== S.aiId) return;
      const buf = new Uint8ClampedArray(rgba);
      AIW.post({ type: 'run', id, rgba: buf, W: rw, H: rh, detail: S.mode === 'detail', base: MODEL_BASE }, [buf.buffer]);
    }).catch((e) => { if (id === S.aiId) { say(e.message, 6000); setPhase('box'); } });
  }
  function onAI(m) {
    if (m.type === 'prog') { if (S.phase === 'run') { S.prog = m; renderProgress(); } return; }
    if (m.id !== S.aiId || !S.ai) return;
    if (m.type === 'neural') {
      S.ai.neural = m.data; S.timings.neural = now() - S.t0;
      vectorize(!S.ai.detail);
    } else if (m.type === 'polys') {
      S.ai.polys = m.polys; S.timings.seg = now() - S.t0;
      vectorize(true);
    } else if (m.type === 'done') {
      S.timings.ai = m.timings; S.timings.decodes = m.decodes;
    } else if (m.type === 'cancelled') {
      setPhase(S.paths.length ? 'result' : 'box'); say('Conversione interrotta.');
    } else if (m.type === 'error' && m.init && AIW.inWorker) {
      // il motore AI non parte dentro il worker su questo browser: riprovo nel thread principale
      S.prog = { frac: 0, msg: 'Avvio il motore AI in modalità compatibile…', eta: null }; renderProgress();
      AIW.toMain().then(() => { if (m.id !== S.aiId) return; const buf = new Uint8ClampedArray(S.ai.rgba); AIW.post({ type: 'run', id: m.id, rgba: buf, W: S.ai.rw, H: S.ai.rh, detail: S.ai.detail, base: MODEL_BASE }); })
        .catch((e) => { say(e.message, 6000); setPhase('box'); });
    } else if (m.type === 'error') {
      say(m.msg || 'Errore durante la conversione.', 7000); setPhase(S.paths.length ? 'result' : 'box');
    }
  }
  let vecSeq = 0;
  function vectorize(final) {
    const A = S.ai; if (!A || !A.neural) return;
    const my = ++vecSeq, t = now();
    const pl = { rw: A.rw, rh: A.rh, neural: A.neural.slice(0), gray: A.gray.slice(0), polys: A.polys.map((p) => p.slice(0)), ox: A.ox, oy: A.oy, sx: A.sx };
    const tr = [pl.neural.buffer, pl.gray.buffer].concat(pl.polys.map((p) => p.buffer));
    if (S.phase === 'run' && !final) S.prog = { frac: S.prog.frac, msg: 'Anteprima del disegno…', eta: S.prog.eta };
    Eng.call('run', { p: { mode: 'ai', ai: pl, aiThr: +$('ai-thr').value / 100 } }, tr).then((r) => {
      if (my !== vecSeq) return;
      S.paths = r.paths; S.info = r.info; S.timings.vec = now() - t; S.sel = -1; S.undo = [];
      rebuild();
      if (final) { S.timings.total = now() - S.t0; setPhase('result'); fitView(true); }
      else if (S.phase === 'run') { renderProgress(); say('Anteprima pronta: continuo con il riconoscimento delle forme.'); }
    }).catch((e) => { say('Errore nella vettorizzazione: ' + e.message, 6000); setPhase('box'); });
  }
  let classicT = 0, classicSeq = 0;
  function runClassic(first) {
    const my = ++classicSeq, t = now();
    if (first) { S.ref = [0, 0, S.W, S.H]; setPhase('run'); S.prog = { frac: 0.5, msg: 'Metodo classico…', eta: null }; renderProgress(); }
    Eng.call('run', { p: classicParams() }).then((r) => {
      if (my !== classicSeq) return;
      S.paths = r.paths.map((p) => (p.l === undefined ? Object.assign(p, { l: 1 }) : p)); S.info = r.info; S.timings = { total: now() - t, vec: now() - t };
      S.sel = -1; S.undo = []; rebuild(); if (first || S.phase !== 'result') { setPhase('result'); fitView(true); } else renderStep();
    }).catch((e) => { say('Errore: ' + e.message, 6000); setPhase('box'); });
  }
  function cancelRun(silent) {
    if (S.phase !== 'run') return;
    S.aiId++; AIW.post({ type: 'cancel' }); classicSeq++;
    if (!silent) { setPhase(S.paths.length ? 'result' : 'box'); say('Conversione interrotta.'); }
  }

  /* ---------- parametri del metodo classico ---------- */
  const DEF = {
    edges: { sens: 55, blur: 12, simp: 10, minlen: 14, merge: 20, straight: false },
    arch: { sens: 45, blur: 16, simp: 15, minlen: 30, merge: 30, straight: true },
    shape: { blur: 15, simp: 8, minlen: 20, merge: 20, straight: false },
  };
  function classicParams() {
    return { mode: S.classic, autoAll: $('autoall').checked && S.classic === 'arch', sens: +$('sens').value, blur: +$('blur').value / 10, simp: +$('simp').value / 10, minlen: +$('minlen').value, merge: +$('merge').value / 10, arcs: $('arcs').checked, straight: $('straight').checked, auto: $('auto').checked, thr: +$('thr').value, inv: $('inv').checked };
  }
  function updateLabels() {
    const p = classicParams();
    $('o-sens').textContent = p.sens + '%'; $('o-blur').textContent = fmt1(p.blur) + ' px'; $('o-simp').textContent = fmt1(p.simp) + ' px';
    $('o-min').textContent = p.minlen + ' px'; $('o-merge').textContent = p.merge > 0 ? fmt1(p.merge) + ' px' : 'no'; $('o-thr').textContent = p.auto ? 'auto' : String(p.thr);
    $('o-aithr').textContent = $('ai-thr').value;
    const auto = $('autoall').checked && S.classic === 'arch';
    for (const id of ['sens', 'blur', 'simp', 'minlen', 'merge']) $(id).disabled = auto;
    $('f-shape').hidden = S.classic !== 'shape'; $('thr').disabled = $('auto').checked;
  }

  /* ---------- geometria del disegno: Path2D per livello, indice per la selezione ---------- */
  let P2D = [null, null, null, null], GEO = [];
  function arcCenter(P, Q, b) {
    const dx = Q[0] - P[0], dy = Q[1] - P[1], c = Math.hypot(dx, dy), th = 4 * Math.atan(Math.abs(b)), r = c / (2 * Math.sin(th / 2)), sg = b > 0 ? 1 : -1;
    const nx = -dy / c, ny = dx / c, s = Math.abs(b) * c / 2;
    return { cx: (P[0] + Q[0]) / 2 + nx * sg * (s - r), cy: (P[1] + Q[1]) / 2 + ny * sg * (s - r), r };
  }
  function rebuild() {
    P2D = [new Path2D(), new Path2D(), new Path2D(), new Path2D()]; GEO = [];
    S.paths.forEach((p, idx) => {
      const v = p.v, n = v.length / 2, m = p.c ? n : n - 1, path = P2D[p.l], pts = [v[0], v[1]];
      path.moveTo(v[0], v[1]);
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % n, b = p.b[i];
        if (!b) { path.lineTo(v[2 * j], v[2 * j + 1]); pts.push(v[2 * j], v[2 * j + 1]); continue; }
        const P = [v[2 * i], v[2 * i + 1]], Q = [v[2 * j], v[2 * j + 1]], a = arcCenter(P, Q, b);
        const a0 = Math.atan2(P[1] - a.cy, P[0] - a.cx), a1 = Math.atan2(Q[1] - a.cy, Q[0] - a.cx);
        path.arc(a.cx, a.cy, a.r, a0, a1, b > 0);
        const th = 4 * Math.atan(Math.abs(b)), K = Math.max(2, Math.ceil(th / 0.3));
        for (let q = 1; q <= K; q++) { const ang = a0 + (b > 0 ? -1 : 1) * th * q / K; pts.push(a.cx + a.r * Math.cos(ang), a.cy + a.r * Math.sin(ang)); }
      }
      if (p.c) path.closePath();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]); }
      GEO[idx] = { pts: Float32Array.from(pts), bb: [x0, y0, x1, y1] };
    });
    renderLayers(); renderStats(); updateButtons(); requestDraw();
  }
  function hitTest(x, y, tol) {
    let best = -1, bd = tol;
    S.paths.forEach((p, i) => {
      if (!S.show[p.l]) return;
      const g = GEO[i], b = g.bb;
      if (x < b[0] - tol || x > b[2] + tol || y < b[1] - tol || y > b[3] + tol) return;
      const q = g.pts;
      for (let k = 0; k + 3 < q.length; k += 2) {
        const ax = q[k], ay = q[k + 1], dx = q[k + 2] - ax, dy = q[k + 3] - ay, l2 = dx * dx + dy * dy;
        const t = l2 ? clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1) : 0, d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
        if (d < bd) { bd = d; best = i; }
      }
    });
    return best;
  }

  /* ---------- disegno sul canvas ---------- */
  const vp = $('vp'), cv = $('cv'), ctx = cv.getContext('2d', { alpha: false });
  const V = { s: 1, tx: 0, ty: 0 };
  let dpr = 1, VW = 0, VH = 0, raf = 0, colors = {};
  function readColors() { const cs = getComputedStyle(document.documentElement); for (const k of ['--canvas', '--sheet', '--grid', '--l0', '--l1', '--l2', '--l3', '--accent']) colors[k] = cs.getPropertyValue(k).trim(); requestDraw(); }
  function resize() {
    const r = vp.getBoundingClientRect(); dpr = Math.min(window.devicePixelRatio || 1, 2); if (r.width * r.height * dpr * dpr > 4.2e6) dpr = Math.max(1, Math.sqrt(4.2e6 / (r.width * r.height)));
    const nw = Math.max(1, Math.round(r.width * dpr)), nh = Math.max(1, Math.round(r.height * dpr));
    const wasEmpty = !VW; VW = r.width; VH = r.height;
    if (cv.width !== nw || cv.height !== nh) { cv.width = nw; cv.height = nh; }
    if (wasEmpty && S.img) fitView(false);
    requestDraw();
  }
  function requestDraw() { if (!raf) raf = requestAnimationFrame(draw); }
  let V0 = null, settleT = 0;
  /* Vista cambiata da un gesto: sposta la bitmap con il compositore (nessun ridisegno), poi ridisegna nitido */
  function moved() {
    if (!V0 || !S.img) { requestDraw(); return; }
    const k = V.s / V0.s;
    cv.style.transform = 'translate3d(' + (V.tx - k * V0.tx).toFixed(2) + 'px,' + (V.ty - k * V0.ty).toFixed(2) + 'px,0) scale(' + k.toFixed(5) + ')';
    zoomLabel();
    clearTimeout(settleT); settleT = setTimeout(requestDraw, 140);
  }
  function zoomLabel() { const z = Math.round(V.s * 100) + '%'; if (z !== lastZoom) { lastZoom = z; $('zoom').textContent = z; } }
  let lastZoom = '';
  function draw() {
    raf = 0;
    clearTimeout(settleT);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = colors['--canvas'] || '#e6e8ec'; ctx.fillRect(0, 0, cv.width, cv.height);
    if (!S.img) { V0 = null; cv.style.transform = ''; return; }
    const s = V.s, W = S.W, H = S.H;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * V.tx, dpr * V.ty);
    ctx.fillStyle = colors['--sheet']; ctx.fillRect(0, 0, W, H);
    // griglia di disegno che segue lo zoom
    const target = 48 / s, e = Math.pow(10, Math.floor(Math.log10(target))), g = target / e < 2 ? 2 * e : target / e < 5 ? 5 * e : 10 * e;
    const vx0 = Math.max(0, -V.tx / s), vy0 = Math.max(0, -V.ty / s), vx1 = Math.min(W, (VW - V.tx) / s), vy1 = Math.min(H, (VH - V.ty) / s);
    if (vx1 > vx0 && vy1 > vy0 && S.view !== 'photo') {
      ctx.beginPath();
      for (let x = Math.ceil(vx0 / g) * g; x <= vx1; x += g) { ctx.moveTo(x, vy0); ctx.lineTo(x, vy1); }
      for (let y = Math.ceil(vy0 / g) * g; y <= vy1; y += g) { ctx.moveTo(vx0, y); ctx.lineTo(vx1, y); }
      ctx.lineWidth = 1 / s; ctx.strokeStyle = colors['--grid']; ctx.stroke();
    }
    const showPhoto = S.view === 'photo' || S.view === 'over' || S.phase === 'box' || (S.phase === 'run' && !S.paths.length);
    if (showPhoto) {
      ctx.globalAlpha = S.view === 'over' && S.paths.length ? 0.45 : 1;
      ctx.imageSmoothingEnabled = true; ctx.drawImage(S.img, 0, 0, W, H); ctx.globalAlpha = 1;
    }
    if (S.view !== 'photo' && S.paths.length) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let l = 3; l >= 0; l--) {
        if (!S.show[l]) continue;
        const L = LAYERS[l];
        ctx.lineWidth = L.px / s; ctx.strokeStyle = colors[L.v];
        ctx.setLineDash(L.dash ? [5 / s, 4 / s] : []);
        ctx.stroke(P2D[l]);
      }
      ctx.setLineDash([]);
      if (S.sel >= 0 && S.paths[S.sel]) {
        const one = new Path2D(), g2 = GEO[S.sel].pts; one.moveTo(g2[0], g2[1]); for (let k = 2; k < g2.length; k += 2) one.lineTo(g2[k], g2[k + 1]);
        ctx.lineWidth = 7 / s; ctx.strokeStyle = 'rgba(10,96,216,0.22)'; ctx.stroke(one);
        ctx.lineWidth = 2.4 / s; ctx.strokeStyle = colors['--accent']; ctx.stroke(one);
      }
    }
    if (S.phase === 'box' || S.phase === 'run') drawBox(s);
    zoomLabel(); V0 = { s: V.s, tx: V.tx, ty: V.ty }; if (cv.style.transform) cv.style.transform = '';
  }
  function drawBox(s) {
    const [x0, y0, x1, y1] = S.box, W = S.W, H = S.H;
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.fillStyle = S.phase === 'run' ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.38)'; ctx.fill('evenodd');
    ctx.lineWidth = 2 / s; ctx.strokeStyle = colors['--accent']; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    if (S.phase !== 'box') return;
    ctx.lineWidth = 1 / s; ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.setLineDash([4 / s, 4 / s]);
    ctx.beginPath(); for (const f of [1 / 3, 2 / 3]) { ctx.moveTo(x0 + (x1 - x0) * f, y0); ctx.lineTo(x0 + (x1 - x0) * f, y1); ctx.moveTo(x0, y0 + (y1 - y0) * f); ctx.lineTo(x1, y0 + (y1 - y0) * f); } ctx.stroke(); ctx.setLineDash([]);
    const r = 8 / s;
    for (const [hx, hy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
      ctx.beginPath(); ctx.arc(hx, hy, r, 0, 2 * Math.PI); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2.5 / s; ctx.strokeStyle = colors['--accent']; ctx.stroke();
    }
    ctx.fillStyle = colors['--accent'];
    for (const [hx, hy] of [[(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1], [x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]]) { ctx.beginPath(); ctx.arc(hx, hy, 4.5 / s, 0, 2 * Math.PI); ctx.fill(); }
  }

  /* ---------- vista: adatta, molle, inerzia ---------- */
  function contentInsets() {
    const wide = window.innerWidth >= 900;
    const peek = wide || S.phase === 'empty' ? 0 : sheetVisible();
    return { top: 64, bottom: peek + 16, left: 16, right: wide ? 64 : 60 };
  }
  function fitTarget(rect) {
    const [x0, y0, x1, y1] = rect || [0, 0, S.W, S.H], I = contentInsets();
    const aw = Math.max(40, VW - I.left - I.right), ah = Math.max(40, VH - I.top - I.bottom);
    const s = Math.min(aw / (x1 - x0), ah / (y1 - y0));
    return { s, tx: I.left + (aw - (x1 - x0) * s) / 2 - x0 * s, ty: I.top + (ah - (y1 - y0) * s) / 2 - y0 * s };
  }
  function fitView(animate, whole) {
    if (!S.img || !VW) return;
    const t = fitTarget(whole || !S.ref || S.phase === 'box' ? null : S.ref);
    if (animate) springTo(t); else { stopAnim(); Object.assign(V, t); requestDraw(); }
  }
  let anim = null;
  function stopAnim() { if (anim) { cancelAnimationFrame(anim.raf); anim = null; } }
  function springTo(t) {
    stopAnim();
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { Object.assign(V, t); requestDraw(); return; }
    const w = 2 * Math.PI / 0.38, st = { s: [V.s, 0], tx: [V.tx, 0], ty: [V.ty, 0] };
    let last = now();
    const step = () => {
      const tn = now(), dt = Math.min(0.032, (tn - last) / 1000); last = tn;
      let done = true;
      for (const k of ['s', 'tx', 'ty']) {
        const [x, v] = st[k], a = -w * w * (x - t[k]) - 2 * w * v, nv = v + a * dt, nx = x + nv * dt;
        st[k] = [nx, nv];
        if (Math.abs(nx - t[k]) > (k === 's' ? 1e-4 * t.s : 0.3) || Math.abs(nv) > (k === 's' ? 1e-3 : 1)) done = false;
      }
      V.s = st.s[0]; V.tx = st.tx[0]; V.ty = st.ty[0];
      if (done) { Object.assign(V, t); anim = null; requestDraw(); } else { anim.raf = requestAnimationFrame(step); moved(); }
    };
    anim = { raf: requestAnimationFrame(step) };
  }
  function momentum(vx, vy) {
    stopAnim();
    if (Math.hypot(vx, vy) < 0.05 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let last = now();
    const step = () => {
      const tn = now(), dt = Math.min(32, tn - last); last = tn;
      V.tx += vx * dt; V.ty += vy * dt;
      const d = Math.pow(0.996, dt); vx *= d; vy *= d;
      moved();
      if (Math.hypot(vx, vy) < 0.02) { anim = null; requestDraw(); return; }
      anim.raf = requestAnimationFrame(step);
    };
    anim = { raf: requestAnimationFrame(step) };
  }
  function zoomAt(px, py, f) {
    const s = clamp(V.s * f, minScale(), 60), k = s / V.s;
    V.tx = px - (px - V.tx) * k; V.ty = py - (py - V.ty) * k; V.s = s; moved();
  }
  const minScale = () => (S.img ? 0.25 * Math.min(VW / S.W, VH / S.H) : 0.05);

  /* ---------- gesti: trascina, pizzica, doppio tocco, rotella ---------- */
  const ptrs = new Map();
  let gest = null, lastTap = { t: 0, x: 0, y: 0 };
  const local = (e) => { const r = vp.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const toImg = (p) => ({ x: (p.x - V.tx) / V.s, y: (p.y - V.ty) / V.s });
  function boxHit(p) {
    if (S.phase !== 'box' || !S.box) return null;
    const [x0, y0, x1, y1] = S.box, s = V.s, X0 = x0 * s + V.tx, Y0 = y0 * s + V.ty, X1 = x1 * s + V.tx, Y1 = y1 * s + V.ty, R = 24;
    const near = (a, b) => Math.abs(a - b) < R;
    if (near(p.x, X0) && near(p.y, Y0)) return 'nw'; if (near(p.x, X1) && near(p.y, Y0)) return 'ne';
    if (near(p.x, X0) && near(p.y, Y1)) return 'sw'; if (near(p.x, X1) && near(p.y, Y1)) return 'se';
    const inY = p.y > Y0 && p.y < Y1, inX = p.x > X0 && p.x < X1;
    if (inY && near(p.x, X0)) return 'w'; if (inY && near(p.x, X1)) return 'e';
    if (inX && near(p.y, Y0)) return 'n'; if (inX && near(p.y, Y1)) return 's';
    return null;
  }
  const CURS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
  function pinchState() { const [a, b] = [...ptrs.values()]; return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)) }; }
  cv.addEventListener('pointerdown', (e) => {
    if (!S.img) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    cv.setPointerCapture(e.pointerId); stopAnim();
    const p = local(e); ptrs.set(e.pointerId, p);
    if (ptrs.size === 1) {
      const h = boxHit(p);
      gest = h ? { kind: 'box', h, p0: p, b0: S.box.slice() } : { kind: 'pan', p0: p, last: p, moved: false, hist: [{ x: p.x, y: p.y, t: now() }] };
    } else if (ptrs.size === 2) {
      const st = pinchState(); gest = { kind: 'pinch', st, s0: V.s, tx0: V.tx, ty0: V.ty };
    }
    if (gest && gest.kind !== 'box') vp.classList.add('grabbing');
  });
  cv.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (!ptrs.has(e.pointerId)) {
      if (e.pointerType === 'mouse' && S.phase === 'box') { const h = boxHit(p); cv.style.cursor = h ? CURS[h] : ''; }
      return;
    }
    ptrs.set(e.pointerId, p);
    if (!gest) return;
    if (gest.kind === 'pan') {
      if (!gest.moved && Math.hypot(p.x - gest.p0.x, p.y - gest.p0.y) > 6) gest.moved = true;
      if (gest.moved) { V.tx += p.x - gest.last.x; V.ty += p.y - gest.last.y; moved(); }
      gest.last = p; gest.hist.push({ x: p.x, y: p.y, t: now() }); if (gest.hist.length > 6) gest.hist.shift();
    } else if (gest.kind === 'pinch' && ptrs.size >= 2) {
      const st = pinchState(), s = clamp(gest.s0 * st.d / gest.st.d, minScale(), 60), k = s / gest.s0;
      V.s = s; V.tx = st.cx - (gest.st.cx - gest.tx0) * k; V.ty = st.cy - (gest.st.cy - gest.ty0) * k; moved();
    } else if (gest.kind === 'box') {
      const dx = (p.x - gest.p0.x) / V.s, dy = (p.y - gest.p0.y) / V.s, b = gest.b0.slice(), h = gest.h, m = 24;
      if (h.includes('w')) b[0] = clamp(gest.b0[0] + dx, 0, b[2] - m);
      if (h.includes('e')) b[2] = clamp(gest.b0[2] + dx, b[0] + m, S.W);
      if (h.includes('n')) b[1] = clamp(gest.b0[1] + dy, 0, b[3] - m);
      if (h.includes('s')) b[3] = clamp(gest.b0[3] + dy, b[1] + m, S.H);
      S.box = b; requestDraw();
    }
  });
  function endPtr(e, cancel) {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (!gest) return;
    if (gest.kind === 'pinch') {
      if (ptrs.size === 1) { const q = [...ptrs.values()][0]; gest = { kind: 'pan', p0: q, last: q, moved: true, hist: [{ x: q.x, y: q.y, t: now() }] }; }
      else gest = null;
      return;
    }
    if (gest.kind === 'pan' && !cancel) {
      if (!gest.moved) onTap(gest.p0);
      else { const h = gest.hist, a = h[0], b = h[h.length - 1], dt = b.t - a.t; if (dt > 0 && now() - b.t < 80) momentum((b.x - a.x) / dt, (b.y - a.y) / dt); }
    }
    if (ptrs.size === 0) { gest = null; vp.classList.remove('grabbing'); }
  }
  cv.addEventListener('pointerup', (e) => endPtr(e, false));
  cv.addEventListener('pointercancel', (e) => endPtr(e, true));
  cv.addEventListener('wheel', (e) => {
    if (!S.img) return;
    e.preventDefault(); stopAnim();
    const p = local(e), d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaX) < 0.5 || e.deltaMode !== 0) zoomAt(p.x, p.y, Math.exp(-d * (e.ctrlKey ? 0.01 : 0.0018)));
    else { V.tx -= e.deltaX; V.ty -= e.deltaY; moved(); }
  }, { passive: false });
  // Safari: gesto di pinch del trackpad
  let gs0 = 1;
  vp.addEventListener('gesturestart', (e) => { e.preventDefault(); gs0 = 1; });
  vp.addEventListener('gesturechange', (e) => { e.preventDefault(); const r = vp.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.scale / gs0); gs0 = e.scale; });
  vp.addEventListener('gestureend', (e) => e.preventDefault());
  function onTap(p) {
    const t = now(), dbl = t - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30;
    lastTap = { t: dbl ? 0 : t, x: p.x, y: p.y };
    if (dbl) {
      const fit = fitTarget(S.ref && S.phase === 'result' ? S.ref : null);
      if (V.s > fit.s * 2.5) springTo(fit);
      else { const s = Math.min(60, V.s * 2.5), k = s / V.s; springTo({ s, tx: p.x - (p.x - V.tx) * k, ty: p.y - (p.y - V.ty) * k }); }
      return;
    }
    if (S.edit) { const q = toImg(p); S.sel = hitTest(q.x, q.y, 14 / V.s); updateSel(); requestDraw(); }
  }

  /* ---------- modifica: selezione, elimina, cambia livello, annulla ---------- */
  function setEdit(on) {
    S.edit = !!on && S.paths.length > 0; if (!S.edit) S.sel = -1;
    $('b-edit').setAttribute('aria-pressed', String(S.edit)); vp.classList.toggle('editing', S.edit); $('editbar').hidden = !S.edit; updateSel(); requestDraw();
  }
  function updateSel() {
    const p = S.paths[S.sel];
    const inf = $('sel-info'), narrow = window.innerWidth < 600;
    inf.textContent = p ? (narrow ? LAYERS[p.l].label : LAYERS[p.l].label + ' · ' + (p.c ? 'chiusa' : 'aperta') + ' · ' + (p.v.length / 2) + ' vertici') : (narrow ? 'Tocca una linea' : 'Tocca una linea per selezionarla');
    $('b-del').disabled = !p; $('b-layer').disabled = !p; $('b-undo').disabled = !S.undo.length;
  }
  function delSel() { if (S.sel < 0) return; const p = S.paths[S.sel]; S.undo.push({ t: 'del', i: S.sel, p }); S.paths.splice(S.sel, 1); S.sel = -1; rebuild(); updateSel(); }
  function cycleLayer() { if (S.sel < 0) return; const p = S.paths[S.sel]; S.undo.push({ t: 'lay', i: S.sel, l: p.l }); p.l = (p.l + 1) % 4; rebuild(); updateSel(); say('Spostata in ' + LAYERS[p.l].label); }
  function undo() { const u = S.undo.pop(); if (!u) return; if (u.t === 'del') { S.paths.splice(u.i, 0, u.p); S.sel = u.i; } else { S.paths[u.i].l = u.l; S.sel = u.i; } rebuild(); updateSel(); }

  /* ---------- pannello: foglio con due posizioni su iPhone ---------- */
  const panel = $('panel'), grab = $('grab'), pscroll = $('pscroll');
  let sheetY = 0;
  const isWide = () => window.innerWidth >= 900;
  function sheetVisible() { if (isWide()) return 0; return grab.offsetHeight + $('step').offsetHeight + 18 + safeBottom(); }
  const sabEl = document.createElement('div');
  sabEl.style.cssText = 'position:fixed;left:0;bottom:0;width:0;height:0;padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none';
  document.body.appendChild(sabEl);
  function safeBottom() { return parseFloat(getComputedStyle(sabEl).paddingBottom) || 0; }
  function sheetLayout(animate) {
    if (isWide()) { panel.style.removeProperty('height'); panel.style.setProperty('--sheet-y', '0px'); pscroll.style.overflowY = 'auto'; return; }
    const H = vp.parentElement.clientHeight, full = Math.round(H * 0.86);
    panel.style.height = full + 'px';
    const peekY = Math.max(0, full - sheetVisible());
    setSheetY(S.sheet === 'full' ? 0 : peekY, animate);
    pscroll.style.overflowY = S.sheet === 'full' ? 'auto' : 'hidden';
    document.documentElement.style.setProperty('--peek', Math.round(full - peekY) + 'px');
  }
  let sheetAnim = 0;
  function setSheetY(y, animate) {
    cancelAnimationFrame(sheetAnim);
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { sheetY = y; panel.style.setProperty('--sheet-y', y + 'px'); return; }
    let v = 0, x = sheetY, last = now(); const w = 2 * Math.PI / 0.32, z = 0.86;
    const step = () => {
      const t = now(), dt = Math.min(0.032, (t - last) / 1000); last = t;
      const a = -w * w * (x - y) - 2 * z * w * v; v += a * dt; x += v * dt;
      sheetY = x; panel.style.setProperty('--sheet-y', x.toFixed(2) + 'px');
      if (Math.abs(x - y) > 0.4 || Math.abs(v) > 4) sheetAnim = requestAnimationFrame(step); else { sheetY = y; panel.style.setProperty('--sheet-y', y + 'px'); }
    };
    sheetAnim = requestAnimationFrame(step);
  }
  function setSheet(state) { if (S.sheet === state) { sheetLayout(true); return; } S.sheet = state; sheetLayout(true); }
  (function sheetDrag() {
    let d = null;
    const down = (e) => {
      if (isWide()) return;
      d = { y0: e.clientY, s0: sheetY, hist: [{ y: e.clientY, t: now() }], moved: false };
      e.currentTarget.setPointerCapture(e.pointerId); cancelAnimationFrame(sheetAnim);
    };
    const move = (e) => {
      if (!d) return;
      const dy = e.clientY - d.y0; if (Math.abs(dy) > 4) d.moved = true;
      const full = panel.offsetHeight - sheetVisible(); let y = d.s0 + dy;
      if (y < 0) y = -Math.pow(-y, 0.7); if (y > full) y = full + Math.pow(y - full, 0.7);
      sheetY = y; panel.style.setProperty('--sheet-y', y + 'px');
      d.hist.push({ y: e.clientY, t: now() }); if (d.hist.length > 5) d.hist.shift();
    };
    const up = () => {
      if (!d) return;
      const h = d.hist, a = h[0], b = h[h.length - 1], v = b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0;
      if (!d.moved) { setSheet(S.sheet === 'full' ? 'peek' : 'full'); d = null; return; }
      const proj = sheetY + v * 0.998 / (1 - 0.998), full = panel.offsetHeight - sheetVisible();
      S.sheet = proj < full / 2 ? 'full' : 'peek'; d = null; sheetLayout(true);
    };
    grab.addEventListener('pointerdown', down); grab.addEventListener('pointermove', move); grab.addEventListener('pointerup', up); grab.addEventListener('pointercancel', up);
  })();

  /* ---------- schede del pannello ---------- */
  function setPhase(ph) {
    S.phase = ph;
    document.body.classList.toggle('is-empty', ph === 'empty');
    $('empty').hidden = ph !== 'empty';
    $('b-edit').disabled = ph !== 'result';
    if (ph !== 'result' && S.edit) setEdit(false);
    if (ph === 'run' || ph === 'box') S.sheet = 'peek';
    renderStep(); updateButtons(); requestDraw();
    requestAnimationFrame(() => sheetLayout(true));
  }
  function renderStep() {
    const el = $('step');
    if (S.phase === 'empty') {
      el.innerHTML = '<p class="title">Inizia da una foto</p><p class="sub">Una foto frontale dell\'edificio, il più possibile dritta. Il raddrizzamento e la scala li puoi fare poi nel CAD.</p><div class="actions"><button class="btn filled lg" data-act="pick">Scegli una foto</button></div>';
    } else if (S.phase === 'box') {
      el.innerHTML = '<p class="title">Inquadra l\'edificio</p><p class="sub">Trascina gli angoli del riquadro attorno alla facciata: ciò che resta fuori viene ignorato.</p>' +
        '<div class="seg full" role="group" aria-label="Modalità">' + Object.keys(MODES).map((k) => '<button type="button" data-mode="' + k + '" aria-pressed="' + (S.mode === k) + '">' + MODES[k].label + '</button>').join('') + '</div>' +
        '<p class="mode-desc">' + MODES[S.mode].desc + '</p><div class="actions"><button class="btn filled lg" data-act="convert">Converti</button></div>';
    } else if (S.phase === 'run') {
      el.innerHTML = '<p class="title" id="run-title">Conversione in corso</p><div class="progress"><i id="pbar"></i></div><div class="prog-row"><span id="pmsg"></span><span id="peta"></span></div><p class="meta">Puoi spostarti e ingrandire mentre lavora. Su iPhone tieni lo schermo acceso.</p><div class="actions"><button class="btn gray" data-act="stop">Interrompi</button></div>';
      renderProgress();
    } else if (S.phase === 'result') {
      const inf = S.info || {}, shapes = S.paths.filter((p) => p.c).length;
      el.innerHTML = '<p class="title">Disegno pronto</p><div class="summary"><div><b>' + fmtInt(inf.lines || 0) + '</b><span>linee</span></div><div><b>' + fmtInt(inf.arcs || 0) + '</b><span>archi</span></div><div><b>' + fmtInt(shapes) + '</b><span>forme chiuse</span></div></div>' +
        '<div class="actions"><button class="btn filled" data-act="dxf">Esporta DXF</button><button class="btn gray" data-act="edit">Correggi</button></div>' +
        '<p class="meta">' + MODES[S.mode].label + (S.timings.total ? ' · ' + fmtTime(S.timings.total) : '') + ' · <button class="btn plain sm" data-act="again" style="min-height:28px;padding:0 4px">Nuova conversione</button></p>';
    }
    requestAnimationFrame(() => sheetLayout(false));
  }
  function renderProgress() {
    const bar = $('pbar'); if (!bar) return;
    const p = S.prog || {}, stage = p.stage, sd = S.ai && S.ai.detail;
    let frac = p.frac || 0;
    if (S.mode !== 'classic') { if (stage === 'download') frac = 0.02; else if (stage === 'neural') frac = sd ? 0.02 + 0.33 * frac : 0.05 + 0.9 * frac; else if (stage === 'seg') frac = 0.35 + 0.62 * frac; }
    bar.style.width = (100 * clamp(frac, 0, 1)).toFixed(1) + '%';
    $('pmsg').textContent = p.msg || '';
    $('peta').textContent = p.eta != null && p.eta > 2000 ? 'circa ' + fmtTime(p.eta) : '';
    $('run-title').textContent = stage === 'download' ? 'Preparo i modelli' : stage === 'seg' ? 'Riconosco le forme' : 'Conversione in corso';
  }
  $('step').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.mode) { S.mode = b.dataset.mode; renderStep(); return; }
    const a = b.dataset.act;
    if (a === 'pick') $('file').click();
    else if (a === 'convert') convert();
    else if (a === 'stop') cancelRun(false);
    else if (a === 'dxf') exportAs('dxf');
    else if (a === 'edit') setEdit(true);
    else if (a === 'again') { S.paths = []; S.ref = null; rebuild(); setPhase('box'); fitView(true, true); }
  });

  function renderLayers() {
    const counts = [0, 0, 0, 0]; for (const p of S.paths) counts[p.l]++;
    $('layers').innerHTML = LAYERS.map((L, i) => '<li><span class="sw" style="border-top-color:var(' + L.v + ');border-top-width:' + (i === 0 ? 3 : i === 1 ? 2 : 1.5) + 'px;' + (L.dash ? 'border-top-style:dashed' : '') + '"></span><span class="nm">' + L.label + '<small>' + L.desc + '</small></span><span class="ct">' + fmtInt(counts[i]) + '</span><label class="switch" aria-label="Mostra ' + L.label + '"><input type="checkbox" data-layer="' + i + '"' + (S.show[i] ? ' checked' : '') + '><span></span></label></li>').join('');
  }
  $('layers').addEventListener('change', (e) => { const i = e.target.dataset.layer; if (i == null) return; S.show[+i] = e.target.checked; if (S.sel >= 0 && !S.show[S.paths[S.sel].l]) S.sel = -1; renderStats(); requestDraw(); });

  /* ---------- esportazione ---------- */
  const vis = () => S.paths.filter((p) => S.show[p.l]);
  function refRect() { return S.ref || [0, 0, S.W, S.H]; }
  function mmPerPx() { const v = parseFloat($('wmm').value), r = refRect(); return (v > 0 ? v : 10000) / Math.max(1, r[2] - r[0]); }
  function pathLenOf(p) {
    const v = p.v, n = v.length / 2, m = p.c ? n : n - 1; let L = 0;
    for (let i = 0; i < m; i++) { const j = (i + 1) % n, c = Math.hypot(v[2 * j] - v[2 * i], v[2 * j + 1] - v[2 * i + 1]), b = p.b[i]; if (!b) L += c; else { const th = 4 * Math.atan(Math.abs(b)); L += c / (2 * Math.sin(th / 2)) * th; } }
    return L;
  }
  function renderStats() {
    const r = refRect(), k = mmPerPx(), vp2 = vis(); let verts = 0, len = 0;
    for (const p of vp2) { verts += p.v.length / 2; len += pathLenOf(p); }
    const m = (mm) => (mm >= 1000 ? fmt1(mm / 1000) + ' m' : fmtInt(mm) + ' mm');
    $('stats').innerHTML = S.paths.length ? '<dt>Dimensioni</dt><dd>' + m((r[2] - r[0]) * k) + ' × ' + m((r[3] - r[1]) * k) + '</dd><dt>Polilinee</dt><dd>' + fmtInt(vp2.length) + '</dd><dt>Vertici</dt><dd>' + fmtInt(verts) + '</dd><dt>Lunghezza linee</dt><dd>' + m(len * k) + '</dd>' : '';
  }
  function pathD(paths, fx, fy, rs) {
    const f = (n) => String(+n.toFixed(3)), out = [];
    for (const p of paths) {
      const v = p.v, n = v.length / 2, m = p.c ? n : n - 1;
      let d = 'M' + f(fx(v[0])) + ' ' + f(fy(v[1]));
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % n, x = v[2 * j], y = v[2 * j + 1], b = p.b[i];
        if (!b) d += 'L' + f(fx(x)) + ' ' + f(fy(y));
        else { const c = Math.hypot(x - v[2 * i], y - v[2 * i + 1]), th = 4 * Math.atan(Math.abs(b)), r = c / (2 * Math.sin(th / 2)) * rs; d += 'A' + f(r) + ' ' + f(r) + ' 0 ' + (th > Math.PI ? 1 : 0) + ' ' + (b > 0 ? 0 : 1) + ' ' + f(fx(x)) + ' ' + f(fy(y)); }
      }
      out.push(d + (p.c ? 'Z' : ''));
    }
    return out.join('');
  }
  function buildSVG() {
    const r = refRect(), k = mmPerPx(), w = (r[2] - r[0]) * k, h = (r[3] - r[1]) * k, ps = vis(), g = [];
    for (let l = 0; l < 4; l++) {
      const sel = ps.filter((p) => p.l === l); if (!sel.length) continue;
      const L = LAYERS[l], sw = L.w;
      g.push('<g id="' + L.name + '" fill="none" stroke="#000000" stroke-width="' + sw + '" stroke-linejoin="round" stroke-linecap="round"' + (L.dash ? ' stroke-dasharray="' + (sw * 8) + ' ' + (sw * 5) + '"' : '') + '>\n<path d="' + pathD(sel, (x) => (x - r[0]) * k, (y) => (y - r[1]) * k, k) + '"/>\n</g>');
    }
    return '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="' + w.toFixed(3) + 'mm" height="' + h.toFixed(3) + 'mm" viewBox="0 0 ' + w.toFixed(3) + ' ' + h.toFixed(3) + '">\n' + g.join('\n') + '\n</svg>\n';
  }
  /* DXF R12: un layer per livello (colori e tipi di linea), LINE per i tratti singoli, POLYLINE con bulge per catene e archi */
  function buildDXF() {
    const r = refRect(), k = mmPerPx();
    const o = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '9', '$LTSCALE', '40', '1.0', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'TABLES',
      '0', 'TABLE', '2', 'LTYPE', '70', '2',
      '0', 'LTYPE', '2', 'CONTINUOUS', '70', '0', '3', 'Continua', '72', '65', '73', '0', '40', '0.0',
      '0', 'LTYPE', '2', 'DASHED', '70', '0', '3', 'Tratteggio __ __', '72', '65', '73', '2', '40', String(Math.max(6, (r[2] - r[0]) * k / 150).toFixed(2)), '49', String(Math.max(4, (r[2] - r[0]) * k / 225).toFixed(2)), '49', String(-Math.max(2, (r[2] - r[0]) * k / 450).toFixed(2)),
      '0', 'ENDTAB',
      '0', 'TABLE', '2', 'LAYER', '70', '5', '0', 'LAYER', '2', '0', '70', '0', '62', '7', '6', 'CONTINUOUS'];
    for (const L of LAYERS) o.push('0', 'LAYER', '2', L.name, '70', '0', '62', String(L.aci), '6', L.dash ? 'DASHED' : 'CONTINUOUS');
    o.push('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');
    const X = (x) => ((x - r[0]) * k).toFixed(3), Y = (y) => ((r[3] - y) * k).toFixed(3);
    for (const p of vis()) {
      const v = p.v, n = v.length / 2, ly = LAYERS[p.l].name;
      if (!p.c && n === 2 && !p.b[0]) { o.push('0', 'LINE', '8', ly, '10', X(v[0]), '20', Y(v[1]), '30', '0.0', '11', X(v[2]), '21', Y(v[3]), '31', '0.0'); continue; }
      o.push('0', 'POLYLINE', '8', ly, '66', '1', '10', '0.0', '20', '0.0', '30', '0.0', '70', p.c ? '1' : '0');
      for (let i = 0; i < n; i++) { o.push('0', 'VERTEX', '8', ly, '10', X(v[2 * i]), '20', Y(v[2 * i + 1]), '30', '0.0'); if (i < p.b.length && p.b[i]) o.push('42', p.b[i].toFixed(6)); }
      o.push('0', 'SEQEND', '8', ly);
    }
    o.push('0', 'ENDSEC', '0', 'EOF');
    return o.join('\n') + '\n';
  }
  function arcBezier(P, Q, b) {
    const a = arcCenter(P, Q, b), th = 4 * Math.atan(Math.abs(b)), r = a.r;
    let ang = Math.atan2(P[1] - a.cy, P[0] - a.cx);
    const delta = (b > 0 ? -1 : 1) * th, pieces = Math.ceil(Math.abs(delta) / (Math.PI / 2)), phi = delta / pieces, kk = 4 / 3 * Math.tan(phi / 4), out = [];
    for (let i = 0; i < pieces; i++) {
      const a1 = ang + phi, p0x = a.cx + r * Math.cos(ang), p0y = a.cy + r * Math.sin(ang), p3x = a.cx + r * Math.cos(a1), p3y = a.cy + r * Math.sin(a1);
      out.push([p0x - kk * r * Math.sin(ang), p0y + kk * r * Math.cos(ang), p3x + kk * r * Math.sin(a1), p3y - kk * r * Math.cos(a1), p3x, p3y]);
      ang = a1;
    }
    return out;
  }
  function buildPDF() {
    const r = refRect(), pt = 72 / 25.4, k = mmPerPx(), maxSide = 1180;
    let sc = k * pt; const w0 = (r[2] - r[0]) * sc, h0 = (r[3] - r[1]) * sc; const fitK = Math.min(1, maxSide / Math.max(w0, h0)); sc *= fitK;
    const pw = (r[2] - r[0]) * sc + 40, ph = (r[3] - r[1]) * sc + 40;
    const X = (x) => (20 + (x - r[0]) * sc).toFixed(2), Y = (y) => (20 + (r[3] - y) * sc).toFixed(2), c = ['1 J 1 j 0 0 0 RG'];
    for (let l = 3; l >= 0; l--) {
      const L = LAYERS[l]; c.push(Math.max(0.2, L.w * pt * Math.max(0.35, fitK)).toFixed(2) + ' w', L.dash ? '[4 2.5] 0 d' : '[] 0 d');
      for (const p of vis()) {
        if (p.l !== l) continue;
        const v = p.v, n = v.length / 2, m = p.c ? n : n - 1, parts = [X(v[0]) + ' ' + Y(v[1]) + ' m'];
        for (let i = 0; i < m; i++) {
          const j = (i + 1) % n, b = p.b[i];
          if (!b) parts.push(X(v[2 * j]) + ' ' + Y(v[2 * j + 1]) + ' l');
          else for (const z of arcBezier([v[2 * i], v[2 * i + 1]], [v[2 * j], v[2 * j + 1]], b)) parts.push(X(z[0]) + ' ' + Y(z[1]) + ' ' + X(z[2]) + ' ' + Y(z[3]) + ' ' + X(z[4]) + ' ' + Y(z[5]) + ' c');
        }
        parts.push(p.c ? 'h S' : 'S'); c.push(parts.join('\n'));
      }
    }
    const cs = c.join('\n') + '\n';
    const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw.toFixed(2) + ' ' + ph.toFixed(2) + '] /Contents 4 0 R /Resources << >> >>', '<< /Length ' + cs.length + ' >>\nstream\n' + cs + 'endstream'];
    let out = '%PDF-1.4\n'; const offs = [];
    objs.forEach((ob, i) => { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + ob + '\nendobj\n'; });
    const xr = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map((x) => String(x).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xr + '\n%%EOF';
    return out;
  }
  const baseName = () => (S.name || 'disegno').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_') || 'disegno';
  async function saveFile(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    let dl = null;
    try { dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (e) { dl = null; }
    if (dl) {
      try { await dl.save({ filename, data: blob }); say('Salvato: ' + filename); return; }
      catch (e) {
        if (e && e.code === 'declined') { say('Salvataggio annullato.'); return; }
        if (e && e.code === 'rejected_extension' && filename.endsWith('.dxf')) { try { await dl.save({ filename: filename + '.txt', data: blob }); say('Salvato come .dxf.txt: rinominalo in .dxf.'); return; } catch (e2) { /* sotto */ } }
      }
    }
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    say('Esportato: ' + filename);
  }
  function exportAs(kind) {
    if (!S.paths.length) return;
    if (kind === 'dxf') saveFile(baseName() + '.dxf', buildDXF(), 'application/dxf');
    else if (kind === 'svg') saveFile(baseName() + '.svg', buildSVG(), 'image/svg+xml');
    else if (kind === 'pdf') saveFile(baseName() + '.pdf', buildPDF(), 'application/pdf');
  }
  async function copyDXF() {
    const t = buildDXF();
    try { await navigator.clipboard.writeText(t); say('DXF copiato: incollalo in un file .dxf.'); } catch (e) { say('Il browser non permette di copiare: usa il pulsante DXF.'); }
  }
  function updateButtons() {
    const has = S.paths.length > 0;
    $('sec-layers').hidden = !has; $('sec-export').hidden = !has;
    for (const id of ['ex-dxf', 'ex-svg', 'ex-pdf', 'ex-copy', 'b-export']) $(id).disabled = !has;
    $('b-undo').disabled = !S.undo.length;
    const t = S.timings || {}, ai = t.ai || {};
    $('perf').textContent = (S.phase === 'result' ? ['Motore AI: ' + AIW.mode, 'motore geometrico: ' + Eng.mode, t.neural ? 'disegno neurale ' + fmtTime(ai.neural || t.neural) : '', ai.seg ? 'forme ' + fmtTime(ai.seg) + ' (' + fmtInt(t.decodes || 0) + ' prove)' : '', t.vec ? 'vettorizzazione ' + fmtTime(t.vec) : '', performance.memory ? 'memoria JS ' + Math.round(performance.memory.usedJSHeapSize / 1048576) + ' MB' : ''].filter(Boolean).join(' · ') : 'Disponibili dopo una conversione.');
  }

  /* ---------- collegamenti ---------- */
  $('b-open').onclick = () => $('file').click();
  $('b-pick').onclick = () => $('file').click();
  $('b-sample').onclick = makeSample;
  $('file').onchange = (e) => { loadFile(e.target.files[0]); e.target.value = ''; };
  $('b-export').onclick = () => {
    if (isWide()) { $('sec-export').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    S.sheet = 'full'; sheetLayout(true); setTimeout(() => { pscroll.scrollTo({ top: $('sec-export').offsetTop - 8, behavior: 'smooth' }); }, 120);
  };
  $('ex-dxf').onclick = () => exportAs('dxf'); $('ex-svg').onclick = () => exportAs('svg'); $('ex-pdf').onclick = () => exportAs('pdf'); $('ex-copy').onclick = copyDXF;
  $('wmm').addEventListener('input', renderStats);
  $('b-fit').onclick = () => fitView(true);
  $('b-zin').onclick = () => { const t = { s: Math.min(60, V.s * 1.6) }; t.tx = VW / 2 - (VW / 2 - V.tx) * t.s / V.s; t.ty = VH / 2 - (VH / 2 - V.ty) * t.s / V.s; springTo(t); };
  $('b-zout').onclick = () => { const t = { s: Math.max(minScale(), V.s / 1.6) }; t.tx = VW / 2 - (VW / 2 - V.tx) * t.s / V.s; t.ty = VH / 2 - (VH / 2 - V.ty) * t.s / V.s; springTo(t); };
  $('b-edit').onclick = () => setEdit(!S.edit);
  $('b-del').onclick = delSel; $('b-layer').onclick = cycleLayer; $('b-undo').onclick = undo;
  $('seg-view').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.view = b.dataset.view; for (const x of $('seg-view').children) x.setAttribute('aria-pressed', String(x === b)); requestDraw(); });
  $('seg-classic').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; S.classic = b.dataset.cmode;
    for (const x of $('seg-classic').children) x.setAttribute('aria-pressed', String(x === b));
    const d = DEF[S.classic]; for (const k of ['sens', 'blur', 'simp', 'minlen', 'merge']) if (d[k] !== undefined) $(k).value = d[k]; $('straight').checked = d.straight;
    updateLabels(); liveClassic();
  });
  function liveClassic() { if (S.mode === 'classic' && S.phase === 'result') { clearTimeout(classicT); classicT = setTimeout(() => runClassic(false), 180); } }
  for (const id of ['sens', 'blur', 'simp', 'minlen', 'merge', 'thr', 'arcs', 'straight', 'auto', 'inv', 'autoall']) $(id).addEventListener('input', () => { updateLabels(); liveClassic(); });
  let thrT = 0;
  $('ai-thr').addEventListener('input', () => { updateLabels(); if (S.ai && S.ai.neural && S.phase === 'result') { clearTimeout(thrT); thrT = setTimeout(() => vectorize(true), 250); } });
  // trascina e incolla
  let dragN = 0;
  window.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer && e.dataTransfer.types || [])].includes('Files')) { dragN++; $('drop').hidden = false; e.preventDefault(); } });
  window.addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) $('drop').hidden = true; });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); dragN = 0; $('drop').hidden = true; const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) loadFile(f); });
  window.addEventListener('paste', (e) => { for (const it of (e.clipboardData && e.clipboardData.items) || []) if (it.type.startsWith('image/')) { loadFile(it.getAsFile()); e.preventDefault(); return; } });
  // tastiera (desktop)
  window.addEventListener('keydown', (e) => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); $('file').click(); }
    else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); exportAs('dxf'); }
    else if (!mod && (e.key === 'Delete' || e.key === 'Backspace') && S.edit) { e.preventDefault(); delSel(); }
    else if (!mod && e.key === 'f') fitView(true);
    else if (!mod && e.key === 'm' && S.phase === 'result') setEdit(!S.edit);
    else if (!mod && (e.key === '+' || e.key === '=')) $('b-zin').click();
    else if (!mod && e.key === '-') $('b-zout').click();
    else if (!mod && e.key === 'Escape') { if (S.phase === 'run') cancelRun(false); else if (S.edit) setEdit(false); }
    else if (!mod && e.key === 'Enter' && S.phase === 'box') convert();
  });
  new ResizeObserver(() => { resize(); sheetLayout(false); }).observe(vp);
  window.addEventListener('resize', () => sheetLayout(false));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) requestDraw(); });

  readColors(); updateLabels(); resize(); setPhase('empty');
  window.__fv = { S, V, Eng, AIW, rebuild, buildDXF, buildSVG, buildPDF, fitView, setPhase, convert };
