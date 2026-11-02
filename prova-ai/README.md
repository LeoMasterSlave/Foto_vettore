# Prova AI (esperimento)

Pagina di prova separata da Fotovettore: esegue nel browser due modelli AI per valutare la conversione foto → disegno architettonico. Nessuna foto lascia il dispositivo.

Apri `prova-ai/` dal sito GitHub Pages del repository. Richiede internet solo per caricare onnxruntime-web da jsDelivr.

## Modelli inclusi e crediti
- `contour_style_512x512.onnx` – Informative Drawings (Caroline Chan et al., licenza MIT), conversione ONNX di Kazuhito Takahashi: https://github.com/Kazuhito00/Informative-Drawings-ONNX-Sample (MIT). Progetto originale: https://github.com/carolineec/informative-drawings
- `mobilesam-encoder.onnx`, `mobilesam-decoder.onnx` – MobileSAM (Apache-2.0), esportati in ONNX da https://github.com/palavido-dev/gratis-gis (release `models-mobilesam-v1`). Progetto originale: https://github.com/ChaoningZhang/MobileSAM

I modelli appartengono ai rispettivi autori e restano sotto le loro licenze.
