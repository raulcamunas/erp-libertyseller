import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { puedeEditar, requireFbaAccess } from '@/lib/fba/acceso'
import { FaltaLaMigracion, enlaceActivoDe, enlaceParaCopiar, revocarEnlace, rutaDelEnlace, type EnlaceDeEncaje } from '@/lib/fba/encaje-enlace'
import type { EstadoRemesa } from '@/lib/fba/flujo'
import { createServiceClient } from '@/lib/supabase/service'
import { urlBaseApp } from '@/lib/url-app'

/**
 * EL ENLACE PARA QUE EL CLIENTE ENCAJE SIN ENTRAR AL ERP: COPIARLO, VERLO Y DESACTIVARLO.
 *
 * GET     el enlace vivo de este envío, con cuántas veces se ha abierto y cuándo se tocó por última vez.
 * POST    el enlace para copiar: el que ya hay o, si no hay, uno nuevo. Solo en «Encajando».
 * DELETE  lo desactiva: quien lo tuviera deja de poder entrar.
 *
 * LAS TRES EXIGEN PODER EDITAR, también la de leer. El enlace es una credencial de ESCRITURA —con él
 * se cambian las cajas y se da por terminado el encaje—, así que dejar verlo a quien solo tiene acceso
 * de lectura sería darle por la puerta de atrás lo que el ERP le niega por la de delante.
 *
 * La dirección se monta con la URL base que decide el servidor (lib/url-app.ts), no con la cabecera de
 * quien llama: la que se copia tiene que ser siempre la del dominio de verdad.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

async function remesaYAcceso(id: string) {
  if (!UUID.test(id)) return { error: fail(400, 'Esa propuesta no existe') as NextResponse }
  const sesion = await requireFbaAccess('editar')
  if (sesion instanceof NextResponse) return { error: sesion }

  const { data } = await createServiceClient().from('fba_remesas').select('id, client_id, estado').eq('id', id).maybeSingle()
  if (!data) return { error: fail(404, 'Esa propuesta ya no existe') as NextResponse }
  const remesa = data as { id: string; client_id: string; estado: EstadoRemesa | null }
  // El mismo 404 que si no existiera: a quien no tiene acceso no se le confirma ni que exista
  if (!puedeEditar(sesion, remesa.client_id)) return { error: fail(404, 'Esa propuesta ya no existe') as NextResponse }
  return { remesa: { ...remesa, estado: (remesa.estado ?? 'cerrada') as EstadoRemesa }, sesion }
}

function aInfo(e: EnlaceDeEncaje) {
  return {
    url: `${urlBaseApp()}${rutaDelEnlace(e.token)}`,
    creadoAt: e.creadoAt,
    caducaAt: e.caducaAt,
    abiertoVeces: e.abiertoVeces,
    ultimoUsoAt: e.ultimoUsoAt,
    ultimaEdicionAt: e.ultimaEdicionAt,
    terminadoAt: e.terminadoAt,
  }
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const r = await remesaYAcceso(params.id)
    if (r.error) return r.error
    try {
      const e = await enlaceActivoDe(params.id)
      return NextResponse.json({ enlace: e ? aInfo(e) : null, sinMigrar: false }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      // Sin la migración no hay enlaces que enseñar: la pantalla lo avisa al intentar crear uno, no al mirar
      if (error instanceof FaltaLaMigracion) return NextResponse.json({ enlace: null, sinMigrar: true }, { headers: { 'Cache-Control': 'no-store' } })
      throw error
    }
  } catch (error) {
    return errorResponse(error, 'No se ha podido leer el enlace del cliente')
  }
}

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const r = await remesaYAcceso(params.id)
    if (r.error) return r.error
    if (r.remesa!.estado !== 'encajando') {
      return fail(409, 'El enlace para el cliente se genera cuando el envío está en «Encajando», que es cuando le toca a él.')
    }
    try {
      const e = await enlaceParaCopiar(params.id, r.sesion!.userId)
      return NextResponse.json({ enlace: aInfo(e) }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      if (error instanceof FaltaLaMigracion) return fail(503, error.message)
      throw error
    }
  } catch (error) {
    return errorResponse(error, 'No se ha podido crear el enlace del cliente')
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const r = await remesaYAcceso(params.id)
    if (r.error) return r.error
    try {
      const habia = await revocarEnlace(params.id)
      return NextResponse.json({ ok: true, habia }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      if (error instanceof FaltaLaMigracion) return fail(503, error.message)
      throw error
    }
  } catch (error) {
    return errorResponse(error, 'No se ha podido desactivar el enlace del cliente')
  }
}
