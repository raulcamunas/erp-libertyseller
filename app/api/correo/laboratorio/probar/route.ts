import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail } from '@/lib/amazon/api'
import { contextoParaIa, tipoDeLead } from '@/lib/correo/ia-contexto'
import { redactarConIa } from '@/lib/correo/ia-generar'
import { ejemplosDeLaVersion, leerVersion } from '@/lib/correo/ia-laboratorio-servidor'
import { compilarInstrucciones, construirMensajes, validarSecciones, type SeccionesDeInstrucciones } from '@/lib/correo/ia-prompt'
import { cargarGanadores, cargarLead, cargarLlamadas, cargarNotas } from '@/lib/correo/ia-servidor'
import { costeAproximado, montarEjemplos, validarModelo } from '@/lib/correo/ia-version'
import { leerJson, requerirConfigCorreos, respuestaDeFalloDeConfiguracion } from '@/lib/correo/laboratorio-rutas'
import { SIN_CACHE, textoDe } from '@/lib/correo/rutas'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * PROBAR UNA VERSIÓN CON UN LEAD, SIN ENVIAR NADA.
 *
 * POST { leadId, indicaciones?, versionId? | { secciones, ejemplosIds?, usarGanadores?, modelo? } }
 *   · con `versionId` se prueba la versión guardada;
 *   · con `secciones` (y lo demás) se prueba lo que hay en el editor AHORA, sin guardar: así se afina el texto antes de ponerlo en marcha.
 *
 * Escribe un borrador con los datos y el historial reales del lead (los que la persona puede ver: si el lead no es suyo ni supervisa, 404) y
 * lo devuelve con lo que ha costado. NO se guarda ni se envía, y no cuenta en el límite de borradores de los comerciales; tiene el suyo
 * (30 por hora y persona). Quien prueba no tiene buzón aquí: no se leen correos anteriores con el lead.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 90

const MAX_PRUEBAS_POR_HORA = 30
/** Las pruebas de la última hora de cada persona, en memoria: es un tope contra un bucle, no una cuenta */
const pruebas = new Map<string, number[]>()

function permitirPrueba(userId: string, ahora = Date.now()): boolean {
  const recientes = (pruebas.get(userId) ?? []).filter((t) => ahora - t < 3_600_000)
  if (recientes.length >= MAX_PRUEBAS_POR_HORA) {
    pruebas.set(userId, recientes)
    return false
  }
  recientes.push(ahora)
  pruebas.set(userId, recientes)
  return true
}

export async function POST(request: NextRequest) {
  const sesion = await requerirConfigCorreos()
  if (sesion instanceof NextResponse) return sesion
  const cuerpo = await leerJson(request)
  if (!cuerpo) return fail(400, 'No se ha entendido lo que se ha mandado')
  const leadId = typeof cuerpo.leadId === 'string' && UUID.test(cuerpo.leadId) ? cuerpo.leadId.toLowerCase() : null
  if (!leadId) return fail(400, 'Elige un lead para probar.')
  if (!permitirPrueba(sesion.userId)) return fail(429, `Has hecho ${MAX_PRUEBAS_POR_HORA} pruebas en la última hora: espera un rato.`)

  try {
    const service = createServiceClient()

    // Con qué se prueba: la versión guardada o lo que hay en el editor
    let secciones: SeccionesDeInstrucciones
    let ejemplosIds: string[]
    let usarGanadores: boolean
    let modelo: string | null
    const avisos: string[] = []
    if (typeof cuerpo.versionId === 'string' && UUID.test(cuerpo.versionId) && cuerpo.secciones === undefined) {
      const v = await leerVersion(service, cuerpo.versionId.toLowerCase())
      if (!v) return fail(404, 'No se encuentra esa versión.')
      secciones = v.secciones
      ejemplosIds = v.ejemplosIds
      usarGanadores = v.usarGanadores
      modelo = v.modelo
    } else {
      const s = validarSecciones(cuerpo.secciones)
      if (!s.ok) return fail(400, s.error)
      const m = validarModelo(cuerpo.modelo)
      if (!m.ok) return fail(400, m.error)
      secciones = s.secciones
      avisos.push(...s.avisos)
      modelo = m.modelo
      usarGanadores = cuerpo.usarGanadores !== false
      ejemplosIds = Array.isArray(cuerpo.ejemplosIds) ? cuerpo.ejemplosIds.filter((x): x is string => typeof x === 'string' && UUID.test(x)).slice(0, 8) : []
    }

    // El lead se lee con la SESIÓN de quien prueba (RLS): si no puede verlo, no existe para él
    const lead = await cargarLead(sesion.supabase, leadId)
    if (!lead) return fail(404, 'No se encuentra ese lead, o no es tuyo.')
    const [notas, llamadas, ganadores, elegidos] = await Promise.all([
      cargarNotas(sesion.supabase, leadId),
      cargarLlamadas(sesion.supabase, leadId),
      cargarGanadores(service),
      ejemplosIds.length > 0 ? ejemplosDeLaVersion(service, ejemplosIds) : Promise.resolve([]),
    ])
    const ejemplos = montarEjemplos({ elegidos, ganadores, tipo: tipoDeLead(lead), usarGanadores })
    const mensajes = construirMensajes({
      instrucciones: compilarInstrucciones(secciones),
      contexto: contextoParaIa({ lead, notas, llamadas, correos: [], ahora: Date.now() }),
      ejemplos,
      indicaciones: textoDe(cuerpo.indicaciones, 600),
      anterior: null,
      miNombre: null,
      tieneFirma: true,
    })
    const resultado = await redactarConIa(mensajes, modelo ? { modelo } : {})
    console.log('[correo-ia] prueba', { modelo: resultado.modelo, ok: resultado.borrador !== null, tokens: resultado.tokens, ejemplos: ejemplos.length })
    if (!resultado.borrador) return fail(resultado.problemas.includes('dinero') ? 422 : 503, resultado.aviso ?? 'No se ha podido redactar el correo.')
    return NextResponse.json(
      {
        ok: true,
        asunto: resultado.borrador.asunto,
        texto: resultado.borrador.texto,
        angulo: resultado.borrador.angulo,
        modelo: resultado.modelo,
        ejemplos: ejemplos.length,
        coste: costeAproximado(resultado.modelo, resultado.tokens),
        avisos: resultado.aviso ? [...avisos, resultado.aviso] : avisos,
      },
      { headers: SIN_CACHE }
    )
  } catch (error) {
    return respuestaDeFalloDeConfiguracion('Correo · probar una versión: fallo', error)
  }
}
