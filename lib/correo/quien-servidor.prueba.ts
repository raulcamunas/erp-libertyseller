import { ACCESOS_RECIENTES, buzonesAsignadosA, leerDuenos, quienPide, registrarAcceso } from '@/lib/correo/quien-servidor'

/**
 * PRUEBA DE quien-servidor.ts: asignaciones (con y sin la 318), quienPide para admin y partner, y el rastro.
 * Uso: npx tsx lib/correo/quien-servidor.prueba.ts
 */

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

type Fila = Record<string, unknown>
type ErrorFalso = { code: string; message: string }

/** Un cliente falso mínimo: select con eq/in, maybeSingle e insert. Errores por tabla (lectura o inserción) */
function clienteFalso(tablas: Record<string, Fila[]>, errores: { lectura?: Record<string, ErrorFalso>; insercion?: Record<string, ErrorFalso> } = {}) {
  const consultadas: string[] = []
  const from = (tabla: string) => {
    consultadas.push(tabla)
    const filtros: Array<(f: Fila) => boolean> = []
    const resultado = () => {
      const e = errores.lectura?.[tabla]
      if (e) return { data: null, error: e }
      return { data: (tablas[tabla] ?? []).filter((f) => filtros.every((p) => p(f))), error: null }
    }
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filtros.push((f) => f[c] === v), q),
      in: (c: string, vs: unknown[]) => (filtros.push((f) => vs.includes(f[c])), q),
      maybeSingle: async () => {
        const r = resultado()
        return { data: r.data?.[0] ?? null, error: r.error }
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(resultado()).then(res, rej),
      insert: async (fila: Fila) => {
        const e = errores.insercion?.[tabla]
        if (e) return { error: e }
        ;(tablas[tabla] ??= []).push(fila)
        return { error: null }
      },
    }
    return q
  }
  return { cliente: { from } as never, tablas, consultadas }
}

const SIN_TABLA: ErrorFalso = { code: '42P01', message: 'relation does not exist' }
const OTRO: ErrorFalso = { code: '57014', message: 'canceling statement due to statement timeout' }
const RAUL = 'u-raul', ANA = 'u-ana', SOCIO = 'u-socio'

async function main() {
  console.log('buzonesAsignadosA')
  {
    const { cliente } = clienteFalso({}, { lectura: { correo_buzon_asignaciones: SIN_TABLA } })
    const r = await buzonesAsignadosA(cliente, ANA)
    ok('sin la tabla (318 sin lanzar), conjuntos vacíos', r.asignados.size === 0 && r.conRespuesta.size === 0)
  }
  {
    const { cliente } = clienteFalso({}, { lectura: { correo_buzon_asignaciones: OTRO } })
    let lanzo = false
    try {
      await buzonesAsignadosA(cliente, ANA)
    } catch (e) {
      lanzo = e instanceof Error && (e.cause as ErrorFalso | undefined)?.code === '57014'
    }
    ok('otro error se propaga (con el original en cause)', lanzo)
  }
  {
    const { cliente } = clienteFalso({
      correo_buzon_asignaciones: [
        { buzon_id: 'b1', persona_id: ANA, puede_responder: true },
        { buzon_id: 'b2', persona_id: ANA, puede_responder: false },
        { buzon_id: 'b3', persona_id: RAUL, puede_responder: true },
      ],
    })
    const r = await buzonesAsignadosA(cliente, ANA)
    ok('lee solo las suyas', r.asignados.size === 2 && r.asignados.has('b1') && r.asignados.has('b2'))
    ok('con respuesta solo las de puede_responder', r.conRespuesta.size === 1 && r.conRespuesta.has('b1'))
  }

  console.log('quienPide')
  {
    const { cliente, consultadas } = clienteFalso({ correo_buzon_asignaciones: [{ buzon_id: 'b9', persona_id: RAUL, puede_responder: true }] })
    const q = await quienPide(cliente, { userId: RAUL, role: 'admin' })
    ok('admin: permisos a false', q.tienePermisoEquipo === false && q.tienePermisoCorreo === false)
    ok('admin: lleva sus asignaciones', q.buzonesAsignados?.has('b9') === true && q.buzonesConRespuesta?.has('b9') === true)
    ok('admin: no lee permisos sueltos', !consultadas.includes('user_app_permissions'))
  }
  {
    const { cliente, consultadas } = clienteFalso({
      user_app_permissions: [],
      correo_buzon_lectores: [],
      correo_buzon_bloqueos: [],
      correo_buzon_asignaciones: [{ buzon_id: 'b1', persona_id: SOCIO, puede_responder: true }],
    })
    const q = await quienPide(cliente, { userId: SOCIO, role: 'partner' })
    ok('partner: conjuntos vacíos aunque haya fila colada', q.buzonesAsignados?.size === 0 && q.buzonesConRespuesta?.size === 0)
    ok('partner: ni se lee la tabla', !consultadas.includes('correo_buzon_asignaciones'))
  }
  {
    const { cliente } = clienteFalso(
      { user_app_permissions: [{ user_id: ANA, app_id: 'correo-supervision', can_access: true }] },
      { lectura: { correo_buzon_lectores: SIN_TABLA, correo_buzon_bloqueos: SIN_TABLA, correo_buzon_asignaciones: SIN_TABLA } }
    )
    const q = await quienPide(cliente, { userId: ANA, role: 'employee' })
    ok('empleado sin 255/260/318: conjuntos vacíos y sigue', q.buzonesAsignados?.size === 0 && q.buzonesConcedidos?.size === 0 && q.buzonesBloqueados?.size === 0)
  }
  {
    const { cliente } = clienteFalso({}, { lectura: { correo_buzon_asignaciones: OTRO } })
    let lanzo = false
    try {
      await quienPide(cliente, { userId: ANA, role: 'employee' })
    } catch {
      lanzo = true
    }
    ok('empleado: un fallo de asignaciones hace fallar quienPide', lanzo)
  }

  console.log('leerDuenos')
  {
    const { cliente, consultadas } = clienteFalso({ profiles: [{ id: ANA, full_name: ' Ana ', email: 'a@l.es', is_comercial: true, role: 'employee' }] })
    const vacio = await leerDuenos(cliente, [])
    ok('sin ids no consulta', vacio.size === 0 && consultadas.length === 0)
    const m = await leerDuenos(cliente, [ANA, ANA, 'u-nadie'])
    ok('mapa con datos del dueño y nombre', m.get(ANA)?.is_comercial === true && m.get(ANA)?.role === 'employee' && m.get(ANA)?.nombre === 'Ana' && !m.has('u-nadie'))
  }

  console.log('registrarAcceso')
  const quien = { userId: RAUL, nombre: 'Raúl' }
  {
    ACCESOS_RECIENTES.clear()
    const { cliente, tablas } = clienteFalso({ correo_accesos: [] })
    const t = 1_000_000
    await registrarAcceso(cliente, quien, 'b1', 'envio', { id: 'h1', asunto: 'Hola' }, { ahora: t })
    await registrarAcceso(cliente, quien, 'b1', 'envio', { id: 'h1', asunto: 'Hola' }, { ahora: t + 1000 })
    ok('dos «envio» seguidos dejan dos filas', tablas.correo_accesos.length === 2)
    await registrarAcceso(cliente, quien, 'b1', 'envio', { id: null, asunto: 'Nuevo' }, { ahora: t + 2000 })
    ok('«envio» sin hilo guarda hilo_id null', tablas.correo_accesos[2]?.hilo_id === null && tablas.correo_accesos[2]?.asunto === 'Nuevo')
  }
  {
    ACCESOS_RECIENTES.clear()
    const { cliente, tablas } = clienteFalso({ correo_accesos: [] })
    const t = 5_000_000
    await registrarAcceso(cliente, quien, 'b1', 'aviso', { id: 'h1', asunto: 'Uno' }, { ahora: t })
    await registrarAcceso(cliente, quien, 'b1', 'aviso', { id: 'h2', asunto: 'Dos' }, { ahora: t + 29 * 60_000 })
    ok('dos «aviso» en 30 min dejan una fila (aunque sean hilos distintos)', tablas.correo_accesos.length === 1)
    await registrarAcceso(cliente, quien, 'b1', 'aviso', { id: 'h3', asunto: 'Tres' }, { ahora: t + 31 * 60_000 })
    ok('pasados 30 min, otra', tablas.correo_accesos.length === 2)
    await registrarAcceso(cliente, quien, 'b1', 'hilo', { id: 'h1', asunto: 'Uno' }, { ahora: t })
    await registrarAcceso(cliente, quien, 'b1', 'hilo', { id: 'h1', asunto: 'Uno' }, { ahora: t + 60_000, sinCache: true })
    ok('sinCache escribe aunque haya una reciente', tablas.correo_accesos.length === 4)
  }
  {
    ACCESOS_RECIENTES.clear()
    const { cliente } = clienteFalso({}, { insercion: { correo_accesos: OTRO } })
    let lanzo = false
    try {
      await registrarAcceso(cliente, quien, 'b1', 'hilo', { id: 'h1', asunto: 'x' }, { ahora: 1 })
    } catch {
      lanzo = true
    }
    ok('un error de insert lanza', lanzo)
    ok('y no queda en la caché', ACCESOS_RECIENTES.size === 0)
  }

  console.log(`\n${comprobaciones - fallos}/${comprobaciones} bien`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
