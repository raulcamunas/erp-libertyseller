import { elegirLectura, stockEntreMercados, fechaCorta, MERCADO_ESPANA, type LecturaCandidata } from '@/lib/fba/lectura-elegida'
import type { FilaStock } from '@/lib/fba/plan-tipos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * QUÉ COPIA DEL LIBRO SE LEE Y DE QUÉ MERCADO SALE EL STOCK (spec §0.2, §11 D11 y D35; casos 39, 40 y 53).
 * Datos reales del 15 nov 2026: Creative Toys tenía España al 6 nov e Italia al 15 nov.
 */

const ES = MERCADO_ESPANA
const IT = 'APJ6JRA9NG5V4'
const DE = 'A1PA6795UKMFR9'
const FR = 'A13V1IB3VIYZZH'
const HOY = '2026-11-15'
const lectura = (marketplaceId: string, leidoHasta: string | null, leidoDesde: string | null, ultimoError: string | null = null): LecturaCandidata => ({ marketplaceId, leidoHasta, leidoDesde, ultimoError })

console.log('\n=== caso 39: elegir la lectura ===')
{
  // Original: las dos cubren → gana la más reciente
  const r = elegirLectura([lectura(ES, '2026-11-06', '2025-06-01'), lectura(IT, '2026-11-15', '2025-06-01')], '2025-10-01')
  ok('ES al 06-11 y APJ6 al 15-11, las dos con historia → APJ6', r?.elegida.marketplaceId === IT, r?.elegida.marketplaceId)
  ok('sin aviso: es la más reciente', r?.aviso === null, String(r?.aviso))

  const e = elegirLectura([lectura(IT, '2026-11-15', '2025-06-01'), lectura(ES, '2026-11-15', '2025-06-01')], '2025-10-01')
  ok('empate de fechas → España (aunque venga segunda)', e?.elegida.marketplaceId === ES, e?.elegida.marketplaceId)

  // Ampliado (D35): la más reciente no cubre la historia
  const a = elegirLectura([lectura(IT, '2026-11-15', '2026-10-16'), lectura(ES, '2026-11-06', '2025-08-01')], '2025-10-11')
  ok('APJ6 al 15-11 desde el 16-10 y ES al 06-11 desde 2025 → ES', a?.elegida.marketplaceId === ES, a?.elegida.marketplaceId)
  ok('con aviso «ventas hasta el 6 nov»', !!a?.aviso && a.aviso.toLowerCase().includes('ventas hasta el 6 nov'), String(a?.aviso))

  const n = elegirLectura([lectura(IT, '2026-11-15', '2026-10-16'), lectura(ES, '2026-11-06', '2026-09-01')], '2025-10-11')
  ok('ninguna cubre → la de más historia (ES desde el 1 sep)', n?.elegida.marketplaceId === ES, n?.elegida.marketplaceId)
  ok('ninguna cubre → con aviso de falta de historia', !!n?.aviso && n.aviso.includes('1 sep'), String(n?.aviso))

  const s = elegirLectura([lectura(ES, null, null, 'No dio tiempo en la pasada del 14 nov'), lectura(IT, '2026-11-15', '2025-01-01')], '2025-10-11')
  ok('las de leido_hasta null se ignoran si hay alguna con fecha', s?.elegida.marketplaceId === IT, s?.elegida.marketplaceId)

  const z = elegirLectura([lectura(IT, null, null), lectura(ES, null, null)], '2025-10-11')
  ok('ninguna con fecha → España, con aviso', z?.elegida.marketplaceId === ES && !!z.aviso, JSON.stringify(z))

  ok('sin lecturas → null', elegirLectura([], '2025-10-11') === null)

  const unaSola = elegirLectura([lectura(FR, '2026-11-14', '2026-11-01')], '2025-10-11')
  ok('una sola lectura sin historia → esa, con aviso', unaSola?.elegida.marketplaceId === FR && !!unaSola.aviso)

  const sinDesde = elegirLectura([lectura(IT, '2026-11-15', null), lectura(DE, '2026-11-10', '2026-10-01')], '2025-10-11')
  ok('ninguna cubre: una lectura sin primer día cuenta como sin historia', sinDesde?.elegida.marketplaceId === DE, sinDesde?.elegida.marketplaceId)

  const tres = elegirLectura([lectura(ES, '2026-11-10', '2025-01-01'), lectura(IT, '2026-11-15', '2025-01-01'), lectura(DE, '2026-11-20', '2026-11-01')], '2025-10-11')
  ok('entre las que cubren gana la más reciente (IT), aunque DE esté más al día', tres?.elegida.marketplaceId === IT && !!tres.aviso, JSON.stringify(tres))

  // conserva el resto de campos de quien llama
  const ext = elegirLectura([{ ...lectura(ES, '2026-11-06', '2025-01-01'), connectionId: 'c1' }], '2025-10-11')
  ok('devuelve el mismo objeto que se le pasa (con sus campos)', ext?.elegida.connectionId === 'c1')

  ok('fechaCorta', fechaCorta('2026-11-06') === '6 nov' && fechaCorta('2025-08-01', HOY) === '1 ago 2025')
}

const fila = (marketplaceId: string, sku: string, vendibles: number, updatedAt: string | null, extra: Partial<FilaStock> = {}): FilaStock => ({
  marketplaceId, sku, vendibles, entrante: 0, reservadas: null, noApto: null, precio: null, moneda: 'EUR', listingStatus: ['BUYABLE'], updatedAt, ...extra,
})

console.log('\n=== caso 40: stock entre mercados ===')
{
  const m = stockEntreMercados([
    fila(IT, 'FBA259505-42', 12, '2026-11-15T03:00:00Z'),
    fila(DE, 'FBA259505-42', 12, '2026-11-14T03:00:00Z'),
    fila(ES, 'FBA100-40', 5, '2026-11-15T03:00:00Z'),
    fila(IT, 'FBA100-40', 9, '2026-11-15T03:00:00Z'),
  ], ES, HOY)
  const a = m.get('FBA259505-42')
  ok('SKU sin fila en ES, 12 en IT y 12 en DE → 12 (máximo, no 24)', a?.vendibles === 12, String(a?.vendibles))
  ok('…marcado como de otro mercado y no viejo', a?.deOtroMercado === true && a.viejoDias === null)
  const b = m.get('FBA100-40')
  ok('con fila en el mercado preferido se usa esa (5), aunque otro tenga más', b?.vendibles === 5 && b.marketplaceId === ES && b.deOtroMercado === false)

  const max = stockEntreMercados([fila(IT, 'X', 3, '2026-11-15'), fila(DE, 'X', 8, '2026-11-14'), fila(FR, 'X', 6, '2026-11-13')], ES, HOY).get('X')
  ok('el máximo de las otras: 8 de DE', max?.vendibles === 8 && max.marketplaceId === DE, JSON.stringify(max))

  const reciente = stockEntreMercados([fila(IT, 'Y', 40, '2026-11-01'), fila(DE, 'Y', 6, '2026-11-14')], ES, HOY).get('Y')
  ok('una fila vieja con más stock no gana a una reciente: 6 de DE', reciente?.vendibles === 6 && reciente.viejoDias === null, JSON.stringify(reciente))

  const borde = stockEntreMercados([fila(IT, 'Z', 4, '2026-11-13')], ES, HOY).get('Z')
  ok('de hace exactamente 2 días cuenta como reciente', borde?.viejoDias === null)

  const tz = stockEntreMercados([fila(IT, 'T', 4, '2026-11-12T23:30:00Z')], ES, HOY).get('T')
  ok('el día del updated_at es el de España (23:30 UTC del 12 = 13 en Madrid)', tz?.viejoDias === null, JSON.stringify(tz))
}

console.log('\n=== caso 53: stock viejo ===')
{
  const v = stockEntreMercados([fila(IT, 'WM40297', 7, '2026-10-02T09:00:00Z')], ES, HOY).get('WM40297')
  ok('única fila de IT de hace 44 días → se usa', v?.vendibles === 7 && v.deOtroMercado === true)
  ok('…con viejoDias 44', v?.viejoDias === 44, String(v?.viejoDias))

  const dos = stockEntreMercados([fila(IT, 'W', 7, '2026-10-02'), fila(DE, 'W', 3, '2026-10-20')], ES, HOY).get('W')
  ok('varias viejas → la más reciente (DE, 26 días)', dos?.marketplaceId === DE && dos.viejoDias === 26, JSON.stringify(dos))

  const sinFecha = stockEntreMercados([fila(IT, 'S', 2, null), fila(DE, 'S', 5, null)], ES, HOY).get('S')
  ok('sin fechas → la mayor, edad desconocida', sinFecha?.vendibles === 5 && sinFecha.viejoDias === null && sinFecha.deOtroMercado)

  const mezcla = stockEntreMercados([fila(IT, 'Q', 50, null), fila(DE, 'Q', 5, '2026-11-15')], ES, HOY).get('Q')
  ok('una fila sin fecha no gana a una reciente', mezcla?.marketplaceId === DE)

  ok('sin filas → mapa vacío', stockEntreMercados([], ES, HOY).size === 0)
}

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo bien')
if (fallos) process.exit(1)
