/**
 * PRUEBAS DE LA PANTALLA «PLAN» (lo puro de components/remesas/plan): calendario, tarjeta, descarte, líneas del envío,
 * revisión de la IA, historial y filtros.
 *
 *   cd /Users/raulcamunas/Dev/ERP-remesas && npx tsx components/remesas/plan/plan.prueba.ts
 */
import type { EnvioPropuestoGuardado, LineaPlan, RevisionIa } from '@/lib/fba/plan-tipos'
import { agruparPorSemana, lunesDe, posicionEnRango, rangoCalendario, roturaDeEnvio, semanaIso } from './CalendarioDeSalidas'
import { validarDescarte } from './DescartarDialog'
import { agruparFuera, diferenciaConElPlan, filasDelEnvio, huecosInevitables, llegadasAproximadas, textoCaja } from './LineasDelEnvio'
import { fueraDelPlan, hitoDeEvento, ordenarEquipo } from './PanelEnvioPropuesto'
import { ajusteSinRecalculo, claveAjuste, costeEnTexto, textoAjuste, yaAplicado } from './RevisionIa'
import { accionesDeEstado, cuentaAtras, refsDelEnvio, semanaDelEnvio } from './TarjetaEnvioPropuesto'
import { cuentasPorPeriodo, estadoParaApi, filtrarEnvios, ordenarEnvios, type FiltroPlan } from './VistaPlan'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const HOY = '2026-11-16'

function linea(p: Partial<LineaPlan> & { sku: string }): LineaPlan {
  return {
    asin: null, fnsku: null, nombre: null, modelo: null, talla: null, precio: 30, moneda: 'EUR',
    vendibles: 50, deCamino: 0, comprometido: 0, reservadas: null, entranteSinRemesa: 0, dudoso: 0,
    ritmo: {
      base: 2, previsto: 2, factorEstacional: 1, perfilSemanal: null, origenPerfil: null, picoAnoPasado: null,
      r14: 2, r30: 2, r60: 2, r90: 2, diasConStock90: 80, ventas90: 180, ventas30: 60, ventas180: 360,
      tendencia: 'estable', confianza: 'alta', origen: 'sku', ultimoPeriodoHasta: null, pedidoGrande: false,
      serieDeStockFiable: true, anclajeEstimado: false, tasaDevolucionVendible: 0, mermaDiaria: 0, consumoNeto: 2, explicacion: '',
    },
    coberturaDias: 25, coberturaConLoQueViene: 25, fechaRotura: '2026-12-11', fechaPrimerHueco: null,
    aLaVentaObjetivo: '2026-12-04', salirAntesDe: '2026-11-24', decidirAntesDe: '2026-11-17', vaTarde: false,
    diasSinStockInevitables: 0, coberturaEfectiva: 45, necesidad: 90, tope: 180, cantidad: 90,
    caja: null, cajas: null, eurosEnRiesgo: 300, eurosSiVaTarde: null, prioridad: 'esta_semana', fuera: null,
    avisos: [], adelantada: false, aLaVentaUrgente: null, porque: '', ajusteIa: null,
    ...p,
  }
}

function envio(p: Partial<EnvioPropuestoGuardado> & { id: string }): EnvioPropuestoGuardado {
  return {
    clienteId: 'c1', clienteNombre: 'Opinas', connectionId: null, clave: 'env:c1:x:2026-W48', estado: 'nuevo', prioridad: 'esta_semana',
    confianza: 'alta', provisional: false, moneda: 'EUR', salirAntesDe: '2026-11-24', decidirAntesDe: '2026-11-17', aLaVenta: '2026-12-04',
    fechaLimite: '2026-11-17', responsableId: null, responsableNombre: null, unidades: 90, cajasEstimadas: 3, eurosEnRiesgo: 300,
    porque: [], lineas: [linea({ sku: 'A' })], lineasAceptadas: null, cambiosDesdeAyer: null, planYaNoLoPide: false, ajustesAplicados: [],
    ia: null, motivoDescarte: null, nota: null, remesaId: null, esperandoDesde: null, pasadaId: null, version: 0,
    creadoAt: '2026-11-15T08:00:00Z', actualizadoAt: '2026-11-15T08:00:00Z', estadoCambiadoAt: '2026-11-15T08:00:00Z', vencido: false,
    ...p,
  }
}

console.log('\n=== calendario ===')
ok('lunes de un miércoles', lunesDe('2026-11-18') === '2026-11-16', lunesDe('2026-11-18'))
ok('lunes de un domingo', lunesDe('2026-11-22') === '2026-11-16', lunesDe('2026-11-22'))
ok('semana ISO 47 del 16 nov 2026', semanaIso('2026-11-16').semana === 47 && semanaIso('2026-11-16').anio === 2026)
ok('semana ISO del 1 ene 2027 es la 53 de 2026', semanaIso('2027-01-01').anio === 2026 && semanaIso('2027-01-01').semana === 53, JSON.stringify(semanaIso('2027-01-01')))
ok('semana ISO del 4 ene 2027 es la 1', semanaIso('2027-01-04').semana === 1 && semanaIso('2027-01-04').anio === 2027)
{
  const e = envio({ id: '1', lineas: [linea({ sku: 'A', fechaRotura: '2026-12-20' }), linea({ sku: 'B', fechaRotura: '2026-12-02' }), linea({ sku: 'C', fechaRotura: '2026-11-20', cantidad: 0 })] })
  ok('rotura del envío: la primera de las que van', roturaDeEnvio(e) === '2026-12-02', String(roturaDeEnvio(e)))
  ok('rotura con lo hablado', roturaDeEnvio({ ...e, lineasAceptadas: [linea({ sku: 'A', fechaRotura: '2026-12-20' })] }) === '2026-12-20')
}
{
  const r = rangoCalendario([envio({ id: '1', decidirAntesDe: '2026-11-10', salirAntesDe: '2026-11-30' })], HOY, 12)
  ok('rango: empieza una semana antes si hay algo vencido', r.inicio === '2026-11-09', r.inicio)
  ok('rango: al menos 4 semanas', r.semanas >= 4 && r.dias === r.semanas * 7, JSON.stringify(r))
  const largo = rangoCalendario([envio({ id: '1', salirAntesDe: '2027-06-01' })], HOY, 12)
  ok('rango: tope de semanas', largo.semanas === 12)
}
ok('posición recortada a 0-100', posicionEnRango('2026-11-01', '2026-11-16', 28) === 0 && posicionEnRango('2027-01-01', '2026-11-16', 28) === 100 && posicionEnRango('2026-11-30', '2026-11-16', 28) === 50)
{
  const g = agruparPorSemana([envio({ id: '1', salirAntesDe: '2026-11-20' }), envio({ id: '2', salirAntesDe: '2026-11-17' }), envio({ id: '3', salirAntesDe: '2026-12-02' })])
  ok('agrupar por semana de salida', g.length === 2 && g[0].lunes === '2026-11-16' && g[0].envios.map((x) => x.id).join() === '2,1' && g[1].envios[0].id === '3', JSON.stringify(g.map((x) => [x.lunes, x.envios.map((y) => y.id)])))
}

console.log('\n=== tarjeta ===')
ok('semana desde la clave', semanaDelEnvio({ clave: 'env:c:x:2026-W49', salirAntesDe: '2026-11-17' }) === 49)
ok('semana desde la fecha si la clave no la trae', semanaDelEnvio({ clave: 'raro', salirAntesDe: '2026-11-17' }) === 47)
ok('acciones de nuevo', accionesDeEstado('nuevo').join() === 'hablado,convertir,descartar')
ok('acciones de esperando', accionesDeEstado('esperando_cliente').includes('contestado') && accionesDeEstado('esperando_cliente').includes('convertir'))
ok('caducado no tiene acciones', accionesDeEstado('caducado').length === 0)
ok('refs: solo las que llevan unidades', refsDelEnvio({ lineas: [linea({ sku: 'A' }), linea({ sku: 'B', cantidad: 0 }), linea({ sku: 'C', fuera: 'aun_no_toca' })], lineasAceptadas: null }) === 1)
ok('cuenta atrás: vencido', cuentaAtras('2026-11-14', HOY).texto === 'vencido hace 2 días' && cuentaAtras('2026-11-14', HOY).tono === 'rojo')
ok('cuenta atrás: hoy', cuentaAtras(HOY, HOY).texto === 'vence hoy')
ok('cuenta atrás: 1 día en ámbar', cuentaAtras('2026-11-17', HOY).texto === 'quedan 1 día' && cuentaAtras('2026-11-17', HOY).tono === 'ambar', cuentaAtras('2026-11-17', HOY).texto)

console.log('\n=== descartar ===')
ok('sin motivo no se descarta', validarDescarte(null, '') === 'Elige por qué se descarta')
ok('descatalogada sin nota vale', validarDescarte('descatalogada', '') === null)
ok('«otro» pide nota', validarDescarte('otro', ' ') !== null && validarDescarte('otro', 'ya lo mandó') === null)
ok('nota demasiado larga', validarDescarte('cliente_no_quiere', 'x'.repeat(501)) !== null)

console.log('\n=== líneas del envío ===')
{
  const hablado = envio({
    id: 'h',
    estado: 'hablado',
    lineasAceptadas: [linea({ sku: 'A', cantidad: 100 }), linea({ sku: 'B', cantidad: 50 })],
    lineas: [linea({ sku: 'A', cantidad: 120 }), linea({ sku: 'C', cantidad: 30 })],
  })
  const f = filasDelEnvio(hablado)
  ok('filas: une lo hablado y lo de hoy', f.map((x) => `${x.sku}:${x.acordada}/${x.hoy}`).join() === 'A:100/120,B:50/0,C:0/30', f.map((x) => `${x.sku}:${x.acordada}/${x.hoy}`).join())
  const d = diferenciaConElPlan(hablado)
  ok('diferencia: totales hablado y hoy', !!d && d.acordadas === 150 && d.hoy === 150 && d.cambios.length === 3, JSON.stringify(d))
  ok('sin hablar no hay diferencia', diferenciaConElPlan(envio({ id: 'n' })) === null)
  ok('hablado igual que hoy: sin diferencia', diferenciaConElPlan(envio({ id: 'i', lineasAceptadas: [linea({ sku: 'A' })] })) === null)
}
{
  const h = huecosInevitables([linea({ sku: 'A', diasSinStockInevitables: 2 }), linea({ sku: 'B' }), linea({ sku: 'C', diasSinStockInevitables: 9 })])
  ok('huecos inevitables, de más a menos', h.map((x) => x.sku).join() === 'C,A')
}
{
  const l = llegadasAproximadas({ deCamino: 140, comprometido: 20, entranteSinRemesa: 0, dudoso: 120 }, HOY, { transporte: 13, recepcion: 4, hastaLaVenta: 24 })
  const camino = l.find((x) => x.origen === 'camino' && !x.dudoso)
  const dudosa = l.find((x) => x.dudoso)
  ok('llegadas: lo dudoso aparte y sin contar', camino?.unidades === 20 && dudosa?.unidades === 120 && dudosa.dudoso === true, JSON.stringify(l))
  ok('llegadas: camino tras la recepción', camino?.fecha === '2026-11-20')
  ok('llegadas: comprometido al final del plazo', l.find((x) => x.origen === 'comprometido')?.fecha === '2026-12-10')
  const sr = llegadasAproximadas({ deCamino: 600, comprometido: 0, entranteSinRemesa: 600, dudoso: 0 }, HOY, { transporte: 13, recepcion: 4, hastaLaVenta: 24 })
  ok('llegadas: entrante sin remesa tras transporte + recepción', sr.length === 1 && sr[0].origen === 'amazon_sin_remesa' && sr[0].fecha === '2026-12-03', JSON.stringify(sr))
  ok('llegadas: sin plazo usa los de partida', llegadasAproximadas({ deCamino: 5, comprometido: 0, entranteSinRemesa: 0, dudoso: 0 }, HOY, null)[0].fecha === '2026-11-20')
}
ok('caja con origen', textoCaja({ unidades: 18, origen: 'deducida' }) === 'caja de 18 (deducida de los envíos)' && textoCaja(null) === 'sin caja conocida')
{
  const g = agruparFuera([linea({ sku: 'A', fuera: 'stock_de_sobra' }), linea({ sku: 'B', fuera: null }), linea({ sku: 'C', fuera: 'stock_de_sobra' }), linea({ sku: 'D', fuera: 'descatalogada' })])
  ok('fuera agrupado por motivo, el grupo grande primero', g.length === 2 && g[0].motivo === 'stock_de_sobra' && g[0].lineas.length === 2)
  ok('fuera del plan sin repetir', fueraDelPlan([linea({ sku: 'A', fuera: 'parado' }), linea({ sku: 'A', fuera: 'parado' }), linea({ sku: 'B' })]).length === 1)
}

console.log('\n=== revisión de la IA ===')
ok('texto de factor', textoAjuste({ tipo: 'factor_ritmo', valor: 1.2 }) === 'Ritmo ×1,2', textoAjuste({ tipo: 'factor_ritmo', valor: 1.2 }))
ok('texto de mover', textoAjuste({ tipo: 'mover_envio', dias: -3 }) === 'Que salga 3 días antes' && textoAjuste({ tipo: 'mover_envio', valor: 1 }) === 'Que salga 1 día después')
ok('texto de excluir', textoAjuste({ tipo: 'excluir' }) === 'Sacarla del envío')
{
  const valido: RevisionIa['ajustesValidos'][number] = { tipo: 'factor_ritmo', sku: 'A', valor: 1.2, motivo: 'Black Friday', recalculo: { antes: 93, despues: 112 } }
  const limpio = ajusteSinRecalculo(valido)
  ok('el ajuste del PATCH va sin recalculo', !('recalculo' in limpio) && limpio.tipo === 'factor_ritmo' && limpio.valor === 1.2)
  ok('ya aplicado', yaAplicado(limpio, [{ tipo: 'factor_ritmo', sku: 'A', valor: 1.2, motivo: 'otro texto' }]) && !yaAplicado(limpio, [{ tipo: 'factor_ritmo', sku: 'A', valor: 1.1, motivo: '' }]) && !yaAplicado(limpio, []))
  ok('clave de mover', claveAjuste({ tipo: 'mover_envio', sku: 'B', dias: 2, motivo: '' }) === 'B|mover|2')
}
ok('coste en céntimos', costeEnTexto(0.0015) === '0,15 céntimos' && costeEnTexto(0.012) === '1,2 céntimos' && costeEnTexto(null) === null && costeEnTexto(0.00001) === 'menos de 0,01 céntimos', `${costeEnTexto(0.0015)} ${costeEnTexto(0.012)}`)

console.log('\n=== historial y equipo ===')
{
  const nombres = new Map([['u1', 'Ana']])
  ok('estado descartado con motivo', (() => {
    const h = hitoDeEvento({ accion: 'estado', de: 'nuevo', a: 'descartado', nota: 'lo manda él', datos: { motivoDescarte: 'ya_enviado_aparte' } }, nombres)
    return h.titulo === 'Pasa a «Descartado»' && h.descripcion === 'Ya se envió por otro lado · lo manda él' && h.tono === 'gris'
  })())
  ok('responsable con nombre', hitoDeEvento({ accion: 'responsable', de: null, a: 'u1', nota: null, datos: null }, nombres).titulo === 'Responsable: Ana')
  ok('soltar', hitoDeEvento({ accion: 'responsable', de: 'u1', a: null, nota: null, datos: null }, nombres).titulo === 'Se queda sin responsable')
  ok('fecha límite', hitoDeEvento({ accion: 'fecha_limite', de: '2026-11-17', a: '2026-11-20', nota: null, datos: null }).titulo === 'Fecha límite: 20 nov')
  ok('acción desconocida no rompe', hitoDeEvento({ accion: 'algo_nuevo', de: null, a: null, nota: null, datos: null }).titulo === 'algo nuevo')
  const eq = ordenarEquipo([
    { id: '1', nombre: 'Zoe', role: 'admin', puesto: null },
    { id: '2', nombre: 'Bea', role: 'employee', puesto: 'gestion_administrativa' },
    { id: '3', nombre: 'Al', role: 'employee', puesto: 'comercial' },
    { id: '4', nombre: 'Ana', role: 'employee', puesto: 'gestion_administrativa' },
  ])
  ok('equipo: gestión administrativa, admins y el resto', eq.map((x) => x.nombre).join() === 'Ana,Bea,Zoe,Al', eq.map((x) => x.nombre).join())
}

console.log('\n=== filtros del plan ===')
{
  const lista = [
    envio({ id: '1', clienteId: 'c1', clienteNombre: 'Opinas', salirAntesDe: '2026-11-20', prioridad: 'urgente', responsableId: 'yo' }),
    envio({ id: '2', clienteId: 'c2', clienteNombre: 'Creative Toys', salirAntesDe: '2026-12-10', prioridad: 'este_mes', lineas: [linea({ sku: 'WM40297', nombre: 'Peluche' })] }),
    envio({ id: '3', clienteId: 'c1', clienteNombre: 'Opinas', salirAntesDe: '2026-11-10', decidirAntesDe: '2026-11-03', prioridad: 'proximas_2', vencido: true, estado: 'hablado' }),
    envio({ id: '4', clienteId: 'c3', clienteNombre: 'Cobo', salirAntesDe: '2027-01-20', prioridad: 'mas_adelante', estado: 'esperando_cliente' }),
  ]
  const base: FiltroPlan = { periodo: 'todo', estado: 'activos', quien: 'todos', clienteId: null, buscar: '' }
  const ids = (f: Partial<FiltroPlan>) => filtrarEnvios(lista, { ...base, ...f }, HOY, 'yo').map((x) => x.id).join()
  ok('todo', ids({}) === '1,2,3,4')
  ok('esta semana: lo que sale en 7 días y lo vencido', ids({ periodo: 'semana' }) === '1,3', ids({ periodo: 'semana' }))
  ok('este mes', ids({ periodo: 'mes' }) === '1,2,3', ids({ periodo: 'mes' }))
  ok('cliente', ids({ clienteId: 'c1' }) === '1,3')
  ok('estado', ids({ estado: 'esperando_cliente' }) === '4')
  ok('vencidos', ids({ estado: 'vencidos' }) === '3')
  ok('mis envíos', ids({ quien: 'mios' }) === '1')
  ok('sin responsable', ids({ quien: 'sin_responsable' }) === '2,3,4')
  ok('buscar por SKU sin tildes ni mayúsculas', ids({ buscar: 'wm402' }) === '2' && ids({ buscar: 'creative peluche' }) === '2')
  ok('buscar por cliente', ids({ buscar: 'cobo' }) === '4')
  ok('ordenar: vencidos primero y luego prioridad', ordenarEnvios(lista).map((x) => x.id).join() === '3,1,2,4', ordenarEnvios(lista).map((x) => x.id).join())
  const c = cuentasPorPeriodo(lista, HOY)
  ok('cuentas por periodo', c.semana === 2 && c.dos === 2 && c.mes === 3 && c.todo === 4, JSON.stringify(c))
  ok('estado para la API', estadoParaApi('vencidos') === 'activos' && estadoParaApi('hablado') === 'activos' && estadoParaApi('descartado') === 'descartado' && estadoParaApi('todos') === 'todos')
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
process.exit(fallos === 0 ? 0 : 1)
