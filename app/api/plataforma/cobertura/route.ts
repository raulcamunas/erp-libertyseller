import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import {
  FALTAN_MIGRACIONES,
  VENTANA_BSR_DIAS,
  VENTANA_INVENTARIO_DIAS,
  coberturaDe,
  faltaEsquema,
} from '@/lib/plataforma/pantallas'

/**
 * LA COBERTURA DE DATOS DE UN CLIENTE.
 *
 * Solo admin. UN cliente por petición, sin excepción: esta ruta devuelve
 * recuentos del catálogo de una tienda ajena, que es exactamente lo que el
 * compromiso ante Amazon obliga a mantener separado por cuenta.
 *
 * Es la pantalla que contesta «¿de qué análisis me puedo fiar?». Sin ella, A2 y
 * A4 dan un veredicto por SKU sin que nadie sepa que el 40 % del catálogo no
 * tiene ni dimensiones ni ranking, y un veredicto sobre datos que no están es
 * peor que no tener veredicto.
 *
 * El cálculo entero ocurre en Postgres (función plataforma_cobertura_a1 de la
 * migración 125). Aquí no se cuenta nada: contar «cuántos SKU tienen BSR» en
 * Node obligaría a traerse la serie entera —13.700 referencias × 30 días en
 * ShoesF— para contar valores distintos.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const clientId = request.nextUrl.searchParams.get('clientId') ?? ''
    if (!UUID.test(clientId)) return fail(400, 'Elige el cliente cuya cobertura quieres ver')

    const cobertura = await coberturaDe(clientId)

    return NextResponse.json({
      cobertura,
      // Las ventanas viajan a la pantalla para que pueda decir «con BSR de los
      // últimos 30 días» en vez de «con BSR». La diferencia importa: un SKU cuyo
      // último ranking es de febrero no está cubierto, está abandonado.
      ventanas: { bsrDias: VENTANA_BSR_DIAS, inventarioDias: VENTANA_INVENTARIO_DIAS },
      leidoAt: new Date().toISOString(),
    })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES)
    return errorResponse(error, 'Error calculando la cobertura de datos')
  }
}
