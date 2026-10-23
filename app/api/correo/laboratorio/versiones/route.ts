import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { crearVersion, ejemplosBloqueados, listarEjemplos, listarVersiones, sembrarBase, usoDeVersiones, type DatosDeVersion } from '@/lib/correo/ia-laboratorio-servidor'
import { repartoEnPorcentaje } from '@/lib/correo/ia-version'
import { leerJson, requerirConfigCorreos, respuestaDeFalloDeConfiguracion } from '@/lib/correo/laboratorio-rutas'
import { SIN_CACHE } from '@/lib/correo/rutas'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LAS VERSIONES DE LA IA (Mi rendimiento → Configuración de correos).
 *
 * GET   todo lo que pinta la pantalla de versiones: las versiones con su uso y su porcentaje del reparto, y los ejemplos propios (con cuáles
 *       están bloqueados por una versión que ya ha escrito borradores). La primera vez crea la versión original.
 * POST  crea una versión nueva: { nombre, notas?, secciones, ejemplosIds?, usarGanadores?, modelo?, peso?, activa? }. Nace pausada y sin peso
 *       salvo que se pida otra cosa.
 *
 * Solo quien tenga la casilla «Configuración de correos» (o sea administrador): lo que se cambia aquí lo usa todo el equipo.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const sesion = await requerirConfigCorreos()
  if (sesion instanceof NextResponse) return sesion
  try {
    const service = createServiceClient()
    await sembrarBase(service, sesion.userId)
    const [versiones, ejemplos] = await Promise.all([listarVersiones(service), listarEjemplos(service)])
    const uso = await usoDeVersiones(service, versiones)
    const reparto = repartoEnPorcentaje(versiones)
    const bloqueados = ejemplosBloqueados(versiones, uso)
    return NextResponse.json(
      {
        ok: true,
        versiones: versiones.map((v) => ({
          ...v,
          generados: uso.get(v.id)?.generados ?? 0,
          enviados: uso.get(v.id)?.enviados ?? 0,
          // Con un solo borrador su contenido deja de poder cambiar (se duplica); la original, siempre
          usada: v.esBase || (uso.get(v.id)?.generados ?? 0) > 0,
          porcentaje: reparto.get(v.id) ?? 0,
        })),
        ejemplos: ejemplos.map((e) => ({ ...e, bloqueado: bloqueados.has(e.id) })),
      },
      { headers: SIN_CACHE }
    )
  } catch (error) {
    return respuestaDeFalloDeConfiguracion('Correo · versiones: fallo al leer', error)
  }
}

export async function POST(request: NextRequest) {
  const sesion = await requerirConfigCorreos()
  if (sesion instanceof NextResponse) return sesion
  const cuerpo = await leerJson(request)
  if (!cuerpo) return fail(400, 'No se ha entendido lo que se ha mandado')
  try {
    const r = await crearVersion(createServiceClient(), cuerpo as unknown as DatosDeVersion, sesion.userId)
    if (!r.ok) return fail(r.estado, r.error)
    return NextResponse.json({ ok: true, version: r.valor, avisos: r.avisos }, { status: 201, headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloDeConfiguracion('Correo · versiones: fallo al crear', error)
  }
}
