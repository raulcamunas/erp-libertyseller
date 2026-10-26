import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail } from '@/lib/amazon/api'
import { probarCorreosEnLote, type LeadRealParaCorreo } from '@/lib/correo/ia-laboratorio-casos'
import { configuracionDePrueba, ejemplosDeLaVersion } from '@/lib/correo/ia-laboratorio-servidor'
import { cargarGanadores, cargarLead, cargarLlamadas, cargarNotas } from '@/lib/correo/ia-servidor'
import { leerJson, requerirConfigCorreos, respuestaDeFalloDeConfiguracion } from '@/lib/correo/laboratorio-rutas'
import { SIN_CACHE, textoDe } from '@/lib/correo/rutas'
import { almacenDeSecuencias } from '@/lib/correo/secuencias/almacen'
import { PASOS_POR_DEFECTO } from '@/lib/correo/secuencias/reglas'
import { createServiceClient } from '@/lib/supabase/service'
import { casosPedidos } from '@/lib/whatsapp/ia-casos'
import { LIMITES_DEL_LABORATORIO, delLaboratorio, pedirPermiso } from '@/lib/whatsapp/ia-limite'
import { nombreDePila } from '@/lib/whatsapp/mensajes'

/**
 * PROBAR UNA VERSIÓN DEL CORREO CON PERSONAS DE PRUEBA (Y CON SUS SEGUIMIENTOS), SIN ENVIAR NADA.
 *
 * POST {
 *   versionId?  una versión guardada;  o  secciones, ejemplosIds?, usarGanadores?, modelo?  lo que hay en el editor AHORA, sin guardar
 *   casoIds?        hasta 12 personas de prueba inventadas (las mismas que usa la IA de WhatsApp: lib/whatsapp/ia-casos.ts)
 *   leadId?         y/o un lead real (se lee con la SESIÓN de quien prueba: si no es suyo ni supervisa, 404)
 *   indicaciones?   lo que «pide el comercial» (se aplica a los casos que no traen la suya)
 *   seguimientos?   true = escribir también los seguimientos de la secuencia de cada persona (a los 3 y 7 días hábiles, o los pasos que tenga la secuencia)
 * }
 *
 * Devuelve, por persona, el correo, lo que tardó, lo que costó y lo que recibió la IA, y los seguimientos si se pidieron. Escribe con las mismas funciones que un correo de verdad. Tiene el
 * tope de pruebas del laboratorio (200 a la hora por persona, aparte del de los comerciales; con seguimientos cada persona cuenta doble). Nada se guarda ni se envía.
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
  if (casos.length === 0 && !leadId) return fail(400, 'Elige a quién escribir: una persona de prueba o un lead.')
  const seguimientos = cuerpo.seguimientos === true

  const personas = casos.length + (leadId ? 1 : 0)
  const permiso = pedirPermiso(sesion.userId, Date.now(), delLaboratorio, LIMITES_DEL_LABORATORIO, personas * (seguimientos ? 2 : 1))
  if (!permiso.permitido) return fail(429, permiso.motivo)

  try {
    const service = createServiceClient()

    const config = await configuracionDePrueba(service, cuerpo)
    if (!config.ok) return fail(config.estado, config.error)
    const { secciones, ejemplosIds, usarGanadores, modelo, avisos } = config.valor

    // El lead real se lee con la SESIÓN de quien prueba (RLS): si no puede verlo, no existe para él
    let real: LeadRealParaCorreo | null = null
    if (leadId) {
      const lead = await cargarLead(sesion.supabase, leadId)
      if (!lead) return fail(404, 'No se encuentra ese lead, o no es tuyo.')
      const [notas, llamadas] = await Promise.all([cargarNotas(sesion.supabase, leadId), cargarLlamadas(sesion.supabase, leadId)])
      real = { id: leadId, etiqueta: String(lead.store_name ?? 'Lead real'), lead, notas, llamadas }
    }

    const [ganadores, elegidos, yo, pasos] = await Promise.all([
      cargarGanadores(service),
      ejemplosIds.length > 0 ? ejemplosDeLaVersion(service, ejemplosIds) : Promise.resolve([]),
      sesion.supabase.from('profiles').select('full_name, email').eq('id', sesion.userId).maybeSingle(),
      // Los pasos de la secuencia de verdad; si las secuencias no están preparadas, los de siempre
      seguimientos ? almacenDeSecuencias(service).secuenciaBase().then((s) => s?.pasos ?? null, () => null) : Promise.resolve(null),
    ])
    const perfil = yo.data as { full_name?: string | null; email?: string | null } | null

    const resultados = await probarCorreosEnLote({
      secciones,
      elegidos,
      ganadores,
      usarGanadores,
      modelo,
      casos,
      real,
      miNombre: nombreDePila(perfil?.full_name, perfil?.email),
      indicaciones: textoDe(cuerpo.indicaciones, 600),
      seguimientos,
      pasos: pasos ?? PASOS_POR_DEFECTO,
    })
    // Qué se ha gastado, sin los textos: son contenido de un lead
    console.log('[correo-ia] prueba con personas', { personas, seguimientos, ok: resultados.filter((r) => r.ok).length, coste: resultados.reduce((s, r) => s + (r.coste ?? 0) + (r.seguimientosCoste ?? 0), 0) })
    return NextResponse.json({ ok: true, resultados, avisos }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloDeConfiguracion('Correo · probar con personas: fallo', error)
  }
}
