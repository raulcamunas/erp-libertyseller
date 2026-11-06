import { NextResponse } from 'next/server'
import { exigirAdmin } from '@/lib/facturacion/acceso'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Lo último que se ha hecho desde Facturación: quién, cuándo y qué salió */
export async function GET() {
  const permiso = await exigirAdmin()
  if (!permiso.ok) return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })

  const { data, error } = await createServiceClient()
    .from('facturacion_registro')
    .select('id, tipo, numero, cliente, importe, moneda, detalle, hecho_por_nombre, creado_en')
    .order('creado_en', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ error: 'Falta lanzar la migración 272 para tener el registro.' }, { status: 503 })
  return NextResponse.json({ filas: data ?? [] })
}
