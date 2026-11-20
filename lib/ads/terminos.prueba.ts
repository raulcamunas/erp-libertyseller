import { dedupTerminos, paraGuardar, periodoDeTerminos, terminosDeInforme, type FilaDeTermino } from './terminos'
import { sumarPorCampana } from './motor-calculo'

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
  ok('con 2 clics y ninguna compra también se guarda (la regla de irrelevantes mira desde el primer clic)', g.some((x) => x.termino === 'cosa rara'))
  ok('sin ningún clic ni compra no se guarda', paraGuardar(terminosDeInforme([{ searchTerm: 'solo vista', campaignId: 9, clicks: 0, impressions: 400 }])).length === 0)
  ok('de más a menos gasto', g[0].termino.toLowerCase() === 'sombrero fedora')
  ok('lista vacía → vacía', paraGuardar([]).length === 0)
}

console.log('\n=== tope de filas: nunca se tiran las que venden (A12) ===')
{
  const fila = (termino: string, gasto: number, compras: number, extra: Partial<FilaDeTermino> = {}): FilaDeTermino => ({ termino, campaignId: 'c1', campaignName: 'C', adGroupId: 'g1', keyword: null, matchType: null, impresiones: 10, clics: 3, gasto, ventas: compras * 20, compras, ...extra })
  const caras = Array.from({ length: 30 }, (_, i) => fila(`cara ${i}`, 100 + i, 0))
  const g = paraGuardar([...caras, fila('barata que vende', 0.3, 1)], 20)
  ok('con 30 caras sin venta y tope 20, la barata CON pedido se conserva', g.some((x) => x.termino === 'barata que vende'), String(g.length))
  ok('… y el total no pasa del tope', g.length === 20, String(g.length))
  ok('… recortando las sin venta más baratas', !g.some((x) => x.termino === 'cara 0') && g.some((x) => x.termino === 'cara 29'))
  let lanzo = false
  try {
    paraGuardar(Array.from({ length: 5 }, (_, i) => fila(`vende ${i}`, 1, 1)), 3)
  } catch {
    lanzo = true
  }
  ok('si las que venden pasan del tope, error en vez de truncar', lanzo)

  const r = fila('zapatos', 5, 1)
  const d = dedupTerminos([r, { ...r }, fila('zapatos', 2, 0, { adGroupId: 'g2' })])
  ok('dedupTerminos quita la fila repetida (misma campaña, grupo y término) y deja la de otro grupo', d.length === 2)
  const s = sumarPorCampana(d)
  ok('… y sumarPorCampana no duplica clics ni pedidos', s.length === 1 && s[0].clics === 6 && s[0].compras === 1, JSON.stringify(s))
}

console.log('\n=== periodo ===')
{
  const p = periodoDeTerminos('2026-11-11')
  ok('30 días que acaban 3 días antes de hoy (conversiones sin cerrar fuera)', p.desde === '2026-10-10' && p.hasta === '2026-11-08', JSON.stringify(p))
  const p0 = periodoDeTerminos('2026-11-11', 0)
  ok('con 0 días sin cerrar, como mínimo acaba ayer (hoy está a medias)', p0.hasta === '2026-11-10', JSON.stringify(p0))
}
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
