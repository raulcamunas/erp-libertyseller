import { COLUMNAS_DE_CARTERA, COLUMNAS_DE_CARTERA_SIN_PARTNERS, COLUMNAS_DE_CARTERA_SIN_UBICACION, COLUMNAS_DE_PARTNERS, COLUMNAS_DE_UBICACION, FILAS_POR_TRAMO, TRAMOS_A_LA_VEZ, cargarCartera, faltanLasColumnasDePartners, type ClienteDeLectura } from '@/lib/cold-calling/cargar'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * TRAER LA CARTERA POR TRAMOS.
 *
 * Lo que se vigila: que se traigan TODOS los leads aunque pasen de 1.000 (el tope de PostgREST), que el primer tramo dé también el
 * recuento y los demás vayan a la vez, que no se abran decenas de conexiones juntas, que cada comercial pida solo la suya y que
 * un tramo que falla se diga («cartera incompleta») en vez de enseñar menos leads como si fueran todos.
 */

type Fila = { id: string; assigned_to: string }

class Base {
  filas: Fila[] = []
  peticiones: Array<{ desde: number; conRecuento: boolean; propietario: string | null; columnas: string }> = []
  simultaneas = 0
  maximoSimultaneas = 0
  falla = new Set<number>()
  retardoMs = 5
  /** Una base a la que todavía no se le ha lanzado la migración 262: pedir sus columnas da error de columna inexistente */
  sinLa262: string | null = null
  /** Lo mismo con la 263 (las columnas de ubicación) */
  sinLa263: string | null = null

  from(_tabla: string) {
    const base = this
    let propietario: string | null = null
    let conRecuento = false
    let columnas = ''
    const b = {
      select(c: string, opciones?: { count?: string }) {
        columnas = c
        conRecuento = opciones?.count === 'exact'
        return b
      },
      eq(_c: string, v: string) {
        propietario = v
        return b
      },
      order() {
        return b
      },
      async range(desde: number, hasta: number) {
        base.peticiones.push({ desde, conRecuento, propietario, columnas })
        base.simultaneas += 1
        base.maximoSimultaneas = Math.max(base.maximoSimultaneas, base.simultaneas)
        await new Promise((r) => setTimeout(r, base.retardoMs))
        base.simultaneas -= 1
        if (base.sinLa262 && columnas.includes('prioridad')) return { data: null, error: { code: base.sinLa262 }, count: null }
        if (base.sinLa263 && columnas.includes('ccaa')) return { data: null, error: { code: base.sinLa263 }, count: null }
        if (base.falla.has(desde)) return { data: null, error: { code: 'XX000' }, count: null }
        const visibles = base.filas.filter((f) => propietario === null || f.assigned_to === propietario)
        return { data: visibles.slice(desde, hasta + 1), error: null, count: conRecuento ? visibles.length : null }
      },
    }
    return b
  }
}
const cliente = (b: Base) => b as unknown as ClienteDeLectura

const base = (cuantos: number, duenos = ['maoli']): Base => {
  const b = new Base()
  b.filas = Array.from({ length: cuantos }, (_, i) => ({ id: `l${String(i).padStart(5, '0')}`, assigned_to: duenos[i % duenos.length] }))
  return b
}

async function main() {
  const registro = console.error
  console.error = () => undefined

  console.log('\n=== una cartera pequeña: una sola petición ===')
  {
    const b = base(300)
    const r = await cargarCartera(cliente(b))
    ok('trae las 300 y no hace más peticiones que una', r.leads.length === 300 && r.total === 300 && !r.incompleta && b.peticiones.length === 1)
    ok('la primera pide el recuento', b.peticiones[0].conRecuento)
  }

  console.log('\n=== una cartera grande: todos los tramos ===')
  {
    const b = base(6200)
    const r = await cargarCartera(cliente(b))
    ok('trae las 6.200 aunque PostgREST corte a 1.000', r.leads.length === 6200 && r.total === 6200 && !r.incompleta)
    ok('siete peticiones: el primer tramo y seis más', b.peticiones.length === 7, String(b.peticiones.length))
    ok('SOLO el primero pide el recuento', b.peticiones.filter((p) => p.conRecuento).length === 1 && b.peticiones[0].conRecuento && b.peticiones[0].desde === 0)
    ok('los tramos que faltan se piden a la vez, no uno detrás de otro', b.maximoSimultaneas === 6, String(b.maximoSimultaneas))
    ok('y vienen en orden, sin repetir ni saltarse ninguno', r.leads.every((l, i) => l.id === `l${String(i).padStart(5, '0')}`))
  }

  console.log('\n=== un tope de peticiones simultáneas ===')
  {
    const b = base(30_500)
    const r = await cargarCartera(cliente(b))
    ok('con 30.500 leads los trae todos', r.leads.length === 30_500 && !r.incompleta)
    ok(`pero nunca más de ${TRAMOS_A_LA_VEZ} peticiones juntas`, b.maximoSimultaneas <= TRAMOS_A_LA_VEZ, String(b.maximoSimultaneas))
  }

  console.log('\n=== cada comercial, la suya ===')
  {
    const b = base(3000, ['maoli', 'daniela', 'jose'])
    const r = await cargarCartera(cliente(b), { propietario: 'daniela' })
    ok('pide solo los de esa persona', r.leads.length === 1000 && b.peticiones.every((p) => p.propietario === 'daniela'))
    const todos = await cargarCartera(cliente(b))
    ok('sin propietario pide todo lo que se pueda ver', todos.leads.length === 3000 && b.peticiones.slice(-3).every((p) => p.propietario === null))
  }

  console.log('\n=== solo lo que se pinta ===')
  {
    const b = base(10)
    await cargarCartera(cliente(b))
    const columnas = b.peticiones[0].columnas
    ok('pide las columnas de la lista y no los campos largos de la ficha', columnas === COLUMNAS_DE_CARTERA && !/directors|business_address|mercantile_registry|decisor/.test(columnas))
    ok('con lo necesario para la lista, la búsqueda y la tabla', ['store_name', 'phone', 'status', 'next_call_date', 'last_contacted_at', 'call_attempts', 'source_list', 'follow_up', 'ventas_estimadas_usd', 'nivel'].every((c) => columnas.includes(c)))
  }

  console.log('\n=== cuando algo falla ===')
  {
    const b = base(3500)
    b.falla.add(2000)
    const r = await cargarCartera(cliente(b))
    ok('un tramo que falla se dice: cartera INCOMPLETA, no una cartera más corta', r.incompleta && r.leads.length === 2500 && r.total === 3500, `${r.leads.length}/${r.total}`)

    const roto = base(100)
    roto.falla.add(0)
    const r2 = await cargarCartera(cliente(roto))
    ok('si falla el primero no hay nada que enseñar, y se dice', r2.leads.length === 0 && r2.incompleta)
  }

  console.log('\n=== una base a la que todavía no se le ha lanzado la migración 262 (los partners) ===')
  {
    ok('las columnas de los partners se piden además de las de siempre', COLUMNAS_DE_CARTERA.startsWith(COLUMNAS_DE_CARTERA_SIN_PARTNERS) && COLUMNAS_DE_PARTNERS.split(', ').every((c) => COLUMNAS_DE_CARTERA.includes(c)))
    ok('y sin ellas la lista es la de antes de la 262', !/prioridad|puntos|resenas|rating|menciona_amazon/.test(COLUMNAS_DE_CARTERA_SIN_PARTNERS))
    ok('«columna inexistente» es PGRST204 o 42703, y nada más', faltanLasColumnasDePartners({ code: 'PGRST204' }) && faltanLasColumnasDePartners({ code: '42703' }) && !faltanLasColumnasDePartners({ code: 'XX000' }) && !faltanLasColumnasDePartners({ code: '57014' }) && !faltanLasColumnasDePartners(null))

    for (const codigo of ['42703', 'PGRST204']) {
      const sin = base(2500)
      sin.sinLa262 = codigo
      const r = await cargarCartera(cliente(sin))
      ok(`(${codigo}) la cartera llega ENTERA, como antes de la 262, y no vacía`, r.leads.length === 2500 && r.total === 2500 && !r.incompleta, `${r.leads.length}/${r.total} incompleta=${r.incompleta}`)
      ok(`(${codigo}) tras los errores repite el primer tramo hasta dar con lo que la base tiene (sin ubicación, y luego sin partners), y los demás ya van así`, sin.peticiones.length === 5 && sin.peticiones[1].columnas === COLUMNAS_DE_CARTERA_SIN_UBICACION && sin.peticiones.slice(2).every((p) => p.columnas === COLUMNAS_DE_CARTERA_SIN_PARTNERS), JSON.stringify(sin.peticiones.map((p) => p.columnas === COLUMNAS_DE_CARTERA ? 'con' : p.columnas === COLUMNAS_DE_CARTERA_SIN_UBICACION ? 'sin263' : 'sin262')))
    }

    const con = base(2500)
    const r = await cargarCartera(cliente(con))
    ok('con la 262 y la 263 lanzadas no hay ninguna petición de más: todas llevan las columnas de los partners y de la ubicación', con.peticiones.length === 3 && con.peticiones.every((p) => p.columnas === COLUMNAS_DE_CARTERA) && r.leads.length === 2500)

    const otraFalla = base(100)
    otraFalla.falla.add(0)
    const r2 = await cargarCartera(cliente(otraFalla))
    ok('un error que NO es de columna no se repite (no se enmascara un fallo de verdad)', otraFalla.peticiones.length === 1 && r2.incompleta && r2.leads.length === 0)
  }

  console.log('\n=== una base con la 262 pero sin la 263 (las columnas de ubicación) ===')
  {
    ok('las columnas de ubicación se piden además de las de los partners', COLUMNAS_DE_CARTERA.startsWith(COLUMNAS_DE_CARTERA_SIN_UBICACION) && COLUMNAS_DE_UBICACION.split(', ').join() === 'ccaa,municipio_ine' && COLUMNAS_DE_CARTERA.includes('ccaa') && COLUMNAS_DE_CARTERA.includes('municipio_ine'))
    ok('y sin ellas la lista es la de antes de la 263, con los partners', COLUMNAS_DE_CARTERA_SIN_UBICACION.includes('prioridad') && !/ccaa|municipio_ine/.test(COLUMNAS_DE_CARTERA_SIN_UBICACION))
    ok('el origen y la confianza de la deducción NO viajan con cada lead de la lista: son de la ficha', !/ubicacion_origen|ubicacion_confianza|ubicacion_calculada_at/.test(COLUMNAS_DE_CARTERA))
    for (const codigo of ['42703', 'PGRST204']) {
      const sin = base(2500)
      sin.sinLa263 = codigo
      const r = await cargarCartera(cliente(sin))
      ok(`(${codigo}) la cartera llega ENTERA, con los partners, y no vacía`, r.leads.length === 2500 && r.total === 2500 && !r.incompleta, `${r.leads.length}/${r.total}`)
      ok(`(${codigo}) una sola petición de más, y los demás tramos ya van sin la ubicación`, sin.peticiones.length === 4 && sin.peticiones[0].columnas === COLUMNAS_DE_CARTERA && sin.peticiones.slice(1).every((p) => p.columnas === COLUMNAS_DE_CARTERA_SIN_UBICACION), JSON.stringify(sin.peticiones.map((p) => p.columnas.length)))
    }
  }

  console.log('\n=== el progreso ===')
  {
    const b = base(2500)
    const pasos: Array<[number, number]> = []
    await cargarCartera(cliente(b), { alProgreso: (c, t) => pasos.push([c, t]) })
    ok('avisa con lo cargado y el total cada vez que llega algo', pasos.length >= 2 && pasos[0][0] === 1000 && pasos[0][1] === 2500 && pasos[pasos.length - 1][0] === 2500, JSON.stringify(pasos))
  }

  console.error = registro
}

main()
  .then(() => {
    console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
    if (fallos > 0) process.exit(1)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })

void FILAS_POR_TRAMO
