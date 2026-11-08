import { unzipSync } from 'fflate'
import { createServiceClient } from '@/lib/supabase/service'
import { claveDeDirecto, normalizarNombreDeCanal } from './canales'
import { emojiDeSlack, convertirTexto, isoDeTs, leerExportacion, type ConversacionDeSlack, type ExportacionDeSlack } from './slack'
import { ErrorDeChat, personasDelChat, type QuienEscribe } from './servidor'

/**
 * IMPORTAR EL HISTORIAL DE SLACK (solo administradores). Se sube el .zip de la exportación de Slack; primero se REVISA (qué canales, cuántos mensajes y a quién se ha reconocido) y, si todo
 * está bien, se importa en segundo plano mientras la pantalla enseña el avance. Volver a importar el mismo fichero no duplica nada (cada mensaje y cada canal recuerdan de dónde vienen).
 *
 * Quién es quién: las personas se reconocen por su CORREO (el de Slack y el del ERP). Lo que escribió alguien que no se reconoce se importa igual, con su nombre de Slack y la etiqueta «Slack».
 * Los mensajes importados NO avisan a nadie (ni campana ni móvil) y todo queda como leído. Los archivos adjuntos no se traen (Slack no los incluye): queda una línea «📎 nombre».
 * Quien importa pasa a ser administrador de los canales abiertos y privados importados; los mensajes directos solo los ven sus dos personas.
 */

const MAX_BYTES = 150 * 1024 * 1024
const MAX_MENSAJES = 300_000
const TROZO = 400

export interface ResumenDeConversacion {
  nombre: string
  tipo: ConversacionDeSlack['tipo']
  mensajes: number
  miembros: number
  miembrosReconocidos: number
  /** Si no se va a importar, por qué */
  omitida: string | null
}

export interface ResumenDeImportacion {
  conversaciones: ResumenDeConversacion[]
  mensajes: number
  personas: { total: number; reconocidas: number; sinReconocer: string[] }
  avisos: string[]
}

export interface EstadoDeImportacion {
  estado: 'en_curso' | 'listo' | 'error'
  hechos: number
  total: number
  actual: string
  resumen: { canales: number; mensajes: number; reacciones: number; omitidos: number } | null
  error: string | null
}

const global_ = globalThis as unknown as { __chatImportaciones?: Map<string, EstadoDeImportacion> }
const trabajos = (global_.__chatImportaciones ??= new Map<string, EstadoDeImportacion>())

/* ------------------------------------------------------------------ */
/* Leer el zip                                                         */
/* ------------------------------------------------------------------ */

function abrirZip(bytes: Uint8Array): ExportacionDeSlack {
  if (bytes.length > MAX_BYTES) throw new ErrorDeChat('El archivo es demasiado grande (máximo 150 MB).')
  let ficheros: Record<string, Uint8Array>
  try {
    ficheros = unzipSync(bytes, { filter: (f) => f.name.toLowerCase().endsWith('.json') && !f.name.includes('__MACOSX') })
  } catch {
    throw new ErrorDeChat('No se ha podido abrir el archivo: tiene que ser el .zip que te da Slack al exportar.')
  }
  // Algunos zips traen todo dentro de una carpeta: se busca dónde está users.json y se cuenta desde ahí
  const usuarios = Object.keys(ficheros).find((r) => /(^|\/)users\.json$/.test(r))
  if (!usuarios) throw new ErrorDeChat('Esto no parece una exportación de Slack: no encuentro users.json.')
  const base = usuarios.slice(0, usuarios.length - 'users.json'.length)
  const texto = new TextDecoder()
  const mapa = new Map<string, string>()
  for (const [ruta, datos] of Object.entries(ficheros)) if (ruta.startsWith(base)) mapa.set(ruta.slice(base.length), texto.decode(datos))
  const x = leerExportacion(mapa)
  const total = x.conversaciones.reduce((n, c) => n + c.mensajes.length, 0)
  if (total === 0) throw new ErrorDeChat('La exportación no trae ningún mensaje. Si usas un plan gratuito, Slack solo exporta los canales abiertos.')
  if (total > MAX_MENSAJES) throw new ErrorDeChat(`La exportación trae ${total.toLocaleString('es-ES')} mensajes: el máximo por importación es ${MAX_MENSAJES.toLocaleString('es-ES')}.`)
  return x
}

async function emparejar(x: ExportacionDeSlack): Promise<Map<string, string>> {
  const { data } = await createServiceClient().from('profiles').select('id, email')
  const porCorreo = new Map(((data ?? []) as Array<{ id: string; email: string | null }>).filter((p) => p.email).map((p) => [p.email!.toLowerCase(), p.id]))
  const r = new Map<string, string>()
  for (const u of x.usuarios) if (u.email && !u.esBot && porCorreo.has(u.email)) r.set(u.id, porCorreo.get(u.email)!)
  return r
}

export async function analizarImportacion(quien: QuienEscribe, bytes: Uint8Array): Promise<ResumenDeImportacion> {
  if (!quien.esAdmin) throw new ErrorDeChat('Importar es solo para administradores.', 403)
  const x = abrirZip(bytes)
  const emparejados = await emparejar(x)
  const hablan = new Set(x.conversaciones.flatMap((c) => c.mensajes.map((m) => m.usuarioId).filter((u): u is string => Boolean(u))))
  const usuariosQueHablan = x.usuarios.filter((u) => hablan.has(u.id))
  return {
    conversaciones: x.conversaciones.map((c) => {
      const reconocidos = c.miembros.filter((m) => emparejados.has(m)).length
      return { nombre: c.nombre, tipo: c.tipo, mensajes: c.mensajes.length, miembros: c.miembros.length, miembrosReconocidos: reconocidos, omitida: c.tipo === 'directo' && reconocidos < 2 ? 'Faltan personas reconocidas' : null }
    }),
    mensajes: x.conversaciones.reduce((n, c) => n + c.mensajes.length, 0),
    personas: { total: usuariosQueHablan.length, reconocidas: usuariosQueHablan.filter((u) => emparejados.has(u.id)).length, sinReconocer: usuariosQueHablan.filter((u) => !emparejados.has(u.id)).map((u) => u.nombre) },
    avisos: x.avisos,
  }
}

/* ------------------------------------------------------------------ */
/* Importar                                                            */
/* ------------------------------------------------------------------ */

export function estadoDeImportacion(id: unknown): EstadoDeImportacion | null {
  return typeof id === 'string' ? trabajos.get(id) ?? null : null
}

export async function empezarImportacion(quien: QuienEscribe, bytes: Uint8Array): Promise<{ trabajoId: string }> {
  if (!quien.esAdmin) throw new ErrorDeChat('Importar es solo para administradores.', 403)
  if ([...trabajos.values()].some((t) => t.estado === 'en_curso')) throw new ErrorDeChat('Ya hay una importación en marcha: espera a que termine.', 409)
  const x = abrirZip(bytes)
  const emparejados = await emparejar(x)
  const id = crypto.randomUUID()
  const total = x.conversaciones.reduce((n, c) => n + c.mensajes.length, 0)
  trabajos.set(id, { estado: 'en_curso', hechos: 0, total, actual: 'Preparando…', resumen: null, error: null })
  void ejecutar(id, quien, x, emparejados).catch((e) => {
    console.error('Chat: la importación de Slack ha fallado:', e instanceof Error ? e.message : e)
    const t = trabajos.get(id)
    if (t) trabajos.set(id, { ...t, estado: 'error', error: e instanceof ErrorDeChat ? e.message : 'La importación ha fallado a medias. Lo ya importado se queda; puedes volver a lanzarla y seguirá donde estaba.' })
  })
  return { trabajoId: id }
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function ejecutar(id: string, quien: QuienEscribe, x: ExportacionDeSlack, emparejados: Map<string, string>): Promise<void> {
  const service = createServiceClient()
  const progreso = (cambios: Partial<EstadoDeImportacion>) => trabajos.set(id, { ...(trabajos.get(id) as EstadoDeImportacion), ...cambios })
  const chat = new Set((await personasDelChat()).map((p) => p.id))
  const nombres = new Map(x.usuarios.map((u) => [u.id, u.nombre]))
  const canalesPorId = new Map(x.conversaciones.map((c) => [c.origenId, c.nombre]))
  let hechos = 0
  let canales = 0
  let mensajes = 0
  let reacciones = 0
  let omitidos = 0

  for (const c of x.conversaciones) {
    progreso({ actual: c.nombre })
    const miembros = [...new Set(c.miembros.map((m) => emparejados.get(m)).filter((p): p is string => Boolean(p)))]
    const deAqui = miembros.filter((p) => chat.has(p))

    // El canal: si ya se importó, se reutiliza; si no, se crea
    let canalId: string | null = ((await service.from('chat_canales').select('id').eq('origen_id', c.origenId).maybeSingle()).data as { id: string } | null)?.id ?? null
    if (!canalId) {
      let fila: Record<string, unknown>
      if (c.tipo === 'directo') {
        if (miembros.length < 2) {
          omitidos += c.mensajes.length
          hechos += c.mensajes.length
          progreso({ hechos })
          continue
        }
        // Una conversación de dos es un directo; de más, un grupo privado
        fila = miembros.length === 2 ? { tipo: 'directo', nombre: null, dm_clave: claveDeDirecto(miembros[0], miembros[1]), origen_id: c.origenId, creado_por: quien.userId } : { tipo: 'privado', nombre: null, origen_id: c.origenId, creado_por: quien.userId }
      } else fila = { tipo: c.tipo, nombre: null, descripcion: c.descripcion.slice(0, 300), origen_id: c.origenId, creado_por: quien.userId }
      if (fila.tipo !== 'directo') {
        const base = normalizarNombreDeCanal(c.nombre) ?? `slack-${c.origenId.toLowerCase()}`
        for (let intento = 0; intento < 6 && !canalId; intento++) {
          const nombre = intento === 0 ? base : intento === 1 ? `${base}-slack`.slice(0, 40) : `${base}-slack-${intento}`.slice(0, 40)
          const { data, error } = await service.from('chat_canales').insert({ ...fila, nombre }).select('id').single()
          if (!error) canalId = (data as { id: string }).id
          else if (error.code !== '23505') throw new Error(error.message)
        }
      } else {
        const { data, error } = await service.from('chat_canales').insert(fila).select('id').single()
        if (!error) canalId = (data as { id: string }).id
        else if (error.code === '23505') canalId = ((await service.from('chat_canales').select('id').eq('dm_clave', fila.dm_clave as string).maybeSingle()).data as { id: string } | null)?.id ?? null
        else throw new Error(error.message)
      }
      if (!canalId) throw new ErrorDeChat(`No se ha podido crear el canal «${c.nombre}».`)
      canales++
    }

    // Quién está dentro: los reconocidos con chat y, en canales abiertos y privados, quien importa (como administrador)
    const filasMiembros: Array<{ canal_id: string; usuario_id: string; rol: 'miembro' | 'admin'; ultimo_leido_en: string }> = deAqui.map((p) => ({ canal_id: canalId as string, usuario_id: p, rol: 'miembro', ultimo_leido_en: new Date().toISOString() }))
    if (c.tipo !== 'directo' && !deAqui.includes(quien.userId)) filasMiembros.push({ canal_id: canalId as string, usuario_id: quien.userId, rol: 'admin', ultimo_leido_en: new Date().toISOString() })
    if (filasMiembros.length > 0) await service.from('chat_miembros').upsert(filasMiembros, { onConflict: 'canal_id,usuario_id', ignoreDuplicates: true })

    // Los mensajes de arriba, por orden de fecha (así el id sube con el tiempo)
    // Las menciones se importan como texto («@Ana»): no avisan a nadie
    const ctx = { menciones: new Map(x.usuarios.map((u) => [u.id, { perfilId: null as string | null, nombre: u.nombre }])), canales: canalesPorId }
    const filaDe = (m: ConversacionDeSlack['mensajes'][number]) => {
      const lineasDeArchivos = m.archivos.map((a) => `📎 ${a} (archivo de Slack, no importado)`)
      const cuerpo = [convertirTexto(m.texto, ctx), ...lineasDeArchivos].filter(Boolean).join('\n').slice(0, 8000)
      const autor = m.usuarioId ? emparejados.get(m.usuarioId) ?? null : null
      return { canal_id: canalId, autor_id: autor, autor_externo: autor ? null : m.nombreExterno ?? (m.usuarioId ? nombres.get(m.usuarioId) ?? 'Alguien' : 'Bot'), cuerpo, creado_en: isoDeTs(m.ts), origen_id: `${c.origenId}:${m.ts}`, menciones: [] as string[], adjuntos: [] as unknown[] }
    }
    const arriba = c.mensajes.filter((m) => !m.hiloTs)
    const respuestas = c.mensajes.filter((m) => m.hiloTs)
    for (let i = 0; i < arriba.length; i += TROZO) {
      const trozo = arriba.slice(i, i + TROZO).map((m) => ({ m, f: filaDe(m) })).filter(({ f }) => f.cuerpo)
      if (trozo.length > 0) {
        const { error } = await service.from('chat_mensajes').upsert(trozo.map((t) => t.f), { onConflict: 'canal_id,origen_id', ignoreDuplicates: true })
        if (error) throw new Error(error.message)
      }
      hechos += Math.min(TROZO, arriba.length - i)
      progreso({ hechos })
      await dormir(40)
    }

    // El id de cada mensaje ya importado, para colgar de ellos las respuestas
    const ids = new Map<string, number>()
    const recargarIds = async () => {
      for (let desde = 0; ; desde += 1000) {
        const { data } = await service.from('chat_mensajes').select('id, origen_id').eq('canal_id', canalId).not('origen_id', 'is', null).order('id').range(desde, desde + 999)
        const pagina = (data ?? []) as Array<{ id: number; origen_id: string }>
        for (const f of pagina) ids.set(f.origen_id, f.id)
        if (pagina.length < 1000) break
      }
    }
    await recargarIds()
    for (let i = 0; i < respuestas.length; i += TROZO) {
      const trozo = respuestas
        .slice(i, i + TROZO)
        .map((m) => ({ m, f: { ...filaDe(m), hilo_de: ids.get(`${c.origenId}:${m.hiloTs}`) ?? null } }))
        .filter(({ f }) => f.cuerpo)
      if (trozo.length > 0) {
        const { error } = await service.from('chat_mensajes').upsert(trozo.map((t) => t.f), { onConflict: 'canal_id,origen_id', ignoreDuplicates: true })
        if (error) throw new Error(error.message)
      }
      hechos += Math.min(TROZO, respuestas.length - i)
      progreso({ hechos })
      await dormir(40)
    }
    await recargarIds()

    // Las reacciones de las personas reconocidas
    const filasDeReacciones: Array<{ mensaje_id: number; usuario_id: string; emoji: string }> = []
    for (const m of c.mensajes) {
      const mensajeId = ids.get(`${c.origenId}:${m.ts}`)
      if (!mensajeId) continue
      for (const r of m.reacciones) {
        const emoji = emojiDeSlack(r.emoji)
        if (!emoji) continue
        for (const u of r.usuarios) {
          const p = emparejados.get(u)
          if (p) filasDeReacciones.push({ mensaje_id: mensajeId, usuario_id: p, emoji })
        }
      }
    }
    for (let i = 0; i < filasDeReacciones.length; i += 1000) {
      await service.from('chat_reacciones').upsert(filasDeReacciones.slice(i, i + 1000), { onConflict: 'mensaje_id,usuario_id,emoji', ignoreDuplicates: true })
    }
    reacciones += filasDeReacciones.length
    mensajes += c.mensajes.length

    // El canal sube en la lista con la fecha de su último mensaje
    const ultimo = c.mensajes[c.mensajes.length - 1]
    if (ultimo) await service.from('chat_canales').update({ ultimo_mensaje_en: isoDeTs(ultimo.ts) }).eq('id', canalId)
  }
  progreso({ estado: 'listo', actual: '', resumen: { canales, mensajes, reacciones, omitidos } })
}
