import type { createServiceClient } from '@/lib/supabase/service'
import { dominioDe, limpiarCuerpo, sinDatosDeContacto } from './ia-ejemplos'
import { listarVersiones } from './ia-laboratorio-servidor'
import type { ResultadosDeLaConfiguracion, ResultadosDeVersion } from './ia-laboratorio-tipos'
import { desenlaceDeEnvio, resumirGrupo, veredicto, type DesenlaceDeUnEnvio, type MensajeEntrante, type ResumenDeGrupo } from './ia-resultados'
import { cambiosEnPorcentaje } from './ia-version'

/**
 * LOS RESULTADOS DE CADA VERSIÓN — SOLO SERVIDOR.
 * ===============================================
 * Para cada versión de la IA: cuántos correos escribió que se llegaron a enviar, a cuántos contestó una persona de fuera y a cuántos con
 * interés (lib/correo/ia-resultados.ts define qué es cada cosa), cuánto cambió el comercial lo que escribió la IA y los correos que
 * consiguieron respuesta. Y, para comparar, lo mismo de los correos fríos que salieron SIN IA.
 *
 * Solo salen cifras y los textos de los correos que respondieron (sin correos ni teléfonos): nunca lo que contestó el cliente.
 *
 * SE LEE LO JUSTO. Los borradores enviados de la ventana (unos cientos) y, de sus conversaciones, solo los correos ENTRANTES; para el
 * «a mano» una función de la base cuenta los fríos y devuelve cuáles tuvieron respuesta, y solo de esos se leen los entrantes.
 */

type Servicio = ReturnType<typeof createServiceClient>

export const DIAS_POR_DEFECTO = 45
const MAX_BORRADORES = 5000
const HILOS_POR_CONSULTA = 80

const fallo = (mensaje: string, causa: unknown): Error => new Error(mensaje, { cause: causa })

/** Lee los correos ENTRANTES de unas conversaciones, de ochenta en ochenta */
async function entrantesDe(service: Servicio, hilos: readonly string[]): Promise<Map<string, MensajeEntrante[]>> {
  const porHilo = new Map<string, MensajeEntrante[]>()
  const unicos = [...new Set(hilos)]
  for (let i = 0; i < unicos.length; i += HILOS_POR_CONSULTA) {
    const { data, error } = await service
      .from('correo_mensajes')
      .select('hilo_id, fecha, de_direccion, automatico, texto')
      .eq('direccion', 'entrante')
      .in('hilo_id', unicos.slice(i, i + HILOS_POR_CONSULTA))
    if (error) throw fallo('No se han podido leer las respuestas.', error)
    for (const m of (data ?? []) as Array<{ hilo_id: string; fecha: string; de_direccion: string; automatico: boolean; texto: string }>) {
      const lista = porHilo.get(m.hilo_id) ?? []
      lista.push({ hiloId: m.hilo_id, fecha: m.fecha, deDireccion: m.de_direccion, automatico: m.automatico, texto: m.texto })
      porHilo.set(m.hilo_id, lista)
    }
  }
  return porHilo
}

interface FilaDeBorrador {
  id: string
  version_id: string | null
  hilo_id: string | null
  enviado_at: string
  texto: string
  texto_final: string | null
  asunto_final: string | null
}

export async function calcularResultados(service: Servicio, dias = DIAS_POR_DEFECTO, ahora = Date.now()): Promise<ResultadosDeLaConfiguracion> {
  const desde = new Date(ahora - dias * 86_400_000).toISOString()
  const versiones = await listarVersiones(service)
  const base = versiones.find((v) => v.esBase) ?? null

  const { data: filas, error } = await service
    .from('correo_ia_borradores')
    .select('id, version_id, hilo_id, enviado_at, texto, texto_final, asunto_final')
    .not('enviado_at', 'is', null)
    .gte('enviado_at', desde)
    .order('enviado_at', { ascending: false })
    .limit(MAX_BORRADORES)
  if (error) throw fallo('No se han podido leer los borradores enviados.', error)
  const borradores = (filas ?? []) as FilaDeBorrador[]

  const { data: buzones, error: errorBuzones } = await service.from('correo_buzones').select('direccion')
  if (errorBuzones) throw fallo('No se han podido leer los buzones.', errorBuzones)
  const dominiosPropios = new Set(((buzones ?? []) as Array<{ direccion: string }>).map((b) => dominioDe(b.direccion)).filter(Boolean))

  const hilosDeBorradores = borradores.map((b) => b.hilo_id).filter((h): h is string => !!h)
  const entrantes = await entrantesDe(service, hilosDeBorradores)

  // Cada envío con lo que pasó después. Los de antes de las versiones (version_id vacío) eran de la original
  const porVersion = new Map<string, Array<{ desenlace: DesenlaceDeUnEnvio; cambios: number | null; fila: FilaDeBorrador }>>()
  for (const b of borradores) {
    const clave = b.version_id ?? base?.id ?? 'sin-version'
    const desenlace = b.hilo_id ? desenlaceDeEnvio(b.enviado_at, entrantes.get(b.hilo_id) ?? [], dominiosPropios) : { respondio: false, interesada: false }
    const cambios = b.texto_final ? cambiosEnPorcentaje(b.texto, b.texto_final) : null
    const lista = porVersion.get(clave) ?? []
    lista.push({ desenlace, cambios, fila: b })
    porVersion.set(clave, lista)
  }

  const resultados: ResultadosDeVersion[] = []
  const conocidas = new Set<string>()
  for (const v of versiones) {
    conocidas.add(v.id)
    const envios = porVersion.get(v.id) ?? []
    resultados.push({
      id: v.id,
      nombre: v.nombre,
      esBase: v.esBase,
      enMarcha: v.activa && !v.archivada && v.peso > 0,
      resumen: resumirGrupo(envios),
      conRespuesta: envios
        .filter((e) => e.desenlace.interesada)
        .slice(0, 5)
        .map((e) => ({
          asunto: e.fila.asunto_final ?? '',
          texto: sinDatosDeContacto(limpiarCuerpo(e.fila.texto_final ?? e.fila.texto)).slice(0, 1800),
          cambios: e.cambios,
          enviadoAt: e.fila.enviado_at,
        })),
    })
  }
  // Borradores de una versión que ya no existe (borrada a mano en la base) o anteriores a que existiera la original
  const huerfanos = porVersion.get('sin-version')
  if (huerfanos && huerfanos.length > 0) {
    resultados.push({ id: null, nombre: 'Sin versión (de antes de las versiones)', esBase: false, enMarcha: false, resumen: resumirGrupo(huerfanos), conRespuesta: [] })
  }

  const aMano = await correosASin(service, desde, hilosDeBorradores, dominiosPropios)

  return {
    dias,
    desde,
    versiones: resultados,
    aMano,
    veredicto: veredicto(
      resultados
        .filter((r) => r.id !== null)
        .map((r) => ({ id: r.id as string, nombre: r.nombre, enviados: r.resumen.enviados, interesadas: r.resumen.interesadas }))
    ),
  }
}

/**
 * Los correos fríos que salieron sin IA, con el mismo criterio de respuesta que los de la IA. null si la función de la base no está
 * (migración sin lanzar) o falla: es solo la referencia, los resultados de las versiones valen igual.
 */
async function correosASin(service: Servicio, desde: string, hilosDeIa: readonly string[], dominiosPropios: ReadonlySet<string>): Promise<ResumenDeGrupo | null> {
  try {
    const { data, error } = await service.rpc('correo_frios_resumen', { p_desde: desde, p_excluir: [...new Set(hilosDeIa)] })
    if (error) throw error
    const r = data as { total?: number; con_entrantes?: Array<{ hilo_id: string; enviado_at: string; entrantes: number }> } | null
    const total = r?.total ?? 0
    const conEntrantes = r?.con_entrantes ?? []
    const entrantes = await entrantesDe(service, conEntrantes.map((c) => c.hilo_id))
    const respondidos = conEntrantes.map((c) => desenlaceDeEnvio(c.enviado_at, entrantes.get(c.hilo_id) ?? [], dominiosPropios))
    const sinRespuesta = Math.max(0, total - conEntrantes.length)
    return resumirGrupo([...respondidos.map((d) => ({ desenlace: d })), ...Array.from({ length: sinRespuesta }, () => ({ desenlace: { respondio: false, interesada: false } }))])
  } catch (error) {
    console.warn('[correo-ia] no se han podido contar los correos enviados sin IA', { codigo: (error as { code?: string } | null)?.code ?? null })
    return null
  }
}
