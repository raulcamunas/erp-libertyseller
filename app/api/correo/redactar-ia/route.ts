import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail } from '@/lib/amazon/api'
import { contextoParaIa, tipoDeLead } from '@/lib/correo/ia-contexto'
import { redactarConIa } from '@/lib/correo/ia-generar'
import { resolverConfiguracion } from '@/lib/correo/ia-laboratorio-servidor'
import { construirMensajes } from '@/lib/correo/ia-prompt'
import {
  LIMITE_POR_DIA,
  LIMITE_POR_HORA,
  cargarCorreosDelLead,
  cargarGanadores,
  cargarLead,
  cargarLlamadas,
  cargarNotas,
  direccionesDeLead,
  guardarBorrador,
  redaccionesRecientes,
} from '@/lib/correo/ia-servidor'
import { SIN_CACHE, requerirCorreo, respuestaDeFallo, textoDe } from '@/lib/correo/rutas'
import { autorizarBuzon } from '@/lib/correo/servidor'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * REDACTAR CON IA EL CORREO A UN LEAD DE COLD CALLING.
 *
 * POST application/json:
 *   leadId       el lead al que se escribe. Se lee con la SESIÓN de quien pide: si no es suyo ni supervisa, no existe para él
 *   buzonId      el buzón desde el que va a salir (propio: de él se sacan los correos que ya se cruzaron con ese lead)
 *   indicaciones (opcional) lo que quiere que diga o cambie: «más corto», «menciona que le llamé»…
 *   anterior     (opcional) { asunto, texto } del borrador que quiere cambiar
 *   versionId    (opcional) la versión de la IA del primer borrador de este correo: al redactar de nuevo se mantiene (ver más abajo)
 *
 * Devuelve { ok, id, versionId, asunto, texto, angulo, ejemplos, aviso }. `id` es el del registro del borrador (null si la migración 242 no está
 * lanzada): el cuadro de correo lo manda de vuelta al enviar para apuntar lo que salió de verdad.
 *
 * LA VERSIÓN. Cada borrador lo escribe una VERSIÓN de la IA (Mi rendimiento → Configuración de la IA): se sortea entre las que están en
 * marcha, en proporción a su peso, y queda apuntada. El comercial no la elige ni la ve; el cuadro de correo se limita a devolverla en
 * `versionId` cuando pide redactar de nuevo el mismo correo, para que la comparación entre versiones sea limpia (si pudiera redactar hasta
 * que le saliera la que le gusta, estaría eligiendo). Sin versiones (migración 243 sin lanzar, o ninguna en marcha) se usa la configuración
 * de siempre.
 *
 * La IA NUNCA recibe la facturación ni las ventas estimadas del lead, ni sus teléfonos y correos (lib/correo/ia-contexto.ts), y lo que
 * devuelve se descarta si habla de dinero (lib/correo/ia-generar.ts). El error de la IA nunca se reenvía tal cual a la pantalla:
 * sale una frase ya escrita.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 90

export async function POST(request: NextRequest) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion

  let cuerpo: Record<string, unknown>
  try {
    cuerpo = ((await request.json()) ?? {}) as Record<string, unknown>
  } catch {
    return fail(400, 'No se ha entendido lo que se ha mandado')
  }
  const leadId = typeof cuerpo.leadId === 'string' && UUID.test(cuerpo.leadId) ? cuerpo.leadId.toLowerCase() : null
  if (!leadId) return fail(400, 'Falta el lead al que se escribe.')
  const indicaciones = textoDe(cuerpo.indicaciones, 600)
  const previo = (cuerpo.anterior ?? null) as { asunto?: unknown; texto?: unknown } | null
  const asuntoPrevio = textoDe(previo?.asunto, 200)
  const textoPrevio = textoDe(previo?.texto, 3000)
  const anterior = asuntoPrevio && textoPrevio ? { asunto: asuntoPrevio, texto: textoPrevio } : null
  const versionPedida = typeof cuerpo.versionId === 'string' && UUID.test(cuerpo.versionId) ? cuerpo.versionId.toLowerCase() : null

  try {
    const service = createServiceClient()
    const auth = await autorizarBuzon(service, sesion, cuerpo.buzonId, 'escribir')
    if (!auth.ok) return fail(auth.estado, auth.mensaje)

    const uso = await redaccionesRecientes(service, sesion.userId)
    if (uso && (uso.hora >= LIMITE_POR_HORA || uso.dia >= LIMITE_POR_DIA)) {
      return fail(429, uso.hora >= LIMITE_POR_HORA ? `Has pedido ${LIMITE_POR_HORA} borradores en la última hora: espera un rato para pedir más.` : `Has llegado al límite de ${LIMITE_POR_DIA} borradores de hoy.`)
    }

    const lead = await cargarLead(sesion.supabase, leadId)
    if (!lead) return fail(404, 'No se encuentra ese lead, o no es tuyo.')

    const [notas, llamadas, correos, ganadores] = await Promise.all([
      cargarNotas(sesion.supabase, leadId),
      cargarLlamadas(sesion.supabase, leadId),
      cargarCorreosDelLead(service, auth.buzon.id, direccionesDeLead(lead)),
      cargarGanadores(service),
    ])

    // Con qué se escribe este borrador: las instrucciones, los ejemplos y el modelo de la versión que toca (o los de siempre)
    const configuracion = await resolverConfiguracion(service, { versionPedida, tipo: tipoDeLead(lead), ganadores })
    const ejemplos = configuracion.ejemplos
    const mensajes = construirMensajes({
      instrucciones: configuracion.instrucciones,
      contexto: contextoParaIa({ lead, notas, llamadas, correos, ahora: Date.now() }),
      ejemplos,
      indicaciones,
      anterior,
      miNombre: auth.buzon.nombre,
      tieneFirma: Boolean(auth.buzon.firma?.trim()),
    })

    const resultado = await redactarConIa(mensajes, configuracion.modelo ? { modelo: configuracion.modelo } : {})
    // Qué se ha gastado y con qué, sin el texto: es contenido de un lead y de un correo
    console.log('[correo-ia] redacción', { modelo: resultado.modelo, version: configuracion.version?.nombre ?? null, ok: resultado.borrador !== null, llamadas: resultado.llamadas, tokens: resultado.tokens, ejemplos: ejemplos.length, notas: notas.length, correos: correos.length })
    if (!resultado.borrador) return fail(resultado.problemas.includes('dinero') ? 422 : 503, resultado.aviso ?? 'No se ha podido redactar el correo.')

    const id = await guardarBorrador(service, {
      user_id: sesion.userId,
      lead_id: leadId,
      buzon_id: auth.buzon.id,
      modelo: resultado.modelo,
      angulo: resultado.borrador.angulo,
      asunto: resultado.borrador.asunto,
      texto: resultado.borrador.texto,
      indicaciones,
      ejemplos: ejemplos.length,
      version_id: configuracion.version?.id ?? null,
    })
    return NextResponse.json(
      { ok: true, id, versionId: configuracion.version?.id ?? null, asunto: resultado.borrador.asunto, texto: resultado.borrador.texto, angulo: resultado.borrador.angulo, ejemplos: ejemplos.length, aviso: resultado.aviso },
      { headers: SIN_CACHE }
    )
  } catch (error) {
    return respuestaDeFallo('Correo · redactar con IA: fallo', error)
  }
}
