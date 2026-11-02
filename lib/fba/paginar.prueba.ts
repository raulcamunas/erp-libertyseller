import { leerTodo } from '@/lib/fba/paginar'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** Una «base» de mentira que, como Supabase, nunca devuelve más de `tope` filas por consulta */
function baseConTope(total: number, tope = 1000, falla?: number) {
  const llamadas: Array<[number, number]> = []
  const construir = (desde: number, hasta: number) => {
    llamadas.push([desde, hasta])
    if (falla !== undefined && llamadas.length === falla) return Promise.resolve({ data: null, error: { code: '57014' } })
    const fin = Math.min(hasta, desde + tope - 1, total - 1)
    const filas = Array.from({ length: Math.max(0, fin - desde + 1) }, (_, i) => ({ n: desde + i }))
    return Promise.resolve({ data: filas, error: null })
  }
  return { construir, llamadas }
}

async function main() {
  console.log('\n=== lo que pasaba: una sola consulta se queda en 1.000 ===')
  {
    const { construir } = baseConTope(3130)
    const r = await construir(0, 99999)
    ok('sin paginar, Opinas (3.130 movimientos) devolvía solo 1.000', (r.data as unknown[]).length === 1000)
  }

  console.log('\n=== leerTodo trae todas ===')
  for (const total of [0, 1, 999, 1000, 1001, 2000, 3130, 6266]) {
    const { construir, llamadas } = baseConTope(total)
    const filas = await leerTodo<{ n: number }>(construir)
    const sinRepetidas = new Set(filas.map((f) => f.n)).size === filas.length
    const enOrden = filas.every((f, i) => f.n === i)
    ok(`${total} filas -> salen ${total}, sin repetir y en orden`, filas.length === total && sinRepetidas && enOrden, `salieron ${filas.length}`)
    // Con un total justo múltiplo de la página hace falta una consulta más para saber que no hay más
    ok(`${total} filas -> ${llamadas.length} consultas`, llamadas.length === Math.floor(total / 1000) + 1)
  }

  console.log('\n=== un fallo a mitad se dice, no se queda a medias ===')
  {
    const { construir } = baseConTope(3130, 1000, 2)
    let error: unknown = null
    try {
      await leerTodo(construir)
    } catch (e) {
      error = e
    }
    ok('si falla el segundo tramo, lanza el error (no devuelve 1.000 filas como si fueran todas)', (error as { code?: string } | null)?.code === '57014')
  }

  console.log('\n=== páginas de otro tamaño ===')
  {
    const { construir } = baseConTope(25, 10)
    const filas = await leerTodo<{ n: number }>(construir, 10)
    ok('25 filas de 10 en 10 -> 25', filas.length === 25)
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
