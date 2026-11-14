import { compartePalabra, esLaPropiaSegmentacion, palabrasDe, partesDeNombre, proponerCambios, type TerminoDeBusqueda } from './reglas'
import { UMBRALES_DE_PARTIDA } from './umbrales'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * REGLAS DE LOS TÉRMINOS. Lo que duele si falla: excluir lo que vendía, cosechar sin muestra, dejar muda una keyword negativizándola en su propia campaña, o tocar campañas ajenas a la nomenclatura.
 * Umbrales de partida: CVR 10 % → 1 pedido cada 10 clics; excluir con 30 clics sin pedido (3 ÷ CVR) o gasto ≥ 1,5 × CPA; cosechar con 3 pedidos (o 2 con ≥ 10 clics).
 */

const U = { comprasParaExacta: 2, clicsMinimosNegativizar: 15, muestraMinimaClics: 12 }
// Precio 52, ACoS objetivo 32,8 % → CPA 17,06; 1,5 × CPA = 25,59
const O = { acosObjetivoPct: 32.8, gastoMaximoSinVenta: 34.12, cpaObjetivo: 17.06 }
const nombre = (rol: string) => `B0B4LLL91M | 650 GATO GRIS/37 FBA | ZAPATILLAS CASA MUJER | ${rol}`
const t = (o: Partial<TerminoDeBusqueda> & { termino: string }): TerminoDeBusqueda => ({ campaignId: 'c1', campaignName: nombre('AUTO RADAR'), clics: 20, gasto: 5, compras: 0, ventas: 0, ...o })
const cvr = (x: number) => ({ cvrDe: () => x })

console.log('\n=== nomenclaturas ===')
{
  const p = partesDeNombre(nombre('MANUAL EXACTA / DOMINIO'))
  ok('ASIN, SKU, resumen y rol', p?.asin === 'B0B4LLL91M' && p?.sku === '650 GATO GRIS/37 FBA' && p?.resumen === 'ZAPATILLAS CASA MUJER' && p?.rol === 'MANUAL EXACTA / DOMINIO' && p?.nomenclatura === 'erp', JSON.stringify(p))
  ok('nombre viejo sin nomenclatura → null', partesDeNombre('Campaña auto zapatillas') === null)
  ok('rol inventado → null', partesDeNombre('A | B | C | OTRA COSA') === null)
  ok('el rol se lee aunque lleve espacios o minúsculas', partesDeNombre('A | B | C | auto  radar')?.rol === 'AUTO RADAR')
  ok('«Manual Exacta» a secas (Creative Toys) → ESTABILIDAD, marcada como variante', partesDeNombre('B0GV4QDJX9 | CTES69687 | Bad People | Manual Exacta')?.rol === 'MANUAL EXACTA / ESTABILIDAD' && partesDeNombre('B0GV4QDJX9 | X | Y | Manual Exacta')?.nomenclatura === 'variante')
  ok('la del SOP de bulk: AMPLIA, EXACTA DOMINIO, EXACTA ESTABILIDAD', partesDeNombre('A | B | C | AMPLIA')?.rol === 'MANUAL AMPLIA' && partesDeNombre('A | B | C | EXACTA DOMINIO')?.rol === 'MANUAL EXACTA / DOMINIO' && partesDeNombre('A | B | C | EXACTA ESTABILIDAD')?.rol === 'MANUAL EXACTA / ESTABILIDAD')
  ok('la de la skill de arranque: AUTO, FRASE H10, EXACTA, ASIN H10, EXACTA ASIN', ['AUTO', 'FRASE H10', 'EXACTA', 'ASIN H10', 'EXACTA ASIN'].map((r) => partesDeNombre(`A | B | C | ${r}`)?.rol).join() === 'AUTO RADAR,MANUAL AMPLIA,MANUAL EXACTA / ESTABILIDAD,ATAQUE ASIN,ATAQUE ASIN')
}

console.log('\n=== negativizar: por clics según el CVR, o por gasto ===')
{
  const r = proponerCambios([t({ termino: 'sombrero fedora', clics: 30, gasto: 10 })], U, O, cvr(0.1))
  ok('CVR 10 %: 30 clics sin pedido → excluir (3 ÷ CVR)', r.length === 1 && r[0].tipo === 'negativizar' && !r[0].revisar, JSON.stringify(r))
  ok('lleva su motivo con las cifras y el porqué', /10,00 gastados en 30 clics/.test(r[0]?.motivo ?? '') && /CVR del 10 %/.test(r[0]?.motivo ?? ''), r[0]?.motivo)
  ok('CVR 10 %: 29 clics y poco gasto → todavía no', proponerCambios([t({ termino: 'zapatillas', clics: 29, gasto: 10 })], U, O, cvr(0.1)).length === 0)
  ok('CVR 20 %: con 15 clics ya basta', proponerCambios([t({ termino: 'zapatillas', clics: 15, gasto: 5 })], U, O, cvr(0.2)).length === 1)
  ok('CVR 5 %: 30 clics no bastan (hacen falta 60): el umbral fijo de antes excluía términos buenos', proponerCambios([t({ termino: 'zapatillas', clics: 30, gasto: 10 })], U, O, cvr(0.05)).length === 0)
  const g = proponerCambios([t({ termino: 'zapatillas', clics: 8, gasto: 25.59 })], U, O, cvr(0.1))
  ok('pocos clics pero gasto ≥ 1,5 × CPA (25,59) → excluir (lo que llegue antes)', g.length === 1 && /1,5× el CPA objetivo/.test(g[0].motivo), JSON.stringify(g))
  ok('con algún pedido NUNCA se negativiza', proponerCambios([t({ termino: 'zapatillas', clics: 90, gasto: 90, compras: 1, ventas: 25 })], U, O, cvr(0.1)).filter((p) => p.tipo === 'negativizar').length === 0)
  ok('sin CVR de la campaña se usa el de partida (10 %)', proponerCambios([t({ termino: 'zapatillas', clics: 30, gasto: 1 })], U, O).length === 1)
  ok('los umbrales de la cuenta mandan (4 ÷ CVR → 40 clics)', proponerCambios([t({ termino: 'zapatillas', clics: 30, gasto: 1 })], U, O, { ...cvr(0.1), estimados: { ...UMBRALES_DE_PARTIDA, negativizarClicsPorCvr: 4 } }).length === 0)
}

console.log('\n=== la propia keyword no se negativiza ===')
{
  ok('término = su keyword → nada (eso es puja o pausa, no una negativa que la deje muda)', proponerCambios([t({ termino: 'reseñas google', clics: 60, gasto: 40, esSuSegmentacion: true })], U, O, cvr(0.1)).length === 0)
  ok('esLaPropiaSegmentacion: mismo texto sin tildes ni mayúsculas', esLaPropiaSegmentacion('jamon serrano', 'Jamón  Serrano') && !esLaPropiaSegmentacion('jamon serrano entero', 'jamón serrano'))
  ok('esLaPropiaSegmentacion: el ASIN de asin-expanded', esLaPropiaSegmentacion('b0clfj9n7v', 'asin-expanded="B0CLFJ9N7V"') && !esLaPropiaSegmentacion('b0cxdzpvwy', 'asin-expanded="B0CLFJ9N7V"'))
  ok('sin keyword nunca es «la propia»', !esLaPropiaSegmentacion('jamon', null))
}

console.log('\n=== irrelevantes (para revisar) ===')
{
  const pal = palabrasDe('ZAPATILLAS CASA MUJER')
  ok('palabras del producto: sin vacías ni números', pal.join() === 'zapatillas,casa,mujer', pal.join())
  ok('«zapatilla de estar por casa» comparte palabra (raíz)', compartePalabra('zapatilla de estar por casa', pal))
  ok('«metal detox loreal» no comparte nada', !compartePalabra('metal detox loreal', pal))
  const r = proponerCambios([t({ termino: 'metal detox loreal', clics: 1, gasto: 0.6 })], U, O, { ...cvr(0.1), palabrasDelProducto: pal })
  ok('al primer clic se propone, MARCADO PARA REVISAR', r.length === 1 && r[0].tipo === 'negativizar' && r[0].revisar === true && /REVISAR/.test(r[0].motivo), JSON.stringify(r))
  ok('un término relacionado con 1 clic → nada', proponerCambios([t({ termino: 'zapatillas mujer invierno', clics: 1, gasto: 0.6 })], U, O, { ...cvr(0.1), palabrasDelProducto: pal }).length === 0)
  ok('las palabras de la keyword que lo trajo también cuentan', proponerCambios([t({ termino: 'pantuflas', keyword: 'pantuflas mujer', clics: 2, gasto: 1 })], U, O, { ...cvr(0.1), palabrasDelProducto: pal }).length === 0)
  ok('un ASIN nunca es «irrelevante» (no tiene palabras)', proponerCambios([t({ termino: 'b08knpppgd', clics: 2, gasto: 1 })], U, O, { ...cvr(0.1), palabrasDelProducto: pal }).length === 0)
  ok('sin palabras del producto no se marca nada', proponerCambios([t({ termino: 'metal detox loreal', clics: 1, gasto: 0.6 })], U, O, cvr(0.1)).length === 0)
}

console.log('\n=== cosechar a EXACTA ===')
{
  const r = proponerCambios([t({ termino: 'zapatillas cuña mujer', clics: 40, gasto: 9, compras: 3, ventas: 78 })], U, O, cvr(0.1))
  ok('AUTO con 3 pedidos y ACoS 11,5 % ≤ 32,8 % → a EXACTA (ESTABILIDAD; quien llama cae a DOMINIO si no hay)', r.length === 1 && r[0].tipo === 'promover' && r[0].haciaRol === 'MANUAL EXACTA / ESTABILIDAD', JSON.stringify(r))
  ok('con la negativa exacta en origen a la vez', r[0]?.negativizarEnOrigen === true)
  ok('desde AMPLIA, igual', proponerCambios([t({ termino: 'x', campaignName: nombre('MANUAL AMPLIA'), clics: 40, gasto: 9, compras: 3, ventas: 70 })], U, O, cvr(0.1))[0]?.haciaRol === 'MANUAL EXACTA / ESTABILIDAD')
  ok('2 pedidos (los de la ficha) con ≥ 1 ÷ CVR clics (10) → también', proponerCambios([t({ termino: 'x', clics: 12, gasto: 6, compras: 2, ventas: 52 })], U, O, cvr(0.1))[0]?.tipo === 'promover')
  ok('2 pedidos con menos clics de los que cuesta un pedido (8 < 10) → no (puede ser suerte)', proponerCambios([t({ termino: 'x', clics: 8, gasto: 4, compras: 2, ventas: 52 })], U, O, cvr(0.1)).length === 0)
  ok('ACoS por encima del objetivo → no cosecha', proponerCambios([t({ termino: 'x', clics: 40, gasto: 30, compras: 3, ventas: 52 })], U, O, cvr(0.1)).filter((p) => p.tipo === 'promover').length === 0)
  ok('desde EXACTA o ATAQUE ASIN no se cosecha (ya están en su sitio)', ['MANUAL EXACTA / DOMINIO', 'MANUAL EXACTA / ESTABILIDAD', 'ATAQUE ASIN'].every((rol) => proponerCambios([t({ termino: 'x', campaignName: nombre(rol), clics: 40, gasto: 9, compras: 3, ventas: 80 })], U, O, cvr(0.1)).length === 0))
}

console.log('\n=== ASIN (fichas de producto) ===')
{
  const a = proponerCambios([t({ termino: 'b08knpppgd', clics: 30, gasto: 9, compras: 3, ventas: 90 })], U, O, cvr(0.1))
  ok('un ASIN que vende desde AUTO → a ATAQUE ASIN (segmentación por producto, no keyword)', a[0]?.haciaRol === 'ATAQUE ASIN' && a[0]?.esAsin === true, JSON.stringify(a))
  const n = proponerCambios([t({ termino: 'b08knpppgd', clics: 30, gasto: 20 })], U, O, cvr(0.1))
  ok('un ASIN que gasta sin vender → negativizar marcado como ASIN (negativa de producto)', n[0]?.tipo === 'negativizar' && n[0]?.esAsin === true && /Ficha de producto B08KNPPPGD/.test(n[0].motivo))
}

console.log('\n=== lo que se deja en paz ===')
{
  ok('campaña fuera de la nomenclatura → el motor no la toca', proponerCambios([t({ termino: 'x', campaignName: 'Auto antigua', clics: 99, gasto: 99 })], U, O).length === 0)
  const dup = proponerCambios([t({ termino: 'Fedora', clics: 30, gasto: 20 }), t({ termino: ' fedora ', clics: 30, gasto: 20 })], U, O)
  ok('el mismo término dos veces en la misma campaña → una propuesta', dup.length === 1)
  const dosCampanas = proponerCambios([t({ termino: 'fedora', clics: 30, gasto: 20 }), t({ termino: 'fedora', campaignId: 'c2', campaignName: nombre('MANUAL AMPLIA'), clics: 30, gasto: 20 })], U, O)
  ok('el mismo término en dos campañas distintas → una por campaña', dosCampanas.length === 2)
}

console.log('\n=== orden ===')
{
  const r = proponerCambios(
    [t({ termino: 'pierde poco', clics: 30, gasto: 18 }), t({ termino: 'pierde mucho', clics: 60, gasto: 45 }), t({ termino: 'gana', clics: 40, gasto: 9, compras: 3, ventas: 78 })],
    U,
    O,
    cvr(0.1)
  )
  ok('primero cosechar, luego negativizar por gasto descendente', r.map((p) => p.termino).join(',') === 'gana,pierde mucho,pierde poco', r.map((p) => p.termino).join(','))
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
