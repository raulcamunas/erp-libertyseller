/**
 * PRUEBAS DE LO PURO DE REPOSICIÓN (paquete C5).
 *
 *   cd /Users/raulcamunas/Dev/ERP-remesas && npx tsx components/remesas/reposicion/calculos.prueba.ts
 */
import type { LineaPlan, PlazoEtapas, RitmoSku } from '@/lib/fba/plan-tipos'
import {
  cajaPorGuardar, consumoDe, contarFiltros, datosMapaCobertura, diasDeStock, etapasDelPlazo, filaExceso, filtrarLineas, gruposDeAtencion, ordenPorDefecto,
  preguntaAgotado, ritmoDe, textoAcierto, textoPlazo, tonoAcierto,
} from './calculos'

let fallos = 0
const ok = (n: string, bien: boolean, d: unknown = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || d === '' ? '' : ` -> ${JSON.stringify(d)}`}`)
}

const HOY = '2026-11-15'

function ritmo(p: Partial<RitmoSku> = {}): RitmoSku {
  return {
    base: 2, previsto: 2, factorEstacional: 1, perfilSemanal: null, origenPerfil: null, picoAnoPasado: null,
    r14: 2, r30: 2, r60: 2, r90: 2, diasConStock90: 80, ventas90: 180, ventas30: 60, ventas180: 360,
    tendencia: 'estable', confianza: 'alta', origen: 'sku', ultimoPeriodoHasta: null, pedidoGrande: false,
    serieDeStockFiable: true, anclajeEstimado: false, tasaDevolucionVendible: 0, mermaDiaria: 0, consumoNeto: null,
    explicacion: '2 ud/día', ...p,
  }
}

function linea(p: Partial<LineaPlan> & { sku: string }): LineaPlan {
  return {
    asin: null, fnsku: null, nombre: null, modelo: null, talla: null, precio: 20, moneda: 'EUR',
    vendibles: 50, deCamino: 0, comprometido: 0, reservadas: null, entranteSinRemesa: 0, dudoso: 0,
    ritmo: ritmo(), coberturaDias: 25, coberturaConLoQueViene: 25, fechaRotura: '2026-12-10', fechaPrimerHueco: null,
    aLaVentaObjetivo: null, salirAntesDe: '2026-11-25', decidirAntesDe: '2026-11-18', vaTarde: false, diasSinStockInevitables: 0,
    coberturaEfectiva: 45, necesidad: 90, tope: 180, cantidad: 90, caja: null, cajas: null, eurosEnRiesgo: 400, eurosSiVaTarde: null,
    prioridad: 'esta_semana', fuera: null, avisos: [], adelantada: false, aLaVentaUrgente: null, porque: 'x', ajusteIa: null,
    ...p,
  }
}

console.log('\n=== consumo y días de stock ===')
ok('consumo neto manda', consumoDe(linea({ sku: 'a', ritmo: ritmo({ consumoNeto: 1.5 }) })) === 1.5)
ok('sin consumo neto, el previsto', consumoDe(linea({ sku: 'a', ritmo: ritmo({ previsto: 3 }) })) === 3)
ok('ritmo 0 → null', consumoDe(linea({ sku: 'a', ritmo: ritmo({ base: 0, previsto: 0 }) })) === null)
ok('días de stock con camino', diasDeStock(linea({ sku: 'a', vendibles: 40, deCamino: 20 })) === 30)
ok('stock sin ventas → infinito', diasDeStock(linea({ sku: 'a', ritmo: ritmo({ base: null, previsto: null }) })) === Infinity)

console.log('\n=== exceso (D16) ===')
// Opinas 12-CDXR-I4TN: V 454 y ~2,2 ud/día → ~206 días
const opinas = linea({ sku: '12-CDXR-I4TN', vendibles: 454, ritmo: ritmo({ base: 2.2, previsto: 2.2 }), fuera: 'stock_de_sobra', cantidad: 0 })
const e1 = filaExceso(opinas, 90, HOY)
ok('Opinas 454 ud a 2,2/día: exceso', e1 !== null && Math.round(e1.dias) === 206, e1 && { dias: e1.dias, sobrantes: e1.sobrantes })
ok('sobrantes = 454 − 2,2 × 90 = 256', e1?.sobrantes === 256, e1?.sobrantes)
ok('coste de noviembre (temporada alta) > 0', (e1?.costeMes ?? 0) > 0, e1?.costeMes)
ok('206 días > 1,5 × 90 → promoción', e1?.accion === 'promocion', e1?.accion)
ok('dentro de la máxima no es exceso', filaExceso(linea({ sku: 'b', vendibles: 100 }), 90, HOY) === null)
const parado = filaExceso(linea({ sku: 'c', vendibles: 80, fuera: 'parado', ritmo: ritmo({ base: null, previsto: null }) }), 90, HOY)
ok('parado: todo sobra y retirada', parado?.sobrantes === 80 && parado.accion === 'retirada' && parado.dias === Infinity, parado)
ok('sin stock en Amazon no hay exceso', filaExceso(linea({ sku: 'd', vendibles: 0, deCamino: 500 }), 90, HOY) === null)
const justo = filaExceso(linea({ sku: 'e', vendibles: 200, ritmo: ritmo({ base: 2, previsto: 2 }) }), 90, HOY)
ok('100 días con máxima 90 → no enviar, 20 sobrantes', justo?.accion === 'no_enviar' && justo.sobrantes === 20, justo)
const triple = filaExceso(linea({ sku: 'f', vendibles: 700, ritmo: ritmo({ base: 2, previsto: 2 }) }), 90, HOY)
ok('350 días > 3 × 90 → retirada', triple?.accion === 'retirada', triple?.accion)

console.log('\n=== grupos de atención ===')
const lineas: LineaPlan[] = [
  linea({ sku: 'AG-1', vendibles: 0, fuera: 'agotado_largo', ritmo: ritmo({ base: 1, confianza: 'baja', origen: 'ultimo_periodo', ultimoPeriodoHasta: '2026-08-03' }) }),
  linea({ sku: 'AG-2', vendibles: 0, fuera: 'agotado_largo', ritmo: ritmo({ base: 3 }) }),
  opinas,
  linea({ sku: 'T7-0CG9-DSP7', entranteSinRemesa: 600, deCamino: 600, fuera: 'stock_de_sobra', cantidad: 0 }),
  linea({ sku: 'FBA1-47', modelo: 'FBA1', talla: '47', fuera: 'talla_sin_ventas', vendibles: 3 }),
  linea({ sku: 'FBA1-46', modelo: 'FBA1', talla: '46', fuera: 'talla_sin_ventas', vendibles: 2 }),
  linea({ sku: 'FBA2-35', modelo: 'FBA2', talla: '35', fuera: 'talla_sin_ventas', vendibles: 9 }),
  linea({ sku: 'NORMAL' }),
]
const g = gruposDeAtencion(lineas, { coberturaMaxima: 90 }, HOY)
ok('agotados: los dos, primero el que más vendía', g.agotados.map((l) => l.sku).join() === 'AG-2,AG-1', g.agotados.map((l) => l.sku))
ok('exceso: Opinas (y T7 por los 600 de camino no, porque V 50 + 600 = 325 días → sí)', g.exceso.some((x) => x.sku === '12-CDXR-I4TN'))
ok('entrante sin remesa: T7', g.entrante.length === 1 && g.entrante[0].sku === 'T7-0CG9-DSP7')
ok('tallas: dos modelos, el de más stock primero', g.tallas.map((t) => t.modelo).join() === 'FBA2,FBA1', g.tallas.map((t) => t.modelo))
ok('tallas de FBA1 ordenadas 46, 47', g.tallas[1].tallas.map((l) => l.talla).join() === '46,47')

console.log('\n=== filtros ===')
const c = contarFiltros(lineas, HOY, 90)
ok('todas = 8', c.todas === 8, c)
ok('con propuesta: solo las que tienen cantidad y sin motivo', c.propuestas === 1, c.propuestas)
ok('fuera = 7', c.fuera === 7, c.fuera)
ok('buscar por modelo', filtrarLineas(lineas, 'todas', 'fba1', HOY, 90).length === 2)
ok('buscar sin tildes', filtrarLineas([linea({ sku: 'x', nombre: 'Camión rojo' })], 'todas', 'camion', HOY, 90).length === 1)
ok('decidir esta semana', filtrarLineas([linea({ sku: 'u', prioridad: 'urgente' }), linea({ sku: 'm', prioridad: 'este_mes' })], 'decidir', '', HOY, 90).length === 1)
ok('rompen en 30 días', filtrarLineas([linea({ sku: 'r', fechaRotura: '2026-12-10' }), linea({ sku: 's', fechaRotura: '2027-02-01' })], 'rompen30', '', HOY, 90).length === 1)

console.log('\n=== mapa de cobertura ===')
const plazo: PlazoEtapas = {
  preparacion: 7, transporte: 6, recepcion: 4, margen: 7, hastaLaVenta: 17, sinConfirmar: false, transporteUrgente: null,
  origen: { preparacion: 'partida', transporte: 'medido', recepcion: 'medido', margen: 'partida' },
}
const muchas = Array.from({ length: 20 }, (_, i) => linea({ sku: `S${i}`, coberturaConLoQueViene: 100 - i * 4 }))
const m = datosMapaCobertura([...muchas, linea({ sku: 'SIN', ritmo: ritmo({ base: null, previsto: null }), coberturaConLoQueViene: null })], plazo, HOY)
ok('15 barras', m.barras.length === 15, m.barras.length)
ok('la más próxima primero (S19, 24 d)', m.barras[0].sku === 'S19' && m.barras[0].dias === 24, m.barras[0])
ok('lo que no vende no sale', !m.barras.some((b) => b.sku === 'SIN'))
ok('tope = max(90, 24 × 3) = 90', m.tope === 90, m.tope)
const larga = datosMapaCobertura([linea({ sku: 'L', coberturaConLoQueViene: 400 })], plazo, HOY)
ok('400 días se dibuja topado a 90 y lo dice', larga.barras[0].barra === 90 && larga.barras[0].topada && larga.barras[0].dias === 400, larga.barras[0])
const porFecha = datosMapaCobertura([linea({ sku: 'F', coberturaConLoQueViene: null, fechaRotura: '2026-11-25' })], plazo, HOY)
ok('sin cobertura, de la fecha de rotura (10 días)', porFecha.barras[0]?.dias === 10, porFecha.barras[0])

console.log('\n=== textos ===')
ok('acierto', textoAcierto({ errorPct: 18, desde: '2026-10-16' }, HOY) === 'El ritmo previsto acertó ±18 % el último mes (desde el 16 oct)', textoAcierto({ errorPct: 18, desde: '2026-10-16' }, HOY))
ok('sin acierto, null', textoAcierto(null, HOY) === null)
ok('tono del acierto', tonoAcierto(18) === 'verde' && tonoAcierto(30) === 'ambar' && tonoAcierto(60) === 'rojo')
const tp = textoPlazo(plazo, HOY)
ok('plazo: L 17, L+M 24, a la venta el 2 dic', tp.L === 17 && tp.LM === 24 && tp.aLaVenta === '2026-12-02', tp)
const pg = preguntaAgotado(lineas[0], 'Cobo', HOY)
ok('pregunta al cliente con la fecha y lo que vendía', pg.includes('desde el 3 ago') && pg.includes('30 unidades al mes') && pg.startsWith('Hola, Cobo:'), pg)

console.log('\n=== orden, plazo y caja ===')
const desordenadas = [
  linea({ sku: 'FUERA-LEJOS', fuera: 'stock_de_sobra', cantidad: 0, fechaRotura: '2027-03-01' }),
  linea({ sku: 'MES', prioridad: 'este_mes', decidirAntesDe: '2026-12-01' }),
  linea({ sku: 'FUERA-CERCA', fuera: 'sin_datos', cantidad: 0, fechaRotura: '2026-11-20' }),
  linea({ sku: 'URG-2', prioridad: 'urgente', decidirAntesDe: '2026-11-17' }),
  linea({ sku: 'URG-1', prioridad: 'urgente', decidirAntesDe: '2026-11-16' }),
  linea({ sku: 'SIN-ROTURA', fuera: 'sin_ventas', cantidad: 0, fechaRotura: null }),
]
const ord = ordenPorDefecto(desordenadas).map((l) => l.sku).join()
ok('orden: urgentes por fecha, este mes, fuera por rotura y sin rotura al final', ord === 'URG-1,URG-2,MES,FUERA-CERCA,FUERA-LEJOS,SIN-ROTURA', ord)
ok('ordenPorDefecto no toca el original', desordenadas[0].sku === 'FUERA-LEJOS')
const et = etapasDelPlazo(plazo)
ok('etapas en orden con su origen', et.map((e) => `${e.clave}:${e.dias}:${e.origen}`).join() === 'preparacion:7:partida,transporte:6:medido,recepcion:4:medido,margen:7:partida', et)
ok('caja deducida por guardar', cajaPorGuardar(linea({ sku: 'k', caja: { unidades: 18, origen: 'deducida' } })) === 18)
ok('caja suya: nada que guardar', cajaPorGuardar(linea({ sku: 'k', caja: { unidades: 18, origen: 'sku' } })) === null)
ok('sin caja: nada', cajaPorGuardar(linea({ sku: 'k', caja: null })) === null)
ok('ritmo: previsto antes que base', ritmoDe(linea({ sku: 'r', ritmo: ritmo({ base: 2, previsto: 3.6 }) })) === 3.6)
ok('ritmo: sin previsto, base', ritmoDe(linea({ sku: 'r', ritmo: ritmo({ base: 2, previsto: null }) })) === 2)
ok('ritmo: nada, null', ritmoDe(linea({ sku: 'r', ritmo: ritmo({ base: null, previsto: null }) })) === null)

console.log(fallos === 0 ? '\nTodo bien.\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
