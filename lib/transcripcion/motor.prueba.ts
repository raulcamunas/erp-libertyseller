import { ErrorRinkel } from '@/lib/rendimiento/rinkel'
import { ErrorDeAudio, MENSAJE_DE_AUDIO, type AudioDescargado } from '@/lib/transcripcion/audio'
import {
  clasificarFalloDeAudio,
  clasificarFalloDeRinkel,
  clasificarFalloDeVoz,
  procesarPendientes,
  resumenDeLaPasada,
  type Almacen,
  type AjustesDelMotor,
  type ClaveDeRinkel,
  type ContextoDeLaLlamada,
  type DepsDelMotor,
  type FalloParaGuardar,
  type FilaReservada,
  type LlamadaPendiente,
  type ResultadoDelMotor,
  type ResultadoParaGuardar,
  type TranscripcionParaGuardar,
} from '@/lib/transcripcion/motor'
import type { LeadParaRellamada } from '@/lib/transcripcion/rellamada'
import type { ResultadoDelResumen } from '@/lib/transcripcion/resumen'
import { ErrorDeVoz, MENSAJE_DE_VOZ, type ResultadoDeVoz } from '@/lib/transcripcion/voz'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * EL MOTOR CONTRA UN ALMACÉN EN MEMORIA Y PROVEEDORES FALSOS QUE FALLAN A PROPÓSITO.
 *
 * Lo que se vigila es lo que duele si falla: que una transcripción pagada no se vuelva a pagar, que un fallo de la CUENTA de la IA pare la pasada
 * en vez de gastar los intentos de todas las llamadas, que el tope diario pare de verdad y que dos pasadas no se pisen una llamada.
 */

const LARGA = 'Buenas tardes, hablo con la tienda Joe Black Pets, soy Maoli de Liberty Seller. Os llamo porque vendéis por internet y quería saber si habéis pensado en Amazon.'
const AHORA = Date.parse('2026-10-23T15:00:00Z')

interface Fila {
  estado: 'procesando' | 'hecha' | 'fallida' | 'omitida'
  intentos: number
  transcripcion: string | null
  segundos_audio: number | null
  idioma: string | null
  modelo_voz: string | null
  coste_voz_usd: number | null
  resultado: ResultadoParaGuardar | null
  fallo: FalloParaGuardar | null
}

const llamada = (n: number, extra: Partial<LlamadaPendiente> = {}): LlamadaPendiente => ({
  id: `llamada-${n}`,
  user_id: n % 2 === 0 ? 'ana' : 'beto',
  lead_id: `lead-${n}`,
  fecha: '2026-10-23T14:00:00Z',
  direccion: 'outbound',
  duracion_s: 60,
  grabacion_id: `grab-${n}`,
  intentos: 0,
  ...extra,
})

interface Mundo {
  almacen: Almacen
  deps: DepsDelMotor
  filas: Map<string, Fila>
  llamadasA: { claves: string[]; urls: string[]; audios: number; voz: number; resumen: number; reservas: string[] }
  reloj: { ahora: number }
  fallosDeAlmacen: Partial<Record<'reservar' | 'guardarTranscripcion' | 'guardarResultado' | 'leerAjustes' | 'leadParaRellamada' | 'ponerRellamada' | 'apuntarNota', boolean>>
  /** Los leads a los que se llamó, tal como los dejan las rellamadas */
  leads: Map<string, LeadParaRellamada>
  /** Las notas que se han escrito en las fichas */
  notas: Array<{ leadId: string; cuerpo: string }>
  enVuelo: { actual: number; maximo: number }
  encargos: Array<{ system: string; usuario: string }>
  pistas: Array<{ prompt: string; palabras: string }>
}

interface Config {
  pendientes: LlamadaPendiente[]
  ajustes?: Partial<AjustesDelMotor>
  gastado24h?: number
  filasIniciales?: Record<string, Partial<Fila>>
  claves?: Record<string, ClaveDeRinkel>
  /** Los leads de las llamadas (por id). Sin esto, un lead sin nada que decir: pendiente, de quien llamó y sin rellamada */
  leads?: Record<string, Partial<LeadParaRellamada>>
  festivos?: string[]
  /** Fuerza lo que contesta la base al poner la rellamada (por ejemplo 'no', como si alguien hubiera tocado la ficha entre medias) */
  ponerRellamadaDevuelve?: 'programado' | 'solo_fecha' | 'no'
  url?: (grabacion: string) => Promise<string>
  audio?: (url: string) => Promise<AudioDescargado>
  voz?: (n: number) => Promise<ResultadoDeVoz>
  resumen?: (n: number) => Promise<ResultadoDelResumen>
  /** Cuánto avanza el reloj falso con cada llamada a la voz (para probar el presupuesto de tiempo) */
  msPorVoz?: number
  latenciaMs?: number
}

const AUDIO: AudioDescargado = { bytes: Uint8Array.from([1, 2, 3]), extension: 'mp3', mime: 'audio/mpeg' }
const RESUMEN_BUENO: ResultadoDelResumen = {
  resumen: { tipo: 'conversacion', resumen: 'Se habló con Pedro, que ya vende en Amazon.', linea: [{ quien: 'cliente', texto: 'Ya vende con otra agencia.' }], siguiente_paso: 'Llamar el jueves a las 10', interes: 'alto' },
  modelo: 'gpt-6-luna',
  aviso: null,
  reintentable: false,
  general: false,
  tokens: { entrada: 981, salida: 489 },
  costeUsd: 0.00034,
}
/** Una llamada en la que el cliente pide que le llamen el jueves 29 (la llamada es del viernes 23) */
const CON_RELLAMADA = 'Hola, soy Pedro, de Joe Black Pets. Mira, ahora estamos con el cierre de mes, llámame el jueves a las diez y lo vemos con calma. Vale, perfecto, gracias, hasta el jueves, un saludo.'
const vozConRellamada = async (): Promise<ResultadoDeVoz> => ({ texto: CON_RELLAMADA, idiomas: ['es'], segundos: 60 })
const resumenConRellamada = (extra: Partial<NonNullable<NonNullable<ResultadoDelResumen['resumen']>['rellamada']>> = {}): ResultadoDelResumen => ({
  ...RESUMEN_BUENO,
  resumen: { ...RESUMEN_BUENO.resumen!, rellamada: { fecha: '2026-10-29', hora: '10:00', frase: 'llámame el jueves a las diez', ...extra } },
})
const SIN_RESUMEN = (aviso: string, extra: Partial<ResultadoDelResumen> = {}): ResultadoDelResumen => ({ resumen: null, modelo: 'gpt-6-luna', aviso, reintentable: true, general: false, tokens: null, costeUsd: 0, ...extra })

function mundo(c: Config): Mundo {
  const filas = new Map<string, Fila>()
  for (const [id, f] of Object.entries(c.filasIniciales ?? {})) {
    filas.set(id, { estado: 'fallida', intentos: 1, transcripcion: null, segundos_audio: null, idioma: null, modelo_voz: null, coste_voz_usd: null, resultado: null, fallo: null, ...f })
  }
  const reloj = { ahora: AHORA }
  const llamadasA = { claves: [] as string[], urls: [] as string[], audios: 0, voz: 0, resumen: 0, reservas: [] as string[] }
  const fallosDeAlmacen: Mundo['fallosDeAlmacen'] = {}
  const leads = new Map<string, LeadParaRellamada>()
  for (const l of c.pendientes) leads.set(l.lead_id, { status: 'pendiente', assignedTo: l.user_id, nextCallDate: null, ...c.leads?.[l.lead_id] })
  const notas: Mundo['notas'] = []
  const enVuelo = { actual: 0, maximo: 0 }
  const encargos: Mundo['encargos'] = []
  const pistas: Mundo['pistas'] = []
  const ajustes: AjustesDelMotor = { desde: '2026-10-01T00:00:00Z', minimo_segundos: 20, tope_diario_minutos: 400, ...c.ajustes }
  const espera = async () => {
    enVuelo.actual++
    enVuelo.maximo = Math.max(enVuelo.maximo, enVuelo.actual)
    if (c.latenciaMs) await new Promise((r) => setTimeout(r, c.latenciaMs))
    enVuelo.actual--
  }

  const almacen: Almacen = {
    async leerAjustes() {
      if (fallosDeAlmacen.leerAjustes) throw new Error('Falta lanzar la migración 244')
      return ajustes
    },
    async segundosDeLasUltimas24Horas() {
      return c.gastado24h ?? 0
    },
    async cerrarAbandonadas() {},
    async pendientes(_a, limite) {
      return c.pendientes.slice(0, limite)
    },
    async reservar(l): Promise<FilaReservada | null> {
      if (fallosDeAlmacen.reservar) throw new Error('la base no contesta')
      llamadasA.reservas.push(l.id)
      const f = filas.get(l.id)
      if (!f) {
        filas.set(l.id, { estado: 'procesando', intentos: 1, transcripcion: null, segundos_audio: null, idioma: null, modelo_voz: null, coste_voz_usd: null, resultado: null, fallo: null })
      } else if (f.estado === 'fallida') {
        f.estado = 'procesando'
        f.intentos++
      } else {
        return null
      }
      const g = filas.get(l.id)!
      return { intentos: g.intentos, transcripcion: g.transcripcion, segundos_audio: g.segundos_audio, idioma: g.idioma, modelo_voz: g.modelo_voz, coste_voz_usd: g.coste_voz_usd }
    },
    async contexto(l): Promise<ContextoDeLaLlamada> {
      return { empresa: `Tienda de ${l.lead_id}`, comercial: l.user_id === 'ana' ? 'Ana Uno' : 'Beto Dos' }
    },
    async guardarTranscripcion(id, t: TranscripcionParaGuardar) {
      if (fallosDeAlmacen.guardarTranscripcion) throw new Error('no se puede escribir')
      const f = filas.get(id)!
      f.transcripcion = t.texto
      f.segundos_audio = t.segundos
      f.idioma = t.idioma
      f.modelo_voz = t.modelo
      f.coste_voz_usd = t.costeUsd
    },
    async guardarResultado(id, r) {
      if (fallosDeAlmacen.guardarResultado) throw new Error('no se puede escribir')
      const f = filas.get(id)!
      f.estado = 'hecha'
      f.resultado = r
      f.transcripcion = r.transcripcion.texto
      f.segundos_audio = r.transcripcion.segundos
      f.coste_voz_usd = r.transcripcion.costeUsd
    },
    async marcarFallo(id, fl) {
      const f = filas.get(id)!
      f.estado = fl.estado
      f.fallo = fl
      if (fl.devolverIntento) f.intentos = Math.max(0, f.intentos - 1)
    },
    async leadParaRellamada(leadId) {
      if (fallosDeAlmacen.leadParaRellamada) throw new Error('la base no contesta')
      const l = leads.get(leadId)
      return l ? { ...l } : null
    },
    async festivos() {
      return c.festivos ?? []
    },
    // Lo mismo que hace el SQL: solo si el estado es de los que nadie lleva (o «En seguimiento», que solo recibe la fecha) y no tiene ya otra rellamada para más adelante
    async ponerRellamada(leadId, fecha, hoy) {
      if (fallosDeAlmacen.ponerRellamada) throw new Error('la base no contesta')
      if (c.ponerRellamadaDevuelve) return c.ponerRellamadaDevuelve
      const l = leads.get(leadId)
      if (!l) return 'no'
      const libre = l.nextCallDate === null || l.nextCallDate <= hoy || l.nextCallDate === fecha
      if (!libre) return 'no'
      if (['pendiente', 'no_contesta', 'programado', 'email_enviado'].includes(l.status)) {
        l.status = 'programado'
        l.nextCallDate = fecha
        return 'programado'
      }
      if (l.status === 'seguimiento') {
        l.nextCallDate = fecha
        return 'solo_fecha'
      }
      return 'no'
    },
    async apuntarNota(leadId, cuerpo) {
      if (fallosDeAlmacen.apuntarNota) throw new Error('la base no contesta')
      notas.push({ leadId, cuerpo })
    },
  }

  const deps: DepsDelMotor = {
    ahora: () => reloj.ahora,
    modeloDeVoz: 'gpt-transcribe',
    async claveDeRinkel(userId) {
      llamadasA.claves.push(userId)
      return c.claves?.[userId] ?? { clave: `clave-de-${userId}` }
    },
    async urlDeGrabacion(_clave, grabacionId) {
      llamadasA.urls.push(grabacionId)
      return c.url ? c.url(grabacionId) : `https://api.rinkel.com/v1/audio/${grabacionId}`
    },
    async bajarAudio(url) {
      llamadasA.audios++
      return c.audio ? c.audio(url) : AUDIO
    },
    async transcribir(_audio, p) {
      llamadasA.voz++
      pistas.push(p)
      await espera()
      reloj.ahora += c.msPorVoz ?? 0
      return c.voz ? c.voz(llamadasA.voz) : { texto: LARGA, idiomas: ['es'], segundos: 60 }
    },
    async resumir(encargo) {
      llamadasA.resumen++
      encargos.push(encargo)
      return c.resumen ? c.resumen(llamadasA.resumen) : RESUMEN_BUENO
    },
  }
  return { almacen, deps, filas, llamadasA, reloj, fallosDeAlmacen, leads, notas, enVuelo, encargos, pistas }
}

const pasada = (m: Mundo, op: Partial<{ presupuestoMs: number; limite: number; concurrencia: number }> = {}): Promise<ResultadoDelMotor> =>
  procesarPendientes(m.almacen, m.deps, { presupuestoMs: 150_000, ...op })

const run = async () => {
  console.log('\n=== el camino bueno ===')
  {
    const m = mundo({ pendientes: [llamada(1), llamada(2), llamada(3)] })
    const r = await pasada(m, { concurrencia: 1 })
    ok('las tres quedan hechas', r.candidatas === 3 && r.hechas === 3 && r.fallidas === 0 && r.omitidas === 0 && r.parada === null)
    const f = m.filas.get('llamada-1')!
    ok('la fila guarda estado, transcripción y resumen', f.estado === 'hecha' && f.transcripcion === LARGA && f.resultado?.resumen === 'Se habló con Pedro, que ya vende en Amazon.' && f.resultado?.interes === 'alto')
    ok('y lo que costó la voz (60 s con gpt-transcribe = 0,0045 $)', Math.abs((f.coste_voz_usd ?? 0) - 0.0045) < 1e-9 && f.resultado?.costeTextoUsd === 0.00034)
    ok('180 segundos de audio y el coste de las tres', r.segundos === 180 && Math.abs(r.costeUsd - 3 * (0.0045 + 0.00034)) < 1e-9, `${r.segundos} s · ${r.costeUsd}`)
    ok('la clave de Rinkel se pide UNA vez por persona (hay dos personas)', m.llamadasA.claves.length === 2 && new Set(m.llamadasA.claves).size === 2, m.llamadasA.claves.join())
    ok('el oído recibe el nombre de la tienda y el del comercial', m.pistas[0].palabras.includes('Tienda de lead-1') && m.pistas[0].prompt.includes('Beto, comercial'))
    ok('el resumen recibe la transcripción, la empresa y la duración', m.encargos[0].usuario.includes(LARGA) && m.encargos[0].usuario.includes('Tienda de lead-1') && m.encargos[0].usuario.includes('de 1 min 00 s'))
  }

  console.log('\n=== las que no merecen un resumen ===')
  {
    const m = mundo({ pendientes: [llamada(1)], voz: async () => ({ texto: '¿Diga? No, perdone.', idiomas: ['es'], segundos: 22 }) })
    const r = await pasada(m)
    ok('muy poco texto: se cierra sin llamar a la IA de texto', r.sinContenido === 1 && r.hechas === 0 && m.llamadasA.resumen === 0)
    const f = m.filas.get('llamada-1')!
    ok('queda «hecha» con tipo sin_contenido y la transcripción guardada', f.estado === 'hecha' && f.resultado?.tipo === 'sin_contenido' && f.resultado.resumen === null && f.transcripcion === '¿Diga? No, perdone.')
    ok('y se paga el audio igualmente (22 s)', r.segundos === 22 && r.costeUsd > 0)
  }
  {
    const m = mundo({ pendientes: [llamada(1)], voz: async () => ({ texto: '', idiomas: [], segundos: 45 }) })
    const r = await pasada(m)
    ok('puro ruido (texto vacío): sin contenido', r.sinContenido === 1 && m.llamadasA.resumen === 0)
  }
  {
    const buzon: ResultadoDelResumen = { ...RESUMEN_BUENO, resumen: { tipo: 'buzon_de_voz', resumen: 'Buzón de voz.', linea: [], siguiente_paso: null, interes: 'no_claro' } }
    const m = mundo({ pendientes: [llamada(1)], resumen: async () => buzon })
    const r = await pasada(m)
    ok('un buzón de voz es una llamada hecha con su tipo', r.hechas === 1 && m.filas.get('llamada-1')!.resultado?.tipo === 'buzon_de_voz')
  }
  {
    const sin: ResultadoDelResumen = { ...RESUMEN_BUENO, resumen: { tipo: 'sin_contenido', resumen: 'Nada aprovechable.', linea: [], siguiente_paso: null, interes: 'no_claro' } }
    const m = mundo({ pendientes: [llamada(1)], resumen: async () => sin })
    const r = await pasada(m)
    ok('si la IA dice «sin contenido» cuenta como tal', r.sinContenido === 1 && r.hechas === 0)
  }

  console.log('\n=== lo que no tiene arreglo se omite ===')
  {
    const m = mundo({ pendientes: [llamada(1)], url: async () => { throw new ErrorRinkel('no_encontrada', 'x', 404) } })
    const r = await pasada(m)
    const f = m.filas.get('llamada-1')!
    ok('Rinkel ya no tiene la grabación: omitida, sin reintento', r.omitidas === 1 && f.estado === 'omitida' && f.fallo?.siguienteIntentoAt === null && /Rinkel ya no tiene/.test(f.fallo?.motivo ?? ''))
    ok('y no se pagó ni un segundo de audio', m.llamadasA.voz === 0 && r.costeUsd === 0)
  }
  {
    const m = mundo({ pendientes: [llamada(1)], audio: async () => { throw new ErrorDeAudio('demasiado_grande', MENSAJE_DE_AUDIO.demasiado_grande) } })
    const r = await pasada(m)
    ok('audio de más de 24 MB: omitida', r.omitidas === 1 && m.filas.get('llamada-1')!.estado === 'omitida' && m.llamadasA.voz === 0)
  }
  {
    const m = mundo({ pendientes: [llamada(1)], voz: async () => { throw new ErrorDeVoz('audio', MENSAJE_DE_VOZ.audio, 400) } })
    const r = await pasada(m)
    ok('OpenAI no puede leer el audio: omitida', r.omitidas === 1 && m.filas.get('llamada-1')!.estado === 'omitida')
  }

  console.log('\n=== lo que se arregla solo se reintenta ===')
  {
    const m = mundo({ pendientes: [llamada(1)], url: async () => { throw new ErrorRinkel('servidor', 'x', 500) } })
    const r = await pasada(m)
    const f = m.filas.get('llamada-1')!
    ok('Rinkel caído: fallida, con turno a los 3 minutos', r.fallidas === 1 && f.estado === 'fallida' && f.fallo?.siguienteIntentoAt === new Date(AHORA + 3 * 60_000).toISOString())
  }
  {
    const m = mundo({ pendientes: [llamada(1)], claves: { beto: { sinClave: true } } })
    const r = await pasada(m)
    ok('la persona ya no tiene Rinkel vinculado: fallida con motivo claro', r.fallidas === 1 && /ya no está vinculada/.test(m.filas.get('llamada-1')!.fallo?.motivo ?? ''))
  }
  {
    const m = mundo({ pendientes: [llamada(1)], claves: { beto: { ilegible: true } } })
    const r = await pasada(m)
    ok('clave ilegible: fallida', r.fallidas === 1 && /No se ha podido leer la clave/.test(m.filas.get('llamada-1')!.fallo?.motivo ?? ''))
  }
  {
    const m = mundo({ pendientes: [llamada(1)], audio: async () => { throw new ErrorDeAudio('red', MENSAJE_DE_AUDIO.red) } })
    const r = await pasada(m)
    ok('no se puede bajar el audio: fallida', r.fallidas === 1 && m.filas.get('llamada-1')!.estado === 'fallida')
  }
  {
    const m = mundo({ pendientes: [llamada(1)], voz: async () => { throw new ErrorDeVoz('servidor', MENSAJE_DE_VOZ.servidor, 503) } })
    const r = await pasada(m)
    ok('OpenAI caído: fallida (y sin parar la pasada: es de esta llamada)', r.fallidas === 1 && r.parada === null)
  }
  {
    // Segundo fallo: 20 minutos; tercero: se acabó
    const m = mundo({ pendientes: [llamada(1)], filasIniciales: { 'llamada-1': { estado: 'fallida', intentos: 1 } }, url: async () => { throw new ErrorRinkel('red', 'x') } })
    await pasada(m)
    ok('segundo intento fallado: espera 20 minutos', m.filas.get('llamada-1')!.fallo?.siguienteIntentoAt === new Date(AHORA + 20 * 60_000).toISOString())
    const m3 = mundo({ pendientes: [llamada(1)], filasIniciales: { 'llamada-1': { estado: 'fallida', intentos: 2 } }, url: async () => { throw new ErrorRinkel('red', 'x') } })
    await pasada(m3)
    ok('tercer intento fallado: ya no hay siguiente', m3.filas.get('llamada-1')!.estado === 'fallida' && m3.filas.get('llamada-1')!.fallo?.siguienteIntentoAt === null)
  }

  console.log('\n=== una transcripción pagada no se paga dos veces ===')
  {
    let intento = 0
    const m = mundo({
      pendientes: [llamada(1)],
      resumen: async () => {
        intento++
        return intento === 1 ? SIN_RESUMEN('La IA tiene un problema ahora mismo.') : RESUMEN_BUENO
      },
    })
    const r1 = await pasada(m)
    const f = m.filas.get('llamada-1')!
    ok('primera pasada: la voz sale bien y el resumen falla -> fallida, pero la transcripción queda guardada', r1.fallidas === 1 && f.estado === 'fallida' && f.transcripcion === LARGA && m.llamadasA.voz === 1)
    ok('y esa pasada pagó el audio', r1.segundos === 60 && r1.costeUsd > 0)

    const r2 = await pasada(m)
    ok('segunda pasada: sale hecha', r2.hechas === 1 && f.estado === 'hecha' && f.intentos === 2)
    ok('SIN volver a bajar el audio ni a transcribir', m.llamadasA.voz === 1 && m.llamadasA.audios === 1 && m.llamadasA.urls.length === 1)
    ok('y esa pasada no gasta audio', r2.segundos === 0)
    ok('el resumen usa la transcripción guardada', m.encargos[1].usuario.includes(LARGA))
  }
  {
    // La primera escritura de la transcripción falla: se sigue y se guarda junto al resultado
    const m = mundo({ pendientes: [llamada(1)] })
    m.fallosDeAlmacen.guardarTranscripcion = true
    const r = await pasada(m)
    ok('si no se puede guardar la transcripción al momento, se sigue y se guarda con el resultado', r.hechas === 1 && m.filas.get('llamada-1')!.transcripcion === LARGA)
  }
  {
    const m = mundo({ pendientes: [llamada(1)] })
    m.fallosDeAlmacen.guardarResultado = true
    const r = await pasada(m)
    const f = m.filas.get('llamada-1')!
    ok('si no se puede guardar el resultado: fallida, con la transcripción ya guardada', r.fallidas === 1 && f.estado === 'fallida' && f.transcripcion === LARGA)
  }

  console.log('\n=== lo que es de la cuenta de la IA para la pasada ===')
  {
    const m = mundo({ pendientes: [llamada(1), llamada(2), llamada(3), llamada(4)], voz: async () => { throw new ErrorDeVoz('clave', MENSAJE_DE_VOZ.clave, 401) } })
    const r = await pasada(m, { concurrencia: 1 })
    ok('la clave de OpenAI falla: la pasada se para a la primera', r.parada === 'ia_no_disponible' && m.llamadasA.voz === 1 && r.aviso === MENSAJE_DE_VOZ.clave)
    ok('las demás ni se reservan', m.llamadasA.reservas.length === 1)
    const f = m.filas.get('llamada-1')!
    ok('la llamada en curso queda fallida SIN gastar su intento', f.estado === 'fallida' && f.intentos === 0 && f.fallo?.devolverIntento === true)
    ok('y reintenta a los 10 minutos', f.fallo?.siguienteIntentoAt === new Date(AHORA + 10 * 60_000).toISOString())
  }
  {
    const m = mundo({ pendientes: [llamada(1), llamada(2)], voz: async () => { throw new ErrorDeVoz('saldo', MENSAJE_DE_VOZ.saldo, 402) } })
    const r = await pasada(m, { concurrencia: 1 })
    ok('sin saldo: lo mismo', r.parada === 'ia_no_disponible' && m.llamadasA.voz === 1)
  }
  {
    const m = mundo({ pendientes: [llamada(1), llamada(2)], resumen: async () => SIN_RESUMEN('La clave de la IA no es válida.', { reintentable: false, general: true }) })
    const r = await pasada(m, { concurrencia: 1 })
    ok('el RESUMEN falla por la cuenta: también para la pasada, y la voz de la primera ya está guardada', r.parada === 'ia_no_disponible' && m.llamadasA.voz === 1 && m.filas.get('llamada-1')!.transcripcion === LARGA && m.filas.get('llamada-1')!.intentos === 0)
  }
  {
    const m = mundo({ pendientes: [llamada(1), llamada(2)], voz: async () => { throw new ErrorDeVoz('limite', MENSAJE_DE_VOZ.limite, 429) } })
    const r = await pasada(m, { concurrencia: 1 })
    ok('un límite de velocidad (429) NO es de la cuenta: se sigue con las demás', r.parada === null && r.fallidas === 2 && m.llamadasA.voz === 2)
  }

  console.log('\n=== dos pasadas a la vez ===')
  {
    const m = mundo({ pendientes: [llamada(1), llamada(2)], filasIniciales: { 'llamada-1': { estado: 'procesando', intentos: 1 } } })
    const r = await pasada(m, { concurrencia: 1 })
    ok('una llamada que tiene otra pasada se salta y no se paga', r.ajenas === 1 && r.hechas === 1 && m.llamadasA.voz === 1)
  }
  {
    const m = mundo({ pendientes: [llamada(1), llamada(2), llamada(3), llamada(4), llamada(5)], latenciaMs: 20 })
    await pasada(m, { concurrencia: 2 })
    ok('con concurrencia 2 nunca hay más de dos en vuelo', m.enVuelo.maximo === 2, String(m.enVuelo.maximo))
    ok('y se hacen las cinco', [...m.filas.values()].filter((f) => f.estado === 'hecha').length === 5)
  }

  console.log('\n=== el gasto ===')
  {
    const m = mundo({ pendientes: [llamada(1)], ajustes: { tope_diario_minutos: 10 }, gastado24h: 600 })
    const r = await pasada(m)
    ok('tope ya alcanzado: ni se miran las llamadas', r.parada === 'tope_diario' && r.candidatas === 0 && m.llamadasA.reservas.length === 0)
    ok('el resumen de la pasada lo dice con todas las letras', /PARADA: tope de 10 min/.test(resumenDeLaPasada(r)))
  }
  {
    // Caben 2 de 60 s en un tope de 150 s; la tercera no
    const m = mundo({ pendientes: [llamada(1), llamada(2), llamada(3)], ajustes: { tope_diario_minutos: 2.5 as unknown as number }, gastado24h: 0 })
    const r = await pasada(m, { concurrencia: 1 })
    ok('a mitad de pasada, la llamada que no cabe en el tope no se empieza', r.parada === 'tope_diario' && r.hechas === 2 && m.llamadasA.voz === 2, `${r.hechas} hechas, parada ${r.parada}`)
  }
  {
    const m = mundo({ pendientes: [llamada(1)], ajustes: { tope_diario_minutos: 0 } })
    const r = await pasada(m)
    ok('tope 0 = parado del todo', r.parada === 'tope_diario' && m.llamadasA.reservas.length === 0)
  }
  {
    const m = mundo({ pendientes: [llamada(1), llamada(2), llamada(3), llamada(4)], msPorVoz: 40_000 })
    const r = await pasada(m, { presupuestoMs: 100_000, concurrencia: 1 })
    ok('el presupuesto de tiempo: no se empiezan llamadas nuevas pasado el tiempo', r.hechas === 3 && r.parada === 'tiempo', `${r.hechas} hechas, parada ${r.parada}`)
    ok('y el resumen avisa de que quedan', /quedan llamadas/.test(resumenDeLaPasada(r)))
  }

  console.log('\n=== cuando falla la base ===')
  {
    const m = mundo({ pendientes: [llamada(1), llamada(2)] })
    m.fallosDeAlmacen.reservar = true
    const r = await pasada(m, { concurrencia: 1 })
    ok('si no se puede ni reservar: la pasada se para con aviso (la ruta la mostrará en rojo)', r.parada === 'error' && /base de datos/.test(r.aviso ?? '') && m.llamadasA.voz === 0)
  }
  {
    const m = mundo({ pendientes: [] })
    m.fallosDeAlmacen.leerAjustes = true
    let mensaje = ''
    try {
      await pasada(m)
    } catch (e) {
      mensaje = (e as Error).message
    }
    ok('sin migración la pasada FALLA con su motivo (no acaba «bien» sin hacer nada)', /migración 244/.test(mensaje))
  }

  console.log('\n=== sin nada que hacer ===')
  {
    const m = mundo({ pendientes: [] })
    const r = await pasada(m)
    ok('lista vacía: nada que transcribir', r.candidatas === 0 && r.parada === null && /Nada que transcribir/.test(resumenDeLaPasada(r)))
  }

  console.log('\n=== «llámame el jueves»: la rellamada del lead ===')
  {
    const m = mundo({ pendientes: [llamada(1)], voz: vozConRellamada, resumen: async () => resumenConRellamada() })
    const r = await pasada(m)
    const l = m.leads.get('lead-1')!
    ok('el lead pasa a «Rellamada programada» para el jueves 29', r.hechas === 1 && r.rellamadas === 1 && l.status === 'programado' && l.nextCallDate === '2026-10-29', JSON.stringify(l))
    ok('y una nota dice qué día, qué dijo el cliente y que lo ha puesto el ERP', m.notas.length === 1 && m.notas[0].leadId === 'lead-1' && /jue 29 oct/.test(m.notas[0].cuerpo) && /llámame el jueves a las diez/.test(m.notas[0].cuerpo) && /a las 10:00/.test(m.notas[0].cuerpo), m.notas[0]?.cuerpo)
    ok('la llamada queda hecha y no se paga nada de más', m.filas.get('llamada-1')!.estado === 'hecha' && m.llamadasA.resumen === 1 && m.llamadasA.voz === 1)
    ok('la pasada lo cuenta', /1 rellamada puesta/.test(resumenDeLaPasada(r)), resumenDeLaPasada(r))
  }
  {
    const m = mundo({ pendientes: [llamada(1)] })
    const r = await pasada(m)
    ok('si en la llamada no pidió nada, el lead no se toca y no se escribe nada', r.rellamadas === 0 && m.leads.get('lead-1')!.status === 'pendiente' && m.leads.get('lead-1')!.nextCallDate === null && m.notas.length === 0 && !/rellamada/.test(resumenDeLaPasada(r)))
  }
  {
    const m = mundo({ pendientes: [llamada(1)], voz: vozConRellamada, resumen: async () => resumenConRellamada(), leads: { 'lead-1': { status: 'programado', nextCallDate: '2026-11-05' } } })
    const r = await pasada(m)
    ok('si ya tenía otra rellamada para más adelante (la habrá puesto el comercial), gana ella y queda una nota', r.rellamadas === 0 && m.leads.get('lead-1')!.nextCallDate === '2026-11-05' && m.notas.length === 1 && /ya tenía una rellamada/.test(m.notas[0].cuerpo), m.notas[0]?.cuerpo)
    ok('y la llamada sigue hecha', r.hechas === 1 && m.filas.get('llamada-1')!.estado === 'hecha')
  }
  {
    const m = mundo({ pendientes: [llamada(1)], voz: vozConRellamada, resumen: async () => resumenConRellamada(), leads: { 'lead-1': { assignedTo: 'ana' } } })
    const r = await pasada(m)
    ok('un lead de otra persona no se toca (la llamó beto, es de ana): solo una nota', r.rellamadas === 0 && m.leads.get('lead-1')!.status === 'pendiente' && m.leads.get('lead-1')!.nextCallDate === null && m.notas.length === 1 && /otra persona/.test(m.notas[0].cuerpo))
  }
  {
    const m = mundo({ pendientes: [llamada(1)], voz: vozConRellamada, resumen: async () => resumenConRellamada(), leads: { 'lead-1': { status: 'seguimiento' } } })
    const r = await pasada(m)
    ok('«En seguimiento» solo recibe la fecha, el estado se queda', r.rellamadas === 1 && m.leads.get('lead-1')!.status === 'seguimiento' && m.leads.get('lead-1')!.nextCallDate === '2026-10-29')
  }
  {
    const m = mundo({ pendientes: [llamada(1)], voz: vozConRellamada, resumen: async () => resumenConRellamada({ frase: 'llámame el viernes por la tarde' }) })
    const r = await pasada(m)
    ok('si las palabras que cita la IA no están en la llamada, no se programa nada y no hay ni nota', r.rellamadas === 0 && m.leads.get('lead-1')!.status === 'pendiente' && m.notas.length === 0 && m.filas.get('llamada-1')!.estado === 'hecha')
  }
  {
    const m = mundo({ pendientes: [llamada(1)], voz: vozConRellamada, resumen: async () => resumenConRellamada({ fecha: '2026-10-30' }) })
    const r = await pasada(m)
    ok('dijo «el jueves» y la IA da un viernes: no se programa a ciegas, solo una nota para que lo mire una persona', r.rellamadas === 0 && m.leads.get('lead-1')!.nextCallDate === null && m.notas.length === 1 && /No se ha puesto ninguna rellamada/.test(m.notas[0].cuerpo))
  }
  {
    const m = mundo({ pendientes: [llamada(1)], voz: vozConRellamada, resumen: async () => resumenConRellamada(), festivos: ['2026-10-29'] })
    await pasada(m)
    ok('si el día pedido es festivo, pasa al siguiente hábil', m.leads.get('lead-1')!.nextCallDate === '2026-10-30')
  }
  {
    const m = mundo({ pendientes: [llamada(1)], resumen: async () => resumenConRellamada(), filasIniciales: { 'llamada-1': { estado: 'fallida', intentos: 1, transcripcion: CON_RELLAMADA, segundos_audio: 60, idioma: 'es', modelo_voz: 'gpt-transcribe', coste_voz_usd: 0.0045 } } })
    const r = await pasada(m)
    ok('si el resumen se hizo en un segundo intento, con la transcripción ya guardada, también se programa (y sin volver a pagar la voz)', r.rellamadas === 1 && m.llamadasA.voz === 0 && m.leads.get('lead-1')!.nextCallDate === '2026-10-29')
  }
  {
    const m = mundo({ pendientes: [llamada(1)], voz: vozConRellamada, resumen: async () => resumenConRellamada(), ponerRellamadaDevuelve: 'no' })
    const r = await pasada(m)
    ok('si entre leer el lead y escribirle alguien lo ha movido, no se toca y queda una nota', r.rellamadas === 0 && m.notas.length === 1 && /ha cambiado mientras tanto/.test(m.notas[0].cuerpo))
  }
  for (const [que, fallo] of [['no se puede leer el lead', 'leadParaRellamada'], ['no se puede escribir la rellamada', 'ponerRellamada']] as const) {
    const m = mundo({ pendientes: [llamada(1)], voz: vozConRellamada, resumen: async () => resumenConRellamada() })
    m.fallosDeAlmacen[fallo] = true
    const r = await pasada(m)
    ok(`si ${que}, la llamada sigue HECHA (no se marca fallida ni se paga otro resumen) y la pasada no falla`, r.hechas === 1 && r.fallidas === 0 && r.rellamadas === 0 && r.parada === null && m.filas.get('llamada-1')!.estado === 'hecha' && m.llamadasA.resumen === 1)
  }

  console.log('\n=== el texto de la pasada ===')
  {
    const base: ResultadoDelMotor = { candidatas: 5, hechas: 3, rellamadas: 0, sinContenido: 1, omitidas: 1, fallidas: 0, ajenas: 0, segundos: 330, costeUsd: 0.0312, parada: null, aviso: null, segundos24h: 1200, topeMinutos: 400 }
    const t = resumenDeLaPasada(base)
    ok('cuenta lo hecho, lo omitido, los minutos y el dinero', /4 transcritas \(1 sin contenido\)/.test(t) && /1 omitida/.test(t) && /5,5 min de audio · 0,031 \$/.test(t), t)
    ok('y cuánto del tope se lleva (20 + 5,5 min de 400)', /24 h: 26 de 400 min/.test(t), t)
    ok('una sola transcrita va en singular', /1 transcrita /.test(resumenDeLaPasada({ ...base, hechas: 1, sinContenido: 0, omitidas: 0 })))
    const ia = resumenDeLaPasada({ ...base, parada: 'ia_no_disponible', aviso: MENSAJE_DE_VOZ.saldo })
    ok('una parada por la IA lleva su motivo', /PARADA: La cuenta de OpenAI se ha quedado sin saldo/.test(ia), ia)
  }

  console.log('\n=== cómo se clasifica cada fallo ===')
  {
    ok('Rinkel 404 -> terminal', clasificarFalloDeRinkel(new ErrorRinkel('no_encontrada', 'x', 404)).terminal)
    ok('Rinkel clave inválida -> reintentable', !clasificarFalloDeRinkel(new ErrorRinkel('clave_invalida', 'x', 401)).terminal)
    ok('Rinkel: un error cualquiera -> reintentable', !clasificarFalloDeRinkel(new Error('raro')).terminal)
    ok('audio demasiado grande, formato y host -> terminales', ['demasiado_grande', 'formato', 'host'].every((c) => clasificarFalloDeAudio(new ErrorDeAudio(c as 'formato', 'x')).terminal))
    ok('audio vacío y de red -> reintentables', ['vacio', 'red'].every((c) => !clasificarFalloDeAudio(new ErrorDeAudio(c as 'red', 'x')).terminal))
    ok('voz: audio -> terminal; clave y saldo -> generales', clasificarFalloDeVoz(new ErrorDeVoz('audio', 'x')).terminal && clasificarFalloDeVoz(new ErrorDeVoz('clave', 'x')).general === true && clasificarFalloDeVoz(new ErrorDeVoz('saldo', 'x')).general === true)
    ok('voz: red, servidor y límite -> reintentables y no generales', ['red', 'servidor', 'limite'].every((c) => { const k = clasificarFalloDeVoz(new ErrorDeVoz(c as 'red', 'x')); return !k.terminal && !k.general }))
  }
}

run().then(
  () => {
    console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
    if (fallos > 0) process.exit(1)
  },
  (e) => {
    console.error('Explotó la prueba:', e)
    process.exit(1)
  }
)
