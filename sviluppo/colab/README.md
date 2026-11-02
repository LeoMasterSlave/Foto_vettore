# Banco di prova dei modelli generativi (Google Colab)

[![Apri in Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/LeoMasterSlave/Foto_vettore/blob/main/sviluppo/colab/Fotovettore_confronto_modelli.ipynb)

Non fa parte dell'app: serve a decidere, **con misure**, se un modello generativo migliora i disegni di Fotovettore prima di integrarlo.

## Uso
1. Apri il notebook col pulsante qui sopra (serve un account Google).
2. **Runtime → Cambia tipo di runtime → GPU T4**.
3. **Runtime → Esegui tutto** (se compare l'avviso "non creato da Google", scegli **Esegui comunque**).
4. Carica una o più foto quando compare il pulsante. Alla fine si scarica `risultati_fotovettore.zip`.

Non servono un account Hugging Face né API a pagamento: i modelli sono pubblici e girano nella sessione Colab.

## Cosa confronta
| Metodo | Modelli | Licenze |
|---|---|---|
| Fotovettore attuale | Informative Drawings "contour" + MobileSAM (ONNX in `prova-ai/modelli`) | MIT, Apache-2.0 |
| SDXL + ControlNet Union | `stabilityai/stable-diffusion-xl-base-1.0`, `xinsir/controlnet-union-sdxl-1.0`, `madebyollin/sdxl-vae-fp16-fix` | CreativeML Open RAIL++-M, Apache-2.0, MIT |
| SD 1.5 + ControlNet Lineart | `stable-diffusion-v1-5/stable-diffusion-v1-5`, `lllyasviel/control_v11p_sd15_lineart` | CreativeML OpenRAIL-M |
| PhotoCAD (facoltativo) | il file PNG, SVG o DXF di una **tua** conversione | - |

Ogni disegno passa dallo stesso motore CAD (`sviluppo/src/engine.js`, chiamato da `motore.js` senza modificarlo), quindi i DXF hanno gli stessi 4 layer.

## File
- `Fotovettore_confronto_modelli.ipynb`: generato da `crea_notebook.py` (modificare quello, poi `python3 sviluppo/colab/crea_notebook.py`).
- `fv_banco.py`: modelli, motore, misure geometriche, DXF, rapporto. Si può usare anche fuori da Colab su un computer con GPU NVIDIA.
- `motore.js`: ponte Node verso `engine.js` (`detect` e `run` in modalità AI).

## Limiti
Le misure (sezione 15.4 di `FOTOVETTORE_HANDOFF.md`) sono indicatori rispetto alla foto e a un riferimento di consenso, non una verità: vanno lette insieme alle sovrapposizioni e ai DXF aperti in AutoCAD. Il notebook non è ancora stato eseguito su Colab (sezione 15.5).
