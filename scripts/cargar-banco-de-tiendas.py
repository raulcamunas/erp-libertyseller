#!/usr/bin/env python3
"""
Carga las tiendas de los niveles 1 a 3 de «Tienda no Amazon.xlsx» en cold_lead_banco (migración 257).

  python3 scripts/cargar-banco-de-tiendas.py --comprobar         lee el Excel, valida y cuenta; NO escribe nada en ninguna parte
  python3 scripts/cargar-banco-de-tiendas.py --csv salida.csv    además escribe un CSV (para probar en una base local con \\copy)
  python3 scripts/cargar-banco-de-tiendas.py --prod --si         carga en PRODUCCIÓN (API REST con la clave de servicio de .env.local) y enlaza con los leads que ya existen

Hace falta haber lanzado antes la migración 257 (crea cold_lead_banco y sus funciones) y tener openpyxl instalado.

Es IDEMPOTENTE: repetirlo actualiza lo que ya está (clave: dominio) y no toca lead_id, anadido_a, anadido_at ni anadido_por, así que no desreparte nada.
Se niega a seguir si ve algo que no esperaba (un nivel, un tipo de empresa o un tramo desconocido): mejor parar que cargar mal 23.000 filas.
No imprime ningún dato de ninguna tienda: solo recuentos.
"""
import csv, json, os, re, subprocess, sys, time, collections

EXCEL = os.path.expanduser('~/Desktop/Tienda no Amazon.xlsx')
ENV_LOCAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env.local')
HOJAS = {'1 - Potencial alto': 1, '2 - Muy buenos números': 2, '3 - Leads correctos': 3}   # la hoja «4 - Descartados» NO se carga: no se reparte nunca
DOMINIO = re.compile(r'^[a-z0-9][a-z0-9.-]*\.[a-z0-9-]{2,}$')                              # la misma regla que anadirDelBanco (lib/cold-calling/listas-servidor.ts)
TRAMOS = {'A', 'B', 'C', 'D', 'G'}
TIPOS = {'Sociedad': 'sociedad', 'Autónomo': 'autonomo', 'Autonomo': 'autonomo'}
LOTE = 500

COLUMNAS = ['dominio', 'tienda', 'url', 'nivel', 'tramo', 'puntos', 'plataforma', 'ciudad', 'categoria_grupo', 'ventas_mes_usd', 'visitas_mes', 'n_productos', 'anios', 'ya_en_amazon',
            'email', 'emails_extra', 'telefono', 'telefonos_extra', 'instagram', 'linkedin', 'razon_social', 'cif', 'tipo_empresa', 'domicilio_social', 'registro_mercantil',
            'decisor', 'decisor_cargo', 'decisores_activos', 'motivo_descarte']
NUMERICAS = {'puntos', 'ventas_mes_usd', 'visitas_mes', 'anios'}
ENTERAS = {'n_productos', 'decisores_activos'}


def texto(v, maximo=None):
    if v is None:
        return None
    t = str(v).strip()
    if t == '' or t.lower() in ('nan', 'none', 'null'):
        return None
    return t[:maximo] if maximo else t


def numero(v):
    t = texto(v)
    if t is None:
        return None
    t = t.replace(' ', '')
    if ',' in t and '.' in t:
        t = t.replace('.', '').replace(',', '.')
    else:
        t = t.replace(',', '.')
    try:
        n = float(t)
    except ValueError:
        raise SystemExit(f'Un número que no se entiende: {v!r}')
    return n


def mapear(fila, indice, nivel_hoja):
    o = {}
    dominio = (texto(fila[indice['dominio']]) or '').lower()
    o['dominio'] = dominio
    o['tienda'] = texto(fila[indice['tienda']]) or dominio
    o['url'] = texto(fila[indice['url']])
    o['nivel'] = nivel_hoja
    nivel_col = texto(fila[indice['nivel']])
    if nivel_col is None or int(nivel_col.split(' ')[0]) != nivel_hoja:
        raise SystemExit(f'El nivel de una fila ({nivel_col!r}) no es el de su hoja ({nivel_hoja}).')
    tramo = texto(fila[indice['tramo']])
    if tramo is None or tramo[0].upper() not in TRAMOS:
        raise SystemExit(f'Un tramo que no se conoce: {tramo!r}')
    o['tramo'] = tramo
    for c in ['plataforma', 'ciudad', 'categoria_grupo', 'ya_en_amazon', 'email', 'emails_extra', 'telefono', 'telefonos_extra', 'instagram', 'linkedin', 'razon_social', 'cif', 'domicilio_social',
              'registro_mercantil', 'decisor', 'decisor_cargo', 'motivo_descarte']:
        o[c] = texto(fila[indice[c]])
    tipo = texto(fila[indice['tipo_empresa']])
    if tipo is not None and tipo not in TIPOS:
        raise SystemExit(f'Un tipo de empresa que no se conoce: {tipo!r}')
    o['tipo_empresa'] = TIPOS.get(tipo) if tipo else None
    for c in NUMERICAS:
        o[c] = numero(fila[indice[c]])
    for c in ENTERAS:
        n = numero(fila[indice[c]])
        o[c] = None if n is None else int(n)
    return o


def leer():
    import openpyxl
    wb = openpyxl.load_workbook(EXCEL, read_only=True)
    filas, vistos, saltadas = [], set(), collections.Counter()
    for hoja, nivel in HOJAS.items():
        ws = wb[hoja]
        it = ws.iter_rows(values_only=True)
        cab = [str(c) for c in next(it)]
        indice = {c: i for i, c in enumerate(cab)}
        faltan = [c for c in ['dominio', 'tienda', 'url', 'tramo', 'nivel', 'tipo_empresa', 'categoria_grupo'] + list(NUMERICAS | ENTERAS) if c not in indice]
        if faltan:
            raise SystemExit(f'A la hoja «{hoja}» le faltan columnas: {faltan}')
        for r in it:
            if r[indice['dominio']] is None:
                continue
            o = mapear(r, indice, nivel)
            if not DOMINIO.match(o['dominio']):
                saltadas['dominio que la pantalla no podría añadir'] += 1
                continue
            if o['dominio'] in vistos:
                saltadas['dominio repetido'] += 1
                continue
            vistos.add(o['dominio'])
            filas.append(o)
    return filas, saltadas


def resumen(filas, saltadas):
    print(f'{len(filas):,} tiendas listas para cargar'.replace(',', '.'))
    for k, v in saltadas.items():
        print(f'  saltadas · {k}: {v}')
    print('  por nivel:', dict(sorted(collections.Counter(f['nivel'] for f in filas).items())))
    print('  por tramo:', dict(sorted(collections.Counter(f['tramo'][0] for f in filas).items())))
    print('  tipo de empresa:', dict(collections.Counter(f['tipo_empresa'] or 'sin tipo' for f in filas)))
    print('  con teléfono:', sum(1 for f in filas if f['telefono']), '· con correo:', sum(1 for f in filas if f['email']), '· con decisor:', sum(1 for f in filas if f['decisor']))
    print('  sin url:', sum(1 for f in filas if not f['url']), '· sin ventas:', sum(1 for f in filas if f['ventas_mes_usd'] is None))


def entorno():
    env = {}
    for l in open(ENV_LOCAL):
        l = l.strip()
        if l and not l.startswith('#') and '=' in l:
            k, v = l.split('=', 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env['NEXT_PUBLIC_SUPABASE_URL'].rstrip('/'), env['SUPABASE_SERVICE_ROLE_KEY']


def llamar(url, clave, cuerpo, extra=None, intentos=4):
    """POST con JSON. Va por curl, como consulta.py: el Python de este Mac no valida los certificados de Supabase."""
    cab = {'apikey': clave, 'Authorization': f'Bearer {clave}', 'Content-Type': 'application/json'}
    cab.update(extra or {})
    orden = ['curl', '-sS', '--max-time', '180', '-w', '\n%{http_code}', '-X', 'POST', '--data-binary', '@-']
    for k, v in cab.items():
        orden += ['-H', f'{k}: {v}']
    orden.append(url)
    for n in range(intentos):
        r = subprocess.run(orden, input=json.dumps(cuerpo).encode('utf-8'), capture_output=True)
        if r.returncode == 0:
            texto, _, codigo = r.stdout.decode('utf-8', 'replace').rpartition('\n')
            estado = int(codigo)
            if estado < 500 or n == intentos - 1:
                if estado >= 300:
                    raise SystemExit(f'La base contestó {estado}: {texto[:300]}')
                return estado, texto
        elif n == intentos - 1:
            raise SystemExit(f'No se pudo conectar (curl {r.returncode})')
        time.sleep(2 * (n + 1))


def cargar_en_produccion(filas):
    base, clave = entorno()
    ruta = f'{base}/rest/v1/cold_lead_banco?on_conflict=dominio'
    for i in range(0, len(filas), LOTE):
        trozo = [{c: f[c] for c in COLUMNAS} for f in filas[i:i + LOTE]]
        llamar(ruta, clave, trozo, {'Prefer': 'resolution=merge-duplicates,return=minimal'})
        print(f'  cargadas {min(i + LOTE, len(filas)):>6} de {len(filas)}', end='\r', flush=True)
    print()
    status, cuerpo = llamar(f'{base}/rest/v1/rpc/cold_banco_enlazar', clave, {})
    print('  enlazadas con un lead que ya existía:', json.loads(cuerpo).get('enlazadas'))
    status, cuerpo = llamar(f'{base}/rest/v1/rpc/cold_banco_resumen', clave, {})
    r = json.loads(cuerpo)
    print(f"  el banco ahora: {r['total']} tiendas · {r['libres']} por repartir · {r['descartadas']} descartadas · por nivel {r['por_nivel']}")


if __name__ == '__main__':
    args = sys.argv[1:]
    if not args or args[0] not in ('--comprobar', '--csv', '--prod'):
        raise SystemExit(__doc__)
    filas, saltadas = leer()
    resumen(filas, saltadas)
    if args[0] == '--csv':
        with open(args[1], 'w', newline='', encoding='utf-8') as f:
            w = csv.writer(f)
            w.writerow(COLUMNAS)
            for fila in filas:
                w.writerow(['' if fila[c] is None else fila[c] for c in COLUMNAS])
        print('CSV escrito:', args[1])
    elif args[0] == '--prod':
        if '--si' not in args:
            raise SystemExit('Esto escribe en PRODUCCIÓN. Añade --si para confirmarlo.')
        cargar_en_produccion(filas)
