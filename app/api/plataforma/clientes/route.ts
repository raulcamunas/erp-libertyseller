import { NextResponse } from 'next/server'
import { errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { FALTAN_MIGRACIONES, clientesConIngesta, faltaEsquema } from '@/lib/plataforma/pantallas'

/**
 * EL SELECTOR DE CLIENTE DE LAS PANTALLAS DE A1.
 *
 * Solo admin, como todo lo que cuelga de este módulo. Y aquí importa igual que
 * en las demás: en middleware.ts todo lo que empieza por /api/ está en la lista
 * de rutas públicas, así que una ruta de API que no comprueba nada contesta a
 * cualquiera. requireAmazonAdmin() no es una formalidad.
 *
 *
 * ============ POR QUÉ ESTA VISTA MULTI-CLIENTE SÍ SE PUEDE ============
 *
 * El compromiso firmado ante Amazon (§2.1 de la especificación) prohíbe agregar,
 * cruzar o comparar datos entre clientes, «incluso para dashboards internos
 * anonimizados», y permite expresamente que una vista multi-cliente muestre
 * «métricas de cada cuenta por separado».
 *
 * Lo que devuelve esta ruta es exactamente eso, y además ni siquiera son datos
 * de negocio: son filas NUESTRAS de amazon_jobs y amazon_eventos —cuántos
 * trabajos hay en la cola de cada cliente, cuántas incidencias están abiertas—
 * más el nombre de sus cuentas conectadas. No hay ni un SKU, ni un precio, ni
 * una unidad vendida; no hay ninguna media del conjunto; y no hay ningún orden
 * que ponga a un cliente por delante de otro por sus cifras: es el orden manual
 * de `position` y luego alfabético, fijado dentro de la función SQL.
 *
 * Todo lo demás —catálogo, cobertura, series— cuelga de un clientId y devuelve
 * un solo cliente. Si algún día alguien pide «una tabla comparando la cobertura
 * de los dieciséis», eso NO se hace aquí ni en ningún sitio: hay que pararse y
 * decirlo.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const clientes = await clientesConIngesta()

    return NextResponse.json({ clientes, leidoAt: new Date().toISOString() })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES)
    return errorResponse(error, 'Error leyendo los clientes de la plataforma')
  }
}
