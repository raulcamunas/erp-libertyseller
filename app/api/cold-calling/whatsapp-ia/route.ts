import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail, requireAppAccess } from '@/lib/amazon/api'
import { cargarLead, cargarLlamadas, cargarNotas } from '@/lib/correo/ia-servidor'
import { SIN_CACHE, respuestaDeFallo, textoDe } from '@/lib/correo/rutas'
import { createServiceClient } from '@/lib/supabase/service'
import { leerCuerpoConTope } from '@/lib/subidas-limite'
import { escribirMensaje } from '@/lib/whatsapp/ia-escribir'
import { perfilEnProduccion } from '@/lib/whatsapp/ia-laboratorio-servidor'
import { pedirPermiso } from '@/lib/whatsapp/ia-limite'
import { LEAD_SIN_WHATSAPP, esSituacionDeWhatsapp, nombreDePila } from '@/lib/whatsapp/mensajes'

/**
 * ESCRIBIR CON IA EL WHATSAPP A UN LEAD DE COLD CALLING.
 *
 * POST application/json:
 *   leadId       el lead al que se escribe. Se lee con la SESIÓN de quien pide: si no es suyo ni supervisa, no existe para él
 *   situacion    (opcional) primer_contacto, no_contesta o tras_hablar. Sin ella, la que toca según el estado del lead
 *   indicaciones (opcional) lo que quiere que diga o cambie: «más corto», «menciona que le llamé»…
 *   anterior     (opcional) el mensaje que quiere cambiar
 *
 * Devuelve { ok, mensaje, base, aviso }. `base` es en qué del historial se ha apoyado la IA (para que el comercial lo pueda comprobar); `aviso`, algo que
 * conviene mirar antes de abrir WhatsApp (un hueco por rellenar, un mensaje largo…). El error de la IA nunca se reenvía tal cual a la pantalla: sale
 * una frase ya escrita.
 *
 * QUIÉN. Quien tiene la app Cold Calling (o un admin): la misma puerta que la pantalla desde la que se pide. La IA lee lo MISMO que cuando redacta un
 * correo (lib/correo/ia-contexto.ts): nunca la facturación ni las ventas estimadas del lead, ni sus teléfonos y correos; y lo que devuelve se descarta si
 * habla de dinero (lib/whatsapp/ia-revision.ts). No se guarda nada: el mensaje solo queda apuntado si el comercial abre WhatsApp con él (en el navegador).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_BYTES_CUERPO = 4096

export async function POST(request: NextRequest) {
  const sesion = await requireAppAccess('cold-calling')
  if (sesion instanceof NextResponse) return sesion

  const cuerpoLeido = await leerCuerpoConTope(request, MAX_BYTES_CUERPO)
  if (cuerpoLeido instanceof NextResponse) return cuerpoLeido
  let cuerpo: Record<string, unknown>
  try {
    cuerpo = (JSON.parse(cuerpoLeido.texto) ?? {}) as Record<string, unknown>
  } catch {
    return fail(400, 'No se ha entendido lo que se ha mandado')
  }
  const leadId = typeof cuerpo.leadId === 'string' && UUID.test(cuerpo.leadId) ? cuerpo.leadId.toLowerCase() : null
  if (!leadId) return fail(400, 'Falta el lead al que se escribe.')
  const indicaciones = textoDe(cuerpo.indicaciones, 300)
  const anterior = textoDe(cuerpo.anterior, 1200)

  try {
    const permiso = pedirPermiso(sesion.userId)
    if (!permiso.permitido) return fail(429, permiso.motivo)

    const lead = await cargarLead(sesion.supabase, leadId)
    if (!lead) return fail(404, 'No se encuentra ese lead, o no es tuyo.')
    if (LEAD_SIN_WHATSAPP.has(String(lead.status))) return fail(409, 'Este lead consta como «No le interesa»: no se le escribe.')

    const [notas, llamadas, miPerfil] = await Promise.all([
      cargarNotas(sesion.supabase, leadId),
      cargarLlamadas(sesion.supabase, leadId),
      sesion.supabase.from('profiles').select('full_name, email').eq('id', sesion.userId).maybeSingle(),
    ])
    const miNombre = nombreDePila((miPerfil.data as { full_name?: string | null } | null)?.full_name, (miPerfil.data as { email?: string | null } | null)?.email)

    // Con qué configuración se escribe: la que haya publicada en la pantalla «Configuración de la IA», o la de serie (nunca falla: ver perfilEnProduccion)
    const { perfil, version } = await perfilEnProduccion(createServiceClient())
    const salida = await escribirMensaje({
      perfil,
      lead,
      notas,
      llamadas,
      situacion: esSituacionDeWhatsapp(cuerpo.situacion) ? cuerpo.situacion : null,
      miNombre,
      indicaciones,
      anterior,
    })
    const { resultado } = salida
    // Qué se ha gastado y con qué, sin el texto: es contenido de un lead
    console.log('[whatsapp-ia] mensaje', { modelo: resultado.modelo, version: version?.nombre ?? 'de serie', momento: salida.situacion, ok: resultado.mensaje !== null, llamadas: resultado.llamadas, ms: salida.ms, tokens: resultado.tokens, coste: salida.coste, notas: notas.length, conversaciones: llamadas.length })
    if (!resultado.mensaje) return fail(resultado.problemas.includes('dinero') ? 422 : 503, resultado.aviso ?? 'No se ha podido escribir el mensaje.')

    return NextResponse.json({ ok: true, mensaje: resultado.mensaje.mensaje, base: resultado.mensaje.base, aviso: resultado.aviso, maxPalabras: salida.maxPalabras }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo('Cold Calling · WhatsApp con IA: fallo', error)
  }
}
