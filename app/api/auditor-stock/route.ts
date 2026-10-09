import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, fail, requireAmazonAdmin, UUID } from '@/lib/amazon/api'
import { auditar, cuentaAuditada, hayAuditoriaEnCurso, MERCADO_AUDITADO } from '@/lib/auditor-stock/auditar'
import { detalleDe, listarAuditorias } from '@/lib/auditor-stock/consulta'

/**
 * AUDITOR DE STOCK · LO QUE USA LA PANTALLA.
 *
 *   lista     las auditorías recientes (sin el detalle) y si hay una en marcha.
 *   detalle   los SKU con stock de UNA auditoría, y lo que se movió respecto a la
 *             anterior.
 *   ahora     lanza una auditoría y CONTESTA EN SEGUIDA.
 *
 * El cliente y el país NO llegan de fuera: el auditor es de una sola cuenta y se
 * resuelve aquí. Un identificador de auditoría se busca SIEMPRE dentro de esa
 * conexión, así que no se puede pedir la de otra cuenta por su id.
 *
 * Solo admin, como todo lo de Amazon API y Growth Partner.
 *
 *
 * POR QUÉ «AHORA» NO ESPERA A QUE TERMINE
 * ---------------------------------------
 * Una auditoría son dos o tres minutos, y una petición HTTP abierta tanto tiempo
 * la corta cualquier proxy por el camino —en Precios Shoplamp se partió el envío
 * en tramos de cuarenta segundos por lo mismo—. Aquí se arranca y se contesta; la
 * pantalla pregunta por «lista» cada pocos segundos hasta que aparece la fila
 * nueva. El proceso del servidor sigue vivo después de contestar: es un Node
 * normal en un contenedor, no una función que se congela al responder.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as { accion?: string; id?: string }

    const cuenta = await cuentaAuditada()
    if ('error' in cuenta) return fail(404, cuenta.error)

    if (body.accion === 'lista') {
      const l = await listarAuditorias(cuenta.connectionId, MERCADO_AUDITADO)
      return NextResponse.json({ ok: true, enCurso: hayAuditoriaEnCurso(), lista: l })
    }

    if (body.accion === 'detalle') {
      const id = (body.id ?? '').trim()
      if (!UUID.test(id)) return fail(400, 'Auditoría no válida.')
      const d = await detalleDe(cuenta.connectionId, id)
      if (!d) return fail(404, 'No existe esa auditoría.')
      return NextResponse.json({ ok: true, ...d })
    }

    if (body.accion === 'ahora') {
      if (hayAuditoriaEnCurso()) {
        return NextResponse.json({ ok: true, iniciada: false, motivo: 'Ya hay una auditoría en marcha.' })
      }
      // Sin await a propósito: ver la cabecera.
      void auditar().catch((e) => console.error('[auditor-stock] la auditoría manual ha fallado:', e))
      return NextResponse.json({ ok: true, iniciada: true })
    }

    return fail(400, 'Acción desconocida.')
  } catch (error) {
    return errorResponse(error, 'Error en el auditor de stock')
  }
}
