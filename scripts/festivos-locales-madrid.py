#!/usr/bin/env python3
"""Genera lib/festivos/datos/locales-2026-md.ts: las fiestas locales (dos por municipio) de los 179 municipios de la Comunidad de Madrid para 2026.

Fuente OFICIAL: el BOCM. La base es la Resolución de 2 de diciembre de 2025 de la Dirección General de Trabajo (BOCM de 12 de diciembre de 2025), y por encima de ella, las dos que la
modifican para los municipios que no habían comunicado sus días (Resolución de 15 de diciembre, BOCM de 29 de diciembre de 2025; Resolución de 22 de diciembre, BOCM de 8 de enero de 2026):
lo que dice una modificación sustituye a lo anterior para ese municipio.

Uso (el Python del venv y `pdftotext` de poppler):
    /Users/raulcamunas/venv/bin/python scripts/festivos-locales-madrid.py

Descarga con curl los tres PDF, saca su texto y lee las líneas «— Municipio: 3 de febrero y 15 de mayo.». Si no entiende algo, PARA. Los nombres se casan con la lista del INE de la provincia 28
(lib/ubicacion/datos/municipios-ine.json); lo que no se casa se dice y hay que arreglarlo a mano en ALIAS. Las fiestas locales del año siguiente se publican en diciembre.
"""
import json
import re
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
FUENTES = [
    ('BOCM-20251212-34', 'https://www.bocm.es/boletin/CM_Orden_BOCM/2025/12/12/BOCM-20251212-34.PDF', 'Resolución de 2 de diciembre de 2025 (BOCM de 12 de diciembre de 2025)'),
    ('BOCM-20251229-19', 'https://www.bocm.es/boletin/CM_Orden_BOCM/2025/12/29/BOCM-20251229-19.PDF', 'Resolución de 15 de diciembre de 2025 (BOCM de 29 de diciembre de 2025)'),
    ('BOCM-20260108-18', 'https://www.bocm.es/boletin/CM_Orden_BOCM/2026/01/08/BOCM-20260108-18.PDF', 'Resolución de 22 de diciembre de 2025 (BOCM de 8 de enero de 2026)'),
]
ANIO = 2026
MESES = {'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4, 'mayo': 5, 'junio': 6, 'julio': 7, 'agosto': 8, 'septiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12}

# Nombres del BOCM que no se casan solos con el INE (clave: normalizado del BOCM; valor: nombre exacto del INE)
ALIAS = {
    'piñuecar gandullas': 'Piñuécar-Gandullas',
    'valdepielagos': 'Valdepiélagos',
    'navarredonda y san mames': 'Navarredonda y San Mamés',
    'berzosa de lozoya': 'Berzosa del Lozoya',
    'braojos de la sierra': 'Braojos',
    'buitrago de lozoya': 'Buitrago del Lozoya',
    'moraleja de en medio': 'Moraleja de Enmedio',
    'valdetorres del jarama': 'Valdetorres de Jarama',
}
# El BOCM da fechas para los TRES núcleos del municipio de El Boalo (El Boalo, Cerceda y Mataelpino: el INE tiene un solo municipio, «Boalo, El», 28023) y para «El Espartal»,
# que no es un municipio del INE. Un lead cuyo municipio es «Boalo, El» puede estar en cualquiera de los tres núcleos, así que no se sabe qué fechas le tocan: no se cargan (no se inventa)
OMITIDOS = {'el boalo': 'tres núcleos con fechas distintas en un solo municipio del INE', 'cerceda': 'núcleo del municipio de Boalo, El', 'mataelpino': 'núcleo del municipio de Boalo, El', 'el espartal': 'no es un municipio del INE'}
# Líneas con más de dos fechas: municipios con dos núcleos. Solo se toma lo que vale para todo el municipio
SOLO_LAS_PRIMERAS = {'valdeolmos alalpardo': 1}


def norm(s):
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9ñ]+', ' ', s)).strip()


def texto_de(url):
    with tempfile.TemporaryDirectory() as d:
        pdf = Path(d) / 'x.pdf'
        r = subprocess.run(['curl', '-sS', '-L', '-m', '90', '-o', str(pdf), '-w', '%{http_code}', url], capture_output=True, text=True)
        if r.stdout.strip() != '200':
            sys.exit(f'No se pudo descargar {url}: HTTP {r.stdout.strip()} {r.stderr[:200]}')
        t = subprocess.run(['pdftotext', '-layout', str(pdf), '-'], capture_output=True, text=True)
        if t.returncode != 0 or not t.stdout.strip():
            sys.exit(f'pdftotext no ha podido leer {url}')
        return t.stdout


def fechas_de(resto, nombre):
    """«3 de febrero y 15 de mayo», «11 y 14 de septiembre», «14 de septiembre y 14 diciembre» -> [(mes, día), …]"""
    pos = [(m.start(), 'd', int(m.group(1))) for m in re.finditer(r'(?<!\d)(\d{1,2})(?!\d)', resto)]
    pos += [(m.start(), 'm', MESES[m.group(1).lower()]) for m in re.finditer(r'(' + '|'.join(MESES) + r')', resto, re.I)]
    pos.sort()
    salida = []
    pendientes = []
    for _, tipo, v in pos:
        if tipo == 'd':
            pendientes.append(v)
        else:
            for dia in pendientes:
                salida.append((v, dia))
            pendientes = []
    if pendientes:
        sys.exit(f'Fechas sin mes en «{nombre}»: {resto!r}')
    return salida


def leer(texto):
    """-> {nombre normalizado: (nombre tal cual, [(mes, día)]) o None si «no comunicado»}"""
    res = {}
    for linea in texto.splitlines():
        m = re.match(r'^\s*—\s*(.+?)\s*$', linea)
        if not m:
            continue
        cuerpo = m.group(1)
        m2 = re.match(r'^(.+?)(?::\s+|\s+(?=\d))(.*)$', cuerpo)
        if not m2:
            continue
        nombre, resto = m2.group(1).strip(), m2.group(2).strip()
        if 'no comunicado' in resto.lower():
            res[norm(nombre)] = (nombre, None)
            continue
        fs = fechas_de(resto, nombre)
        k = norm(nombre)
        if k in SOLO_LAS_PRIMERAS:
            fs = fs[:SOLO_LAS_PRIMERAS[k]]
        if len(fs) != 2 and k not in SOLO_LAS_PRIMERAS:
            sys.exit(f'«{nombre}» no tiene dos fechas: {fs} ({resto!r})')
        res[k] = (nombre, fs)
    return res


def main():
    ine = json.load(open(RAIZ / 'lib' / 'ubicacion' / 'datos' / 'municipios-ine.json', encoding='utf-8'))['28']
    por_nombre = {}
    for cod, nombre in ine:
        partes = [p.strip() for p in nombre.split('/')]
        variantes = set()
        for p in partes:
            m = re.match(r'^(.+?),\s*(el|la|los|las|l\'|lo)\s*$', p, re.I)
            if m:
                variantes.add(norm(f'{m.group(2)} {m.group(1)}'))
                variantes.add(norm(m.group(1)))
            else:
                variantes.add(norm(p))
        if len(partes) > 1:
            variantes.add(norm(' '.join(partes)))
        for v in variantes:
            por_nombre.setdefault(v, []).append(('28' + cod, nombre))

    final = {}
    for ident, url, titulo in FUENTES:
        t = leer(texto_de(url))
        print(f'{ident}: {len(t)} municipios ({sum(1 for v in t.values() if v[1] is None)} «no comunicado»)')
        for k, (nombre, fs) in t.items():
            if fs is not None:
                final[k] = (nombre, fs, ident)
            elif k not in final:
                final[k] = (nombre, None, ident)

    registros, sin_casar, sin_fechas = [], [], []
    vistos = set()
    omitidos = []
    for k, (nombre, fs, ident) in sorted(final.items()):
        if k in OMITIDOS:
            omitidos.append(f'{nombre} ({OMITIDOS[k]})')
            continue
        if k in ALIAS:
            hallados = [(c, n) for c, n in por_nombre.get(norm(ALIAS[k]), [])]
        else:
            hallados = por_nombre.get(k, [])
        if len({c for c, _ in hallados}) != 1:
            sin_casar.append((nombre, hallados))
            continue
        codigo, nombre_ine = hallados[0]
        if fs is None:
            sin_fechas.append((codigo, nombre))
            continue
        if codigo in vistos:
            sys.exit(f'El municipio {nombre_ine} ({codigo}) sale dos veces')
        vistos.add(codigo)
        for mes, dia in fs:
            registros.append((f'{ANIO}-{mes:02d}-{dia:02d}', codigo, nombre))
    if sin_casar:
        print('\nNOMBRES QUE NO SE CASAN CON EL INE (arreglar en ALIAS):')
        for n, h in sin_casar:
            print('  ', n, h)
        sys.exit(1)
    registros.sort()
    todos = {r[1] for r in registros}
    sin_fechas = [n for c, n in sin_fechas if c not in todos]  # un municipio escrito de otra forma en una modificación sí tiene fechas
    faltan = [n for c, n in ine if '28' + c not in todos]
    print(f'{len(todos)} municipios con fechas; sin fechas (siguen «no comunicado»): {sin_fechas}; omitidos a propósito: {omitidos}; en el INE y sin fechas: {faltan}')

    nombres_ine = {'28' + c: n for c, n in ine}
    out = [
        f'// GENERADO por scripts/festivos-locales-madrid.py. No editar a mano: se vuelve a generar.',
        '// Fiestas locales de 2026 de los municipios de la Comunidad de Madrid, del BOCM: ' + '; '.join(t for _, _, t in FUENTES) + '. Lo que dice una modificación sustituye a lo anterior.',
        "import type { FiestaLocal } from '../tipos'",
        '',
        f'export const LOCALES_{ANIO}_MD: readonly FiestaLocal[] = [',
    ]
    for dia, codigo, nombre in registros:
        out.append(f"  {{ f: '{dia}', ine: '{codigo}', lugar: {json.dumps(nombre, ensure_ascii=False)} }},")
    out += [']', '']
    destino = RAIZ / 'lib' / 'festivos' / 'datos' / f'locales-{ANIO}-md.ts'
    destino.write_text('\n'.join(out), encoding='utf-8')
    print(f'{destino.relative_to(RAIZ)}: {len(registros)} fiestas de {len(todos)} municipios')


main()
