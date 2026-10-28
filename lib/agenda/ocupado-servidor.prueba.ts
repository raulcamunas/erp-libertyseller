import { choquesEnLaBase } from './ocupado-servidor'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** Un cliente de la base de mentira que apunta cada paso de la consulta y devuelve lo que se le diga */
function falso(filas: unknown[] | null, error: { code?: string; message?: string } | null = null) {
  const pasos: Array<[string, unknown[]]> = []
  const q: Record<string, unknown> = {}
  for (const metodo of ['select', 'neq', 'lt', 'gt', 'gte', 'order', 'limit']) {
    q[metodo] = (...a: unknown[]) => {
      pasos.push([metodo, a])
      return q
    }
  }
  q.then = (resolver: (r: unknown) => unknown) => resolver({ data: filas, error })
  const cliente = {
    from: (tabla: string) => {
      pasos.push(['from', [tabla]])
      return q
    },
  } as never
  return { cliente, pasos }
}
const paso = (pasos: Array<[string, unknown[]]>, nombre: string) => pasos.filter(([n]) => n === nombre).map(([, a]) => a)

const I = '2026-10-30T09:00:00.000Z'
const F = '2026-10-30T10:00:00.000Z'

async function main() {
  console.log('\n=== lo que se le pide a la base ===')
  {
    const { cliente, pasos } = falso([])
    await choquesEnLaBase(cliente, { inicio: I, fin: F })
    ok('lee de la tabla de citas (que trae también los huecos de Google)', JSON.stringify(paso(pasos, 'from')) === '[["appointments"]]')
    ok('sin las canceladas', JSON.stringify(paso(pasos, 'neq')) === '[["status","cancelled"]]')
    ok('lo que empieza antes de que acabe lo nuevo', JSON.stringify(paso(pasos, 'lt')) === JSON.stringify([['start_time', F]]))
    ok('y acaba después de que empiece', JSON.stringify(paso(pasos, 'gt')) === JSON.stringify([['end_time', I]]))
    ok('con un tope por detrás (48 h) para no recorrer toda la tabla: nada dura más', JSON.stringify(paso(pasos, 'gte')) === JSON.stringify([['start_time', '2026-10-28T09:00:00.000Z']]), JSON.stringify(paso(pasos, 'gte')))
    ok('por orden de hora y con un máximo de filas', paso(pasos, 'order').length === 1 && JSON.stringify(paso(pasos, 'limit')) === '[[25]]')
    ok('trae solo lo que hace falta (sin teléfonos ni correos de nadie)', JSON.stringify(paso(pasos, 'select')) === '[["id, start_time, end_time, status, is_external, lead_name"]]')
  }
  {
    const { cliente, pasos } = falso([])
    await choquesEnLaBase(cliente, { inicio: I, fin: F, ignorarId: 'cita-1' })
    ok('al mover una cita se deja fuera a ella misma', JSON.stringify(paso(pasos, 'neq')) === '[["status","cancelled"],["id","cita-1"]]', JSON.stringify(paso(pasos, 'neq')))
  }

  console.log('\n=== lo que devuelve ===')
  {
    const filas = [
      { id: 'g1', start_time: '2026-10-30T09:00:00.000Z', end_time: '2026-10-30T10:00:00.000Z', status: 'scheduled', is_external: true, lead_name: null },
      { id: 'a1', start_time: '2026-10-30T09:30:00.000Z', end_time: '2026-10-30T10:30:00.000Z', status: 'confirmed', is_external: false, lead_name: 'Merce Lopez' },
    ]
    const { cliente } = falso(filas)
    const r = await choquesEnLaBase(cliente, { inicio: I, fin: F })
    ok('los huecos de Google y las citas, por orden de hora', r.map((c) => c.id).join() === 'g1,a1' && r[0].externo && !r[1].externo && r[1].con === 'Merce Lopez', JSON.stringify(r))
  }
  {
    // Si la base devolviera de más (no debería), la regla de siempre lo deja igual que lo que ve la pantalla
    const filas = [
      { id: 'lejos', start_time: '2026-10-30T11:00:00.000Z', end_time: '2026-10-30T12:00:00.000Z', status: 'scheduled', is_external: false, lead_name: 'X' },
      { id: 'cancelada', start_time: '2026-10-30T09:00:00.000Z', end_time: '2026-10-30T10:00:00.000Z', status: 'cancelled', is_external: false, lead_name: 'Y' },
      { id: 'justo-despues', start_time: F, end_time: '2026-10-30T11:00:00.000Z', status: 'scheduled', is_external: false, lead_name: 'Z' },
    ]
    const r = await choquesEnLaBase(falso(filas).cliente, { inicio: I, fin: F })
    ok('lo que no choca (otro día, cancelada, justo a continuación) no cuenta aunque venga en la lista', r.length === 0, JSON.stringify(r))
  }
  {
    const r = await choquesEnLaBase(falso(null).cliente, { inicio: I, fin: F })
    ok('una lista vacía o nula es «libre»', r.length === 0)
  }

  console.log('\n=== si la base falla, se deja agendar (y se apunta) ===')
  {
    const registros: string[] = []
    const original = console.error
    console.error = (...a: unknown[]) => registros.push(JSON.stringify(a))
    const r = await choquesEnLaBase(falso(null, { code: '57014', message: 'canceling statement due to statement timeout' }).cliente, { inicio: I, fin: F })
    console.error = original
    ok('un error de la base no bloquea a nadie', r.length === 0)
    ok('queda apuntado en el registro del servidor, con el código', registros.length === 1 && /57014/.test(registros[0]) && /se deja agendar/.test(registros[0]), registros.join())
  }

  console.log('\n=== fechas que no se entienden: ni se pregunta a la base ===')
  {
    for (const [inicio, fin] of [['mañana', F], [I, 'jamás'], [F, I], [I, I]] as const) {
      const { cliente, pasos } = falso([{ id: 'x', start_time: I, end_time: F, status: 'scheduled' }])
      const r = await choquesEnLaBase(cliente, { inicio, fin })
      ok(`(${inicio.slice(0, 16)} → ${fin.slice(0, 16)}) no consulta nada y no bloquea`, r.length === 0 && pasos.length === 0)
    }
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
