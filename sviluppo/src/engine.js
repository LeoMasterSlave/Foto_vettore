  function makeEngine() {
    let IMG = null, PRE = { key: '', g: null };
    function setImage(W, H, gray) { IMG = { W, H, gray }; PRE = { key: '', g: null }; }

  /* ---------- image processing ---------- */
  function gaussBlur(src, W, H, sigma) {
    if (sigma < 0.3) return Float32Array.from(src);
    const r = Math.ceil(sigma * 3), k = new Float32Array(2 * r + 1);
    let sum = 0;
    for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += k[i + r]; }
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        let a = 0;
        for (let i = -r; i <= r; i++) { let xx = x + i; xx = xx < 0 ? 0 : xx >= W ? W - 1 : xx; a += src[row + xx] * k[i + r]; }
        tmp[row + x] = a;
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let a = 0;
        for (let i = -r; i <= r; i++) { let yy = y + i; yy = yy < 0 ? 0 : yy >= H ? H - 1 : yy; a += tmp[yy * W + x] * k[i + r]; }
        out[y * W + x] = a;
      }
    }
    return out;
  }

  function otsu(g) {
    const h = new Float64Array(256);
    for (let i = 0; i < g.length; i++) { let v = Math.round(g[i]); v = v < 0 ? 0 : v > 255 ? 255 : v; h[v]++; }
    let total = g.length, sumAll = 0;
    for (let i = 0; i < 256; i++) sumAll += i * h[i];
    let wB = 0, sumB = 0, best = 0, thr = 128;
    for (let t = 0; t < 256; t++) {
      wB += h[t]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += t * h[t];
      const mB = sumB / wB, mF = (sumAll - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = t; }
    }
    return thr;
  }

  /* Canny edges -> boolean map */
  function canny(g, W, H, sens) {
    const N = W * H, mag = new Float32Array(N), dq = new Uint8Array(N);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const gx = (g[i - W + 1] + 2 * g[i + 1] + g[i + W + 1]) - (g[i - W - 1] + 2 * g[i - 1] + g[i + W - 1]);
        const gy = (g[i + W - 1] + 2 * g[i + W] + g[i + W + 1]) - (g[i - W - 1] + 2 * g[i - W] + g[i - W + 1]);
        mag[i] = Math.hypot(gx, gy);
        let a = Math.atan2(gy, gx) * 57.29578; if (a < 0) a += 180;
        dq[i] = (a < 22.5 || a >= 157.5) ? 0 : a < 67.5 ? 1 : a < 112.5 ? 2 : 3;
      }
    }
    let mx = 0; for (let i = 0; i < N; i++) if (mag[i] > mx) mx = mag[i];
    if (mx <= 0) return new Uint8Array(N);
    const bins = new Uint32Array(1001);
    for (let i = 0; i < N; i++) bins[Math.min(1000, (mag[i] / mx * 1000) | 0)]++;
    let acc = 0, p = 0; const target = N * 0.985;
    for (let b = 0; b <= 1000; b++) { acc += bins[b]; if (acc >= target) { p = (b + 1) / 1000 * mx; break; } }
    const s = sens / 100;
    const hi = Math.max(4, p * (1.0 - 0.85 * s)), lo = hi * 0.4;
    const e = new Uint8Array(N);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x, m = mag[i];
        if (m < lo) continue;
        let a, b;
        switch (dq[i]) {
          case 0: a = mag[i - 1]; b = mag[i + 1]; break;
          case 1: a = mag[i - W - 1]; b = mag[i + W + 1]; break;
          case 2: a = mag[i - W]; b = mag[i + W]; break;
          default: a = mag[i - W + 1]; b = mag[i + W - 1];
        }
        if (m >= a && m >= b) e[i] = m >= hi ? 2 : 1;
      }
    }
    const out = new Uint8Array(N), stack = [];
    for (let i = 0; i < N; i++) if (e[i] === 2) { out[i] = 1; stack.push(i); }
    const nb = [-1, 1, -W, W, -W - 1, -W + 1, W - 1, W + 1];
    while (stack.length) {
      const c = stack.pop();
      for (let k = 0; k < 8; k++) { const j = c + nb[k]; if (e[j] && !out[j]) { out[j] = 1; stack.push(j); } }
    }
    out.mag = mag; out.hi = hi;
    return out;
  }

  /* Edge pixels -> polylines */
  function traceChains(E, W, H, minLen) {
    const N = W * H, vis = new Uint8Array(N), chains = [];
    const nb = [-1, 1, -W, W, -W - 1, -W + 1, W - 1, W + 1];
    const walk = (start) => {
      const out = []; let cur = start;
      for (;;) {
        let nx = -1;
        for (let k = 0; k < 8; k++) { const j = cur + nb[k]; if (E[j] && !vis[j]) { nx = j; break; } }
        if (nx < 0) break;
        vis[nx] = 1; out.push(nx); cur = nx;
      }
      return out;
    };
    const run = (start) => {
      vis[start] = 1;
      const f = walk(start), b = walk(start);
      const idx = b.reverse().concat([start], f);
      if (idx.length < Math.max(2, minLen)) return;
      const pts = idx.map((i) => [i % W, (i / W) | 0]);
      const a = pts[0], z = pts[pts.length - 1];
      const closed = pts.length > 8 && Math.abs(a[0] - z[0]) <= 1 && Math.abs(a[1] - z[1]) <= 1;
      chains.push({ pts, closed });
    };
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!E[i] || vis[i]) continue;
      let d = 0; for (let k = 0; k < 8; k++) if (E[i + nb[k]]) d++;
      if (d === 1) run(i);
    }
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (E[i] && !vis[i]) run(i);
    }
    return chains;
  }

  /* Marching squares on a padded field; inside where value < 0 */
  function marching(g, W, H, T, invert) {
    const Wp = W + 2, Hp = H + 2, F = new Float32Array(Wp * Hp).fill(1);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = invert ? T - g[y * W + x] : g[y * W + x] - T;
      F[(y + 1) * Wp + x + 1] = v === 0 ? 1e-4 : v;
    }
    const K = 2 * Wp * Hp, A = new Int32Array(K).fill(-1), B = new Int32Array(K).fill(-1);
    const link = (p, q) => {
      if (A[p] < 0) A[p] = q; else B[p] = q;
      if (A[q] < 0) A[q] = p; else B[q] = p;
    };
    const Hk = (x, y) => 2 * (y * Wp + x), Vk = (x, y) => 2 * (y * Wp + x) + 1;
    for (let y = 0; y < Hp - 1; y++) {
      for (let x = 0; x < Wp - 1; x++) {
        const a = F[y * Wp + x] < 0, b = F[y * Wp + x + 1] < 0, c = F[(y + 1) * Wp + x + 1] < 0, d = F[(y + 1) * Wp + x] < 0;
        const idx = (a ? 8 : 0) | (b ? 4 : 0) | (c ? 2 : 0) | (d ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const T_ = Hk(x, y), R = Vk(x + 1, y), Bo = Hk(x, y + 1), L = Vk(x, y);
        switch (idx) {
          case 1: case 14: link(L, Bo); break;
          case 2: case 13: link(Bo, R); break;
          case 3: case 12: link(L, R); break;
          case 4: case 11: link(T_, R); break;
          case 5: link(T_, R); link(L, Bo); break;
          case 6: case 9: link(T_, Bo); break;
          case 7: case 8: link(L, T_); break;
          case 10: link(L, T_); link(Bo, R); break;
        }
      }
    }
    const pointOf = (k) => {
      const horiz = (k & 1) === 0, cell = k >> 1, y = (cell / Wp) | 0, x = cell - y * Wp;
      if (horiz) {
        const v1 = F[y * Wp + x], v2 = F[y * Wp + x + 1];
        return [x + v1 / (v1 - v2) - 1, y - 1];
      }
      const v1 = F[y * Wp + x], v2 = F[(y + 1) * Wp + x];
      return [x - 1, y + v1 / (v1 - v2) - 1];
    };
    const seen = new Uint8Array(K), loops = [];
    for (let s = 0; s < K; s++) {
      if (seen[s] || A[s] < 0) continue;
      const keys = []; let prev = -1, cur = s, ok = true;
      for (;;) {
        seen[cur] = 1; keys.push(cur);
        let nx = A[cur] !== prev ? A[cur] : B[cur];
        if (nx < 0) { ok = false; break; }
        if (A[cur] === B[cur]) nx = A[cur];
        prev = cur; cur = nx;
        if (cur === s) break;
        if (seen[cur]) { ok = false; break; }
      }
      if (ok && keys.length >= 3) loops.push(keys.map(pointOf));
    }
    return loops;
  }

  /* Douglas-Peucker */
  function dp(p, eps) {
    const n = p.length;
    if (n < 3) return p.slice();
    const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
    const st = [[0, n - 1]];
    while (st.length) {
      const [s, e] = st.pop();
      const ax = p[s][0], ay = p[s][1], dx = p[e][0] - ax, dy = p[e][1] - ay, L = Math.hypot(dx, dy);
      let md = 0, mi = -1;
      for (let i = s + 1; i < e; i++) {
        const d = L < 1e-9 ? Math.hypot(p[i][0] - ax, p[i][1] - ay) : Math.abs(dy * (p[i][0] - ax) - dx * (p[i][1] - ay)) / L;
        if (d > md) { md = d; mi = i; }
      }
      if (md > eps && mi > 0) { keep[mi] = 1; st.push([s, mi], [mi, e]); }
    }
    return p.filter((_, i) => keep[i]);
  }
  function simplify(pts, eps, closed) {
    if (eps <= 0 || pts.length < 4) return pts;
    if (!closed) return dp(pts, eps);
    let m = 0, md = -1;
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > md) { md = d; m = i; } }
    const a = dp(pts.slice(0, m + 1), eps);
    const b = dp(pts.slice(m).concat([pts[0]]), eps);
    return a.concat(b.slice(1, -1));
  }



    /* ----- nuove funzioni ----- */
    function dpIdx(p, eps) {
      const n = p.length, keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
      const st = [[0, n - 1]];
      while (st.length) {
        const [s, e] = st.pop();
        const ax = p[s][0], ay = p[s][1], dx = p[e][0] - ax, dy = p[e][1] - ay, L = Math.hypot(dx, dy);
        let md = 0, mi = -1;
        for (let i = s + 1; i < e; i++) {
          const d = L < 1e-9 ? Math.hypot(p[i][0] - ax, p[i][1] - ay) : Math.abs(dy * (p[i][0] - ax) - dx * (p[i][1] - ay)) / L;
          if (d > md) { md = d; mi = i; }
        }
        if (md > eps && mi > 0) { keep[mi] = 1; st.push([s, mi], [mi, e]); }
      }
      const out = []; for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
      return out;
    }

    /* Diffusione anisotropa (Perona-Malik): spiana texture e rumore, conserva i bordi forti */
    function diffuse(g, W, H, iters) {
      if (iters <= 0) return g;
      let a = Float32Array.from(g), b = new Float32Array(g.length);
      let s = 0, c = 0;
      for (let y = 1; y < H - 1; y += 2) for (let x = 1; x < W - 1; x += 2) { const i = y * W + x; s += Math.abs(a[i + 1] - a[i]) + Math.abs(a[i + W] - a[i]); c += 2; }
      const K = Math.max(3, 2.5 * s / Math.max(1, c)), inv = 1 / (K * K), lam = 0.2;
      for (let it = 0; it < iters; it++) {
        b.set(a);
        for (let y = 1; y < H - 1; y++) {
          for (let x = 1; x < W - 1; x++) {
            const i = y * W + x, v = a[i];
            const dN = a[i - W] - v, dS = a[i + W] - v, dE = a[i + 1] - v, dW = a[i - 1] - v;
            b[i] = v + lam * (dN / (1 + dN * dN * inv) + dS / (1 + dS * dS * inv) + dE / (1 + dE * dE * inv) + dW / (1 + dW * dW * inv));
          }
        }
        const t = a; a = b; b = t;
      }
      return a;
    }

    /* Elimina i gruppi di pixel-bordo troppo piccoli (puntini di texture) */
    function dropSmall(E, W, H, minSize) {
      const N = W * H, seen = new Uint8Array(N), nb = [-1, 1, -W, W, -W - 1, -W + 1, W - 1, W + 1];
      for (let s = 0; s < N; s++) {
        if (!E[s] || seen[s]) continue;
        const comp = [s]; seen[s] = 1;
        for (let h = 0; h < comp.length; h++) {
          const c = comp[h];
          for (let k = 0; k < 8; k++) { const j = c + nb[k]; if (j >= 0 && j < N && E[j] && !seen[j]) { seen[j] = 1; comp.push(j); } }
        }
        if (comp.length < minSize) for (const c of comp) E[c] = 0;
      }
    }
    function chainStrength(pts, mag, W) {
      let s = 0;
      for (const p of pts) s += mag[Math.round(p[1]) * W + Math.round(p[0])];
      return s / pts.length;
    }

    /* Ricuce le lacune tra estremi di tratti che proseguono nella stessa direzione */
    function bridge(chains, gap) {
      for (let pass = 0; pass < 3; pass++) {
        const eps = [];
        chains.forEach((c, ci) => {
          if (!c || c.closed || c.pts.length < 6) return;
          const p = c.pts, n = p.length, k = Math.min(8, n - 1);
          const d0x = p[0][0] - p[k][0], d0y = p[0][1] - p[k][1], d1x = p[n - 1][0] - p[n - 1 - k][0], d1y = p[n - 1][1] - p[n - 1 - k][1];
          const l0 = Math.hypot(d0x, d0y) || 1, l1 = Math.hypot(d1x, d1y) || 1;
          eps.push({ ci, end: 0, x: p[0][0], y: p[0][1], dx: d0x / l0, dy: d0y / l0 });
          eps.push({ ci, end: 1, x: p[n - 1][0], y: p[n - 1][1], dx: d1x / l1, dy: d1y / l1 });
        });
        const cell = Math.max(2, gap), grid = new Map();
        eps.forEach((e, i) => {
          const key = Math.floor(e.x / cell) * 100003 + Math.floor(e.y / cell);
          (grid.get(key) || grid.set(key, []).get(key)).push(i);
        });
        const cands = [];
        eps.forEach((a, i) => {
          const cx = Math.floor(a.x / cell), cy = Math.floor(a.y / cell);
          for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
            const arr = grid.get((cx + ox) * 100003 + (cy + oy)); if (!arr) continue;
            for (const j of arr) {
              if (j <= i) continue;
              const b = eps[j];
              if (a.ci === b.ci && chains[a.ci].pts.length < 30) continue;
              const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
              if (d > gap) continue;
              if (d > 1.5) {
                const vx = dx / d, vy = dy / d;
                if (a.dx * vx + a.dy * vy < 0.77 || -(b.dx * vx + b.dy * vy) < 0.77) continue;
              }
              if (a.dx * b.dx + a.dy * b.dy > -0.5) continue;
              cands.push({ a, b, d });
            }
          }
        });
        if (!cands.length) break;
        cands.sort((u, v) => u.d - v.d);
        const used = new Set(); let joined = 0;
        for (const { a, b } of cands) {
          if (used.has(a.ci) || used.has(b.ci)) continue;
          if (a.ci === b.ci) { chains[a.ci].closed = true; used.add(a.ci); joined++; continue; }
          const A = chains[a.ci], B = chains[b.ci];
          const pa = a.end === 1 ? A.pts : A.pts.slice().reverse();
          const pb = b.end === 0 ? B.pts : B.pts.slice().reverse();
          const na = A.pts.length, nb = B.pts.length;
          chains[a.ci] = { pts: pa.concat(pb), closed: false, str: (A.str * na + B.str * nb) / (na + nb) };
          chains[b.ci] = null; used.add(a.ci); used.add(b.ci); joined++;
        }
        if (!joined) break;
      }
      return chains.filter(Boolean);
    }

    /* Media mobile: toglie la scalettatura dei pixel senza spostare gli estremi */
    function smoothPts(p, closed, w) {
      const n = p.length; if (n < 5 || w < 1) return p;
      const o = new Array(n);
      for (let i = 0; i < n; i++) {
        let sx = 0, sy = 0, c = 0;
        for (let k = -w; k <= w; k++) {
          let j = i + k;
          if (closed) j = ((j % n) + n) % n; else if (j < 0 || j >= n) continue;
          sx += p[j][0]; sy += p[j][1]; c++;
        }
        o[i] = [sx / c, sy / c];
      }
      if (!closed) { o[0] = p[0]; o[n - 1] = p[n - 1]; }
      return o;
    }

    /* Cerchio ai minimi quadrati (Kasa) sui punti i..j; restituisce null se non è un arco credibile */
    function arcFit(q, i, j, tol, strict) {
      const N = j - i + 1; if (N < 7) return null;
      let mx = 0, my = 0;
      for (let k = i; k <= j; k++) { mx += q[k][0]; my += q[k][1]; }
      mx /= N; my /= N;
      let Suu = 0, Svv = 0, Suv = 0, Suuu = 0, Svvv = 0, Suvv = 0, Svuu = 0;
      for (let k = i; k <= j; k++) {
        const u = q[k][0] - mx, v = q[k][1] - my;
        Suu += u * u; Svv += v * v; Suv += u * v; Suuu += u * u * u; Svvv += v * v * v; Suvv += u * v * v; Svuu += v * u * u;
      }
      const det = Suu * Svv - Suv * Suv;
      if (Math.abs(det) < 1e-9) return null;
      const b1 = 0.5 * (Suuu + Suvv), b2 = 0.5 * (Svvv + Svuu);
      const uc = (b1 * Svv - b2 * Suv) / det, vc = (Suu * b2 - Suv * b1) / det;
      const cx = mx + uc, cy = my + vc, r = Math.sqrt(uc * uc + vc * vc + (Suu + Svv) / N);
      if (!(r > 3 * tol) || r > 4000) return null;
      let prev = Math.atan2(q[i][1] - cy, q[i][0] - cx); const a0 = prev;
      let sum = 0, abs = 0;
      for (let k = i; k <= j; k++) {
        const e = Math.abs(Math.hypot(q[k][0] - cx, q[k][1] - cy) - r);
        if (e > tol) return null;
        if (k > i) {
          const a = Math.atan2(q[k][1] - cy, q[k][0] - cx);
          let d = a - prev;
          if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
          sum += d; abs += Math.abs(d); prev = a;
        }
      }
      const sw = Math.abs(sum);
      if (sw > 3.4 || abs > sw * 1.2 + 0.05) return null;
      if (strict) {
        const chord = Math.hypot(q[j][0] - q[i][0], q[j][1] - q[i][1]);
        const sag = r - Math.sqrt(Math.max(0, r * r - chord * chord / 4));
        if (sw < 0.35 || (sw < Math.PI && sag < 1.5 * tol)) return null;
      }
      return { cx, cy, r, a0, sum };
    }

    /* Spezza una catena di punti in linee rette e archi di cerchio */
    function fitChain(pts, closed, tol, useArcs) {
      let q = pts;
      if (closed && q.length > 6) {
        const qq = q.concat([q[0]]);
        const idx = dpIdx(qq, Math.max(2 * tol, 2));
        let best = 0.35, bi = 0;
        for (let t = 1; t < idx.length - 1; t++) {
          const p0 = qq[idx[t - 1]], p1 = qq[idx[t]], p2 = qq[idx[t + 1]];
          const a1 = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]), a2 = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
          let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d;
          if (d > best) { best = d; bi = idx[t]; }
        }
        q = q.slice(bi).concat(q.slice(0, bi)); q.push([q[0][0], q[0][1]]);
      } else if (closed) {
        q = q.concat([q[0]]);
      }
      const n = q.length, segs = [];
      if (n < 2) return segs;
      const lineOK = (i, j) => {
        const ax = q[i][0], ay = q[i][1], dx = q[j][0] - ax, dy = q[j][1] - ay, L = Math.hypot(dx, dy);
        for (let k = i + 1; k < j; k++) {
          const d = L < 1e-9 ? Math.hypot(q[k][0] - ax, q[k][1] - ay) : Math.abs(dy * (q[k][0] - ax) - dx * (q[k][1] - ay)) / L;
          if (d > tol) return false;
        }
        return true;
      };
      const arcOK = (i, j) => !!arcFit(q, i, j, tol, false);
      const longest = (i, lo, ok) => {
        let step = 2, hi = -1;
        for (;;) {
          const t = Math.min(n - 1, lo + step);
          if (t === lo) break;
          if (ok(i, t)) { lo = t; step *= 2; } else { hi = t; break; }
        }
        if (hi < 0) return lo;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ok(i, m)) lo = m; else hi = m; }
        return lo;
      };
      const refine = (i, j) => {
        const N = j - i + 1;
        if (N < 4) return { x0: q[i][0], y0: q[i][1], x1: q[j][0], y1: q[j][1] };
        let cx = 0, cy = 0;
        for (let k = i; k <= j; k++) { cx += q[k][0]; cy += q[k][1]; }
        cx /= N; cy /= N;
        let sxx = 0, syy = 0, sxy = 0;
        for (let k = i; k <= j; k++) { const u = q[k][0] - cx, v = q[k][1] - cy; sxx += u * u; syy += v * v; sxy += u * v; }
        const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(ang), uy = Math.sin(ang);
        const t0 = (q[i][0] - cx) * ux + (q[i][1] - cy) * uy, t1 = (q[j][0] - cx) * ux + (q[j][1] - cy) * uy;
        return { x0: cx + ux * t0, y0: cy + uy * t0, x1: cx + ux * t1, y1: cy + uy * t1 };
      };
      let i = 0;
      while (i < n - 1) {
        const jl = longest(i, i + 1, lineOK);
        let ja = i;
        if (useArcs && n - 1 - i >= 6) {
          const s0 = Math.min(n - 1, i + 6);
          if (arcOK(i, s0)) ja = longest(i, s0, arcOK);
        }
        const f = ja > jl + Math.max(2, 0.2 * (jl - i)) ? arcFit(q, i, ja, tol, true) : null;
        if (f) {
          const a1 = f.a0 + f.sum, am = f.a0 + f.sum / 2;
          segs.push({
            arc: true,
            x0: f.cx + f.r * Math.cos(f.a0), y0: f.cy + f.r * Math.sin(f.a0),
            x1: f.cx + f.r * Math.cos(a1), y1: f.cy + f.r * Math.sin(a1),
            mx: f.cx + f.r * Math.cos(am), my: f.cy + f.r * Math.sin(am),
          });
          i = ja;
        } else {
          const l = refine(i, jl); l.arc = false; segs.push(l);
          i = jl;
        }
      }
      return segs;
    }

    /* Unisce i segmenti allineati e sovrapposti (anche da catene diverse) e i doppioni paralleli */
    function mergeLines(L, tol, gap) {
      const cosT = Math.cos(3 * Math.PI / 180);
      for (const s of L) { s.len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0); s.ux = s.len > 1e-9 ? (s.x1 - s.x0) / s.len : 1; s.uy = s.len > 1e-9 ? (s.y1 - s.y0) / s.len : 0; s.alive = true; }
      const order = L.map((_, i) => i).sort((a, b) => L[b].len - L[a].len);
      const out = [];
      for (const si of order) {
        const s = L[si]; if (!s.alive) continue;
        s.alive = false;
        const ox = (s.x0 + s.x1) / 2, oy = (s.y0 + s.y1) / 2, ux = s.ux, uy = s.uy, nx = -uy, ny = ux;
        let lo = -s.len / 2, hi = s.len / 2;
        const cl = [s];
        let changed = true, pass = 0;
        while (changed && pass++ < 4) {
          changed = false;
          for (const t of L) {
            if (!t.alive) continue;
            if (Math.abs(t.ux * ux + t.uy * uy) < cosT) continue;
            const d0 = nx * (t.x0 - ox) + ny * (t.y0 - oy), d1 = nx * (t.x1 - ox) + ny * (t.y1 - oy);
            if (Math.abs(d0) > tol || Math.abs(d1) > tol) continue;
            const a0 = ux * (t.x0 - ox) + uy * (t.y0 - oy), a1 = ux * (t.x1 - ox) + uy * (t.y1 - oy);
            const tl = Math.min(a0, a1), th = Math.max(a0, a1);
            if (tl - hi > gap || lo - th > gap) continue;
            t.alive = false; cl.push(t);
            if (tl < lo) lo = tl; if (th > hi) hi = th;
            changed = true;
          }
        }
        if (cl.length === 1) { out.push({ x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 }); continue; }
        let sw = 0, mx = 0, my = 0;
        for (const t of cl) { mx += t.len * (t.x0 + t.x1) / 2; my += t.len * (t.y0 + t.y1) / 2; sw += t.len; }
        mx /= sw; my /= sw;
        let sxx = 0, syy = 0, sxy = 0;
        for (const t of cl) for (const e of [[t.x0, t.y0], [t.x1, t.y1]]) { const dx = e[0] - mx, dy = e[1] - my; sxx += t.len * dx * dx; syy += t.len * dy * dy; sxy += t.len * dx * dy; }
        const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
        let dx = Math.cos(ang), dy = Math.sin(ang);
        if (dx * ux + dy * uy < 0) { dx = -dx; dy = -dy; }
        let mn = Infinity, mxp = -Infinity;
        for (const t of cl) for (const e of [[t.x0, t.y0], [t.x1, t.y1]]) { const a = (e[0] - mx) * dx + (e[1] - my) * dy; if (a < mn) mn = a; if (a > mxp) mxp = a; }
        out.push({ x0: mx + dx * mn, y0: my + dy * mn, x1: mx + dx * mxp, y1: my + dy * mxp });
      }
      return out;
    }

    /* Porta a esattamente orizzontali/verticali le linee che lo sono quasi */
    function straighten(L, deg) {
      for (const s of L) {
        const dx = s.x1 - s.x0, dy = s.y1 - s.y0;
        if (Math.hypot(dx, dy) < 1e-6) continue;
        const a = ((Math.atan2(dy, dx) * 180 / Math.PI) % 180 + 180) % 180;
        if (a < deg || a > 180 - deg) { const y = (s.y0 + s.y1) / 2; s.y0 = s.y1 = y; }
        else if (Math.abs(a - 90) < deg) { const x = (s.x0 + s.x1) / 2; s.x0 = s.x1 = x; }
      }
    }

    function intersect(a, b) {
      const dxa = a.x1 - a.x0, dya = a.y1 - a.y0, dxb = b.x1 - b.x0, dyb = b.y1 - b.y0;
      const la = Math.hypot(dxa, dya), lb = Math.hypot(dxb, dyb);
      if (la < 1e-9 || lb < 1e-9) return null;
      const den = dxa * dyb - dya * dxb;
      if (Math.abs(den) < 0.2 * la * lb) return null;
      const t = ((b.x0 - a.x0) * dyb - (b.y0 - a.y0) * dxb) / den;
      return [a.x0 + t * dxa, a.y0 + t * dya];
    }

    /* Salda gli estremi vicini in un unico vertice (angolo = intersezione delle due rette) */
    function weld(L, A, snap) {
      const E = [];
      L.forEach((s, i) => { E.push({ t: 0, i, x: s.x0, y: s.y0 }); E.push({ t: 0, i, x: s.x1, y: s.y1 }); });
      A.forEach((s, i) => { E.push({ t: 1, i, x: s.x0, y: s.y0 }); E.push({ t: 1, i, x: s.x1, y: s.y1 }); });
      const par = E.map((_, i) => i);
      const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
      const cell = Math.max(1, snap), grid = new Map();
      E.forEach((p, k) => {
        const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          const arr = grid.get((cx + ox) * 100003 + (cy + oy)); if (!arr) continue;
          for (const j of arr) if (Math.hypot(E[j].x - p.x, E[j].y - p.y) <= snap) par[find(k)] = find(j);
        }
        const key = cx * 100003 + cy;
        (grid.get(key) || grid.set(key, []).get(key)).push(k);
      });
      const groups = new Map();
      E.forEach((p, k) => { const r = find(k); (groups.get(r) || groups.set(r, []).get(r)).push(k); });
      const V = [], vid = new Int32Array(E.length);
      for (const ks of groups.values()) {
        let x = 0, y = 0;
        for (const k of ks) { x += E[k].x; y += E[k].y; }
        x /= ks.length; y /= ks.length;
        if (ks.length === 2) {
          const a = E[ks[0]], b = E[ks[1]];
          if (a.t === 0 && b.t === 0 && a.i !== b.i) {
            const p = intersect(L[a.i], L[b.i]);
            if (p && Math.hypot(p[0] - x, p[1] - y) <= 2 * snap) { x = p[0]; y = p[1]; }
          }
        }
        const id = V.length; V.push([x, y]);
        for (const k of ks) vid[k] = id;
      }
      const segs = [], off = 2 * L.length;
      L.forEach((s, i) => { const a = vid[2 * i], b = vid[2 * i + 1]; if (a !== b) segs.push({ a, b, m: null }); });
      A.forEach((s, i) => { const a = vid[off + 2 * i], b = vid[off + 2 * i + 1]; if (a !== b) segs.push({ a, b, m: [s.mx, s.my] }); });
      return { V, segs };
    }

    /* Estremi liberi vicini a una linea: appoggiati sulla linea (giunzioni a T) */
    function tSnap(V, segs, snap) {
      const deg = new Int32Array(V.length);
      for (const s of segs) { deg[s.a]++; deg[s.b]++; }
      const lines = segs.filter((s) => !s.m);
      for (let v = 0; v < V.length; v++) {
        if (deg[v] !== 1) continue;
        const px = V[v][0], py = V[v][1];
        let best = snap, bx = 0, by = 0, found = false;
        for (const s of lines) {
          if (s.a === v || s.b === v) continue;
          const ax = V[s.a][0], ay = V[s.a][1], cx = V[s.b][0], cy = V[s.b][1];
          if (px < Math.min(ax, cx) - snap || px > Math.max(ax, cx) + snap || py < Math.min(ay, cy) - snap || py > Math.max(ay, cy) + snap) continue;
          const dx = cx - ax, dy = cy - ay, l2 = dx * dx + dy * dy;
          if (l2 < 1e-9) continue;
          const t = ((px - ax) * dx + (py - ay) * dy) / l2;
          if (t <= 0.02 || t >= 0.98) continue;
          const qx = ax + t * dx, qy = ay + t * dy, d = Math.hypot(px - qx, py - qy);
          if (d < best) { best = d; bx = qx; by = qy; found = true; }
        }
        if (found) { V[v][0] = bx; V[v][1] = by; }
      }
    }

    function bulgeOf(P, Q, M) {
      if (!M) return 0;
      const dx = Q[0] - P[0], dy = Q[1] - P[1], c = Math.hypot(dx, dy);
      if (c < 1e-6) return 0;
      const s = (M[0] - P[0]) * (-dy / c) + (M[1] - P[1]) * (dx / c);
      const b = 2 * s / c;
      if (Math.abs(b) < 0.01) return 0;
      return Math.max(-12, Math.min(12, b));
    }

    /* Concatena i segmenti collegati in polilinee (con archi come "bulge", come in AutoCAD) */
    function buildPaths(V, segs) {
      const adj = V.map(() => []);
      segs.forEach((s, i) => { adj[s.a].push(i); adj[s.b].push(i); });
      const used = new Uint8Array(segs.length), paths = [];
      const walk = (start, first) => {
        const vs = [start], bs = []; let cur = start, si = first, closed = false;
        for (;;) {
          used[si] = 1;
          const s = segs[si], nxt = s.a === cur ? s.b : s.a;
          bs.push(bulgeOf(V[cur], V[nxt], s.m));
          cur = nxt;
          if (cur === start) { closed = true; break; }
          vs.push(cur);
          if (adj[cur].length !== 2) break;
          const o = adj[cur][0] === si ? adj[cur][1] : adj[cur][0];
          if (used[o]) break;
          si = o;
        }
        paths.push({ vs, bs, closed });
      };
      for (let v = 0; v < V.length; v++) {
        if (adj[v].length === 2) continue;
        for (const si of adj[v]) if (!used[si]) walk(v, si);
      }
      for (let i = 0; i < segs.length; i++) if (!used[i]) walk(segs[i].a, i);
      return paths;
    }

    function pathLength(v, b, closed) {
      const n = v.length / 2, m = closed ? n : n - 1; let L = 0;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % n, c = Math.hypot(v[2 * j] - v[2 * i], v[2 * j + 1] - v[2 * i + 1]);
        if (!b[i]) L += c; else { const th = 4 * Math.atan(Math.abs(b[i])); L += c / (2 * Math.sin(th / 2)) * th; }
      }
      return L;
    }

        /* ====== Architettura: analisi a più scale con gerarchia dei livelli ====== */
    function gradients(g, W, H) {
      const N = W * H, mag = new Float32Array(N), dq = new Uint8Array(N);
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          const gx = (g[i - W + 1] + 2 * g[i + 1] + g[i + W + 1]) - (g[i - W - 1] + 2 * g[i - 1] + g[i + W - 1]);
          const gy = (g[i + W - 1] + 2 * g[i + W] + g[i + W + 1]) - (g[i - W - 1] + 2 * g[i - W] + g[i - W + 1]);
          mag[i] = Math.sqrt(gx * gx + gy * gy);
          const ax = gx < 0 ? -gx : gx, ay = gy < 0 ? -gy : gy;
          dq[i] = ay <= 0.41421356 * ax ? 0 : ay >= 2.41421356 * ax ? 2 : (gx * gy > 0 ? 1 : 3);
        }
      }
      return { mag, dq };
    }
    function nmsMap(mag, dq, W, H) {
      const out = new Float32Array(W * H);
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x, m = mag[i];
          if (m <= 0) continue;
          let a, b;
          switch (dq[i]) {
            case 0: a = mag[i - 1]; b = mag[i + 1]; break;
            case 1: a = mag[i - W - 1]; b = mag[i + W + 1]; break;
            case 2: a = mag[i - W]; b = mag[i + W]; break;
            default: a = mag[i - W + 1]; b = mag[i + W - 1];
          }
          if (m >= a && m >= b) out[i] = m;
        }
      }
      return out;
    }
    function hystMap(nm, W, H, hi, lo) {
      const N = W * H, out = new Uint8Array(N), stack = [], nb = [-1, 1, -W, W, -W - 1, -W + 1, W - 1, W + 1];
      for (let i = 0; i < N; i++) if (nm[i] >= hi) { out[i] = 1; stack.push(i); }
      while (stack.length) {
        const c = stack.pop();
        for (let k = 0; k < 8; k++) { const j = c + nb[k]; if (j >= 0 && j < N && !out[j] && nm[j] >= lo) { out[j] = 1; stack.push(j); } }
      }
      return out;
    }
    function dilate(E, W, H, r) {
      const N = W * H, tmp = new Uint8Array(N), out = new Uint8Array(N);
      for (let y = 0; y < H; y++) {
        const row = y * W; let cnt = 0;
        for (let x = 0; x <= r && x < W; x++) cnt += E[row + x];
        for (let x = 0; x < W; x++) {
          tmp[row + x] = cnt > 0 ? 1 : 0;
          const a = x + r + 1, b = x - r;
          if (a < W) cnt += E[row + a];
          if (b >= 0) cnt -= E[row + b];
        }
      }
      for (let x = 0; x < W; x++) {
        let cnt = 0;
        for (let y = 0; y <= r && y < H; y++) cnt += tmp[y * W + x];
        for (let y = 0; y < H; y++) {
          out[y * W + x] = cnt > 0 ? 1 : 0;
          const a = y + r + 1, b = y - r;
          if (a < H) cnt += tmp[a * W + x];
          if (b >= 0) cnt -= tmp[b * W + x];
        }
      }
      return out;
    }
    function boxBlurGrid(a, w, h, r, passes) {
      let src = Float32Array.from(a), dst = new Float32Array(a.length);
      for (let p = 0; p < passes; p++) {
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          let s = 0, c = 0;
          for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += src[y * w + xx]; c++; } }
          dst[y * w + x] = s / c;
        }
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          let s = 0, c = 0;
          for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += dst[yy * w + x]; c++; } }
          src[y * w + x] = s / c;
        }
      }
      return src;
    }
    /* Individua l'edificio: dove ci sono tanti bordi orizzontali/verticali (cielo, ghiaia e fogliame non ne hanno) */
    function subjectMask(mag, dq, W, H) {
      const N = W * H;
      let mx = 0; for (let i = 0; i < N; i++) if (mag[i] > mx) mx = mag[i];
      if (mx <= 0) return null;
      const bins = new Uint32Array(1001);
      for (let i = 0; i < N; i++) bins[Math.min(1000, (mag[i] / mx * 1000) | 0)]++;
      let acc = 0, T0 = 0;
      for (let b = 0; b <= 1000; b++) { acc += bins[b]; if (acc >= N * 0.92) { T0 = (b + 1) / 1000 * mx; break; } }
      const cs = 8, gw = Math.ceil(W / cs), gh = Math.ceil(H / cs);
      let D = new Float32Array(gw * gh);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x; if (mag[i] < T0) continue;
        D[(y >> 3) * gw + (x >> 3)] += (dq[i] === 0 || dq[i] === 2) ? 1 : -1;
      }
      D = boxBlurGrid(D, gw, gh, 2, 3);
      let dm = 0; for (let i = 0; i < D.length; i++) if (D[i] > dm) dm = D[i];
      if (dm <= 0) return null;
      const on = new Uint8Array(gw * gh);
      for (let i = 0; i < on.length; i++) on[i] = D[i] > 0.22 * dm ? 1 : 0;
      // componente più grande
      const lab = new Int32Array(gw * gh).fill(-1); let best = -1, bestN = 0, nl = 0;
      for (let s = 0; s < on.length; s++) {
        if (!on[s] || lab[s] >= 0) continue;
        const st = [s]; lab[s] = nl; let cnt = 0;
        while (st.length) {
          const c = st.pop(); cnt++;
          const cx = c % gw, cy = (c / gw) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
            const j = ny * gw + nx; if (on[j] && lab[j] < 0) { lab[j] = nl; st.push(j); }
          }
        }
        if (cnt > bestN) { bestN = cnt; best = nl; } nl++;
      }
      if (best < 0 || bestN < 12) return null;
      const m = new Uint8Array(gw * gh);
      for (let i = 0; i < m.length; i++) m[i] = lab[i] === best ? 1 : 0;
      // riempie i buchi (aperture scure)
      const out = new Uint8Array(gw * gh), st = [];
      for (let x = 0; x < gw; x++) for (const y of [0, gh - 1]) { const j = y * gw + x; if (!m[j] && !out[j]) { out[j] = 2; st.push(j); } }
      for (let y = 0; y < gh; y++) for (const x of [0, gw - 1]) { const j = y * gw + x; if (!m[j] && !out[j]) { out[j] = 2; st.push(j); } }
      while (st.length) {
        const c = st.pop(), cx = c % gw, cy = (c / gw) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const j = ny * gw + nx; if (!m[j] && !out[j]) { out[j] = 2; st.push(j); }
        }
      }
      const filled = new Uint8Array(gw * gh);
      for (let i = 0; i < filled.length; i++) filled[i] = out[i] === 2 ? 0 : 1;
      // dilata di una cella
      const fin = new Uint8Array(gw * gh);
      let x0 = gw, x1 = 0;
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        let v = 0;
        for (let dy = -1; dy <= 1 && !v; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < gw && ny < gh && filled[ny * gw + nx]) { v = 1; break; }
        }
        fin[y * gw + x] = v; if (v) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
      }
      return { on: fin, gw, gh, width: Math.max(1, (x1 - x0 + 1) * cs) };
    }

    function distPtSeg(px, py, s) {
      const dx = s.x1 - s.x0, dy = s.y1 - s.y0, l2 = dx * dx + dy * dy;
      if (l2 < 1e-9) return Math.hypot(px - s.x0, py - s.y0);
      let t = ((px - s.x0) * dx + (py - s.y0) * dy) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      return Math.hypot(px - (s.x0 + t * dx), py - (s.y0 + t * dy));
    }
    /* Toglie da `low` le linee già coperte da una linea di un livello superiore */
    function dropCovered(low, high, tol) {
      if (!high.length) return low;
      return low.filter((s) => {
        const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0); if (len < 1e-6) return false;
        const ux = (s.x1 - s.x0) / len, uy = (s.y1 - s.y0) / len;
        let covered = 0; const samples = 5;
        for (let k = 0; k < samples; k++) {
          const t = (k + 0.5) / samples, px = s.x0 + (s.x1 - s.x0) * t, py = s.y0 + (s.y1 - s.y0) * t;
          for (const h of high) {
            const hl = Math.hypot(h.x1 - h.x0, h.y1 - h.y0); if (hl < 1e-6) continue;
            if (Math.abs(ux * (h.x1 - h.x0) / hl + uy * (h.y1 - h.y0) / hl) < 0.97) continue;
            if (distPtSeg(px, py, h) <= tol) { covered++; break; }
          }
        }
        return covered < samples * 0.7;
      });
    }

    /* Sposta in `into` i gruppi di pixel di E più piccoli di minSize (non li butta: scendono di livello) */
    function demoteSmall(E, into, W, H, minSize) {
      const N = W * H, seen = new Uint8Array(N), nb = [-1, 1, -W, W, -W - 1, -W + 1, W - 1, W + 1];
      for (let s0 = 0; s0 < N; s0++) {
        if (!E[s0] || seen[s0]) continue;
        const comp = [s0]; seen[s0] = 1;
        for (let h = 0; h < comp.length; h++) {
          const c = comp[h];
          for (let k = 0; k < 8; k++) { const j = c + nb[k]; if (j >= 0 && j < N && E[j] && !seen[j]) { seen[j] = 1; comp.push(j); } }
        }
        if (comp.length < minSize) for (const c of comp) { E[c] = 0; if (into) into[c] = 1; }
      }
    }
    function morph1D(A, W, H, r, horiz, erode) {
      const out = new Uint8Array(W * H), len = horiz ? W : H, lines = horiz ? H : W, stride = horiz ? 1 : W, step = horiz ? W : 1, win = 2 * r + 1;
      for (let l = 0; l < lines; l++) {
        const base = l * step; let cnt = 0;
        for (let i = 0; i <= r && i < len; i++) cnt += A[base + i * stride];
        for (let i = 0; i < len; i++) {
          out[base + i * stride] = erode ? (cnt === win ? 1 : 0) : (cnt > 0 ? 1 : 0);
          const a = i + r + 1, b = i - r;
          if (a < len) cnt += A[base + a * stride];
          if (b >= 0) cnt -= A[base + b * stride];
        }
      }
      return out;
    }
    /* Tiene i pixel che fanno parte di corse lunghe (>= 2r+1) quasi orizzontali o verticali, tollerando ondulazioni di tp pixel */
    function openAxis(E, W, H, r, tp, horiz) {
      const t = morph1D(E, W, H, tp, !horiz, false);
      const o = morph1D(morph1D(t, W, H, r, horiz, true), W, H, r, horiz, false);
      const out = new Uint8Array(W * H);
      for (let i = 0; i < out.length; i++) out[i] = E[i] && o[i] ? 1 : 0;
      return out;
    }
    /* Allunga gli estremi liberi lungo la loro direzione fino a incontrare una linea trasversale vicina */
    function extendToMeet(L, targets, maxExt) {
      const all = L.concat(targets);
      for (const s of L) {
        const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0); if (len < 1e-6) continue;
        const ux = (s.x1 - s.x0) / len, uy = (s.y1 - s.y0) / len;
        for (let e = 0; e < 2; e++) {
          const px = e ? s.x1 : s.x0, py = e ? s.y1 : s.y0, dx = e ? ux : -ux, dy = e ? uy : -uy;
          let best = maxExt + 1, bx = 0, by = 0, hit = false, covered = false;
          for (const t of all) {
            if (t === s) continue;
            const tl = Math.hypot(t.x1 - t.x0, t.y1 - t.y0); if (tl < 1e-6) continue;
            const tx = (t.x1 - t.x0) / tl, ty = (t.y1 - t.y0) / tl;
            if (Math.abs(dx * tx + dy * ty) > 0.7) continue;
            if (distPtSeg(px, py, t) < 1.5) { covered = true; break; }
            const den = dx * ty - dy * tx; if (Math.abs(den) < 1e-6) continue;
            const a = ((t.x0 - px) * ty - (t.y0 - py) * tx) / den;
            const b = ((t.x0 - px) * dy - (t.y0 - py) * dx) / den;
            if (a < 0 || a > maxExt || b < -2 || b > tl + 2) continue;
            if (a < best) { best = a; bx = px + dx * a; by = py + dy * a; hit = true; }
          }
          if (!covered && hit) { if (e) { s.x1 = bx; s.y1 = by; } else { s.x0 = bx; s.y0 = by; } }
        }
      }
    }
    const isAxis = (s) => Math.abs(s.x1 - s.x0) < 1e-6 || Math.abs(s.y1 - s.y0) < 1e-6;

    function pctSorted(sorted, p) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))] : 0; }

    function runArch(P) {
      const W = IMG.W, H = IMG.H, gray = IMG.gray, sc = Math.max(0.6, W / 1400);
      const t0 = Date.now(), lap = (n) => { if (P.debug) console.log('  ', n, Date.now() - t0, 'ms'); };
      const sigF = P.autoAll ? 1.0 * sc : Math.max(0.6, P.blur * 0.6) * sc;
      const key = 'A|' + W + 'x' + H + '|' + sigF.toFixed(2);
      if (PRE.key !== key) {
        const gF = gaussBlur(diffuse(gray, W, H, 2), W, H, sigF);
        const gM = gaussBlur(diffuse(gray, W, H, 5), W, H, 2.2 * sc);
        const gC = gaussBlur(diffuse(gray, W, H, 10), W, H, 4.5 * sc);
        lap('blur+diffuse');
        const F = gradients(gF, W, H), M = gradients(gM, W, H), C = gradients(gC, W, H);
        const mask = subjectMask(F.mag, F.dq, W, H);
        const full = new Uint8Array(W * H);
        if (mask) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) full[y * W + x] = mask.on[(y >> 3) * mask.gw + (x >> 3)]; }
        else full.fill(1);
        lap('gradients+mask');
        const nm = [nmsMap(F.mag, F.dq, W, H), nmsMap(M.mag, M.dq, W, H), nmsMap(C.mag, C.dq, W, H)];
        const sorted = nm.map((a) => { const v = []; for (let i = 0; i < a.length; i++) if (a[i] > 0 && full[i]) v.push(a[i]); return Float32Array.from(v).sort(); });
        PRE = { key, magF: F.mag, nm, sorted, full, Sw: mask ? mask.width : W, masked: !!mask };
      }
      lap('precompute');
      const { magF, nm, sorted, full, Sw } = PRE;
      /* colonne occupate dal soggetto: serve a scartare strisce di terreno fuori dalla facciata */
      let cx0 = 0, cx1 = W - 1;
      if (PRE.masked) {
        const cc = new Int32Array(W); let mx = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (full[y * W + x]) cc[x]++;
        for (let x = 0; x < W; x++) if (cc[x] > mx) mx = cc[x];
        while (cx0 < W - 1 && cc[cx0] < 0.25 * mx) cx0++;
        while (cx1 > 0 && cc[cx1] < 0.25 * mx) cx1--;
        const mg = Math.round(0.015 * W); cx0 = Math.max(0, cx0 - mg); cx1 = Math.min(W - 1, cx1 + mg);
      }
      const s = P.autoAll ? 50 : P.sens, shift = (50 - s) / 100 * 0.5;
      const pc = (base) => Math.min(0.98, Math.max(0.02, base + shift));
      const th = [[0.62, 0.35], [0.80, 0.55], [0.84, 0.5]].map(([h, l], k) => [pctSorted(sorted[k], pc(h)), pctSorted(sorted[k], pc(l))]);
      const hy = nm.map((a, k) => { const e = hystMap(a, W, H, th[k][0], th[k][1]); for (let i = 0; i < e.length; i++) if (!full[i]) e[i] = 0; return e; });
      const dC = dilate(hy[2], W, H, Math.round(5 * sc)), dM = dilate(hy[1], W, H, Math.round(3 * sc));
      lap('hysteresis');
      const maps = [new Uint8Array(W * H), new Uint8Array(W * H), new Uint8Array(W * H)];
      for (let i = 0; i < W * H; i++) if (hy[0][i]) maps[dC[i] ? 0 : dM[i] ? 1 : 2][i] = 1;

      const mm = P.autoAll ? 1 : Math.max(0.4, P.minlen / 30), tm = P.autoAll ? 1 : Math.max(0.4, P.simp / 1.5);
      const minLen = [Math.max(40, 0.11 * Sw) * mm, Math.max(18, 0.04 * Sw) * mm, Math.max(14, 0.028 * Sw) * mm];
      const tol = [1.4 * sc * tm, 1.2 * sc * tm, 1.4 * sc * tm];
      const mrg = P.autoAll ? [2.5 * sc, 2.0 * sc, 3.0 * sc] : [P.merge, P.merge * 0.8, P.merge * 1.1];
      const arcsOn = [P.arcs, P.arcs, false];

      // livello 0 = struttura (bordi forti anche a scala grossa); il resto si divide in conci (giunti ortogonali) ed elementi (curve)
      demoteSmall(maps[0], maps[1], W, H, minLen[0]);
      const N = W * H, rest = new Uint8Array(N);
      for (let i = 0; i < N; i++) rest[i] = (maps[1][i] | maps[2][i]) ? 1 : 0;
      const rr = Math.max(6, Math.round(minLen[2] / 2)), tp = Math.max(1, Math.round(2 * sc));
      const Hn = openAxis(rest, W, H, rr, tp, true), Vn = openAxis(rest, W, H, rr, tp, false);
      const both = new Uint8Array(N);
      for (let i = 0; i < N; i++) both[i] = (Hn[i] | Vn[i]) ? 1 : 0;
      const nearBoth = dilate(both, W, H, 1), elem = new Uint8Array(N);
      for (let i = 0; i < N; i++) elem[i] = rest[i] && !nearBoth[i] ? 1 : 0;
      dropSmall(elem, W, H, Math.max(6, Math.round(minLen[1] * 0.5)));
      const sets = [[], [], []];
      for (const c of traceChains(maps[0], W, H, 4)) { c.str = chainStrength(c.pts, magF, W); sets[0].push(c); }
      for (const c of traceChains(elem, W, H, 4)) { c.str = chainStrength(c.pts, magF, W); sets[1].push(c); }
      for (const m of [Hn, Vn]) for (const c of traceChains(m, W, H, 4)) { c.str = chainStrength(c.pts, magF, W); sets[2].push(c); }
      lap('tracing');
      const Ls = [], As = [];
      let rawPts = 0;
      for (let l = 0; l < 3; l++) {
        let chains = bridge(sets[l], Math.min(14, 3 + 2 * mrg[l]));
        chains = chains.filter((c) => c.pts.length >= minLen[l] * (c.closed ? 0.6 : 1));
        const L = [], A = [];
        for (const c of chains) {
          rawPts += c.pts.length;
          const fit = fitChain(smoothPts(c.pts, c.closed, 2), c.closed, tol[l], arcsOn[l]);
          if (l === 1) {
            let al = 0, tl = 0;
            for (const sg of fit) { const d = Math.hypot(sg.x1 - sg.x0, sg.y1 - sg.y0); tl += d; if (sg.arc) al += d; }
            if (!(tl > 0 && (al / tl >= 0.5 || (c.closed && tl >= minLen[1])))) continue;
          }
          for (const sg of fit) (sg.arc ? A : L).push(sg);
        }
        let L2 = mrg[l] > 0 ? mergeLines(L, mrg[l], 3 * mrg[l] + 2) : L;
        if (P.straight) {
          straighten(L2, l === 2 ? 5 : 3);
          if (l === 2) L2 = L2.filter(isAxis);
          else if (l === 1) L2 = L2.filter((sg) => isAxis(sg) || Math.hypot(sg.x1 - sg.x0, sg.y1 - sg.y0) >= 2.5 * minLen[1]);
        }
        Ls.push(L2); As.push(A);
      }
      // gerarchia per lunghezza: le linee lunghe e gli archi grandi diventano struttura
      const promote = Math.max(90, 0.16 * Sw) * mm, promoteArc = Math.max(60, 0.08 * Sw) * mm;
      for (const l of [1, 2]) {
        const keep = [];
        for (const sg of Ls[l]) (Math.hypot(sg.x1 - sg.x0, sg.y1 - sg.y0) >= promote ? Ls[0] : keep).push(sg);
        Ls[l] = keep;
      }
      {
        const keep = [];
        for (const sg of As[1]) (Math.hypot(sg.x1 - sg.x0, sg.y1 - sg.y0) >= promoteArc ? As[0] : keep).push(sg);
        As[1] = keep;
      }
      lap('fit+merge');
      Ls[1] = dropCovered(Ls[1], Ls[0], 3);
      Ls[2] = dropCovered(Ls[2], Ls[0].concat(Ls[1]), 3.5);
      if (P.straight) {
        const ext = Math.round(14 * sc);
        extendToMeet(Ls[0], [], ext);
        extendToMeet(Ls[1], Ls[0], ext);
        extendToMeet(Ls[2], Ls[0].concat(Ls[1]), ext);
      }

      const paths = []; let lines = 0, arcs = 0; const layers = [0, 0, 0];
      for (let l = 0; l < 3; l++) {
        const snap = 1 + 1.2 * mrg[l];
        const { V, segs: s0 } = weld(Ls[l], As[l], snap);
        tSnap(V, s0, snap);
        const seen = new Set(), segs = [];
        for (const sg of s0) {
          if (!sg.m) { const k = Math.min(sg.a, sg.b) + '_' + Math.max(sg.a, sg.b); if (seen.has(k)) continue; seen.add(k); }
          segs.push(sg);
        }
        for (const p of buildPaths(V, segs)) {
          const v = []; for (const id of p.vs) v.push(V[id][0], V[id][1]);
          if (pathLength(v, p.bs, p.closed) < Math.max(4, minLen[l] * 0.5)) continue;
          if (l > 0) { let inside = 0; for (let k = 0; k < v.length; k += 2) if (v[k] >= cx0 && v[k] <= cx1) inside++; if (inside * 2 < v.length / 2) continue; }
          for (const b of p.bs) { if (b) arcs++; else lines++; }
          paths.push({ c: p.closed ? 1 : 0, v, b: p.bs, l }); layers[l]++;
        }
      }
      lap('weld+paths');
      return { paths, info: { T: null, lines, arcs, rawPts, layers, masked: PRE.masked } };
    }

    function runOld(P) {
      const W = IMG.W, H = IMG.H, gray = IMG.gray, mode = P.mode, tol = Math.max(0.5, P.simp);
      let chains = [], T = null;
      if (mode === 'shape') {
        const g = gaussBlur(gray, W, H, P.blur);
        T = P.auto ? otsu(g) : P.thr;
        for (const l of marching(g, W, H, T, P.inv)) if (l.length >= Math.max(4, P.minlen)) chains.push({ pts: l, closed: true, str: 1 });
      } else {
        const arch = mode === 'arch';
        const iters = arch ? 8 : 2, sigma = Math.max(arch ? 1.2 : 0.6, P.blur);
        const key = mode + '|' + iters + '|' + sigma;
        if (PRE.key !== key) PRE = { key, g: gaussBlur(diffuse(gray, W, H, iters), W, H, sigma) };
        const E = canny(PRE.g, W, H, P.sens);
        if (E.mag) {
          dropSmall(E, W, H, Math.max(4, Math.round(P.minlen * (arch ? 0.8 : 0.5))));
          chains = traceChains(E, W, H, 4);
          for (const c of chains) c.str = chainStrength(c.pts, E.mag, W);
          chains = bridge(chains, Math.min(14, 3 + 2 * P.merge));
          chains = chains.filter((c) => {
            const n = c.pts.length;
            if (n < Math.max(4, P.minlen)) return false;
            if (arch && n < 4 * P.minlen && c.str < E.hi * 1.3) return false;
            return true;
          });
        }
      }
      const rawPts = chains.reduce((s, c) => s + c.pts.length, 0);
      const L = [], A = [];
      for (const c of chains) {
        const pts = smoothPts(c.pts, c.closed, mode === 'shape' ? 1 : 2);
        for (const s of fitChain(pts, c.closed, tol, P.arcs)) (s.arc ? A : L).push(s);
      }
      const L2 = P.merge > 0 ? mergeLines(L, P.merge, 3 * P.merge + 2) : L;
      if (P.straight) straighten(L2, 3);
      const snap = 1 + 1.2 * P.merge;
      const { V, segs: s0 } = weld(L2, A, snap);
      tSnap(V, s0, snap);
      const seen = new Set(), segs = [];
      for (const s of s0) {
        if (!s.m) { const k = Math.min(s.a, s.b) + '_' + Math.max(s.a, s.b); if (seen.has(k)) continue; seen.add(k); }
        segs.push(s);
      }
      const paths = [];
      let lines = 0, arcs = 0;
      for (const p of buildPaths(V, segs)) {
        const v = []; for (const id of p.vs) v.push(V[id][0], V[id][1]);
        if (pathLength(v, p.bs, p.closed) < Math.max(2, P.minlen * 0.8)) continue;
        for (const b of p.bs) { if (b) arcs++; else lines++; }
        paths.push({ c: p.closed ? 1 : 0, v, b: p.bs, l: mode === 'shape' ? 0 : 1 });
      }
      return { paths, info: { T, lines, arcs, rawPts } };
    }

    function run(P) { return P.mode === 'ai' ? runAI(P) : P.mode === 'arch' ? runArch(P) : runOld(P); }
    /* =====================================================================
       Vettorizzazione AI: disegno neurale (mappa di linee) + forme segmentate
       Ingresso P.ai = { rw, rh, neural: Float32Array (0 = linea, 1 = bianco),
                         polys: [Float32Array x,y,...] (contorni dei segmenti),
                         ox, oy, sx (regione -> coordinate immagine) }
       Uscita: percorsi nei livelli 0 STRUTTURA, 1 ELEMENTI, 2 DETTAGLI, 3 RICOSTRUZIONI
       ===================================================================== */
    function nb8(b, i, W) { return b[i - W - 1] + b[i - W] + b[i - W + 1] + b[i - 1] + b[i + 1] + b[i + W - 1] + b[i + W] + b[i + W + 1]; }

    function thinZS(b, W, H) {
      for (let x = 0; x < W; x++) { b[x] = 0; b[(H - 1) * W + x] = 0; }
      for (let y = 0; y < H; y++) { b[y * W] = 0; b[y * W + W - 1] = 0; }
      let list = []; for (let i = 0; i < W * H; i++) if (b[i]) list.push(i);
      const del = [];
      for (let iter = 0; iter < 60; iter++) {
        let changed = false;
        for (let pass = 0; pass < 2; pass++) {
          del.length = 0;
          for (const i of list) {
            if (!b[i]) continue;
            const p2 = b[i - W], p3 = b[i - W + 1], p4 = b[i + 1], p5 = b[i + W + 1], p6 = b[i + W], p7 = b[i + W - 1], p8 = b[i - 1], p9 = b[i - W - 1];
            const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
            if (B < 2 || B > 6) continue;
            const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
            if (A !== 1) continue;
            if (pass === 0 ? (p2 && p4 && p6) || (p4 && p6 && p8) : (p2 && p4 && p8) || (p2 && p6 && p8)) continue;
            del.push(i);
          }
          for (const i of del) b[i] = 0;
          if (del.length) changed = true;
        }
        list = list.filter((i) => b[i]);
        if (!changed) break;
      }
      return list;
    }

    function pruneSpurs(b, W, list, L) {
      const removed = [];
      let cur = list.slice();
      for (let it = 0; it < L; it++) {
        const ends = [];
        for (const i of cur) if (b[i] && nb8(b, i, W) <= 1) ends.push(i);
        if (!ends.length) break;
        for (const i of ends) { b[i] = 0; removed.push(i); }
        cur = cur.filter((i) => b[i]);
      }
      const orig = new Uint8Array(b.length); for (const i of removed) orig[i] = 1;
      const N = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
      for (let it = 0; it < L; it++) {
        const add = [];
        for (const i of cur) {
          if (!b[i] || nb8(b, i, W) !== 1) continue;
          for (const d of N) if (orig[i + d] && !b[i + d]) add.push(i + d);
        }
        if (!add.length) break;
        for (const j of add) { b[j] = 1; orig[j] = 0; cur.push(j); }
      }
      return cur.filter((i) => b[i]);
    }

    function dropSmallComp(b, W, list, minPx) {
      const lab = new Int32Array(b.length), N = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
      let id = 0; const out = [];
      for (const s of list) {
        if (!b[s] || lab[s]) continue;
        id++; const comp = [s]; lab[s] = id;
        for (let k = 0; k < comp.length; k++) { const i = comp[k]; for (const d of N) { const j = i + d; if (b[j] && !lab[j]) { lab[j] = id; comp.push(j); } } }
        if (comp.length < minPx) for (const i of comp) b[i] = 0; else for (const i of comp) out.push(i);
      }
      return out;
    }

    /* Catene di pixel tra nodi (estremi o incroci) del grafo dello scheletro */
    function traceSkeleton(b, W, list) {
      const N = [1, -1, W, -W, W + 1, W - 1, -W + 1, -W - 1];
      const node = new Uint8Array(b.length), vis = new Uint8Array(b.length), chains = [];
      for (const i of list) if (nb8(b, i, W) !== 2) node[i] = 1;
      const xy = (i) => [i % W, (i / W) | 0];
      for (const s of list) {
        if (!node[s]) continue;
        for (const d of N) {
          let c = s + d;
          if (!b[c] || (vis[c] && !node[c])) continue;
          if (node[c]) { if (c > s) chains.push([xy(s), xy(c)]); continue; }
          const ch = [xy(s), xy(c)]; let p = s;
          while (!node[c]) {
            vis[c] = 1; let nx = -1;
            for (const e of N) { const q = c + e; if (q !== p && b[q] && (!vis[q] || node[q]) && q !== s) { nx = q; if (node[q]) break; } }
            if (nx < 0) { const q = s; if (N.some((e) => c + e === q) && ch.length > 3) ch.push(xy(q)); break; }
            p = c; c = nx; ch.push(xy(c));
          }
          chains.push(ch);
        }
      }
      for (const s of list) {
        if (!b[s] || node[s] || vis[s]) continue;
        const ch = [xy(s)]; vis[s] = 1; let c = s;
        for (;;) {
          let nx = -1; for (const e of N) { const q = c + e; if (b[q] && !vis[q] && !node[q]) { nx = q; break; } }
          if (nx < 0) break; vis[nx] = 1; c = nx; ch.push(xy(c));
        }
        if (ch.length > 8) { ch.push(ch[0]); chains.push(ch); }
      }
      return chains;
    }

    function polyArea(p) { let a = 0; for (let i = 0, n = p.length; i < n; i++) { const q = p[(i + 1) % n]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; }
    function median(a) { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; }
    function circleFit(pts) {
      let n = pts.length, mx = 0, my = 0; for (const p of pts) { mx += p[0]; my += p[1]; } mx /= n; my /= n;
      let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
      for (const p of pts) { const u = p[0] - mx, v = p[1] - my; suu += u * u; svv += v * v; suv += u * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u; }
      const det = suu * svv - suv * suv; if (Math.abs(det) < 1e-9) return null;
      const r1 = 0.5 * (suuu + suvv), r2 = 0.5 * (svvv + svuu);
      const uc = (r1 * svv - r2 * suv) / det, vc = (r2 * suu - r1 * suv) / det;
      const cx = uc + mx, cy = vc + my, r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
      let e = 0; for (const p of pts) e += Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - r);
      return { cx, cy, r, err: e / n };
    }
    const L_ = (x0, y0, x1, y1) => ({ arc: false, x0, y0, x1, y1 });
    const A_ = (x0, y0, x1, y1, mx, my) => ({ arc: true, x0, y0, x1, y1, mx, my });
    function segDist(px, py, s) {
      if (!s.arc) return distPtSeg(px, py, s);
      const c = circleFit([[s.x0, s.y0], [s.mx, s.my], [s.x1, s.y1], [(s.x0 + s.mx) / 2, (s.y0 + s.my) / 2]]);
      return c ? Math.abs(Math.hypot(px - c.cx, py - c.cy) - c.r) : distPtSeg(px, py, s);
    }
    function shapeDev(pts, segs) {
      const ds = [], step = Math.max(1, Math.floor(pts.length / 120));
      for (let k = 0; k < pts.length; k += step) { let d = Infinity; for (const s of segs) d = Math.min(d, segDist(pts[k][0], pts[k][1], s)); ds.push(d); }
      ds.sort((a, b) => a - b); return ds[Math.floor(ds.length * 0.9)] || 0;
    }

    /* Riconosce e regolarizza una forma segmentata: cerchio, rettangolo, apertura ad arco o poligono */
    function regShape(pts, tol0) {
      const n = pts.length; if (n < 8) return null;
      // la risoluzione della maschera (passo tra i punti del contorno) allarga la tolleranza
      const gaps = []; for (let i = 0; i < n; i += Math.max(1, n >> 6)) { const q = pts[(i + 1) % n]; gaps.push(Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1])); }
      const tol = Math.max(tol0, 0.8 * median(gaps));
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
      const w = x1 - x0, h = y1 - y0, A = Math.abs(polyArea(pts)); if (w < 4 || h < 4) return null;
      const fill = A / (w * h);
      const out = (cls, segs) => ({ cls, segs, dev: shapeDev(pts, segs), w, h, A, tol });
      const lim = Math.max(3 * tol, 0.05 * Math.min(w, h));
      // cerchio
      if (fill > 0.72 && fill < 0.84 && Math.abs(w - h) < 0.15 * Math.max(w, h)) {
        const c = circleFit(pts);
        let emax = 0; if (c) for (const p of pts) emax = Math.max(emax, Math.abs(Math.hypot(p[0] - c.cx, p[1] - c.cy) - c.r));
        if (c && c.err < 0.035 * c.r + 0.4 && emax < 0.12 * c.r + 1.2) {
          const { cx, cy, r } = c;
          return out('cerchio', [A_(cx - r, cy, cx + r, cy, cx, cy - r), A_(cx + r, cy, cx - r, cy, cx, cy + r)]);
        }
      }
      const cxm = (x0 + x1) / 2, cym = (y0 + y1) / 2;
      const sideX = (left) => median(pts.filter((p) => (left ? p[0] < cxm : p[0] > cxm) && p[1] > y0 + 0.3 * h && p[1] < y1 - 0.15 * h).map((p) => p[0]));
      const sideY = (top) => median(pts.filter((p) => (top ? p[1] < cym : p[1] > cym) && p[0] > x0 + 0.25 * w && p[0] < x1 - 0.25 * w).map((p) => p[1]));
      const l = sideX(true), r = sideX(false), b = sideY(false), t = sideY(true);
      // apertura ad arco (tutto sesto o ribassato)
      const widthAt = (yy) => { let mn = Infinity, mx = -Infinity; for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; if ((p[1] <= yy && q[1] > yy) || (q[1] <= yy && p[1] > yy)) { const x = p[0] + (yy - p[1]) / (q[1] - p[1]) * (q[0] - p[0]); mn = Math.min(mn, x); mx = Math.max(mx, x); } } return mx - mn; };
      const archy = widthAt(y0 + 0.12 * w) < 0.8 * w && widthAt(y0 + 0.04 * w) < 0.6 * w;
      if (archy && fill > 0.62 && h > 0.6 * w && isFinite(l + r + b)) {
        const top = pts.filter((p) => p[1] < y0 + 0.45 * w);
        const c = top.length > 10 ? circleFit(top) : null;
        const hw = (r - l) / 2;
        if (c && c.err < 0.06 * c.r + 0.5 && c.r > 0.85 * hw && c.r < 2.5 * hw && Math.abs(c.cx - (l + r) / 2) < 0.12 * w) {
          const ys = c.cy - Math.sqrt(Math.max(0, c.r * c.r - hw * hw));
          const yt = c.cy - c.r, xm = (l + r) / 2;
          if (ys < b - 4) {
            const s = out('arco', [L_(l, b, r, b), L_(r, b, r, ys), A_(r, ys, l, ys, xm, yt), L_(l, ys, l, b)]);
            if (s.dev <= lim) return s;
          }
        }
      }
      // rettangolo
      if (fill > 0.84 && isFinite(l + r + t + b)) {
        const s = out('rettangolo', [L_(l, t, r, t), L_(r, t, r, b), L_(r, b, l, b), L_(l, b, l, t)]);
        if (s.dev <= lim) return s;
      }
      // poligono generico: linee e archi riconosciuti sul contorno
      const round = fill < 0.8;
      const segs = fitChain(smoothPts(pts, true, 2), true, 1.3 * tol, round);
      if (segs.length < 3) return null;
      straighten(segs.filter((s) => !s.arc), 8);
      return { cls: 'poligono', segs, dev: 0, w, h, A, tol };
    }

    /* Percorso chiuso da una sequenza ordinata di segmenti (ogni segmento parte dove finisce il precedente) */
    function loopPath(segs) {
      const v = [], b = [];
      for (const s of segs) { v.push(s.x0, s.y0); b.push(s.arc ? bulgeOf([s.x0, s.y0], [s.x1, s.y1], [s.mx, s.my]) : 0); }
      return { c: 1, v, b };
    }

    /* Prolunga gli estremi liberi fino alla linea più vicina (giunzioni mancanti): i tratti aggiunti sono stimati */
    function bridgeFree(Ls, targets, ext) {
      const add = [];
      const ends = [];
      for (const s of Ls) { ends.push([s.x0, s.y0, s.x0 - s.x1, s.y0 - s.y1, s]); ends.push([s.x1, s.y1, s.x1 - s.x0, s.y1 - s.y0, s]); }
      for (const [px, py, dx, dy, own] of ends) {
        const len = Math.hypot(dx, dy); if (len < 6) continue;
        const ux = dx / len, uy = dy / len;
        let near = false;
        for (const t of targets) { if (t === own) continue; if (Math.hypot(t.x0 - px, t.y0 - py) < 2.5 || Math.hypot(t.x1 - px, t.y1 - py) < 2.5 || segDist(px, py, t) < 1.5) { near = true; break; } }
        if (near) continue;
        let best = ext, hx = 0, hy = 0;
        for (const t of targets) {
          if (t === own || t.arc) continue;
          const ex = t.x1 - t.x0, ey = t.y1 - t.y0, den = ux * ey - uy * ex;
          if (Math.abs(den) < 0.3 * Math.hypot(ex, ey)) continue;
          const qx = t.x0 - px, qy = t.y0 - py, s = (qx * ey - qy * ex) / den, u = (qx * uy - qy * ux) / den;
          if (s > 0.5 && s < best && u >= -0.02 && u <= 1.02) { best = s; hx = px + ux * s; hy = py + uy * s; }
        }
        if (best < ext) add.push(L_(px, py, hx, hy));
      }
      return add;
    }

    function runAI(P) {
      const t0 = Date.now(), AI = P.ai, W = AI.rw, H = AI.rh, k = Math.max(W, H) / 900;
      const tol = 1.5 * k;
      // --- forme segmentate
      const shapes = [];
      for (const f of AI.polys || []) {
        const pts = []; for (let i = 0; i < f.length; i += 2) pts.push([f[i], f[i + 1]]);
        const s = regShape(pts, tol); if (s) shapes.push(s);
      }
      const areas = shapes.map((s) => s.A), medA = median(areas) || 1, regionA = W * H;
      const gray = AI.gray, lum = (s) => {
        if (!gray) return 128; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const g of s.segs) { x0 = Math.min(x0, g.x0, g.x1); x1 = Math.max(x1, g.x0, g.x1); y0 = Math.min(y0, g.y0, g.y1); y1 = Math.max(y1, g.y0, g.y1); }
        const ax = Math.round(x0 + 0.3 * (x1 - x0)), bx = Math.round(x1 - 0.3 * (x1 - x0)), ay = Math.round(y0 + 0.3 * (y1 - y0)), by = Math.round(y1 - 0.3 * (y1 - y0));
        let t = 0, n = 0; for (let y = Math.max(0, ay); y <= Math.min(H - 1, by); y++) for (let x = Math.max(0, ax); x <= Math.min(W - 1, bx); x++) { t += gray[y * W + x]; n++; }
        return n ? t / n : 128;
      };
      for (const s of shapes) s.lum = lum(s);
      const medL = median(shapes.map((s) => s.lum)) || 128;
      for (const s of shapes) {
        const big = s.A >= 5 * medA || s.A >= 0.012 * regionA;
        const opening = s.lum < 0.55 * medL && s.A >= 0.0015 * regionA;
        s.layer = s.cls === 'arco' || s.cls === 'cerchio' || big || opening ? 1 : 2;
        s.est = s.cls !== 'poligono' && s.dev > Math.max(2.2 * s.tol, 0.035 * Math.min(s.w, s.h));
      }
      const shapeSegs = []; for (const s of shapes) for (const g of s.segs) shapeSegs.push(g);
      // --- disegno neurale -> scheletro -> catene
      const nm = AI.neural, bin = new Uint8Array(W * H), th = P.aiThr || 0.5;
      for (let i = 0; i < W * H; i++) bin[i] = nm[i] < th ? 1 : 0;
      const dl = dilate(bin, W, H, 1), cl = new Uint8Array(W * H);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; cl[i] = dl[i] && dl[i - 1] && dl[i + 1] && dl[i - W] && dl[i + W] && dl[i - W - 1] && dl[i - W + 1] && dl[i + W - 1] && dl[i + W + 1] ? 1 : bin[i]; }
      // riempie le celle minuscole (grana della pietra, intonaco)
      const cellMin = Math.round(200 * k * k), lab = new Int32Array(W * H); let id = 0;
      for (let s = 0; s < W * H; s++) {
        if (cl[s] || lab[s]) continue;
        id++; const comp = [s]; lab[s] = id; let border = false;
        for (let q = 0; q < comp.length && comp.length <= cellMin; q++) {
          const i = comp[q], x = i % W, y = (i / W) | 0;
          if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
          if (x > 0 && !cl[i - 1] && !lab[i - 1]) { lab[i - 1] = id; comp.push(i - 1); }
          if (x < W - 1 && !cl[i + 1] && !lab[i + 1]) { lab[i + 1] = id; comp.push(i + 1); }
          if (y > 0 && !cl[i - W] && !lab[i - W]) { lab[i - W] = id; comp.push(i - W); }
          if (y < H - 1 && !cl[i + W] && !lab[i + W]) { lab[i + W] = id; comp.push(i + W); }
        }
        if (comp.length < cellMin && !border) for (const i of comp) cl[i] = 1;
      }
      let list = thinZS(cl, W, H);
      list = pruneSpurs(cl, W, list, Math.round(12 * k));
      list = thinZS(cl, W, H);
      list = pruneSpurs(cl, W, list, Math.round(8 * k));
      list = dropSmallComp(cl, W, list, Math.round(40 * k));
      const chains = traceSkeleton(cl, W, list);
      const longL = Math.max(80 * k, 0.16 * Math.min(W, H));
      let NL = [], NA = [], raw = 0;
      for (const ch of chains) {
        raw += ch.length; if (ch.length < 5) continue;
        const closed = ch.length > 8 && ch[0][0] === ch[ch.length - 1][0] && ch[0][1] === ch[ch.length - 1][1];
        const pts = closed ? ch.slice(0, -1) : ch;
        if (!closed && pts.length >= 0.4 * longL) {
          const a = pts[0], b = pts[pts.length - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (L >= 0.4 * longL) { let dmax = 0; for (const q of pts) dmax = Math.max(dmax, Math.abs((b[1] - a[1]) * (q[0] - a[0]) - (b[0] - a[0]) * (q[1] - a[1])) / L); if (dmax <= 4 * k) { NL.push(L_(a[0], a[1], b[0], b[1])); continue; } }
        }
        for (const sg of fitChain(smoothPts(pts, closed, 1), closed, tol, true)) (sg.arc ? NA : NL).push(sg);
      }
      const inner = new Uint8Array(W * H);
      for (const f of AI.polys || []) {
        let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
        for (let i = 0; i < f.length; i += 2) { minx = Math.min(minx, f[i]); maxx = Math.max(maxx, f[i]); miny = Math.min(miny, f[i + 1]); maxy = Math.max(maxy, f[i + 1]); }
        const n = f.length / 2;
        for (let y = Math.max(0, Math.ceil(miny)); y <= Math.min(H - 1, Math.floor(maxy)); y++) {
          const xs = [];
          for (let i = 0; i < n; i++) { const j = (i + 1) % n, ya = f[2 * i + 1], yb = f[2 * j + 1]; if ((ya <= y && yb > y) || (yb <= y && ya > y)) xs.push(f[2 * i] + (y - ya) / (yb - ya) * (f[2 * j] - f[2 * i])); }
          xs.sort((a, b) => a - b);
          for (let q = 0; q + 1 < xs.length; q += 2) for (let x = Math.max(0, Math.ceil(xs[q])); x <= Math.min(W - 1, Math.floor(xs[q + 1])); x++) inner[y * W + x] = 1;
        }
      }
      { const er = Math.max(2, Math.round(4 * k)); const inv = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) inv[i] = inner[i] ? 0 : 1; const d = dilate(inv, W, H, er); for (let i = 0; i < W * H; i++) inner[i] = d[i] ? 0 : 1; }
      const inside = (s) => { let c = 0; for (let q = 0; q <= 4; q++) { const x = Math.round(s.x0 + (s.x1 - s.x0) * q / 4), y = Math.round(s.y0 + (s.y1 - s.y0) * q / 4); if (x >= 0 && y >= 0 && x < W && y < H && inner[y * W + x]) c++; } return c >= 3; };
      NL = NL.filter((s) => !inside(s)); NA = NA.filter((s) => !inside(s));
      // via i tratti già descritti dalle forme segmentate
      const covered = (s) => { const m = 5; let hit = 0; for (let q = 0; q <= m; q++) { const x = s.x0 + (s.x1 - s.x0) * q / m, y = s.y0 + (s.y1 - s.y0) * q / m; for (const g of shapeSegs) if (segDist(x, y, g) < 6 * k) { hit++; break; } } return hit >= m; };
      if (shapeSegs.length) { NL = NL.filter((s) => !covered(s)); NA = NA.filter((s) => !covered(s)); }
      NL = mergeLines(NL, 2 * k, 6 * k).map((s) => ({ arc: false, x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 }));
      straighten(NL, 4);
      { const ax = NL.filter(isAxis), ot = NL.filter((s) => !isAxis(s)); NL = mergeLines(ax, 2 * k, 18 * k).map((s) => ({ arc: false, x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 })).concat(ot); }
      const minSeg = 7 * k;
      NL = NL.filter((s) => Math.hypot(s.x1 - s.x0, s.y1 - s.y0) >= minSeg);
      const Ls = [[], [], [], []], As = [[], [], [], []];
      for (const s of NL) Ls[Math.hypot(s.x1 - s.x0, s.y1 - s.y0) >= longL ? 0 : 2].push(s);
      for (const s of NA) { const c = Math.hypot(s.x1 - s.x0, s.y1 - s.y0); if (c >= 10 * k) As[c >= 40 * k ? 1 : 2].push(s); }
      // giunzioni mancanti (stimate)
      const tg = Ls[0].concat(Ls[2], shapeSegs.filter((g) => !g.arc));
      Ls[3] = bridgeFree(Ls[0], tg, 12 * k);
      // --- percorsi
      const paths = []; let lines = 0, arcs = 0; const layers = [0, 0, 0, 0];
      const push = (p, l) => { p.l = l; for (const b of p.b) { if (b) arcs++; else lines++; } paths.push(p); layers[l]++; };
      for (const s of shapes) {
        if (s.cls === 'poligono') {
          const { V, segs } = weld(s.segs.filter((g) => !g.arc), s.segs.filter((g) => g.arc), 3 * k);
          for (const p of buildPaths(V, segs)) { const v = []; for (const q of p.vs) v.push(V[q][0], V[q][1]); push({ c: p.closed ? 1 : 0, v, b: p.bs }, s.layer); }
        } else push(loopPath(s.segs), s.est ? 3 : s.layer);
      }
      for (let l = 0; l < 4; l++) {
        if (!Ls[l].length && !As[l].length) continue;
        const snap = 2 * k, { V, segs: s0 } = weld(Ls[l], As[l], snap);
        if (l !== 3) tSnap(V, s0, snap);
        for (const p of buildPaths(V, s0)) {
          const v = []; for (const q of p.vs) v.push(V[q][0], V[q][1]);
          if (l !== 3 && pathLength(v, p.bs, p.closed) < (l === 2 && !p.closed ? 24 : 10) * k) continue;
          push({ c: p.closed ? 1 : 0, v, b: p.bs }, l);
        }
      }
      // regione -> coordinate immagine
      const ox = AI.ox || 0, oy = AI.oy || 0, sx = AI.sx || 1;
      for (const p of paths) for (let i = 0; i < p.v.length; i += 2) { p.v[i] = ox + p.v[i] * sx; p.v[i + 1] = oy + p.v[i + 1] * sx; }
      const cls = {}; for (const s of shapes) cls[s.cls] = (cls[s.cls] || 0) + 1;
      const dbg = P.debug ? shapes.filter((s) => s.cls === 'arco' || s.est).map((s) => [s.cls, +s.dev.toFixed(1), Math.round(s.w), Math.round(s.h), s.est ? 1 : 0]) : undefined;
      return { paths, info: { T: null, lines, arcs, rawPts: raw, layers, shapes: shapes.length, cls, ms: Date.now() - t0, dbg } };
    }

    /* Riquadro dell'edificio proposto automaticamente: dove si concentrano i bordi lunghi orizzontali e verticali
       (giunti, cornici, stipiti). Cielo, terreno in prospettiva e alberi ne hanno pochi. */
    function detect() {
      if (!IMG) return null;
      const { W, H, gray } = IMG, g = gaussBlur(gray, W, H, 1.4), N = W * H;
      const gx = new Float32Array(N), gy = new Float32Array(N), mag = new Float32Array(N);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const a = g[i - W - 1], b = g[i - W], c = g[i - W + 1], d = g[i - 1], f = g[i + 1], u = g[i + W - 1], v = g[i + W], w = g[i + W + 1];
        gx[i] = (c + 2 * f + w) - (a + 2 * d + u); gy[i] = (u + 2 * v + w) - (a + 2 * b + c); mag[i] = Math.hypot(gx[i], gy[i]);
      }
      const smp = []; for (let i = 0; i < N; i += 7) smp.push(mag[i]); smp.sort((p, q) => p - q);
      const T = Math.max(8, smp[Math.floor(smp.length * 0.8)]);
      const Vm = new Uint8Array(N), Hm = new Uint8Array(N);
      for (let i = 0; i < N; i++) { if (mag[i] < T) continue; const ax = Math.abs(gx[i]), ay = Math.abs(gy[i]); if (ax > 2 * ay) Vm[i] = 1; else if (ay > 2 * ax) Hm[i] = 1; }
      const L = Math.max(10, Math.round(Math.max(W, H) / 110)), cs = 16, gw = Math.ceil(W / cs), gh = Math.ceil(H / cs), score = new Float32Array(gw * gh);
      for (let x = 0; x < W; x++) { let run = 0; for (let y = 0; y <= H; y++) { const on = y < H && Vm[y * W + x]; if (on) run++; else { if (run >= L) for (let q = y - run; q < y; q++) score[((q / cs) | 0) * gw + ((x / cs) | 0)]++; run = 0; } } }
      for (let y = 0; y < H; y++) { let run = 0; for (let x = 0; x <= W; x++) { const on = x < W && Hm[y * W + x]; if (on) run++; else { if (run >= L) for (let q = x - run; q < x; q++) score[((y / cs) | 0) * gw + ((q / cs) | 0)]++; run = 0; } } }
      const sm = boxBlurGrid(score, gw, gh, 1, 2);
      let mx = 0; for (const v of sm) if (v > mx) mx = v; if (mx <= 0) return null;
      const on = new Uint8Array(gw * gh); for (let i = 0; i < on.length; i++) on[i] = sm[i] > 0.28 * mx ? 1 : 0;
      const lab = new Int32Array(gw * gh); let best = 0, bestS = 0, id = 0, bb = null;
      for (let s = 0; s < on.length; s++) {
        if (!on[s] || lab[s]) continue;
        id++; const comp = [s]; lab[s] = id; let tot = 0, x0 = gw, y0 = gh, x1 = 0, y1 = 0;
        for (let q = 0; q < comp.length; q++) {
          const c = comp[q], cx = c % gw, cy = (c / gw) | 0; tot += sm[c];
          x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + dx, ny = cy + dy; if (nx >= 0 && ny >= 0 && nx < gw && ny < gh) { const j = ny * gw + nx; if (on[j] && !lab[j]) { lab[j] = id; comp.push(j); } } }
        }
        if (tot > bestS) { bestS = tot; best = id; bb = [x0, y0, x1, y1]; }
      }
      if (!bb) return null;
      // affina: profilo delle colonne e delle righe dentro il blocco trovato
      const span = (prof) => {
        let pk = 0; for (let i = 1; i < prof.length; i++) if (prof[i] > prof[pk]) pk = i;
        const th = 0.3 * prof[pk]; let a = pk, b = pk;
        while (a > 0 && prof[a - 1] > th) a--; while (b < prof.length - 1 && prof[b + 1] > th) b++;
        return [a, b];
      };
      for (let it = 0; it < 2; it++) {
        const col = new Float32Array(gw), row = new Float32Array(gh);
        for (let y = bb[1]; y <= bb[3]; y++) for (let x = bb[0]; x <= bb[2]; x++) { col[x] += sm[y * gw + x]; row[y] += sm[y * gw + x]; }
        const cx = span(col), cy = span(row);
        bb = [Math.max(bb[0], cx[0]), Math.max(bb[1], cy[0]), Math.min(bb[2], cx[1]), Math.min(bb[3], cy[1])];
      }
      const m = Math.round(0.025 * Math.max(W, H));
      return [Math.max(0, bb[0] * cs - m), Math.max(0, bb[1] * cs - m), Math.min(W, (bb[2] + 1) * cs + m), Math.min(H, (bb[3] + 1) * cs + m)];
    }
    return { setImage, run, detect };
  }
