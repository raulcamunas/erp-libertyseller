/**
 * Pruebas de «qué hacer hoy» con las cuentas de verdad (A5): palabras que pesan sin contar dos veces la misma búsqueda, búsquedas ajenas fuera de las tareas, `compras` sin multiplicador y la
 * caída general. Se corre con: npx tsx lib/seo/tareas.prueba.ts
 */
import type { ConsultaGuardada, FichaGuardada } from './datos'
import type { Movimientos } from './movimientos'
import { palabrasQuePesan, tareasDeLaCuenta, type EntradaDeTareas } from './tareas'
import { diagnosticarTodas } from './embudo'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const ASIN = 'B0JUEGO001'
/** [volumen, imp total, imp tuyas, clics total, tuyos, carritos total, tuyos, compras total, tuyas, precio mediano total, tuyo] */
function fila(consulta: string, n: Array<number | null>, desde = '2026-10-01', periodo: 'MONTH' | 'WEEK' = 'MONTH'): ConsultaGuardada {
  const [volumen, it, ia, ct, ca, kt, ka, pt, pa, pmt, pma] = n
  const c = (a: number | null, t: number | null) => (a != null && t ? a / t : null)
  return {
    asin: ASIN, periodo, desde, hasta: desde, consulta, puntuacion: null, volumen,
    impresionesTotal: it, impresionesAsin: ia, cuotaImpresiones: c(ia, it), clicsTotal: ct, clicsAsin: ca, cuotaClics: c(ca, ct), carritosTotal: kt, carritosAsin: ka, cuotaCarritos: c(ka, kt),
    comprasTotal: pt, comprasAsin: pa, cuotaCompras: c(pa, pt), precioMedianoTotal: pmt, precioMedianoAsin: pma,
  }
}

const FICHA: FichaGuardada = { asin: ASIN, sku: 'SKU-1', titulo: 'MARCA Cartas de Preguntas para Adultos y Familias', bullets: ['Preguntas para toda la familia'], descripcion: null, backend: 'regalo', leidaAt: '2026-11-13T00:00:00Z' }

function entrada(mes: ConsultaGuardada[], extra: Partial<EntradaDeTareas> = {}): EntradaDeTareas {
  return {
    hoy: '2026-11-14',
    lectura: { acceso: 'si', mesOk: '2026-10-01', semanaOk: '2026-11-01', fichaLeidaAt: '2026-11-13T00:00:00Z' },
    productos: [{ id: '1', asin: ASIN, sku: 'SKU-1', nombre: 'Juego' }],
    fichas: [FICHA],
    consultas: { MONTH: mes, WEEK: [] },
    precios: { [ASIN]: 30 },
    ...extra,
  }
}

console.log('\n=== palabras que pesan: cada búsqueda una vez ===')
{
  // «juegos de mesa»: 802 compras del mercado y ninguna nuestra. «juegos» y «mesa» no están en la ficha: antes se sumaban 802 por cada palabra (1.604)
  const mes = [fila('juegos de mesa', [60000, 1000000, 100, 30000, 3, 3000, 0, 802, 0, 25, null])]
  const t = tareasDeLaCuenta(entrada(mes)).find((x) => x.tipo === 'palabras')
  ok('la tarea de palabras existe y lleva «juegos» y «mesa»', !!t && !!t.etiquetas?.includes('juegos') && !!t.etiquetas?.includes('mesa'), JSON.stringify(t))
  ok('«juegos de mesa» con 802 compras → 802, no 1.604', t?.compras === 802 && t.detalle.includes('802') && !t.detalle.includes('1.604'), JSON.stringify(t))
  ok('impacto = compras × 0,5 (solo para ordenar)', t?.impacto === 401)
  const pq = palabrasQuePesan(diagnosticarTodas(mes, 30, { ficha: FICHA }).busquedas, FICHA)
  ok('cada palabra sabe en qué búsquedas sale', pq.find((p) => p.palabra === 'juegos')?.consultas.has('juegos de mesa') === true)
}

console.log('\n=== las búsquedas ajenas no mandan en las tareas ===')
{
  const mes = [
    fila('juegos de mesa adultos', [8000, 300000, 3000, 9000, 90, 900, 9, 200, 2, 25, 30]),
    fila('juego de mesa familiar', [5000, 200000, 2000, 6000, 60, 600, 6, 150, 1, 25, 30]),
    fila('juego mesa', [3000, 100000, 1000, 3000, 30, 300, 3, 90, 1, 25, 30]),
    fila('lego', [400000, 14340612, 661, 40000, 10, 9000, 0, 3557, 0, 45, null]),
    fila('murdoku', [20000, 600000, 30, 9000, 0, 800, 0, 300, 0, 20, null]),
  ]
  const t = tareasDeLaCuenta(entrada(mes))
  const todas = t.flatMap((x) => x.etiquetas ?? [])
  ok('«lego» y «murdoku» no salen en ninguna tarea (ni palabras ni oportunidad)', !todas.includes('lego') && !todas.includes('murdoku'), JSON.stringify(t.map((x) => [x.tipo, x.etiquetas])))
  const embudo = t.find((x) => x.tipo === 'embudo')
  ok('el embudo del producto suma 3 búsquedas, no 5', !embudo || embudo.detalle.includes('sus 3 búsquedas'), embudo?.detalle)
  ok('ninguna tarea enseña las compras de «lego» (3.557)', t.every((x) => x.compras < 3557), JSON.stringify(t.map((x) => [x.tipo, x.compras])))
  ok('marcada a mano como nuestra, «murdoku» vuelve a contar', tareasDeLaCuenta(entrada(mes, { nuestras: ['murdoku'] })).some((x) => x.etiquetas?.includes('murdoku')))

  // Con muchos clics en el mercado, «lego» pierde en clics: no se manda revisar la imagen
  const legoGrande = [...mes.slice(0, 3), fila('lego', [400000, 14340612, 661, 400000, 10, 9000, 0, 3557, 0, 45, null])]
  const tg = tareasDeLaCuenta(entrada(legoGrande))
  const ajena = tg.find((x) => x.id.endsWith('fugas:clics-ajenas'))
  ok('la fuga de clics de una posible ajena dice «Puede ser otro producto: negativízala en PPC»', !!ajena && ajena.accion.startsWith('Puede ser otro producto: negativízala en PPC') && ajena.quien === 'PPC', JSON.stringify(ajena))
  ok('…y no sale en la tarea de «revisa la imagen»', !tg.some((x) => x.id.endsWith('fugas:clics') && x.etiquetas?.includes('lego')))
}

console.log('\n=== compras sin multiplicador ===')
{
  // Infraexpuesta con fuerza 4: impacto = enJuego × 2 (para ordenar), compras = enJuego
  const mes = [fila('tarjetas juego review', [2000, 50000, 1000, 1500, 60, 200, 12, 100, 8, 25, 30])]
  const t = tareasDeLaCuenta(entrada(mes)).find((x) => x.tipo === 'infraexpuesta')
  ok('infraexpuesta: compras = 92 (las reales) e impacto = 184 (ordena)', t?.compras === 92 && t.impacto === 184, JSON.stringify(t))
  ok('todas las tareas llevan compras', tareasDeLaCuenta(entrada(mes)).every((x) => typeof x.compras === 'number'))
}

console.log('\n=== caída general ===')
{
  const mes = [fila('juegos de mesa adultos', [8000, 300000, 3000, 9000, 90, 900, 9, 200, 2, 25, 30])]
  const evolucion = [
    { asin: ASIN, periodo: 'MONTH' as const, desde: '2026-09-01', hasta: '2026-09-30', busquedas: 10, volumen: 1000, compras: 20, cuotaCompras: 0.1, cuotaImpresiones: 0.01 },
    { asin: ASIN, periodo: 'MONTH' as const, desde: '2026-10-01', hasta: '2026-10-31', busquedas: 10, volumen: 1000, compras: 2, cuotaCompras: 0.01, cuotaImpresiones: 0.01 },
  ]
  const m = (consulta: string) => ({ consulta, cuotaAhora: null, cuotaMedia: 0.02, deltaPt: null, comprasTotalMedia: 10 })
  const mov: Movimientos = { semana: '2026-11-08', semanasLeidas: 5, base: 63, suben: [], bajan: Array.from({ length: 32 }, (_, i) => m(`b${i}`)), salen: Array.from({ length: 30 }, (_, i) => m(`s${i}`)), caidaGeneral: true }
  const gasto = [95, 90, 80, 10, 0].map((g, i) => ({ desde: `2026-10-${String(11 + 7 * i).padStart(2, '0')}`, gasto: g }))
  const sin = tareasDeLaCuenta(entrada(mes, { evolucion }))
  ok('sin movimientos sale la caída de la cuota de compras de siempre', sin.some((x) => x.tipo === 'caida'))
  const t = tareasDeLaCuenta(entrada(mes, { evolucion }), { movimientos: new Map([[ASIN, mov]]), gastoSemanal: new Map([[ASIN, gasto]]), moneda: '$' })
  const cg = t.find((x) => x.tipo === 'caida-general')
  ok('con caída general: tarea grave para quien lleva la cuenta, a Búsquedas', cg?.gravedad === 'grave' && cg.quien === 'Quien lleva la cuenta' && cg.ir === 'busquedas', JSON.stringify(cg))
  ok('con el gasto PPC de las 5 semanas en el detalle', !!cg?.detalle.includes('95 → 90 → 80 → 10 → 0 $'), cg?.detalle)
  ok('y sustituye a la de caída de ese producto (no se repite)', !t.some((x) => x.tipo === 'caida'))
  ok('sin caída general no sale', !tareasDeLaCuenta(entrada(mes, { evolucion }), { movimientos: new Map([[ASIN, { ...mov, caidaGeneral: false }]]) }).some((x) => x.tipo === 'caida-general'))
}

console.log('\n=== la caída usa la cesta fija si hay historial ===')
{
  const base = (desde: string, pa: number) => [
    fila('juegos de mesa adultos', [8000, 300000, 3000, 9000, 90, 900, 9, 200, pa, 25, 30], desde),
    fila('juego de mesa familiar', [5000, 200000, 2000, 6000, 60, 600, 6, 150, pa, 25, 30], desde),
  ]
  const historial = [...base('2026-09-01', 20), ...base('2026-10-01', 20), fila('lego', [400000, 14340612, 661, 40000, 10, 9000, 0, 3557, 0, 45, null], '2026-10-01')]
  // La evolución (que suma todo, «lego» incluido) diría que la cuota se hunde; la cesta fija, que no se ha movido
  const evolucion = [
    { asin: ASIN, periodo: 'MONTH' as const, desde: '2026-09-01', hasta: '2026-09-30', busquedas: 2, volumen: 13000, compras: 40, cuotaCompras: 40 / 350, cuotaImpresiones: 0.01 },
    { asin: ASIN, periodo: 'MONTH' as const, desde: '2026-10-01', hasta: '2026-10-31', busquedas: 3, volumen: 413000, compras: 40, cuotaCompras: 40 / 3907, cuotaImpresiones: 0.0003 },
  ]
  const mes = historial.filter((f) => f.desde === '2026-10-01')
  ok('sin historial, la evolución da una caída falsa', tareasDeLaCuenta(entrada(mes, { evolucion })).some((x) => x.tipo === 'caida'))
  ok('con historial (cesta fija), no hay caída', !tareasDeLaCuenta(entrada(mes, { evolucion, historial })).some((x) => x.tipo === 'caida'))
  const bajando = [...base('2026-09-01', 20), ...base('2026-10-01', 4)]
  ok('y si de verdad cae en la cesta, sí', tareasDeLaCuenta(entrada(bajando.filter((f) => f.desde === '2026-10-01'), { historial: bajando })).some((x) => x.tipo === 'caida' && x.detalle.includes('siempre las mismas')))
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
