import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { SIN_CACHE, registrar, requerirCorreo } from '@/lib/correo/rutas'
import { almacenDeSecuencias } from '@/lib/correo/secuencias/almacen'
import { dentroDelLimite } from '@/lib/correo/secuencias/rutas'
import { analizarContenido } from '@/lib/correo/verificacion/contenido'
import { resolvedorDeProduccion } from '@/lib/correo/verificacion/dns'
import { combinarConLoSabido } from '@/lib/correo/verificacion/pago'
import { loQueSeSabeAntesDeEnviar } from '@/lib/correo/verificacion/pago-servidor'
import { verificarDirecciones } from '@/lib/correo/verificacion/verificar'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * ¿ES UN BUEN CORREO? LA COMPROBACIÓN ANTES DE ENVIAR.
 *
 * POST application/json  { direcciones: string[] (hasta 10), asunto?: string, texto?: string, esRespuesta?: boolean }
 *
 * Contesta `{ ok, direcciones: [{ direccion, nivel: 'buena'|'dudosa'|'mala', motivo, sugerencia, sinComprobar, rebotada, bloquea, verificada }], contenido: { puntos, nivel, avisos } | null }`.
 *
 *   · Las direcciones se miran por cómo están escritas, por si ya rebotaron antes (la memoria del ERP) y por si su dominio existe y recibe correo (DNS).
 *   · Si la verificación con MillionVerifier está encendida, se añade lo que YA se sabe de ellas (lo guardado de comprobaciones anteriores), sin preguntar nada
 *     nuevo: preguntar mientras se teclea gastaría créditos en cada errata. `bloquea` dice que el envío no saldría; `verificada`, que ya se comprobó con el servicio.
 *   · El contenido se mira por lo que hace que un correo acabe en spam. Solo si se manda el texto.
 *
 * NUNCA bloquea por sí sola: es información para quien envía (quien bloquea es /api/correo/enviar). Si el DNS, la memoria o lo guardado fallan, la dirección sigue su
 * camino (sin comprobar): esta ruta nunca puede dejar a nadie sin poder enviar un correo.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(request: NextRequest) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion
  if (!dentroDelLimite(`verificar:${sesion.userId}`, 90)) return fail(429, 'Demasiadas comprobaciones seguidas. Espera un momento.')

  let cuerpo: Record<string, unknown>
  try {
    cuerpo = ((await request.json()) ?? {}) as Record<string, unknown>
  } catch {
    return fail(400, 'No se ha entendido lo que se ha mandado')
  }
  const direcciones = Array.isArray(cuerpo.direcciones) ? cuerpo.direcciones.filter((d): d is string => typeof d === 'string').slice(0, 10).map((d) => d.slice(0, 320)) : []
  const asunto = typeof cuerpo.asunto === 'string' ? cuerpo.asunto.slice(0, 500) : null
  const texto = typeof cuerpo.texto === 'string' ? cuerpo.texto.slice(0, 60_000) : null
  if (direcciones.length === 0 && texto === null) return fail(400, 'No hay nada que comprobar.')

  const service = createServiceClient()
  const almacen = almacenDeSecuencias(service)
  let veredictos: Awaited<ReturnType<typeof verificarDirecciones>> = []
  if (direcciones.length > 0) {
    try {
      veredictos = await verificarDirecciones(direcciones, {
        resolvedor: resolvedorDeProduccion,
        // Sin la memoria (migración sin lanzar o la base sin contestar) se comprueba igual por escritura y por DNS
        memoria: async (ds) => {
          try {
            return await almacen.direccionesMalas(ds)
          } catch (error) {
            registrar('Correo · verificar: memoria de direcciones', error)
            return new Map()
          }
        },
      })
    } catch (error) {
      registrar('Correo · verificar: direcciones', error)
    }
  }
  // Lo ya comprobado con el servicio de pago (si está encendido): solo se lee, no se gasta nada
  const saber = direcciones.length > 0 ? await loQueSeSabeAntesDeEnviar(service, direcciones) : null
  return NextResponse.json(
    {
      ok: true,
      direcciones: veredictos.map((v) =>
        combinarConLoSabido({ direccion: v.direccion, nivel: v.nivel, motivo: v.motivo, sugerencia: v.sugerencia, sinComprobar: v.sinComprobar, rebotada: v.rebotada !== null }, saber?.conocidas.get(v.direccion), saber?.dudosas ?? null)
      ),
      contenido: texto !== null ? analizarContenido({ asunto: asunto ?? '', texto, esRespuesta: cuerpo.esRespuesta === true }) : null,
    },
    { headers: SIN_CACHE }
  )
}
