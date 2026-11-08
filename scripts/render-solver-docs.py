"""Render labelled solver diagrams and actual World trajectories (requires Pillow)."""
import json
import math
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT/'screenshots/solver-docs/frames.json').read_text(encoding='utf-8'))
OUT = ROOT/'docs/images/solvers'
OUT.mkdir(parents=True, exist_ok=True)
BG, INK, MUTED, GRID, BLUE, ORANGE = '#f8faf6','#203e43','#61777a','#e5ece6','#087f8c','#bc5d30'

def font(size, bold=False):
    candidates = [Path('C:/Windows/Fonts')/('arialbd.ttf' if bold else 'arial.ttf'),
                  Path('/usr/share/fonts/truetype/dejavu')/('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf')]
    return ImageFont.truetype(str(next(p for p in candidates if p.exists())),size)

def text(d, xy, value, size=20, color=INK, bold=False):
    d.text(xy,value,font=font(size,bold),fill=color)

def label(d, xy, value, color=INK, size=19):
    # Labels are positioned by their top-left box edge, not by a text baseline.
    box=d.textbbox(xy,value,font=font(size,True))
    d.rounded_rectangle((box[0]-4,box[1]-3,box[2]+4,box[3]+3),radius=3,fill=BG)
    text(d,xy,value,size,color,True)

def arrow(d, a, b, color=ORANGE, width=3):
    d.line([a,b],fill=color,width=width)
    theta=math.atan2(b[1]-a[1],b[0]-a[0])
    d.polygon([b,(b[0]-12*math.cos(theta-.45),b[1]-12*math.sin(theta-.45)),
                 (b[0]-12*math.cos(theta+.45),b[1]-12*math.sin(theta+.45))],fill=color)

def support(d, x, y, vertical=False):
    if vertical:
        d.line((x,y-25,x,y+25),fill=INK,width=5)
        for offset in range(-24,25,8): d.line((x,y+offset,x-10,y+offset+9),fill=INK,width=2)
    else:
        d.line((x-20,y,x+20,y),fill=INK,width=5)
        for offset in range(-20,21,8): d.line((x+offset,y+2,x+offset-8,y+12),fill=INK,width=2)

def canvas(title, subtitle, size=(1160,720)):
    im=Image.new('RGB',size,BG); d=ImageDraw.Draw(im)
    text(d,(35,20),title,30,bold=True); text(d,(35,64),subtitle,18,MUTED)
    return im,d

def tower_diagram():
    im,d=canvas('Shared structure A–E', 'Export coordinates: X points right, Y points up. Beam profile: Light.')
    scale=39; ox,oy=340,358
    def pt(x,y): return (ox+x*scale,oy-y*scale)
    for tick in range(-6,7):
        d.line([pt(tick,-6),pt(tick,6)],fill=GRID,width=1)
        d.line([pt(-6,tick),pt(6,tick)],fill=GRID,width=1)
    coords={'A':(0,-6),'B':(0,0),'C':(0,5),'D':(-3,0),'E':(3,0)}
    edges=[('D','C'),('C','B'),('C','E'),('B','A')]
    for i,(a,b) in enumerate(edges):
        d.line([pt(*coords[a]),pt(*coords[b])],fill=BLUE,width=5)
        x=(coords[a][0]+coords[b][0])/2; y=(coords[a][1]+coords[b][1])/2
        label(d,(pt(x,y)[0]+(12 if i in [1,2,3] else -18),pt(x,y)[1]),f'b{i+1}',BLUE)
    for name,(x,y) in coords.items():
        px,py=pt(x,y); d.ellipse((px-5,py-5,px+5,py+5),fill=INK)
        label(d,(px+12,py-27 if name!='B' else py+10),f'{name} ({x}, {y})',size=17)
    support(d,*pt(0,-6)); arrow(d,(595,230),(595,300)); text(d,(615,246),'g = 9.81',19,ORANGE)
    for i,line in enumerate(['A: fixed board-edge support','B: rigid column-to-b2 joint','C: shared joint of b1, b2, and b3','D, E: free diagonal ends',
                             'b1 = DC, b2 = CB, b3 = CE, b4 = BA','b1 and b3: length √34 ≈ 5.831','b2: length 5; b4: length 6']):
        text(d,(715,145+i*49),line,18)
    text(d,(715,535),'D and E are not supports.',19,ORANGE,True)
    text(d,(35,670),'Figure 1 · The guides and animations use the same labels b1–b4 and A–E.',17,MUTED)
    im.save(OUT/'tower.png')

def distance_diagram():
    im,d=canvas('One Distance Correction P–Q', 'One-dimensional example using an interior segment of a Standard beam.',(1160,590))
    for y,start,end,title in [(180,180,850,'Before correction: |PQ| = 0.510000'),(355,190,840,'After one correction: |PQ| ≈ 0.500016')]:
        text(d,(60,y-60),title,23,bold=True)
        d.line((start,y,end,y),fill=BLUE,width=6)
        for x,name in [(start,'P'),(end,'Q')]:
            d.ellipse((x-7,y-7,x+7,y+7),fill=BLUE); label(d,(x-10,y+15),name,BLUE)
    arrow(d,(180,240),(260,240)); arrow(d,(850,240),(770,240))
    text(d,(350,222),'Both points move inward by 0.004992',21,ORANGE,True)
    text(d,(60,450),'L0 = 0.5     mP = mQ = 0.9     α = 0.0036     initial λ = 0',22)
    text(d,(60,505),'Figure 2 · Motion is enlarged for visibility; values come from XPBD.',17,MUTED)
    im.save(OUT/'distance.png')

def scan_diagram():
    im,d=canvas('Serpentine: starting side and row order', 'Separate example: S1–S4 are four horizontal beams.',(1160,620))
    for panel,left in enumerate([60,650]):
        right=panel==1
        text(d,(left,125),'u ≥ 0.5: left start' if not right else 'u < 0.5: right start',23,BLUE,True)
        for row,y in enumerate([245,390]):
            for col,x in enumerate([left+65,left+290]):
                d.line((x,y,x+100,y),fill=BLUE,width=6)
                label(d,(x+32,y+15),f'S{row*2+col+1}',BLUE)
            a,b=(left+20,left+440) if right==(row%2==1) else (left+440,left+20)
            arrow(d,(a,y-40),(b,y-40))
        order='S1 → S2 → S4 → S3' if not right else 'S2 → S1 → S3 → S4'
        text(d,(left+15,485),order,24,bold=True)
    text(d,(40,558),'Figure 3 · Each run draws a new u; repeated starting sides are valid.',19,MUTED)
    im.save(OUT/'serpentine-scan.png')

def branch_diagram():

def movie_panel(d, run, index, left, top, scale):
    frame=run['frames'][index]; initial=run['frames'][0]
    def pt(x,y): return (left+x*scale,top+y*scale)
    edge=12*scale
    d.rectangle((left,top,left+edge,top+edge),fill='#ffffff',outline='#bccdc4',width=2)
    for tick in range(1,12):
        d.line([pt(tick,0),pt(tick,12)],fill=GRID,width=1)
        d.line([pt(0,tick),pt(12,tick)],fill=GRID,width=1)
    # Label the fixed, ghosted reference structure. C(t) below is the moving node;
    # C0 and b1–b4 always describe the initial shape, never the deformed member.
    for i,beam in enumerate(DATA['project']['beams']):
        ax,ay,bx,by=beam['endpoints']; d.line([pt(ax,ay),pt(bx,by)],fill='#ced8d0',width=3)
        x,y=pt((ax+bx)/2,(ay+by)/2)
        text(d,(x+7,y-7),f'b{i+1}',15,'#84988b')
    for name,(x,y) in DATA['nodes'].items():
        px,py=pt(x,y); text(d,(px+15 if name=='C' else px+9,py-42 if name=='C' else py-21),'C0' if name=='C' else name,15,'#84988b',True)
    color=ORANGE if run['id']=='serpentine-right' else BLUE
    for owner,m in enumerate(run['members']):
        for side in range(2):
            start=m['start']+side*m['half']
            points=[pt(frame['x'][i],frame['y'][i]) for i in range(start,start+m['half'])]
            d.line(points,fill='#bb3e29' if frame['broken'][owner] else color,width=4,joint='curve')
    ids=run['tracked']['C']; x=sum(frame['x'][i] for i in ids)/len(ids); y=sum(frame['y'][i] for i in ids)/len(ids)
    px,py=pt(x,y); d.ellipse((px-5,py-5,px+5,py+5),fill=ORANGE)
    # Clamp the label box to panel edges after the node reaches a board boundary.
    label(d,(max(left+5,min(px+10,left+edge-50)),max(top+5,min(py-26,top+edge-28))),'C(t)',ORANGE,16)
    support(d,*pt(6,12))
    return x-6,sum(frame['broken'])

def movie(name, ids, title):
    runs=[next(r for r in DATA['runs'] if r['id']==id) for id in ids]
    two=len(runs)==2
    width=1100 if two else 720
    frames=[]
    for index in range(len(runs[0]['frames'])):
        im,d=canvas(title,f'World {DATA["gameVersion"]} · Δt = 1/120 s · 12 iterations · g = 9.81',(width,740))
        for panel,run in enumerate(runs):
            left=55+panel*550 if two else 115
            scale=36 if two else 40
            text(d,(left,108),('Right start' if panel else 'Left start') if two else 'Simulated trajectory',21,bold=True)
            offset,broken=movie_panel(d,run,index,left,150,scale)
            text(d,(left,648),f'ΔxC = {offset:+.3f} · broken: {broken}',18,bold=True)
        t=runs[0]['frames'][index]['time']
        text(d,(35,693),f't = {t:05.2f} s · speed 1× · gray outline: initial shape',18,MUTED)
        frames.append(im)
    durations=[100]*len(frames); durations[0]=800; durations[-1]=1400
    frames[0].save(OUT/name,save_all=True,append_images=frames[1:],duration=durations,loop=0,optimize=True)
    frames[50].save(ROOT/'screenshots/solver-docs'/name.replace('.gif','-preview.png'))

tower_diagram(); distance_diagram(); scan_diagram(); branch_diagram()
if '--diagrams-only' not in sys.argv:
    movie('original.gif',['original'],'1 · Basic XPBD Solver')
    movie('serpentine.gif',['serpentine-left','serpentine-right'],'2 · Serpentine: both starting sides')
print(f'Rendered diagrams and animations in {OUT}')
