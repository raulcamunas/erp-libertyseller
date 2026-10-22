import { ErrorRinkel, type FilaLlamada, type PaginaDeLlamadas } from '@/lib/rendimiento/rinkel'
import { ESTADO_INICIAL, sincronizarCuenta, type DepsDeSincronizacion, type EstadoDeSincronizacion, type FilaParaGuardar } from '@/lib/rendimiento/sincronizar'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * TRAER LAS LLAMADAS DE UNA CUENTA DE RINKEL.
 *
 * Una API falsa con páginas de 50 (la más reciente primero, como la de verdad), un reloj que avanza 10 s por
 * petición y una «base» en memoria con upsert por id de Rinkel.
 */

const USUARIO = 'u-maoli'
const T0 = Date.parse('2026-10-22T10:00:00Z')

function llamada(i: number, extra: Partial<FilaLlamada> = {}): FilaLlamada {
  // i = 1 es la más antigua. Una cada 10 minutos hasta T0
  return {
    rinkel_id: `rk-${String(i).padStart(5, '0')}`,
    call_id: `call-${i}`,
    fecha: new Date(T0 - 7 * 86_400_000 + i * 600_000).toISOString(),
    direccion: 'outbound',
    duracion_s: 30,
    estado: 'ANSWERED',
    motivo_perdida: null,
    numero: `+346220${String(i).padStart(5, '0')}`,
    numero_anonimo: false,
    numero_propio: 'Maoli Liberty Seller',
    grabacion_id: null,
    grabacion_hasta: null,
    ...extra,
  }
}
const cuenta = (n: number) => Array.from({ length: n }, (_, i) => llamada(i + 1))

interface Mundo {
  api: FilaLlamada[]
  base: Map<string, FilaParaGuardar>
  reloj: { ahora: number }
  peticiones: Array<{ pagina: number; desdeSeg?: number }>
  guardados: number
  /** índice (desde 1) de la petición que falla, y con qué */
  falla: Map<number, ErrorRinkel>
  /** cuántos leads se pidieron */
  pidioLeads: number
  leads: Map<string, string>
}

function mundo(api: FilaLlamada[], leads: Array<[string, string]> = []): { m: Mundo; deps: DepsDeSincronizacion } {
  const m: Mundo = { api, base: new Map(), reloj: { ahora: T0 }, peticiones: [], guardados: 0, falla: new Map(), pidioLeads: 0, leads: new Map(leads) }
  const deps: DepsDeSincronizacion = {
    async leerPagina(op) {
      m.peticiones.push(op)
      m.reloj.ahora += 10_000
      const f = m.falla.get(m.peticiones.length)
      if (f) throw f
      // La API de verdad: de la más reciente a la más antigua, 50 por página, con filtro opcional de fecha
      const ordenadas = [...m.api]
        .filter((l) => op.desdeSeg === undefined || Date.parse(l.fecha) / 1000 >= op.desdeSeg)
        .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
      const totalPaginas = Math.max(1, Math.ceil(ordenadas.length / 50))
      return { filas: ordenadas.slice((op.pagina - 1) * 50, op.pagina * 50), descartadas: 0, total: ordenadas.length, totalPaginas, pagina: op.pagina } satisfies PaginaDeLlamadas
    },
    async guardar(filas) {
      m.guardados += filas.length
      for (const f of filas) m.base.set(f.rinkel_id, f)
    },
    async leadsPorTelefono() {
      m.pidioLeads += 1
      return m.leads
    },
    ahora: () => m.reloj.ahora,
  }
  return { m, deps }
}

async function main() {
  console.log('\n=== la primera vez, con tiempo de sobra ===')
  {
    const { m, deps } = mundo(cuenta(120))
    const r = await sincronizarCuenta(ESTADO_INICIAL, deps, { usuario: USUARIO, presupuestoMs: 600_000 })
    ok('lee las 120 llamadas en 3 páginas', m.base.size === 120 && r.paginas === 3 && r.leidas === 120, `${m.base.size} · ${r.paginas}`)
    ok('el histórico queda completo y no hay nada pendiente', r.estado.historico_completo && !r.pendiente && !r.paradaPorTiempo && r.error === null)
    ok('el cursor queda detrás de la última página', r.estado.siguiente_pagina === 4)
    ok('queda «al día» desde el principio de esta pasada', r.estado.ultimo_sync_at === new Date(T0).toISOString(), String(r.estado.ultimo_sync_at))
    ok('sabe cuántas tiene la cuenta', r.totalEnRinkel === 120)
    ok('cada una guardada con el usuario', [...m.base.values()].every((f) => f.user_id === USUARIO))
    ok('los leads se piden UNA vez, no una por página', m.pidioLeads === 1)
  }

  console.log('\n=== una cuenta vacía ===')
  {
    const { m, deps } = mundo([])
    const r = await sincronizarCuenta(ESTADO_INICIAL, deps, { usuario: USUARIO, presupuestoMs: 600_000 })
    ok('termina sin dar vueltas: una sola petición y completo', r.estado.historico_completo && m.peticiones.length === 1 && m.base.size === 0)
  }

  console.log('\n=== el histórico por tramos, cuando no cabe en una pasada ===')
  {
    const { m, deps } = mundo(cuenta(260)) // 6 páginas
    // 10 s por petición; 25 s de presupuesto: caben 3 páginas (a los 0, 10 y 20 s)
    let estado: EstadoDeSincronizacion = ESTADO_INICIAL
    const r1 = await sincronizarCuenta(estado, deps, { usuario: USUARIO, presupuestoMs: 25_000 })
    ok('la primera pasada se para por tiempo con 3 páginas leídas', r1.paradaPorTiempo && r1.paginas === 3 && m.base.size === 150, `${r1.paginas} · ${m.base.size}`)
    ok('queda pendiente y el cursor apunta a la página 4', r1.pendiente && r1.estado.siguiente_pagina === 4 && !r1.estado.historico_completo)
    ok('ya está «al día» con lo reciente aunque falte histórico', r1.estado.ultimo_sync_at !== null)

    estado = r1.estado
    m.reloj.ahora += 60_000
    const r2 = await sincronizarCuenta(estado, deps, { usuario: USUARIO, presupuestoMs: 600_000 })
    ok('la segunda pasada acaba el histórico: las 260 y completo', m.base.size === 260 && r2.estado.historico_completo && !r2.pendiente, `${m.base.size}`)
    const paginasDeHistorico = m.peticiones.filter((p) => p.desdeSeg === undefined).map((p) => p.pagina)
    ok('el histórico se leyó por páginas 1,2,3 y luego 4,5,6 sin repetir', JSON.stringify(paginasDeHistorico) === '[1,2,3,4,5,6]', JSON.stringify(paginasDeHistorico))
    ok('y la segunda pasada además repasó lo reciente con el solape', m.peticiones.some((p) => p.desdeSeg !== undefined))
  }

  console.log('\n=== llegan llamadas nuevas mientras se importa: no se salta ninguna ===')
  {
    const { m, deps } = mundo(cuenta(260))
    const r1 = await sincronizarCuenta(ESTADO_INICIAL, deps, { usuario: USUARIO, presupuestoMs: 25_000 })
    // Entran 7 llamadas nuevas: empujan a todas las demás 7 puestos hacia abajo
    for (let i = 261; i <= 267; i++) m.api.push(llamada(i, { fecha: new Date(T0 + 3_600_000 + (i - 260) * 60_000).toISOString() }))
    m.reloj.ahora += 3_700_000
    const r2 = await sincronizarCuenta(r1.estado, deps, { usuario: USUARIO, presupuestoMs: 600_000 })
    ok('al final están las 267: ni una perdida', m.base.size === 267, `${m.base.size}`)
    ok('y se repitieron como mucho las desplazadas, sin guardarlas dos veces', m.guardados >= 267 && m.base.size === 267)
    ok('histórico completo', r2.estado.historico_completo)
  }

  console.log('\n=== lo reciente, cada vez ===')
  {
    // 100 llamadas de hace una semana y 20 de las últimas horas: solo las recientes caen dentro del solape de 3 días
    const cuenta120 = cuenta(120).map((l, i) => (i >= 100 ? { ...l, fecha: new Date(T0 - (120 - i) * 600_000).toISOString() } : l))
    const { m, deps } = mundo(cuenta120)
    const r1 = await sincronizarCuenta(ESTADO_INICIAL, deps, { usuario: USUARIO, presupuestoMs: 600_000 })
    ok('punto de partida: 120', m.base.size === 120)

    // Pasan 2 horas: entran 4 llamadas nuevas y a una antigua le aparece la grabación
    m.reloj.ahora += 2 * 3_600_000
    for (let i = 121; i <= 124; i++) m.api.push(llamada(i, { fecha: new Date(m.reloj.ahora - (125 - i) * 600_000).toISOString() }))
    const reciente = m.api.find((l) => l.rinkel_id === 'rk-00120')!
    reciente.grabacion_id = 'rec-120'
    reciente.grabacion_hasta = '2027-01-20T00:00:00.000Z'

    m.peticiones.length = 0
    const r2 = await sincronizarCuenta(r1.estado, deps, { usuario: USUARIO, presupuestoMs: 600_000 })
    ok('trae las 4 nuevas', m.base.size === 124 && r2.error === null)
    ok('y la grabación que llegó después a una llamada ya guardada', m.base.get('rk-00120')?.grabacion_id === 'rec-120')
    ok('con una sola petición y con filtro de fecha (no relee la historia)', m.peticiones.length === 1 && m.peticiones[0].desdeSeg !== undefined, JSON.stringify(m.peticiones))
    const esperadoDesde = Math.floor((Date.parse(r1.estado.ultimo_sync_at!) - 3 * 86_400_000) / 1000)
    ok('desde la última lectura MENOS 3 días de solape', m.peticiones[0].desdeSeg === esperadoDesde, `${m.peticiones[0].desdeSeg} vs ${esperadoDesde}`)
    ok('el momento de «al día» avanza', Date.parse(r2.estado.ultimo_sync_at!) > Date.parse(r1.estado.ultimo_sync_at!))
    ok('histórico ya completo: no vuelve a leerlo', r2.paginas === 1 && !r2.pendiente)
    const antes = m.base.size
    m.reloj.ahora += 600_000
    await sincronizarCuenta(r2.estado, deps, { usuario: USUARIO, presupuestoMs: 600_000 })
    ok('repetir la pasada no duplica nada', m.base.size === antes)
  }

  console.log('\n=== cada llamada con el lead al que se llamó ===')
  {
    const { m, deps } = mundo(cuenta(3), [['622000001', 'lead-A'], ['622000003', 'lead-C']])
    await sincronizarCuenta(ESTADO_INICIAL, deps, { usuario: USUARIO, presupuestoMs: 600_000 })
    ok('la llamada a un número de un lead suyo lleva su lead_id', m.base.get('rk-00001')?.lead_id === 'lead-A' && m.base.get('rk-00003')?.lead_id === 'lead-C')
    ok('la que no es de ningún lead suyo, no lleva ninguno', m.base.get('rk-00002')?.lead_id === null)
    const oculto = mundo([llamada(1, { numero: null, numero_anonimo: true })], [['622000001', 'lead-A']])
    await sincronizarCuenta(ESTADO_INICIAL, oculto.deps, { usuario: USUARIO, presupuestoMs: 600_000 })
    ok('un número oculto no se casa con nadie', oculto.m.base.get('rk-00001')?.lead_id === null)
  }

  console.log('\n=== cuando Rinkel falla a mitad ===')
  {
    const { m, deps } = mundo(cuenta(260))
    m.falla.set(3, new ErrorRinkel('limite', 'demasiadas peticiones', 429))
    const r = await sincronizarCuenta(ESTADO_INICIAL, deps, { usuario: USUARIO, presupuestoMs: 600_000 })
    ok('lo leído antes del fallo está guardado: 2 páginas, 100 llamadas', m.base.size === 100, `${m.base.size}`)
    ok('el error viaja junto al estado, no en lugar de él, y es de Rinkel', r.error?.codigo === 'limite' && r.estado.siguiente_pagina === 3 && !r.falloInterno)
    ok('sigue pendiente', r.pendiente && !r.estado.historico_completo)

    m.falla.clear()
    const r2 = await sincronizarCuenta(r.estado, deps, { usuario: USUARIO, presupuestoMs: 600_000 })
    ok('y la siguiente pasada sigue donde se quedó, sin repetir las dos primeras', m.base.size === 260 && r2.estado.historico_completo && m.peticiones.filter((p) => p.desdeSeg === undefined).map((p) => p.pagina).join(',') === '1,2,3,3,4,5,6', m.peticiones.map((p) => p.pagina).join(','))
  }

  console.log('\n=== una clave que ya no vale ===')
  {
    const { m, deps } = mundo(cuenta(120))
    m.falla.set(1, new ErrorRinkel('clave_invalida', 'no vale', 401))
    const r = await sincronizarCuenta(ESTADO_INICIAL, deps, { usuario: USUARIO, presupuestoMs: 600_000 })
    ok('no se guarda nada y se dice por qué', m.base.size === 0 && r.error?.codigo === 'clave_invalida')
    ok('el estado no avanza', r.estado.siguiente_pagina === 1 && r.estado.ultimo_sync_at === null && !r.estado.historico_completo)
  }

  console.log('\n=== cosas raras ===')
  {
    // Rinkel dice que hay 5 páginas pero devuelve vacío en la segunda: no se insiste en bucle
    const { m, deps } = mundo(cuenta(60))
    const original = deps.leerPagina
    deps.leerPagina = async (op) => {
      const p = await original(op)
      return op.pagina >= 2 ? { ...p, filas: [], totalPaginas: 5 } : { ...p, totalPaginas: 5 }
    }
    const r = await sincronizarCuenta(ESTADO_INICIAL, deps, { usuario: USUARIO, presupuestoMs: 600_000 })
    ok('una página vacía con más páginas por delante corta el histórico en vez de dar vueltas', r.estado.historico_completo && m.peticiones.length === 2, `${m.peticiones.length}`)
  }
  {
    const { m, deps } = mundo(cuenta(5000))
    const r = await sincronizarCuenta(ESTADO_INICIAL, deps, { usuario: USUARIO, presupuestoMs: 10 ** 12, maxPaginas: 10 })
    ok('un tope de páginas por pasada evita las pasadas interminables', r.paginas === 10 && r.paradaPorTiempo && r.pendiente && m.base.size === 500)
  }
  {
    // El reloj no deja leer ni una página: presupuesto 0
    const { m, deps } = mundo(cuenta(120))
    const r = await sincronizarCuenta(ESTADO_INICIAL, deps, { usuario: USUARIO, presupuestoMs: 0 })
    ok('sin tiempo no se lee nada y se dice que se paró por tiempo', r.paginas === 0 && r.paradaPorTiempo && r.pendiente && m.base.size === 0)
  }
  {
    // Un fallo que no es de Rinkel (por ejemplo, la base) no se pierde ni se esconde
    const { deps } = mundo(cuenta(120))
    deps.guardar = async () => {
      throw new Error('la base no contesta')
    }
    const r = await sincronizarCuenta(ESTADO_INICIAL, deps, { usuario: USUARIO, presupuestoMs: 600_000 })
    ok('se devuelve como un error, marcado como fallo interno (no es culpa de la cuenta de Rinkel) y sin estado adelantado', r.error !== null && r.falloInterno && r.estado.siguiente_pagina === 1)
  }
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
