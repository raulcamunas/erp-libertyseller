import { planParaCliente } from '@/lib/fba/recorte-cliente'
import type { LineaPlan, PlanCliente, RitmoSku, EnvioPropuestoCalculado } from '@/lib/fba/plan-tipos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * CASO 56 (spec remesas-pro §11.8, D26): lo que llega al cliente externo no lleva €, prioridades, ajustes, IA ni envíos.
 * Se monta un plan de agencia con TODO relleno (€, prioridad, ajuste de IA, porqué con €…) y se busca en el JSON recortado.
 */

const ritmo: RitmoSku = {
  base: 2.1, previsto: 2.3, factorEstacional: 1.2, perfilSemanal: null, origenPerfil: null, picoAnoPasado: 5.8,
  r14: 2, r30: 2.1, r60: 2.2, r90: 2, diasConStock90: 78, ventas90: 160, ventas30: 63, ventas180: 300,
  tendencia: 'baja', confianza: 'alta', origen: 'sku', ultimoPeriodoHasta: null,
  pedidoGrande: false, serieDeStockFiable: true, anclajeEstimado: false,
  tasaDevolucionVendible: 0.19, mermaDiaria: 0.05, consumoNeto: 1.9,
  explicacion: '2,1 ud/día · media de 14/30/90 días con stock (78 de 90)',
}

const linea = (sku: string, extra: Partial<LineaPlan> = {}): LineaPlan => ({
  sku, asin: `B0${sku}`, fnsku: `X00${sku}`, nombre: `Producto ${sku}`, modelo: null, talla: null, precio: 24.9, moneda: 'EUR',
  vendibles: 40, deCamino: 20, comprometido: 30, reservadas: 3, entranteSinRemesa: 0, dudoso: 0,
  ritmo, coberturaDias: 19, coberturaConLoQueViene: 28, fechaRotura: '2026-12-30', fechaPrimerHueco: null,
  aLaVentaObjetivo: '2026-12-23', salirAntesDe: '2026-12-13', decidirAntesDe: '2026-12-06',
  vaTarde: false, diasSinStockInevitables: 0, coberturaEfectiva: 45, necesidad: 61, tope: 200, cantidad: 60,
  caja: { unidades: 12, origen: 'deducida' }, cajas: 5, eurosEnRiesgo: 1900, eurosSiVaTarde: 340, prioridad: 'esta_semana',
  fuera: null, avisos: ['plazo_de_partida'], adelantada: false, aLaVentaUrgente: '2026-12-05',
  porque: 'vende 2,1 ud/día y se queda sin stock el 30 dic; 1.900 € en juego',
  ajusteIa: { tipo: 'factor_ritmo', valor: 0.8, motivo: 'pico puntual' },
  ...extra,
})

const envio: EnvioPropuestoCalculado = {
  clave: 'env:opinas:conn:2026-W49', clienteId: 'opinas', connectionId: 'conn', moneda: 'EUR',
  salirAntesDe: '2026-12-13', decidirAntesDe: '2026-12-06', aLaVenta: '2026-12-23', prioridad: 'esta_semana', confianza: 'alta',
  lineas: [linea('A')], unidades: 60, cajasEstimadas: 5, cajasAproximadas: false, eurosEnRiesgo: 1900, porque: ['urge'], provisional: false,
}

const plan: PlanCliente = {
  clienteId: 'opinas', connectionId: 'conn', hoy: '2026-11-15', moneda: 'EUR',
  plazo: {
    preparacion: 7, transporte: 16, recepcion: 10, margen: 3,
    origen: { preparacion: 'manual', transporte: 'medido', recepcion: 'medido', margen: 'partida' },
    hastaLaVenta: 33, sinConfirmar: true, transporteUrgente: null,
  },
  ajustes: {
    coberturaObjetivo: 45, coberturaMaxima: 90, multiploCaja: 12, minLinea: 3, minEnvio: 44, ventanaAgrupacion: 9,
    capacidadUnidades: null, topeEstacional: 1.8, campanaHasta: '12-18', transporteUrgenteDias: null, activo: true, avisarChat: true,
    origen: { minEnvio: 'medido', ventanaAgrupacion: 'medido' },
  },
  medidas: { transporteMediano: 16, recepcionP75: 10, enviosMedidos: 6, cadenciaDias: 9, tamanoTipico: 110 },
  calidad: {
    libro: 'ok', leidoHasta: '2026-11-14', leidoDesde: '2025-05-01', diasAtraso: 1, ultimoError: 'No dio tiempo en la pasada',
    mercado: 'A1RKKUPIHCS9HS', mercadoRemesa: 'A1RKKUPIHCS9HS', sinConexion: false, conexionesActivas: 1,
    plazoDePartida: true, sinPrecio: 2, provisional: false, refsFueraDeCatalogo: 0, pctMerma90: 13.6,
    calculadoAt: '2026-11-15T06:00:00Z', horasDesdeCalculo: 3,
    avisos: ['Ventas leídas hasta el 14 nov', '1.900 € en juego si no sale el envío', 'Hay 2 referencias sin precio: el valor en $ no cuenta'],
  },
  lineas: [linea('A'), linea('B', { prioridad: 'tarde', eurosEnRiesgo: 500, modelo: 'F0047 BURDEOS', talla: '42', fuera: 'stock_de_sobra' })],
  envios: [envio],
  enCamino: [{
    remesaId: 'r1', nombre: 'Reposición de octubre', referenciaEnvio: 'FBA15MH74MQB', estadoAmazon: 'IN_TRANSIT',
    fechaEnvio: '2026-10-30', llegadaPrevista: '2026-11-20', unidades: 300, recibidas: 0, dudoso: false,
  }],
  resumen: {
    referencias: 2, conPropuesta: 1, fuera: { stock_de_sobra: 1 }, roturas14: 0, roturas30: 0, eurosEnRiesgo: 2400, moneda: 'EUR',
    unidadesPropuestas: 60, primeraRotura: '2026-12-30', coberturaMediana: 19, agotadosConVentas: 0, vendibles: 80, deCamino: 40,
  },
  acierto: { errorPct: 18, desde: '2026-10-16' },
}

const r = planParaCliente(plan, '2026-11-15T06:00:00Z')
const json = JSON.stringify(r)

console.log('\nLo que NO llega al cliente')
{
  const prohibidas = [
    'eurosEnRiesgo', 'eurosSiVaTarde', 'precio', 'moneda', 'prioridad', 'ajustes', 'ajusteIa', 'plazo', 'medidas',
    'envios', 'acierto', 'porque', 'cantidad', 'necesidad', 'salirAntesDe', 'decidirAntesDe', 'comprometido',
    'ultimoError', 'pctMerma90', 'fuera', 'avisos":["plazo', 'conPropuesta', 'unidadesPropuestas', 'previsto', 'factorEstacional',
  ]
  for (const k of prohibidas) ok(`sin «${k}»`, !json.includes(`"${k}`), k)
  ok('ningún símbolo de moneda en todo el JSON', !/[€$£]/.test(json), json.match(/.{0,40}[€$£].{0,20}/)?.[0] ?? '')
  ok('ni la cifra de € en juego', !json.includes('1900') && !json.includes('2400'))
  ok('ni la revisión de la IA (pico puntual)', !json.includes('pico puntual'))
}

console.log('\nLo que SÍ llega')
{
  ok('cliente, hoy y calculado', r.clienteId === 'opinas' && r.hoy === '2026-11-15' && r.calculadoAt === '2026-11-15T06:00:00Z')
  ok('todas las líneas', r.lineas.length === 2 && r.lineas[1].modelo === 'F0047 BURDEOS' && r.lineas[1].talla === '42')
  const a = r.lineas[0]
  ok('stock, de camino, cobertura y rotura', a.vendibles === 40 && a.deCamino === 20 && a.coberturaDias === 19 && a.coberturaConLoQueViene === 28 && a.fechaRotura === '2026-12-30')
  ok('ritmo: solo base, confianza y explicación', JSON.stringify(Object.keys(a.ritmo).sort()) === JSON.stringify(['base', 'confianza', 'explicacion']) && a.ritmo.base === 2.1)
  ok('las claves de la línea son exactamente las del contrato',
    JSON.stringify(Object.keys(a).sort()) === JSON.stringify(['asin', 'coberturaConLoQueViene', 'coberturaDias', 'deCamino', 'fechaRotura', 'modelo', 'nombre', 'ritmo', 'sku', 'talla', 'vendibles']))
  ok('envíos de camino', r.enCamino.length === 1 && r.enCamino[0].referenciaEnvio === 'FBA15MH74MQB' && r.enCamino[0].unidades === 300)
  ok('resumen sin €', JSON.stringify(r.resumen) === JSON.stringify({ referencias: 2, vendibles: 80, deCamino: 40, primeraRotura: '2026-12-30', coberturaMediana: 19 }))
  ok('calidad: libro, leído hasta, atraso y mercado', r.calidad.libro === 'ok' && r.calidad.leidoHasta === '2026-11-14' && r.calidad.diasAtraso === 1 && r.calidad.mercado === 'A1RKKUPIHCS9HS')
  ok('avisos de calidad sin los que hablan de dinero', JSON.stringify(r.calidad.avisos) === JSON.stringify(['Ventas leídas hasta el 14 nov']), JSON.stringify(r.calidad.avisos))
  ok('no toca el plan de entrada', plan.calidad.avisos.length === 3 && plan.lineas[0].eurosEnRiesgo === 1900)
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
