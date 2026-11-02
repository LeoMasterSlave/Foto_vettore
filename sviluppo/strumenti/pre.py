# Precalcola gli input del vettorizzatore AI (stessa logica del worker nel browser, con onnxruntime Python)
# Uso: python3 pre.py <foto> x0 y0 x1 y1 <nome>   -> dati/<nome>.json, dati/<nome>.neural.f32, dati/<nome>.gray.u8
# I modelli si leggono da ../../prova-ai/modelli (variabile MODELLI per cambiarlo).
import numpy as np, onnxruntime as ort, cv2, json, sys, time, os
from PIL import Image
H0=os.path.dirname(os.path.abspath(__file__)); M=os.environ.get('MODELLI',os.path.join(H0,'..','..','prova-ai','modelli')); D=os.path.join(H0,'dati'); os.makedirs(D,exist_ok=True)
foto,x0,y0,x1,y1,name=sys.argv[1],*map(int,sys.argv[2:6]),sys.argv[6]
img=Image.open(foto).convert('RGB')
reg=img.crop((x0,y0,x1,y1)); k=900/max(reg.size); rw,rh=round(reg.size[0]*k),round(reg.size[1]*k)
R=np.asarray(reg.resize((rw,rh),Image.BILINEAR)).astype(np.float32)
so=ort.SessionOptions(); so.intra_op_num_threads=2
idm=ort.InferenceSession(os.path.join(M,'contour_style_512x512.onnx'),so)
T=360; st=int(T*0.7)
pos=lambda L,T,s: sorted(set(list(range(0,max(1,L-T),s))+[max(0,L-T)]))
acc=np.zeros((rh,rw),np.float32); wt=np.zeros((rh,rw),np.float32)
h1=0.5-0.5*np.cos(2*np.pi*(np.arange(T)+1)/(T+1)); wm=np.outer(h1,h1).astype(np.float32)+1e-3
t=time.time()
for y in pos(rh,T,st):
  for x in pos(rw,T,st):
    tl=cv2.resize(R[y:y+T,x:x+T],(512,512),interpolation=cv2.INTER_LINEAR).transpose(2,0,1)[None]
    o=idm.run(None,{'input_image':tl})[0][0,0]
    acc[y:y+T,x:x+T]+=cv2.resize(o,(T,T),interpolation=cv2.INTER_LINEAR)*wm; wt[y:y+T,x:x+T]+=wm
neural=acc/wt; print('neural',round(time.time()-t,1),'s',flush=True)
enc=ort.InferenceSession(os.path.join(M,'mobilesam-encoder.onnx'),so); dec=ort.InferenceSession(os.path.join(M,'mobilesam-decoder.onnx'),so)
mean=np.array([123.675,116.28,103.53],np.float32); std=np.array([58.395,57.12,57.375],np.float32)
cover=np.zeros((rh,rw),np.uint8); tried=np.zeros((rh,rw),np.uint8); polys=[]; G=18; st2=int(T*0.75); rng=np.random.default_rng(0); nd=0
for ty in pos(rh,T,st2):
  for tx in pos(rw,T,st2):
    emb=enc.run(None,{'input_image':((cv2.resize(R[ty:ty+T,tx:tx+T],(1024,1024),interpolation=cv2.INTER_LINEAR)-mean)/std).transpose(2,0,1)[None].astype(np.float32)})[0]
    sc=1024/T; g=0.03+0.94*np.arange(G)/(G-1); pts=[(tx+a*T+rng.uniform(-4,4),ty+b*T+rng.uniform(-4,4)) for b in g for a in g]; rng.shuffle(pts)
    for px,py in pts:
        xi,yi=int(np.clip(px,0,rw-1)),int(np.clip(py,0,rh-1))
        if cover[yi,xi] or tried[yi,xi]: continue
        cv2.circle(tried,(xi,yi),6,1,-1)
        m,iou,low=dec.run(None,{'image_embeddings':emb,'point_coords':np.array([[[(px-tx)*sc,(py-ty)*sc],[0,0]]],np.float32),'point_labels':np.array([[1,-1]],np.float32),'mask_input':np.zeros((1,1,256,256),np.float32),'has_mask_input':np.zeros(1,np.float32),'orig_im_size':np.array([256,256],np.float32)}); nd+=1
        if iou[0,0]<0.75: continue
        mk=(low[0,0]>0).astype(np.uint8); a=mk.sum()
        if a<94 or a>16384 or mk[0].sum()+mk[-1].sum()+mk[:,0].sum()+mk[:,-1].sum()>3: continue
        up=cv2.resize(mk,(T,T),interpolation=cv2.INTER_NEAREST)
        sub=cover[ty:ty+T,tx:tx+T]; tot=up.sum()
        if tot and (sub[up>0]>0).sum()/tot>0.7: continue
        cover[ty:ty+T,tx:tx+T]|=up
        cs,_=cv2.findContours(mk,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_NONE); c=max(cs,key=cv2.contourArea).reshape(-1,2).astype(np.float32)
        c=(c+0.5)*(T/256)+np.array([tx,ty],np.float32)
        polys.append([round(float(v),2) for v in c.ravel()])
print('sam',nd,'decodes',len(polys),'polys',round(time.time()-t,1),'s',flush=True)
neural.astype(np.float32).tofile(os.path.join(D,name+'.neural.f32'))
np.asarray(reg.convert('L').resize((rw,rh),Image.BILINEAR),np.uint8).tofile(os.path.join(D,name+'.gray.u8'))
json.dump({'rw':rw,'rh':rh,'region':[x0,y0,x1,y1],'foto':os.path.abspath(foto),'polys':polys},open(os.path.join(D,name+'.json'),'w'))
