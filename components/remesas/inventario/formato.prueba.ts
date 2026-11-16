/**
 * PRUEBAS DE LO PURO DEL STOCK Y DEL RESUMEN DEL CLIENTE (paquete C3).
 *
 *   cd /Users/raulcamunas/Dev/ERP-remesas && npx tsx components/remesas/inventario/formato.prueba.ts
 */
import type { SkuInventario } from '@/lib/fba/inventario'
import {
  barraDeStock, calidadDeInventario, din, diasDesde, filasDeStock, llegadasAproximadas, proximoEnvioPropuesto, topCobertura, ventanaDeVentas,
  type LineaDeStock,
} from './formato'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const sku = (p: Partial<SkuInventario> & { sku: string }): SkuInventario =>
  ({
    asin: null, fnsku: null, nombre: null, precio: null, moneda: 'EUR',
    enAmazon: 0, vendibles: 0, entrante: 0, noDisponibles: 0, reservadas: null,
    vendidas: { d7: 0, d14: 0, d30: 0, d60: 0, d90: 0 }, devueltas: { d30: 0, d90: 0 }, tasaDevolucion90: null,
    ritmo7: 0, ritmo30: 0, ritmo90: 0, ritmoPlan: 0, tendencia: null, muestraCorta: false, serie90: null,
    ultimaVenta: null, diasSinVenta: null, primeraEntrada: null,
    lotes: [], edadMediaDias: null, edadMaxDias: null, porTramo: { t0: 0, t91: 0, t181: 0, t271: 0, t366: 0 },
    anteriorALaLectura: 0, diasMedioDeVenta: null, retiradas: 0, mermas: 0, descuadre: null,
    cobertura: null, seAgotaEl: null, valorStock: null, valorVentas30: null, estado: 'ok', alertas: [],
    ...p,
  }) as SkuInventario

const linea = (p: Partial<LineaDeStock> & { sku: string }): LineaDeStock => ({
  asin: null, nombre: null, modelo: null, talla: null, vendibles: 0, deCamino: 0,
  coberturaDias: null, coberturaConLoQueViene: null, fechaRotura: null,
  ritmo: { base: null, confianza: 'sin_datos', explicacion: '' },
  ...p,
})

console.log('\n=== filasDeStock: un único número por pregunta ===')
{
  const skus = [
    sku({ sku: 'A', vendibles: 92, ritmoPlan: 3, cobertura: 31, seAgotaEl: '2026-12-17', vendidas: { d7: 10, d14: 20, d30: 61, d60: 120, d90: 190 } }),
    sku({ sku: 'B', vendibles: 10, ritmoPlan: 1, cobertura: 10, seAgotaEl: '2026-11-26', estado: 'urgente' }),
    sku({ sku: 'C', vendibles: 0, ritmoPlan: 0, estado: 'sin_datos' }),
  ]
  const lineas: LineaDeStock[] = [
    linea({
      sku: 'A', vendibles: 92, deCamino: 0, coberturaDias: 45, coberturaConLoQueViene: 45, fechaRotura: '2026-12-30',
      ritmo: { base: 2.05, confianza: 'alta', explicacion: '2,05 ud/día · media de 14/30/90 días con stock' },
      prioridad: 'este_mes', fuera: null, avisos: ['stock_viejo'],
    }),
  ]
  const f = filasDeStock(skus, lineas, { coberturaMaxima: 90 })
  ok('A sale del plan', f[0].origen === 'plan')
  ok('A: ritmo del plan (2,05) y no del inventario (3)', f[0].ritmo === 2.05, String(f[0].ritmo))
  ok('A: rotura del plan', f[0].rotura === '2026-12-30')
  ok('A: cobertura con lo que viene', f[0].cobertura === 45)
  ok('A: estado por la prioridad del plan (este mes → bien)', f[0].estado === 'ok', f[0].estado)
  ok('A: stock viejo (D11) marcado', f[0].stockViejo)
  ok('B sin línea: del inventario', f[1].origen === 'inventario' && f[1].ritmo === 1 && f[1].rotura === '2026-11-26' && f[1].estado === 'urgente')
  ok('C sin datos: ritmo y cobertura nulos', f[2].ritmo === null && f[2].cobertura === null && f[2].estado === 'sin_datos')

  // Sin plan, todas del inventario
  const sinPlan = filasDeStock(skus, null)
  ok('sin plan: todas del inventario', sinPlan.every((x) => x.origen === 'inventario'))

  // Línea del cliente externo (sin prioridad): estado por cobertura
  const cliente = filasDeStock(
    [sku({ sku: 'D', vendibles: 5, vendidas: { d7: 2, d14: 4, d30: 9, d60: 18, d90: 27 } }), sku({ sku: 'E', vendibles: 0, vendidas: { d7: 1, d14: 2, d30: 4, d60: 8, d90: 12 } }), sku({ sku: 'F', vendibles: 500, vendidas: { d7: 1, d14: 2, d30: 4, d60: 8, d90: 12 } })],
    [
      linea({ sku: 'D', vendibles: 5, coberturaDias: 12, coberturaConLoQueViene: 12, ritmo: { base: 0.4, confianza: 'media', explicacion: '' } }),
      linea({ sku: 'E', vendibles: 0, coberturaDias: 0, coberturaConLoQueViene: 0, ritmo: { base: 0.2, confianza: 'baja', explicacion: '' } }),
      linea({ sku: 'F', vendibles: 500, coberturaDias: 400, coberturaConLoQueViene: 400, ritmo: { base: 1.2, confianza: 'alta', explicacion: '' } }),
    ],
  )
  ok('cliente: 12 días → rompe pronto', cliente[0].estado === 'urgente', cliente[0].estado)
  ok('cliente: V 0 y vende → agotado', cliente[1].estado === 'agotado', cliente[1].estado)
  ok('cliente: 400 días → de sobra', cliente[2].estado === 'exceso', cliente[2].estado)
}

console.log('\n=== calidadDeInventario ===')
{
  const c = calidadDeInventario({ libro: 'ok', leidoHasta: '2026-11-06', conectado: true, lectura: { intentoAt: null, error: 'Throttled' }, marketplaceId: 'A1RKKUPIHCS9HS' }, '2026-11-15')
  ok('atraso 9 días', c.diasAtraso === 9)
  ok('último error', c.ultimoError === 'Throttled')
  ok('con conexión', c.sinConexion === false)
  const s = calidadDeInventario({ libro: 'sin_leer', leidoHasta: null, conectado: false, lectura: null, marketplaceId: null }, '2026-11-15')
  ok('sin libro: atraso null y sin conexión', s.diasAtraso === null && s.sinConexion === true)
}

console.log('\n=== barraDeStock ===')
{
  const b = barraDeStock({
    skus: [sku({ sku: 'A', reservadas: 4 }), sku({ sku: 'B', reservadas: null })],
    resumen: { vendibles: 100, entrante: 40, noDisponibles: 3 } as never,
  })
  ok('suma vendible + camino + reservado + no apto', b.total === 147 && b.reservado === 4 && b.conDesglose)
  const sin = barraDeStock({ skus: [sku({ sku: 'A' })], resumen: { vendibles: 10, entrante: 0, noDisponibles: 2 } as never })
  ok('sin desglose: reservado 0', sin.reservado === 0 && !sin.conDesglose && sin.noApto === 2)
}

console.log('\n=== ventanaDeVentas ===')
{
  const dias = Array.from({ length: 90 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 7, 18 + i)).toISOString().slice(0, 10)
    return { fecha: d, unidades: i < 30 ? 0 : i < 60 ? 1 : 2, euros: i < 60 ? 10 : 20 }
  })
  const v = ventanaDeVentas(dias, 30)
  ok('30 días: 60 ud', v.unidades === 60, String(v.unidades))
  ok('30 anteriores: 30 ud', v.anterior?.unidades === 30, JSON.stringify(v.anterior))
  ok('euros 30 d', v.euros === 600)
  ok('ud/día 2', v.udDia === 2)
  const corto = ventanaDeVentas(dias, 30, dias[45].fecha)
  ok('libro empieza dentro de la anterior: sin comparar', corto.anterior === null)
  ok('pocos días: sin comparar', ventanaDeVentas(dias.slice(0, 40), 30).anterior === null)
  ok('sin €: null', ventanaDeVentas([{ fecha: '2026-11-01', unidades: 3, euros: null }], 30).euros === null)
}

console.log('\n=== topCobertura ===')
{
  const ls = [
    linea({ sku: 'X', coberturaConLoQueViene: 40, ritmo: { base: 1, confianza: 'alta', explicacion: '' } }),
    linea({ sku: 'Y', coberturaConLoQueViene: 5, ritmo: { base: 2, confianza: 'alta', explicacion: '' } }),
    linea({ sku: 'Z', coberturaConLoQueViene: 1, ritmo: { base: 0, confianza: 'sin_datos', explicacion: '' } }),
    linea({ sku: 'W', coberturaConLoQueViene: null, coberturaDias: 20, ritmo: { base: 0.5, confianza: 'media', explicacion: '' } }),
  ]
  const t = topCobertura(ls, 2)
  ok('las que antes rompen, sin las que no venden', t.map((x) => x.sku).join(',') === 'Y,W', t.map((x) => x.sku).join(','))
}

console.log('\n=== llegadasAproximadas ===')
{
  const ll = llegadasAproximadas(
    { deCamino: 20, dudoso: 120, entranteSinRemesa: 0 },
    [
      { llegadaPrevista: '2026-11-20', dudoso: false, nombre: 'Envío 5 nov' },
      { llegadaPrevista: '2026-10-06', dudoso: true, nombre: 'Envío 20 sep' },
    ],
    '2026-11-15',
    17,
  )
  ok('20 que cuentan llegan el 20 nov', ll[0].unidades === 20 && ll[0].fecha === '2026-11-20' && !ll[0].dudoso, JSON.stringify(ll[0]))
  ok('120 dudosas, huecas y desde hoy', ll[1].unidades === 120 && ll[1].dudoso && ll[1].fecha === '2026-11-15', JSON.stringify(ll[1]))
  const sinRemesa = llegadasAproximadas({ deCamino: 600, dudoso: 0, entranteSinRemesa: 600 }, [], '2026-11-15', 17)
  ok('entrante sin remesa en hoy + L', sinRemesa.length === 1 && sinRemesa[0].fecha === '2026-12-02' && sinRemesa[0].unidades === 600, JSON.stringify(sinRemesa))
  ok('nada de camino: nada', llegadasAproximadas({ deCamino: 0 }, [], '2026-11-15').length === 0)
}

console.log('\n=== proximoEnvioPropuesto ===')
{
  const e = proximoEnvioPropuesto([
    { estado: 'nuevo', prioridad: 'este_mes', salirAntesDe: '2026-12-01' },
    { estado: 'hablado', prioridad: 'urgente', salirAntesDe: '2026-11-30' },
    { estado: 'en_preparacion', prioridad: 'tarde', salirAntesDe: '2026-11-10' },
    { estado: 'nuevo', prioridad: 'urgente', salirAntesDe: '2026-11-20' },
  ] as const)
  ok('el urgente que antes sale, sin el que ya está en preparación', e?.salirAntesDe === '2026-11-20', JSON.stringify(e))
  ok('sin activos: null', proximoEnvioPropuesto([{ estado: 'enviado', prioridad: 'tarde', salirAntesDe: '2026-11-01' }]) === null)
}

console.log('\n=== formatos ===')
ok('din en dólares', din(1200, 'USD') === '1.200 $', din(1200, 'USD'))
ok('din null', din(null) === '—')
ok('diasDesde', diasDesde('2026-11-10', '2026-11-15') === 5 && diasDesde('2026-11-20', '2026-11-15') === 0 && diasDesde(null, '2026-11-15') === null)

console.log(fallos === 0 ? '\nTodo bien.\n' : `\n${fallos} prueba(s) fallan.\n`)
if (fallos > 0) process.exit(1)
