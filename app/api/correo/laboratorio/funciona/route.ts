import { NextResponse } from 'next/server'
import { cargarGanadores } from '@/lib/correo/ia-servidor'
import { requerirConfigCorreos, respuestaDeFalloDeConfiguracion } from '@/lib/correo/laboratorio-rutas'
import { SIN_CACHE } from '@/lib/correo/rutas'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LO QUE YA FUNCIONA: los correos fríos del equipo a los que un cliente de fuera contestó algo que no era un «no», tal como se le enseñan a
 * la IA (sin correos, teléfonos, nombres del equipo ni frases de dinero: lib/correo/ia-ejemplos.ts). Para que quien afina los correos vea
 * en qué se fija la IA y pueda copiar uno a sus ejemplos. Se recalcula cada 10 minutos.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const sesion = await requerirConfigCorreos()
  if (sesion instanceof NextResponse) return sesion
  try {
    const ganadores = await cargarGanadores(createServiceClient())
    return NextResponse.json({ ok: true, ejemplos: ganadores.map((g) => ({ id: g.hiloId, asunto: g.asunto, texto: g.texto, tipo: g.tipo, respondioEn: g.respondioEn })) }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloDeConfiguracion('Correo · lo que funciona: fallo', error)
  }
}
