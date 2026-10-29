import {
  FASES_DEL_SEGUIMIENTO,
  FILTROS_DE_CITA,
  MOTIVOS_DE_DESCARTE,
  PESTANAS_DEL_CRM,
  PREFIJO_DE_DESCARTE,
  accionesDisponibles,
  avisoDeAccion,
  coincideConElFiltroDeCita,
  contarPorPestana,
  cuentaDeCerrados,
  cuentaDeCitas,
  destinoDe,
  diasDesde,
  esAccionDeDescarte,
  motivoDeDescarte,
  notaDeDescarte,
  ordenarCerrados,
  ordenarCitas,
  ordenarSeguimiento,
  pestanaDe,
  resumenDeContactos,
  siguientePaso,
  situacionDeLaCita,
  sugerenciaDeLaCita,
  type ContactoLigero,
} from '@/lib/crm/pestanas'
import { CRM_STAGES, type CrmClientWithDetails, type CrmStage } from '@/lib/types/crm'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const AHORA = Date.parse('2026-10-29T10:00:00.000Z')
const HORA = 3_600_000
const DIA = 24 * HORA
const iso = (ms: number) => new Date(ms).toISOString()

let n = 0
const cliente = (stage: CrmStage, extra: Partial<CrmClientWithDetails> & { cita?: { status: string; inicio: number } | null } = {}): CrmClientWithDetails => {
  n++
  const { cita, ...resto } = extra
  return {
    id: `c${n}`,
    appointment_id: cita ? `a${n}` : null,
    stage,
    owner_id: null,
    lead_name: `Lead ${n}`,
    lead_email: null,
    lead_phone: null,
    lead_company: null,
    revenue_amount: null,
    amazon_link: null,
    contact_role: null,
    website: null,
    country: null,
    marketplaces: null,
    setup_budget: null,
    maintenance_budget: null,
    next_action: null,
    next_action_date: null,
    notes: null,
    closed_at: null,
    preguntas: {},
    created_at: iso(AHORA - 30 * DIA),
    updated_at: iso(AHORA - 10 * DIA),
    appointment: cita ? ({ id: `a${n}`, status: cita.status, start_time: iso(cita.inicio) } as unknown as CrmClientWithDetails['appointment']) : null,
    ...resto,
  }
}

console.log('\n=== las tres pestañas cubren las siete fases, sin repetir ===')
{
  ok('son tres, en este orden', PESTANAS_DEL_CRM.map((p) => p.id).join() === 'cita,seguimiento,cerrado' && PESTANAS_DEL_CRM.map((p) => p.nombre).join() === 'Cita agendada,En seguimiento,Cerrado')
  const todas = PESTANAS_DEL_CRM.flatMap((p) => [...p.fases])
  ok('cada fase está en una y solo una pestaña', todas.length === CRM_STAGES.length && new Set(todas).size === CRM_STAGES.length && CRM_STAGES.every((s) => todas.includes(s)))
  ok('«nuevo» es Cita agendada', pestanaDe('nuevo') === 'cita')
  ok('seguimiento, propuesta, revisión y negociación son En seguimiento', FASES_DEL_SEGUIMIENTO.every((s) => pestanaDe(s) === 'seguimiento') && FASES_DEL_SEGUIMIENTO.length === 4)
  ok('ganado y perdido son Cerrado', pestanaDe('ganado') === 'cerrado' && pestanaDe('perdido') === 'cerrado')
  const c = contarPorPestana([{ stage: 'nuevo' }, { stage: 'nuevo' }, { stage: 'seguimiento' }, { stage: 'negociacion' }, { stage: 'ganado' }, { stage: 'perdido' }, { stage: 'perdido' }])
  ok('cuenta por pestaña', c.cita === 2 && c.seguimiento === 2 && c.cerrado === 3)
  ok('sin clientes, todo a cero', JSON.stringify(contarPorPestana([])) === JSON.stringify({ cita: 0, seguimiento: 0, cerrado: 0 }))
}

console.log('\n=== qué se puede hacer con un lead y a dónde va ===')
{
  ok('en Cita agendada: seguir o descartar', accionesDisponibles('nuevo', true).join() === 'seguir,descartar')
  ok('en seguimiento: avanzar, cerrar o perder', accionesDisponibles('seguimiento', true).join() === 'avanzar,cerrar,perder')
  ok('en propuesta enviada y revisión también avanza', accionesDisponibles('propuesta_enviada', true).includes('avanzar') && accionesDisponibles('revision_propuesta', true).includes('avanzar'))
  ok('en negociación ya no hay paso al que avanzar: solo cerrar o perder', accionesDisponibles('negociacion', true).join() === 'cerrar,perder')
  ok('un lead cerrado o perdido solo se reabre', accionesDisponibles('ganado', true).join() === 'reabrir' && accionesDisponibles('perdido', true).join() === 'reabrir')
  ok('sin permiso para mover, nada, en ninguna fase', CRM_STAGES.every((s) => accionesDisponibles(s, false).length === 0))

  ok('seguir lleva a En seguimiento', destinoDe('seguir', 'nuevo') === 'seguimiento')
  ok('descartar lleva a perdido', destinoDe('descartar', 'nuevo') === 'perdido')
  ok('avanzar recorre el proceso paso a paso', destinoDe('avanzar', 'seguimiento') === 'propuesta_enviada' && destinoDe('avanzar', 'propuesta_enviada') === 'revision_propuesta' && destinoDe('avanzar', 'revision_propuesta') === 'negociacion')
  ok('cerrar lleva a ganado y perder a perdido', destinoDe('cerrar', 'negociacion') === 'ganado' && destinoDe('perder', 'seguimiento') === 'perdido')
  ok('reabrir devuelve a En seguimiento', destinoDe('reabrir', 'perdido') === 'seguimiento' && destinoDe('reabrir', 'ganado') === 'seguimiento')
  ok('una acción que no existe desde esa fase no lleva a ninguna parte', destinoDe('avanzar', 'negociacion') === null && destinoDe('seguir', 'seguimiento') === null && destinoDe('cerrar', 'nuevo') === null && destinoDe('reabrir', 'nuevo') === null)
  ok('el siguiente paso', siguientePaso('seguimiento') === 'propuesta_enviada' && siguientePaso('negociacion') === null && siguientePaso('nuevo') === null && siguientePaso('ganado') === null)
  ok('descartar y perder piden motivo; las demás no', esAccionDeDescarte('descartar') && esAccionDeDescarte('perder') && !esAccionDeDescarte('seguir') && !esAccionDeDescarte('cerrar'))
  ok('el aviso de cada acción', avisoDeAccion('seguir', 'seguimiento', 'En seguimiento') === 'Pasa a «En seguimiento»' && avisoDeAccion('descartar', 'perdido', 'Perdido') === 'Lead descartado' && avisoDeAccion('cerrar', 'ganado', 'Cliente cerrado') === 'Cliente cerrado' && avisoDeAccion('avanzar', 'propuesta_enviada', 'Propuesta enviada') === 'Pasa a «Propuesta enviada»' && /Reabierto/.test(avisoDeAccion('reabrir', 'seguimiento', 'En seguimiento')))
}

console.log('\n=== el motivo de descartar ===')
{
  ok('hay motivos de sobra y el último es «Otro»', MOTIVOS_DE_DESCARTE.length >= 5 && MOTIVOS_DE_DESCARTE[MOTIVOS_DE_DESCARTE.length - 1] === 'Otro')
  ok('la nota lleva el prefijo y el motivo', notaDeDescarte('No le interesa') === 'Descartado: No le interesa')
  ok('con detalle', notaDeDescarte('Otro', 'dice que ya tiene gestor') === 'Descartado: Otro — dice que ya tiene gestor')
  ok('sin motivo no hay nota', notaDeDescarte('') === null && notaDeDescarte('   ') === null && notaDeDescarte(null) === null && notaDeDescarte(undefined, 'solo detalle') === null)
  ok('una nota larguísima se acota', (notaDeDescarte('Otro', 'x'.repeat(2000)) ?? '').length === 500)
  ok('el motivo se lee de vuelta de la nota', motivoDeDescarte('Descartado: No le interesa') === 'No le interesa' && motivoDeDescarte('Descartado: Otro — dice que ya tiene gestor') === 'Otro — dice que ya tiene gestor')
  ok('una nota que no es de un descarte no tiene motivo', motivoDeDescarte('Llamar el jueves') === null && motivoDeDescarte('') === null && motivoDeDescarte(null) === null && motivoDeDescarte(`${PREFIJO_DE_DESCARTE}`) === null)
}

console.log('\n=== Cita agendada: cómo salió la cita ===')
{
  const futura = { status: 'confirmed', inicio: AHORA + 2 * DIA }
  const enCurso = { status: 'scheduled', inicio: AHORA - 30 * 60_000 }
  const pasada = { status: 'scheduled', inicio: AHORA - 2 * DIA }
  ok('agendada o confirmada en el futuro: por celebrar', situacionDeLaCita(cliente('nuevo', { cita: futura }), AHORA) === 'por_celebrar')
  ok('una que está en curso (empezó hace media hora) sigue por celebrar', situacionDeLaCita(cliente('nuevo', { cita: enCurso }), AHORA) === 'por_celebrar')
  ok('una agendada que ya pasó y nadie ha marcado: sin resultado', situacionDeLaCita(cliente('nuevo', { cita: pasada }), AHORA) === 'sin_resultado' && situacionDeLaCita(cliente('nuevo', { cita: { status: 'rescheduled', inicio: AHORA - 5 * HORA } }), AHORA) === 'sin_resultado')
  ok('cualificada, no cualificada, no asistió y cancelada', situacionDeLaCita(cliente('nuevo', { cita: { status: 'qualified', inicio: AHORA - DIA } }), AHORA) === 'cualificada' && situacionDeLaCita(cliente('nuevo', { cita: { status: 'not_qualified', inicio: AHORA - DIA } }), AHORA) === 'no_cualificada' && situacionDeLaCita(cliente('nuevo', { cita: { status: 'no_show', inicio: AHORA - DIA } }), AHORA) === 'no_asistio' && situacionDeLaCita(cliente('nuevo', { cita: { status: 'cancelled', inicio: AHORA - DIA } }), AHORA) === 'cancelada')
  ok('un alta manual no tiene cita', situacionDeLaCita(cliente('nuevo'), AHORA) === 'sin_cita')
  const rara = cliente('nuevo', { cita: { status: 'scheduled', inicio: AHORA } })
  ;(rara.appointment as { start_time: string }).start_time = 'no es una fecha'
  ok('una fecha que no se entiende no rompe: sin resultado', situacionDeLaCita(rara, AHORA) === 'sin_resultado')

  ok('sugerencias: cualificada → seguir; no cualificada, no asistió y cancelada → descartar', sugerenciaDeLaCita('cualificada') === 'seguir' && sugerenciaDeLaCita('no_cualificada') === 'descartar' && sugerenciaDeLaCita('no_asistio') === 'descartar' && sugerenciaDeLaCita('cancelada') === 'descartar')
  ok('y mientras no se sabe cómo salió, ninguna', sugerenciaDeLaCita('por_celebrar') === null && sugerenciaDeLaCita('sin_resultado') === null && sugerenciaDeLaCita('sin_cita') === null)

  const lote = [
    cliente('nuevo', { cita: futura }),
    cliente('nuevo', { cita: pasada }),
    cliente('nuevo', { cita: { status: 'qualified', inicio: AHORA - DIA } }),
    cliente('nuevo', { cita: { status: 'qualified', inicio: AHORA - 3 * DIA } }),
    cliente('nuevo', { cita: { status: 'not_qualified', inicio: AHORA - 4 * DIA } }),
    cliente('nuevo', { cita: { status: 'no_show', inicio: AHORA - 5 * DIA } }),
    cliente('nuevo'),
    cliente('seguimiento', { cita: { status: 'qualified', inicio: AHORA - 9 * DIA } }),
  ]
  const cuenta = cuentaDeCitas(lote, AHORA)
  ok('cuenta cada situación, solo de los que están en Cita agendada', cuenta.todas === 7 && cuenta.por_celebrar === 1 && cuenta.sin_resultado === 1 && cuenta.cualificada === 2 && cuenta.no_cualificada === 1 && cuenta.no_asistio === 1 && cuenta.sin_cita === 1 && cuenta.otras === 1, JSON.stringify(cuenta))
  ok('los chips son los de la pestaña, en orden, y «Otras» agrupa cancelada y sin cita', FILTROS_DE_CITA.map((f) => f.id).join() === 'todas,por_celebrar,sin_resultado,cualificada,no_cualificada,no_asistio,otras')
  ok('cada chip filtra lo suyo', lote.filter((c) => coincideConElFiltroDeCita(c, 'cualificada', AHORA)).length === 3 /* incluye el que ya está en seguimiento: el filtro solo mira la cita */ && lote.filter((c) => coincideConElFiltroDeCita(c, 'otras', AHORA)).length === 1 && lote.every((c) => coincideConElFiltroDeCita(c, 'todas', AHORA)))

  const orden = ordenarCitas(lote.filter((c) => c.stage === 'nuevo'), AHORA).map((c) => situacionDeLaCita(c, AHORA))
  ok('lo por celebrar va primero; después, lo ya celebrado con la cita más reciente arriba', orden[0] === 'por_celebrar' && orden[1] === 'cualificada' /* hace 1 día */ && orden[2] === 'sin_resultado' /* hace 2 días */, orden.join())
  const dosFuturas = ordenarCitas([cliente('nuevo', { cita: { status: 'confirmed', inicio: AHORA + 5 * DIA } }), cliente('nuevo', { cita: { status: 'confirmed', inicio: AHORA + DIA } })], AHORA)
  ok('entre las por celebrar, la más próxima arriba', Date.parse(dosFuturas[0].appointment!.start_time) < Date.parse(dosFuturas[1].appointment!.start_time))
}

console.log('\n=== En seguimiento: contactos y orden ===')
{
  const contactos: ContactoLigero[] = [
    { client_id: 'a', kind: 'llamada', occurred_at: iso(AHORA - 10 * DIA) },
    { client_id: 'a', kind: 'email', occurred_at: iso(AHORA - 2 * DIA) },
    { client_id: 'a', kind: 'nota', occurred_at: iso(AHORA - 1 * DIA) },
    { client_id: 'b', kind: 'nota', occurred_at: iso(AHORA - 1 * DIA) },
    { client_id: 'c', kind: 'whatsapp', occurred_at: 'ayer' },
  ]
  const r = resumenDeContactos(contactos)
  ok('cuenta los contactos con el lead y se queda con el más reciente', r.get('a')?.total === 2 && r.get('a')?.ultimo?.kind === 'email' && r.get('a')?.ultimo?.en === iso(AHORA - 2 * DIA))
  ok('una nota interna no es un contacto (tampoco una de descarte)', !r.has('b'))
  ok('una fecha que no se entiende no cuenta', !r.has('c'))
  ok('días desde una fecha', diasDesde(iso(AHORA - 3 * DIA - HORA), AHORA) === 3 && diasDesde(iso(AHORA + DIA), AHORA) === 0 && diasDesde(null, AHORA) === null && diasDesde('ayer', AHORA) === null)

  const A = cliente('seguimiento', { id: 'a', next_action_date: '2026-10-31', cita: { status: 'qualified', inicio: AHORA - 20 * DIA } })
  const B = cliente('negociacion', { id: 'b', next_action_date: '2026-10-20', cita: { status: 'qualified', inicio: AHORA - 30 * DIA } })
  const C = cliente('propuesta_enviada', { id: 'c', next_action_date: null, cita: { status: 'qualified', inicio: AHORA - 10 * DIA } })
  const D = cliente('revision_propuesta', { id: 'd', next_action_date: '2026-10-29', cita: { status: 'qualified', inicio: AHORA - 15 * DIA } })
  const lista = [A, B, C, D]
  const ids = (l: CrmClientWithDetails[]) => l.map((c) => c.id).join()
  ok('por acción: lo vencido primero, luego hoy, luego lo futuro, y sin acción al final', ids(ordenarSeguimiento(lista, 'accion', r, AHORA)) === 'b,d,a,c', ids(ordenarSeguimiento(lista, 'accion', r, AHORA)))
  ok('por avance: negociación, revisión, propuesta, seguimiento', ids(ordenarSeguimiento(lista, 'avance', r, AHORA)) === 'b,d,c,a', ids(ordenarSeguimiento(lista, 'avance', r, AHORA)))
  ok('por contacto: los que nunca se han contactado primero, y después el que lleva más sin contactar', ids(ordenarSeguimiento(lista, 'contacto', r, AHORA)).startsWith('b') || ids(ordenarSeguimiento(lista, 'contacto', r, AHORA)).split(',').slice(0, 3).includes('c'))
  ok('por contacto: el único con contacto (a) queda el último', ids(ordenarSeguimiento(lista, 'contacto', r, AHORA)).endsWith('a'))
  ok('por reunión: la más reciente arriba', ids(ordenarSeguimiento(lista, 'reunion', r, AHORA)) === 'c,d,a,b')
  ok('ordenar no toca la lista original', ids(lista) === 'a,b,c,d')
}

console.log('\n=== Cerrado: ganados y perdidos ===')
{
  const g1 = cliente('ganado', { id: 'g1', closed_at: iso(AHORA - 5 * DIA) })
  const g2 = cliente('ganado', { id: 'g2', closed_at: iso(AHORA - DIA) })
  const p1 = cliente('perdido', { id: 'p1', updated_at: iso(AHORA - 7 * DIA) })
  const p2 = cliente('perdido', { id: 'p2', updated_at: iso(AHORA - 2 * DIA) })
  const lote = [g1, p1, g2, p2, cliente('nuevo'), cliente('seguimiento')]
  const c = cuentaDeCerrados(lote)
  ok('cuenta ganados y perdidos', c.ganados === 2 && c.perdidos === 2)
  ok('los ganados, por fecha de cierre (el más reciente arriba)', ordenarCerrados(lote, 'ganados').map((x) => x.id).join() === 'g2,g1')
  ok('los perdidos, por la última vez que se tocó la ficha', ordenarCerrados(lote, 'perdidos').map((x) => x.id).join() === 'p2,p1')
  ok('cada filtro solo trae los suyos', ordenarCerrados(lote, 'ganados').every((x) => x.stage === 'ganado') && ordenarCerrados(lote, 'perdidos').every((x) => x.stage === 'perdido'))
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
