"""Deterministic 3D README artwork. Requires Python 3, Pillow and NumPy.

CPU-rasterized, depth-sorted geometry, not browser screenshots or generated photos.
Run: python3 render-assets.py --output .github/readme
Font overrides make regeneration portable across machines.
"""
import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

P = argparse.ArgumentParser()
P.add_argument('--output', type=Path, required=True)
P.add_argument('--frames', type=int, default=72)
P.add_argument('--sans', default='/System/Library/Fonts/Helvetica.ttc')
P.add_argument('--serif', default='/System/Library/Fonts/Supplemental/Georgia Italic.ttf')
P.add_argument('--mono', default='/System/Library/Fonts/Menlo.ttc')
P.add_argument('--logo', type=Path, help='Rasterized copy of the canonical Continuum lockup')
args = P.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
S = 2
W, H = 1200, 640
INK = '#eeeae1'
AMBER = '#f3bd68'
MUTED = '#b5b2a8'
LINE = '#36342c'

def font(size, kind='sans'):
    return ImageFont.truetype(getattr(args, kind), int(size*S))

def text(d, x, y, s, size=14, color=INK, kind='sans'):
    d.text((x*S,y*S), s, font=font(size,kind), fill=color, anchor='lt')

def line(d, coords, color=LINE, width=1):
    d.line([(x*S,y*S) for x,y in coords],fill=color,width=max(1,int(width*S)))

def symbol(d, x, y, scale=1):
    for pts,color in [([(32,3),(7,17),(7,46),(19,53),(19,24),(44,10)],INK),
                      ([(32,61),(57,47),(57,18),(45,11),(45,40),(20,54)],AMBER),
                      ([(32,22),(42,32),(32,42),(22,32)],AMBER)]:
        d.polygon([((x+a*scale)*S,(y+b*scale)*S) for a,b in pts],fill=color)

def background():
    yy,xx=np.mgrid[0:H*S,0:W*S]
    glow=np.exp(-(((xx/S-872)/315)**2+((yy/S-320)/250)**2))
    img=np.zeros((H*S,W*S,3),dtype=np.uint8)
    for i,(b,c) in enumerate([(15,13),(17,10),(17,4)]): img[:,:,i]=b+glow*c
    return Image.fromarray(img)

def scene(img, t, center=(893,320), scale=108):
    d=ImageDraw.Draw(img)
    # World is Y-up. A restrained orbit changes the actual projected geometry.
    yaw=.22+math.sin(t*2*math.pi)*.12
    pitch=.51
    cz,sz=math.cos(-.12),math.sin(-.12)
    def camera(p):
        x,y,z=p
        x,z=x*math.cos(yaw)+z*math.sin(yaw),-x*math.sin(yaw)+z*math.cos(yaw)
        y,z=y*math.cos(pitch)-z*math.sin(pitch),y*math.sin(pitch)+z*math.cos(pitch)
        return x*cz-y*sz,x*sz+y*cz,z
    def project(p):
        x,y,z=camera(p)
        perspective=8/(8-z)
        return center[0]+x*scale*perspective,center[1]-y*scale*perspective
    def projected_line(pts,c=LINE,width=1): line(d,[project(p) for p in pts],c,width)
    for n in range(-5,6):
        projected_line([(n*.6,-1.75,-3),(n*.6,-1.75,3)],'#242723')
        projected_line([(-3,-1.75,n*.6),(3,-1.75,n*.6)],'#242723')
    # Elliptical orbital traces: quiet, never flashing.
    for j in range(2):
        pts=[]
        for k in range(129):
            a=k*math.tau/128
            pts.append((2.33*math.cos(a),1.65*math.sin(a),(.35+j*.9)*math.sin(a)))
        projected_line(pts,'#454032' if j==0 else '#2d3029')
    polygons=[]
    def face(pts,color):
        polygons.append((sum(camera(p)[2] for p in pts)/len(pts),pts,color))
    def shade(rgb,m): return tuple(min(255,max(0,int(c*m))) for c in rgb)
    spread=.87+.15*(1-math.cos(t*math.tau))
    for layer in range(3):
        cy=(layer-1)*spread
        outer=1.74-(layer*.11)
        inner=outer-.40
        gold=layer==1
        base=(219,164,74) if gold else (69,72,65)
        N=100
        rotation=t*math.tau*(1 if layer%2 else -1)/5
        def pt(r,a,y):return (r*math.cos(a),cy+y,r*math.sin(a))
        for k in range(N):
            a,b=k*math.tau/N,(k+1)*math.tau/N
            intensity=.78+.26*math.cos(a-1.6)
            face([pt(outer,a,-.105),pt(outer,b,-.105),pt(outer,b,.105),pt(outer,a,.105)],shade(base,intensity*.68))
            face([pt(inner,b,-.105),pt(inner,a,-.105),pt(inner,a,.105),pt(inner,b,.105)],shade(base,intensity*.46))
            face([pt(inner,a,.105),pt(outer,a,.105),pt(outer,b,.105),pt(inner,b,.105)],shade(base,1.09))
            # Narrow bevel catches light around the lip.
            face([pt(outer-.026,a,.13),pt(outer,a,.105),pt(outer,b,.105),pt(outer-.026,b,.13)],shade((238,205,138),.58+.27*math.cos(a)))
        for k in range(40):
            a=k*math.tau/40+rotation
            half=.024
            r1,r2=outer-.27,outer-.08
            c=(241,212,151) if k%8==0 else (28,31,28)
            if layer==1 and k==int(t*40)%40:c=(255,235,192)
            points=[pt(r1,a-half,.14),pt(r2,a-half,.14),pt(r2,a+half,.14),pt(r1,a+half,.14)]
            face(points,c)
            face([points[1],points[2],pt(r2,a+half,.09),pt(r2,a-half,.09)],shade(c,.6))
    # Extruded Continuum logo suspended inside the assembly.
    outlines=[([(32,3),(7,17),(7,46),(19,53),(19,24),(44,10)],(234,231,216)),
              ([(32,61),(57,47),(57,18),(45,11),(45,40),(20,54)],(240,186,95)),
              ([(32,22),(42,32),(32,42),(22,32)],(255,209,126))]
    for pts,c in outlines:
        front=[((x-32)/64*.85,(32-y)/64*.85,.15) for x,y in pts]
        back=[(x,y,-.10) for x,y,z in front]
        face(front,c)
        for i in range(len(front)):face([back[i-1],back[i],front[i],front[i-1]],shade(c,.55))
    for _,pts,c in sorted(polygons,key=lambda item:item[0]):
        d.polygon([(x*S,y*S) for x,y in map(project,pts)],fill=c)
    # A proof signal on the orbit, separate from the static editorial copy.
    a=t*math.tau
    x,y=project((2.33*math.cos(a),1.65*math.sin(a),.35*math.sin(a)))
    d.ellipse(((x-3)*S,(y-3)*S,(x+3)*S,(y+3)*S),fill=AMBER)

def hero(t):
    img=background()
    d=ImageDraw.Draw(img)
    # Precision frame, bespoke signature, editorial hierarchy.
    for x,y,sx,sy in [(24,24,1,1),(1176,24,-1,1),(24,616,1,-1),(1176,616,-1,-1)]:
        line(d,[(x,y+18*sy),(x,y),(x+18*sx,y)],'#62563d')
    if args.logo:
        logo=Image.open(args.logo).convert('RGBA')
        logo.thumbnail((int(150*S),int(44*S)),Image.Resampling.LANCZOS)
        img.paste(logo,(46*S,45*S),logo)
    else:
        symbol(d,46,45,.58)
        text(d,91,53,'ionify',30)
    text(d,815,55,'ENGINE / CONTINUUM 001',11,MUTED,'mono')
    text(d,53,148,'LESS WAITING. MORE BUILDING.',12,AMBER,'mono')
    text(d,49,191,'Keep the work.',61)
    text(d,49,263,'Keep the flow.',64,AMBER,'serif')
    text(d,53,367,'Your next edit deserves a shorter wait.',21)
    text(d,53,401,'A Rust-powered build engine that remembers',16,MUTED)
    text(d,53,426,'valid work, so you can keep moving.',16,MUTED)
    line(d,[(53,482),(548,482)],'#4b4333')
    text(d,53,507,'01  ESTABLISH',10,MUTED,'mono')
    text(d,231,507,'02  VERIFY',10,MUTED,'mono')
    text(d,392,507,'03  REUSE',10,AMBER,'mono')
    line(d,[(618,108),(618,540)],'#292d28')
    scene(img,t)
    text(d,725,581,'ONE GRAPH / ONE CAS / ONE AUTHORITY',10,MUTED,'mono')
    text(d,53,581,'THE BUILD ENGINE THAT DOES NOT START OVER.',9,MUTED,'mono')
    return img.resize((W,H),Image.Resampling.LANCZOS)

def benchmark():
    img=Image.new('RGB',(W*S,310*S),'#101211');d=ImageDraw.Draw(img)
    text(d,38,30,'01 / THE NEXT BUILD',12,AMBER,'mono')
    text(d,778,30,'ONE PROJECT / DEVELOPER-REPORTED',11,MUTED,'mono')
    for x in [404,797]:line(d,[(x,75),(x,249)],'#3d3c32')
    data=[(38,'~30','ms','NO CHANGES','Check the same output again.'),
          (435,'~120','ms','ONE FILE CHANGED','Get back to checking the edit.'),
          (827,'5–6','s','FIRST BUILD','The first run does real work.')]
    for x,num,unit,label,sub in data:
        text(d,x,90,num,67,AMBER if x<800 else INK)
        width=d.textlength(num,font=font(67))/S
        text(d,x+width+9,122,unit,22,MUTED)
        text(d,x,184,label,11,INK,'mono')
        text(d,x,216,sub,14,MUTED)
    line(d,[(38,261),(1162,261)],'#393a32')
    text(d,38,278,'15,000 React components · 25,000 dependencies · Full comparison and limitations below.',12,MUTED)
    return img.resize((W,310),Image.Resampling.LANCZOS)

def architecture():
    # An isometric memory stack, not a literal execution trace.
    img=Image.new('RGB',(W*S,460*S),'#101211');d=ImageDraw.Draw(img)
    text(d,40,28,'04 / OPEN THE ENGINE',12,AMBER,'mono')
    text(d,40,79,'Keep knowledge.',43)
    text(d,40,133,'Not just files.',46,AMBER,'serif')
    text(d,40,216,'Remember the relationships.',18,INK)
    text(d,40,250,'Retain the artifacts.',18,INK)
    text(d,40,284,'Verify before reuse.',18,INK)
    text(d,40,386,'CONCEPTUAL VIEW / NOT A LIVE TRACE',10,MUTED,'mono')
    centerX=780
    for i,(label,c) in enumerate([('PERSISTENT GRAPH','#5c655c'),('CONTENT-ADDRESSED STORE','#d6a251'),('BUILD AUTHORITY','#7b8173')]):
        y=312-i*100
        p=[(centerX-220,y),(centerX,y-87),(centerX+220,y),(centerX,y+87)]
        d.polygon([(x*S,z*S) for x,z in [(p[0]),(p[3]),(p[2]),(p[2][0],p[2][1]+14),(p[3][0],p[3][1]+14),(p[0][0],p[0][1]+14)]],fill='#343b32')
        d.polygon([(x*S,z*S) for x,z in p],fill='#202722',outline=c,width=2*S)
        for n in range(5):
            xx=centerX+(n-2)*48
            d.polygon([(xx*S,(y-7)*S),((xx+16)*S,y*S),(xx*S,(y+7)*S),((xx-16)*S,y*S)],fill=c)
        line(d,[(1001,y),(1110,y)],c)
        text(d,970,y+23,f'0{3-i}',11,c,'mono')
        text(d,605,y+36,label,11,INK,'mono')
    return img.resize((W,460),Image.Resampling.LANCZOS)

frames=[]
for i in range(args.frames):
    frame=hero(i/args.frames)
    if i==0:
        frame.save(args.output/'continuum-still.png',optimize=True)
        palette=frame.quantize(colors=192,method=Image.Quantize.MEDIANCUT)
    frames.append(frame.quantize(palette=palette,dither=Image.Dither.NONE))
    if i%18==0:print(f'Rendered frame {i+1}/{args.frames}',flush=True)
frames[0].save(args.output/'continuum.gif',save_all=True,append_images=frames[1:],duration=80,loop=0,optimize=True,disposal=1)
benchmark().save(args.output/'reported-builds.png',optimize=True)
architecture().save(args.output/'memory-stack.png',optimize=True)
for path in args.output.glob('*'):print(f'{path.name}: {path.stat().st_size:,} bytes')
