import { NextResponse, type NextRequest } from 'next/server'
import { cuentaAuditada, hayAuditoriaEnCurso, MERCADO_AUDITADO } from '@/lib/auditor-stock/auditar'
import { detalleDe, listarAuditorias } from '@/lib/auditor-stock/consulta'
import { enlaceConSesion } from '@/lib/trafico/acceso'

/**
 * EL AUDITOR DE STOCK PARA EL CLIENTE (enlace con clave, migración 323). Lo mismo que lee la pantalla del ERP —la lista de auditorías y el detalle de una—, SOLO LEER:
 * desde aquí no se lanza ninguna auditoría ni se toca la tienda. El cliente y el país no llegan de fuera: el auditor es de una sola cuenta.
 *   POST { accion: 'lista' } · { accion: 'detalle', id }
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const e = await enlaceConSesion(request, params.token, 'stock')
    if (e === null) return NextResponse.json({ error: 'Este enlace no existe o ya no está activo.' }, { status: 404 })
    if (e === 'clave') return NextResponse.json({ error: 'Hace falta la clave.' }, { status: 401 })
    const body = (await request.json().catch(() => ({}))) as { accion?: string; id?: string }
    const cuenta = await cuentaAuditada()
    if ('error' in cuenta) return NextResponse.json({ error: cuenta.error }, { status: 404 })
    if (body.accion === 'lista') return NextResponse.json({ ok: true, enCurso: hayAuditoriaEnCurso(), lista: await listarAuditorias(cuenta.connectionId, MERCADO_AUDITADO) }, { headers: { 'Cache-Control': 'no-store' } })
    if (body.accion === 'detalle') {
      const id = (body.id ?? '').trim()
      if (!UUID.test(id)) return NextResponse.json({ error: 'Auditoría no válida.' }, { status: 400 })
      const d = await detalleDe(cuenta.connectionId, id)
      if (!d) return NextResponse.json({ error: 'No existe esa auditoría.' }, { status: 404 })
      return NextResponse.json({ ok: true, ...d }, { headers: { 'Cache-Control': 'no-store' } })
    }
    return NextResponse.json({ error: 'Acción desconocida.' }, { status: 400 })
  } catch (err) {
    console.error('[stock-cliente]', err)
    return NextResponse.json({ error: 'No se han podido leer los datos. Prueba otra vez en un momento.' }, { status: 500 })
  }
}
