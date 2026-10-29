#!/usr/bin/env python3
"""Genera lib/festivos/datos/<año>.ts a partir de la «Resolución de la Dirección General de Trabajo por la que se publica la
relación de fiestas laborales para el año <año>» del BOE (la publican cada octubre).

Uso:
    /Users/raulcamunas/venv/bin/python scripts/festivos-desde-boe.py --boe BOE-A-2026-21254 --anio 2027
    /Users/raulcamunas/venv/bin/python scripts/festivos-desde-boe.py --archivo boe.xml --anio 2027      # con el XML ya descargado

Descarga con curl (no urllib: los certificados de este Mac). Lee la tabla del anexo (una fila por fiesta, una columna por comunidad) y
las dos notas al pie (las fiestas de cada isla de Canarias y la sustitución en el Valle de Arán). Si no entiende algo, PARA: un
calendario a medias es peor que ninguno. Después hay que añadir el año en lib/festivos/datos/index.ts.
"""
import argparse
import re
import subprocess
import sys
import unicodedata
from pathlib import Path
from xml.etree import ElementTree as ET

RAIZ = Path(__file__).resolve().parent.parent

MESES = {'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4, 'mayo': 5, 'junio': 6, 'julio': 7, 'agosto': 8, 'septiembre': 9, 'setiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12}

# La cabecera del anexo, normalizada, a código de comunidad (ISO 3166-2:ES). Se casa por NOMBRE, nunca por posición.
COLUMNAS = {
    'andalucia': 'AN', 'aragon': 'AR', 'asturias': 'AS', 'illes balears': 'IB', 'canarias': 'CN', 'cantabria': 'CB', 'castilla la mancha': 'CM',
    'castilla y leon': 'CL', 'cataluna': 'CT', 'extremadura': 'EX', 'galicia': 'GA', 'com madrid': 'MD', 'com de madrid': 'MD', 'comunidad de madrid': 'MD',
    'region murcia': 'MC', 'region de murcia': 'MC', 'c foral navarra': 'NC', 'pais vasco': 'PV', 'la rioja': 'RI', 'comunitat valenciana': 'VC',
    'ciudad de ceuta': 'CE', 'ciudad de melilla': 'ME',
}
ISLAS = {'el hierro': 'hierro', 'fuerteventura': 'fuerteventura', 'gran canaria': 'gran-canaria', 'la gomera': 'gomera', 'la palma': 'palma',
         'lanzarote y la graciosa': 'lanzarote', 'lanzarote': 'lanzarote', 'tenerife': 'tenerife'}


def norm(s):
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9]+', ' ', s)).strip()


def texto(e):
    return ' '.join(''.join(e.itertext()).split())


def descargar(boe):
    r = subprocess.run(['curl', '-sS', '-m', '90', f'https://www.boe.es/diario_boe/xml.php?id={boe}'], capture_output=True)
    if r.returncode != 0 or not r.stdout.startswith(b'<?xml'):
        sys.exit(f'No se pudo descargar {boe}: {r.stderr.decode()[:200]}')
    return r.stdout.decode('utf-8')


def js(s):
    return "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--anio', type=int, required=True)
    ap.add_argument('--boe')
    ap.add_argument('--archivo')
    a = ap.parse_args()
    if not a.boe and not a.archivo:
        sys.exit('Hace falta --boe BOE-A-… o --archivo')
    xml = Path(a.archivo).read_text(encoding='utf-8') if a.archivo else descargar(a.boe)
    root = ET.fromstring(xml)
    titulo = texto(root.find('.//titulo')) if root.find('.//titulo') is not None else ''
    ident = texto(root.find('.//identificador')) if root.find('.//identificador') is not None else (a.boe or a.archivo)
    if str(a.anio) not in titulo:
        sys.exit(f'El título del BOE no menciona {a.anio}: «{titulo}»')
    tablas = list(root.iter('table'))
    if len(tablas) != 1:
        sys.exit(f'Esperaba UNA tabla en el anexo y hay {len(tablas)}')
    filas = [[texto(c) for c in r if c.tag in ('td', 'th')] for r in tablas[0].iter('tr')]
    cabecera = next((f for f in filas if len(f) == 19), None)
    if not cabecera:
        sys.exit('No encuentro la fila con las 19 comunidades')
    codigos = []
    for nombre in cabecera:
        k = norm(re.sub(r'\(\d+\)', '', nombre))
        if k not in COLUMNAS:
            sys.exit(f'Comunidad que no conozco en la cabecera: «{nombre}»')
        codigos.append(COLUMNAS[k])
    if len(set(codigos)) != 19:
        sys.exit('Las 19 columnas no son 19 comunidades distintas')

    fiestas = []
    mes = None
    for f in filas:
        if len(f) != 20:
            continue
        if all(x == '' for x in f[1:]):
            m = MESES.get(norm(f[0]))
            if m:
                mes = m
            continue
        m = re.match(r'^(\d{1,2})\s+(.+?)\.?$', f[0])
        if not m or mes is None:
            sys.exit(f'Fila de fiesta que no entiendo: {f[0]!r}')
        dia, nombre = int(m.group(1)), m.group(2).strip()
        marcas = {codigos[i]: f[i + 1] for i in range(19) if f[i + 1]}
        if any(v not in ('*', '**', '***') for v in marcas.values()):
            sys.exit(f'Marca rara en «{f[0]}»: {set(marcas.values())}')
        if not marcas:
            sys.exit(f'Fiesta sin ninguna comunidad: «{f[0]}»')
        fiestas.append((f'{a.anio}-{mes:02d}-{dia:02d}', nombre, sorted(marcas)))
    if len(fiestas) < 25:
        sys.exit(f'Solo {len(fiestas)} fiestas: algo falla')

    # --- notas al pie: islas de Canarias y Valle de Arán ---
    notas = [texto(p) for p in root.iter('p')]
    zonas, sin_fiesta = [], []
    canarias = next((n for n in notas if re.match(r'^1\.\s*En la Comunidad Aut[oó]noma de Canarias', n)), None)
    if not canarias:
        sys.exit('No encuentro la nota de Canarias (1)')
    for isla, d, mes_t, fest in re.findall(r'en ([^:;«»]+?): el (\d{1,2}) de (\w+), festividad de ([^;»]+)', canarias):
        k = ISLAS.get(norm(isla))
        if not k or norm(mes_t) not in MESES:
            sys.exit(f'Isla o mes que no entiendo en la nota de Canarias: {isla!r} {mes_t!r}')
        limpio = fest.strip().rstrip('.»').strip()
        zonas.append((f'{a.anio}-{MESES[norm(mes_t)]:02d}-{int(d):02d}', limpio[:1].upper() + limpio[1:], k))
    if {z[2] for z in zonas} != {'hierro', 'fuerteventura', 'gran-canaria', 'gomera', 'palma', 'lanzarote', 'tenerife'}:
        sys.exit(f'Las islas de la nota de Canarias no son las siete: {sorted({z[2] for z in zonas})}')
    aran = next((n for n in notas if re.match(r'^2\.\s*En la Comunidad Aut[oó]noma de Catalu', n)), None)
    if not aran:
        sys.exit('No encuentro la nota de Cataluña (2)')
    m = re.search(r'la fiesta del d[ií]a (\d{1,2}) de (\w+)[^,]*? queda sustituida por la de (\d{1,2}) de (\w+)', aran)
    if not m or norm(m.group(2)) not in MESES or norm(m.group(4)) not in MESES:
        sys.exit(f'No entiendo la sustitución del Valle de Arán: {aran[:300]}')
    quitada = f'{a.anio}-{MESES[norm(m.group(2))]:02d}-{int(m.group(1)):02d}'
    puesta = f'{a.anio}-{MESES[norm(m.group(4))]:02d}-{int(m.group(3)):02d}'
    sin_fiesta.append((quitada, 'aran'))
    zonas.append((puesta, 'Fiesta de Arán', 'aran'))
    if not any(f[0] == quitada and 'CT' in f[2] for f in fiestas):
        sys.exit(f'La fiesta que se quita en Arán ({quitada}) no es una fiesta de Cataluña en la tabla')

    fiestas.sort()
    zonas.sort()
    salida = [
        f'// GENERADO por scripts/festivos-desde-boe.py a partir de {ident} ({titulo}). No editar a mano: se vuelve a generar.',
        "import type { CalendarioAnual } from '../tipos'",
        '',
        f'export const CALENDARIO_{a.anio}: CalendarioAnual = {{',
        f'  anio: {a.anio},',
        f"  fuente: {js(ident)},",
        '  // f = día, n = nombre en el BOE, c = comunidades que lo celebran («todas» si son las 19)',
        '  fiestas: [',
    ]
    for dia, nombre, cs in fiestas:
        c = "'todas'" if len(cs) == 19 else '[' + ', '.join(js(x) for x in cs) + ']'
        salida.append(f'    {{ f: {js(dia)}, n: {js(nombre)}, c: {c} }},')
    salida += ['  ],', '  // fiestas propias de una zona más pequeña que la comunidad: las islas de Canarias y el Valle de Arán', '  zonas: [']
    for dia, nombre, z in zonas:
        salida.append(f'    {{ f: {js(dia)}, n: {js(nombre)}, z: {js(z)} }},')
    salida += ['  ],', '  // días en que una fiesta de la comunidad NO se celebra en esa zona (se sustituye por la de arriba)', '  sinFiestaEnZona: [']
    for dia, z in sin_fiesta:
        salida.append(f'    {{ f: {js(dia)}, z: {js(z)} }},')
    salida += ['  ],', '}', '']
    destino = RAIZ / 'lib' / 'festivos' / 'datos' / f'{a.anio}.ts'
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text('\n'.join(salida), encoding='utf-8')
    print(f'{destino.relative_to(RAIZ)}: {len(fiestas)} fiestas, {len(zonas)} de zona, {len(sin_fiesta)} sustitución. Título: {titulo}')


main()
