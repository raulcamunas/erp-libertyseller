import type { CrmClientWithDetails, CrmStage } from '@/lib/types/crm'
import type { EntradaDeFase } from './fases'
import { agruparPorCliente, cifrasDelPipeline, coincideConLaBusqueda, estadoDeLaAccion, ETIQUETA_CORTA, FILTRO_INICIAL, filtrarClientes, iniciales, nivelDeInteres, ordenarClientes, resumenDeFila, type NotaLigera, type ResumenDeFila } from './lista'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const AHORA = Date.parse('2026-10-27T12:00:00Z')

function cliente(id: string, o: Partial<CrmClientWithDetails> & { nombre?: string; empresa?: string; inicio?: string } = {}): CrmClientWithDetails {
  const { nombre, empresa, inicio, ...resto } = o
  return {
    id,
    appointment_id: inicio ? `cita-${id}` : null,
    stage: 'nuevo',
    owner_id: null,
    lead_name: nombre ?? null,
    lead_email: null,
    lead_phone: null,
    lead_company: empresa ?? null,
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
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
    ...(inicio ? { appointment: { id: `cita-${id}`, start_time: inicio, lead_name: nombre ?? 'x', lead_email: null, lead_phone: null, lead_company: empresa ?? null, revenue_amount: null, amazon_link: null, status: 'scheduled' } as unknown as CrmClientWithDetails['appointment'] } : {}),
    ...resto,
  } as CrmClientWithDetails
}

const e = (etapa: CrmStage, desde: string, origen: EntradaDeFase['origen'] = 'manual'): EntradaDeFase => ({ etapa, desde, origen })
const mapa = (cs: CrmClientWithDetails[], h: Record<string, EntradaDeFase[]> = {}, n: Record<string, NotaLigera[]> = {}) => new Map<string, ResumenDeFila>(cs.map((c) => [c.id, resumenDeFila(c, h[c.id], n[c.id], AHORA)]))

console.log('\n=== piezas pequeñas ===')
{
  ok('iniciales: nombre y apellido', iniciales('Ana Pérez') === 'AP' && iniciales('  maría   del   carmen lópez ') === 'ML')
  ok('iniciales: una palabra, dos letras; sin nombre, «?»', iniciales('Cosmetica') === 'CO' && iniciales('') === '?' && iniciales(null) === '?')
  ok('hay una etiqueta corta para las siete fases', Object.keys(ETIQUETA_CORTA).length === 7 && ETIQUETA_CORTA.ganado === 'Cerrado')
  ok('agruparPorCliente ignora las notas sin cliente', JSON.stringify(Object.keys(agruparPorCliente([{ client_id: 'a' }, { client_id: null }, { client_id: 'a' }, { client_id: 'b' }]))) === '["a","b"]' && agruparPorCliente([{ client_id: 'a' }, { client_id: 'a' }]).a.length === 2)
  ok('nivelDeInteres ordena de alto a ninguno', nivelDeInteres('alto') > nivelDeInteres('medio') && nivelDeInteres('medio') > nivelDeInteres('bajo') && nivelDeInteres('bajo') > nivelDeInteres('no_claro') && nivelDeInteres('no_claro') > nivelDeInteres('ninguno') && nivelDeInteres(null) < nivelDeInteres('ninguno'))
}

console.log('\n=== la próxima acción, contra el día de HOY EN MADRID ===')
{
  ok('un día pasado: vencida', estadoDeLaAccion('2026-10-26', AHORA) === 'vencida')
  ok('hoy: hoy', estadoDeLaAccion('2026-10-27', AHORA) === 'hoy')
  ok('mañana: próxima', estadoDeLaAccion('2026-10-28', AHORA) === 'proxima')
  ok('sin fecha o con basura: null', estadoDeLaAccion(null, AHORA) === null && estadoDeLaAccion('', AHORA) === null && estadoDeLaAccion('pronto', AHORA) === null)
  // 27 oct 23:30 UTC ya es el 28 en Madrid (CET, UTC+1): el día de la acción «28» es HOY, no futuro
  ok('el día cambia en Madrid, no en UTC: a las 23:30 UTC del 27 ya es el 28', estadoDeLaAccion('2026-10-28', Date.parse('2026-10-27T23:30:00Z')) === 'hoy')
  ok('una fecha con hora (timestamp) se lee por su día', estadoDeLaAccion('2026-10-26T09:00:00Z', AHORA) === 'vencida')
}

console.log('\n=== la línea de cada cliente ===')
{
  const c = cliente('a', { nombre: 'Ana Pérez', empresa: 'Cosmética Ejemplo', stage: 'propuesta_enviada', next_action: 'Llamar para cerrar', next_action_date: '2026-10-25' })
  const h = { a: [e('nuevo', '2026-10-01T10:00:00Z', 'alta'), e('seguimiento', '2026-10-05T10:00:00Z'), e('propuesta_enviada', '2026-10-18T10:00:00Z')] }
  const n = { a: [{ id: 'n1', client_id: 'a', estado: 'procesada' as const, fecha_reunion: '2026-10-20T08:00:00Z', interes: 'alto' as const }, { id: 'n2', client_id: 'a', estado: 'ignorada' as const, fecha_reunion: '2026-10-21T08:00:00Z', interes: null }] }
  const r = resumenDeFila(c, h.a, n.a, AHORA)
  ok('nombre, empresa, fase y posición', r.nombre === 'Ana Pérez' && r.empresa === 'Cosmética Ejemplo' && r.stage === 'propuesta_enviada' && r.indice === 2)
  ok('lleva 9 días en la fase', r.diasEnLaFase === 9, String(r.diasEnLaFase))
  ok('la acción está vencida (era el 25)', r.accion?.estado === 'vencida' && r.accion.texto === 'Llamar para cerrar')
  ok('una nota ignorada no cuenta; la analizada sí, con su interés', r.notas === 1 && r.interes === 'alto' && r.ultimaReunion === '2026-10-20T08:00:00Z' && !r.porAnalizar)
  const sin = resumenDeFila(cliente('b', { nombre: undefined }), undefined, undefined, AHORA)
  ok('un cliente sin nombre ni nada se pinta sin reventar', sin.nombre === 'Sin nombre' && sin.empresa === null && sin.accion === null && sin.diasEnLaFase === null && sin.notas === 0 && sin.interes === null)
  const cerrado = resumenDeFila(cliente('c', { stage: 'ganado', next_action: 'Facturar', next_action_date: '2026-09-01' }), undefined, undefined, AHORA)
  ok('un cliente cerrado no tiene acciones «vencidas»', cerrado.accion?.estado === null)
  const pend = resumenDeFila(cliente('d'), undefined, [{ id: 'x', client_id: 'd', estado: 'pendiente', fecha_reunion: null, interes: null }], AHORA)
  ok('una nota que espera análisis se marca', pend.porAnalizar && pend.notas === 1)
  const interes = resumenDeFila(cliente('e'), undefined, [{ id: '1', client_id: 'e', estado: 'procesada', fecha_reunion: '2026-10-01T10:00:00Z', interes: 'bajo' }, { id: '2', client_id: 'e', estado: 'procesada', fecha_reunion: '2026-10-20T10:00:00Z', interes: 'alto' }], AHORA)
  ok('el interés es el de la reunión más reciente', interes.interes === 'alto' && interes.ultimaReunion === '2026-10-20T10:00:00Z')
  const soloTexto = resumenDeFila(cliente('f', { next_action: 'Mandar contrato' }), undefined, undefined, AHORA)
  ok('una acción sin fecha se enseña sin estado', soloTexto.accion?.texto === 'Mandar contrato' && soloTexto.accion.estado === null)
}

console.log('\n=== buscar y filtrar ===')
{
  const cs = [
    cliente('a', { nombre: 'Ana Pérez', empresa: 'Cosmética Ejemplo', stage: 'nuevo', owner_id: 'u1', inicio: '2026-10-20T08:00:00Z' }),
    cliente('b', { nombre: 'Luis Martín', empresa: 'Zapatos SL', stage: 'seguimiento', owner_id: 'u2', next_action_date: '2026-10-20', next_action: 'Llamar', inicio: '2026-10-21T08:00:00Z' }),
    cliente('c', { nombre: 'Marta Gómez', stage: 'ganado', owner_id: null, inicio: '2026-10-10T08:00:00Z' }),
    cliente('d', { nombre: 'Pedro Ruiz', stage: 'perdido', owner_id: 'u1', inicio: '2026-10-05T08:00:00Z' }),
  ]
  const res = mapa(cs)
  const f = (o: Partial<typeof FILTRO_INICIAL>) => filtrarClientes(cs, { ...FILTRO_INICIAL, ...o }, res).map((c) => c.id).join()
  ok('sin filtro, todos', f({}) === 'a,b,c,d')
  ok('por fase', f({ fase: 'seguimiento' }) === 'b')
  ok('«abiertos»: ni cerrados ni perdidos', f({ fase: 'abiertos' }) === 'a,b')
  ok('por responsable y «sin asignar»', f({ responsable: 'u1' }) === 'a,d' && f({ responsable: 'sin' }) === 'c')
  ok('solo con la acción vencida', f({ soloConAccionVencida: true }) === 'b')
  ok('buscar sin mirar mayúsculas ni tildes', f({ texto: 'perez' }) === 'a' && f({ texto: 'COSMETICA' }) === 'a' && f({ texto: 'gomez' }) === 'c')
  ok('los filtros se combinan', f({ fase: 'abiertos', responsable: 'u2', texto: 'luis' }) === 'b' && f({ fase: 'ganado', texto: 'luis' }) === '')
  ok('buscar por empresa, país o web', coincideConLaBusqueda(cliente('x', { nombre: 'A', country: 'Alemania' }), 'aleman') && coincideConLaBusqueda(cliente('x', { nombre: 'A', website: 'https://tienda.es' }), 'tienda.es'))
}

console.log('\n=== orden ===')
{
  const cs = [
    cliente('a', { nombre: 'Beatriz', inicio: '2026-10-20T08:00:00Z', next_action_date: '2026-11-03' }),
    cliente('b', { nombre: 'Ana', inicio: '2026-10-25T08:00:00Z', next_action_date: '2026-10-26' }),
    cliente('c', { nombre: 'Carlos', inicio: '2026-10-10T08:00:00Z' }),
  ]
  const res = mapa(cs)
  const o = (orden: Parameters<typeof ordenarClientes>[1]) => ordenarClientes(cs, orden, res).map((c) => c.id).join()
  ok('por reunión: la más reciente primero', o('reunion') === 'b,a,c')
  ok('por acción: lo que vence antes primero y lo que no tiene fecha, al final', o('accion') === 'b,a,c')
  ok('por nombre', o('nombre') === 'b,a,c')
  ok('no toca la lista de entrada', cs.map((c) => c.id).join() === 'a,b,c')
}

console.log('\n=== cifras de cabecera ===')
{
  const cs = [
    cliente('a', { stage: 'nuevo', next_action_date: '2026-10-01' }),
    cliente('b', { stage: 'seguimiento' }),
    cliente('c', { stage: 'ganado' }),
    cliente('d', { stage: 'ganado' }),
    cliente('e', { stage: 'perdido', next_action_date: '2026-09-01' }),
  ]
  const h = {
    c: [e('nuevo', '2026-09-01T10:00:00Z', 'alta'), e('ganado', '2026-09-21T10:00:00Z')],
    d: [e('nuevo', '2026-09-01T10:00:00Z', 'alta'), e('ganado', '2026-10-01T10:00:00Z')],
  }
  const x = cifrasDelPipeline(cs, h, mapa(cs, h))
  ok('totales: 5 clientes, 2 abiertos, 2 cerrados, 1 perdido', x.total === 5 && x.abiertos === 2 && x.ganados === 2 && x.perdidos === 1)
  ok('conversión: de 3 decididos, 2 se cerraron', x.conversion !== null && Math.abs(x.conversion - 2 / 3) < 1e-9)
  ok('ciclo medio: 20 y 30 días son 25', x.cicloMedio === 25, String(x.cicloMedio))
  ok('una acción vencida en un cliente abierto cuenta; la de uno perdido, no', x.accionesVencidas === 1)
  ok('recuento por fase', x.porFase.nuevo === 1 && x.porFase.ganado === 2 && x.porFase.revision_propuesta === 0)
  const vacio = cifrasDelPipeline([], {}, new Map())
  ok('sin clientes: todo a cero y sin inventar conversión ni ciclo', vacio.total === 0 && vacio.conversion === null && vacio.cicloMedio === null)
  const aprox = { c: [e('nuevo', '2026-09-01T10:00:00Z', 'recuperado'), e('ganado', '2026-09-21T10:00:00Z', 'recuperado')] }
  ok('con fechas aproximadas no se calcula el ciclo (sería inventar)', cifrasDelPipeline([cs[2]], aprox, mapa([cs[2]], aprox)).cicloMedio === null)
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
