import http.server, json, numpy as np, onnxruntime as ort, os, sys
so=ort.SessionOptions(); so.intra_op_num_threads=2
CACHE={}
S={n:ort.InferenceSession('modelli/'+f,so,providers=['CPUExecutionProvider']) for n,f in [('id','contour_style_512x512.onnx'),('enc','mobilesam-encoder.onnx'),('dec','mobilesam-decoder.onnx')]}
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_POST(self):
        m=self.path.split('?m=')[1]; meta=json.loads(self.headers['X-Meta']); body=self.rfile.read(int(self.headers['Content-Length']))
        feeds={}; off=0
        for name,dims,dt in meta:
            if dt=='ref':
                feeds[name]=CACHE['emb']; continue
            n=int(np.prod(dims)); a=np.frombuffer(body,dtype=np.float32,count=n,offset=off).reshape(dims); off+=4*n; feeds[name]=a
        outs=S[m].run(None,feeds)
        if m=='enc': CACHE['emb']=outs[0]
        names=[o.name for o in S[m].get_outputs()]
        data=b''.join(np.ascontiguousarray(o,dtype=np.float32).tobytes() for o in outs)
        self.send_response(200); self.send_header('X-Out',json.dumps([[n,list(o.shape)] for n,o in zip(names,outs)])); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
http.server.ThreadingHTTPServer(('127.0.0.1',int(os.environ.get('PORT','8765'))),H).serve_forever()
