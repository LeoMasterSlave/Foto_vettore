#!/bin/bash
# Prepara sviluppo/strumenti/sito/ e avvia il server di prova su http://127.0.0.1:8765
# Pagina: http://127.0.0.1:8765/dev/index.html?ort=/mock_ort.js  (modelli eseguiti con onnxruntime Python)
set -e
H="$(cd "$(dirname "$0")" && pwd)"; R="$(cd "$H/../.." && pwd)"
mkdir -p "$H/sito/dev" "$H/sito/prova-ai"
cp "$R/dev/index.html" "$H/sito/dev/index.html"
ln -sfn "$R/prova-ai/modelli" "$H/sito/prova-ai/modelli"
ln -sfn "$R/prova-ai/modelli" "$H/sito/modelli"
cp "$H/mock_ort.js" "$H/server.py" "$H/sito/"
[ -f "$R/index.html" ] && mkdir -p "$H/sito/old" && cp "$R/index.html" "$H/sito/old/index.html"
cd "$H/sito" && exec python3 server.py
