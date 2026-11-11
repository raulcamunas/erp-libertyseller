import { avisosDe } from './avisos-calculo'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const c = (id: string, servicio: string | null, gasto7 = 0, ventas7 = 0, estado = 'ENABLED') => ({ campaignId: id, nombre: `camp ${id}`, estado, servicio, presupuesto: 10, gasto7, ventas7 })
const r = avisosDe(
  [c('1', 'CAMPAIGN_OUT_OF_BUDGET', 50, 200), c('2', 'ADVERTISER_PAYMENT_FAILURE'), c('3', 'ADVERTISER_PAYMENT_FAILURE'), c('4', 'CAMPAIGN_STATUS_ENABLED', 20, 0), c('5', 'CAMPAIGN_INCOMPLETE'), c('6', 'CAMPAIGN_OUT_OF_BUDGET', 99, 0, 'PAUSED')],
  [{ asin: 'B0AAAAAAAA', nombre: 'A', campanasActivas: 2, stock: 0 }, { asin: 'B0BBBBBBBB', nombre: 'B', campanasActivas: 2, stock: null }, { asin: 'B0CCCCCCCC', nombre: 'C', campanasActivas: 0, stock: 0 }],
  { gastoSinVentas: 15 }
)
ok('un solo aviso de cuenta aunque lo digan dos campañas', r.filter((a) => a.tipo === 'cuenta').length === 1, JSON.stringify(r))
ok('sin presupuesto hoy', r.some((a) => a.tipo === 'sin-presupuesto' && a.campaignId === '1'))
ok('gasta sin vender (20 € y 0 ventas)', r.some((a) => a.tipo === 'gasto-sin-ventas' && a.campaignId === '4'))
ok('incompleta', r.some((a) => a.tipo === 'incompleta' && a.campaignId === '5'))
ok('pausadas no avisan', !r.some((a) => a.campaignId === '6'))
ok('sin stock con campañas activas → aviso; stock desconocido o sin campañas → no', r.filter((a) => a.tipo === 'sin-stock').length === 1 && r.some((a) => a.asin === 'B0AAAAAAAA'))
ok('lo grave primero', r[0].gravedad === 'grave')
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
