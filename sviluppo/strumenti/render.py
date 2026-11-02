import json,sys,math
from PIL import Image,ImageDraw
import os
D=os.path.join(os.path.dirname(os.path.abspath(__file__)),'dati')
name=sys.argv[1]; bg=sys.argv[2] if len(sys.argv)>2 else 'white'
meta=json.load(open(os.path.join(D,name+'.json'))); x0,y0,x1,y1=meta['region']
P=json.load(open(os.path.join(D,name+'.paths.json')))
src=Image.open(meta['foto']).convert('RGB')
S=2; W,H=(x1-x0)*S,(y1-y0)*S
im=src.crop((x0,y0,x1,y1)).resize((W,H)) if bg=='over' else Image.new('RGB',(W,H),'white')
if bg=='over': im=Image.blend(im,Image.new('RGB',(W,H),'white'),0.55)
d=ImageDraw.Draw(im)
col={0:(0,0,0),1:(20,60,200),2:(110,110,110),3:(220,40,20)}; wid={0:3,1:2,2:1,3:2}
def arcpts(P0,P1,b,n=16):
    (ax,ay),(bx,by)=P0,P1; c=math.hypot(bx-ax,by-ay)
    if c<1e-6: return [P0,P1]
    th=4*math.atan(b); r=c/(2*math.sin(th/2)); mx,my=(ax+bx)/2,(ay+by)/2
    nx,ny=-(by-ay)/c,(bx-ax)/c; d0=r*math.cos(th/2)
    # centro: dalla corda verso il lato opposto alla freccia
    s=(c/2)*b  # sagitta signed along normal
    cx,cy=mx-nx*(d0)*(1 if b>0 else 1)*(-1 if b>0 else -1), my-ny*d0*(-1 if b>0 else -1)
    # robust: compute center so that midpoint of arc = mid + normal*s
    pmx,pmy=mx+nx*s,my+ny*s
    # circle through A,B,M
    def circ(a,b2,m):
        ax,ay=a;bx,by=b2;cx,cy=m
        dd=2*(ax*(by-cy)+bx*(cy-ay)+cx*(ay-by))
        ux=((ax*ax+ay*ay)*(by-cy)+(bx*bx+by*by)*(cy-ay)+(cx*cx+cy*cy)*(ay-by))/dd
        uy=((ax*ax+ay*ay)*(cx-bx)+(bx*bx+by*by)*(ax-cx)+(cx*cx+cy*cy)*(bx-ax))/dd
        return ux,uy
    ux,uy=circ(P0,P1,(pmx,pmy)); R=math.hypot(ax-ux,ay-uy)
    a0=math.atan2(ay-uy,ax-ux); a1=math.atan2(by-uy,bx-ux); am=math.atan2(pmy-uy,pmx-ux)
    def norm(a): return (a+2*math.pi)%(2*math.pi)
    # choose direction passing through am
    d1=norm(a1-a0); dm=norm(am-a0)
    sweep=d1 if dm<d1 else d1-2*math.pi
    return [(ux+R*math.cos(a0+sweep*t/n),uy+R*math.sin(a0+sweep*t/n)) for t in range(n+1)]
for p in P:
    v=p['v']; n=len(v)//2; m=n if p['c'] else n-1
    for i in range(m):
        j=(i+1)%n; A=((v[2*i]-x0)*S,(v[2*i+1]-y0)*S); B=((v[2*j]-x0)*S,(v[2*j+1]-y0)*S)
        b=p['b'][i] if i<len(p['b']) else 0
        pts=arcpts(A,B,b) if b else [A,B]
        d.line(pts,fill=col[p['l']],width=wid[p['l']])
im.save(os.path.join(D,'%s_%s.png'%(name,bg))); print(im.size)
