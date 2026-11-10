import { paraGuardar, periodoDeTerminos, terminosDeInforme } from './terminos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const crudas = [
  { searchTerm: 'sombrero fedora', campaignId: 1, campaignName: 'C1', adGroupId: 10, keyword: 'sombrero', matchType: 'BROAD', impressions: 900, clicks: 30, cost: 12.5, sales7d: 0, purchases7d: 0 },
  { searchTerm: 'Sombrero Fedora', campaignId: 1, campaignName: 'C1', adGroupId: 10, keyword: 'sombrero', matchType: 'BROAD', impressions: 100, clicks: 5, cost: 2.5, sales7d: 0, purchases7d: 0 },
  { searchTerm: 'jamonero', campaignId: 2, campaignName: 'C2', adGroupId: 20, impressions: '300', clicks: '4', cost: '1.2', sales7d: '25', purchases7d: '1' },
  { searchTerm: 'cosa rara', campaignId: 2, campaignName: 'C2', adGroupId: 20, impressions: 50, clicks: 2, cost: 0.4, sales7d: 0, purchases7d: 0 },
  { searchTerm: '', campaignId: 3, clicks: 99 },
  { searchTerm: 'sin campaña', clicks: 99 },
]

console.log('\n=== filas del informe de términos ===')
{
  const t = terminosDeInforme(crudas)
  ok('descarta las filas sin término o sin campaña', t.length === 4, String(t.length))
  ok('los números como texto se leen', t[2].clics === 4 && t[2].compras === 1 && t[2].ventas === 25 && t[2].gasto === 1.2)
  ok('el grupo de anuncios llega como texto', t[0].adGroupId === '10')
}

console.log('\n=== qué se guarda ===')
{
  const g = paraGuardar(terminosDeInforme(crudas))
  ok('el mismo término con distinta mayúscula en la misma campaña se suma: 35 clics y 15 gastados', g.find((x) => x.termino.toLowerCase() === 'sombrero fedora')?.clics === 35 && g.find((x) => x.termino.toLowerCase() === 'sombrero fedora')?.gasto === 15)
  ok('con una compra se guarda aunque tenga 4 clics', g.some((x) => x.termino === 'jamonero'))
  ok('con 2 clics y ninguna compra no se guarda', !g.some((x) => x.termino === 'cosa rara'))
  ok('de más a menos gasto', g[0].termino.toLowerCase() === 'sombrero fedora')
  ok('lista vacía → vacía', paraGuardar([]).length === 0)
}

console.log('\n=== periodo ===')
{
  const p = periodoDeTerminos('2026-11-11')
  ok('14 días hasta ayer', p.desde === '2026-10-28' && p.hasta === '2026-11-10', JSON.stringify(p))
}
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
