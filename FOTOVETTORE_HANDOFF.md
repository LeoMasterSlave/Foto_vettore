# Fotovettore: documento di passaggio

Stato al 2 novembre 2026. Questo documento permette di riprendere il progetto in una nuova conversazione senza rispiegare nulla. Distingue sempre ciò che è stato **verificato** (eseguito e misurato) da ciò che è **ipotesi** o **non verificato**.

Repository: `https://github.com/LeoMastersSlave/Foto_vettore` (in alcune risposte di GitHub compare anche la grafia `LeoMasterSlave/foto_vettore`: GitHub ha segnalato che il repository è stato spostato su `LeoMastersSlave/Foto_vettore`). Nota del 2/11/2026, seconda sessione: `https://github.com/LeoMasterSlave/Foto_vettore` si apre senza reindirizzamenti e il clone/push funziona con `LeoMasterSlave/foto_vettore`; il notebook Colab usa quindi `LeoMasterSlave/Foto_vettore`. Lo spostamento su `LeoMastersSlave` non è stato confermato.
Sito GitHub Pages: `https://leomastersslave.github.io/Foto_vettore/` (versione pubblicata), `…/Foto_vettore/dev/` (versione di sviluppo), `…/Foto_vettore/prova-ai/` (pagina di prova dei modelli).

---

## 1. Obiettivo del progetto

Fotovettore è una web app gratuita che converte la **foto di un edificio** in un **disegno CAD vettoriale** (DXF, SVG, PDF). È ispirata a PhotoCAD (`https://photocad.ai/convert`), servizio a pagamento che produce disegni puliti e coerenti.

Requisiti fissati dall'utente (Leonardo, studente di architettura):

- qualità del disegno prima di tutto: contorni continui, conci, archi, bifore, cornici riconoscibili; gerarchia di linee come in un vero disegno CAD;
- gratuito, open source, eseguibile **in locale nel browser**; nessun abbonamento o API commerciale senza consenso esplicito;
- deve funzionare su **iPhone (Safari)** e su desktop;
- la scala reale non serve: l'utente raddrizza le foto (fotoraddrizzamento) e scala nel CAD;
- impostazioni avanzate nascoste, modalità automatica consigliata;
- flusso semplice: carico la foto → confermo l'edificio → converto → vedo il risultato → correggo → esporto DXF;
- non riscrivere da zero, non compromettere la versione pubblicata; sviluppo in una versione separata;
- non dichiarare test non eseguiti, non inventare capacità o geometrie.

Traguardo rispetto a PhotoCAD: avvicinarsi alla sua pulizia (ogni concio come contorno chiuso, archi e aperture completi, poco rumore) restando gratuiti e locali.

---

## 2. Stato attuale in breve

| Versione | Dove | Cosa fa | Stato |
|---|---|---|---|
| Pubblicata (v3, classica) | `index.html` | Metodo geometrico senza AI (Canny + bordi multi-scala, livelli STRUTTURA/ELEMENTI/CONCI, DXF R12 con layer) | Online, invariata. Qualità giudicata dall'utente "mediocre e inutilizzabile" sulle murature. |
| Pagina di prova AI | `prova-ai/index.html` | Esegue i due modelli AI e mostra i risultati grezzi (nessun DXF) | **Verificata dall'utente su iPhone** (tempi nella sezione 8). |
| Sviluppo (v4) | `dev/index.html` | App completa: AI integrata (modalità Dettagliata, Rapida, Classica), nuova interfaccia, correzione, DXF a 4 livelli | Pubblicata il 2/11/2026. **Testata solo in Chromium automatico**; non ancora provata dall'utente su iPhone. |
| Sorgenti e strumenti | `sviluppo/` | Sorgenti separati di `dev/index.html`, script di build e di test | Aggiunti il 2/11/2026. |
| Banco di prova dei modelli generativi | `sviluppo/colab/` | Notebook Google Colab: confronta Fotovettore attuale, SDXL + ControlNet Union, SD 1.5 + ControlNet Lineart e PhotoCAD (file dell'utente) con misure geometriche e DXF dallo stesso motore | Aggiunto il 2/11/2026 (sezione 15). **Mai eseguito su Colab né con i modelli generativi**: verificate qui solo le parti senza GPU. |

Prossimi passi attesi: (a) l'utente esegue il notebook Colab sulle due foto di riferimento e manda `risultati_fotovettore.zip` (sezione 15); (b) apre `…/Foto_vettore/dev/` su iPhone e manda la riga "Prestazioni" che si trova in "Impostazioni avanzate".

---

## 3. Organizzazione del repository

```
index.html                 versione pubblicata (v3 classica) - NON MODIFICARE senza accordo
README.md, LICENSE         README del progetto, licenza MIT (autore indicato: Leonardo)
prova-ai/
  index.html               pagina di prova dei modelli (ONNX Runtime Web da jsDelivr)
  README.md                crediti e licenze dei modelli
  modelli/                 pesi ONNX usati anche da dev/ (circa 60 MB in totale)
    contour_style_512x512.onnx   Informative Drawings, stile "contour" (17,1 MB)
    mobilesam-encoder.onnx       MobileSAM encoder (26,7 MB)
    mobilesam-decoder.onnx       MobileSAM decoder (15,7 MB)
dev/
  index.html               versione di sviluppo ASSEMBLATA (non modificare a mano: si rigenera)
sviluppo/
  build.py                 assembla dev/index.html dai sorgenti
  src/engine.js            motore geometrico: metodo classico + vettorizzazione AI + riquadro automatico
  src/ai_worker.js         motore AI: Informative Drawings + MobileSAM (Web Worker)
  src/main.js              interfaccia, disegno su canvas, gesti, flusso, esportazioni
  src/style.css            stile (token chiaro/scuro, layout iPhone/desktop)
  src/body.html            markup dell'interfaccia
  strumenti/               script di test e misura (sezione 11)
  colab/                   banco di prova dei modelli generativi (sezione 15); non fa parte dell'app
    Fotovettore_confronto_modelli.ipynb   notebook Colab (GENERATO: non modificare a mano)
    crea_notebook.py       genera il notebook
    fv_banco.py            logica: modelli, motore, misure, DXF, rapporto
    motore.js              ponte Node verso src/engine.js (senza modificarlo)
    README.md              istruzioni e limiti
  .gitignore               esclude strumenti/dati/ e .check.js
FOTOVETTORE_HANDOFF.md     questo documento
```

`dev/` carica i modelli da `../prova-ai/modelli/`. Se si sposta la cartella dei modelli, cambiare `MODEL_BASE` in `sviluppo/src/main.js` (oppure usare il parametro `?models=` nell'indirizzo).

---

## 4. Architettura del codice (versione di sviluppo)

`dev/index.html` è un solo file HTML. `sviluppo/build.py` concatena, dentro un'unica funzione autoeseguita: `engine.js` (definisce `makeEngine`), `ai_worker.js` (definisce `makeAI`), `main.js` (interfaccia). CSS e markup sono inseriti nella pagina. Nessuna libreria esterna tranne ONNX Runtime Web, caricato da jsDelivr solo quando serve l'AI.

### 4.1 Tre processi

1. **Thread principale** (`main.js`): interfaccia, canvas, gesti, esportazioni. Non esegue calcoli pesanti.
2. **Worker geometrico**: creato da `makeEngine.toString()` in un Blob. Messaggi: `img` (immagine in grigio), `run` (metodo classico o vettorizzazione AI), `detect` (riquadro automatico). Se il worker non parte, `Eng` ripiega su `makeEngine()` nel thread principale.
3. **Worker AI**: creato da `makeAI.toString()` + `importScripts(ort.min.js)`. Messaggi in ingresso: `ping`, `run {id, rgba, W, H, detail, base}`, `cancel`, `free`. Uscita: `prog`, `neural`, `polys`, `done`, `cancelled`, `error`. Ripieghi: se `importScripts` fallisce o il ping non risponde entro 25 s, oppure se la creazione della sessione ONNX fallisce dentro il worker (`error` con `init: true`), l'app carica ONNX Runtime nel thread principale e riesegue (`AIW.toMain()`).

### 4.2 File e funzioni principali

`sviluppo/src/engine.js` (1451 righe)
- Metodo classico (eredità v1–v3): `gaussBlur`, `canny`, `traceChains`, `bridge`, `smoothPts`, `arcFit`, `fitChain` (linee e archi), `mergeLines`, `straighten`, `weld`, `tSnap`, `buildPaths`, `runOld` (modi Contorni/Sagoma), `runArch` (modo Architettura multi-scala con `subjectMask`, `openAxis`, `extendToMeet`).
- Vettorizzazione AI: `thinZS` (scheletro Zhang-Suen), `pruneSpurs`, `dropSmallComp`, `traceSkeleton` (grafo dello scheletro), `circleFit` (Kåsa), `regShape` (riconosce cerchio, arco, rettangolo, poligono), `loopPath`, `bridgeFree`, `runAI`.
- `detect()`: riquadro automatico dell'edificio.
- Formato dei percorsi: `{c: 0|1 chiuso, v: [x,y,…], b: [bulge per segmento], l: livello 0..3}`. Bulge > 0 = arco visivamente antiorario nelle coordinate immagine (y in giù); nel DXF le y sono ribaltate e il bulge resta con lo stesso segno (verificato rileggendo il DXF, sezione 8.4).

`sviluppo/src/ai_worker.js` (237 righe): `loadModel` (fetch con avanzamento e Cache Storage `fotovettore-modelli-v1`), `session`, `sampleTile` (ricampionamento bilineare in JS, senza OffscreenCanvas), `neuralMap`, `cellPrompts`, `traceMask` (contorno di Moore sulla maschera 256×256), `segment`, `run`.

`sviluppo/src/main.js` (843 righe): stato `S`, `Eng`, `AIW`, `loadFile`/`setSource`, `makeSample`, `convert`, `onAI`, `vectorize`, `runClassic`, `cancelRun`, `rebuild` (Path2D per livello e indice di selezione), `draw`, `moved` (trasformazione CSS durante i gesti), `fitView`/`springTo`/`momentum`/`zoomAt`, gestione puntatori (trascina, pizzica, doppio tocco, rotella, pinch del trackpad Safari), modifica (`setEdit`, `delSel`, `cycleLayer`, `undo`), foglio inferiore (`sheetLayout`, `setSheetY` con molla), `renderStep`, `renderLayers`, esportazioni (`buildSVG`, `buildDXF`, `buildPDF`, `saveFile`), scorciatoie da tastiera. Per i test espone `window.__fv`.

---

## 5. Modelli AI

| Modello | Uso | Licenza | Provenienza dei pesi | Formato | Dimensione | SHA-256 |
|---|---|---|---|---|---|---|
| Informative Drawings, stile "contour" (Chan, Durand, Isola) | Disegno a linee dalla foto | MIT (progetto originale `carolineec/informative-drawings`; conversione ONNX MIT di Kazuhito Takahashi) | `github.com/Kazuhito00/Informative-Drawings-ONNX-Sample`, file `model/contour_style_512x512.onnx` (clonato da GitHub) | ONNX, ingresso fisso 1×3×512×512 float 0–255 RGB, uscita 1×1×512×512 in 0–1 (1 = bianco); nomi `input_image` → `output_image` | 17,1 MB | `c3385588…953e` |
| MobileSAM encoder | Embedding immagine per la segmentazione | Apache-2.0 (MobileSAM, `ChaoningZhang/MobileSAM`) | Release GitHub `palavido-dev/gratis-gis` tag `models-mobilesam-v1` (hash confrontati con `SHA256SUMS.txt` della release) | ONNX, ingresso 1×3×1024×1024 normalizzato (media 123.675/116.28/103.53, dev. std. 58.395/57.12/57.375), uscita 1×256×64×64 | 26,7 MB | `d02f3fe0…6cdf` |
| MobileSAM decoder | Maschera da un punto di prompt | Apache-2.0 | Stessa release | Ingressi: `image_embeddings`, `point_coords` [1,N,2] in coordinate 1024, `point_labels`, `mask_input` 1×1×256×256, `has_mask_input`, `orig_im_size`; uscite `masks`, `iou_predictions`, `low_res_masks` (256×256) | 15,7 MB | `b748cd34…30a5` |

Note:
- La licenza MIT dei pesi originali di Informative Drawings è riportata dalle pagine consultate (webai.show e repository di esempio). Il repository originale non è stato aperto direttamente perché non era raggiungibile dall'ambiente di lavoro.
- Il repository contiene anche gli stili `opensketch` e `anime`, provati e scartati: tratto più morbido e sfumato, meno adatto al CAD.
- Esecuzione: ONNX Runtime Web 1.21.0 da `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.min.js`, backend WASM, `numThreads = 1`. GitHub Pages non permette di impostare le intestazioni COOP/COEP, quindi niente multithreading.
- Funziona solo da GitHub Pages o da un server: l'artifact dentro Claude non può scaricare i modelli. La prima esecuzione richiede internet (CDN e modelli); i modelli restano poi nella Cache Storage del browser.

---

## 6. Pipeline completa dalla foto al DXF (versione dev)

1. **Caricamento** (`setSource`): l'immagine viene copiata su un canvas sorgente con lato lungo massimo 2400 px (per l'AI) e su un'immagine di lavoro con lato lungo massimo 1600 px (per la vista e per il metodo classico). Si calcola il grigio Float32 e lo si invia al worker geometrico.
2. **Riquadro automatico** (`detect`): sobel sul grigio sfocato; si tengono i pixel con gradiente sopra l'80° percentile; i bordi sono classificati verticali o orizzontali (rapporto > 2); si contano solo le **corse lunghe** (≥ circa lato/110 px) in celle 16×16; si sfoca, si soglia al 28% del massimo e si prende la componente più forte; poi si affina con i profili di colonne e righe (soglia 30%) e si aggiunge un margine del 2,5%. L'utente corregge il riquadro trascinando angoli e lati.
3. **Regione di lavoro** (`convert`): il riquadro viene ritagliato dal canvas sorgente e portato a lato lungo 900 px (700/900/1200 nelle impostazioni avanzate; ingrandimento massimo ×2). Si ricava il grigio della regione (per classificare le aperture).
4. **Disegno neurale** (`neuralMap`): riquadri di T = 360 px con passo 0,7·T, ricampionati a 512, modello "contour", uscita riportata a T×T e fusa con finestra di Hann. Risultato: mappa in cui 0 = linea e 1 = bianco.
5. **Anteprima progressiva**: appena c'è il disegno neurale, il worker geometrico produce un primo DXF solo neurale (mostrato in modalità Dettagliata mentre continua la segmentazione; in modalità Rapida è il risultato finale).
6. **Segmentazione** (`segment`, solo modalità Dettagliata):
   - punti di prompt: centri delle celle chiuse del disegno neurale (`cellPrompts`, trasformata di distanza e punto più interno di ogni cella) più una griglia di 14×14 punti per riquadro (12×12 nel passaggio largo);
   - **passaggio largo**: tutta la regione come un unico riquadro (cattura portali e aperture grandi);
   - **riquadri fini**: T = 360 px con passo 0,75·T;
   - un punto viene saltato se è già coperto da una forma accettata, se è vicino a un punto già provato o se cade su una linea del disegno neurale;
   - una maschera viene accettata se ha IoU stimata ≥ 0,75, area entro i limiti, non tocca i bordi del riquadro e non è coperta oltre il 60% da forme già trovate;
   - il contorno della maschera 256×256 diventa un poligono in coordinate di regione.
7. **Vettorizzazione AI** (`runAI` nel worker geometrico):
   - Forme: `regShape` riconosce **cerchi** (riempimento 0,72–0,84, errore radiale basso), **aperture ad arco** a tutto sesto o ribassate (profilo stretto in alto, cerchio sulla parte superiore con raggio compatibile), **rettangoli** (riempimento > 0,84, lati dalla mediana dei punti) oppure **poligoni** (linee e archi con `fitChain`, raddrizzati entro 8°). La tolleranza cresce con la risoluzione della maschera. La forma regolare viene accettata solo se la deviazione al 90° percentile resta entro `max(3·tol, 5% del lato minore)`.
   - Livelli delle forme: ELEMENTI se arco, cerchio, molto grande (≥ 5 volte la mediana oppure ≥ 1,2% della regione) o apertura (interno più scuro del 45% rispetto alla mediana); altrimenti DETTAGLI. Le forme regolarizzate con deviazione vicina al limite vanno in **RICOSTRUZIONI** (tratteggiato: "stimato").
   - Linee neurali: soglia (sensibilità regolabile, predefinita 0,5); chiusura morfologica; riempimento delle celle minuscole (< 200 px a 900 px, cioè la grana della pietra); scheletro Zhang-Suen; potatura dei rami corti; eliminazione delle componenti piccole; grafo dello scheletro; catene lunghe quasi diritte → una linea sola; altrimenti `fitChain`; si scartano le linee dentro le forme (interno eroso) e quelle già descritte dai contorni delle forme; unione delle collineari (con distanza maggiore per orizzontali e verticali); raddrizzamento entro 4°.
   - Livelli delle linee: STRUTTURA se la lunghezza è ≥ max(80 px, 16% del lato minore); altrimenti DETTAGLI. I tratti aperti di DETTAGLI sotto 24 px vengono scartati (rumore). Solo le linee di STRUTTURA possono essere prolungate fino a una linea vicina, e i tratti aggiunti finiscono in RICOSTRUZIONI.
   - Le saldature dei vertici usano `weld`/`tSnap`/`buildPaths` del metodo classico. Le coordinate tornano a quelle dell'immagine.
8. **Esportazione**: si usa la scala "Larghezza reale" (mm) della zona convertita (predefinita 10 000 mm).
   - **DXF R12**: `$INSUNITS` = 4 (mm); tabella LTYPE CONTINUOUS e DASHED; layer STRUTTURA (colore 7), ELEMENTI (5), DETTAGLI (8), RICOSTRUZIONI (30, DASHED); entità LINE per i tratti singoli e POLYLINE/VERTEX con bulge per catene e archi; y ribaltata.
   - **SVG**: un gruppo per livello, spessori 0,5/0,35/0,18/0,25 mm, tratteggio per le ricostruzioni.
   - **PDF**: curve di Bézier per gli archi, pagina limitata a circa 1180 pt.
   - Si esportano solo i livelli visibili.
9. **Correzione**: modalità Modifica: tocca una linea per selezionarla; puoi eliminarla, spostarla al livello successivo o annullare; su desktop funzionano Canc/Backspace e ⌘Z.

Modalità **Classica**: `runArch`/`runOld` sull'intera immagine, con i cursori delle impostazioni avanzate applicati dal vivo.

---

## 7. Interfaccia (versione dev)

Progettata seguendo la skill MIT di Emil Kowalski `apple-design` (gesti 1:1, molle senza rimbalzi, inerzia, trasparenze solo sulle barre fluttuanti, opzioni per movimento e trasparenza ridotti). La skill di dickwu `apple-design-skill` è stata usata solo come lista di controllo (contiene testo delle Apple HIG senza file di licenza, quindi non è stata installata). All'utente è stata proposta una versione ridotta della skill di Emil come "apple-fluid-web-design".

- **iPhone (< 900 px)**: barra superiore (Apri, Esporta); canvas a tutto schermo; in alto il selettore Disegno/Foto/Insieme; a destra i pulsanti tondi Adatta, +, −, Modifica; pannello come foglio in basso con due posizioni (maniglia trascinabile con proiezione della velocità).
- **Desktop (≥ 900 px)**: barra laterale di 360 px con le stesse sezioni.
- Schede del pannello: passo corrente (Inizia, Inquadra l'edificio con scelta della modalità, Conversione in corso con avanzamento, tempo stimato e "Interrompi", Disegno pronto con riepilogo ed "Esporta DXF"); Livelli (interruttori e conteggi); Esporta (larghezza reale, DXF/SVG/PDF, copia del DXF, statistiche); Impostazioni avanzate (risoluzione AI, sensibilità delle linee con rivettorizzazione immediata senza rieseguire i modelli, parametri del metodo classico, riga "Prestazioni").
- Disegno: un canvas; Path2D per livello costruiti una volta per risultato; griglia che segue lo zoom; durante i gesti si sposta la bitmap già disegnata con `transform` CSS e il ridisegno nitido avviene 140 ms dopo; risoluzione del canvas limitata (dpr ≤ 2 e ≤ 4,2 Mpx).
- Tema chiaro e scuro, tastiera (⌘O, ⌘Z, ⌘E, F, M, +, −, Esc, Invio), trascina e rilascia, incolla.

---

## 8. Test e risultati

### 8.1 Foto di riferimento

- **Palazzo** (foto dell'utente, facciata in conci con portali ad arco, arcatelle e bifora; copia di lavoro 1200×1600). Riquadro della facciata usato nei test: (165, 260)–(1070, 1110).
- **Lisbona** (foto inviata dall'utente, palazzo intonacato con finestre, balconi e porta ad arco; 800×1000). Riquadro: (40, 175)–(765, 865).
- Le foto **non sono nel repository**: vanno richieste all'utente o sostituite.

### 8.2 Su iPhone (verificato dall'utente, pagina `prova-ai/`, Safari iOS 18.7, ONNX Runtime 1.21.0, nel thread principale)

| Prova | Disegno neurale | Segmentazione |
|---|---|---|
| Palazzo, regione 900×858 / 900×894 | 47,6 s (12 riquadri) | 231 s, 146 forme, 1668 decodifiche, 124 ms per punto |
| Palazzo, immagine intera 675×900 | 106,6 s | 291 s, **86 forme** (troppo poche: facciata piccola nell'immagine) |
| Palazzo, solo facciata 900×804 | 56,9 s | 269 s, **211 forme** |
| Lisbona 748×701 | 42,8 s (9 riquadri) | 238,5 s, 127 forme |

Conclusione verificata: lavorare **solo sulla facciata** è essenziale (211 forme contro 86). Su iPhone una conversione Dettagliata richiede circa 5 minuti. Non ci sono stati blocchi, salvo una seconda esecuzione più lenta, con causa non determinata.

### 8.3 Versione dev (verificato in Chromium headless con Playwright)

Ambiente: container Linux con 2 core. ONNX Runtime Web non si poteva scaricare (CDN bloccata), quindi `strumenti/mock_ort.js` sostituisce `ort` con un ponte verso `strumenti/server.py`, che esegue **gli stessi file ONNX** con onnxruntime Python. Logica dell'app, worker, tasselli e vettorizzazione sono quindi quelli reali; i tempi **non** rappresentano Safari.

| Prova | Risultato |
|---|---|
| Palazzo, Dettagliata, riquadro manuale, 390×844 | 127 s in tutto; disegno neurale 17 s; forme 1 min 44 s (882 decodifiche); vettorizzazione circa 1 s; 210 forme; attività lunghe sul thread principale: 2, massimo 109 ms |
| Palazzo, Dettagliata, riquadro automatico (120, 280, 1096, 1160), 1440×900 | 127 s; 952 decodifiche; 179 forme (12 archi, 142 rettangoli, 5 cerchi, 20 poligoni); attività lunghe: 2, massimo 86 ms |
| Lisbona, Dettagliata, riquadro automatico, 1440×900 | 174 s; 1415 decodifiche; 109 forme; nessuna attività lunga |
| Prompt dalle celle neurali contro griglia sola (stessa foto) | 882–952 decodifiche contro 1572 della griglia fitta |
| Fluidità di pan e zoom con CPU rallentata 4× (CDP) | dev **60 fps**, p95 17 ms, su 390 e 1440 px. Prima dell'ottimizzazione con trasformazione CSS e canvas limitato: 18 fps e p95 117 ms a 1440 px. La v3 pubblicata misurata allo stesso modo: 60 fps (in Chrome; il lag su iPhone segnalato dall'utente non si riproduce in Chromium) |
| Pizzico (CDP touch) | Corretto dopo una correzione: le coordinate vanno lette dal contenitore, non dal canvas trasformato |
| Annulla durante la conversione, rilancio, errore senza ONNX Runtime, metodo classico dal vivo, tema scuro, modifica ed elimina/annulla | Tutti verificati, nessun errore JavaScript |
| Memoria JS (Chrome `performance.memory`) | 10–14 MB di heap principale dopo una conversione; i worker non sono misurati |

### 8.4 DXF

- Il DXF esportato è stato riletto con `strumenti/dxfrender.py`, un lettore indipendente che interpreta il bulge come un CAD. Verificati: tabelle LTYPE e LAYER; 4 layer con colori; LINE e POLYLINE chiuse; archi curvati nel verso giusto (portali e archetti in alto).
- **Non verificato**: apertura in AutoCAD o in un altro CAD reale; il pacchetto `ezdxf` non era installabile nell'ambiente.

### 8.5 Qualità: cosa funziona e cosa no (osservato sulle due foto)

Funziona:
- conci come rettangoli chiusi;
- portali, finestre ad arco, arcatelle e bifora come archi veri;
- cerchi;
- sul palazzo di Lisbona: finestre, porta ad arco, fasce marcapiano (STRUTTURA), balconi.

Problemi aperti:
- contorno esterno dell'edificio quasi assente in STRUTTURA (palazzo: 1–2 linee);
- frammenti neurali residui nelle zone non segmentate;
- alcuni conci piccoli presi per archi (falsi positivi);
- ringhiere e balconi come poligoni irregolari;
- la modalità Rapida è rumorosa;
- il riquadro automatico è approssimativo (sul palazzo include parte del terreno; su Lisbona arriva fino al bordo destro);
- alberi e terreno non vengono disegnati (PhotoCAD invece li disegna).

### 8.6 Non verificato

- La versione dev su iPhone reale: in particolare ONNX Runtime **dentro un Web Worker** su Safari iOS. C'è un ripiego automatico nel thread principale, ma anche il ripiego non è testato su iOS.
- I tempi della versione dev su iPhone.
- Il comportamento con la memoria su iPhone con modelli caricati in un worker.
- L'apertura dei DXF in AutoCAD.

---

## 9. PhotoCAD: cosa sappiamo e come lo sappiamo

### 9.1 REA (Reverse Engineer Anything)

- Repository `github.com/morluto/rea`, licenza MIT, versione 6.8.0 (commit `93b8b82`). È un server MCP e una CLI per il reverse engineering di binari, app JavaScript/Electron, APK e siti web.
- Per i siti si collega via CDP a un browser Chrome dell'utente: DOM, script, risorse, metadati di rete, analisi dei bundle (`inspect_web_page`, `analyze_web_bundle`, `observe_web_session`).
- Requisiti: Node 22.23.4+ o 24.22.1+, npm, installazione tramite `install.sh` o npm, browser Chrome.
- **Non è stato installato né usato**, per due motivi:
  1. **Termini di servizio di PhotoCAD**, sezione 4: vietano di "Attempt to copy, reverse-engineer or extract the technology behind the service" e di usare strumenti automatici per conversioni in massa senza autorizzazione. Anche il DISCLAIMER di REA richiede di avere l'autorizzazione e di rispettare i termini del servizio analizzato.
  2. **Ambiente**: npm e la rete verso photocad.ai non erano raggiungibili dal container.
- Le informazioni qui sotto vengono quindi solo dalle **pagine pubbliche** di PhotoCAD (lette con WebFetch) e dal video registrato dall'utente.

### 9.2 Fatti verificati (citazioni dalle pagine pubbliche)

- **Elaborazione lato server.** Privacy: "Images you upload are sent to our AI processing pipeline to generate vector conversions"; infrastruttura negli Stati Uniti; fornitori citati: Supabase, Stripe, Vercel e "the cloud AI infrastructure our conversion pipeline runs on". I modelli e il fornitore AI non sono nominati. "We do not use your uploaded images to train AI models."
- **Disegno generativo.** Documentazione API (`photocad.ai/api`): "PhotoCAD's AI raster-to-vector engine … this is generative drawing, not millisecond inference."
- **Riprove automatiche di qualità.** "automatic quality retries or very detailed images can take up to about two minutes"; tempo tipico di circa un minuto; API asincrona con polling.
- **Termini.** "Because the AI processes similar inputs in similar ways, similar uploads may produce similar outputs for different users."
- **Ingresso.** Ridimensionamento a 2400 px sul lato lungo. Formati: JPEG, PNG, WebP, AVIF, TIFF, GIF, HEIC, SVG, PDF.
- **Opzioni.**
  - `detailed` (predefinito true): "Maximum detail. Set false for a simplified drawing."
  - `remove_background`: "Isolates the subject before conversion."
- **Uscite.**
  - DXF in versione R2000 (predefinita) o R12; DWG; SVG; PDF; anteprima.
  - JSON "geometry": percorsi come **liste di punti** con flag `closed`, in mm, asse y in su, organizzati in **layer**. La documentazione non nomina archi né Bézier.
  - I nomi dei layer hanno un prefisso; esempio dalla documentazione: `ACME_BEAGLE_PROFILE`.
  - DXF e DWG usano linea "hairline" ("so CAM software reads paths as centerlines").
  - Scala predefinita: 300 mm sul lato lungo più 5 mm di margine.
- **Prezzo.** 1 credito per conversione, 2 $ a credito dopo i crediti gratuiti.

### 9.3 Osservazioni dal video dell'utente (fatti visivi)

- Durante l'attesa l'interfaccia mostra un'animazione a puntini con le scritte "Refining linework" e "Final checks", e gli interruttori "Remove bg" e "Max detail".
- Il risultato ha ogni concio come contorno chiuso, uno spessore di linea uniforme, archi e arcatelle completi anche nelle zone in ombra, alberi disegnati come contorni e il terreno come tratti sparsi.

### 9.4 Ipotesi (non verificate)

- Il cuore è probabilmente un **modello generativo di disegno** (un modello immagine-a-immagine, per esempio della famiglia diffusione) che ridisegna la foto come line art pulita, seguito da una vettorizzazione in polilinee e da controlli automatici con eventuale rigenerazione. Lo suggeriscono "generative drawing", le "quality retries", "similar outputs" e il tempo di circa un minuto su GPU cloud.
- I layer per parti (per esempio "PROFILE") fanno pensare a una scomposizione semantica, ad esempio un contorno del soggetto separato dai dettagli. Il metodo non è noto.
- "remove_background" fa pensare a una segmentazione del soggetto prima del disegno.

### 9.5 Sconosciuto

Quale modello usano, se usano segmentazione o profondità, l'algoritmo di vettorizzazione, i criteri dei controlli di qualità, l'hardware e i nomi completi dei layer.

### 9.6 Risposta alla domanda principale

Perché PhotoCAD produce un disegno più coerente:

1. **Ridisegna, non rileva.** Un modello generativo grande, su GPU nel cloud, produce direttamente una line art "come la farebbe un disegnatore", già chiusa e senza grana. Fotovettore combina un modello piccolo (Informative Drawings, 17 MB) con una segmentazione (MobileSAM) e poi deve ricostruire geometria e pulizia con regole.
2. **Calcolo e risoluzione.** PhotoCAD lavora su 2400 px su server. Fotovettore lavora su 900 px su un telefono, con un solo thread WASM.
3. **Riprove di qualità.** PhotoCAD rigenera se il risultato non supera i controlli; Fotovettore fa un solo passaggio.
4. **Uniformità.** La line art generata ha già un solo spessore e linee pulite; i nostri contorni nascono da maschere quantizzate (256×256 per riquadro) e da uno scheletro.

Dove Fotovettore è già diverso o migliore per l'uso CAD:
- archi veri (bulge) invece di soli punti;
- livelli semantici (STRUTTURA/ELEMENTI/DETTAGLI/RICOSTRUZIONI) con le geometrie stimate separate;
- tutto locale e gratuito.

### 9.7 Miglioramenti applicabili, dedotti dal confronto

- Riprove di qualità automatiche: misurare copertura della facciata, quota di forme irregolari e frammenti; se il risultato è scarso, rieseguire a risoluzione maggiore o con altra soglia.
- Risoluzione più alta su desktop (1200–1600 px) e backend WebGPU dove disponibile.
- Opzione "rimuovi sfondo": maschera dell'edificio con MobileSAM (prompt al centro del riquadro) per scartare terreno e alberi.
- Un livello "contorno" (PROFILE) dal bordo dell'unione delle forme e delle linee strutturali, distinto in RICOSTRUZIONI dove è stimato.
- Valutare un modello generativo di line art più forte solo come opzione desktop o "computer di casa", senza servizi a pagamento.
- Benchmark consentito: l'utente può scaricare le **proprie** conversioni PhotoCAD (DXF/SVG) e confrontarne struttura e densità con le nostre. Non serve analizzare il loro codice.

---

## 10. Decisioni tecniche, tentativi falliti e motivi

1. **v1–v3 classiche (solo geometria, nessuna AI)**: Canny, multi-scala, maschera del soggetto, gerarchia, archi. Risultato giudicato mediocre sulla foto reale: i bordi non distinguono un giunto da un'ombra o dalla grana. Il metodo resta nella modalità "Classica".
2. **Scelta dei modelli**:
   - **PiDiNet e TEED**: pesi scaricabili via git, ma serve PyTorch, non installabile (PyPI bloccato); non testati.
   - **DexiNed, Stable Diffusion + ControlNet lineart, FacadeLineNet**: non testati (pesi su Hugging Face bloccato; SD troppo pesante per iPhone; FacadeLineNet segmenta disegni, non foto).
   - **Informative Drawings "contour"**: scelto perché disegna i conci come contorni chiusi.
   - **MobileSAM**: segmenta quasi ogni concio quando si lavora a riquadri.
3. **MobileSAM a riquadri**: a immagine intera trovava poche forme (83 su 1600 punti); a riquadri di 360 px ingranditi a 1024 ne trova circa 250.
4. **Prompt dalle celle neurali**: riducono le decodifiche di circa il 40% rispetto alla griglia fitta.
5. **Passaggio largo**: aggiunto perché i portali più grandi di un riquadro venivano scartati (toccavano il bordo).
6. **Regolarizzazione**:
   - gli archi si cercano prima dei rettangoli, perché una finestra alta ad arco ha un riempimento > 0,84;
   - il criterio dell'arco usa il profilo stretto in alto, perché gli angoli arrotondati delle maschere generavano falsi archi;
   - la tolleranza è relativa alla risoluzione della maschera, perché i portali del passaggio largo finivano tutti tra le ricostruzioni.
7. **Niente ponti stimati sui dettagli**: generavano trattini rossi ovunque e l'utente non vuole geometrie inventate.
8. **Canvas al posto di SVG**: con SVG a `non-scaling-stroke` e molte linee il ridisegno durante zoom e spostamento era costoso; ora durante il gesto si sposta la bitmap già disegnata.
9. **Due worker** (geometrico e AI): il thread principale resta libero, con attività lunghe ≤ 0,11 s durante la conversione.
10. **Non usato**: REA (sezione 9.1); `gh api` (bloccato dal proxy); siti `github.io` non raggiungibili dal container (l'utente verifica dal telefono).

---

## 11. Come eseguire, testare e pubblicare

### 11.1 Modificare e assemblare

```
# modificare i file in sviluppo/src/, poi:
python3 sviluppo/build.py            # rigenera dev/index.html
node --check sviluppo/.check.js      # controllo di sintassi dello script assemblato
```

### 11.2 Provare in locale (senza CDN)

```
python3 sviluppo/build.py
PORT=8765 sviluppo/strumenti/avvia_test.sh &     # prepara strumenti/sito/ e avvia il server (circa 10 s per caricare i modelli)
# pagina: http://127.0.0.1:8765/dev/index.html?ort=/mock_ort.js
FOTO=/percorso/foto.jpg BASE=http://127.0.0.1:8765 node sviluppo/strumenti/smoke.js   # prova rapida con l'esempio integrato
```

Verificato il 2/11/2026: `smoke.js` contro questo allestimento → 158 percorsi su 390 e 1440 px, nessun errore.

`server.py` serve i file statici e l'endpoint `POST /run?m=id|enc|dec`, che esegue i modelli in Python. `mock_ort.js` imita `ort.InferenceSession`/`ort.Tensor` e funziona anche nel worker. Richiede `onnxruntime`, `numpy` e `playwright` (Python o Node).

Parametri dell'indirizzo: `?ort=<url di ort.min.js>` e `?models=<cartella dei modelli>`.

### 11.3 Script in `sviluppo/strumenti/`

| Script | Uso |
|---|---|
| `pre.py <foto> x0 y0 x1 y1 <nome>` | Calcola disegno neurale, forme e grigio in `dati/` con la stessa logica del worker (circa 2–3 min su 2 core) |
| `run_ai.js <nome>` | Esegue solo la vettorizzazione di `src/engine.js` sui dati salvati (3–5 s), per iterare sulle regole |
| `render.py <nome> white\|over` | Disegna i percorsi in PNG (nero struttura, blu elementi, grigio dettagli, rosso ricostruzioni) |
| `dxfrender.py <file.dxf> <out.png>` | Rilegge un DXF come un CAD e lo disegna; stampa layer, LTYPE e conteggi |
| `e2e.js <foto> <x0,y0,x1,y1\|auto> <detail\|fast\|classic> <w> <h> <prefisso>` | Prova completa nel browser (Playwright), con screenshot, DXF, tempi e attività lunghe |
| `perf.js` | Fluidità di pan e zoom con CPU 4× più lenta (variabile `FOTO`; usa `/old/index.html` per il confronto) |
| `ui.js`, `fb.js`, `smoke.js` | Foglio, modifica, pizzico, tema scuro, ripieghi, annulla, esempio integrato (variabili `FOTO`/`FOTO2`) |

### 11.4 Pubblicare

1. Lavorare sempre in `sviluppo/src`, assemblare con `python3 sviluppo/build.py` e fare commit di `dev/index.html` insieme ai sorgenti.
2. GitHub Pages pubblica dal branch `main` (radice); servono 1–2 minuti.
3. **Non toccare `index.html`** finché l'utente non approva il passaggio della versione dev a quella principale. Al momento del passaggio: copiare `dev/index.html` in `index.html` e cambiare `MODEL_BASE` da `../prova-ai/modelli/` a `prova-ai/modelli/` (oppure spostare i modelli).
4. Caricamento via sito di GitHub: limite di 25 MB per file (l'encoder pesa 28 MB). Per questo i modelli sono stati caricati con git dall'ambiente di Claude.

---

## 12. Accessi e strumenti necessari

- **GitHub**: dal container di Claude, `git clone` e `git push` funzionano tramite il proxy (repository collegato con `add_repo` in scrittura, owner `LeoMasterSlave`/`LeoMastersSlave`). L'API `gh` è bloccata e i siti `github.io` non sono raggiungibili: le verifiche del sito le fa l'utente.
- **Rete del container** (osservato il 2/11/2026):
  - raggiungibili `github.com` (clone e download di release);
  - bloccati PyPI, npm, Hugging Face, jsDelivr, unpkg, cdnjs e photocad.ai (solo via WebFetch per le pagine pubbliche).
  - Ricontrollato il 2/11/2026 (seconda sessione): il proxy risponde **403 al CONNECT** verso `huggingface.co`, `hf.co`, `cdn-lfs.huggingface.co`, `raw.githubusercontent.com`, `modelscope.cn`, `gitlab.com`, `codeberg.org`, `zenodo.org`, PyPI, npm e le CDN. È una policy dell'ambiente: non si risolve con token, skill o connettori. Niente GPU né PyTorch nel container.
  - **Git LFS** di repository pubblici non collegati con credenziali (per esempio `opencv/opencv_zoo`, che contiene DexiNed ONNX) **non** viene servito: si ottiene solo il puntatore. Per i modelli in LFS serve che l'utente scarichi il file e lo alleghi, oppure Colab.
  - Esiste un connettore MCP ufficiale **Hugging Face** (ricerca di modelli, dataset, Spaces, documentazione), non collegato all'account dell'utente. Non scarica pesi nell'ambiente; utile solo per ricerca e verifica di licenze. Usare gli Spaces per elaborare foto vorrebbe dire inviarle a terzi: escluso salvo richiesta esplicita dell'utente.
  - Per eseguire modelli generativi si usa **Google Colab gratuito** (decisione dell'utente del 2/11/2026), non il computer dell'utente.
  - Già installati: Python con numpy, onnxruntime 1.29, opencv, scikit-image, PIL; Node 22.23.4; Playwright con Chromium.
- **Skill usate**:
  - `apple-design` di Emil Kowalski (MIT, `github.com/emilkowalski/skills/tree/main/skills/apple-design`), proposta all'utente come skill "apple-fluid-web-design";
  - `artifact-design` e `artifact-capabilities` (per l'artifact della v3 dentro Claude).
- **MCP**: nessuno necessario. REA non è stato installato (sezione 9.1).
- **iPhone dell'utente**: unico banco di prova reale per Safari.

---

## 13. Problemi prioritari e roadmap

1. **Verificare la dev su iPhone**: worker con ONNX su Safari (oppure il ripiego), tempi, memoria, gesti, foglio, esportazione DXF da Safari (salvataggio in File). Correggere ciò che emerge.
2. **Contorno dell'edificio in STRUTTURA**: ricavarlo da forme e linee lunghe, marcando come RICOSTRUZIONI le parti stimate.
3. **Velocità della segmentazione su iPhone** (oggi circa 4 minuti):
   - meno prompt (solo celle e punti non coperti, griglia più rada nei riquadri già coperti);
   - salto dei riquadri senza celle;
   - eventuale encoder a risoluzione minore (da verificare: il modello ha ingresso fisso 1024).
4. **Riquadro automatico più preciso** (escludere terreno e alberi), più l'opzione "rimuovi sfondo" con MobileSAM.
5. **Riprove automatiche di qualità** con metriche oggettive.
6. **Desktop**: risoluzione 1200–1600 e backend WebGPU, con test reali.
7. **Falsi archi e ringhiere**: regole più severe; i balconi come forme aperte o semplificate.
8. **Modelli generativi (in corso, sezioni 15.7–15.8)**: prima prova su IMG_7781 fatta (SDXL promettente, SD 1.5 scartato, vettorizzatore che non chiude le celle da solo). Prossimo: Colab sugli altri prospetti della chiesetta (fianco e abside, ritagliati, `RIQUADRO = tutta`) con `MODELLI = sdxl`; lavoro sul motore per celle del disegno regolari, misurato con `rianalizza()`. Prima di integrare va dimostrato con i confronti che il risultato migliora rispetto alla versione attuale.
9. Calibrazione a due punti (misura nota) nell'esportazione; opzione DXF R2000 con LWPOLYLINE.
10. Quando l'utente approva: passaggio della dev a `index.html` e aggiornamento del README.

---

## 14. Riferimenti

- Repository: `https://github.com/LeoMastersSlave/Foto_vettore`
- PhotoCAD: `https://photocad.ai/convert`, `https://photocad.ai/api`, `https://photocad.ai/terms`, `https://photocad.ai/privacy`
- Informative Drawings ONNX: `https://github.com/Kazuhito00/Informative-Drawings-ONNX-Sample`; originale `https://github.com/carolineec/informative-drawings`
- Informative Drawings nel browser (riferimento per ONNX Runtime Web, WASM): `https://webai.show/models/informative-drawings-lineart/`
- MobileSAM ONNX: `https://github.com/palavido-dev/gratis-gis/releases/tag/models-mobilesam-v1`; originale `https://github.com/ChaoningZhang/MobileSAM`
- ONNX Runtime Web 1.21.0: `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.min.js`
- REA: `https://github.com/morluto/rea`
- Skill Apple: `https://github.com/emilkowalski/skills/tree/main/skills/apple-design`, `https://github.com/dickwu/apple-design-skill`
- Modelli generativi e licenze (sezione 15): `https://huggingface.co/xinsir/controlnet-union-sdxl-1.0` (Apache-2.0), `https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0` (CreativeML Open RAIL++-M), `https://huggingface.co/madebyollin/sdxl-vae-fp16-fix` (MIT), `https://huggingface.co/lllyasviel/control_v11p_sd15_lineart` (CreativeML OpenRAIL-M), `https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5` (CreativeML OpenRAIL-M); API diffusers `https://huggingface.co/docs/diffusers/v0.33.1/api/pipelines/controlnet_union`; indici dei controlli Union `https://siliconflow.github.io/BizyAir/controlnet-union/introduce.html`
- Esclusi (sezione 15.3): FLUX.1 Kontext dev `https://bfl.ai/blog/flux-1-kontext-dev`; Qwen-Image-Edit-2509 4 bit `https://huggingface.co/ovedrive/Qwen-Image-Edit-2509-4bit`; DexiNed in OpenCV Zoo `https://github.com/opencv/opencv_zoo/tree/main/models/edge_detection_dexined`

---

## 15. Direzione dal 2/11/2026 e banco di prova dei modelli generativi

### 15.1 Direzione decisa dall'utente

- Priorità: **gratuito e open source**. Nessuna API a pagamento (OpenAI, Claude o altri) per ora, nessuna chiave nel sito.
- **Qualità prima della velocità**: si può aspettare, purché la conversione finisca e il risultato sia valido (disegno completo, geometricamente fedele, DXF modificabile in AutoCAD).
- Il motore CAD attuale resta (layer, archi con bulge, DXF R12). La pipeline attuale resta come alternativa funzionante. Si procede in modo incrementale.
- Non limitarsi a rilevatori di bordi: cercare modelli che **ridisegnino** la facciata. Non serve che girino su iPhone.
- Prima di integrare un modello: **confronti concreti** sulle foto già usate (completezza, conci, aperture, archi, fedeltà geometrica). Un risultato gradevole non è una prova di fedeltà.
- Futuro: possibile modalità "AI avanzata" opzionale tramite provider esterno, **mai necessaria** per usare il programma. Architettura modulare per non riscrivere (15.6).
- Ambiente per i modelli pesanti: **Google Colab gratuito**.

### 15.2 Modelli scelti e perché

Criterio: il modello deve **generare un disegno al tratto coerente** (non solo bordi), con pesi pubblici scaricabili, licenza compatibile e memoria compatibile con Colab gratuito (di norma GPU T4 da circa 15 GB e circa 12 GB di RAM; Google non garantisce il tipo di GPU).

| Candidato | Come ridisegna | Licenze | Memoria (stima, non misurata) |
|---|---|---|---|
| **SDXL base 1.0 + ControlNet Union (xinsir)** + VAE fp16-fix | testo-immagine guidato da un'immagine di controllo "tratto" (modo 3 = canny/lineart/mlsd), 1024 px | SDXL: CreativeML Open RAIL++-M; Union: Apache-2.0; VAE: MIT | fp16 circa 10–12 GB VRAM su T4; download circa 10 GB |
| **SD 1.5 + ControlNet 1.1 Lineart** | stesso principio, 768 px | CreativeML OpenRAIL-M (entrambi) | circa 4–5 GB VRAM; download circa 3 GB |

- L'immagine di controllo è il disegno di **Informative Drawings** (già in Fotovettore) più i **segmenti rettilinei lunghi** della foto (LSD di OpenCV), bianco su nero. La diffusione ripulisce, chiude e uniforma i tratti, mentre il controllo tiene la geometria al suo posto.
- Ogni disegno generato passa dallo **stesso motore CAD** (`runAI` di `engine.js`, al posto della mappa di Informative Drawings, con o senza le forme MobileSAM), quindi si ottengono DXF a 4 layer direttamente confrontabili.
- Per ogni modello si generano più varianti (semi) e si tiene la migliore secondo le misure: una "riprova di qualità" come quella di PhotoCAD (9.2).
- SD 1.5 è più debole, ma è l'unico con una strada plausibile verso il browser in futuro (WebGPU). SDXL è il candidato di qualità per una modalità "computer potente".
- Le licenze RAIL consentono l'uso, anche commerciale, con restrizioni d'uso da rispettare e da riportare. Vanno rilette prima di distribuire pesi o integrarli.

### 15.3 Esclusi (verificato dalle pagine ufficiali o dei modelli)

- **FLUX.1 Kontext [dev]**: 12 miliardi di parametri, licenza **FLUX.1 Non-Commercial** (uso commerciale solo a pagamento). Incompatibile con l'obiettivo "gratuito e open source"; troppo pesante per T4.
- **Qwen-Image-Edit-2509** (Apache-2.0): anche quantizzato a 4 bit l'autore indica circa 20 GB di VRAM. Non affidabile su Colab gratuito. Da riconsiderare con GPU più grandi.
- **DexiNed** (MIT, ONNX 47 MB in OpenCV Zoo): è un rilevatore di bordi, non ridisegna; inoltre i pesi stanno in Git LFS, non scaricabile da qui. Escluso per scelta dell'utente ("non un altro rilevatore di bordi").
- **InstructPix2Pix e simili**: nota la scarsa fedeltà geometrica nelle modifiche globali (non testato qui).

### 15.4 Misure geometriche (`fv_banco.py`)

Tutte calcolate sulla regione a 900 px, rispetto alla **foto**, sia sul disegno grezzo sia sul vettoriale (il raster del DXF):

- `precisione_tratto`: quota del tratto (scheletro) entro r = max(2 px, 0,4% della diagonale) da un bordo della foto (Canny con soglie relative più segmenti LSD lunghi). Linee inventate la fanno scendere.
- `scarto_mediano_px`: distanza mediana tratto–bordo (proporzioni e posizioni).
- `completezza_strutturale`: quota, pesata per lunghezza, dei segmenti rettilinei lunghi della foto (≥ 4% della diagonale) coperti al 70% dal disegno.
- `linee_lunghe_inventate`: quota, pesata per lunghezza, dei segmenti lunghi del disegno senza riscontro nella foto.
- Celle chiuse: `aperture` (interno scuro nella foto, convesse), `archi` (convesse, profilo superiore circolare: freccia > 12% della larghezza, cerchio di Kåsa con residuo < 5%, altezza ≥ 0,6 × larghezza).
- `aperture_*` / `archi_*`: confronto con un **riferimento di consenso**, cioè gli elementi visti da almeno due disegni grezzi indipendenti (Informative Drawings, generativi, PhotoCAD se fornito), con IoU ≥ 0,5. Si misurano richiamo, precisione, IoU, errore larghezza/altezza ed errore di posizione. **Limite**: il consenso non è una verità; i generativi sono condizionati da Informative Drawings, quindi non del tutto indipendenti.
- PhotoCAD: allineamento automatico (foto intera o solo riquadro, margine 0–6%, poi affinamento ECC affine). Approssimato: va controllata la sovrapposizione.

### 15.5 Verificato qui il 2/11/2026 (senza GPU e senza i modelli generativi)

Su una **facciata sintetica** con geometria nota (conci, 3 finestre, 2 portali ad arco, fascia marcapiano), con un "candidato finto" al posto della diffusione:

- percorso completo: riquadro automatico di `engine.js` tramite Node, Informative Drawings, MobileSAM (146 forme in 106 s su 2 core), motore con e senza SAM, DXF, rilettura con `dxfrender.py`, misure, immagini, rapporto HTML, CSV e JSON;
- il **notebook stesso** eseguito cella per cella con moduli Colab e torch simulati (opzione "solo Fotovettore attuale"): zip prodotto;
- scelta del seme: la variante spostata di 25 px è stata scartata (punteggio 1,01 contro 1,50);
- verso degli archi nel campionamento dei bulge: il 95% dei punti degli archi cade sul disegno, contro il 48% con bulge invertito;
- risposta delle misure: sul disegno pulito 5 aperture e 2 archi (corretti); con 6 linee false le linee inventate passano da 0 a 0,14; con l'altezza deformata del 10% la precisione passa da 1,00 a 0,65 e lo scarto da 0,95 a 1,91 px; con metà disegno mancante la completezza passa da 0,99 a 0,44;
- allineamento di un finto PhotoCAD (bordi della foto intera su una pagina con margine del 4%): trovato "foto intera", F = 1,0, ECC riuscito.

**Non verificato**: esecuzione su Colab reale, download dei modelli, memoria e tempi su T4, qualità dei disegni SDXL/SD 1.5, il ripiego `nodejs-wheel` se Colab non avesse Node, la lettura di DXF e SVG PhotoCAD (`ezdxf`, `cairosvg`), il comportamento su foto reali.

### 15.6 Architettura modulare per i provider (progetto, non ancora nel codice dell'app)

Il notebook dimostra il contratto: **qualunque provider produce una "mappa di tratto" della regione** (Float32 rw×rh, 0 = linea, 1 = bianco) e, facoltativamente, **forme chiuse** (poligoni in pixel di regione). Tutto il resto (vettorizzazione, livelli, archi, DXF, correzione) resta nel motore CAD esistente. Proposta per `dev/`, quando servirà:

```
provider = {
  id, nome, licenza, locale: true|false, costo: 'gratuito'|'a consumo',
  disponibile(): Promise<bool>,                 // es. WebGPU presente, server locale attivo, chiave inserita dall'utente
  esegui({rgba, W, H, regione, dettaglio}, onProgress, signal) -> {neural: Float32Array, polys?: Float32Array[]}
}
```

- Provider gratuiti: `informative-drawings+mobilesam` (attuale, browser), in futuro `sd15-lineart` (WebGPU) oppure un **server locale o Colab** dell'utente (indirizzo inserito a mano, nessun costo).
- Provider esterni a pagamento (OpenAI, Claude o altri): solo **opzionali**, attivati dall'utente con la **propria chiave inserita nel browser e mai salvata nel repository o nel sito**, con avviso esplicito che la foto lascia il dispositivo. Non implementati.
- Il motore CAD non cambia: cambia solo da dove arriva `neural`. Il notebook usa già questo schema (`fb.motore(neurale, gray, forme)`).

### 15.7 Prossimi passi

1. L'utente apre il notebook su Colab, carica i prospetti della chiesetta (e, se vuole, le proprie conversioni PhotoCAD delle stesse foto) e manda `risultati_fotovettore.zip`.
2. Analisi: misure, sovrapposizioni e DXF in AutoCAD. Integrare solo se un candidato migliora in modo misurabile completezza, aperture e archi **senza** peggiorare precisione e linee inventate.
3. Se SDXL vince ma SD 1.5 no: modalità "server locale/Colab" come provider gratuito facoltativo. Se vince SD 1.5: valutare la conversione ONNX/WebGPU per il browser (desktop).
4. Regolazioni possibili nel notebook: `FORZA_CONTROLLO`, `SEMI`, `PASSI`, prompt in `fv_banco.PROMPT`/`NEGATIVO`.

### 15.8 Prima prova reale su Colab (2/11/2026, foto IMG_7781)

Foto dell'utente: facciata romanica in conci, con 2 portali ad arco, finestra monofora, bifora con colonnina, archetti pensili, oculi e cornice. **Non è** Palazzo né Lisbona. Eseguita dall'utente su Colab gratuito (GPU T4, `cuda` senza offload), con 3 semi e 30 passi.

**Tempi (verificati)**:
- totale 13 min 19 s;
- caricamento dei modelli: SDXL 212 s, SD 1.5 220 s;
- generazione: SDXL 32–34 s per variante a 1024×896, SD 1.5 16 s a 768×704;
- Informative Drawings 26 s, MobileSAM 171 s (CPU di Colab).

**Errore del banco trovato e corretto**: SDXL disegna linee grigie (90–160) su carta grigia (~220), quindi la soglia fissa a 128 perdeva gran parte del tratto (22 celle chiuse invece di 209). Ora c'è `normalizza_disegno()`: carta stimata localmente, tratto = almeno ~18% più scuro della carta. La prima tabella dello zip va ignorata. Con `rianalizza()` le misure sono state ricalcolate dalle immagini già generate, senza GPU; MobileSAM è stato ricalcolato qui con lo stesso seme (230 forme, come su Colab).

**Misure dopo la correzione** (riferimento di consenso: 5 aperture, 4 archi):

| Metodo | Precisione | Completezza | Inventate | Celle chiuse | Celle rettangolari | Aperture trovate | Errore proporzioni aperture |
|---|---|---|---|---|---|---|---|
| Informative Drawings, grezzo | 0,880 | 0,976 | 0,037 | 240 | 0,27 | 5/5 | 0,9% |
| **SDXL, grezzo** | 0,888 | **1,000** | **0,015** | 209 | 0,33 | 5/5 | **0,5%** |
| SD 1.5, grezzo | 0,871 | 0,955 | 0,154 | 232 | 0,49 | 2/5 | 19,3% |
| DXF Fotovettore attuale (ID + SAM) | 0,944 | 0,801 | 0,067 | 225 | **0,90** | 4/5 | 6,2% |
| **DXF SDXL + SAM** | 0,953 | 0,845 | 0,062 | 224 | **0,90** | 4/5 | 6,2% |
| DXF SDXL + celle del disegno | **0,961** | **0,964** | **0,026** | 249 | 0,48 | 5/5 | 2,9% |
| DXF ID + celle del disegno | 0,943 | 0,898 | 0,035 | 289 | 0,42 | 5/5 | 5,2% |
| DXF SD 1.5 + SAM | 0,936 | 0,908 | 0,091 | 226 | 0,90 | 4/5 | 6,2% |

**Osservazioni visive (confronto delle immagini, oltre alle misure)**:
- Il disegno grezzo di SDXL è il più pulito: tratto uniforme, conci, portali, bifora, archetti, oculi e cornice riconoscibili, poca grana, tratti spuri soprattutto sugli alberi ai lati.
- SD 1.5 aggiunge campiture scure (cornice, archetti) e una fascia decorativa inventata in basso: **scartato** (resta come opzione nel notebook; predefinito ora `sdxl`).
- **Senza forme** il motore produce quasi solo tratti aperti (1–5 celle chiuse anche dal disegno SDXL): la chiusura dei contorni nel DXF oggi viene **solo** da MobileSAM. Per questo i DXF "+ SAM" si somigliano tutti. Il vettorizzatore è diventato il collo di bottiglia.
- "**Celle del disegno**" (nuova funzione `celle_come_forme`: le aree bianche chiuse del disegno passate al motore come forme) dà le misure migliori in assoluto, ma **a vista è peggiore**: celle fuse in grandi poligoni irregolari, archetti pensili deformati, bifora ridotta a due rettangoli. Va letta con "celle rettangolari" 0,48 contro 0,90. È un caso in cui le misure di completezza premiano un disegno meno utilizzabile in CAD: non integrare così.

**Conclusioni (su una sola foto: da confermare sugli altri prospetti della chiesetta)**:
1. SDXL + ControlNet Union è il candidato da seguire; SD 1.5 no.
2. Miglioramento sicuro ma piccolo: **SDXL come mappa di tratto al posto di Informative Drawings, con le stesse forme MobileSAM** (completezza 0,80 → 0,85, precisione 0,944 → 0,953, forme invariate).
3. Il guadagno grande (completezza 0,96, aperture 5/5) richiede un vettorizzatore che chiuda le celle dal disegno **in modo regolare**: per esempio celle del disegno solo dove MobileSAM non ha già una forma, regolarizzate con `regShape` più severo, separando le celle fuse lungo i tratti deboli. È lavoro sul motore, verificabile qui con `rianalizza()` senza GPU.
4. Nessuna integrazione in `dev/` per ora.

Visto che SDXL non gira nel browser, un'eventuale integrazione passerebbe da un provider "server locale o Colab" (15.6).

### 15.9 Seconda prova su Colab (2/11/2026): IMG_7782 e Lisbona

Due foto nuove eseguite dall'utente col banco già corretto:
- **IMG_7782**: stessa chiesa di IMG_7781, altro scatto;
- **Lisbona** (file "WhatsApp Image 2026-11-02 at 15.08.05"): palazzo intonacato con finestre, balconi e portone. È la foto di riferimento "Lisbona" (sezione 8.1), ricevuta via WhatsApp.

**Tempi**: totale 7,7 min e 8,3 min. Con i modelli già in cache il caricamento scende a circa 42 s per SDXL e 25 s per SD 1.5; SDXL 33–41 s per variante.

**Secondo problema di soglia, corretto**: su Lisbona SDXL disegna linee chiarissime (solo 5–10% più scure della carta). `normalizza_disegno()` ora alza la soglia fino al 15% dei pixel più scuri (tra 0,82 e 0,95 del rapporto con la carta). Su Lisbona la completezza del grezzo passa da 0,49 a 0,89; sulle foto della chiesa la soglia resta circa 0,82. Tutte e tre le foto sono state rianalizzate con `rianalizza()`.

**DXF, risultati principali (rianalisi finale)**:

| Foto | Metodo | Precisione | Completezza | Inventate | Celle rettangolari |
|---|---|---|---|---|---|
| IMG_7781 | attuale (ID + SAM) | 0,944 | 0,801 | 0,067 | 0,90 |
| IMG_7781 | **SDXL + SAM** | 0,953 | 0,845 | 0,062 | 0,90 |
| IMG_7782 | attuale (ID + SAM) | 0,948 | 0,802 | 0,084 | 0,92 |
| IMG_7782 | **SDXL + SAM** | 0,955 | 0,898 | 0,052 | 0,92 |
| Lisbona, solo facciata (senza auto, strada e bordi) | attuale (ID + SAM) | 0,953 | 0,652 | 0,031 | 0,74 |
| Lisbona, solo facciata | **SDXL + SAM** | 0,937 | 0,662 | 0,062 | 0,74 |

- Su Lisbona la misura su tutto il riquadro (completezza 0,67 contro 0,72) penalizza SDXL perché il riquadro automatico include auto, strada ed edifici vicini, che SDXL giustamente non disegna. Misurata solo sulla facciata è parità. Anche a vista i due DXF sono quasi uguali: le forme vengono da MobileSAM.
- **A vista il disegno grezzo SDXL è nettamente migliore su Lisbona**: finestre, ringhiere, balconi e portone puliti, nessuna auto, niente rumore sui palazzi vicini. Il motore però non sfrutta questa qualità.
- SD 1.5: su IMG_7782 e Lisbona è simile a SDXL, su IMG_7781 molto peggiore (campiture, aperture sbagliate). Resta scartato per instabilità.
- Le misure di aperture e archi su Lisbona non funzionano: le finestre su facciata bianca non risultano "scure" (riferimento di consenso vuoto). Limite noto della misura, da rivedere per le facciate intonacate.

**Conclusione su tre foto** (Lisbona poi esclusa dall'utente, vedi 15.10): SDXL + SAM migliora o pareggia sempre (completezza +4 e +10 punti sulla chiesa, parità su Lisbona) con forme identiche. Il guadagno grande resta bloccato dal vettorizzatore, che non chiude contorni dalle linee: il prossimo lavoro è sul motore (15.8, punto 3), misurabile qui sulle tre serie salvate senza GPU.

---

## Prompt per la nuova chat

Copia e incolla questo messaggio in una nuova conversazione con Claude:

```
Sto sviluppando Fotovettore, una web app gratuita e locale (anche su iPhone) che converte foto di edifici in disegni CAD (DXF/SVG/PDF), ispirata a PhotoCAD. Il repository GitHub è LeoMastersSlave/Foto_vettore (GitHub può mostrarlo anche come LeoMasterSlave/foto_vettore).

1. Collega il repository alla sessione con accesso in scrittura e clonalo.
2. Leggi per intero FOTOVETTORE_HANDOFF.md nella radice: contiene obiettivi, architettura, pipeline, modelli, test, decisioni, limiti e roadmap. Considera verificato solo ciò che il documento indica come tale.
3. Controlla lo stato del repository: git log (l'ultimo lavoro documentato è il commit che aggiunge FOTOVETTORE_HANDOFF.md e la cartella sviluppo/), la presenza di index.html (versione pubblicata, da non toccare), dev/index.html, sviluppo/src/*, sviluppo/strumenti/* e prova-ai/modelli/*.onnx. Rigenera dev/index.html con python3 sviluppo/build.py e verifica che non cambi rispetto al commit (git diff).
4. Verifica cosa raggiunge il tuo ambiente (GitHub, PyPI, npm, CDN) prima di pianificare.
5. Leggi la sezione 15 (direzione: gratuito e open source, qualità prima della velocità, modelli generativi provati su Google Colab con sviluppo/colab/, possibile futura modalità AI esterna opzionale senza costi ora). Se ti mando risultati_fotovettore.zip, analizzalo come descritto in 15.7.
6. Riprendi dalla sezione 13 del documento: il primo passo è verificare la versione dev su iPhone. Chiedimi la riga "Prestazioni" da Impostazioni avanzate e gli eventuali errori dopo una conversione su https://leomastersslave.github.io/Foto_vettore/dev/, poi correggi ciò che emerge.

Regole: lavora in sviluppo/src e rigenera dev/index.html; non modificare index.html senza il mio consenso; niente servizi a pagamento o API commerciali; non dichiarare test non eseguiti; distingui fatti e ipotesi; chiedimi le foto di test (non sono nel repository) e le autorizzazioni quando servono. Rispondimi in italiano.
```

### 15.10 Ambito deciso dall'utente (2/11/2026)

- **Interessa solo la chiesetta** (edificio romanico in conci delle foto IMG_7781/IMG_7782). **Lisbona non va più usata** per test, confronti o messe a punto. Anche Palazzo non è richiesto. I dati di Lisbona in 15.9 restano solo come storico. La soglia adattiva di `normalizza_disegno()`, nata da quel caso, resta perché vale per qualunque disegno chiaro.
- Prospetti disponibili, foto inviate dall'utente:
  - facciata: 4 scatti, già provati IMG_7781 e IMG_7782;
  - fianco con scala esterna, tiranti e croce: 2 scatti;
  - abside doppia: 2 scatti; superfici curve, ripresa leggermente dal basso;
  - un quarto prospetto parzialmente coperto da un albero, da ricomporre unendo più foto (non ancora ricevute).
- Il riquadro automatico sbaglia su fianco e abside (prende solo la cornice o una lesena). Ritagli preparati da Claude: `chiesetta_fianco.jpg` (foto 61d929b6, riquadro 60,70–2370,1370) e `chiesetta_abside.jpg` (foto af308387, riquadro 90,460–1640,1740). Si caricano in Colab con `RIQUADRO = tutta`, opzione aggiunta al notebook.
