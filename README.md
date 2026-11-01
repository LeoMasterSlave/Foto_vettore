# Fotovettore

Strumento gratuito che trasforma una foto in un disegno vettoriale (SVG, DXF, PDF) per CAD, taglio laser e CNC.
Funziona interamente nel browser: le immagini non vengono caricate su nessun server.

## Come si usa

1. Apri la pagina e carica un'immagine (anche trascinandola o incollandola).
2. Scegli il metodo:
   - **Contorni**: linee sottili lungo i bordi.
   - **Architettura**: per edifici e facciate; ignora texture e piccole ombre e tiene gli spigoli strutturali.
   - **Sagoma**: contorni chiusi di zone chiare e scure, adatti a laser e CNC.
3. Regola i cursori, imposta la larghezza reale in mm ed esporta in SVG, DXF o PDF.

## Cosa fa

- Pulizia delle texture con filtro che conserva i bordi, ricucitura delle lacune, adattamento di rette e archi di cerchio.
- Unione delle linee allineate, saldatura degli angoli e raddrizzamento opzionale di orizzontali e verticali.
- DXF (R12) con LINE e polilinee con archi (bulge), modificabili in AutoCAD.
- Zoom e spostamento nell'anteprima; elaborazione in un Web Worker.

## Limiti

- Un'ombra netta resta un bordo.
- Le curve libere non circolari vengono approssimate con rette corte.
- Non usa intelligenza artificiale: la qualità dipende dal contrasto della foto.

## Pubblicazione su GitHub Pages

Carica questi file in un repository, poi Settings, Pages, ramo `main`, cartella `/ (root)`.

## Licenza

MIT. Vedi il file `LICENSE`.
