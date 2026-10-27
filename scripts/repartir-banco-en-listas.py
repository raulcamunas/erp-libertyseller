#!/usr/bin/env python3
"""
Reparte las tiendas del banco (cold_lead_banco, migración 257) en cuatro listas de Cold Calling y las convierte en leads SIN DUEÑO:

    No Amazon - Gran Cuenta   las de tramo G (las grandes cuentas, que en el Excel se reservaban a Alejandro)
    No Amazon - Nivel 1       nivel 1 que no son gran cuenta
    No Amazon - Nivel 2
    No Amazon - Nivel 3

  python3 scripts/repartir-banco-en-listas.py --comprobar     cuenta qué haría; NO escribe nada
  python3 scripts/repartir-banco-en-listas.py --si            lo hace en PRODUCCIÓN (API REST con la clave de servicio de .env.local)

Qué se reparte: todo lo que sigue libre en el banco (sin lead) MENOS lo descartado (nivel 4 o tramo D: no se reparte nunca, ni desde la pantalla). Las tiendas cuya web ya es un lead
no se tocan ni se duplican (el banco las enlazó al cargarse). Los leads salen sin dueño: después se asignan desde Cold Calling → Listas.

Se usa la misma función que la pantalla del banco (cold_banco_anadir), así que cada tanda queda en el Historial con su «Deshacer». Va por tandas de 1.000 con una pausa entre una y
otra: cada insert de leads llega por el canal en tiempo real a quien tenga Cold Calling abierto en «Todos los comerciales», y así no les llegan 20.000 de golpe.

IDEMPOTENTE: cada tanda es una sola transacción, y al repetirlo solo queda lo que no se hubiera repartido. No imprime ningún dato de ninguna tienda, solo recuentos.
"""
import collections, json, os, subprocess, sys, time, urllib.parse

ENV_LOCAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env.local')
PREFIJO = 'No Amazon - '
LISTAS = ['Gran Cuenta', 'Nivel 1', 'Nivel 2', 'Nivel 3']
DESCRIPCION = {
    'Gran Cuenta': 'Tiendas que no venden en Amazon con ventas estimadas de 100.000 $/mes o más. Tramo G del Excel «Tienda no Amazon».',
    'Nivel 1': 'Tiendas que no venden en Amazon, nivel 1 (potencial alto: 30.000 $/mes estimados o más), sin las grandes cuentas.',
    'Nivel 2': 'Tiendas que no venden en Amazon, nivel 2 (muy buenos números: entre 8.000 y 30.000 $/mes estimados).',
    'Nivel 3': 'Tiendas que no venden en Amazon, nivel 3 (leads correctos: entre 1.000 y 8.000 $/mes estimados, y las que no tienen tráfico medible pero sí 20 productos y 2 años).',
}
LOTE = 1000
PAUSA_S = 3.0


def lista_de(fila):
    """La lista a la que va una tienda del banco, o None si no se reparte (descartada)."""
    tramo = (fila.get('tramo') or '').strip().upper()[:1]
    nivel = fila.get('nivel')
    if nivel == 4 or tramo == 'D':
        return None
    if tramo == 'G':
        return 'Gran Cuenta'
    if nivel in (1, 2, 3):
        return f'Nivel {nivel}'
    return None


def planear(libres):
    """{lista: [dominios]} en orden de prioridad (nivel y ventas), y cuántas se dejan fuera por descartadas o sin nivel."""
    ordenadas = sorted(libres, key=lambda f: (f.get('nivel') or 9, -(f.get('ventas_mes_usd') or 0), f['dominio']))
    plan = collections.OrderedDict((n, []) for n in LISTAS)
    fuera = collections.Counter()
    for f in ordenadas:
        destino = lista_de(f)
        if destino is None:
            fuera['descartadas' if (f.get('nivel') == 4 or (f.get('tramo') or '').strip().upper()[:1] == 'D') else 'sin nivel'] += 1
        else:
            plan[destino].append(f['dominio'])
    return plan, fuera


def tandas(dominios, lote=LOTE):
    for i in range(0, len(dominios), lote):
        yield dominios[i:i + lote]


# ---------------------------------------------------------------- acceso a la base

class Rest:
    """Producción: la API REST de Supabase con la clave de servicio."""

    def __init__(self):
        env = {}
        for l in open(ENV_LOCAL):
            l = l.strip()
            if l and not l.startswith('#') and '=' in l:
                k, v = l.split('=', 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
        self.base = env['NEXT_PUBLIC_SUPABASE_URL'].rstrip('/')
        self.clave = env['SUPABASE_SERVICE_ROLE_KEY']

    def _pedir(self, url, cuerpo=None, extra=None, intentos=4):
        """GET, o POST con JSON si hay cuerpo. Va por curl, como consulta.py: el Python de este Mac no valida los certificados de Supabase."""
        cab = {'apikey': self.clave, 'Authorization': f'Bearer {self.clave}', 'Content-Type': 'application/json'}
        cab.update(extra or {})
        orden = ['curl', '-sS', '--max-time', '180', '-w', '\n%{http_code}']
        for k, v in cab.items():
            orden += ['-H', f'{k}: {v}']
        if cuerpo is not None:
            orden += ['-X', 'POST', '--data-binary', '@-']
        orden.append(url)
        for n in range(intentos):
            r = subprocess.run(orden, input=None if cuerpo is None else json.dumps(cuerpo).encode('utf-8'), capture_output=True)
            if r.returncode == 0:
                texto, _, codigo = r.stdout.decode('utf-8', 'replace').rpartition('\n')
                estado = int(codigo)
                if estado < 500 or n == intentos - 1:
                    return estado, texto
            elif n == intentos - 1:
                raise SystemExit(f'No se pudo conectar (curl {r.returncode})')
            time.sleep(2 * (n + 1))

    def libres(self):
        filas, desde = [], 0
        while True:
            q = urllib.parse.urlencode({'select': 'dominio,nivel,tramo,ventas_mes_usd', 'lead_id': 'is.null', 'order': 'dominio.asc', 'limit': '1000', 'offset': str(desde)})
            estado, texto = self._pedir(f'{self.base}/rest/v1/cold_lead_banco?{q}')
            if estado != 200:
                raise SystemExit(f'No se ha podido leer el banco ({estado}): {texto[:200]}')
            trozo = json.loads(texto)
            filas += trozo
            if len(trozo) < 1000:
                return filas
            desde += 1000

    def rpc(self, nombre, args):
        estado, texto = self._pedir(f'{self.base}/rest/v1/rpc/{nombre}', args)
        if estado >= 300:
            return {'_error': estado, '_texto': texto[:300]}
        return json.loads(texto) if texto else None

    def actor(self):
        """El administrador que firma el reparto (queda en el Historial). Raúl por defecto; con --actor <uuid>, quien se diga."""
        q = urllib.parse.urlencode({'select': 'id,full_name,email', 'role': 'eq.admin'})
        estado, texto = self._pedir(f'{self.base}/rest/v1/profiles?{q}')
        admins = json.loads(texto) if estado == 200 else []
        pedido = next((a for i, a in enumerate(sys.argv) if sys.argv[i - 1] == '--actor'), None) if '--actor' in sys.argv else None
        if pedido:
            elegido = [a for a in admins if a['id'] == pedido]
        else:
            elegido = [a for a in admins if (a.get('email') or '').lower() == 'business@libertyseller.com'] or [a for a in admins if (a.get('full_name') or '').strip().lower().startswith(('raúl', 'raul'))]
        if len(elegido) != 1:
            raise SystemExit('No sé qué administrador firma el reparto. Indícalo con --actor <uuid>.')
        return elegido[0]['id'], (elegido[0].get('full_name') or 'administrador').split(' ')[0]


class Local:
    """SOLO PARA ENSAYAR: la réplica de Postgres de este ordenador (psql). Misma interfaz que Rest."""

    def __init__(self, base='t257'):
        self.base = base

    def _sql(self, texto):
        r = subprocess.run(['psql', '-h', '127.0.0.1', '-p', '54329', '-U', 'postgres', '-d', self.base, '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', texto], capture_output=True, text=True)
        if r.returncode != 0:
            return None, r.stderr.strip()[:300]
        return r.stdout.strip(), None

    def libres(self):
        salida, error = self._sql("select dominio || '|' || coalesce(nivel::text,'') || '|' || coalesce(tramo,'') || '|' || coalesce(ventas_mes_usd::text,'') from cold_lead_banco where lead_id is null order by dominio")
        if error:
            raise SystemExit(error)
        filas = []
        for l in salida.splitlines():
            d, n, t, v = l.split('|')
            filas.append({'dominio': d, 'nivel': int(n) if n else None, 'tramo': t, 'ventas_mes_usd': float(v) if v else None})
        return filas

    @staticmethod
    def _lit(v):
        if v is None:
            return 'NULL'
        if isinstance(v, list):
            return 'ARRAY[' + ','.join(Local._lit(x) for x in v) + ']::text[]'
        return "'" + str(v).replace("'", "''") + "'"

    def rpc(self, nombre, args):
        uuids = {'p_actor', 'p_responsable', 'p_dueno'}
        partes = [f"{k} := {self._lit(v)}" + ('::uuid' if k in uuids and v is not None else '') for k, v in args.items()]
        salida, error = self._sql(f"select public.{nombre}({', '.join(partes)})")
        if error:
            return {'_error': 400, '_texto': error}
        return json.loads(salida) if salida else None

    def actor(self):
        return '00000000-0000-4000-8000-000000000001', 'Raúl'


# ---------------------------------------------------------------- lo que hace

def asegurar_listas(base, actor, escribir):
    """Crea las cuatro listas que falten. Devuelve los nombres completos."""
    nombres = {}
    for corto in LISTAS:
        nombre = PREFIJO + corto
        nombres[corto] = nombre
        if not escribir:
            continue
        r = base.rpc('cold_lista_crear', {'p_actor': actor, 'p_nombre': nombre, 'p_descripcion': DESCRIPCION[corto], 'p_responsable': None})
        if isinstance(r, dict) and r.get('_error'):
            if 'Ya existe' in r.get('_texto', ''):
                print(f'  la lista «{nombre}» ya existía: se sigue en ella')
            else:
                raise SystemExit(f'No se ha podido crear «{nombre}»: {r}')
        else:
            print(f'  lista «{nombre}» creada')
    return nombres


def repartir(base, escribir, lote=LOTE, pausa=PAUSA_S):
    libres = base.libres()
    plan, fuera = planear(libres)
    print(f'En el banco quedan {len(libres)} tiendas sin lead.')
    for corto in LISTAS:
        print(f'  {PREFIJO}{corto}: {len(plan[corto])}')
    for motivo, n in fuera.items():
        print(f'  fuera ({motivo}): {n}')
    total = sum(len(v) for v in plan.values())
    if not escribir:
        print(f'\n(Solo comprobar) Se crearían {total} leads sin dueño en {sum(1 for v in plan.values() if v)} listas, en {sum(len(list(tandas(v, lote))) for v in plan.values())} tandas.')
        return
    if total == 0:
        print('No hay nada que repartir.')
        return
    actor, quien = base.actor()
    print(f'\nFirma el reparto: {quien} (administrador).')
    nombres = asegurar_listas(base, actor, True)
    hechas = collections.Counter()
    ya, no_disp, n_tanda = 0, 0, 0
    for corto in LISTAS:
        for dominios in tandas(plan[corto], lote):
            n_tanda += 1
            r = base.rpc('cold_banco_anadir', {'p_actor': actor, 'p_dominios': dominios, 'p_lista': nombres[corto], 'p_dueno': None})
            if not isinstance(r, dict) or r.get('_error'):
                raise SystemExit(f'La tanda {n_tanda} ({corto}) ha fallado y no ha cambiado nada: {r}. Se puede repetir el script: sigue por donde iba.')
            hechas[corto] += r['anadidos']
            ya += r['ya_estaban']
            no_disp += r['no_disponibles']
            print(f'  tanda {n_tanda:>3} · {corto}: +{r["anadidos"]}  (acumulado {sum(hechas.values())} de {total})', flush=True)
            time.sleep(pausa)
    print(f'\nHecho: {sum(hechas.values())} leads nuevos. Ya estaban como lead: {ya}. No disponibles: {no_disp}.')
    for corto in LISTAS:
        print(f'  {PREFIJO}{corto}: {hechas[corto]}')
    resumen = base.rpc('cold_banco_resumen', {})
    if isinstance(resumen, dict) and not resumen.get('_error'):
        print(f"  el banco ahora: {resumen['total']} tiendas · {resumen['libres']} libres · {resumen['descartadas']} descartadas")


if __name__ == '__main__':
    args = sys.argv[1:]
    if not args or args[0] not in ('--comprobar', '--si', '--ensayo', '--ensayo-comprobar'):
        raise SystemExit(__doc__)
    if args[0] in ('--ensayo', '--ensayo-comprobar'):
        # Contra la réplica local, sin pausas. Solo para probar el script
        repartir(Local(), args[0] == '--ensayo', pausa=0)
    else:
        repartir(Rest(), args[0] == '--si')
