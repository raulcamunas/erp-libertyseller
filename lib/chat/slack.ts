/**
 * LEER UNA EXPORTACIÓN DE SLACK — PURO. Slack entrega un .zip con `users.json`, `channels.json` (y, según el plan, `groups.json`, `mpims.json`, `dms.json`) y una carpeta por conversación con un
 * fichero por día (`2026-10-05.json`). Aquí se entiende esa estructura y se traduce el texto de Slack al del chat. Quien lo trae del .zip y lo escribe en la base es importar-servidor.ts.
 *
 * LO QUE NO SE TRAE: los archivos adjuntos (Slack no los incluye en la exportación, solo enlaces que piden sesión) y las cuentas que no son personas. De cada archivo se deja una línea
 * en el mensaje («📎 nombre») para que se sepa que existía.
 */

export interface UsuarioDeSlack {
  id: string
  nombre: string
  email: string | null
  esBot: boolean
}

export interface ReaccionDeSlack {
  emoji: string
  usuarios: string[]
}

export interface MensajeDeSlack {
  ts: string
  /** El id de Slack de quien lo escribió, si es una persona */
  usuarioId: string | null
  /** Si no es una persona del listado (un bot, una cuenta borrada): el nombre que traía */
  nombreExterno: string | null
  texto: string
  /** El `ts` del mensaje de arriba si es la respuesta de un hilo */
  hiloTs: string | null
  archivos: string[]
  reacciones: ReaccionDeSlack[]
}

export interface ConversacionDeSlack {
  /** Su id en Slack (`C0123…`, `G…`, `D…`): sirve para no importar dos veces lo mismo */
  origenId: string
  nombre: string
  tipo: 'canal' | 'privado' | 'directo'
  descripcion: string
  /** Los ids de Slack de sus miembros */
  miembros: string[]
  mensajes: MensajeDeSlack[]
}

export interface ExportacionDeSlack {
  usuarios: UsuarioDeSlack[]
  conversaciones: ConversacionDeSlack[]
  /** Cosas que no se han podido leer (un fichero roto…), para enseñarlas */
  avisos: string[]
}

/* ------------------------------------------------------------------ */
/* Emojis                                                              */
/* ------------------------------------------------------------------ */

const EMOJIS: Record<string, string> = {
  '+1': '👍', thumbsup: '👍', '-1': '👎', thumbsdown: '👎', heart: '❤️', joy: '😂', smile: '😄', smiley: '😃', grinning: '😀', laughing: '😆', sweat_smile: '😅', wink: '😉', blush: '😊',
  tada: '🎉', eyes: '👀', pray: '🙏', white_check_mark: '✅', heavy_check_mark: '✔️', x: '❌', fire: '🔥', rocket: '🚀', clap: '👏', muscle: '💪', handshake: '🤝', ok_hand: '👌',
  raised_hands: '🙌', thinking_face: '🤔', open_mouth: '😮', cry: '😢', sob: '😭', '100': '💯', zap: '⚡', warning: '⚠️', star: '⭐', sparkles: '✨', point_up: '☝️', wave: '👋',
  slightly_smiling_face: '🙂', upside_down_face: '🙃', neutral_face: '😐', confused: '😕', sunglasses: '😎', party_popper: '🎉', bulb: '💡', memo: '📝', calendar: '📅', pushpin: '📌',
  coffee: '☕', pizza: '🍕', beers: '🍻', trophy: '🏆', moneybag: '💰', chart_with_upwards_trend: '📈', mag: '🔍', lock: '🔒', bell: '🔔', phone: '☎️', email: '✉️',
}

/** «+1», «thumbsup::skin-tone-3» → «👍». Los que no se conocen salen como null (se dejan fuera) */
export function emojiDeSlack(nombre: string): string | null {
  const base = nombre.replace(/::skin-tone-\d$/, '').toLowerCase()
  return EMOJIS[base] ?? null
}

/* ------------------------------------------------------------------ */
/* Texto                                                               */
/* ------------------------------------------------------------------ */

export interface ContextoDeTexto {
  /** id de Slack → cómo se menciona en el chat: el id de perfil si se ha emparejado, o solo el nombre */
  menciones: ReadonlyMap<string, { perfilId: string | null; nombre: string }>
  /** id de canal de Slack → nombre */
  canales: ReadonlyMap<string, string>
}

const desescapar = (t: string) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/**
 * El texto de Slack al del chat: las menciones `<@U123>`, los canales `<#C123|nombre>`, los enlaces `<url|texto>`, `@here`/`@channel`, las negritas `*así*` (a `**así**`), el tachado
 * (se quita) y las entidades (`&amp;`). El código (`` ` `` y ```` ``` ````) se deja tal cual.
 */
export function convertirTexto(texto: string, ctx: ContextoDeTexto): string {
  const partes = texto.split(/(```[\s\S]*?```|`[^`\n]*`)/)
  return partes
    .map((parte, i) => {
      if (i % 2 === 1) return desescapar(parte)
      let t = parte.replace(/<([^>\n]+)>/g, (_, dentro: string) => {
        const [destino, rotulo] = dentro.split('|')
        if (destino.startsWith('@')) {
          const m = ctx.menciones.get(destino.slice(1))
          if (m) return m.perfilId ? `<@${m.perfilId}>` : `@${m.nombre}`
          return rotulo ? `@${rotulo.replace(/^@/, '')}` : '@alguien'
        }
        if (destino.startsWith('#')) return `#${rotulo ?? ctx.canales.get(destino.slice(1)) ?? 'canal'}`
        if (destino.startsWith('!')) {
          if (/^!(here|channel|everyone)$/.test(destino)) return '@todos'
          return rotulo ? rotulo.replace(/^@?/, '@') : ''
        }
        if (destino.startsWith('mailto:')) return rotulo ?? destino.slice(7)
        if (/^https?:\/\//i.test(destino)) return rotulo && rotulo !== destino ? `${rotulo} (${destino})` : destino
        return rotulo ?? destino
      })
      t = desescapar(t)
      t = t.replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, '**$1**').replace(/(?<![\w~])~([^~\n]+)~(?![\w~])/g, '$1')
      t = t.replace(/:([a-z0-9_+-]+)(?:::skin-tone-\d)?:/gi, (todo, nombre: string) => emojiDeSlack(nombre) ?? todo)
      return t
    })
    .join('')
}

/** El `ts` de Slack («1699999999.000200») a un instante ISO */
export function isoDeTs(ts: string): string {
  const [seg, frac = '0'] = ts.split('.')
  return new Date(Number(seg) * 1000 + Number(frac.slice(0, 3).padEnd(3, '0'))).toISOString()
}

/* ------------------------------------------------------------------ */
/* La exportación                                                      */
/* ------------------------------------------------------------------ */

const SUBTIPOS_QUE_NO_SON_MENSAJES = new Set(['channel_join', 'channel_leave', 'channel_topic', 'channel_purpose', 'channel_name', 'channel_archive', 'channel_unarchive', 'group_join', 'group_leave', 'group_topic', 'group_purpose', 'group_name', 'pinned_item', 'unpinned_item', 'reminder_add'])

const jsonDe = (t: string | undefined): unknown => {
  if (t === undefined) return undefined
  try {
    return JSON.parse(t)
  } catch {
    return undefined
  }
}
const lista = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object') : [])
const cadena = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * Entiende los ficheros de una exportación. `ficheros` es la ruta dentro del .zip → su texto. Las conversaciones que no tienen mensajes se descartan.
 */
export function leerExportacion(ficheros: ReadonlyMap<string, string>): ExportacionDeSlack {
  const avisos: string[] = []
  const usuarios: UsuarioDeSlack[] = lista(jsonDe(ficheros.get('users.json'))).map((u) => {
    const perfil = (u.profile ?? {}) as Record<string, unknown>
    return {
      id: cadena(u.id),
      nombre: cadena(u.real_name) || cadena(perfil.real_name) || cadena(u.name) || 'Alguien',
      email: cadena(perfil.email).toLowerCase() || null,
      esBot: u.is_bot === true || cadena(u.id) === 'USLACKBOT',
    }
  })
  const personaPorId = new Map(usuarios.map((u) => [u.id, u]))

  const conversaciones: ConversacionDeSlack[] = []
  const definir = (archivo: string, tipo: ConversacionDeSlack['tipo']) => {
    for (const c of lista(jsonDe(ficheros.get(archivo)))) {
      const id = cadena(c.id)
      if (!id) continue
      const miembros = Array.isArray(c.members) ? (c.members as unknown[]).filter((m): m is string => typeof m === 'string') : []
      const descripcion = cadena((c.purpose as { value?: unknown } | undefined)?.value) || cadena((c.topic as { value?: unknown } | undefined)?.value)
      // Los directos no traen nombre: se componen con las dos personas
      const nombre = cadena(c.name) || (tipo === 'directo' ? miembros.map((m) => personaPorId.get(m)?.nombre ?? m).join(' · ') : id)
      conversaciones.push({ origenId: id, nombre, tipo, descripcion, miembros, mensajes: [] })
    }
  }
  definir('channels.json', 'canal')
  definir('groups.json', 'privado')
  definir('mpims.json', 'privado')
  definir('dms.json', 'directo')

  // La carpeta de cada conversación se llama como ella (o como su id, en los directos)
  const carpetaDe = new Map<string, ConversacionDeSlack>()
  for (const c of conversaciones) {
    carpetaDe.set(c.nombre, c)
    carpetaDe.set(c.origenId, c)
  }
  for (const [ruta, texto] of [...ficheros.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const m = /^([^/]+)\/(\d{4}-\d{2}-\d{2})\.json$/.exec(ruta)
    if (!m) continue
    const conversacion = carpetaDe.get(m[1])
    if (!conversacion) continue
    const crudos = jsonDe(texto)
    if (!Array.isArray(crudos)) {
      avisos.push(`No se ha podido leer ${ruta}`)
      continue
    }
    for (const x of lista(crudos)) {
      if (x.type !== 'message' || !cadena(x.ts)) continue
      if (SUBTIPOS_QUE_NO_SON_MENSAJES.has(cadena(x.subtype))) continue
      const usuarioId = cadena(x.user) || null
      const persona = usuarioId ? personaPorId.get(usuarioId) : undefined
      const ts = cadena(x.ts)
      const hilo = cadena(x.thread_ts)
      conversacion.mensajes.push({
        ts,
        usuarioId: persona && !persona.esBot ? usuarioId : null,
        nombreExterno: persona && !persona.esBot ? null : persona?.nombre ?? (cadena(x.username) || cadena((x.user_profile as { real_name?: unknown } | undefined)?.real_name) || (usuarioId ? 'Alguien' : 'Bot')),
        texto: cadena(x.text),
        // Un mensaje es respuesta si su hilo es de otro; el de arriba tiene thread_ts = su propio ts
        hiloTs: hilo && hilo !== ts ? hilo : null,
        archivos: lista(x.files).map((f) => cadena(f.name) || cadena(f.title) || 'archivo').filter(Boolean),
        reacciones: lista(x.reactions).map((r) => ({ emoji: cadena(r.name), usuarios: Array.isArray(r.users) ? (r.users as unknown[]).filter((u): u is string => typeof u === 'string') : [] })),
      })
    }
  }
  for (const c of conversaciones) c.mensajes.sort((a, b) => Number(a.ts) - Number(b.ts))
  return { usuarios, conversaciones: conversaciones.filter((c) => c.mensajes.length > 0), avisos }
}
