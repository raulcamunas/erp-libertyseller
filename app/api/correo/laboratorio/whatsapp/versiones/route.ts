import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { leerJson, requerirConfigCorreos } from '@/lib/correo/laboratorio-rutas'
import { SIN_CACHE } from '@/lib/correo/rutas'
import { createServiceClient } from '@/lib/supabase/service'
import { vistaDeLosCasos } from '@/lib/whatsapp/ia-casos'
import { FALTA_MIGRACION_250, crearVersion, esFaltaDeLaMigracion250, listarVersiones, sembrarBase, type DatosDeVersion } from '@/lib/whatsapp/ia-laboratorio-servidor'
import { respuestaDeFalloDeWhatsapp, vistaDeLosModelos, vistaDeVersion } from '@/lib/whatsapp/ia-laboratorio-rutas'
import { PERFIL_DE_SERIE } from '@/lib/whatsapp/ia-perfil'

/**
 * LAS VERSIONES DE LA IA DE WHATSAPP (Configuración de la IA → WhatsApp).
 *
 * GET   todo lo que pinta la pantalla: las versiones, la configuración de serie, los casos de prueba y los modelos que se pueden elegir. La primera vez crea la versión original.
 *       Si falta la migración 250 NO falla: contesta con la frase que lo dice (`faltaMigracion`) y sin versiones, para que la pantalla siga sirviendo para probar (no para guardar).
 * POST  crea un borrador: { nombre, notas?, perfil }. Nace sin publicar: no lo usa nadie hasta que se publique. Duplicar una versión es crear otra con su perfil (lo hace la pantalla).
 *
 * Solo quien tenga la casilla «Configuración de la IA» (o sea administrador): lo que se cambia aquí lo usa todo el equipo.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const sesion = await requerirConfigCorreos()
  if (sesion instanceof NextResponse) return sesion
  try {
    let versiones: Awaited<ReturnType<typeof listarVersiones>> = []
    let faltaMigracion: string | null = null
    try {
      const service = createServiceClient()
      await sembrarBase(service, sesion.userId)
      versiones = await listarVersiones(service)
    } catch (error) {
      if (!esFaltaDeLaMigracion250(error)) throw error
      faltaMigracion = FALTA_MIGRACION_250
    }
    return NextResponse.json({ ok: true, versiones: versiones.map(vistaDeVersion), serie: PERFIL_DE_SERIE, casos: vistaDeLosCasos(), modelos: vistaDeLosModelos(), faltaMigracion }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloDeWhatsapp('WhatsApp · versiones: fallo al leer', error)
  }
}

export async function POST(request: NextRequest) {
  const sesion = await requerirConfigCorreos()
  if (sesion instanceof NextResponse) return sesion
  const cuerpo = await leerJson(request)
  if (!cuerpo) return fail(400, 'No se ha entendido lo que se ha mandado')
  try {
    const service = createServiceClient()
    const datos = cuerpo as unknown as DatosDeVersion
    const r = await crearVersion(service, datos, sesion.userId)
    if (!r.ok) return fail(r.estado, r.error)
    return NextResponse.json({ ok: true, version: vistaDeVersion(r.valor), avisos: r.avisos }, { status: 201, headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloDeWhatsapp('WhatsApp · versiones: fallo al crear', error)
  }
}
