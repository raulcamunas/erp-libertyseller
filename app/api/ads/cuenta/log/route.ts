import { NextResponse, type NextRequest } from 'next/server'
import { leerEntrada, leerLogPaginado, personasDelLog } from '@/lib/ads/log'
import { UUID } from '@/lib/amazon/api'
import { cursorDeTexto, filtrosDeParametros, logACsv } from '@/lib/ads/log-calculo'
import { abrirCuenta, errorDeRuta } from '@/lib/ads/ruta'

/**
 * EL LOG DE CAMBIOS de una cuenta. Quien lleva la cuenta.
 *
 *   GET ?perfilId=&desde=&hasta=&campaignId=&productoId=&usuarioId=&propuestaId=&origen=&fallos=1&q=&cursor=&porPagina=
 *       → { entradas, siguiente }   una página, por CURSOR (no se salta ni repite filas aunque entren cambios mientras se mira)
 *   … &formato=csv                  → el CSV de TODO lo filtrado (hasta 20.000 filas), para Excel o el Sheets del cliente
 *   … &formato=todo                 → todas las entradas filtradas (hasta 5.000) en JSON: «Copiar para el Log del cliente» del rango entero, no solo lo cargado
 *   … &detalle=1                    → con la petición y la respuesta de Amazon de cada entrada (pesan; solo para abrir el detalle)
 *   GET ?perfilId=&personas=1        → las personas que aparecen en el log (filtro «Persona»)
 *   GET ?perfilId=&entrada=<id>      → una entrada con su petición y su respuesta de Amazon
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams
    const a = await abrirCuenta(p.get('perfilId'))
    if (a instanceof NextResponse) return a
    if (p.get('personas') === '1') return NextResponse.json({ personas: await personasDelLog(a.cuenta.id) })
    const entrada = p.get('entrada')
    if (entrada && UUID.test(entrada)) return NextResponse.json({ entrada: await leerEntrada(a.cuenta.id, entrada) })

    const filtros = filtrosDeParametros(p)
    const formato = p.get('formato')

    if (formato === 'csv' || formato === 'todo') {
      const tope = formato === 'csv' ? 20_000 : 5_000
      const todas = []
      let cursor = null
      do {
        const pagina = await leerLogPaginado(a.cuenta.id, filtros, cursor, 1000, false)
        todas.push(...pagina.entradas)
        cursor = cursorDeTexto(pagina.siguiente)
      } while (cursor && todas.length < tope)
      if (formato === 'todo') return NextResponse.json({ entradas: todas.slice(0, tope), cortado: Boolean(cursor) })
      const nombre = `log-ppc-${a.cuenta.id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`
      return new NextResponse(logACsv(todas.slice(0, tope)), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nombre}"`, 'Cache-Control': 'no-store' },
      })
    }

    const porPagina = Math.min(Math.max(Number(p.get('porPagina')) || 50, 10), 200)
    const pagina = await leerLogPaginado(a.cuenta.id, filtros, cursorDeTexto(p.get('cursor')), porPagina, p.get('detalle') === '1')
    return NextResponse.json(pagina)
  } catch (error) {
    return errorDeRuta(error, 'Ads: leer el log')
  }
}
