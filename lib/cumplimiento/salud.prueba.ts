/**
 * PRUEBAS DE LA SALUD DE LA CUENTA (lib/cumplimiento/salud.ts), con las cifras de Cobo del 25 nov 2026 en la forma del esquema accountHealthReport-2020-11-18.
 *   npx tsx lib/cumplimiento/salud.prueba.ts
 */
import { saludDeInforme } from './salud'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const ES = 'A1RKKUPIHCS9HS'
const rango = { reportingDateFrom: '2026-09-26T00:00:00Z', reportingDateTo: '2026-11-25T00:00:00Z' }
const informe = {
  accountStatuses: [{ marketplaceId: ES, status: 'AT_RISK' }],
  performanceMetrics: [
    {
      marketplaceId: ES,
      accountHealthRating: { reportingDateRange: rango, ahrStatus: 'WARNED' },
      orderDefectRate: {
        mfn: { reportingDateRange: rango, status: 'BAD', targetValue: 0.01, targetCondition: 'LESS_THAN', orderCount: 1356, rate: 0.0236, orderWithDefects: { count: 32, status: 'BAD' }, claims: { count: 21, status: 'BAD' }, chargebacks: { count: 0, status: 'GOOD' }, negativeFeedback: { count: 14, status: 'BAD' } },
        afn: { reportingDateRange: rango, status: 'GOOD', targetValue: 0.01, targetCondition: 'LESS_THAN', orderCount: 131, rate: 0, orderWithDefects: { count: 0, status: 'GOOD' } },
      },
      lateShipmentRate: { reportingDateRange: rango, status: 'GOOD', targetValue: 0.04, targetCondition: 'LESS_THAN', orderCount: 685, rate: 0, lateShipmentCount: 0 },
      preFulfillmentCancellationRate: { reportingDateRange: rango, status: 'GOOD', targetValue: 0.025, targetCondition: 'LESS_THAN', orderCount: 177, rate: 0.0056, cancellationCount: 1 },
      validTrackingRate: { reportingDateRange: rango, status: 'GOOD', targetValue: 0.95, targetCondition: 'GREATER_THAN', shipmentCount: 313, rate: 0.9936, validTrackingCount: 311 },
      onTimeDeliveryRate: { reportingDateRange: rango, status: 'BAD', targetValue: 0.9, targetCondition: 'GREATER_THAN', shipmentCountWithValidTracking: 322, rate: 0.882, onTimeDeliveryCount: 284 },
      foodAndProductSafetyIssues: { reportingDateRange: rango, status: 'BAD', targetValue: 0, targetCondition: 'EQUALS', defectsCount: 2 },
      listingPolicyViolations: { reportingDateRange: rango, status: 'BAD', targetValue: 0, targetCondition: 'EQUALS', defectsCount: 5 },
      receivedIntellectualPropertyComplaints: { reportingDateRange: rango, status: 'GOOD', defectsCount: 0 },
    },
  ],
}
const s = saludDeInforme(informe, ES)
ok('estado de la cuenta', s.estadoCuenta === 'AT_RISK')
ok('nivel con el nombre del ejemplo (ahrStatus)', s.nivel === 'WARNED')
ok('sin puntuación en el esquema', s.puntuacion === null)
const odr = s.metricas.find((m) => m.id === 'odr-fbm')!
ok('ODR 2,36 % y mal', odr.valor === 0.0236 && odr.estado === 'mal' && odr.objetivo === 0.01 && odr.sentido === 'menos')
ok('ODR detalle', odr.detalle === '32 de 1.356 pedidos', odr.detalle ?? '')
ok('ODR desglose', odr.partes?.find((p) => p.nombre.includes('A a la Z'))?.cantidad === 21)
ok('entregas a tiempo 88,2 % mal, objetivo por encima', s.metricas.find((m) => m.id === 'entregas-a-tiempo')?.estado === 'mal' && s.metricas.find((m) => m.id === 'entregas-a-tiempo')?.sentido === 'mas')
ok('ventana', odr.desde === '2026-09-26' && odr.hasta === '2026-11-25')
ok('políticas ordenadas por defectos', s.politicas[0].defectos === 5 && s.politicas[1].defectos === 2, JSON.stringify(s.politicas))
ok('alertas: ODR + entregas + 2 políticas', s.alertas === 4, String(s.alertas))
ok('con puntuación si viniera', saludDeInforme({ performanceMetrics: [{ marketplaceId: ES, accountHealthRating: { accountHealthRatingStatus: 'GREAT', ahrScore: 286 } }] }, ES).puntuacion === 286)
ok('informe vacío no rompe', saludDeInforme(null, ES).metricas.length === 0)

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo bien')
process.exit(fallos ? 1 : 0)
