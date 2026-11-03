import { emparejarConTaxReports, mesDelInforme, mesEnLetra, periodoDe } from '@/lib/comisiones-puente/tipos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== el informe que alimenta cada mes de cobro ===')
ok('la comisión de noviembre sale del informe de octubre', JSON.stringify(mesDelInforme(2026, 11)) === JSON.stringify({ anio: 2026, mes: 10 }))
ok('la de enero sale del de diciembre DEL AÑO ANTERIOR', JSON.stringify(mesDelInforme(2026, 1)) === JSON.stringify({ anio: 2025, mes: 12 }))
ok('la de diciembre, del de noviembre', JSON.stringify(mesDelInforme(2026, 12)) === JSON.stringify({ anio: 2026, mes: 11 }))
ok('el año anterior de un cliente de dos ficheros en noviembre es octubre de 2025, no noviembre', mesDelInforme(2026, 11).anio - 1 === 2025 && mesDelInforme(2026, 11).mes === 10)
ok('Tesorería y el informe guardado siguen en el mes de cobro', periodoDe(2026, 11) === '2026-11-01' && mesEnLetra(2026, 11) === 'Noviembre 2026')

console.log('\n=== qué fila de Tax Reports es de cada cliente ===')
{
  const clientes = [{ id: 'c1', name: 'Opinas' }, { id: 'c2', name: 'Cobo Family' }, { id: 'c3', name: 'Creative Toys' }, { id: 'c4', name: 'Solter' }, { id: 'c5', name: 'Solter ' }]
  const filas = [
    { id: 't1', nombre: 'Opinas', client_id: null },
    { id: 't2', nombre: 'Cobofamily', client_id: null },
    { id: 't3', nombre: 'Creative Toys', client_id: 'c3' },
    { id: 't4', nombre: 'Solter', client_id: null },
    { id: 't5', nombre: 'Otro cliente cualquiera', client_id: null },
  ]
  const m = emparejarConTaxReports(clientes, filas)
  ok('el enlace por client_id se respeta', m.get('c3') === 't3')
  ok('una fila dada de alta a mano se enlaza por nombre', m.get('c1') === 't1')
  ok('sin espacios ni mayúsculas: «Cobofamily» es «Cobo Family»', m.get('c2') === 't2')
  ok('si dos clientes tienen el mismo nombre NO se adivina', !m.has('c4') && !m.has('c5'))
  ok('una fila sin nadie con su nombre no se asigna a nadie', ![...m.values()].includes('t5'))
  const ya = emparejarConTaxReports([{ id: 'c1', name: 'Opinas' }], [{ id: 'tA', nombre: 'Opinas', client_id: 'c1' }, { id: 'tB', nombre: 'Opinas', client_id: null }])
  ok('un cliente que ya tiene fila enlazada no se lleva otra', ya.get('c1') === 'tA')
}

console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
