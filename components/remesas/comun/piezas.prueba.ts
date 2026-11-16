/**
 * PRUEBAS DE LAS PIEZAS COMUNES DE REMESAS (lo puro): formatos, estilo del plan, avisos de la banda, memoria de
 * useAgencia, media móvil del gráfico de ventas y proyección del stock.
 *
 *   cd /Users/raulcamunas/Dev/ERP-remesas && npx tsx components/remesas/comun/piezas.prueba.ts
 */
import type { CalidadDatos, LineaPlan } from '@/lib/fba/plan-tipos'
import { colorDeCobertura, decimal, dias, diasEntre, dinero, dineroPorMoneda, entero, fecha, fechaCorta, porcentaje, ritmo, sumarDias, unidades } from '../formato'
import { CONFIANZA, ESTADO_ENVIO, ESTADO_STOCK, PRIORIDAD, SALUD, avisosDeBanda, compararPrioridad, estadoDeStock } from './estilo-plan'
import { animarGraficos, filasDeVentas, mediaMovil } from './graficos'
import { diasDeProyeccion, proyectarStock } from './ProyeccionStock'
import { MEMORIA_MS, claveAfecta, guardarEnMemoria, invalidarRemesas, leerDeMemoria } from './useAgencia'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== formatos ===')
ok('fecha de siempre', fecha('2026-12-03') === '03/12/26' && fecha(null) === '—')
ok('fecha corta', fechaCorta('2026-12-03') === '3 dic', fechaCorta('2026-12-03'))
ok('fecha corta de otro año', fechaCorta('2025-01-07', '2026-11-15') === '7 ene 2025', fechaCorta('2025-01-07', '2026-11-15'))
ok('fecha corta mismo año sin año', fechaCorta('2026-01-07', '2026-11-15') === '7 ene')
ok('fecha corta sin fecha', fechaCorta(null) === '—' && fechaCorta('basura') === '—')
ok('sumar días cruza el mes', sumarDias('2026-11-28', 5) === '2026-12-03' && sumarDias('2026-03-29', -1) === '2026-03-28')
ok('días entre (cambio de hora)', diasEntre('2026-03-28', '2026-03-30') === 2 && diasEntre('2026-12-03', '2026-11-28') === -5)
ok('entero con miles en 4 cifras', entero(1900) === '1.900' && entero(8420) === '8.420' && entero(-3400) === '-3.400' && entero(12) === '12', entero(1900))
ok('entero null', entero(null) === '—')
ok('decimal', decimal(2.05, 1) === '2,1' && decimal(3, 1) === '3' && decimal(1234.5, 1) === '1.234,5', `${decimal(2.05, 1)} ${decimal(1234.5, 1)}`)
ok('días', dias(1) === '1 día' && dias(12) === '12 días' && dias(null) === '—')
ok('unidades', unidades(412) === '412 ud' && unidades(2079) === '2.079 ud')
ok('ritmo', ritmo(2.1) === '2,1 ud/día' && ritmo(0.35) === '0,35 ud/día', ritmo(0.35))
ok('dinero €', dinero(1900) === '1.900 €' && dinero(null) === '—')
ok('dinero $', dinero(1200, 'USD') === '1.200 $')
ok('dinero con céntimos', dinero(34.9, 'EUR', 2) === '34,90 €', dinero(34.9, 'EUR', 2))
ok('dinero por moneda', dineroPorMoneda([{ moneda: 'EUR', total: 8420 }, { moneda: 'USD', total: 1200 }]) === '8.420 € + 1.200 $')
ok('dinero por moneda sin nada', dineroPorMoneda([]) === '0 €' && dineroPorMoneda([{ moneda: 'USD', total: 0 }]) === '0 $')
ok('porcentaje', porcentaje(13.6) === '13,6 %')
ok('color de cobertura con tokens', colorDeCobertura(10).includes('--ls-e-rojo') && colorDeCobertura(20).includes('--ls-e-ambar') && colorDeCobertura(60).includes('--ls-e-verde') && colorDeCobertura(null).includes('--ls-t4'))

console.log('\n=== estilo del plan ===')
ok('tarde rojo sólida que late', PRIORIDAD.tarde.tono === 'rojo' && PRIORIDAD.tarde.variante === 'solida' && PRIORIDAD.tarde.vivo === true)
ok('urgente rojo suave', PRIORIDAD.urgente.tono === 'rojo' && PRIORIDAD.urgente.variante === 'suave' && !PRIORIDAD.urgente.vivo)
ok('semana naranja, 2 ámbar, mes azul, después gris', PRIORIDAD.esta_semana.tono === 'naranja' && PRIORIDAD.proximas_2.tono === 'ambar' && PRIORIDAD.este_mes.tono === 'azul' && PRIORIDAD.mas_adelante.tono === 'gris')
ok('orden de prioridad', (['este_mes', 'tarde', 'esta_semana'] as const).slice().sort(compararPrioridad).join(',') === 'tarde,esta_semana,este_mes')
ok('stock: exceso violeta, parado magenta, sin datos gris contorno', ESTADO_STOCK.exceso.tono === 'violeta' && ESTADO_STOCK.parado.tono === 'magenta' && ESTADO_STOCK.sin_datos.variante === 'contorno')
ok('envío: hablado cian, preparación violeta, caducado gris contorno', ESTADO_ENVIO.hablado.tono === 'cian' && ESTADO_ENVIO.en_preparacion.tono === 'violeta' && ESTADO_ENVIO.caducado.variante === 'contorno')
ok('confianza alta sin insignia; baja ámbar contorno', CONFIANZA.alta === null && CONFIANZA.baja?.tono === 'ambar' && CONFIANZA.baja?.variante === 'contorno')
ok('salud con el gris', SALUD.gris.tono === 'gris' && SALUD.gris.texto === 'Sin datos' && SALUD.rojo.tono === 'rojo')

type L = Parameters<typeof estadoDeStock>[0]
const linea = (o: Partial<L> & { conf?: LineaPlan['ritmo']['confianza']; base?: number | null; v30?: number }): L => ({
  vendibles: 50, fuera: null, prioridad: 'este_mes', coberturaConLoQueViene: 40, coberturaDias: 40,
  ritmo: { confianza: o.conf ?? 'alta', base: o.base === undefined ? 1 : o.base, ventas30: o.v30 ?? 30 },
  ...o,
})
ok('agotado con ventas', estadoDeStock(linea({ vendibles: 0, prioridad: 'urgente' })) === 'agotado')
ok('urgente', estadoDeStock(linea({ prioridad: 'urgente' })) === 'urgente')
ok('bajo', estadoDeStock(linea({ prioridad: 'proximas_2' })) === 'bajo')
ok('bien', estadoDeStock(linea({})) === 'ok')
ok('exceso por cobertura máxima', estadoDeStock(linea({ coberturaConLoQueViene: 200, fuera: 'stock_de_sobra' }), 90) === 'exceso')
ok('stock de sobra sin máxima = bien', estadoDeStock(linea({ coberturaConLoQueViene: 200, fuera: 'stock_de_sobra' })) === 'ok')
ok('parado', estadoDeStock(linea({ fuera: 'parado' })) === 'parado')
ok('sin ventas', estadoDeStock(linea({ fuera: 'sin_ventas', base: null, v30: 0 })) === 'sin_ventas')
ok('sin datos', estadoDeStock(linea({ fuera: 'sin_datos', conf: 'sin_datos', base: null, v30: 1 })) === 'sin_datos')
ok('V=0 sin ritmo pero con ventas30 → agotado', estadoDeStock(linea({ vendibles: 0, fuera: 'sin_datos', conf: 'sin_datos', base: null, v30: 4 })) === 'agotado')

console.log('\n=== avisos de la banda ===')
const calidad = (o: Partial<CalidadDatos>): CalidadDatos => ({
  libro: 'ok', leidoHasta: '2026-11-14', leidoDesde: '2025-06-01', diasAtraso: 1, ultimoError: null, mercado: 'A1RKKUPIHCS9HS', mercadoRemesa: 'A1RKKUPIHCS9HS',
  sinConexion: false, conexionesActivas: 1, plazoDePartida: false, sinPrecio: 0, provisional: false, refsFueraDeCatalogo: 0, pctMerma90: null,
  calculadoAt: null, horasDesdeCalculo: 2, avisos: [], ...o,
})
ok('todo bien → sin avisos', avisosDeBanda(calidad({})).length === 0)
ok('null → sin avisos', avisosDeBanda(null).length === 0)
const prov = avisosDeBanda(calidad({ leidoHasta: '2026-11-06', diasAtraso: 9, provisional: true }), { hoy: '2026-11-15' })
ok('9 días de atraso → provisional rojo con leer', prov.length === 1 && prov[0].tono === 'rojo' && prov[0].accion === 'leer' && prov[0].texto.includes('6 nov'), JSON.stringify(prov))
const atr = avisosDeBanda(calidad({ leidoHasta: '2026-11-10', diasAtraso: 5 }))
ok('5 días de atraso → ámbar', atr.length === 1 && atr[0].tono === 'ambar' && atr[0].id === 'atraso')
ok('3 días de atraso → nada', avisosDeBanda(calidad({ diasAtraso: 3 })).length === 0)
const sc = avisosDeBanda(calidad({ sinConexion: true, libro: 'sin_leer', leidoHasta: null, diasAtraso: null }))
ok('sin conexión primero y sin «leer»', sc[0].id === 'sin_conexion' && sc.find((a) => a.id === 'sin_leer')?.accion === null, JSON.stringify(sc))
const pz = avisosDeBanda(calidad({ plazoDePartida: true, sinPrecio: 3 }))
ok('plazo de partida con acción plazos; sin precio info al final', pz[0].accion === 'plazos' && pz[pz.length - 1].id === 'sin_precio')
const orden = avisosDeBanda(calidad({ sinPrecio: 2, ultimoError: 'Amazon 429', plazoDePartida: true }))
ok('orden por gravedad: error antes que plazos y que sin precio', orden.map((a) => a.id).join(',') === 'error,plazo,sin_precio', orden.map((a) => a.id).join(','))
const textos = avisosDeBanda(calidad({ sinPrecio: 2, avisos: ['2 referencias que venden sin precio: su € en juego no se puede calcular', 'Ventas hasta el 6 nov en ES: APJ6 no cubre la historia'] }))
ok('texto ya cubierto no se repite; el nuevo sale en gris', textos.length === 2 && textos.some((a) => a.texto.startsWith('Ventas hasta el 6 nov')), JSON.stringify(textos.map((a) => a.texto)))
ok('merma > 5 % magenta', avisosDeBanda(calidad({ pctMerma90: 13.6 }))[0]?.texto.includes('13,6 %') === true)
ok('plan viejo > 36 h', avisosDeBanda(calidad({ horasDesdeCalculo: 50 }))[0]?.id === 'plan_viejo')
ok('recorte del cliente externo', avisosDeBanda({ libro: 'sin_leer', leidoHasta: null, diasAtraso: null, avisos: [] })[0]?.id === 'sin_leer')

console.log('\n=== memoria de useAgencia ===')
guardarEnMemoria('/api/fba/plan?cliente=A', { x: 1 }, 1_000)
ok('se lee dentro de 5 min', (leerDeMemoria<{ x: number }>('/api/fba/plan?cliente=A', 1_000 + MEMORIA_MS - 1)?.datos.x ?? 0) === 1)
ok('caduca a los 5 min', leerDeMemoria('/api/fba/plan?cliente=A', 1_000 + MEMORIA_MS + 1) === null)
ok('afecta: mismo cliente', claveAfecta('/api/fba/ventas?cliente=A&dias=30', 'A'))
ok('afecta: global', claveAfecta('/api/fba/resumen', 'A') && claveAfecta('/api/fba/plan?todos=1', 'A'))
ok('no afecta: otro cliente', !claveAfecta('/api/fba/lotes?cliente=B', 'A'))
ok('clienteId= también cuenta', !claveAfecta('/api/fba/alertas/config?clienteId=B', 'A'))
ok('sin cliente: todo', claveAfecta('/api/fba/lotes?cliente=B', null))
const ahora = Date.now()
guardarEnMemoria('/api/fba/lotes?cliente=A', 1, ahora)
guardarEnMemoria('/api/fba/lotes?cliente=B', 2, ahora)
guardarEnMemoria('/api/fba/resumen', 3, ahora)
invalidarRemesas('A')
ok('invalidar A borra A y lo global, deja B', leerDeMemoria('/api/fba/lotes?cliente=A') === null && leerDeMemoria('/api/fba/resumen') === null && leerDeMemoria('/api/fba/lotes?cliente=B') !== null)
invalidarRemesas()
ok('invalidar sin cliente borra todo', leerDeMemoria('/api/fba/lotes?cliente=B') === null)

console.log('\n=== gráficos ===')
const mm = mediaMovil([7, null, 14, 0, 7, 7, 7, 7], 7)
ok('media móvil sin contar los null', mm[0] === 7 && mm[2] === 10.5 && Math.abs((mm[6] ?? 0) - 42 / 6) < 1e-9 && Math.abs((mm[7] ?? 0) - 42 / 6) < 1e-9, JSON.stringify(mm))
ok('media móvil todo null', mediaMovil([null, null], 7).every((x) => x === null))
const filas = filasDeVentas(
  [{ fecha: '2026-11-14', unidades: 3, euros: 30 }, { fecha: '2026-11-15', unidades: 5, euros: 50 }],
  [{ fecha: '2026-11-11', unidades: 9, euros: 0 }, { fecha: '2026-11-12', unidades: 1, euros: 10 }, { fecha: '2026-11-13', unidades: 2, euros: 20 }],
  false
)
ok('anterior alineado por el final', filas[0].anterior === 1 && filas[1].anterior === 2 && filas[1].eurosMedia === 40, JSON.stringify(filas))
ok('sin anterior → null', filasDeVentas([{ fecha: '2026-11-15', unidades: 1, euros: null }], null, false)[0].anterior === null)
ok('animar: reducir movimiento → no', animarGraficos(10, true) === false)
ok('animar: más de 400 puntos → no', animarGraficos(401, false) === false)
ok('animar: pocos puntos y sin reducir → sí', animarGraficos(30, false) === true)
ok('animar en el servidor → no', animarGraficos(30) === false)

console.log('\n=== proyección del stock ===')
const p = proyectarStock({
  hoy: '2026-11-15', vendibles: 10, consumoDia: 2, dias: 10,
  llegadas: [
    { fecha: '2026-11-18', unidades: 20, dudoso: false },
    { fecha: '2026-11-17', unidades: 100, dudoso: true },
    { fecha: '2026-11-01', unidades: 5, dudoso: false },
  ],
})
ok('hoy cuenta lo que ya debía haber llegado', p[0].fecha === '2026-11-15' && p[0].stock === 15, JSON.stringify(p.slice(0, 4)))
ok('consume y suma la llegada; la dudosa no', p[1].stock === 13 && p[2].stock === 11 && p[3].stock === 29, JSON.stringify(p.slice(0, 5)))
ok('no baja de 0', proyectarStock({ hoy: '2026-11-15', vendibles: 3, consumoDia: 2, dias: 5, llegadas: [] }).every((x) => x.stock >= 0))
ok('con el envío propuesto', proyectarStock({ hoy: '2026-11-15', vendibles: 0, consumoDia: 1, dias: 3, llegadas: [], extra: { fecha: '2026-11-17', unidades: 10 } })[2].stock === 10)
ok('consumo por fecha', proyectarStock({ hoy: '2026-11-15', vendibles: 10, consumoDia: (f) => (f === '2026-11-16' ? 5 : 1), dias: 2, llegadas: [] })[2].stock === 4)
ok('horizonte 60-180', diasDeProyeccion('2026-11-15', [null]) === 60 && diasDeProyeccion('2026-11-15', ['2027-02-01']) === 99 && diasDeProyeccion('2026-11-15', ['2027-12-01']) === 180)

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
process.exit(fallos === 0 ? 0 : 1)
