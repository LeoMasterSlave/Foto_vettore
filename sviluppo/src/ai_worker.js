  /* =====================================================================
     Motore AI (gira in un Web Worker; in mancanza, nel thread principale)
     - Informative Drawings (contorni): disegno a linee per riquadri sovrapposti
     - MobileSAM: segmentazione delle forme (passaggio largo + riquadri fini)
     Messaggi in ingresso: {type:'run', id, rgba, W, H, detail, base}, {type:'cancel'}
     Messaggi in uscita:   prog, neural, polys, done, error
     ===================================================================== */
  function makeAI(emit, getOrt) {
    let cancelled = false, busy = false;
    const sessions = {};
    const MODELS = { id: 'contour_style_512x512.onnx', enc: 'mobilesam-encoder.onnx', dec: 'mobilesam-decoder.onnx' };
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const pause = () => new Promise((r) => setTimeout(r, 0));
    function check() { if (cancelled) throw new Error('__cancel__'); }

    async function loadModel(base, key, label) {
      const url = base + MODELS[key];
      let cache = null;
      try { cache = await caches.open('fotovettore-modelli-v1'); const hit = await cache.match(url); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch (e) { cache = null; }
      const r = await fetch(url);
      if (!r.ok) throw new Error('Impossibile scaricare il modello (' + r.status + ')');
      const len = +r.headers.get('content-length') || 0;
      const rd = r.body && r.body.getReader ? r.body.getReader() : null;
      let buf;
      if (rd) {
        const parts = []; let got = 0;
        for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; if (len) emit({ type: 'prog', stage: 'download', frac: got / len, msg: 'Scarico ' + label + ' · ' + Math.round(got / 1048576) + ' / ' + Math.round(len / 1048576) + ' MB' }); check(); }
        buf = new Uint8Array(got); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
      } else buf = new Uint8Array(await r.arrayBuffer());
      try { if (cache) await cache.put(url, new Response(buf.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } })); } catch (e) { /* spazio pieno: si riscarica la prossima volta */ }
      return buf;
    }
    async function session(base, key, label) {
      if (sessions[key]) return sessions[key];
      const ort = getOrt();
      const buf = await loadModel(base, key, label);
      emit({ type: 'prog', stage: 'download', frac: 1, msg: 'Preparo ' + label + '…' });
      try { sessions[key] = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }); }
      catch (e) { const err = new Error(String(e && e.message || e)); err.init = true; throw err; }
      return sessions[key];
    }
    async function release(key) { const s = sessions[key]; delete sessions[key]; try { if (s && s.release) await s.release(); } catch (e) { /* già liberata */ } }

    /* Campiona il quadrato [x, y, T] dell'immagine RGBA in un tensore D×D (bilineare). Fuori dai bordi: colore del bordo. */
    function sampleTile(rgba, W, H, x, y, T, D, mean, std) {
      const out = new Float32Array(3 * D * D), P = D * D, k = T / D;
      for (let j = 0; j < D; j++) {
        let sy = y + (j + 0.5) * k - 0.5; sy = sy < 0 ? 0 : sy > H - 1 ? H - 1 : sy;
        const y0 = sy | 0, y1 = Math.min(H - 1, y0 + 1), fy = sy - y0;
        for (let i = 0; i < D; i++) {
          let sx = x + (i + 0.5) * k - 0.5; sx = sx < 0 ? 0 : sx > W - 1 ? W - 1 : sx;
          const x0 = sx | 0, x1 = Math.min(W - 1, x0 + 1), fx = sx - x0;
          const a = (y0 * W + x0) * 4, b = (y0 * W + x1) * 4, c = (y1 * W + x0) * 4, d = (y1 * W + x1) * 4, o = j * D + i;
          for (let ch = 0; ch < 3; ch++) {
            const v = (rgba[a + ch] * (1 - fx) + rgba[b + ch] * fx) * (1 - fy) + (rgba[c + ch] * (1 - fx) + rgba[d + ch] * fx) * fy;
            out[ch * P + o] = mean ? (v - mean[ch]) / std[ch] : v;
          }
        }
      }
      return out;
    }
    function positions(L, T, stride) { const a = []; for (let p = 0; p < L - T; p += stride) a.push(p); a.push(Math.max(0, L - T)); return [...new Set(a)]; }

    /* ---------- 1. Disegno neurale ---------- */
    async function neuralMap(base, rgba, W, H) {
      const s = await session(base, 'id', 'disegno neurale (18 MB)');
      const T = Math.min(360, W, H), stride = Math.round(T * 0.7), xs = positions(W, T, stride), ys = positions(H, T, stride);
      const acc = new Float32Array(W * H), wt = new Float32Array(W * H), han = new Float32Array(T);
      for (let i = 0; i < T; i++) han[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 1) / (T + 1));
      const N = xs.length * ys.length; let n = 0; const t0 = now();
      for (const y of ys) for (const x of xs) {
        check();
        const inp = sampleTile(rgba, W, H, x, y, T, 512, null, null);
        const res = await s.run({ [s.inputNames[0]]: new (getOrt().Tensor)('float32', inp, [1, 3, 512, 512]) });
        const o = res[s.outputNames[0]].data, k = 512 / T;
        for (let j = 0; j < T && y + j < H; j++) {
          let sy = (j + 0.5) * k - 0.5; sy = sy < 0 ? 0 : sy > 511 ? 511 : sy; const y0 = sy | 0, y1 = Math.min(511, y0 + 1), fy = sy - y0;
          for (let i = 0; i < T && x + i < W; i++) {
            let sx = (i + 0.5) * k - 0.5; sx = sx < 0 ? 0 : sx > 511 ? 511 : sx; const x0 = sx | 0, x1 = Math.min(511, x0 + 1), fx = sx - x0;
            const v = (o[y0 * 512 + x0] * (1 - fx) + o[y0 * 512 + x1] * fx) * (1 - fy) + (o[y1 * 512 + x0] * (1 - fx) + o[y1 * 512 + x1] * fx) * fy;
            const w = han[i] * han[j] + 1e-3, p = (y + j) * W + x + i; acc[p] += v * w; wt[p] += w;
          }
        }
        n++;
        const el = now() - t0, eta = el / n * (N - n);
        emit({ type: 'prog', stage: 'neural', frac: n / N, msg: 'Disegno neurale · ' + n + '/' + N, eta });
        await pause();
      }
      const out = new Float32Array(W * H); for (let i = 0; i < W * H; i++) out[i] = wt[i] ? acc[i] / wt[i] : 1;
      return out;
    }

    /* Punti di partenza per la segmentazione: il centro di ogni cella chiusa del disegno neurale */
    function cellPrompts(nm, W, H) {
      const N = W * H, wall = new Uint8Array(N); for (let i = 0; i < N; i++) wall[i] = nm[i] < 0.5 ? 1 : 0;
      const dt = new Float32Array(N); const INF = 1e9;
      for (let i = 0; i < N; i++) dt[i] = wall[i] ? 0 : INF;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!dt[i]) continue; let v = dt[i]; if (x > 0) v = Math.min(v, dt[i - 1] + 1); if (y > 0) { v = Math.min(v, dt[i - W] + 1); if (x > 0) v = Math.min(v, dt[i - W - 1] + 1.414); if (x < W - 1) v = Math.min(v, dt[i - W + 1] + 1.414); } dt[i] = v; }
      for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const i = y * W + x; let v = dt[i]; if (!v) continue; if (x < W - 1) v = Math.min(v, dt[i + 1] + 1); if (y < H - 1) { v = Math.min(v, dt[i + W] + 1); if (x < W - 1) v = Math.min(v, dt[i + W + 1] + 1.414); if (x > 0) v = Math.min(v, dt[i + W - 1] + 1.414); } dt[i] = v; }
      const lab = new Int32Array(N), out = []; let id = 0;
      const k = Math.max(W, H) / 900, minA = 120 * k * k, maxA = 0.08 * N;
      for (let s = 0; s < N; s++) {
        if (wall[s] || lab[s]) continue;
        id++; const comp = [s]; lab[s] = id; let best = s;
        for (let q = 0; q < comp.length; q++) {
          const i = comp[q], x = i % W;
          if (dt[i] > dt[best]) best = i;
          if (x > 0 && !wall[i - 1] && !lab[i - 1]) { lab[i - 1] = id; comp.push(i - 1); }
          if (x < W - 1 && !wall[i + 1] && !lab[i + 1]) { lab[i + 1] = id; comp.push(i + 1); }
          if (i >= W && !wall[i - W] && !lab[i - W]) { lab[i - W] = id; comp.push(i - W); }
          if (i < N - W && !wall[i + W] && !lab[i + W]) { lab[i + W] = id; comp.push(i + W); }
        }
        if (comp.length >= minA && comp.length <= maxA) out.push([best % W, (best / W) | 0, comp.length]);
      }
      out.sort((a, b) => b[2] - a[2]);
      return out;
    }

    /* Contorno (Moore) della maschera 256×256 attorno al pixel s */
    function traceMask(m, s) {
      const D = 256, lab = new Uint8Array(D * D), comp = [s]; lab[s] = 1;
      for (let q = 0; q < comp.length; q++) { const i = comp[q], x = i & 255; for (const j of [x > 0 ? i - 1 : -1, x < 255 ? i + 1 : -1, i - D, i + D]) if (j >= 0 && j < D * D && m[j] > 0 && !lab[j]) { lab[j] = 1; comp.push(j); } }
      let start = comp[0]; for (const i of comp) if (i < start) start = i;
      const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
      const inside = (x, y) => x >= 0 && y >= 0 && x < D && y < D && lab[y * D + x] === 1;
      let x = start & 255, y = start >> 8, d = 6; const pts = [];
      const sx = x, sy = y;
      for (let it = 0; it < 4 * D * D; it++) {
        pts.push(x, y);
        let found = false;
        for (let k = 0; k < 8; k++) {
          const nd = (d + 6 + k) % 8, nx = x + dirs[nd][0], ny = y + dirs[nd][1];
          if (inside(nx, ny)) { x = nx; y = ny; d = nd; found = true; break; }
        }
        if (!found || (x === sx && y === sy && pts.length > 4)) break;
      }
      return { pts, area: comp.length };
    }

    /* ---------- 2. Segmentazione delle forme ---------- */
    async function segment(base, rgba, W, H, nm) {
      const enc = await session(base, 'enc', 'segmentazione (27 MB)'), dec = await session(base, 'dec', 'segmentazione (16 MB)');
      const Tn = getOrt().Tensor, mean = [123.675, 116.28, 103.53], std = [58.395, 57.12, 57.375];
      const zeros = new Float32Array(65536), hasM = new Float32Array([0]), osz = new Float32Array([256, 256]);
      const cover = new Uint8Array(W * H), tried = new Uint8Array(W * H), polys = [];
      const k = Math.max(W, H) / 900, cells = cellPrompts(nm, W, H);
      // passaggi: uno largo (tutta la regione) per aperture e portali, poi riquadri fini per i dettagli
      const Tc = Math.max(W, H), Tf = Math.min(360 * k, W, H), sf = Math.round(Tf * 0.75);
      const tiles = [{ x: 0, y: 0, T: Tc, G: 12, coarse: true }];
      for (const y of positions(H, Tf, sf)) for (const x of positions(W, Tf, sf)) tiles.push({ x, y, T: Tf, G: 14 });
      let decodes = 0, nt = 0; const t0 = now();
      for (const tl of tiles) {
        check();
        const emb = (await enc.run({ [enc.inputNames[0]]: new Tn('float32', sampleTile(rgba, W, H, tl.x, tl.y, tl.T, 1024, mean, std), [1, 3, 1024, 1024]) }))[enc.outputNames[0]];
        const sc = 1024 / tl.T, mg = 0.05 * tl.T, pts = [];
        if (!tl.coarse) for (const c of cells) if (c[0] > tl.x + mg && c[0] < tl.x + tl.T - mg && c[1] > tl.y + mg && c[1] < tl.y + tl.T - mg) pts.push([c[0], c[1]]);
        const grid = [];
        for (let a = 0; a < tl.G; a++) for (let b = 0; b < tl.G; b++) grid.push([tl.x + (0.04 + 0.92 * b / (tl.G - 1)) * tl.T + (Math.random() * 6 - 3) * k, tl.y + (0.04 + 0.92 * a / (tl.G - 1)) * tl.T + (Math.random() * 6 - 3) * k]);
        for (let i = grid.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [grid[i], grid[j]] = [grid[j], grid[i]]; }
        for (const g of grid) pts.push(g);
        let local = 0;
        for (const [px, py] of pts) {
          check();
          if (px < 0 || py < 0 || px >= W || py >= H) continue;
          const xi = px | 0, yi = py | 0, pi = yi * W + xi;
          if (cover[pi] || tried[pi] || nm[pi] < 0.45) continue;
          const rr = Math.round(6 * k);
          for (let yy = Math.max(0, yi - rr); yy <= Math.min(H - 1, yi + rr); yy++) for (let xx = Math.max(0, xi - rr); xx <= Math.min(W - 1, xi + rr); xx++) tried[yy * W + xx] = 1;
          const o = await dec.run({ image_embeddings: emb, point_coords: new Tn('float32', new Float32Array([(px - tl.x) * sc, (py - tl.y) * sc, 0, 0]), [1, 2, 2]), point_labels: new Tn('float32', new Float32Array([1, -1]), [1, 2]), mask_input: new Tn('float32', zeros, [1, 1, 256, 256]), has_mask_input: new Tn('float32', hasM, [1]), orig_im_size: new Tn('float32', osz, [2]) });
          decodes++; local++;
          if (local % 8 === 0) { emit({ type: 'prog', stage: 'seg', frac: (nt + Math.min(0.95, local / Math.max(1, pts.length * 0.4))) / tiles.length, msg: 'Riconosco le forme · ' + polys.length + ' trovate', eta: nt ? (now() - t0) / nt * (tiles.length - nt) : null }); await pause(); }
          if (o.iou_predictions.data[0] < 0.75) continue;
          const low = o.low_res_masks.data, f = tl.T / 256;
          // la maschera deve stare nella regione e non toccare i bordi del riquadro
          const cx = Math.min(255, Math.max(0, ((px - tl.x) / f) | 0)), cy = Math.min(255, Math.max(0, ((py - tl.y) / f) | 0));
          if (low[cy * 256 + cx] <= 0) continue;
          const tr = traceMask(low, cy * 256 + cx), A = tr.area;
          const maxA = tl.coarse ? 0.12 * (W * H) / (f * f) : 0.45 * 65536;
          if (A < 94 * (tl.coarse ? 0.3 : 1) || A > maxA) continue;
          let bord = 0; const lim = tl.coarse ? [Math.ceil(W / f), Math.ceil(H / f)] : [256, 256];
          for (let i = 0; i < tr.pts.length; i += 2) { const x = tr.pts[i], y = tr.pts[i + 1]; if (x <= 0 || y <= 0 || x >= lim[0] - 1 || y >= lim[1] - 1) bord++; }
          if (bord > 3) continue;
          // doppione di una forma già trovata?
          let tot = 0, cov = 0;
          const pr = new Float32Array(tr.pts.length);
          let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
          for (let i = 0; i < tr.pts.length; i += 2) { const X = tl.x + (tr.pts[i] + 0.5) * f, Y = tl.y + (tr.pts[i + 1] + 0.5) * f; pr[i] = X; pr[i + 1] = Y; minx = Math.min(minx, X); maxx = Math.max(maxx, X); miny = Math.min(miny, Y); maxy = Math.max(maxy, Y); }
          for (let y = Math.max(0, miny | 0); y <= Math.min(H - 1, maxy | 0); y++) for (let x = Math.max(0, minx | 0); x <= Math.min(W - 1, maxx | 0); x++) {
            const mx = ((x - tl.x) / f) | 0, my = ((y - tl.y) / f) | 0; if (mx < 0 || my < 0 || mx > 255 || my > 255 || low[my * 256 + mx] <= 0) continue;
            tot++; if (cover[y * W + x]) cov++;
          }
          if (!tot || cov / tot > 0.6) continue;
          for (let y = Math.max(0, miny | 0); y <= Math.min(H - 1, maxy | 0); y++) for (let x = Math.max(0, minx | 0); x <= Math.min(W - 1, maxx | 0); x++) {
            const mx = ((x - tl.x) / f) | 0, my = ((y - tl.y) / f) | 0; if (mx >= 0 && my >= 0 && mx <= 255 && my <= 255 && low[my * 256 + mx] > 0) cover[y * W + x] = 1;
          }
          polys.push(pr);
        }
        nt++;
        emit({ type: 'prog', stage: 'seg', frac: nt / tiles.length, msg: 'Riconosco le forme · ' + polys.length + ' trovate', eta: (now() - t0) / nt * (tiles.length - nt) });
        await pause();
      }
      return { polys, decodes };
    }

    async function run(m) {
      if (busy) { emit({ type: 'error', id: m.id, msg: 'Elaborazione già in corso' }); return; }
      busy = true; cancelled = false;
      const T = { start: now() };
      try {
        const nm = await neuralMap(m.base, m.rgba, m.W, m.H);
        T.neural = now() - T.start;
        emit({ type: 'neural', id: m.id, data: nm.slice(0) }, true);
        let polys = [], decodes = 0;
        if (m.detail) {
          await release('id');
          const t1 = now(); const r = await segment(m.base, m.rgba, m.W, m.H, nm);
          polys = r.polys; decodes = r.decodes; T.seg = now() - t1;
          await release('enc'); await release('dec');
          emit({ type: 'polys', id: m.id, polys }, true);
        }
        emit({ type: 'done', id: m.id, timings: T, decodes, shapes: polys.length });
      } catch (e) {
        const c = e && e.message === '__cancel__';
        emit({ type: c ? 'cancelled' : 'error', id: m.id, msg: c ? '' : String(e && e.message || e), init: !!(e && e.init) });
      } finally {
        busy = false;
        if (cancelled) { await release('id'); await release('enc'); await release('dec'); }
      }
    }
    return {
      handle(m) {
        if (m.type === 'cancel') { cancelled = true; return; }
        if (m.type === 'run') run(m);
        if (m.type === 'free') { release('id'); release('enc'); release('dec'); }
      },
    };
  }
