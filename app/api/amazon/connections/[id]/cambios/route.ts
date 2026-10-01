import { NextResponse } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * CUÁNTOS CAMBIOS LE HEMOS ENVIADO A ESTA CONEXIÓN.
 *
 * Un solo número, y existe para una sola frase: la del diálogo de desconectar
 * una cuenta, que promete «se conservan N cambios registrados». Esa promesa es
 * comprobable y «no se borra el historial» es una frase que hay que creerse, así
 * que el número se mantiene — lo que cambia es cuándo se pregunta.
 *
 *
 * ============ POR QUÉ YA NO VIENE CON LA PANTALLA ============
 *
 * Venía dentro de loadAmazonData, o sea un COUNT exacto por conexión en CADA
 * carga de Amazon API. Entrais tiene 268.610 filas en amazon_submissions y ese
 * contador suyo costaba 1.963 ms medidos contra producción, de los 6.182 que
 * tardaba la pantalla entera en devolver una línea de HTML. Todo eso para una
 * frase que solo se lee si alguien va a desconectar una cuenta, que es algo que
 * pasa muy de tarde en tarde.
 *
 * Ahora se paga aquí, cuando de verdad se va a leer.
 *
 *
 * ============ SIGUE SIENDO UN COUNT EXACTO ============
 *
 * Y tiene que serlo: es el número que se le enseña a alguien justo antes de
 * decidir si desconecta una cuenta. Un «unos 270.000» en esa frase no vale para
 * nada. El índice idx_amazon_submissions_conexion (migración 118) lo cubre.
 */
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    if (!UUID.test(params.id)) return fail(400, 'Esa conexión no existe')

    const sesion = await requireAmazonAdmin()
    if (sesion instanceof NextResponse) return sesion

    const service = createServiceClient()
    const { count, error } = await service
      .from('amazon_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('connection_id', params.id)

    if (error) throw error
    return NextResponse.json({ cambios: count ?? 0 })
  } catch (error) {
    return errorResponse(error, 'No se ha podido contar el histórico de cambios')
  }
}
