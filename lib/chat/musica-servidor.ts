import { fusionarMetadatosDeSala, salaDe } from './junta'
import { configuracion, estadoDeSala, noDisponible, servicio } from './junta-servidor'
import { MAX_COLA, MAX_TITULO, MUSICA_VACIA, aplicarAccionDeMusica, esIdDeVideo, normalizarEstadoDeMusica, type AccionDeMusica, type EstadoDeMusica, type PistaDeMusica } from './musica'
import { canalDe, ErrorDeChat, exigirMiembro, type QuienEscribe } from './servidor'

/**
 * LA MÚSICA DE LA SALA, DEL LADO DEL SERVIDOR. Guarda la cola y qué suena en los metadatos de la sala de LiveKit (junto al candado): LiveKit se los reparte al instante a todos los que están dentro, y quien
 * entra tarde los lee al conectarse. Cualquiera de los que están dentro puede añadir, pausar, saltar… (se comprueba aquí que está en la sala). Aquí se piden a YouTube el título y el autor de cada vídeo
 * (oEmbed, sin clave: solo con ids de vídeo ya validados) y se descartan los que no se pueden reproducir incrustados. La reproducción la hace cada navegador con el reproductor oficial de YouTube. Reglas: lib/chat/musica.ts.
 */

/** Una a la vez por sala: leer-cambiar-escribir sin pisarse si dos pulsan a la vez */
const colas = new Map<string, Promise<unknown>>()
function enFila<T>(sala: string, tarea: () => Promise<T>): Promise<T> {
  const previa = colas.get(sala) ?? Promise.resolve()
  const siguiente = previa.then(tarea, tarea)
  colas.set(sala, siguiente.catch(() => undefined))
  if (colas.size > 200) for (const [k, v] of colas) if (v === colas.get(k) && k !== sala) colas.delete(k)
  return siguiente
}

interface DatosDeVideo {
  titulo: string
  autor: string
}

/** El título y el autor de un vídeo, o null si YouTube dice que no existe, es privado o no deja reproducirlo incrustado */
async function datosDelVideo(videoId: string): Promise<DatosDeVideo | null> {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`, { signal: AbortSignal.timeout(5000), cache: 'no-store' })
    if (!r.ok) return null
    const d = (await r.json()) as { title?: unknown; author_name?: unknown }
    return { titulo: String(d.title ?? 'Sin título').slice(0, MAX_TITULO), autor: String(d.author_name ?? '').slice(0, 80) }
  } catch {
    return null
  }
}

/** Convierte ids de vídeo en pistas (de seis en seis, para no abrumar a YouTube); los que no valen se cuentan aparte */
async function pistasDe(ids: readonly string[], quien: string): Promise<{ pistas: PistaDeMusica[]; descartadas: number }> {
  const validos = [...new Set(ids.filter(esIdDeVideo))].slice(0, MAX_COLA)
  const pistas: PistaDeMusica[] = []
  let descartadas = ids.length - validos.length
  for (let i = 0; i < validos.length; i += 6) {
    const tanda = await Promise.all(validos.slice(i, i + 6).map(async (videoId) => ({ videoId, datos: await datosDelVideo(videoId) })))
    for (const t of tanda) {
      if (!t.datos) descartadas++
      else pistas.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, videoId: t.videoId, titulo: t.datos.titulo, autor: t.datos.autor, anadidaPor: quien })
    }
  }
  return { pistas, descartadas }
}

/** La música actual de una sala (vacía si no hay sala o no hay nada) */
export async function leerMusica(quien: QuienEscribe, canalId: unknown): Promise<{ estado: EstadoDeMusica; ahora: number }> {
  const c = configuracion()
  if (!c) throw noDisponible()
  const canal = await canalDe(canalId)
  await exigirMiembro(quien, canal)
  const sala = await estadoDeSala(c, salaDe(canal.id))
  let bruto: unknown = null
  try {
    bruto = (JSON.parse(sala.metadatos || '{}') as { musica?: unknown }).musica
  } catch {
    bruto = null
  }
  return { estado: sala.existe ? normalizarEstadoDeMusica(bruto) : { ...MUSICA_VACIA, cola: [] }, ahora: Date.now() }
}

/** Lo que llega del navegador: la acción y sus datos, validados. null si no se entiende */
export function leerAccion(cuerpo: Record<string, unknown>): { accion: AccionDeMusica | null; ids: string[] } {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN)
  switch (cuerpo.accion) {
    case 'anadir':
      return { accion: { tipo: 'anadir', pistas: [] }, ids: Array.isArray(cuerpo.ids) ? cuerpo.ids.filter((x): x is string => typeof x === 'string').slice(0, MAX_COLA) : [] }
    case 'siguiente':
      return { accion: { tipo: 'siguiente', ...(typeof cuerpo.desde === 'string' ? { desde: cuerpo.desde.slice(0, 40) } : {}) }, ids: [] }
    case 'anterior':
    case 'pausar':
    case 'reanudar':
    case 'vaciar':
      return { accion: { tipo: cuerpo.accion }, ids: [] }
    case 'buscar':
      return Number.isFinite(num(cuerpo.posMs)) ? { accion: { tipo: 'buscar', posMs: num(cuerpo.posMs) }, ids: [] } : { accion: null, ids: [] }
    case 'saltar':
      return Number.isFinite(num(cuerpo.ms)) ? { accion: { tipo: 'saltar', ms: Math.max(-600_000, Math.min(600_000, num(cuerpo.ms))) }, ids: [] } : { accion: null, ids: [] }
    case 'irA':
      return Number.isInteger(cuerpo.indice) ? { accion: { tipo: 'irA', indice: cuerpo.indice as number }, ids: [] } : { accion: null, ids: [] }
    case 'quitar':
      return typeof cuerpo.id === 'string' ? { accion: { tipo: 'quitar', id: cuerpo.id.slice(0, 40) }, ids: [] } : { accion: null, ids: [] }
    default:
      return { accion: null, ids: [] }
  }
}

/** Hace algo con la música de la sala: solo quien está dentro. Devuelve el estado nuevo y la hora del servidor (para que cada navegador calcule por dónde va) */
export async function accionDeMusica(quien: QuienEscribe, canalId: unknown, cuerpo: Record<string, unknown>): Promise<{ estado: EstadoDeMusica; ahora: number; anadidas?: number; descartadas?: number }> {
  const c = configuracion()
  if (!c) throw noDisponible()
  const { accion, ids } = leerAccion(cuerpo)
  if (!accion) throw new ErrorDeChat('No entiendo qué quieres hacer con la música.')
  const canal = await canalDe(canalId)
  await exigirMiembro(quien, canal)
  const sala = salaDe(canal.id)
  // Los títulos se piden ANTES de entrar en la fila: no se hace esperar al resto mientras YouTube contesta
  const nuevas = accion.tipo === 'anadir' ? await pistasDe(ids, quien.userId) : null
  if (accion.tipo === 'anadir' && nuevas && nuevas.pistas.length === 0) throw new ErrorDeChat('Ese vídeo no se puede reproducir aquí (no existe, es privado o no deja incrustarlo).', 422)
  return enFila(sala, async () => {
    const estado = await estadoDeSala(c, sala)
    if (!estado.existe || !estado.dentro.includes(quien.userId)) throw new ErrorDeChat('La música es de quienes están dentro de la sala de voz.', 403)
    let actual: EstadoDeMusica
    try {
      actual = normalizarEstadoDeMusica((JSON.parse(estado.metadatos || '{}') as { musica?: unknown }).musica)
    } catch {
      actual = { ...MUSICA_VACIA, cola: [] }
    }
    const ahora = Date.now()
    const nuevo = aplicarAccionDeMusica(actual, nuevas ? { tipo: 'anadir', pistas: nuevas.pistas } : accion, ahora)
    if (nuevo !== actual) await servicio(c).updateRoomMetadata(sala, fusionarMetadatosDeSala(estado.metadatos, { musica: nuevo }))
    return { estado: nuevo, ahora, ...(nuevas ? { anadidas: Math.min(nuevas.pistas.length, MAX_COLA - actual.cola.length), descartadas: nuevas.descartadas } : {}) }
  })
}
