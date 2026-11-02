# Genera Fotovettore_confronto_modelli.ipynb (modificare qui, poi: python3 sviluppo/colab/crea_notebook.py)
import json, os

URL = 'https://colab.research.google.com/github/LeoMasterSlave/Foto_vettore/blob/main/sviluppo/colab/Fotovettore_confronto_modelli.ipynb'
celle = []


def md(t):
    celle.append({'cell_type': 'markdown', 'metadata': {}, 'source': t.strip('\n').splitlines(True)})


def code(t, titolo=None):
    meta = {'cellView': 'form'} if titolo else {}
    celle.append({'cell_type': 'code', 'metadata': meta, 'execution_count': None, 'outputs': [],
                  'source': t.strip('\n').splitlines(True)})


md(f'''
# Fotovettore: confronto dei modelli generativi

[![Apri in Colab](https://colab.research.google.com/assets/colab-badge.svg)]({URL})

Confronta sulla **stessa foto** e sulla **stessa regione**:

1. **Fotovettore attuale**: Informative Drawings + MobileSAM + motore CAD (`sviluppo/src/engine.js`);
2. **SDXL + ControlNet Union**: ridisegna la facciata come disegno al tratto, guidato dai tratti della foto;
3. **SD 1.5 + ControlNet Lineart**: stesso principio, modello più leggero;
4. facoltativo: **il tuo disegno PhotoCAD** della stessa foto (PNG, SVG o DXF scaricato dal tuo account).

Ogni disegno generato passa dallo **stesso motore CAD** di Fotovettore, quindi i DXF hanno gli stessi 4 layer e sono confrontabili. Le misure controllano fedeltà del tratto, completezza delle linee strutturali, aperture, archi e proporzioni, non solo l'aspetto.

## Come si usa
1. **Runtime → Cambia tipo di runtime → GPU T4** → Salva.
2. **Runtime → Esegui tutto.** Se Colab avvisa che il notebook non è di Google, scegli **Esegui comunque**.
3. Quando compare il pulsante, **carica una o più foto** (JPG, PNG o HEIC).
4. Alla fine si scarica `risultati_fotovettore.zip`: mandamelo per l'analisi.

Prima esecuzione: circa 10 GB di modelli scaricati da Hugging Face (alcuni minuti). Nessun account Hugging Face né API a pagamento: i modelli usati sono pubblici e girano nella tua sessione Colab. Le foto restano nella macchina virtuale Colab della tua sessione (server Google), non vengono inviate ad altri servizi.
''')

code('''
#@title 1. Preparazione (GPU, repository, dipendenze)
import os, sys, shutil, subprocess, importlib
def sh(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if r.returncode: print(r.stdout[-2000:], r.stderr[-2000:])
    return r.returncode == 0
REPO = '/content/Foto_vettore'
if not os.path.isdir(REPO):
    sh('git clone --depth 1 https://github.com/LeoMasterSlave/Foto_vettore ' + REPO)
else:
    sh('git -C %s pull --ff-only' % REPO)
sh('pip install -q "diffusers>=0.32" accelerate onnxruntime pillow-heif')
if not shutil.which('node'):  # il motore CAD di Fotovettore e' JavaScript
    sh('pip install -q nodejs-wheel')
print('Node:', subprocess.run(['node', '--version'], capture_output=True, text=True).stdout.strip() or 'NON TROVATO')
import torch
if torch.cuda.is_available():
    p = torch.cuda.get_device_properties(0)
    print('GPU: %s, %.1f GB' % (p.name, p.total_memory / 2**30))
else:
    print('ATTENZIONE: nessuna GPU. Runtime > Cambia tipo di runtime > GPU T4, poi Esegui tutto di nuovo.')
    print('Senza GPU funzionano solo Fotovettore attuale e (molto lentamente) SD 1.5.')
sys.path.insert(0, REPO + '/sviluppo/colab')
import fv_banco as fb; importlib.reload(fb)
print('Riquadro di prova del motore:', fb.rileva_riquadro(__import__('numpy').full((64, 64, 3), 200, 'uint8')))
''', titolo=True)

code('''
#@title 2. Impostazioni (i valori predefiniti vanno bene)
MODELLI = "sdxl"  #@param ["sdxl", "entrambi", "sd15", "nessuno (solo Fotovettore attuale)"]
SEMI = 3  #@param {type:"slider", min:1, max:6, step:1}
PASSI = 30  #@param {type:"slider", min:15, max:50, step:5}
FORZA_CONTROLLO = 1.0  #@param {type:"slider", min:0.5, max:1.5, step:0.05}
USA_MOBILESAM = True  #@param {type:"boolean"}
RIQUADRO = ""  #@param {type:"string"}
LARGHEZZA_MM = 10000  #@param {type:"integer"}
CONFRONTA_PHOTOCAD = False  #@param {type:"boolean"}
SALVA_SU_DRIVE = False  #@param {type:"boolean"}
# MODELLI: SD 1.5 e' stato scartato nella prova del 2/11/2026 (linee inventate, aperture sbagliate); resta come opzione.
# SEMI: quante varianti generare per modello; si tiene la migliore secondo le misure (riprova di qualita').
# FORZA_CONTROLLO: quanto il disegno deve seguire i tratti della foto (piu' alto = piu' fedele, meno "inventato").
# RIQUADRO: vuoto = automatico (come nell'app); "tutta" = usa tutta la foto (foto gia' ritagliata sul prospetto);
# oppure "x0,y0,x1,y1" in pixel della foto ridotta a 2400 px di lato lungo.
# CONFRONTA_PHOTOCAD: ti chiedera' il file PhotoCAD (PNG, SVG o DXF) di ogni foto.
modelli = {'entrambi': ('sdxl', 'sd15'), 'sdxl': ('sdxl',), 'sd15': ('sd15',)}.get(MODELLI, ())
_r = RIQUADRO.strip().lower()
box = 'tutta' if _r in ('tutta', 'tutto', 'intera') else ([int(v) for v in _r.replace(' ', '').split(',')] if _r else None)
print('Modelli:', modelli or 'solo Fotovettore attuale', '| semi:', SEMI, '| passi:', PASSI)
''', titolo=True)

code('''
#@title 3. Carica le foto
from google.colab import files
os.makedirs('/content/foto', exist_ok=True)
caricati = files.upload()
FOTO = []
for nome, dati in caricati.items():
    p = os.path.join('/content/foto', nome)
    open(p, 'wb').write(dati); FOTO.append(p)
print('Foto:', [os.path.basename(f) for f in FOTO])
PHOTOCAD = {}
if CONFRONTA_PHOTOCAD:
    for f in FOTO:
        print('Carica il disegno PhotoCAD di', os.path.basename(f), '(PNG, SVG o DXF; annulla per saltare)')
        up = files.upload()
        for nome, dati in up.items():
            p = os.path.join('/content/foto', 'photocad_' + nome); open(p, 'wb').write(dati); PHOTOCAD[f] = p
if any(f.lower().endswith('.dxf') for f in PHOTOCAD.values()): sh('pip install -q ezdxf matplotlib')
if any(f.lower().endswith('.svg') for f in PHOTOCAD.values()): sh('pip install -q cairosvg')
''', titolo=True)

code('''
#@title 4. Esegui il confronto (SDXL: circa 1 minuto per variante su T4; MobileSAM: qualche minuto)
import pandas as pd
from IPython.display import display, Image as IImage, Markdown
RISULTATI = '/content/risultati'
COLONNE = ['tipo', 'metodo', 'precisione_tratto', 'scarto_mediano_px', 'completezza_strutturale',
           'linee_lunghe_inventate', 'celle_chiuse', 'aperture', 'archi', 'aperture_richiamo',
           'aperture_iou_medio', 'aperture_errore_proporzioni_%', 'archi_richiamo', 'archi_iou_medio',
           'polilinee', 'segmenti_ad_arco']
for f in FOTO:
    display(Markdown('## ' + os.path.basename(f)))
    D, info, righe = fb.esegui_confronto(f, RISULTATI, box=box, modelli=modelli, semi=tuple(range(1, SEMI + 1)),
                                         passi=PASSI, larghezza_mm=LARGHEZZA_MM, usa_sam=USA_MOBILESAM,
                                         photocad=PHOTOCAD.get(f), scala_controllo=FORZA_CONTROLLO)
    display(IImage(os.path.join(D, '00_foto_e_riquadro.jpg'), width=420))
    df = pd.DataFrame(righe); display(df[[c for c in COLONNE if c in df.columns]])
    display(Markdown('**Disegni grezzi** (rosso = tratto; verde = aperture; magenta = archi; ciano = riferimento di consenso)'))
    display(IImage(os.path.join(D, 'confronto_grezzi.jpg')))
    display(Markdown('**Vettoriali, cioe\\' i DXF** (nero struttura, blu elementi, grigio dettagli, arancio ricostruzioni)'))
    display(IImage(os.path.join(D, 'confronto_vettoriali.jpg')))
''', titolo=True)

code('''
#@title 5. Salva e scarica i risultati
shutil.make_archive('/content/risultati_fotovettore', 'zip', RISULTATI)
if SALVA_SU_DRIVE:
    from google.colab import drive
    drive.mount('/content/drive')
    os.makedirs('/content/drive/MyDrive/Fotovettore', exist_ok=True)
    shutil.copy('/content/risultati_fotovettore.zip', '/content/drive/MyDrive/Fotovettore/')
    print('Copiato in Il mio Drive/Fotovettore')
files.download('/content/risultati_fotovettore.zip')
''', titolo=True)

md('''
## Come leggere le misure
- **precisione_tratto**: quota del tratto che cade su un bordo reale della foto. Basso vuol dire linee inventate.
- **scarto_mediano_px**: distanza tipica tra tratto e bordo reale (px, regione a 900 px). Alto vuol dire proporzioni o posizioni spostate.
- **completezza_strutturale**: quota delle linee rettilinee lunghe della foto (cornici, stipiti, fasce, spigoli) ritrovate nel disegno.
- **linee_lunghe_inventate**: quota delle linee lunghe del disegno senza riscontro nella foto.
- **celle_chiuse, aperture, archi**: contorni chiusi; aperture = interno scuro nella foto; archi = profilo superiore circolare.
- **aperture_* e archi_***: confronto col *riferimento di consenso*, cioè gli elementi visti da almeno due disegni indipendenti (più PhotoCAD, se caricato). Richiamo, IoU, errore larghezza/altezza in %.

Sono **indicatori**, non una verità: il riferimento di consenso può sbagliare e il "bordo reale" della foto include ombre e texture. Un disegno gradevole non è per questo fedele: guarda sempre le **sovrapposizioni sulla foto** e apri i DXF (`dxf_*.dxf`) in AutoCAD. Per ogni DXF c'è anche `*_riletto.png`, la rilettura indipendente del file.

Nella cartella di ogni foto: tutte le varianti generate (`2sdxl_seme*.png`, `2sd15_seme*.png`), le immagini di controllo, `misure.csv`, `risultati.json` e `rapporto.html`.
''')

nb = {'nbformat': 4, 'nbformat_minor': 4, 'cells': celle,
      'metadata': {'accelerator': 'GPU', 'colab': {'provenance': [], 'gpuType': 'T4'},
                   'kernelspec': {'name': 'python3', 'display_name': 'Python 3'}, 'language_info': {'name': 'python'}}}
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'Fotovettore_confronto_modelli.ipynb')
with open(out, 'w') as fh:
    json.dump(nb, fh, indent=1, ensure_ascii=False)
print(out)
