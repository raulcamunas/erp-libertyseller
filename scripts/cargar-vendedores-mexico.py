#!/usr/bin/env python3
"""
Carga el CSV «Vendedores_Mexico_10k_contactos_15nov - Para llamar.csv» en Cold Calling: vendedores de Amazon México repartidos en TRES listas (19 nov 2026, Raúl):
  «MEX Alejandro · Ciclo» (360) · «MEX Jhanna · Ciclo» (400) · «MEX Daniela · Ciclo» (el resto), ya en el ciclo comercial.

    python3 -I scripts/cargar-vendedores-mexico.py --comprobar RUTA_CSV     cuenta qué haría; NO escribe
    python3 -I scripts/cargar-vendedores-mexico.py --si RUTA_CSV            lo hace en PRODUCCIÓN (API REST con la clave de servicio de .env.local)

El reparto es por facturación: se ordenan de más a menos y cada vendedor va a la comercial que menos lleva respecto a su cupo, así las tres listas tienen la misma
mezcla de grandes y pequeños. Los teléfonos se guardan en internacional (+52…). IDEMPOTENTE: salta los vendedores (por su URL de Amazon) que ya estén cargados.
NO imprime ningún dato de ningún negocio, solo recuentos.
"""
import csv, json, os, re, subprocess, sys, time, urllib.parse

CARPETA = os.path.dirname(os.path.abspath(__file__))
ENV_LOCAL = os.path.join(CARPETA, '..', '.env.local')
CUPOS = [('alejandro@libertyseller.com', 'MEX Alejandro · Ciclo', 360), ('jhanna@libertyseller.es', 'MEX Jhanna · Ciclo', 400), ('daniela@libertyseller.es', 'MEX Daniela · Ciclo', None)]
DESCRIPCION = 'Vendedores de Amazon México (SmartScout + Google Maps, CSV del 15 nov 2026). Se llaman con el número virtual de México (Zadarma).'


def limpio(v):
    t = ' '.join(str(v or '').split())
    return t or None


def numero(v):
    t = re.sub(r'[^\d,]', '', str(v or '')).replace(',', '.')
    try:
        return float(t) if t else None
    except ValueError:
        return None


def tel_mx(v):
    """«81 3404 0996» -> «+528134040996». Con prefijo se respeta; lo que no son 10 cifras mexicanas se descarta."""
    t = str(v or '').strip()
    if not t:
        return None
    cifras = re.sub(r'\D', '', t)
    if t.startswith('+'):
        return '+' + cifras if 8 <= len(cifras) <= 15 else None
    if len(cifras) == 12 and cifras.startswith('52'):
        return '+' + cifras
    if len(cifras) == 10:
        return '+52' + cifras
    return None


def trocear(v):
    return [x for x in re.split(r'\s*[·,;/|]\s*', str(v or '')) if x.strip()]


def fila_a_lead(f):
    principal = tel_mx(f['Teléfono'])
    extras = []
    for t in trocear(f['Otros teléfonos']) + trocear(f['WhatsApp']):
        n = tel_mx(t)
        if n and n != principal and n not in extras:
            extras.append(n)
    if not principal and extras:
        principal = extras.pop(0)
    correos = [c for c in trocear(f['Otros correos']) if '@' in c]
    return {
        'store_name': limpio(f['Tienda']),
        'company': limpio(f['Razón social']),
        'revenue_monthly': numero(f['Ventas/mes (USD)']),
        'province': limpio(f['Estado']),
        'category': limpio(f['Categoría']),
        'subcategory': limpio(f['Subcategoría']),
        'business_address': limpio(f['Dirección']),
        'phone': principal,
        'telefonos_extra': ' / '.join(extras) or None,
        'email': (limpio(f['Correo']) or '').lower() or None,
        'emails_extra': ' / '.join(c.lower() for c in correos) or None,
        'web': limpio(f['Web']),
        'instagram': limpio(f['Instagram']),
        'linkedin': limpio(f['LinkedIn']),
        'google_maps_url': limpio(f['Ficha de Google Maps']),
        'rating': numero(f['Google: valoración']),
        'resenas': int(numero(f['Google: reseñas']) or 0) or None,
        'n_productos': int(numero(f['ASINs']) or 0) or None,
        'amazon_start': limpio(f['Vende desde']),
        'seller_url': limpio(f['Tienda en Amazon']),
        'tipo_lead': 'seller_amazon',
        'vende_en_amazon': 'vende',
        'ciclo_vuelta': 1,
    }


class Rest:
    def __init__(self):
        env = {}
        for l in open(ENV_LOCAL):
            l = l.strip()
            if l and not l.startswith('#') and '=' in l:
                k, v = l.split('=', 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
        self.base = env['NEXT_PUBLIC_SUPABASE_URL'].rstrip('/')
        self.clave = env['SUPABASE_SERVICE_ROLE_KEY']

    def pedir(self, ruta, cuerpo=None, extra=None):
        orden = ['curl', '-sS', '--max-time', '120', '-w', '\n%{http_code}', '-H', f'apikey: {self.clave}', '-H', f'Authorization: Bearer {self.clave}', '-H', 'Content-Type: application/json']
        for k, v in (extra or {}).items():
            orden += ['-H', f'{k}: {v}']
        if cuerpo is not None:
            orden += ['-X', 'POST', '--data-binary', '@-']
        orden.append(f'{self.base}/rest/v1/{ruta}')
        r = subprocess.run(orden, input=None if cuerpo is None else json.dumps(cuerpo).encode('utf-8'), capture_output=True)
        texto, _, codigo = r.stdout.decode('utf-8', 'replace').rpartition('\n')
        return int(codigo or 0), texto


def main():
    escribir = '--si' in sys.argv
    if not escribir and '--comprobar' not in sys.argv:
        raise SystemExit(__doc__)
    ruta = sys.argv[-1]
    filas = list(csv.DictReader(open(ruta, encoding='utf-8-sig')))
    base = Rest()

    # Personas y actor
    personas = {}
    for email, _, _ in CUPOS:
        e, t = base.pedir('profiles?' + urllib.parse.urlencode({'select': 'id', 'email': f'eq.{email}'}))
        datos = json.loads(t) if e == 200 else []
        if len(datos) != 1:
            raise SystemExit(f'No encuentro a {email}')
        personas[email] = datos[0]['id']
    e, t = base.pedir('profiles?' + urllib.parse.urlencode({'select': 'id,full_name,email', 'role': 'eq.admin'}))
    admins = json.loads(t) if e == 200 else []
    raul = [a for a in admins if (a.get('email') or '').lower() == 'business@libertyseller.com'] or [a for a in admins if (a.get('full_name') or '').strip().lower().startswith(('raúl', 'raul'))]
    if len(raul) != 1:
        raise SystemExit('No sé qué administrador firma las listas')
    actor = raul[0]['id']

    # Lo que ya está cargado (por la URL de Amazon)
    ya = set()
    desde = 0
    while True:
        e, t = base.pedir('cold_leads?' + urllib.parse.urlencode({'select': 'seller_url', 'seller_url': 'like.*amazon.com.mx*', 'limit': '1000', 'offset': str(desde)}))
        trozo = json.loads(t) if e == 200 else []
        ya.update(x['seller_url'] for x in trozo)
        if len(trozo) < 1000:
            break
        desde += 1000

    leads, vistos, saltados, sin_tel = [], set(), 0, 0
    for f in filas:
        l = fila_a_lead(f)
        if not l['store_name'] or not l['seller_url']:
            continue
        if l['seller_url'] in vistos or l['seller_url'] in ya:
            saltados += 1
            continue
        vistos.add(l['seller_url'])
        if not l['phone']:
            sin_tel += 1
        leads.append(l)

    # Reparto por facturación, proporcional a los cupos
    leads.sort(key=lambda l: -(l['revenue_monthly'] or 0))
    total = len(leads)
    cupo = {CUPOS[0][1]: CUPOS[0][2], CUPOS[1][1]: CUPOS[1][2]}
    cupo[CUPOS[2][1]] = max(0, total - CUPOS[0][2] - CUPOS[1][2])
    lleva = {n: 0 for n in cupo}
    for l in leads:
        lista = min((n for n in cupo if lleva[n] < cupo[n]), key=lambda n: lleva[n] / cupo[n])
        lleva[lista] += 1
        email = next(e for e, n, _ in CUPOS if n == lista)
        l['source_list'] = lista
        l['assigned_to'] = personas[email]

    print(f'CSV: {len(filas)} filas · a cargar {total} · ya estaban o repetidas {saltados} · sin teléfono válido {sin_tel}')
    for n in cupo:
        g = [l for l in leads if l['source_list'] == n]
        print(f'  {n:32s} {len(g):4d}   facturación media {sum(l["revenue_monthly"] or 0 for l in g) / max(1, len(g)):>12,.0f} USD')
    if not escribir:
        return

    for email, nombre, _ in CUPOS:
        e, t = base.pedir('rpc/cold_lista_crear', {'p_actor': actor, 'p_nombre': nombre, 'p_descripcion': DESCRIPCION, 'p_responsable': personas[email]})
        print('lista', nombre, 'creada' if e < 300 else ('ya existía' if 'Ya existe' in t else f'ERROR {e}: {t[:200]}'))
    for i in range(0, len(leads), 300):
        e, t = base.pedir('cold_leads', leads[i:i + 300], {'Prefer': 'return=minimal'})
        if e >= 300:
            raise SystemExit(f'ERROR al insertar ({e}): {t[:300]}')
        print(f'  insertados {min(i + 300, len(leads))}/{len(leads)}')
        time.sleep(1.5)


if __name__ == '__main__':
    main()
