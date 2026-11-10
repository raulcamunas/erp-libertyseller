import { CIFRAS_VACIAS, saludDe, sumarCifras, sumarPorDia, tonoDeSalud } from './panel-calculo'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== salud ===')
ok('sin nada revisado → null (no un 100 % inventado)', saludDe({ revisados: 0, atencion: 0 }) === null)
ok('1.000 revisados y 50 con atención → 95 %', saludDe({ revisados: 1000, atencion: 50 }) === 0.95)
ok('tonos: 95 % verde, 90 % ámbar, 80 % rojo, null gris', tonoDeSalud(0.95) === 'verde' && tonoDeSalud(0.9) === 'ambar' && tonoDeSalud(0.8) === 'rojo' && tonoDeSalud(null) === 'gris')

console.log('\n=== sumar países ===')
{
  const es = { ...CIFRAS_VACIAS, total: 100, revisados: 90, atencion: 9, ocultos: 2, antiguedad: { d7: 1, d30: 2, d90: 3, mas: 3 }, ultimaRevision: '2026-11-10T10:00:00Z' }
  const de = { ...CIFRAS_VACIAS, total: 50, revisados: 10, atencion: 1, ocultos: 1, antiguedad: { d7: 1, d30: 0, d90: 0, mas: 0 }, ultimaRevision: '2026-11-10T12:00:00Z' }
  const s = sumarCifras([es, de])
  ok('suma total, revisados, atención y ocultos', s.total === 150 && s.revisados === 100 && s.atencion === 10 && s.ocultos === 3, JSON.stringify(s))
  ok('suma la antigüedad tramo a tramo', s.antiguedad.d7 === 2 && s.antiguedad.mas === 3)
  ok('la última revisión es la más reciente', s.ultimaRevision === '2026-11-10T12:00:00Z')
  ok('sin países → todo a cero', sumarCifras([]).revisados === 0 && sumarCifras([]).ultimaRevision === null)
}

console.log('\n=== foto diaria ===')
{
  const f = (dia: string, atencion: number) => ({ dia, revisados: 10, limpios: 5, atencion, ocultos: 1, solo_avisos: 2, atencion_con_stock: 1 })
  const p = sumarPorDia([f('2026-11-02', 3), f('2026-11-01', 4), f('2026-11-02', 5)])
  ok('suma las cuentas y países del mismo día', p.length === 2 && p[1].atencion === 8 && p[1].revisados === 20, JSON.stringify(p))
  ok('ordenado por día', p[0].dia === '2026-11-01')
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
