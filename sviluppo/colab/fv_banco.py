"""Fotovettore: banco di prova dei modelli generativi (Google Colab o computer con GPU).

Confronta, sulla stessa foto e sulla stessa regione:
  - la pipeline attuale di Fotovettore (Informative Drawings + MobileSAM + motore CAD di sviluppo/src/engine.js);
  - candidati generativi che RIDISEGNANO la facciata (SDXL + ControlNet Union, SD 1.5 + ControlNet Lineart),
    il cui disegno viene poi vettorizzato dallo STESSO motore CAD, così da ottenere DXF a livelli confrontabili;
  - facoltativamente un disegno PhotoCAD scaricato dall'utente (PNG, SVG o DXF delle proprie conversioni).

Non modifica Fotovettore: legge engine.js tramite motore.js e i modelli ONNX in prova-ai/modelli.
Le misure geometriche sono indicatori calcolati rispetto alla foto, non una verità assoluta (vedi README.md).
"""
import os, json, time, math, gc, subprocess, tempfile, shutil, csv
import numpy as np, cv2
from PIL import Image, ImageOps

QUI = os.path.dirname(os.path.abspath(__file__))
SVILUPPO = os.path.dirname(QUI)
REPO = os.path.dirname(SVILUPPO)
MODELLI = os.environ.get('FV_MODELLI', os.path.join(REPO, 'prova-ai', 'modelli'))
NODE = os.environ.get('FV_NODE', 'node')
LATO_MOTORE = 900  # stessa risoluzione della regione nella versione dev
LAYERS = [('STRUTTURA', 7, False), ('ELEMENTI', 5, False), ('DETTAGLI', 8, False), ('RICOSTRUZIONI', 30, True)]
COLORI = {0: (0, 0, 0), 1: (200, 60, 20), 2: (150, 150, 150), 3: (0, 120, 230)}  # BGR, come render.py

PROMPT = ('clean architectural elevation line drawing of a building facade, black ink lines on pure white paper, '
          'technical CAD drawing, precise straight lines, every stone block outlined, arches windows and doors outlined, '
          'cornices outlined, orthographic, uniform thin lines, no shading')
NEGATIVO = ('photo, photograph, realistic, color, shading, shadows, gray tones, gradient, texture, hatching, watercolor, '
            'blurry, sky, clouds, people, cars, text, watermark, signature, frame, border, perspective distortion, 3d render')


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- immagini
def carica_foto(percorso, max_lato=2400):
    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
    except Exception:
        pass
    im = ImageOps.exif_transpose(Image.open(percorso)).convert('RGB')
    k = min(1.0, max_lato / max(im.size))
    if k < 1:
        im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    return np.asarray(im).copy()


def ridimensiona(img, lato=None, size=None):
    h, w = img.shape[:2]
    if size is None:
        k = lato / max(w, h)
        size = (max(8, round(w * k)), max(8, round(h * k)))
    interp = cv2.INTER_AREA if size[0] < w else cv2.INTER_CUBIC
    return cv2.resize(img, size, interpolation=interp)


def grigio(rgb):
    rgb = rgb.astype(np.float32)
    return 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]


def salva(percorso, img):
    os.makedirs(os.path.dirname(percorso) or '.', exist_ok=True)
    if img.ndim == 3:
        img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    cv2.imwrite(percorso, img)


# ---------------------------------------------------------------- motore CAD (engine.js tramite Node)
def _node(job):
    d = tempfile.mkdtemp(prefix='fv_')
    try:
        for k, v in list(job.items()):
            if isinstance(v, np.ndarray):
                f = os.path.join(d, k + '.bin')
                np.ascontiguousarray(v).tofile(f)
                job[k] = f
        jf = os.path.join(d, 'job.json')
        with open(jf, 'w') as fh:
            json.dump(job, fh)
        r = subprocess.run([NODE, os.path.join(QUI, 'motore.js'), jf], capture_output=True, text=True)
        if r.returncode:
            raise RuntimeError('motore.js: ' + r.stderr[-3000:])
        with open(jf + '.out.json') as fh:
            return json.load(fh)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def rileva_riquadro(rgb):
    """Riquadro automatico dell'edificio con detect() di engine.js (immagine a 1600 px come nell'app)."""
    v = ridimensiona(rgb, 1600) if max(rgb.shape[:2]) > 1600 else rgb
    r = _node({'cmd': 'detect', 'W': v.shape[1], 'H': v.shape[0], 'gray': grigio(v).astype(np.float32).ravel()})
    if not r.get('box'):
        return [0, 0, rgb.shape[1], rgb.shape[0]]
    k = rgb.shape[1] / v.shape[1]
    b = [int(round(c * k)) for c in r['box']]
    return [max(0, b[0]), max(0, b[1]), min(rgb.shape[1], b[2]), min(rgb.shape[0], b[3])]


def motore(neurale, gray_u8, forme, soglia=0.5):
    """Vettorizzazione AI del motore di Fotovettore. neurale: float 0 = linea, 1 = bianco (rh x rw)."""
    rh, rw = neurale.shape
    return _node({'cmd': 'run', 'rw': rw, 'rh': rh, 'neural': neurale.astype(np.float32).ravel(),
                  'gray': gray_u8.astype(np.uint8).ravel(), 'polys': forme or [], 'aiThr': soglia})


# ---------------------------------------------------------------- modelli ONNX gia' usati da Fotovettore
_SESS = {}


def _sessione(nome):
    import onnxruntime as ort
    if nome not in _SESS:
        so = ort.SessionOptions()
        so.intra_op_num_threads = os.cpu_count() or 2
        _SESS[nome] = ort.InferenceSession(os.path.join(MODELLI, nome), so, providers=['CPUExecutionProvider'])
    return _SESS[nome]


def _pos(L, T, s):
    return sorted(set(list(range(0, max(1, L - T), s)) + [max(0, L - T)]))


def informative_drawings(rgb, T=360):
    """Disegno neurale a riquadri, stessa logica di ai_worker.js / strumenti/pre.py. Uscita: 0 = linea, 1 = bianco."""
    R = rgb.astype(np.float32)
    rh, rw = R.shape[:2]
    T = min(T, rh, rw)
    st = max(1, int(T * 0.7))
    s = _sessione('contour_style_512x512.onnx')
    acc = np.zeros((rh, rw), np.float32)
    wt = np.zeros((rh, rw), np.float32)
    h1 = 0.5 - 0.5 * np.cos(2 * np.pi * (np.arange(T) + 1) / (T + 1))
    wm = np.outer(h1, h1).astype(np.float32) + 1e-3
    for y in _pos(rh, T, st):
        for x in _pos(rw, T, st):
            tl = cv2.resize(R[y:y + T, x:x + T], (512, 512), interpolation=cv2.INTER_LINEAR).transpose(2, 0, 1)[None]
            o = s.run(None, {'input_image': np.ascontiguousarray(tl)})[0][0, 0]
            acc[y:y + T, x:x + T] += cv2.resize(o, (T, T), interpolation=cv2.INTER_LINEAR) * wm
            wt[y:y + T, x:x + T] += wm
    return np.clip(acc / wt, 0, 1)


def mobilesam_forme(rgb, T=360, G=18, seme=0):
    """Forme chiuse con MobileSAM a riquadri, stessa logica di strumenti/pre.py. Uscita: lista di [x,y,...]."""
    R = rgb.astype(np.float32)
    rh, rw = R.shape[:2]
    T = min(T, rh, rw)
    enc, dec = _sessione('mobilesam-encoder.onnx'), _sessione('mobilesam-decoder.onnx')
    mean = np.array([123.675, 116.28, 103.53], np.float32)
    std = np.array([58.395, 57.12, 57.375], np.float32)
    cover = np.zeros((rh, rw), np.uint8)
    tried = np.zeros((rh, rw), np.uint8)
    polys = []
    st2 = int(T * 0.75)
    rng = np.random.default_rng(seme)
    for ty in _pos(rh, T, st2):
        for tx in _pos(rw, T, st2):
            x_in = ((cv2.resize(R[ty:ty + T, tx:tx + T], (1024, 1024), interpolation=cv2.INTER_LINEAR) - mean) / std)
            emb = enc.run(None, {'input_image': np.ascontiguousarray(x_in.transpose(2, 0, 1)[None].astype(np.float32))})[0]
            sc = 1024 / T
            g = 0.03 + 0.94 * np.arange(G) / (G - 1)
            pts = [(tx + a * T + rng.uniform(-4, 4), ty + b * T + rng.uniform(-4, 4)) for b in g for a in g]
            rng.shuffle(pts)
            for px, py in pts:
                xi, yi = int(np.clip(px, 0, rw - 1)), int(np.clip(py, 0, rh - 1))
                if cover[yi, xi] or tried[yi, xi]:
                    continue
                cv2.circle(tried, (xi, yi), 6, 1, -1)
                m, iou, low = dec.run(None, {
                    'image_embeddings': emb,
                    'point_coords': np.array([[[(px - tx) * sc, (py - ty) * sc], [0, 0]]], np.float32),
                    'point_labels': np.array([[1, -1]], np.float32),
                    'mask_input': np.zeros((1, 1, 256, 256), np.float32),
                    'has_mask_input': np.zeros(1, np.float32),
                    'orig_im_size': np.array([256, 256], np.float32)})
                if iou[0, 0] < 0.75:
                    continue
                mk = (low[0, 0] > 0).astype(np.uint8)
                a = mk.sum()
                if a < 94 or a > 16384 or mk[0].sum() + mk[-1].sum() + mk[:, 0].sum() + mk[:, -1].sum() > 3:
                    continue
                up = cv2.resize(mk, (T, T), interpolation=cv2.INTER_NEAREST)
                sub = cover[ty:ty + T, tx:tx + T]
                tot = up.sum()
                if tot and (sub[up > 0] > 0).sum() / tot > 0.7:
                    continue
                cover[ty:ty + T, tx:tx + T] |= up
                cs, _ = cv2.findContours(mk, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
                c = max(cs, key=cv2.contourArea).reshape(-1, 2).astype(np.float32)
                c = (c + 0.5) * (T / 256) + np.array([tx, ty], np.float32)
                polys.append([round(float(v), 2) for v in c.ravel()])
    return polys


# ---------------------------------------------------------------- percorsi, DXF, raster
def punti_percorso(p, passo=2.0):
    """Punti di un percorso del motore, archi (bulge) campionati. Bulge > 0 = antiorario a schermo."""
    v = np.array(p['v'], float).reshape(-1, 2)
    n = len(v)
    b = p.get('b') or []
    m = n if p['c'] else n - 1
    out = [v[0]]
    for i in range(m):
        P, Q = v[i], v[(i + 1) % n]
        bb = b[i] if i < len(b) else 0
        if not bb:
            out.append(Q)
            continue
        P2, Q2 = np.array([P[0], -P[1]]), np.array([Q[0], -Q[1]])  # y in su, convenzione DXF
        th = 4 * math.atan(bb)
        d = Q2 - P2
        c = math.hypot(*d)
        if c < 1e-9:
            continue
        nrm = np.array([-d[1], d[0]]) / c
        C = (P2 + Q2) / 2 + nrm * (c / 2) / math.tan(th / 2)
        r = math.hypot(*(P2 - C))
        a0 = math.atan2(P2[1] - C[1], P2[0] - C[0])
        ns = max(2, int(abs(th) * r / passo))
        for t in np.linspace(0, 1, ns + 1)[1:]:
            a = a0 + th * t
            out.append(np.array([C[0] + r * math.cos(a), -(C[1] + r * math.sin(a))]))
    return np.array(out)


def rasterizza(paths, rw, rh, scala=1, spessore=1, colori=False, livelli=(0, 1, 2, 3)):
    im = np.full((rh * scala, rw * scala, 3), 255, np.uint8) if colori else np.zeros((rh * scala, rw * scala), np.uint8)
    for p in paths:
        if p['l'] not in livelli:
            continue
        pts = np.round(punti_percorso(p) * scala).astype(np.int32)
        col = COLORI[p['l']] if colori else 255
        cv2.polylines(im, [pts], False, col, spessore, cv2.LINE_AA if colori else cv2.LINE_8)
    if colori:
        im = cv2.cvtColor(im, cv2.COLOR_BGR2RGB)
    return im


def scrivi_dxf(paths, rw, rh, larghezza_mm, file):
    """Stesso DXF R12 di buildDXF() in main.js: mm, 4 layer, LINE e POLYLINE con bulge, y ribaltata."""
    k = (larghezza_mm if larghezza_mm > 0 else 10000) / max(1, rw)
    W = rw * k
    o = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '9', '$LTSCALE', '40', '1.0', '0', 'ENDSEC',
         '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LTYPE', '70', '2',
         '0', 'LTYPE', '2', 'CONTINUOUS', '70', '0', '3', 'Continua', '72', '65', '73', '0', '40', '0.0',
         '0', 'LTYPE', '2', 'DASHED', '70', '0', '3', 'Tratteggio __ __', '72', '65', '73', '2',
         '40', '%.2f' % max(6, W / 150), '49', '%.2f' % max(4, W / 225), '49', '%.2f' % -max(2, W / 450),
         '0', 'ENDTAB', '0', 'TABLE', '2', 'LAYER', '70', '5', '0', 'LAYER', '2', '0', '70', '0', '62', '7', '6', 'CONTINUOUS']
    for name, aci, dash in LAYERS:
        o += ['0', 'LAYER', '2', name, '70', '0', '62', str(aci), '6', 'DASHED' if dash else 'CONTINUOUS']
    o += ['0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES']
    X = lambda x: '%.3f' % (x * k)
    Y = lambda y: '%.3f' % ((rh - y) * k)
    for p in paths:
        v, ly, b = p['v'], LAYERS[p['l']][0], p.get('b') or []
        n = len(v) // 2
        if not p['c'] and n == 2 and not (b and b[0]):
            o += ['0', 'LINE', '8', ly, '10', X(v[0]), '20', Y(v[1]), '30', '0.0', '11', X(v[2]), '21', Y(v[3]), '31', '0.0']
            continue
        o += ['0', 'POLYLINE', '8', ly, '66', '1', '10', '0.0', '20', '0.0', '30', '0.0', '70', '1' if p['c'] else '0']
        for i in range(n):
            o += ['0', 'VERTEX', '8', ly, '10', X(v[2 * i]), '20', Y(v[2 * i + 1]), '30', '0.0']
            if i < len(b) and b[i]:
                o += ['42', '%.6f' % b[i]]
        o += ['0', 'SEQEND', '8', ly]
    o += ['0', 'ENDSEC', '0', 'EOF']
    with open(file, 'w') as fh:
        fh.write('\n'.join(o) + '\n')


def statistiche_percorsi(paths):
    s = {'polilinee': len(paths), 'chiuse': sum(1 for p in paths if p['c']),
         'segmenti_ad_arco': sum(1 for p in paths for x in (p.get('b') or []) if x)}
    for i, (name, _, _) in enumerate(LAYERS):
        s['layer_' + name] = sum(1 for p in paths if p['l'] == i)
    return s


# ---------------------------------------------------------------- misure geometriche
def _lsd(g8, Lmin):
    seg = cv2.createLineSegmentDetector().detect(g8)[0]
    if seg is None:
        return np.zeros((0, 4), np.float32)
    seg = seg.reshape(-1, 4)
    L = np.hypot(seg[:, 2] - seg[:, 0], seg[:, 3] - seg[:, 1])
    return seg[L >= Lmin]


def _dist(mask):
    """Distanza (px) di ogni pixel dal pixel acceso piu' vicino di mask."""
    if not mask.any():
        return np.full(mask.shape, 1e6, np.float32)
    return cv2.distanceTransform((~mask.astype(bool)).astype(np.uint8), cv2.DIST_L2, 3)


def _copertura(segs, dist, r):
    """Per ogni segmento: frazione dei suoi punti entro r px dal disegno (dist) e lunghezza."""
    h, w = dist.shape
    fr, L = [], []
    for x0, y0, x1, y1 in segs:
        l = math.hypot(x1 - x0, y1 - y0)
        n = max(2, int(l / 2))
        xs = np.clip(np.round(np.linspace(x0, x1, n)).astype(int), 0, w - 1)
        ys = np.clip(np.round(np.linspace(y0, y1, n)).astype(int), 0, h - 1)
        fr.append(float((dist[ys, xs] <= r).mean()))
        L.append(l)
    return np.array(fr), np.array(L)


def evidenza_foto(rgb):
    """Bordi della foto (Canny con soglie relative) piu' segmenti rettilinei lunghi (LSD)."""
    h, w = rgb.shape[:2]
    diag = math.hypot(w, h)
    g = cv2.GaussianBlur(grigio(rgb), (0, 0), 1.2)
    g8 = np.clip(g, 0, 255).astype(np.uint8)
    gx, gy = cv2.Sobel(g, cv2.CV_32F, 1, 0), cv2.Sobel(g, cv2.CV_32F, 0, 1)
    lo, hi = np.percentile(np.hypot(gx, gy), [75, 92])
    canny = cv2.Canny(g8, float(lo), float(max(hi, lo + 1)), L2gradient=True) > 0
    segs = _lsd(g8, 0.04 * diag)
    sm = np.zeros((h, w), np.uint8)
    for x0, y0, x1, y1 in segs:
        cv2.line(sm, (int(x0), int(y0)), (int(x1), int(y1)), 1, 1)
    ev = canny | (sm > 0)
    return {'mask': ev, 'dist': _dist(ev), 'segs': segs, 'r': max(2.0, 0.004 * diag), 'diag': diag, 'g8': g8}


def _scheletro(ink):
    from skimage.morphology import skeletonize
    return skeletonize(ink.astype(bool))


def _profilo_arco(m):
    """True se la parte alta della regione e' un arco (profilo superiore curvo e ben approssimato da un cerchio)."""
    hh, ww = m.shape
    if ww < 12 or hh < 10:
        return False
    cols = np.where(m.any(0))[0]
    if len(cols) < 10:
        return False
    top = np.array([np.argmax(m[:, c]) for c in range(ww)], float)
    top[~m.any(0)] = np.nan
    at = lambda f: np.nanmedian(top[max(0, int(f * ww) - 1):int(f * ww) + 2])
    sag = ((at(0.1) + at(0.9)) / 2 - at(0.5)) / ww
    if not (sag > 0.12):
        return False
    xs = np.arange(ww)[int(0.05 * ww):int(0.95 * ww)]
    ys = top[xs]
    ok = ~np.isnan(ys)
    xs, ys = xs[ok].astype(float), ys[ok]
    if len(xs) < 8:
        return False
    A = np.c_[xs, ys, np.ones_like(xs)]
    sol = np.linalg.lstsq(A, -(xs ** 2 + ys ** 2), rcond=None)[0]
    cx, cy = -sol[0] / 2, -sol[1] / 2
    r2 = cx * cx + cy * cy - sol[2]
    if r2 <= 0:
        return False
    r = math.sqrt(r2)
    res = np.sqrt(np.mean((np.hypot(xs - cx, ys - cy) - r) ** 2))
    return 0.3 * ww <= r <= 1.5 * ww and res < 0.05 * ww and abs(cx - ww / 2) < 0.2 * ww


def regioni(ink, rgb):
    """Celle chiuse del disegno, con aperture (interno scuro nella foto) e archi (profilo superiore circolare)."""
    h, w = ink.shape
    A = h * w
    libero = (cv2.dilate(ink.astype(np.uint8), np.ones((3, 3), np.uint8)) == 0).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(libero, connectivity=4)
    g = grigio(rgb)
    med = float(np.median(g))
    out = []
    for i in range(1, n):
        x, y, ww, hh, a = [int(t) for t in st[i]]
        if a < 0.0002 * A or a > 0.25 * A or x == 0 or y == 0 or x + ww >= w or y + hh >= h:
            continue
        m = lab[y:y + hh, x:x + ww] == i
        lum = float(g[y:y + hh, x:x + ww][m].mean())
        pts = np.argwhere(m)[:, ::-1].astype(np.float32)
        rect = cv2.minAreaRect(pts)
        riemp = a / max(1.0, rect[1][0] * rect[1][1])
        solid = a / max(1.0, cv2.contourArea(cv2.convexHull(pts)))  # celle unite o ad anello: concave
        out.append({'box': [x, y, x + ww, y + hh], 'area': a, 'rettangolare': bool(riemp > 0.85),
                    'apertura': bool(a >= 0.003 * A and lum < 0.75 * med and solid > 0.85),
                    'arco': bool(a >= 0.002 * A and solid > 0.9 and hh >= 0.6 * ww and _profilo_arco(m))})
    return out


def misura(ink, rgb, ev):
    """Indicatori di completezza e fedelta' di un disegno (ink: bool rh x rw) rispetto alla foto."""
    r, diag = ev['r'], ev['diag']
    sk = _scheletro(ink)
    npx = int(sk.sum())
    d_ev = ev['dist'][sk] if npx else np.array([1e6])
    dist_ink = _dist(sk)
    cov, L = _copertura(ev['segs'], dist_ink, r)
    compl = float((L * (cov >= 0.7)).sum() / L.sum()) if len(L) else float('nan')
    g_ink = np.where(cv2.dilate(sk.astype(np.uint8), np.ones((2, 2), np.uint8)) > 0, 0, 255).astype(np.uint8)
    segs_d = _lsd(g_ink, 0.04 * diag)
    sup, Ld = _copertura(segs_d, ev['dist'], r)
    inventate = float((Ld * (sup < 0.6)).sum() / Ld.sum()) if len(Ld) else 0.0
    reg = regioni(ink, rgb)
    return {
        'precisione_tratto': round(float((d_ev <= r).mean()), 3),
        'scarto_mediano_px': round(float(np.median(d_ev[d_ev <= 4 * r])) if (d_ev <= 4 * r).any() else float('nan'), 2),
        'completezza_strutturale': round(compl, 3),
        'linee_lunghe_inventate': round(inventate, 3),
        'celle_chiuse': len(reg),
        'celle_rettangolari': round(float(np.mean([q['rettangolare'] for q in reg])) if reg else 0.0, 3),
        'aperture': sum(q['apertura'] for q in reg),
        'archi': sum(q['arco'] for q in reg),
        'pixel_tratto': npx,
    }, reg


def _iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    i = ix * iy
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i
    return i / u if u > 0 else 0.0


def consenso(fonti, min_fonti=2):
    """Elementi (riquadri) trovati da almeno min_fonti fonti indipendenti, con IoU >= 0.5."""
    cl = []
    for nome, boxes in fonti.items():
        for b in boxes:
            best, bc = 0.0, None
            for c in cl:
                if nome in c['fonti']:
                    continue
                iou = _iou(c['rif'], b)
                if iou > best:
                    best, bc = iou, c
            if bc is not None and best >= 0.5:
                bc['boxes'].append(b)
                bc['fonti'].add(nome)
                bc['rif'] = [float(np.median([q[k] for q in bc['boxes']])) for k in range(4)]
            else:
                cl.append({'boxes': [b], 'fonti': {nome}, 'rif': list(map(float, b))})
    return [c['rif'] for c in cl if len(c['fonti']) >= min_fonti]


def confronta(boxes, rif, diag):
    """Richiamo, precisione, IoU, errore di proporzione (larghezza/altezza) e spostamento rispetto ai riferimenti."""
    if not rif:
        return {'richiamo': float('nan'), 'precisione': float('nan'), 'iou_medio': float('nan'),
                'errore_proporzioni_%': float('nan'), 'spostamento_%': float('nan')}
    iou_m, err, mov = [], [], []
    for R in rif:
        best, bb = 0.0, None
        for b in boxes:
            i = _iou(R, b)
            if i > best:
                best, bb = i, b
        if best >= 0.5:
            iou_m.append(best)
            ar = lambda q: max(1e-6, q[2] - q[0]) / max(1e-6, q[3] - q[1])
            err.append(abs(math.log(ar(bb) / ar(R))))
            mov.append(math.hypot((bb[0] + bb[2] - R[0] - R[2]) / 2, (bb[1] + bb[3] - R[1] - R[3]) / 2) / diag)
    prec = np.mean([max([_iou(b, R) for R in rif]) >= 0.5 for b in boxes]) if boxes else float('nan')
    return {'richiamo': round(len(iou_m) / len(rif), 3), 'precisione': round(float(prec), 3),
            'iou_medio': round(float(np.mean(iou_m)), 3) if iou_m else float('nan'),
            'errore_proporzioni_%': round(100 * (math.exp(np.mean(err)) - 1), 1) if err else float('nan'),
            'spostamento_%': round(100 * float(np.mean(mov)), 2) if mov else float('nan')}


def punteggio(m):
    """Criterio per scegliere il seme migliore (riprova di qualita'): completezza e precisione, penalita' alle invenzioni."""
    c = 0 if math.isnan(m['completezza_strutturale']) else m['completezza_strutturale']
    return c + 0.5 * m['precisione_tratto'] - 1.0 * m['linee_lunghe_inventate']


# ---------------------------------------------------------------- disegno esterno (PhotoCAD dell'utente)
def carica_disegno_esterno(percorso):
    ext = os.path.splitext(percorso)[1].lower()
    if ext == '.svg':
        import cairosvg
        png = percorso + '.png'
        cairosvg.svg2png(url=percorso, write_to=png, output_width=2400, background_color='white')
        percorso = png
    elif ext == '.dxf':
        import ezdxf
        from ezdxf.addons.drawing import matplotlib as ezm
        png = percorso + '.png'
        doc = ezdxf.readfile(percorso)
        ezm.qsave(doc.modelspace(), png, bg='#FFFFFF', fg='#000000', dpi=300)
        percorso = png
    im = Image.open(percorso)
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        bg = Image.new('RGBA', im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(bg, im)
    return grigio(np.asarray(im.convert('RGB'))) < 128


def allinea_esterno(ink_ext, foto_shape, box, rw, rh, rif_ink, r):
    """Porta un disegno esterno nelle coordinate della regione: prova 'foto intera' o 'solo riquadro' con margini
    uniformi da 0 a 6%, sceglie la sovrapposizione migliore col disegno di riferimento, poi affina con ECC."""
    ph, pw = ink_ext.shape
    H0, W0 = foto_shape[:2]
    bw, bh = box[2] - box[0], box[3] - box[1]
    ext8 = (ink_ext > 0).astype(np.uint8) * 255
    d_rif = _dist(rif_ink)
    best = (-1, None, None)
    for copre in ('foto', 'riquadro'):
        tw, th = (W0, H0) if copre == 'foto' else (bw, bh)
        offx, offy = (box[0], box[1]) if copre == 'foto' else (0, 0)
        for mf in np.linspace(0, 0.06, 13):
            k = min(pw * (1 - 2 * mf) / tw, ph * (1 - 2 * mf) / th)
            ox, oy = (pw - tw * k) / 2, (ph - th * k) / 2
            M = np.array([[k * bw / rw, 0, k * offx + ox], [0, k * bh / rh, k * offy + oy]], np.float32)
            wv = cv2.warpAffine(ext8, M, (rw, rh), flags=cv2.WARP_INVERSE_MAP | cv2.INTER_NEAREST) > 0
            if wv.sum() < 50:
                continue
            P = float((d_rif[wv] <= 2 * r).mean())
            R = float((_dist(wv)[rif_ink] <= 2 * r).mean())
            f = 2 * P * R / (P + R + 1e-9)
            if f > best[0]:
                best = (f, M, copre)
    if best[1] is None:
        return None, {'allineamento': 'fallito'}
    M = best[1]
    info = {'allineamento': best[2], 'f_iniziale': round(best[0], 3)}
    try:  # affinamento ECC su versioni sfocate
        a = cv2.GaussianBlur(rif_ink.astype(np.float32), (0, 0), 3)
        b = cv2.GaussianBlur(cv2.warpAffine(ext8, M, (rw, rh), flags=cv2.WARP_INVERSE_MAP | cv2.INTER_LINEAR).astype(np.float32) / 255, (0, 0), 3)
        Wm = np.eye(2, 3, dtype=np.float32)
        _, Wm = cv2.findTransformECC(a, b, Wm, cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 100, 1e-5), None, 5)
        A3 = np.vstack([M, [0, 0, 1]]) @ np.vstack([Wm, [0, 0, 1]])
        M = A3[:2].astype(np.float32)
        info['ecc'] = 'ok'
    except Exception as e:
        info['ecc'] = 'non applicato (%s)' % type(e).__name__
    wv = cv2.warpAffine(ext8, M, (rw, rh), flags=cv2.WARP_INVERSE_MAP | cv2.INTER_LINEAR) > 96
    return wv, info


# ---------------------------------------------------------------- candidati generativi
def _dims(rw, rh, lato, mult=64):
    k = lato / max(rw, rh)
    return max(mult, int(round(rw * k / mult)) * mult), max(mult, int(round(rh * k / mult)) * mult)


def normalizza_disegno(g):
    """Mappa di tratto 0..1 (0 = linea) da un disegno generato. I modelli di diffusione disegnano spesso linee grigie
    su carta grigia (SDXL: carta ~220, linee 90-160): una soglia fissa a 128 perde gran parte del tratto.
    Si stima la carta localmente (chiusura 15 px + sfocatura) e si usa il contrasto relativo: tratto = almeno ~18%
    piu' scuro della carta circostante; se il disegno e' molto chiaro (Lisbona: linee solo 5-10% piu' scure),
    la soglia sale fino al 15% dei pixel piu' scuri, con un minimo del 5% di contrasto (valore 0.5 della mappa)."""
    g = np.asarray(g, np.float32)
    bg = cv2.GaussianBlur(cv2.morphologyEx(g, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8)), (0, 0), 5)
    r = g / np.maximum(bg, 1.0)
    t = float(np.clip(np.percentile(r, 15), 0.82, 0.95))
    return np.clip((r - t) / 0.36 + 0.5, 0, 1)


def celle_come_forme(neurale, amin=0.0002, amax=0.25, cresc=2):
    """Celle chiuse del disegno come forme per il motore (alternativa a MobileSAM): ogni area bianca racchiusa dal
    tratto, allargata di cresc px per riportare il contorno sull'asse della linea. Esperimento del 2/11/2026:
    completa ma irregolare (celle fuse, archetti deformati), vedi handoff 15.8."""
    rh, rw = neurale.shape
    A = rh * rw
    lib = (cv2.dilate((neurale < 0.5).astype(np.uint8), np.ones((3, 3), np.uint8)) == 0).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(lib, connectivity=4)
    out = []
    k = np.ones((2 * cresc + 1, 2 * cresc + 1), np.uint8)
    for i in range(1, n):
        x, y, w, h, a = [int(t) for t in st[i]]
        if a < amin * A or a > amax * A or x == 0 or y == 0 or x + w >= rw or y + h >= rh:
            continue
        m = cv2.dilate((lab == i).astype(np.uint8), k)
        cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        c = max(cs, key=cv2.contourArea).reshape(-1, 2).astype(np.float32) + 0.5
        out.append([round(float(v), 2) for v in c.ravel()])
    return out


def controllo_tratto(neurale, segs, size):
    """Immagine di controllo: tratti bianchi su nero (Informative Drawings + segmenti rettilinei della foto)."""
    rh, rw = neurale.shape
    c = np.clip((1 - neurale) * 255, 0, 255).astype(np.uint8)
    for x0, y0, x1, y1 in segs:
        cv2.line(c, (int(x0), int(y0)), (int(x1), int(y1)), 255, 1, cv2.LINE_AA)
    return Image.fromarray(cv2.resize(c, size, interpolation=cv2.INTER_LINEAR if size[0] > rw else cv2.INTER_AREA))


def _gpu():
    import torch
    if not torch.cuda.is_available():
        return None, 0
    return 'cuda', torch.cuda.get_device_properties(0).total_memory / 2 ** 30


def _su_dispositivo(pipe, gb_min):
    dev, gb = _gpu()
    if dev is None:
        return 'cpu'
    if gb >= gb_min:
        pipe.to('cuda')
        return 'cuda'
    pipe.enable_model_cpu_offload()
    return 'cuda+offload'


class SDXLUnion:
    chiave = 'sdxl'
    nome = 'SDXL + ControlNet Union'
    lato = 1024
    licenze = ('SDXL base 1.0: CreativeML Open RAIL++-M; ControlNet Union (xinsir): Apache-2.0; '
               'VAE fp16-fix (madebyollin): MIT')

    def carica(self):
        import torch
        from diffusers import StableDiffusionXLControlNetUnionPipeline, ControlNetUnionModel, AutoencoderKL
        if _gpu()[0] is None:
            raise RuntimeError('SDXL richiede una GPU: in Colab scegli Runtime > Cambia tipo di runtime > GPU T4.')
        cn = ControlNetUnionModel.from_pretrained('xinsir/controlnet-union-sdxl-1.0', torch_dtype=torch.float16)
        vae = AutoencoderKL.from_pretrained('madebyollin/sdxl-vae-fp16-fix', torch_dtype=torch.float16)
        self.pipe = StableDiffusionXLControlNetUnionPipeline.from_pretrained(
            'stabilityai/stable-diffusion-xl-base-1.0', controlnet=cn, vae=vae, torch_dtype=torch.float16, variant='fp16')
        self.dispositivo = _su_dispositivo(self.pipe, 14.5)
        self.pipe.set_progress_bar_config(disable=True)

    def genera(self, ctrl, seme, passi=30, guida=6.0, scala=1.0):
        import torch
        g = torch.Generator('cpu').manual_seed(int(seme))
        return self.pipe(PROMPT, negative_prompt=NEGATIVO, control_image=[ctrl], control_mode=[3],
                         width=ctrl.width, height=ctrl.height, num_inference_steps=passi, guidance_scale=guida,
                         controlnet_conditioning_scale=scala, generator=g).images[0]

    def libera(self):
        _libera(self)


class SD15Lineart:
    chiave = 'sd15'
    nome = 'SD 1.5 + ControlNet Lineart'
    lato = 768
    licenze = 'Stable Diffusion v1.5: CreativeML OpenRAIL-M; ControlNet 1.1 lineart (lllyasviel): CreativeML OpenRAIL-M'

    def carica(self):
        import torch
        from diffusers import StableDiffusionControlNetPipeline, ControlNetModel, UniPCMultistepScheduler
        dt = torch.float16 if _gpu()[0] else torch.float32
        cn = ControlNetModel.from_pretrained('lllyasviel/control_v11p_sd15_lineart', torch_dtype=dt)
        self.pipe = StableDiffusionControlNetPipeline.from_pretrained(
            'stable-diffusion-v1-5/stable-diffusion-v1-5', controlnet=cn, torch_dtype=dt,
            safety_checker=None, requires_safety_checker=False)
        self.pipe.scheduler = UniPCMultistepScheduler.from_config(self.pipe.scheduler.config)
        self.dispositivo = _su_dispositivo(self.pipe, 6)
        self.pipe.set_progress_bar_config(disable=True)

    def genera(self, ctrl, seme, passi=30, guida=7.0, scala=1.0):
        import torch
        g = torch.Generator('cpu').manual_seed(int(seme))
        return self.pipe(PROMPT, image=ctrl, negative_prompt=NEGATIVO, width=ctrl.width, height=ctrl.height,
                         num_inference_steps=passi, guidance_scale=guida, controlnet_conditioning_scale=scala,
                         generator=g).images[0]

    def libera(self):
        _libera(self)


def _libera(obj):
    obj.pipe = None
    gc.collect()
    try:
        import torch
        torch.cuda.empty_cache()
    except Exception:
        pass


CANDIDATI = {'sdxl': SDXLUnion, 'sd15': SD15Lineart}


# ---------------------------------------------------------------- composizione delle immagini di confronto
def _didascalia(img, testo):
    img = img.copy() if img.ndim == 3 else cv2.cvtColor(img, cv2.COLOR_GRAY2RGB)
    bar = np.full((34, img.shape[1], 3), 255, np.uint8)
    cv2.putText(bar, testo[:90], (8, 23), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 1, cv2.LINE_AA)
    return np.vstack([bar, img])


def sovrapponi(rgb, ink, reg=None, rif_ap=None):
    """Tratto in rosso sulla foto schiarita; aperture in verde, archi in magenta, riferimenti di consenso in ciano."""
    o = (rgb.astype(np.float32) * 0.45 + 255 * 0.55).astype(np.uint8)
    o[ink] = (220, 20, 20)
    for b in (rif_ap or []):
        cv2.rectangle(o, (int(b[0]), int(b[1])), (int(b[2]), int(b[3])), (0, 190, 220), 1)
    for q in (reg or []):
        if q['arco']:
            cv2.rectangle(o, tuple(q['box'][:2]), tuple(q['box'][2:]), (200, 0, 200), 2)
        elif q['apertura']:
            cv2.rectangle(o, tuple(q['box'][:2]), tuple(q['box'][2:]), (0, 160, 0), 2)
    return o


def griglia(righe):
    """righe: lista di liste di immagini RGB della stessa altezza."""
    out = []
    W = max(sum(i.shape[1] for i in r) + 8 * (len(r) - 1) for r in righe)
    for r in righe:
        sep = np.full((r[0].shape[0], 8, 3), 255, np.uint8)
        row = r[0]
        for i in r[1:]:
            row = np.hstack([row, sep, i])
        if row.shape[1] < W:
            row = np.hstack([row, np.full((row.shape[0], W - row.shape[1], 3), 255, np.uint8)])
        out += [row, np.full((8, W, 3), 255, np.uint8)]
    return np.vstack(out)


# ---------------------------------------------------------------- confronto completo
def esegui_confronto(foto, uscita, box=None, modelli=('sdxl', 'sd15'), semi=(1, 2, 3), passi=30,
                     larghezza_mm=10000, usa_sam=True, photocad=None, scala_controllo=1.0):
    t0 = time.time()
    nome = os.path.splitext(os.path.basename(foto))[0]
    D = os.path.join(uscita, nome)
    os.makedirs(D, exist_ok=True)
    tempi = {}
    rgb = carica_foto(foto)
    if box == 'tutta':  # foto gia' ritagliata sul prospetto
        box = [0, 0, rgb.shape[1], rgb.shape[0]]
    if box is None:
        box = rileva_riquadro(rgb)
        log('Riquadro automatico (motore Fotovettore):', box)
    prev = rgb.copy()
    cv2.rectangle(prev, tuple(box[:2]), tuple(box[2:]), (255, 40, 40), max(2, rgb.shape[1] // 300))
    salva(os.path.join(D, '00_foto_e_riquadro.jpg'), prev)
    reg = ridimensiona(rgb[box[1]:box[3], box[0]:box[2]], LATO_MOTORE)
    rh, rw = reg.shape[:2]
    gray8 = np.clip(grigio(reg), 0, 255).astype(np.uint8)
    salva(os.path.join(D, '01_regione.png'), reg)
    ev = evidenza_foto(reg)

    t = time.time()
    neur_id = informative_drawings(reg)
    tempi['informative_drawings_s'] = round(time.time() - t, 1)
    salva(os.path.join(D, '10_informative_drawings.png'), (neur_id * 255).astype(np.uint8))
    forme = []
    if usa_sam:
        t = time.time()
        log('MobileSAM (CPU, qualche minuto)...')
        forme = mobilesam_forme(reg)
        tempi['mobilesam_s'] = round(time.time() - t, 1)
        log('  forme:', len(forme))

    grezzi = {'Informative Drawings (attuale)': neur_id < 0.5}
    neurali = {'Fotovettore attuale': neur_id}
    semi_info = {}
    for chiave in modelli:
        C = CANDIDATI[chiave]()
        t = time.time()
        log('Carico %s (prima volta: download di alcuni GB)...' % C.nome)
        try:
            C.carica()
        except Exception as e:
            log('  %s non disponibile: %s' % (C.nome, e))
            semi_info[C.nome] = {'errore': str(e)}
            continue
        tempi[chiave + '_caricamento_s'] = round(time.time() - t, 1)
        size = _dims(rw, rh, C.lato)
        ctrl = controllo_tratto(neur_id, ev['segs'], size)
        ctrl.save(os.path.join(D, '2%s_controllo.png' % chiave))
        prove = []
        for s in semi:
            t = time.time()
            out = C.genera(ctrl, s, passi=passi, scala=scala_controllo)
            dt = round(time.time() - t, 1)
            g = grigio(np.asarray(out.convert('RGB')))
            g = cv2.resize(g, (rw, rh), interpolation=cv2.INTER_AREA)
            neu = normalizza_disegno(g)
            m, _ = misura(neu < 0.5, reg, ev)
            prove.append((punteggio(m), s, neu, m, dt))
            salva(os.path.join(D, '2%s_seme%d.png' % (chiave, s)), np.clip(g, 0, 255).astype(np.uint8))
            log('  %s seme %d: %.1f s, completezza %.3f, precisione %.3f, inventate %.3f' % (
                C.nome, s, dt, m['completezza_strutturale'], m['precisione_tratto'], m['linee_lunghe_inventate']))
        C.libera()
        prove.sort(key=lambda p: -p[0])
        best = prove[0]
        semi_info[C.nome] = {'dispositivo': getattr(C, 'dispositivo', '?'), 'semi': [p[1] for p in prove],
                             'seme_scelto': best[1], 'secondi_per_immagine': [p[4] for p in prove],
                             'punteggi': [round(p[0], 3) for p in prove], 'licenze': C.licenze,
                             'dimensione_generazione': list(size)}
        grezzi[C.nome] = best[2] < 0.5
        neurali[C.nome] = best[2]

    return _analizza(D, os.path.basename(foto), rgb.shape, box, reg, ev, neur_id, forme, usa_sam, grezzi, neurali,
                     semi_info, tempi, larghezza_mm, photocad, passi, t0)


def rianalizza(D, larghezza_mm=10000, usa_sam=True, photocad=None, uscita=None):
    """Ripete misure, vettorizzazione e rapporto dalle immagini gia' generate in D (senza GPU).
    MobileSAM viene ricalcolato (stesso seme di esegui_confronto) se forme_sam.json manca."""
    t0 = time.time()
    with open(os.path.join(D, 'risultati.json')) as fh:
        vecchio = json.load(fh)['info']
    reg = cv2.cvtColor(cv2.imread(os.path.join(D, '01_regione.png')), cv2.COLOR_BGR2RGB)
    rh, rw = reg.shape[:2]
    ev = evidenza_foto(reg)
    neur_id = cv2.imread(os.path.join(D, '10_informative_drawings.png'), 0).astype(np.float32) / 255
    fs = os.path.join(D, 'forme_sam.json')
    tempi = {}
    if usa_sam and os.path.exists(fs):
        forme = json.load(open(fs))
    elif usa_sam:
        t = time.time()
        log('MobileSAM (CPU, qualche minuto)...')
        forme = mobilesam_forme(reg)
        tempi['mobilesam_s'] = round(time.time() - t, 1)
    else:
        forme = []
    O = uscita or D + '_rianalisi'
    os.makedirs(O, exist_ok=True)
    for f in os.listdir(D):
        if f.endswith('.png') and (f.startswith('0') or f.startswith('1') or f.startswith('2')) or f.startswith('00_'):
            shutil.copy(os.path.join(D, f), O)
    grezzi = {'Informative Drawings (attuale)': neur_id < 0.5}
    neurali = {'Fotovettore attuale': neur_id}
    semi_info = {}
    for chiave, C in CANDIDATI.items():
        files = sorted(f for f in os.listdir(D) if f.startswith('2%s_seme' % chiave))
        if not files:
            continue
        prove = []
        for f in files:
            neu = normalizza_disegno(cv2.imread(os.path.join(D, f), 0))
            m, _ = misura(neu < 0.5, reg, ev)
            s = int(f.split('seme')[1].split('.')[0])
            prove.append((punteggio(m), s, neu, m))
            log('  %s seme %d: completezza %.3f, precisione %.3f, inventate %.3f' % (
                C.nome, s, m['completezza_strutturale'], m['precisione_tratto'], m['linee_lunghe_inventate']))
        prove.sort(key=lambda p: -p[0])
        info = dict(vecchio.get('modelli', {}).get(C.nome, {}))
        info.update({'semi': [p[1] for p in prove], 'seme_scelto': prove[0][1], 'punteggi': [round(p[0], 3) for p in prove]})
        semi_info[C.nome] = info
        grezzi[C.nome] = prove[0][2] < 0.5
        neurali[C.nome] = prove[0][2]
    tempi['generazione_originale'] = vecchio.get('tempi', {})
    return _analizza(O, vecchio['foto'], None, vecchio['riquadro'], reg, ev, neur_id, forme, usa_sam, grezzi, neurali,
                     semi_info, tempi, larghezza_mm, photocad, vecchio.get('passi'), t0)


def _analizza(D, nome_foto, foto_shape, box, reg, ev, neur_id, forme, usa_sam, grezzi, neurali, semi_info, tempi,
              larghezza_mm, photocad, passi, t0):
    rh, rw = reg.shape[:2]
    gray8 = np.clip(grigio(reg), 0, 255).astype(np.uint8)
    with open(os.path.join(D, 'forme_sam.json'), 'w') as fh:
        json.dump(forme, fh)
    if photocad and foto_shape is not None:
        try:
            ext = carica_disegno_esterno(photocad)
            wv, info = allinea_esterno(ext, foto_shape, box, rw, rh, neur_id < 0.5, ev['r'])
            semi_info['PhotoCAD (file utente)'] = info
            if wv is not None:
                grezzi['PhotoCAD (file utente)'] = wv
        except Exception as e:
            semi_info['PhotoCAD (file utente)'] = {'errore': str(e)}

    # vettorizzazione con lo stesso motore CAD
    vettori = {}
    # Varianti: forme MobileSAM (come l'app) oppure celle chiuse del disegno stesso. La variante "senza forme"
    # e' stata tolta: il motore non chiude i contorni dalle sole linee (1-5 celle chiuse nella prova del 2/11/2026).
    for nm, neu in neurali.items():
        base = 'Fotovettore attuale' if nm == 'Fotovettore attuale' else nm + ' + SAM'
        varianti = [(base if usa_sam else nm + ' (solo linee)', forme)]
        varianti.append(((('Informative Drawings' if nm == 'Fotovettore attuale' else nm)) + ' + celle del disegno',
                         celle_come_forme(neu)))
        for etichetta, fm in varianti:
            t = time.time()
            r = motore(neu, gray8, fm)
            vettori[etichetta] = r['paths']
            sl = etichetta.replace(' ', '_').replace(',', '').replace('+', 'piu').replace('.', '')
            dxf = os.path.join(D, 'dxf_' + sl + '.dxf')
            scrivi_dxf(r['paths'], rw, rh, larghezza_mm, dxf)
            subprocess.run(['python3', os.path.join(SVILUPPO, 'strumenti', 'dxfrender.py'), dxf, dxf[:-4] + '_riletto.png'],
                           capture_output=True, text=True)
            tempi['motore_' + sl + '_s'] = round(time.time() - t, 1)

    # misure
    righe, regioni_di = [], {}
    for nm, ink in grezzi.items():
        m, rg = misura(ink, reg, ev)
        regioni_di[('grezzo', nm)] = rg
        righe.append(dict(tipo='disegno grezzo', metodo=nm, **m))
    for nm, paths in vettori.items():
        ink = rasterizza(paths, rw, rh) > 0
        m, rg = misura(ink, reg, ev)
        regioni_di[('vettoriale', nm)] = rg
        righe.append(dict(tipo='vettoriale (DXF)', metodo=nm, **m, **statistiche_percorsi(paths)))
    # riferimento di consenso: aperture e archi visti da almeno due disegni grezzi indipendenti
    fonti_ap = {nm: [q['box'] for q in regioni_di[('grezzo', nm)] if q['apertura'] or q['arco']] for nm in grezzi}
    fonti_ar = {nm: [q['box'] for q in regioni_di[('grezzo', nm)] if q['arco']] for nm in grezzi}
    rif_ap, rif_ar = consenso(fonti_ap), consenso(fonti_ar)
    for rr in righe:
        rg = regioni_di[('grezzo' if rr['tipo'] == 'disegno grezzo' else 'vettoriale', rr['metodo'])]
        ca = confronta([q['box'] for q in rg if q['apertura'] or q['arco']], rif_ap, ev['diag'])
        cr = confronta([q['box'] for q in rg if q['arco']], rif_ar, ev['diag'])
        rr.update({'aperture_' + k: v for k, v in ca.items()})
        rr.update({'archi_' + k: v for k, v in cr.items()})

    # immagini
    blocchi = []
    for nm, ink in grezzi.items():
        rg = regioni_di[('grezzo', nm)]
        bianco = np.where(ink[..., None], 0, 255).astype(np.uint8).repeat(3, 2)
        blocchi.append([_didascalia(bianco, nm + ' - grezzo'), _didascalia(sovrapponi(reg, ink, rg, rif_ap), 'sovrapposto alla foto')])
    salva(os.path.join(D, 'confronto_grezzi.jpg'), griglia(blocchi))
    blocchi = []
    for nm, paths in vettori.items():
        ink = rasterizza(paths, rw, rh) > 0
        rg = regioni_di[('vettoriale', nm)]
        blocchi.append([_didascalia(rasterizza(paths, rw, rh, colori=True), nm + ' - livelli'),
                        _didascalia(sovrapponi(reg, ink, rg, rif_ap), 'sovrapposto alla foto')])
    salva(os.path.join(D, 'confronto_vettoriali.jpg'), griglia(blocchi))

    tempi['totale_s'] = round(time.time() - t0, 1)
    info = {'foto': nome_foto, 'riquadro': box, 'regione_px': [rw, rh], 'forme_sam': len(forme),
            'riferimento_aperture': len(rif_ap), 'riferimento_archi': len(rif_ar), 'tempi': tempi,
            'modelli': semi_info, 'passi': passi, 'larghezza_mm': larghezza_mm}
    with open(os.path.join(D, 'risultati.json'), 'w') as fh:
        json.dump({'info': info, 'misure': righe}, fh, indent=1, default=str)
    chiavi = list(dict.fromkeys(k for r in righe for k in r))
    with open(os.path.join(D, 'misure.csv'), 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=chiavi)
        w.writeheader()
        w.writerows(righe)
    scrivi_rapporto(D, info, righe)
    log('Fatto in %.0f s. Risultati in %s' % (tempi['totale_s'], D))
    return D, info, righe


SPIEGAZIONI = [
    ('precisione_tratto', "quota del tratto che cade su un bordo reale della foto (alto = poche linee inventate)"),
    ('scarto_mediano_px', "distanza tipica tra tratto e bordo reale, in px a 900 px (basso = proporzioni fedeli)"),
    ('completezza_strutturale', "quota (pesata per lunghezza) delle linee rettilinee lunghe della foto ritrovate nel disegno"),
    ('linee_lunghe_inventate', "quota delle linee lunghe del disegno senza riscontro nella foto"),
    ('celle_chiuse', "contorni chiusi (conci, aperture, campiture); celle_rettangolari: quota quasi rettangolare"),
    ('aperture / archi', "celle con interno scuro nella foto / con profilo superiore circolare"),
    ('aperture_* / archi_*', "confronto col riferimento di consenso (elementi visti da almeno due disegni indipendenti): "
                            "richiamo, precisione, IoU, errore larghezza/altezza, spostamento in % della diagonale"),
]


def scrivi_rapporto(D, info, righe):
    import html
    col = ['tipo', 'metodo', 'precisione_tratto', 'scarto_mediano_px', 'completezza_strutturale', 'linee_lunghe_inventate',
           'celle_chiuse', 'celle_rettangolari', 'aperture', 'archi', 'aperture_richiamo', 'aperture_iou_medio',
           'aperture_errore_proporzioni_%', 'archi_richiamo', 'archi_iou_medio', 'polilinee', 'segmenti_ad_arco']
    t = ['<tr>' + ''.join('<th>%s</th>' % html.escape(c) for c in col) + '</tr>']
    for r in righe:
        t.append('<tr>' + ''.join('<td>%s</td>' % html.escape(str(r.get(c, ''))) for c in col) + '</tr>')
    sp = ''.join('<li><b>%s</b>: %s</li>' % (html.escape(a), html.escape(b)) for a, b in SPIEGAZIONI)
    doc = ('<!doctype html><meta charset="utf-8"><title>Confronto Fotovettore</title>'
           '<style>body{font:14px system-ui;margin:16px;color:#111;background:#fff}table{border-collapse:collapse}'
           'td,th{border:1px solid #ccc;padding:3px 6px;font-size:12px}img{max-width:100%%}</style>'
           '<h1>Confronto: %s</h1><p>Riquadro %s, regione %s px, forme SAM %d, riferimenti di consenso: %d aperture, %d archi.</p>'
           '<table>%s</table><h2>Come leggere le misure</h2><ul>%s</ul>'
           '<p>Le misure sono indicatori rispetto alla foto, non una verita\'. Un disegno gradevole non e\' per questo fedele: '
           'controlla sempre le sovrapposizioni.</p>'
           '<h2>Disegni grezzi</h2><img src="confronto_grezzi.jpg"><h2>Vettoriali (DXF)</h2><img src="confronto_vettoriali.jpg">'
           '<h2>Dettagli</h2><pre>%s</pre>') % (
        html.escape(info['foto']), info['riquadro'], info['regione_px'], info['forme_sam'], info['riferimento_aperture'],
        info['riferimento_archi'], ''.join(t), sp, html.escape(json.dumps(info, indent=1, default=str)))
    with open(os.path.join(D, 'rapporto.html'), 'w') as fh:
        fh.write(doc)
