#!/usr/bin/env python3
"""
PASA A UNA LISTA DE CICLO UNOS CUANTOS LEADS SIN CONTACTAR DE CADA LISTA (la prueba del ciclo comercial).

  python scripts/ciclo-pasar-leads.py --comprobar            no escribe nada: dice de qué listas, cuántos leads y de quién serían
  python scripts/ciclo-pasar-leads.py --si                   los pasa (400 por lista, solo los que tienen dueño)
  python scripts/ciclo-pasar-leads.py --deshacer             los devuelve todos a su lista de antes y les quita la marca del ciclo

Hace falta tener lanzada la migración 264 (las columnas `ciclo_vuelta` y `ciclo_fase`). Usa la clave de servicio de .env.local y `curl` (el urllib de Python no encuentra los certificados en este Mac).

QUÉ HACE, LISTA POR LISTA
  · Coge los leads SIN CONTACTAR de esa lista (estado «Sin contactar», cero intentos, con teléfono Y correo: sin teléfono no hay dos toques y sin correo no hay secuencia), sin los
    autónomos (no se llaman en frío), sin los partners (la IA no les escribe) y sin los que ya están en el ciclo. Con dueño, salvo que se pida lo contrario: un lead sin dueño no lo llama nadie.
  · Se queda con los N mejores: primero el nivel más alto (1, 2, 3) y, dentro, el que más factura (o más vende, estimado).
  · Los pasa a una lista NUEVA que se llama «<la de antes> · Ciclo» (se crea en el registro de listas) y les pone `ciclo_vuelta = 1`. NO cambia de dueño ni de estado: cada comercial se
    queda con sus leads, que ahora salen en esa lista con las cajas del ciclo.
  · Va en tandas de 100 con una pausa entre ellas: cada lead cambiado es un aviso del tiempo real a las pantallas de Cold Calling abiertas.

DESHACER no necesita ningún apunte aparte: el nombre de la lista nueva lleva escrito de dónde vino. Cada lead vuelve a su lista de antes con el estado que tenga ahora (si ya se ha trabajado,
se queda como está) y sin la marca del ciclo; la lista de ciclo se archiva.
"""
import argparse
import json
import subprocess
import sys
import time
from collections import Counter
from urllib.parse import quote

RAIZ = '/Users/raulcamunas/Desktop/ERP 2'
SUFIJO = ' · Ciclo'
TANDA = 100
PAUSA_S = 1.0

env = {}
for linea in open(f'{RAIZ}/.env.local', encoding='utf-8'):
    linea = linea.strip()
    if linea and not linea.startswith('#') and '=' in linea:
        k, v = linea.split('=', 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
URL, KEY = env['NEXT_PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']


def llamar(metodo, ruta, cuerpo=None, extra=(), tiempo=60):
    """Una petición a PostgREST con curl. Devuelve (código HTTP, texto)."""
    orden = ['curl', '-s', '-m', str(tiempo), '-X', metodo, '-w', '\n%{http_code}', '-H', f'apikey: {KEY}', '-H', f'Authorization: Bearer {KEY}', '-H', 'Content-Type: application/json']
    for h in extra:
        orden += ['-H', h]
    if cuerpo is not None:
        orden += ['--data-binary', '@-']
    orden.append(f'{URL}/rest/v1/{ruta}')
    r = subprocess.run(orden, input=json.dumps(cuerpo) if cuerpo is not None else None, capture_output=True, text=True)
    texto, _, codigo = r.stdout.rpartition('\n')
    return codigo or '000', texto


def leer(ruta, tiempo=60):
    codigo, texto = llamar('GET', ruta, tiempo=tiempo)
    if codigo != '200':
        raise SystemExit(f'La base ha contestado {codigo} a una lectura ({texto[:160]}). No se ha tocado nada.')
    return json.loads(texto)


def comprobar_base():
    t = time.time()
    codigo, texto = llamar('GET', 'cold_leads?select=ciclo_vuelta,ciclo_fase&limit=1', tiempo=30)
    if codigo == '400' and ('42703' in texto or 'does not exist' in texto):
        raise SystemExit('Falta lanzar la migración 264 (ciclo comercial). No se ha tocado nada.')
    if codigo != '200':
        raise SystemExit(f'La base no contesta como debe (HTTP {codigo}). No se ha tocado nada.')
    if time.time() - t > 4:
        raise SystemExit(f'La base va lenta ({time.time() - t:.1f} s para una consulta pequeña). No muevo nada ahora: pruébalo cuando esté estable.')


def nombres_de_personas():
    return {p['id']: p['full_name'] for p in leer('profiles?select=id,full_name')}


def candidatos(lista, limite, con_dueno_solo):
    """Los mejores leads sin contactar de una lista que pueden entrar al ciclo"""
    filtros = [
        f'source_list=eq.{lista}', 'status=eq.pendiente', 'call_attempts=eq.0', 'tipo_lead=neq.partner', 'ciclo_vuelta=is.null',
        'phone=not.is.null', 'phone=neq.', 'email=not.is.null', 'email=neq.', 'or=(tipo_empresa.is.null,tipo_empresa.neq.autonomo)',
    ]
    if con_dueno_solo:
        filtros.append('assigned_to=not.is.null')
    orden = 'order=nivel.asc.nullslast,ventas_estimadas_usd.desc.nullslast,revenue_monthly.desc.nullslast,id.asc'
    # La clave tal cual y el valor codificado entero: el nombre de una lista puede llevar espacios, tildes, «·», paréntesis o una coma
    partes = [f'{k}={quote(v, safe="")}' for k, v in (f.split('=', 1) for f in filtros)]
    ruta = 'cold_leads?select=id,assigned_to&' + '&'.join(partes) + f'&{orden}&limit={min(limite, 1000)}'
    return leer(ruta)


def listas_de_origen():
    """Las listas del registro, sin las de partners (la IA no les escribe) ni las que ya son de ciclo"""
    nombres = [r['nombre'] for r in leer('cold_lead_lists?select=nombre&archivada=eq.false&order=nombre&limit=1000')]
    return [n for n in nombres if not n.endswith(SUFIJO) and not n.lower().startswith('partners')]


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--comprobar', action='store_true')
    g.add_argument('--si', action='store_true')
    g.add_argument('--deshacer', action='store_true')
    ap.add_argument('--por-lista', type=int, default=400)
    ap.add_argument('--tambien-sin-dueno', action='store_true', help='incluye leads que nadie lleva (no se llaman hasta que se asignen)')
    ap.add_argument('--solo', help='solo estas listas, separadas por |')
    ap.add_argument('--excluir', help='sin estas listas, separadas por |')
    a = ap.parse_args()

    comprobar_base()
    nombres = nombres_de_personas()

    if a.deshacer:
        # Todas las listas de ciclo del registro, también las archivadas: un segundo «--si» las reutiliza y tiene que poder deshacerse otra vez
        ciclo = [r for r in leer('cold_lead_lists?select=id,nombre&limit=1000') if r['nombre'].endswith(SUFIJO)]
        total = 0
        for r in ciclo:
            origen = r['nombre'][: -len(SUFIJO)]
            devueltos = 0
            while True:
                ids = [f['id'] for f in leer(f"cold_leads?select=id&source_list=eq.{quote(r['nombre'], safe='')}&ciclo_vuelta=not.is.null&order=id&limit=1000")]
                if not ids:
                    break
                for i in range(0, len(ids), TANDA):
                    lote = ids[i:i + TANDA]
                    codigo, texto = llamar('PATCH', f"cold_leads?id=in.({','.join(lote)})", {'source_list': origen, 'ciclo_vuelta': None, 'ciclo_fase': None}, ['Prefer: return=minimal'])
                    if codigo not in ('200', '204'):
                        raise SystemExit(f'Fallo al devolver leads a «{origen}» (HTTP {codigo}): {texto[:160]}. Vuelve a lanzar --deshacer: es seguro repetirlo.')
                    devueltos += len(lote)
                    time.sleep(PAUSA_S)
            llamar('PATCH', f"cold_lead_lists?id=eq.{r['id']}", {'archivada': True}, ['Prefer: return=minimal'])
            if devueltos:
                print(f'  «{r["nombre"]}»: {devueltos} leads devueltos a «{origen}»; lista archivada')
            total += devueltos
        # Los que alguien movió a mano a otra lista conservan la marca: se les quita donde estén (se quedan en la lista a la que los llevaron)
        sueltos = 0
        while True:
            ids = [f['id'] for f in leer('cold_leads?select=id&ciclo_vuelta=not.is.null&order=id&limit=1000')]
            if not ids:
                break
            for i in range(0, len(ids), TANDA):
                lote = ids[i:i + TANDA]
                codigo, texto = llamar('PATCH', f"cold_leads?id=in.({','.join(lote)})", {'ciclo_vuelta': None, 'ciclo_fase': None}, ['Prefer: return=minimal'])
                if codigo not in ('200', '204'):
                    raise SystemExit(f'Fallo al quitar la marca del ciclo (HTTP {codigo}): {texto[:160]}. Vuelve a lanzar --deshacer: es seguro repetirlo.')
                sueltos += len(lote)
                time.sleep(PAUSA_S)
        if not ciclo and not sueltos:
            print('No hay ninguna lista de ciclo ni leads marcados: nada que deshacer.')
            return
        if sueltos:
            print(f'  {sueltos} leads que ya no estaban en su lista de ciclo: marca quitada (se quedan donde están)')
        print(f'\nHECHO: {total} leads de vuelta en sus listas de antes, sin la marca del ciclo.')
        return

    solo = set(x.strip() for x in a.solo.split('|')) if a.solo else None
    fuera = set(x.strip() for x in a.excluir.split('|')) if a.excluir else set()
    listas = [l for l in listas_de_origen() if (solo is None or l in solo) and l not in fuera]
    plan = []
    print(f'{"Lista de origen":42} {"pasarían":>8}  de quién')
    for lista in listas:
        elegidos = candidatos(lista, a.por_lista, not a.tambien_sin_dueno)
        if not elegidos:
            print(f'{lista[:42]:42} {0:>8}  (ninguno cumple: sin contactar, con teléfono y correo, con dueño, no autónomo)')
            continue
        de = Counter(nombres.get(e['assigned_to'], 'SIN DUEÑO') if e['assigned_to'] else 'SIN DUEÑO' for e in elegidos)
        print(f'{lista[:42]:42} {len(elegidos):>8}  ' + ' · '.join(f'{n} {c}' for n, c in de.most_common()))
        plan.append((lista, [e['id'] for e in elegidos], de))
    total = sum(len(p[1]) for p in plan)
    print(f'\nTOTAL: {total} leads de {len(plan)} listas, a {len(plan)} listas nuevas «… {SUFIJO.strip()}».')
    if a.comprobar:
        print('(Ensayo: no se ha escrito nada. Para pasarlos: --si)')
        return

    for lista, ids, de in plan:
        nueva = (lista[: 80 - len(SUFIJO)] + SUFIJO)
        unico = list(de) if len(de) == 1 and 'SIN DUEÑO' not in de else None
        responsable = next((k for k, v in nombres.items() if v == unico[0]), None) if unico else None
        codigo, texto = llamar('POST', 'cold_lead_lists', {'nombre': nueva, 'descripcion': f'Prueba del ciclo comercial: {len(ids)} leads sin contactar de «{lista}»', 'responsable': responsable}, ['Prefer: return=minimal'])
        if codigo == '409':
            # Ya existe (de otra vez, quizá archivada tras un --deshacer): se desarchiva, que si no el siguiente --deshacer no la vería
            llamar('PATCH', f"cold_lead_lists?nombre=eq.{quote(nueva, safe='')}", {'archivada': False}, ['Prefer: return=minimal'])
        elif codigo not in ('201', '204'):
            raise SystemExit(f'No se ha podido crear la lista «{nueva}» (HTTP {codigo}): {texto[:160]}. No se ha movido ningún lead de «{lista}».')
        hechos = 0
        for i in range(0, len(ids), TANDA):
            lote = ids[i:i + TANDA]
            # Solo los que SIGUEN como cuando se eligieron: sin contactar, sin intentos, fuera del ciclo y en su lista. Si alguien los ha llamado o movido mientras tanto, se dejan donde están
            codigo, texto = llamar('PATCH', f"cold_leads?id=in.({','.join(lote)})&status=eq.pendiente&call_attempts=eq.0&ciclo_vuelta=is.null&source_list=eq.{quote(lista, safe='')}&select=id", {'source_list': nueva, 'ciclo_vuelta': 1}, ['Prefer: return=representation'])
            if codigo != '200':
                raise SystemExit(f'Fallo al pasar leads de «{lista}» (HTTP {codigo}): {texto[:160]}. Lo ya movido queda movido; --deshacer lo devuelve todo.')
            hechos += len(json.loads(texto))
            time.sleep(PAUSA_S)
        print(f'  «{nueva}»: {hechos} leads pasados')
    print(f'\nHECHO. Para devolverlos: python scripts/ciclo-pasar-leads.py --deshacer')


if __name__ == '__main__':
    main()
