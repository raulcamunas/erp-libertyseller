import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail } from '@/lib/amazon/api'
import { cargarLead, cargarLlamadas, cargarNotas } from '@/lib/correo/ia-servidor'
import { leerJson, requerirConfigCorreos } from '@/lib/correo/laboratorio-rutas'
import { SIN_CACHE, textoDe } from '@/lib/correo/rutas'
import { createServiceClient } from '@/lib/supabase/service'
import { casosPedidos } from '@/lib/whatsapp/ia-casos'
import { leerVersion, perfilEnProduccion } from '@/lib/whatsapp/ia-laboratorio-servidor'
import { probarEnLote, type LeadRealParaProbar } from '@/lib/whatsapp/ia-laboratorio-prueba'
import { respuestaDeFalloDeWhatsapp } from '@/lib/whatsapp/ia-laboratorio-rutas'
import { LIMITES_DEL_LABORATORIO, delLaboratorio, pedirPermiso } from '@/lib/whatsapp/ia-limite'
import { validarPerfilDeWhatsapp, type PerfilDeWhatsapp } from '@/lib/whatsapp/ia-perfil'
import { esSituacionDeWhatsapp, nombreDePila } from '@/lib/whatsapp/mensajes'

/**
 * PROBAR LA IA DE WHATSAPP CON VARIOS CASOS A LA VEZ, SIN ENVIAR NI GUARDAR NADA.
 *
 * POST {
 *   perfil?         lo que hay en el editor AHORA, aunque no esté guardado (así se afina antes de guardar)
 *   versionId?      o una versión guardada
 *   enProduccion?   o la que usa el equipo ahora (para comparar con ella)
 *   casoIds?        hasta 12 casos de prueba inventados (lib/whatsapp/ia-casos.ts)
 *   leadId?         y/o un lead real (se lee con la SESIÓN de quien prueba: si no es suyo ni supervisa, 404)
 *   situacion?      solo con un lead real: fijar el momento (primer_contacto · no_contesta · tras_hablar)
 *   indicaciones?   lo que «pide el comercial» (se aplica a los casos que no traen la suya)
 *   anterior?       un mensaje que cambiar
 * }
 *
 * Devuelve las instrucciones que recibió la IA (en bloques con su origen) y, por cada caso, el mensaje, lo que tardó, lo que costó y lo que recibió además de las instrucciones.
 * Pasa por `escribirMensaje`, la misma función que usa la ruta de los comerciales: lo que se prueba es lo que se usa. Tiene su propio tope de pruebas por persona (200 a la hora),
 * aparte del de los comerciales. Quien prueba no manda nada a nadie: el mensaje no se guarda ni se apunta en ningún lead.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const MAX_CASOS = 12

export async function POST(request: NextRequest) {
  const sesion = await requerirConfigCorreos()
  if (sesion instanceof NextResponse) return sesion
  const cuerpo = await leerJson(request)
  if (!cuerpo) return fail(400, 'No se ha entendido lo que se ha mandado')

  const casos = casosPedidos(Array.isArray(cuerpo.casoIds) ? cuerpo.casoIds.slice(0, MAX_CASOS) : [])
  const leadId = typeof cuerpo.leadId === 'string' && UUID.test(cuerpo.leadId) ? cuerpo.leadId.toLowerCase() : null
  if (cuerpo.leadId !== undefined && cuerpo.leadId !== null && !leadId) return fail(400, 'Ese lead no es válido.')
  if (casos.length === 0 && !leadId) return fail(400, 'Elige qué probar: un caso de prueba o un lead.')

  const cantidad = casos.length + (leadId ? 1 : 0)
  const permiso = pedirPermiso(sesion.userId, Date.now(), delLaboratorio, LIMITES_DEL_LABORATORIO, cantidad)
  if (!permiso.permitido) return fail(429, permiso.motivo)

  try {
    const service = createServiceClient()

    // Con qué configuración se prueba: lo que hay en el editor, una versión guardada o lo que usa el equipo
    let perfil: PerfilDeWhatsapp
    let origen: 'borrador' | 'version' | 'produccion'
    const avisos: string[] = []
    if (cuerpo.perfil !== undefined) {
      const p = validarPerfilDeWhatsapp(cuerpo.perfil)
      if (!p.ok) return fail(400, p.error)
      perfil = p.perfil
      origen = 'borrador'
      avisos.push(...p.avisos)
    } else if (typeof cuerpo.versionId === 'string' && UUID.test(cuerpo.versionId)) {
      const v = await leerVersion(service, cuerpo.versionId.toLowerCase())
      if (!v) return fail(404, 'No se encuentra esa versión.')
      perfil = v.perfil
      origen = 'version'
    } else if (cuerpo.enProduccion === true) {
      perfil = (await perfilEnProduccion(service)).perfil
      origen = 'produccion'
    } else {
      return fail(400, 'Falta qué configuración probar.')
    }

    // El lead real se lee con la SESIÓN de quien prueba (RLS): si no puede verlo, no existe para él
    let real: LeadRealParaProbar | null = null
    if (leadId) {
      const lead = await cargarLead(sesion.supabase, leadId)
      if (!lead) return fail(404, 'No se encuentra ese lead, o no es tuyo.')
      const [notas, llamadas] = await Promise.all([cargarNotas(sesion.supabase, leadId), cargarLlamadas(sesion.supabase, leadId)])
      real = { id: leadId, etiqueta: String(lead.store_name ?? 'Lead real'), lead, notas, llamadas }
    }

    const { data: yo } = await sesion.supabase.from('profiles').select('full_name, email').eq('id', sesion.userId).maybeSingle()
    const miNombre = nombreDePila((yo as { full_name?: string | null } | null)?.full_name, (yo as { email?: string | null } | null)?.email)

    const { sistema, resultados } = await probarEnLote({
      perfil,
      casos,
      real,
      situacion: esSituacionDeWhatsapp(cuerpo.situacion) ? cuerpo.situacion : null,
      miNombre,
      indicaciones: textoDe(cuerpo.indicaciones, 300),
      anterior: textoDe(cuerpo.anterior, 1200),
    })
    // Qué se ha gastado, sin los textos: son contenido de un lead
    console.log('[whatsapp-ia] prueba', { origen, casos: casos.length, real: real !== null, ok: resultados.filter((r) => r.ok).length, coste: resultados.reduce((s, r) => s + (r.coste ?? 0), 0) })
    return NextResponse.json({ ok: true, origen, sistema, resultados, avisos }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloDeWhatsapp('WhatsApp · probar: fallo', error)
  }
}
