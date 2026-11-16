import {
  campanasDeHoy,
  DIAS_DE_RAMPA,
  esDeshacible,
  hayErroresQueCuentan,
  horaDeMinuto,
  lineaDelAgente,
  panelSinMigracion,
  presionVigente,
  rampaDelPanel,
  ultimaLectura,
  type CambioDelAgente,
  type EventoDelAgente,
} from './panel-servidor'
import { FALTA_MIGRACION_315, TOPES_DE_PARTIDA, type DiaDeUso } from './tipos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** EL PANEL DEL AGENTE: las piezas puras (lo de la base de datos no se prueba aquí) */

console.log('\n=== hora de un minuto ===')
ok('820 → 13:40', horaDeMinuto(820) === '13:40')
ok('0 → 00:00', horaDeMinuto(0) === '00:00')
ok('null → null', horaDeMinuto(null) === null)
ok('fuera de rango se acota', horaDeMinuto(2000) === '23:59')

console.log('\n=== rampa que enseña la pantalla ===')
const t = { factor: 0.5, soloBajadas: false }
ok('la rampa dura 7 días', DIAS_DE_RAMPA === 7)
ok('activo, primer día → día 1 de 7', rampaDelPanel('activo', '2026-12-03', '2026-12-03', t)?.dia === 1)
ok('activo, 1 día después → día 2', rampaDelPanel('activo', '2026-12-03', '2026-12-04', t)?.dia === 2)
ok('activo, día 7 → aún rampa', rampaDelPanel('activo', '2026-12-03', '2026-12-09', t)?.dia === 7)
ok('activo, día 8 → sin rampa', rampaDelPanel('activo', '2026-12-03', '2026-12-10', t) === null)
ok('ensayo → sin rampa', rampaDelPanel('ensayo', '2026-12-03', '2026-12-04', t) === null)
ok('frenado → sin rampa', rampaDelPanel('frenado', '2026-12-03', '2026-12-04', t) === null)
ok('sin fecha de rampa → null', rampaDelPanel('activo', null, '2026-12-04', t) === null)
ok('lleva el factor y «solo bajadas»', JSON.stringify(rampaDelPanel('activo', '2026-12-03', '2026-12-03', { factor: 0.25, soloBajadas: true })) === JSON.stringify({ dia: 1, de: 7, factor: 0.25, soloBajadas: true }))

console.log('\n=== presión vigente ===')
ok('la de hoy vale', presionVigente({ c1: 'bajar' }, '2026-11-15', '2026-11-15').c1 === 'bajar')
ok('la de ayer vale (antes de las 03:00 sigue mandando)', presionVigente({ c1: 'subir' }, '2026-11-14', '2026-11-15').c1 === 'subir')
ok('la de anteayer no', Object.keys(presionVigente({ c1: 'subir' }, '2026-11-13', '2026-11-15')).length === 0)
ok('sin fecha no', Object.keys(presionVigente({ c1: 'subir' }, null, '2026-11-15')).length === 0)
ok('cambio de mes: 31 oct es ayer del 1 nov', presionVigente({ c1: 'bajar' }, '2026-10-31', '2026-11-01').c1 === 'bajar')

console.log('\n=== campañas de hoy ===')
const dia = (campaignId: string, fechaLocal: string, d: Partial<DiaDeUso>): DiaDeUso => ({
  campaignId,
  fechaLocal,
  presupuesto: 20,
  presupuestoPrimera: 20,
  usoPct: 50,
  usoMaxPct: 50,
  gastoEstimado: 10,
  agotadaMin: null,
  agotadaPorEstado: false,
  estadoCampana: 'ENABLED',
  fuente: 'api',
  leidoAt: `${fechaLocal}T10:00:00Z`,
  ...d,
})
const dias = [
  dia('c1', '2026-11-15', { gastoEstimado: 5, leidoAt: '2026-11-15T09:00:00Z' }),
  dia('c2', '2026-11-15', { gastoEstimado: 19.5, usoPct: 97.5, agotadaMin: 820, leidoAt: '2026-11-15T12:30:00Z' }),
  dia('c3', '2026-11-15', { gastoEstimado: 8, agotadaPorEstado: true, fuente: 'estado' }),
  dia('c4', '2026-11-14', { gastoEstimado: 50, leidoAt: '2026-11-14T23:00:00Z' }),
]
const cs = campanasDeHoy(dias, '2026-11-15', new Map([['c2', 'B0X | SKU | RES | MANUAL EXACTA']]), { c2: 'bajar' })
ok('solo las de hoy', cs.length === 3, cs.map((c) => c.campaignId).join(','))
ok('las que más gastan primero', cs[0].campaignId === 'c2' && cs[2].campaignId === 'c1')
ok('agotada a las 13:40', cs[0].agotadaA === '13:40')
ok('agotada solo por estado: sin hora', cs[1].agotadaA === 'sin presupuesto')
ok('no agotada → null', cs[2].agotadaA === null)
ok('nombre de la campaña o, si falta, su id', cs[0].nombre.includes('EXACTA') && cs[2].nombre === 'c1')
ok('presión del día', cs[0].presion === 'bajar' && cs[1].presion === null)
ok('última lectura de hoy', ultimaLectura(dias, '2026-11-15') === '2026-11-15T12:30:00Z')
ok('sin lecturas → null', ultimaLectura(dias, '2026-11-16') === null)

console.log('\n=== deshacer desde la pantalla ===')
const sinStock = new Set(['B0SINSTOCK'])
ok('aplicada → se puede', esDeshacible({ estado: 'aplicada', tipo: 'puja', asin: 'B0X' }, sinStock))
ok('ensayada → no', !esDeshacible({ estado: 'ensayada', tipo: 'puja', asin: 'B0X' }, sinStock))
ok('deshecha → no', !esDeshacible({ estado: 'deshecha', tipo: 'puja', asin: 'B0X' }, sinStock))
ok('pausa de campaña con el stock aún en 0 → no', !esDeshacible({ estado: 'aplicada', tipo: 'pausar-campana', asin: 'b0sinstock' }, sinStock))
ok('pausa de campaña con stock → sí', esDeshacible({ estado: 'aplicada', tipo: 'pausar-campana', asin: 'B0CONSTOCK' }, sinStock))

console.log('\n=== línea de tiempo ===')
const cambio = (id: string, at: string, c: Partial<CambioDelAgente>): CambioDelAgente => ({
  id,
  tipo: 'puja',
  asin: 'B0X',
  termino: 'jamon serrano',
  campaignNombre: 'B0X | SKU | RES | MANUAL AMPLIA',
  motivo: 'ACoS 40 % sobre 25 %',
  error: null,
  pedidos: 2,
  valorActual: 1,
  valorNuevo: 0.85,
  objetivoTipo: 'keyword',
  estado: 'aplicada',
  agenteAt: at,
  ...c,
})
const eventos: EventoDelAgente[] = [
  { id: 'e1', creadoAt: '2026-11-15T08:00:00Z', tipo: 'encendido', titulo: 'Agente encendido (ensayo)', detalle: null, propuestaId: null },
  { id: 'e2', creadoAt: '2026-11-15T11:00:00Z', tipo: 'deshacer_auto', titulo: 'Deshecho solo', detalle: 'ACoS 45 %', propuestaId: 'p2' },
]
const cambios = [
  cambio('p1', '2026-11-15T10:00:00Z', {}),
  cambio('p2', '2026-11-15T09:00:00Z', { valorActual: 1, valorNuevo: 1.2, estado: 'deshecha' }),
  cambio('p3', '2026-11-15T12:00:00Z', { tipo: 'negativizar', valorActual: null, valorNuevo: null, estado: 'ensayada', termino: 'soporte jamonero' }),
  cambio('p4', '2026-11-15T07:00:00Z', { tipo: 'presupuesto', valorActual: 20, valorNuevo: 26, estado: 'error', error: 'HTTP 500' }),
]
const efectos = new Map([
  ['p1', { veredicto: 'mezclado' as const, deshechoAuto: false }],
  ['p2', { veredicto: 'empeoro' as const, deshechoAuto: true }],
])
const linea = lineaDelAgente(eventos, cambios, efectos, new Set())
ok('mezcla eventos y cambios: 6 filas', linea.length === 6)
ok('lo último arriba', linea[0].id === 'p3' && linea[linea.length - 1].id === 'p4', linea.map((f) => f.id).join(','))
ok('ensayada marcada como ensayo', linea[0].ensayo && linea[0].tipo === 'cambio' && linea[0].clase === 'negativizar')
const p1 = linea.find((f) => f.id === 'p1')!
ok('bajada de puja → clase puja_bajar', p1.clase === 'puja_bajar')
ok('veredicto «mezclado» llega', p1.veredicto === 'mezclado')
ok('aplicada → deshacible', p1.deshacible)
const p2 = linea.find((f) => f.id === 'p2')!
ok('subida → puja_subir, deshecha sola y no deshacible', p2.clase === 'puja_subir' && p2.deshechoAuto && !p2.deshacible)
const p4 = linea.find((f) => f.id === 'p4')!
ok('error en el detalle', (p4.detalle ?? '').includes('Error: HTTP 500') && p4.clase === 'presupuesto_subir')
ok('título legible del cambio', p4.titulo.startsWith('Presupuesto de'))
const e2 = linea.find((f) => f.id === 'e2')!
ok('evento: tipo, estado = su tipo, sin clase', e2.tipo === 'evento' && e2.estado === 'deshacer_auto' && e2.clase === null && !e2.deshacible && e2.propuestaId === 'p2')
ok('como mucho max filas', lineaDelAgente(eventos, cambios, efectos, new Set(), 3).length === 3)

console.log('\n=== errores que cuentan para la rampa ===')
ok('401 cuenta', hayErroresQueCuentan([{ ok: false, httpStatus: 401, error: 'Unauthorized' }]))
ok('429 (transporte) no cuenta', !hayErroresQueCuentan([{ ok: false, httpStatus: 429, error: 'Too Many Requests' }]))
ok('400 (validación) no cuenta', !hayErroresQueCuentan([{ ok: false, httpStatus: 400, error: 'DUPLICATE' }]))
ok('aciertos no cuentan', !hayErroresQueCuentan([{ ok: true, httpStatus: 401, error: null }]))
ok('vacío → no', !hayErroresQueCuentan([]))

console.log('\n=== sin la migración 315 ===')
const sin = panelSinMigracion({ esAdmin: true, parada: { parado: false, motivo: null, porEntorno: false }, modo: 'aprueba', fichaFirmada: true, moneda: 'EUR', tacosObjetivoPct: 10, techoMensual: 1200 })
ok('faltaMigracion = 315', sin.faltaMigracion === 315)
ok('el texto de estado lo dice', sin.estadoTexto === FALTA_MIGRACION_315)
ok('no se puede saltar el ensayo', sin.puedeSaltarEnsayo === false)
ok('sin config ni línea', sin.config === null && sin.linea.length === 0)
ok('lleva modo, ficha, moneda y TACoS', sin.modoDelMotor === 'aprueba' && sin.fichaFirmada && sin.moneda === 'EUR' && sin.objetivos.tacosObjetivoPct === 10 && sin.objetivos.techoMensual === 1200)
ok('topes de partida', JSON.stringify(sin.topes) === JSON.stringify(TOPES_DE_PARTIDA))
ok('uso no disponible', sin.ritmo.usoDisponible === false)

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo bien')
if (fallos) process.exit(1)
