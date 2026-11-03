import csv,collections,unicodedata
rows=list(csv.DictReader(open('/Users/raulcamunas/Downloads/transaction-logs.csv',encoding='utf-8-sig',newline=''),delimiter=';'))
def num(s):
    try: return float(s)
    except: return 0.0
def norm(s):
    s=unicodedata.normalize('NFD',s.lower().strip()); return ''.join(c for c in s if unicodedata.category(c)!='Mn')
lin=collections.defaultdict(dict)
for x in rows:
    k=(x['Número de pedido'],x['ID de la posición de pedido'])
    if x['Tipo']=='Importe del pedido': lin[k]['p']=num(x['Importe']); lin[k]['c']=x['Etiqueta de categoría']; lin[k]['y']=int(x['Fecha de creación'][6:10])
    elif x['Tipo']=='Comisiones': lin[k]['f']=abs(num(x['Importe']))
L=[v for v in lin.values() if 'p' in v and 'f' in v and v['p']>0]
bycat=collections.defaultdict(list)
for v in L: bycat[v['c']].append(v)
def fit(pts):
    n=len(pts); sx=sum(p for p,_ in pts); sy=sum(f for _,f in pts); sxx=sum(p*p for p,_ in pts); sxy=sum(p*f for p,f in pts)
    d=n*sxx-sx*sx
    if d==0: return None
    b=(n*sxy-sx*sy)/d; return (sy-b*sx)/n,b
out={}
for c,vs in bycat.items():
    k=norm(c)
    recent=[v for v in vs if v['y']>=2025]; mid=[v for v in vs if v['y']>=2023]
    f=fit([(v['p'],v['f']) for v in mid]) if len(mid)>=12 else None
    if f and 0<=f[0]<=1.5 and 0.05<=f[1]<=0.3:
        out[k]=(round(f[0],2),round(f[1],4),len(mid),'ajustada'); continue
    src=recent if recent else vs
    pct=sum(v['f'] for v in src)/sum(v['p'] for v in src)
    out[k]=(0,round(pct,4),len(recent),'reciente') if recent else (0,round(pct+0.03,4),len(vs),'antigua')
lines=[f"  [{k!r}, {{ fija: {a}, pct: {b}, lineas: {n}, origen: '{o}' }}]," for k,(a,b,n,o) in sorted(out.items(),key=lambda t:-t[1][2])]
cab=open('lib/pccomponentes/comisiones.ts').read().split('export const COMISIONES_POR_CATEGORIA')[0]
open('lib/pccomponentes/comisiones.ts','w').write(cab+"export const COMISIONES_POR_CATEGORIA: ReadonlyMap<string, TarifaComision> = new Map<string, TarifaComision>([\n"+"\n".join(lines)+"\n])\n")
print(len(out),sum(1 for v in out.values() if v[3]=='ajustada'),'ajustadas')
for k in ('sillas','portatiles','cables'): print(k,out.get(k))
