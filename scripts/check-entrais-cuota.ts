/**
 * COMPROBACIÓN DE LA CUOTA Y LA CACHÉ DE ENTRAIS.
 *
 * Entrais admite CUATRO llamadas por hora a `/api/v1/Products`, y esas cuatro
 * se las reparten el ciclo de stock, el simulacro, el botón de probar y el
 * banco de pruebas. El contador que las reparte es de las pocas piezas de este
 * ERP donde un error de uno se paga caro en los dos sentidos:
 *
 *   contando de más -> el ciclo se queda sin llamadas y deja de mandar stock
 *                      sin que nadie lo pida
 *   contando de menos -> el 429 lo da su servidor, en una ejecución automática
 *                      que no tiene a nadie delante
 *
 * Aquí no se toca la red: `fetch` está sustituido por uno de mentira que cuenta
 * cuántas veces se le llama. Lo que se comprueba es el reparto, no su API.
 *
 *   npx tsx scripts/check-entrais-cuota.ts
 */

process.env.ENTRAIS_LOGIN = 'usuario-de-mentira'
process.env.ENTRAIS_PASSWORD_PRUEBAS = 'contrasena-de-mentira'
process.env.ENTRAIS_PASSWORD_REAL = 'otra-de-mentira'

let peticionesAlCatalogo = 0

const original = globalThis.fetch
globalThis.fetch = (async (url: string | URL | Request) => {
  const u = String(url)
  if (u.includes('/Login')) {
    return new Response('token-de-mentira', { status: 200 })
  }
  if (u.includes('/Products')) {
    peticionesAlCatalogo++
    return new Response(JSON.stringify([{ code: 1, description: 'UNO', stock: 1, price: 1 }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return new Response('no', { status: 404 })
}) as typeof fetch

async function main() {
  const { llamarEntraisDetalle, cuotaRestante, EntraisError } = await import('@/lib/entrais/api')

  let fallos = 0
  function comprobar(que: string, ok: boolean, detalle = '') {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${que}${detalle ? `  → ${detalle}` : ''}`)
    if (!ok) fallos++
  }

  const RUTA = '/api/v1/Products'

  /* ---------- 1. La primera llamada va a la API ---------- */
  const a = await llamarEntraisDetalle<unknown[]>('pruebas', RUTA)
  comprobar('la primera llama de verdad', !a.deCache && peticionesAlCatalogo === 1)
  comprobar('y descuenta de la cuota', a.cuota?.quedan === 3, `quedan ${a.cuota?.quedan}`)

  /* ---------- 2. La segunda sale de la caché, sin gastar ---------- */
  const b = await llamarEntraisDetalle<unknown[]>('pruebas', RUTA)
  comprobar('la segunda sale de la caché', b.deCache && peticionesAlCatalogo === 1)
  comprobar('y NO descuenta', b.cuota?.quedan === 3, `quedan ${b.cuota?.quedan}`)

  /* ---------- 3. Forzando frescura sí gasta ---------- */
  await llamarEntraisDetalle<unknown[]>('pruebas', RUTA, { frescuraMs: 0 })
  await llamarEntraisDetalle<unknown[]>('pruebas', RUTA, { frescuraMs: 0 })
  const d = await llamarEntraisDetalle<unknown[]>('pruebas', RUTA, { frescuraMs: 0 })
  comprobar('forzar gasta cuota', peticionesAlCatalogo === 4, `${peticionesAlCatalogo} peticiones`)
  comprobar('se agota exactamente en la cuarta', d.cuota?.quedan === 0, `quedan ${d.cuota?.quedan}`)

  /* ---------- 4. La quinta se para AQUÍ, sin molestar a su servidor ---------- */
  let paro = false
  let mensaje = ''
  try {
    await llamarEntraisDetalle<unknown[]>('pruebas', RUTA, { frescuraMs: 0 })
  } catch (e) {
    paro = e instanceof EntraisError && e.estado === 429
    mensaje = e instanceof Error ? e.message : ''
  }
  comprobar('la quinta se para antes de llamar', paro && peticionesAlCatalogo === 4)
  comprobar('y el mensaje dice cuándo se libera', /se libera a las \d{2}:\d{2}/.test(mensaje))

  /* ---------- 5. Con la cuota agotada, la caché SIGUE sirviendo ---------- */
  const e5 = await llamarEntraisDetalle<unknown[]>('pruebas', RUTA)
  comprobar('sin cuota, la caché sigue respondiendo', e5.deCache && peticionesAlCatalogo === 4)

  /* ---------- 6. El otro entorno tiene su propia cuota ---------- */
  const f = await llamarEntraisDetalle<unknown[]>('real', RUTA, { frescuraMs: 0 })
  comprobar('pruebas y real no comparten cuota', f.cuota?.quedan === 3, `quedan ${f.cuota?.quedan}`)

  /* ---------- 7. Una ruta sin cuota no cuenta nada ---------- */
  comprobar('/Product/38265 no tiene cuota', cuotaRestante('pruebas', '/api/v1/Product/38265') === null)

  globalThis.fetch = original
  console.log(fallos === 0 ? '\nTodo correcto.' : `\n${fallos} comprobaciones han fallado.`)
  process.exit(fallos === 0 ? 0 : 1)

}

void main()
