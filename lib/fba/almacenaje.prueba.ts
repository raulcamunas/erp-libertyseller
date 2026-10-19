import { SUPUESTOS_POR_DEFECTO, costeMensual, estimarAlmacenaje, mesDe, metrosCubicos, tarifaDelMes } from '@/lib/fba/almacenaje'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== la temporada ===')
ok('de enero a septiembre, tarifa baja', [1, 5, 9].every((m) => tarifaDelMes(m) === SUPUESTOS_POR_DEFECTO.tarifaBaja))
ok('de octubre a diciembre, tarifa alta', [10, 11, 12].every((m) => tarifaDelMes(m) === SUPUESTOS_POR_DEFECTO.tarifaAlta))
ok('el mes de un día', mesDe('2026-10-19') === 10 && mesDe('2026-01-03') === 1)

console.log('\n=== las cuentas ===')
ok('100 unidades de 8 litros son 0,8 m³', metrosCubicos(100) === 0.8)
ok('un volumen negativo no resta', metrosCubicos(-5) === 0 && metrosCubicos(10, { ...SUPUESTOS_POR_DEFECTO, litrosPorUnidad: -3 }) === 0)
ok('0,8 m³ en septiembre: 22,03 €', costeMensual(100, 9) === 22.03, String(costeMensual(100, 9)))
ok('0,8 m³ en octubre: 41,76 €', costeMensual(100, 10) === 41.76, String(costeMensual(100, 10)))
ok('en temporada alta cuesta casi el doble', costeMensual(100, 11) / costeMensual(100, 8) > 1.8)

console.log('\n=== la estimación ===')
{
  const e = estimarAlmacenaje({ unidades: 1000, unidadesAntiguas: 200 }, 10)
  ok('8 m³ en octubre', e.m3 === 8 && e.tarifa === 52.2, JSON.stringify(e))
  ok('417,60 € al mes', e.almacenajeMes === 417.6, String(e.almacenajeMes))
  ok('sin tarifa de recargo no se inventa un importe', e.recargoMes === null && e.unidadesConRecargo === 200)
  ok('el mes siguiente (noviembre) sigue siendo temporada alta', e.almacenajeMesSiguiente === 417.6)
  const dic = estimarAlmacenaje({ unidades: 1000, unidadesAntiguas: 0 }, 12)
  ok('de diciembre se pasa a enero: baja la tarifa', dic.almacenajeMesSiguiente < dic.almacenajeMes, `${dic.almacenajeMes} -> ${dic.almacenajeMesSiguiente}`)
  const sep = estimarAlmacenaje({ unidades: 1000, unidadesAntiguas: 0 }, 9)
  ok('de septiembre a octubre el coste casi se duplica', sep.almacenajeMesSiguiente > sep.almacenajeMes * 1.8)
  const con = estimarAlmacenaje({ unidades: 1000, unidadesAntiguas: 200 }, 10, { ...SUPUESTOS_POR_DEFECTO, recargoAntiguedad: 10 })
  ok('con tarifa de recargo: 200 uds × 8 L × 10 €/m³ = 16 €', con.recargoMes === 16, String(con.recargoMes))
  const cero = estimarAlmacenaje({ unidades: 0, unidadesAntiguas: 0 }, 10)
  ok('sin stock, cero', cero.almacenajeMes === 0 && cero.m3 === 0)
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
