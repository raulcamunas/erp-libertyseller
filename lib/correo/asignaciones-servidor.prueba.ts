import { crearBaseFalsa } from '@/lib/mcp/comercial/base-falsa'
import { NADIE_LA_LLEVA, NO_SE_LE_PUEDE_ENCARGAR, asignarHilo, encargables, marcarHiloHecho } from '@/lib/correo/asignaciones-servidor'

/**
 * ENCARGAR UNA CONVERSACIÓN: LA ÚNICA VERSIÓN, LA QUE LLAMA EL PATCH DE /api/correo/hilos/[id].
 * Con la base falsa: a quién se puede encargar (la misma regla que la lista «encargables»), la nota, los avisos y «hecho».
 */

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ANA = id(1), PATRICIA = id(2), JHANNA = id(3), RAUL = id(4), LUIS = id(5)
const B_ANA = id(101)
const HILO = id(201)

const datos = () => ({
  profiles: [
    { id: ANA, full_name: 'Ana', email: 'ana@l.es', role: 'employee', is_comercial: true },
    { id: PATRICIA, full_name: 'Patricia', email: 'patricia@l.es', role: 'employee', is_comercial: false },
    // Jhanna supervisa el correo: lee el buzón de Ana, pero a quien no es admin no se le dice (ni se le deja encargársela)
    { id: JHANNA, full_name: 'Jhanna', email: 'jhanna@l.es', role: 'employee', is_comercial: false },
    { id: RAUL, full_name: 'Raúl', email: 'raul@l.es', role: 'admin', is_comercial: false },
    // Luis tiene Correo pero no lee este buzón
    { id: LUIS, full_name: 'Luis', email: 'luis@l.es', role: 'employee', is_comercial: false },
  ],
  user_app_permissions: [
    { user_id: ANA, app_id: 'correo', can_access: true },
    { user_id: PATRICIA, app_id: 'correo', can_access: true },
    { user_id: JHANNA, app_id: 'correo', can_access: true },
    { user_id: JHANNA, app_id: 'correo-supervision', can_access: true },
    { user_id: LUIS, app_id: 'correo', can_access: true },
  ],
  correo_buzones: [{ id: B_ANA, user_id: ANA, direccion: 'ana@l.es', nombre: null }],
  correo_buzon_lectores: [] as Array<Record<string, unknown>>,
  correo_buzon_bloqueos: [] as Array<Record<string, unknown>>,
  correo_buzon_asignaciones: [{ buzon_id: B_ANA, persona_id: PATRICIA, puede_responder: true }] as Array<Record<string, unknown>>,
  correo_hilo_asignaciones: [] as Array<Record<string, unknown>>,
  notifications: [] as Array<Record<string, unknown>>,
})
const nueva = (extra: Record<string, unknown[] | null> = {}) => crearBaseFalsa({ ...datos(), ...extra } as never, { unicos: { correo_hilo_asignaciones: ['hilo_id'] } })

const ana = { id: ANA, nombre: 'Ana', role: 'employee' }
const raul = { id: RAUL, nombre: 'Raúl', role: 'admin' }
const hilo = { id: HILO, buzonId: B_ANA, asunto: 'Presupuesto Q4', duenoId: ANA }
const encargos = (b: ReturnType<typeof nueva>) => b.tablas.get('correo_hilo_asignaciones')!
const avisos = (b: ReturnType<typeof nueva>) => b.tablas.get('notifications')!

async function main() {
  console.log('\n=== a quién se puede encargar (la misma regla que «encargables») ===')
  {
    const b = nueva()
    const r = await asignarHilo(b.servicio, ana, hilo, { personaId: JHANNA })
    ok('la dueña no puede encargársela a quien la supervisa: 400', !r.ok && r.estado === 400 && r.error === NO_SE_LE_PUEDE_ENCARGAR)
    ok('y no se escribe nada en correo_hilo_asignaciones', encargos(b).length === 0 && avisos(b).length === 0)
    const fuera = await asignarHilo(b.servicio, ana, hilo, { personaId: LUIS })
    ok('a quien no lee el buzón, el MISMO 400 (no se delata la vía)', !fuera.ok && fuera.estado === 400 && fuera.error === (r as { error: string }).error)
    const lista = await encargables(b.servicio, { id: B_ANA, user_id: ANA }, { userId: ANA, role: 'employee' })
    ok('la lista a la dueña: ella y Patricia, sin Jhanna', lista.map((p) => p.id).join() === [ANA, PATRICIA].join(), lista.map((p) => p.nombre).join())
    const admin = await asignarHilo(b.servicio, raul, hilo, { personaId: JHANNA })
    ok('un administrador sí puede encargársela a la supervisora', admin.ok && admin.asignacion?.personaId === JHANNA && encargos(b).length === 1)
  }

  console.log('\n=== encargar, avisar y la nota ===')
  {
    const b = nueva()
    const r = await asignarHilo(b.servicio, ana, hilo, { personaId: PATRICIA, nota: '  Contéstale hoy ' })
    ok('se encarga a Patricia con la nota limpia', r.ok && r.cambiado && r.asignacion?.nombre === 'Patricia' && r.asignacion?.nota === 'Contéstale hoy')
    ok('queda en la tabla con quién la encargó', encargos(b).length === 1 && encargos(b)[0].persona_id === PATRICIA && encargos(b)[0].asignado_por === ANA && encargos(b)[0].hecho_at === null)
    ok('a Patricia le llega UN aviso correo_asignado', avisos(b).length === 1 && avisos(b)[0].user_id === PATRICIA && avisos(b)[0].type === 'correo_asignado', JSON.stringify(avisos(b)[0] ?? null))

    const sinNota = await asignarHilo(b.servicio, ana, hilo, { personaId: PATRICIA })
    ok('volver a encargársela sin nota NO le borra la que tenía', sinNota.ok && !sinNota.cambiado && sinNota.asignacion?.nota === 'Contéstale hoy' && encargos(b)[0].nota === 'Contéstale hoy')
    ok('ni le vuelve a avisar', avisos(b).length === 1)
    const otraNota = await asignarHilo(b.servicio, ana, hilo, { personaId: PATRICIA, nota: 'Mejor mañana' })
    ok('con otra nota, solo cambia la nota (sin otro aviso)', otraNota.ok && otraNota.cambiado && encargos(b)[0].nota === 'Mejor mañana' && avisos(b).length === 1)

    const yo = await asignarHilo(b.servicio, ana, hilo, { personaId: ANA })
    ok('quedársela una misma: encargo nuevo, sin nota y sin aviso', yo.ok && encargos(b).length === 1 && encargos(b)[0].persona_id === ANA && encargos(b)[0].nota === null && avisos(b).length === 1)

    const quitar = await asignarHilo(b.servicio, ana, hilo, { personaId: null })
    ok('quitar el encargo lo borra', quitar.ok && quitar.asignacion === null && encargos(b).length === 0)
  }

  console.log('\n=== «hecho» y reabrir ===')
  {
    const b = nueva()
    const nadie = await marcarHiloHecho(b.servicio, ana, hilo, true)
    ok('sin nadie encargado: 404', !nadie.ok && nadie.estado === 404 && nadie.error === NADIE_LA_LLEVA)
    await asignarHilo(b.servicio, ana, hilo, { personaId: PATRICIA, nota: 'Llámale' })
    const hecho = await marcarHiloHecho(b.servicio, { id: PATRICIA, nombre: 'Patricia' }, hilo, true)
    ok('Patricia la marca hecha', hecho.ok && hecho.cambiado && typeof encargos(b)[0].hecho_at === 'string')
    const otraVez = await marcarHiloHecho(b.servicio, { id: PATRICIA, nombre: 'Patricia' }, hilo, true)
    ok('marcarla hecha dos veces no cambia nada', otraVez.ok && !otraVez.cambiado)
    const antes = avisos(b).length
    // La clave del aviso lleva el milisegundo del encargo: en la prueba, que no coincida con el del primero
    await new Promise((r) => setTimeout(r, 5))
    const reabre = await marcarHiloHecho(b.servicio, ana, hilo, false)
    ok('la dueña la reabre: vuelve a estar abierta', reabre.ok && reabre.cambiado && encargos(b)[0].hecho_at === null)
    ok('y a Patricia le llega otro aviso (con su nota)', avisos(b).length === antes + 1 && String(avisos(b).at(-1)?.message ?? '').includes('Llámale'), JSON.stringify(avisos(b).at(-1) ?? null))
    await marcarHiloHecho(b.servicio, { id: PATRICIA, nombre: 'Patricia' }, hilo, true)
    const n = avisos(b).length
    await marcarHiloHecho(b.servicio, { id: PATRICIA, nombre: 'Patricia' }, hilo, false)
    ok('si la reabre ella misma, sin aviso', avisos(b).length === n)
  }

  console.log('\n=== reabrir con la encargada ya sin acceso al buzón: no se reabre ni se le avisa ===')
  {
    // Patricia tenía el hilo, lo marcó hecho, y después le bloquean el buzón: reabrirlo no le puede mandar el asunto y la nota
    const b = nueva({ correo_buzon_bloqueos: [] })
    await asignarHilo(b.servicio, ana, hilo, { personaId: PATRICIA, nota: 'Llámale' })
    await marcarHiloHecho(b.servicio, { id: PATRICIA, nombre: 'Patricia' }, hilo, true)
    b.tablas.get('correo_buzon_bloqueos')!.push({ buzon_id: B_ANA, lector_id: PATRICIA, bloqueado_por: RAUL, bloqueado_at: '2026-11-16T10:00:00.000Z' })
    const antes = avisos(b).length
    await new Promise((r) => setTimeout(r, 5))
    const reabre = await marcarHiloHecho(b.servicio, ana, hilo, false)
    ok('con el buzón bloqueado a Patricia: 400 y sin reabrir', !reabre.ok && reabre.estado === 400 && reabre.error === NO_SE_LE_PUEDE_ENCARGAR && encargos(b)[0].hecho_at !== null, JSON.stringify(reabre))
    ok('y no le llega ningún aviso', avisos(b).length === antes)
  }

  console.log('\n=== sin la migración 318 ===')
  {
    const b = nueva({ correo_hilo_asignaciones: null })
    const r = await asignarHilo(b.servicio, ana, hilo, { personaId: PATRICIA })
    ok('encargar contesta 503 con faltaMigracion', !r.ok && r.estado === 503 && r.faltaMigracion === true)
    const h = await marcarHiloHecho(b.servicio, ana, hilo, true)
    ok('«hecho» también', !h.ok && h.estado === 503 && h.faltaMigracion === true)
  }

  console.log(`\n${comprobaciones - fallos}/${comprobaciones} comprobaciones bien${fallos ? ` — ${fallos} FALLAN` : ''}`)
  if (fallos) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
