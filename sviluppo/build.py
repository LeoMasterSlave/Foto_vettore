# Assembla dev/index.html dai sorgenti in sviluppo/src (python3 sviluppo/build.py; poi: node --check sviluppo/.check.js)
import sys
import os
H=os.path.dirname(os.path.abspath(__file__)); P=lambda *a: os.path.join(H,*a)
eng=open(P('src','engine.js')).read(); ai=open(P('src','ai_worker.js')).read(); main=open(P('src','main.js')).read()
css=open(P('src','style.css')).read(); body=open(P('src','body.html')).read()
html='''<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1c1c1e" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Fotovettore">
<meta name="description" content="Fotovettore: da foto di edifici a disegni CAD (DXF, SVG, PDF) con AI locale nel browser.">
<title>Fotovettore</title>
<style>
'''+css+'''</style>
</head>
<body>
'''+body+'''
<script>
(function () {
'''+eng+'\n'+ai+'\n'+main+'''
})();
</script>
</body>
</html>
'''
out=os.path.join(H,'..','dev','index.html'); open(out,'w').write(html)
import re
open(os.path.join(H,'.check.js'),'w').write(re.search(r'<script>(.*)</script>',html,re.S).group(1))
print(len(html))
