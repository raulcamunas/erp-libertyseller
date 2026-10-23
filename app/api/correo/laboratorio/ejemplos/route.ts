import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { crearEjemplo } from '@/lib/correo/ia-laboratorio-servidor'
import { leerJson, requerirConfigCorreos, respuestaDeFalloDeConfiguracion } from '@/lib/correo/laboratorio-rutas'
import { SIN_CACHE } from '@/lib/correo/rutas'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LOS CORREOS DE EJEMPLO PROPIOS (los «textos ganadores» candidatos).
 *
 * POST { titulo?, asunto, texto, tipo?, nota? }  guarda un ejemplo nuevo. Devuelve también AVISOS (habla de dinero, tiene huecos, lleva un
 * correo o un teléfono) que no impiden guardarlo pero que quien lo escribe debe saber: a la IA le llegará limpio.
 * Los ejemplos se LEEN con GET /api/correo/laboratorio/versiones, junto a las versiones que los eligen.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const sesion = await requerirConfigCorreos()
  if (sesion instanceof NextResponse) return sesion
  const cuerpo = await leerJson(request)
  if (!cuerpo) return fail(400, 'No se ha entendido lo que se ha mandado')
  try {
    const r = await crearEjemplo(createServiceClient(), cuerpo, sesion.userId)
    if (!r.ok) return fail(r.estado, r.error)
    return NextResponse.json({ ok: true, ejemplo: { ...r.valor, bloqueado: false }, avisos: r.avisos }, { status: 201, headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloDeConfiguracion('Correo · ejemplos: fallo al crear', error)
  }
}
