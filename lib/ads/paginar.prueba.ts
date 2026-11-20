import { CODIGO_TOPE_DE_FILAS, todasLasFilas, trozos } from './paginar'
import { sumaDeVentas } from './agente/contexto-servidor'
import type { VentaDeAsin } from './ventas-totales'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** Una «tabla» de mentira de `n` filas que se sirve por páginas como PostgREST (.range(a, b), ambos incluidos) */
const tabla = (n: number) => {
  const filas = Array.from({ length: n }, (_, i) => ({ i }))
  let llamadas = 0
  return { pagina: async (a: number, b: number) => (llamadas++, { data: filas.slice(a, b + 1), error: null }), llamadas: () => llamadas }
}

async function main() {
  console.log('\n=== todasLasFilas ===')
  {
    const t = tabla(1500)
    const r = await todasLasFilas(t.pagina)
    ok('1.500 filas se leen enteras en 2 páginas', r.data.length === 1500 && r.error === null && t.llamadas() === 2, `${r.data.length} en ${t.llamadas()}`)
  }
  {
    const r = await todasLasFilas(tabla(3000).pagina, 2000)
    ok('sin lanzarAlTope, al tope devuelve lo leído sin error (lo de siempre)', r.data.length === 2000 && r.error === null)
  }
  {
    const r = await todasLasFilas(tabla(3000).pagina, { tope: 2000, lanzarAlTope: true })
    ok('con lanzarAlTope, al llegar al tope con más filas → error «incompleta»', r.error !== null && r.error.code === CODIGO_TOPE_DE_FILAS && /incompleta/i.test(r.error.message ?? ''), JSON.stringify(r.error))
  }
  {
    const r = await todasLasFilas(tabla(1500).pagina, { tope: 2000, lanzarAlTope: true })
    ok('con lanzarAlTope y menos filas que el tope → sin error', r.error === null && r.data.length === 1500)
  }
  {
    const r = await todasLasFilas(async () => ({ data: null, error: { code: 'X', message: 'falla' } }))
    ok('un error de la base se propaga', r.error?.code === 'X')
  }

  console.log('\n=== ventas totales de 1.500 ASIN (A5) ===')
  {
    // Antes: `.limit(5000)` con max_rows = 1.000 → 1.000 ASIN y una suma corta. Paginado, salen los 1.500
    const filas: VentaDeAsin[] = Array.from({ length: 1500 }, (_, i) => ({ asin: `B0${String(i).padStart(8, '0')}`, ventas: 10, unidades: 1, pedidos: 1, sesiones: 5, moneda: 'EUR' }))
    const r = await todasLasFilas(async (a: number, b: number) => ({ data: filas.slice(a, b + 1), error: null }), { tope: 100_000, lanzarAlTope: true })
    const porAsin = Object.fromEntries(r.data.map((v) => [v.asin, v]))
    ok('la suma de 1.500 ASIN a 10 € es 15.000 (no 10.000)', sumaDeVentas(porAsin) === 15_000, String(sumaDeVentas(porAsin)))
    // Con error de lectura, ventasTotales lanza y ventasTotalesDeCuenta deja la ventana vacía → la suma es null, nunca una parcial
    ok('ventana vacía (lectura fallida) → null', sumaDeVentas({}) === null)
  }

  console.log('\n=== trozos ===')
  {
    const t = trozos(Array.from({ length: 250 }, (_, i) => String(i)), 100)
    ok('250 ids salen en 3 lotes (100, 100, 50)', t.length === 3 && t[0].length === 100 && t[2].length === 50)
    ok('lista vacía → ningún lote', trozos([]).length === 0)
  }

  console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
  process.exit(fallos === 0 ? 0 : 1)
}
void main()
