# Rilegge il DXF esportato (come farebbe un CAD) e lo disegna: verifica layer, chiusure e verso degli archi
import sys, math
from PIL import Image, ImageDraw
L=open(sys.argv[1]).read().split('\n'); pairs=[(L[i].strip(),L[i+1].strip()) for i in range(0,len(L)-1,2)]
ents=[]; cur=None; layers={}; ltypes=[]
i=0; sec=None
while i<len(pairs):
    c,v=pairs[i]
    if c=='0' and v=='SECTION': sec=pairs[i+1][1]
    if sec=='TABLES' and c=='0' and v=='LAYER':
        d={}; j=i+1
        while pairs[j][0]!='0': d[pairs[j][0]]=pairs[j][1]; j+=1
        layers[d.get('2')]=(d.get('62'),d.get('6'))
    if sec=='TABLES' and c=='0' and v=='LTYPE':
        ltypes.append(pairs[i+1][1])
    if sec=='ENTITIES' and c=='0':
        if v=='LINE':
            d={}; j=i+1
            while pairs[j][0]!='0': d[pairs[j][0]]=pairs[j][1]; j+=1
            ents.append(('LINE',d['8'],[(float(d['10']),float(d['20']),0),(float(d['11']),float(d['21']),0)],False))
        elif v=='POLYLINE':
            d={}; j=i+1
            while pairs[j][0]!='0': d[pairs[j][0]]=pairs[j][1]; j+=1
            cur=['POLY',d['8'],[],d.get('70')=='1']
        elif v=='VERTEX':
            d={}; j=i+1
            while pairs[j][0]!='0': d[pairs[j][0]]=pairs[j][1]; j+=1
            cur[2].append((float(d['10']),float(d['20']),float(d.get('42',0))))
        elif v=='SEQEND': ents.append(tuple(cur)); cur=None
    i+=1
from collections import Counter
print('layers',layers); print('ltypes',ltypes); print(Counter((e[0],e[1]) for e in ents))
xs=[p[0] for e in ents for p in e[2]]; ys=[p[1] for e in ents for p in e[2]]
x0,x1,y0,y1=min(xs),max(xs),min(ys),max(ys); S=1400/max(x1-x0,y1-y0)
im=Image.new('RGB',(int((x1-x0)*S)+20,int((y1-y0)*S)+20),'white'); dr=ImageDraw.Draw(im)
T=lambda x,y:(10+(x-x0)*S, 10+(y1-y)*S)
col={'STRUTTURA':(0,0,0),'ELEMENTI':(20,60,200),'DETTAGLI':(140,140,140),'RICOSTRUZIONI':(230,120,0)}
for kind,ly,pts,closed in ents:
    n=len(pts); m=n if closed else n-1
    for k in range(m):
        a=pts[k]; b=pts[(k+1)%n]; bu=a[2]
        if not bu: dr.line([T(a[0],a[1]),T(b[0],b[1])],fill=col[ly],width=2); continue
        # DXF: bulge>0 = antiorario (assi y in su)
        th=4*math.atan(bu); c=math.hypot(b[0]-a[0],b[1]-a[1]); r=c/(2*math.sin(abs(th)/2))
        mx,my=(a[0]+b[0])/2,(a[1]+b[1])/2; ux,uy=(b[0]-a[0])/c,(b[1]-a[1])/c; nx,ny=-uy,ux
        d=r*math.cos(abs(th)/2); s=1 if bu>0 else -1
        cx,cy=mx+nx*d*s,my+ny*d*s   # centro a sinistra della corda se antiorario
        a0=math.atan2(a[1]-cy,a[0]-cx); seg=[T(cx+r*math.cos(a0+th*q/16),cy+r*math.sin(a0+th*q/16)) for q in range(17)]
        dr.line(seg,fill=col[ly],width=2)
im.save(sys.argv[2]); print(im.size)
