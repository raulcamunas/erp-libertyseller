import { ordenarNuevos, soloNuevos } from './envios-nuevos'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** ENVÍOS NUEVOS. Lo que duele si falla: importar dos veces el mismo, o traer borradores que entran vacíos */

const e = (shipmentId: string, estado = 'SHIPPED') => ({ shipmentId, estado, nombre: null, centro: null })

console.log('\n=== soloNuevos ===')
{
  const ya = new Set(['FBA15AAAAAA'])
  const r = soloNuevos([e('FBA15AAAAAA'), e('FBA15BBBBBB'), e('FBA15BBBBBB'), e('FBA15CCCCCC', 'WORKING'), e('FBA15DDDDDD', 'CANCELLED'), e('xyz'), e('fba15eeeeee', 'CLOSED')], ya)
  ok('no devuelve lo que ya está importado', !r.some((x) => x.shipmentId === 'FBA15AAAAAA'))
  ok('sin repetidos', r.filter((x) => x.shipmentId === 'FBA15BBBBBB').length === 1)
  ok('fuera los borradores y cancelados', !r.some((x) => x.shipmentId === 'FBA15CCCCCC' || x.shipmentId === 'FBA15DDDDDD'))
  ok('fuera lo que no parece un número FBA', !r.some((x) => x.shipmentId === 'xyz'))
  ok('un cerrado cuenta, aunque venga en minúsculas', r.some((x) => x.shipmentId === 'fba15eeeeee'))
  ok('quedan exactamente dos', r.length === 2, String(r.length))
}

console.log('\n=== ordenarNuevos ===')
{
  const r = ordenarNuevos([
    { shipmentId: 'FBA15A', diaCreacion: '2026-09-01' },
    { shipmentId: 'FBA15B', diaCreacion: '2026-10-30' },
    { shipmentId: 'FBA15C', diaCreacion: null },
  ])
  ok('el del día más reciente primero y el sin día, al final', r.map((x) => x.shipmentId).join() === 'FBA15B,FBA15A,FBA15C', r.map((x) => x.shipmentId).join())
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS de ${comprobaciones} comprobaciones\n`)
if (fallos > 0) process.exit(1)
