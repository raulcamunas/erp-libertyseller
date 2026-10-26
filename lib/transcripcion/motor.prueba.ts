import { ErrorRinkel } from '@/lib/rendimiento/rinkel'
import { ErrorDeAudio, MENSAJE_DE_AUDIO, type AudioDescargado } from '@/lib/transcripcion/audio'
import {
  clasificarFalloDeAudio,
  clasificarFalloDeRinkel,
  clasificarFalloDeVoz,
  procesarPendientes,
  resumenDeLaPasada,
  FALTA_MIGRACION_TURNOS,
  TURNOS_POR_PASADA,
  type Almacen,
  type AjustesDelMotor,
  type ClaveDeRinkel,
  type ContextoDeLaLlamada,
  type DepsDelMotor,
  type FalloParaGuardar,
  type FilaReservada,
  type LlamadaPendiente,
  type LlamadaSinTurnos,
  type ResultadoDelMotor,
  type ResultadoParaGuardar,
  type TranscripcionParaGuardar,
} from '@/lib/transcripcion/motor'
import type { LeadParaRellamada } from '@/lib/transcripcion/rellamada'
import type { ResultadoDelResumen } from '@/lib/transcripcion/resumen'
import { INTENTOS_DE_TURNOS, type ResultadoDeTurnos } from '@/lib/transcripcion/turnos'
import type { TurnoDeLaLlamada } from '@/lib/transcripcion/tipos'
import { ErrorDeVoz, MENSAJE_DE_VOZ, type ResultadoDeVoz } from '@/lib/transcripcion/voz'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const j = (x: unknown) => JSON.stringify(x)

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
  fallosDeAlmacen: Partial<Record<'reservar' | 'guardarTranscripcion' | 'guardarResultado' | 'leerAjustes' | 'leadParaRellamada' | 'ponerRellamada' | 'cerrarLead' | 'apuntarNota' | 'pendientesDeTurnos' | 'faltaLa253' | 'guardarTurnos', boolean>>
  /** Las conversaciones con su estado de turnos, tal como las deja el motor */
  turnos: Map<string, { intentos: number; turnos: TurnoDeLaLlamada[] | null; modelo: string | null }>
  /** Lo que se le ha pedido a la IA para separar quién habla */
  encargosDeTurnos: Array<{ system: string; usuario: string; frases: number }>
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
  /** Conversaciones ya resumidas a las que les faltan los turnos (por id de llamada) */
  sinTurnos?: Array<Partial<LlamadaSinTurnos> & { llamadaId: string }>
  /** Lo que contesta la IA al separar (por número de petición, desde 1). Por defecto, un turno de cada lado */
  turnosDeLaIa?: (n: number, frases: number) => Promise<ResultadoDeTurnos>
  /** Los leads de las llamadas (por id). Sin esto, un lead sin nada que decir: pendiente, de quien llamó y sin rellamada */
  leads?: Record<string, Partial<LeadParaRellamada>>
  festivos?: string[]
  /** Fuerza lo que contesta la base al poner la rellamada (por ejemplo 'no', como si alguien hubiera tocado la ficha entre medias) */
  ponerRellamadaDevuelve?: 'programado' | 'solo_fecha' | 'no'
  /** Fuerza lo que contesta la base al cerrar el lead (false = alguien ha tocado la ficha entre medias) */
  cerrarLeadDevuelve?: boolean
  url?: (grabacion: string) => Promise<string>
  audio?: (url: string) => Promise<AudioDescargado>
  voz?: (n: number) => Promise<ResultadoDeVoz>
  resumen?: (n: number) => Promise<ResultadoDelResumen>
  /** Cuánto avanza el reloj falso con cada llamada a la voz (para probar el presupuesto de tiempo) */
  msPorVoz?: number
  /** Lo mismo con cada petición para separar quién habla */
  msPorTurno?: number
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
/** LARGA son dos frases: la IA dice que la primera es del comercial y la segunda del cliente */
const TURNOS_BUENOS: ResultadoDeTurnos = { marcas: [{ desde: 1, quien: 'comercial' }, { desde: 2, quien: 'cliente' }], modelo: 'gpt-6-luna', aviso: null, reintentable: false, general: false, costeUsd: 0.00015 }
const SIN_TURNOS = (aviso: string, extra: Partial<ResultadoDeTurnos> = {}): ResultadoDeTurnos => ({ marcas: null, modelo: 'gpt-6-luna', aviso, reintentable: true, general: false, costeUsd: 0, ...extra })
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
  const turnos: Mundo['turnos'] = new Map((c.sinTurnos ?? []).map((p) => [p.llamadaId, { intentos: p.intentos ?? 0, turnos: null, modelo: null }]))
  const encargosDeTurnos: Mundo['encargosDeTurnos'] = []
  let peticionesDeTurnos = 0
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
    // Lo mismo que hace el SQL: «Sin contactar», «No contesta» e «Info enviada» siempre; «Rellamada programada» solo con el día de hoy, ya pasado o sin día
    async cerrarLead(leadId, hoy) {
      if (fallosDeAlmacen.cerrarLead) throw new Error('la base no contesta')
      if (c.cerrarLeadDevuelve === false) return false
      const l = leads.get(leadId)
      if (!l) return false
      const cierra = ['pendiente', 'no_contesta', 'email_enviado'].includes(l.status) || (l.status === 'programado' && (l.nextCallDate === null || l.nextCallDate <= hoy))
      if (cierra) l.status = 'no_interesa'
      return cierra
    },
    async apuntarNota(leadId, cuerpo) {
      if (fallosDeAlmacen.apuntarNota) throw new Error('la base no contesta')
      notas.push({ leadId, cuerpo })
    },
    async pendientesDeTurnos(limite) {
      if (fallosDeAlmacen.faltaLa253) throw new Error(FALTA_MIGRACION_TURNOS)
      if (fallosDeAlmacen.pendientesDeTurnos) throw new Error('la base no contesta')
      return (c.sinTurnos ?? [])
        .filter((p) => turnos.get(p.llamadaId)?.turnos === null && (turnos.get(p.llamadaId)?.intentos ?? 0) < INTENTOS_DE_TURNOS)
        .slice(0, limite)
        .map((p) => ({ transcripcion: LARGA, intentos: turnos.get(p.llamadaId)!.intentos, direccion: 'outbound', duracionS: 60, comercial: 'Beto Dos', empresa: 'Tienda', ...p }))
    },
    async reservarTurnos(p) {
      const t = turnos.get(p.llamadaId)
      // Como en la base: solo si sigue con los intentos con los que se leyó
      if (!t || t.turnos !== null || t.intentos !== p.intentos) return false
      t.intentos++
      return true
    },
    async guardarTurnos(llamadaId, t) {
      if (fallosDeAlmacen.guardarTurnos) throw new Error('no se puede escribir')
      const f = turnos.get(llamadaId)!
      f.turnos = t.turnos
      f.modelo = t.modelo
    },
    async devolverIntentoDeTurnos(llamadaId) {
      const f = turnos.get(llamadaId)!
      f.intentos = Math.max(0, f.intentos - 1)
    },
    async abandonarTurnos(llamadaId) {
      // Como en la base: intentos agotados, turnos sin tocar
      turnos.get(llamadaId)!.intentos = INTENTOS_DE_TURNOS
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
    async separar(encargo, frases) {
      peticionesDeTurnos++
      encargosDeTurnos.push({ ...encargo, frases })
      reloj.ahora += c.msPorTurno ?? 0
      return c.turnosDeLaIa ? c.turnosDeLaIa(peticionesDeTurnos, frases) : TURNOS_BUENOS
    },
  }
  return { almacen, deps, filas, llamadasA, reloj, fallosDeAlmacen, leads, notas, turnos, encargosDeTurnos, enVuelo, encargos, pistas }
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

  console.log('\n=== «no me interesa»: el lead pasa solo a «No le interesa» ===')
  {
    const CON_RECHAZO = 'Hola, soy Pedro, de Joe Black Pets. Mira, os agradezco la llamada pero no necesitamos el servicio ni queremos asumir ningún coste adicional, así que no nos interesa. Gracias, adiós.'
    const vozConRechazo = async (): Promise<ResultadoDeVoz> => ({ texto: CON_RECHAZO, idiomas: ['es'], segundos: 60 })
    const sinInteres = (extra: Partial<NonNullable<ResultadoDelResumen['resumen']>> = {}): ResultadoDelResumen => ({
      ...RESUMEN_BUENO,
      resumen: { ...RESUMEN_BUENO.resumen!, interes: 'ninguno', siguiente_paso: null, rechazo: { frase: 'no necesitamos el servicio' }, ...extra },
    })
    const lleva = (m: Mundo, id = 'lead-1') => m.leads.get(id)!

    // El caso de siempre
    {
      const m = mundo({ pendientes: [llamada(1)], voz: vozConRechazo, resumen: async () => sinInteres() })
      const r = await pasada(m)
      ok('un «no» claro pasa el lead a «No le interesa» y se cuenta', r.hechas === 1 && r.cerrados === 1 && lleva(m).status === 'no_interesa' && r.rellamadas === 0, `${r.cerrados} · ${lleva(m).status}`)
      ok('la ficha lo cuenta: qué dijo, que lo ha hecho el ERP solo y cómo deshacerlo', m.notas.length === 1 && /no le interesa/.test(m.notas[0].cuerpo) && m.notas[0].cuerpo.includes('«no necesitamos el servicio»') && /automáticamente/.test(m.notas[0].cuerpo) && /cámbialo/.test(m.notas[0].cuerpo), m.notas[0]?.cuerpo ?? '')
      ok('el texto de la pasada lo dice', /1 lead pasado a «No le interesa»/.test(resumenDeLaPasada(r)), resumenDeLaPasada(r))
      ok('y en plural', /2 leads pasados a «No le interesa»/.test(resumenDeLaPasada({ ...r, cerrados: 2 })))
      ok('la llamada queda HECHA y su resumen guardado tal cual (el interés sigue siendo «ninguno»)', m.filas.get('llamada-1')!.estado === 'hecha' && m.filas.get('llamada-1')!.resultado?.interes === 'ninguno')
    }
    // Todos los estados que nadie lleva
    for (const status of ['pendiente', 'no_contesta', 'email_enviado']) {
      const m = mundo({ pendientes: [llamada(1)], voz: vozConRechazo, resumen: async () => sinInteres(), leads: { 'lead-1': { status } } })
      const r = await pasada(m)
      ok(`un lead en «${status}» se cierra`, r.cerrados === 1 && lleva(m).status === 'no_interesa')
    }
    // El caso de la captura: «Sin contactar» con un día de rellamada suelto. Se cierra, y el día se queda guardado
    {
      const m = mundo({ pendientes: [llamada(1)], voz: vozConRechazo, resumen: async () => sinInteres(), leads: { 'lead-1': { status: 'pendiente', nextCallDate: '2026-11-02' } } })
      const r = await pasada(m)
      ok('«Sin contactar» con un día de rellamada suelto se cierra y NO se borra el día', r.cerrados === 1 && lleva(m).status === 'no_interesa' && lleva(m).nextCallDate === '2026-11-02')
      ok('la nota avisa de que el día sigue guardado', /sigue guardado/.test(m.notas[0].cuerpo), m.notas[0].cuerpo)
    }
    // «Rellamada programada»: solo si su día ya llegó
    {
      const m = mundo({ pendientes: [llamada(1)], voz: vozConRechazo, resumen: async () => sinInteres(), leads: { 'lead-1': { status: 'programado', nextCallDate: '2026-11-02' } } })
      const r = await pasada(m)
      ok('con una rellamada por delante NO se cierra: lo programó una persona pensando en esta llamada. Se avisa en una nota', r.cerrados === 0 && lleva(m).status === 'programado' && m.notas.length === 1 && /rellamada puesta para el/.test(m.notas[0].cuerpo), m.notas[0]?.cuerpo ?? '')
      ok('y la llamada sigue hecha, la pasada sin fallos', r.hechas === 1 && r.fallidas === 0 && r.parada === null)
    }
    {
      // El reloj de estas pruebas marca el viernes 23 de octubre: la rellamada de hoy es la que se acaba de hacer
      const m = mundo({ pendientes: [llamada(1)], voz: vozConRechazo, resumen: async () => sinInteres(), leads: { 'lead-1': { status: 'programado', nextCallDate: '2026-10-23' } } })
      const r = await pasada(m)
      ok('con la rellamada de hoy (la que se acaba de hacer) sí se cierra', r.cerrados === 1 && lleva(m).status === 'no_interesa')
      const m2 = mundo({ pendientes: [llamada(1)], voz: vozConRechazo, resumen: async () => sinInteres(), leads: { 'lead-1': { status: 'programado', nextCallDate: '2026-10-20' } } })
      ok('y con una ya vencida, también', (await pasada(m2)).cerrados === 1 && lleva(m2).status === 'no_interesa')
    }
    // Lo que lleva una persona
    for (const status of ['seguimiento', 'cita_cualificada']) {
      const m = mundo({ pendientes: [llamada(1)], voz: vozConRechazo, resumen: async () => sinInteres(), leads: { 'lead-1': { status } } })
      const r = await pasada(m)
      ok(`un lead en «${status}» NO se cierra y se avisa con una nota`, r.cerrados === 0 && lleva(m).status === status && m.notas.length === 1 && /no se ha cambiado/.test(m.notas[0].cuerpo), m.notas[0]?.cuerpo ?? '')
    }
    {
      const m = mundo({ pendientes: [llamada(1)], voz: vozConRechazo, resumen: async () => sinInteres(), leads: { 'lead-1': { assignedTo: 'otra-persona' } } })
      const r = await pasada(m)
      ok('el lead de otra persona NO se toca: nota', r.cerrados === 0 && lleva(m).status === 'pendiente' && /de otra persona/.test(m.notas[0]?.cuerpo ?? ''))
    }
    {
      const m = mundo({ pendientes: [llamada(1)], voz: vozConRechazo, resumen: async () => sinInteres(), leads: { 'lead-1': { status: 'no_interesa' } } })
      const r = await pasada(m)
      ok('uno que ya estaba en «No le interesa» no se cuenta ni deja nota', r.cerrados === 0 && m.notas.length === 0)
    }
    // Lo que no se puede comprobar
    {
      const m = mundo({ pendientes: [llamada(1)], voz: vozConRechazo, resumen: async () => sinInteres({ rechazo: { frase: 'ahora mismo no estamos interesados para nada' } }) })
      const r = await pasada(m)
      ok('unas palabras que no están en la llamada no cierran nada y dejan una nota (no se calla)', r.cerrados === 0 && lleva(m).status === 'pendiente' && /no se ha podido comprobar/.test(m.notas[0]?.cuerpo ?? ''), m.notas[0]?.cuerpo ?? '')
    }
    {
      const m = mundo({ pendientes: [llamada(1)], voz: vozConRechazo, resumen: async () => sinInteres({ rechazo: null }) })
      const r = await pasada(m)
      ok('«sin interés» sin sus palabras: tampoco cierra, y lo dice', r.cerrados === 0 && lleva(m).status === 'pendiente' && m.notas.length === 1)
    }
    // Lo que pasa cuando el cliente también pide un día, o no hay rechazo
    {
      const m = mundo({ pendientes: [llamada(1)], voz: vozConRellamada, resumen: async () => ({ ...resumenConRellamada(), resumen: { ...resumenConRellamada().resumen!, interes: 'ninguno', rechazo: { frase: 'llámame el jueves a las diez' } } }) })
      const r = await pasada(m)
      ok('si pide que le llamen un día, manda la rellamada: se programa y NO se cierra', r.rellamadas === 1 && r.cerrados === 0 && lleva(m).status === 'programado')
    }
    {
      const m = mundo({ pendientes: [llamada(1)], voz: vozConRechazo, resumen: async () => ({ ...RESUMEN_BUENO, resumen: { ...RESUMEN_BUENO.resumen!, interes: 'bajo' } }) })
      const r = await pasada(m)
      ok('con interés «bajo» (tibio) no se hace nada, ni se lee el lead', r.cerrados === 0 && m.notas.length === 0 && lleva(m).status === 'pendiente')
    }
    {
      const m = mundo({ pendientes: [llamada(1)], voz: vozConRechazo })
      const r = await pasada(m)
      ok('una llamada con interés alto (la de siempre) no toca nada', r.cerrados === 0 && m.notas.length === 0)
    }
    // Fallos
    {
      const m = mundo({ pendientes: [llamada(1)], voz: vozConRechazo, resumen: async () => sinInteres(), cerrarLeadDevuelve: false })
      const r = await pasada(m)
      ok('si entre leer el lead y escribirle alguien lo ha movido, no se cierra y se avisa', r.cerrados === 0 && /ha cambiado mientras tanto/.test(m.notas[0]?.cuerpo ?? '') && m.filas.get('llamada-1')!.estado === 'hecha')
    }
    for (const [que, fallo] of [['no se puede leer el lead', 'leadParaRellamada'], ['no se puede escribir el cierre', 'cerrarLead']] as const) {
      const registros: string[] = []
      const original = console.error
      console.error = (...a: unknown[]) => registros.push(JSON.stringify(a))
      const m = mundo({ pendientes: [llamada(1)], voz: vozConRechazo, resumen: async () => sinInteres() })
      m.fallosDeAlmacen[fallo] = true
      const r = await pasada(m)
      console.error = original
      ok(`si ${que}, la llamada sigue HECHA (no se marca fallida ni se paga otro resumen) y la pasada no falla`, r.hechas === 1 && r.fallidas === 0 && r.cerrados === 0 && r.parada === null && m.filas.get('llamada-1')!.estado === 'hecha' && m.llamadasA.resumen === 1)
      ok('y lo que se apunta en la consola no trae lo que se dijo en la llamada', !/Pedro|Joe Black|necesitamos/.test(registros.join(' ')), registros.join(' '))
    }
    // Varias llamadas en la misma pasada
    {
      const m = mundo({ pendientes: [llamada(1), llamada(2), llamada(3)], voz: vozConRechazo, resumen: async (n) => (n === 2 ? RESUMEN_BUENO : sinInteres()) })
      const r = await pasada(m)
      ok('de tres llamadas, a dos les dijeron que no: se cierran dos', r.hechas === 3 && r.cerrados === 2 && lleva(m, 'lead-1').status === 'no_interesa' && lleva(m, 'lead-2').status === 'pendiente' && lleva(m, 'lead-3').status === 'no_interesa', `${r.cerrados}`)
    }
  }

  console.log('\n=== quién habla en la transcripción entera ===')
  {
    const pendientes = (n: number, extra: Partial<LlamadaSinTurnos> = {}) => Array.from({ length: n }, (_, i) => ({ llamadaId: `conv-${i + 1}`, ...extra }))
    const hecha = (m: Mundo, id: string) => m.turnos.get(id)!

    // El camino bueno: las tres conversaciones ya resumidas se separan en una pasada sin llamadas nuevas
    {
      const m = mundo({ pendientes: [], sinTurnos: pendientes(3) })
      const r = await pasada(m)
      ok('las tres se separan y se cuentan', r.turnos === 3 && r.avisoDeTurnos === null && m.encargosDeTurnos.length === 3, `${r.turnos} · ${m.encargosDeTurnos.length}`)
      ok('cada una queda con sus dos turnos: el comercial abre, el cliente contesta, con el texto de la transcripción íntegro', j(hecha(m, 'conv-1').turnos) === j([{ quien: 'comercial', texto: 'Buenas tardes, hablo con la tienda Joe Black Pets, soy Maoli de Liberty Seller.' }, { quien: 'cliente', texto: 'Os llamo porque vendéis por internet y quería saber si habéis pensado en Amazon.' }]), j(hecha(m, 'conv-1').turnos))
      ok('y el modelo con el que se hizo', hecha(m, 'conv-1').modelo === 'gpt-6-luna')
      ok('a la IA le llegan las frases numeradas, el comercial y la tienda', m.encargosDeTurnos[0].frases === 2 && m.encargosDeTurnos[0].usuario.includes('[1] Buenas tardes') && m.encargosDeTurnos[0].usuario.includes('[2] Os llamo') && m.encargosDeTurnos[0].usuario.includes('Comercial de Liberty Seller: Beto Dos') && m.encargosDeTurnos[0].usuario.includes('Empresa a la que se llama: Tienda'))
      ok('el gasto de la pasada incluye el de los turnos (3 × 0,00015 $)', Math.abs(r.costeUsd - 3 * 0.00015) < 1e-9, String(r.costeUsd))
      ok('el texto de la pasada lo cuenta', /3 conversaciones separadas por quién habla/.test(resumenDeLaPasada(r)) && /Nada que transcribir/.test(resumenDeLaPasada(r)), resumenDeLaPasada(r))
      const r2 = await pasada(m)
      ok('la siguiente pasada ya no tiene nada que separar (no se paga dos veces)', r2.turnos === 0 && m.encargosDeTurnos.length === 3)
    }

    // En la misma pasada: primero las llamadas nuevas, después los turnos
    {
      const m = mundo({ pendientes: [llamada(1)], sinTurnos: pendientes(2) })
      const r = await pasada(m)
      ok('una llamada nueva se transcribe y, a continuación, se separan las que esperaban', r.hechas === 1 && r.turnos === 2 && m.llamadasA.voz === 1)
    }

    // Un tope por pasada
    {
      const m = mundo({ pendientes: [], sinTurnos: pendientes(TURNOS_POR_PASADA + 3) })
      const r1 = await pasada(m)
      ok(`como mucho ${TURNOS_POR_PASADA} por pasada`, r1.turnos === TURNOS_POR_PASADA && [...m.turnos.values()].filter((t) => t.turnos !== null).length === TURNOS_POR_PASADA)
      const r2 = await pasada(m)
      ok('las que quedan entran en la siguiente', r2.turnos === 3 && [...m.turnos.values()].every((t) => t.turnos !== null))
    }

    // Una sola frase, o demasiado larga: nada que separar, y no se pregunta a la IA
    {
      const m = mundo({ pendientes: [], sinTurnos: [{ llamadaId: 'corta', transcripcion: 'Hola, aquí no es, se ha equivocado de número.' }, { llamadaId: 'larguisima', transcripcion: Array.from({ length: 700 }, (_, i) => `Frase número ${i}.`).join(' ') }] })
      const r = await pasada(m)
      ok('una conversación de una frase o de más de 600 queda con [] y NO gasta IA', m.encargosDeTurnos.length === 0 && j(hecha(m, 'corta').turnos) === '[]' && j(hecha(m, 'larguisima').turnos) === '[]' && r.turnos === 0)
      const r2 = await pasada(m)
      ok('y no se vuelven a mirar', r2.turnos === 0 && m.encargosDeTurnos.length === 0)
    }

    // Fallos de la IA que se arreglan solos: el intento cuenta y se sigue con las demás
    {
      const m = mundo({ pendientes: [], sinTurnos: pendientes(2), turnosDeLaIa: async (n) => (n === 1 ? SIN_TURNOS('La IA tiene un problema ahora mismo.') : TURNOS_BUENOS) })
      const r = await pasada(m)
      ok('si la IA falla en una (reintentable), esa cuenta un intento y la siguiente sale', r.turnos === 1 && hecha(m, 'conv-1').turnos === null && hecha(m, 'conv-1').intentos === 1 && hecha(m, 'conv-2').turnos !== null && r.avisoDeTurnos === null, `${r.turnos} · ${hecha(m, 'conv-1').intentos}`)
    }
    {
      let n = 0
      const m = mundo({ pendientes: [], sinTurnos: pendientes(1), turnosDeLaIa: async () => (++n, SIN_TURNOS('La IA ha devuelto algo que no se entiende.')) })
      const avisos: Array<string | null> = []
      for (let i = 0; i < INTENTOS_DE_TURNOS + 3; i++) avisos.push((await pasada(m)).avisoDeTurnos)
      ok(`tras ${INTENTOS_DE_TURNOS} intentos fallados se deja: la transcripción se queda corrida y no se insiste más`, n === INTENTOS_DE_TURNOS && hecha(m, 'conv-1').turnos === null && hecha(m, 'conv-1').intentos === INTENTOS_DE_TURNOS, `${n} peticiones`)
      ok('y NO en silencio: la pasada del último intento lo cuenta con un AVISO, y las demás no', avisos.slice(0, INTENTOS_DE_TURNOS - 1).every((a) => a === null) && /tras 10 intentos/.test(avisos[INTENTOS_DE_TURNOS - 1] ?? '') && avisos.slice(INTENTOS_DE_TURNOS).every((a) => a === null), JSON.stringify(avisos))
    }
    // UNA CAÍDA LARGA DE LA IA (la que perdía conversaciones con 3 intentos): falla durante nueve pasadas seguidas, vuelve, y la conversación sale separada
    {
      let n = 0
      const m = mundo({ pendientes: [], sinTurnos: pendientes(2), turnosDeLaIa: async () => (++n <= 2 * (INTENTOS_DE_TURNOS - 1) ? SIN_TURNOS('La IA tiene un problema ahora mismo.') : TURNOS_BUENOS) })
      const r = [] as ResultadoDelMotor[]
      for (let i = 0; i < INTENTOS_DE_TURNOS + 1; i++) r.push(await pasada(m))
      ok(`una caída de la IA de ${INTENTOS_DE_TURNOS - 1} pasadas seguidas no pierde ninguna: al volver se separan las dos`, hecha(m, 'conv-1').turnos !== null && hecha(m, 'conv-2').turnos !== null && r.reduce((s, x) => s + x.turnos, 0) === 2, `${n} peticiones`)
      ok('y sin avisos de «agotada» (ninguna llegó al último intento fallando)', r.every((x) => x.avisoDeTurnos === null), JSON.stringify(r.map((x) => x.avisoDeTurnos)))
    }
    // La IA SE NIEGA a una llamada: no se insiste (antes recibía los 3 intentos)
    {
      let n = 0
      const m = mundo({ pendientes: [], sinTurnos: pendientes(2), turnosDeLaIa: async (k) => (++n, k === 1 ? SIN_TURNOS('La IA se ha negado a separar esta llamada.', { reintentable: false }) : TURNOS_BUENOS) })
      const r1 = await pasada(m)
      ok('la negativa se deja a la primera y la siguiente conversación sale', r1.turnos === 1 && hecha(m, 'conv-1').turnos === null && hecha(m, 'conv-1').intentos === INTENTOS_DE_TURNOS && hecha(m, 'conv-2').turnos !== null, `${r1.turnos} · ${hecha(m, 'conv-1').intentos}`)
      ok('lo cuenta con un AVISO (se enseña como texto corrido)', /se ha negado/.test(r1.avisoDeTurnos ?? '') && /texto corrido/.test(r1.avisoDeTurnos ?? '') && /AVISO: /.test(resumenDeLaPasada(r1)), r1.avisoDeTurnos ?? '')
      await pasada(m)
      await pasada(m)
      ok('y no se vuelve a pedir: una sola petición para ella', n === 2, `${n} peticiones`)
    }
    // Fallo de la cuenta de la IA: se para y no gasta el intento de la llamada
    {
      const m = mundo({ pendientes: [], sinTurnos: pendientes(3), turnosDeLaIa: async () => SIN_TURNOS(MENSAJE_DE_VOZ.clave, { general: true, reintentable: false }) })
      const r = await pasada(m)
      ok('la clave de OpenAI falla: se para a la primera, sin seguir con las demás', m.encargosDeTurnos.length === 1 && r.turnos === 0)
      ok('y esa conversación no gasta su intento', hecha(m, 'conv-1').intentos === 0, String(hecha(m, 'conv-1').intentos))
      ok('la pasada lo cuenta con AVISO, sin dar la pasada por mala', r.avisoDeTurnos === MENSAJE_DE_VOZ.clave && r.parada === null && /AVISO: /.test(resumenDeLaPasada(r)))
    }

    // La pasada que ya se paró por la IA no lo intenta
    {
      const m = mundo({ pendientes: [llamada(1)], sinTurnos: pendientes(2), voz: async () => { throw new ErrorDeVoz('clave', MENSAJE_DE_VOZ.clave, 401) } })
      const r = await pasada(m)
      ok('si la pasada se ha parado por la cuenta de la IA, ni se prueba con los turnos', r.parada === 'ia_no_disponible' && m.encargosDeTurnos.length === 0)
    }
    // El tope diario de AUDIO no impide separar: no gasta audio
    {
      const m = mundo({ pendientes: [llamada(1)], ajustes: { tope_diario_minutos: 1 }, gastado24h: 100, sinTurnos: pendientes(1) })
      const r = await pasada(m)
      ok('con el tope diario de audio alcanzado se puede separar (es solo texto)', r.parada === 'tope_diario' && r.turnos === 1)
    }

    // El presupuesto de tiempo
    {
      const m = mundo({ pendientes: [], sinTurnos: pendientes(6), msPorTurno: 40_000 })
      const r = await pasada(m, { presupuestoMs: 100_000 })
      ok('el presupuesto de tiempo manda: no se empiezan más pasados los 100 s (3 de 40 s)', r.turnos === 3, String(r.turnos))
    }

    // Sin la migración 253: la pasada sigue y lo dice
    {
      const m = mundo({ pendientes: [llamada(1)], sinTurnos: pendientes(2) })
      m.fallosDeAlmacen.faltaLa253 = true
      const r = await pasada(m)
      ok('sin la 253 el resto de la pasada es igual (la llamada se transcribe) y se dice qué falta lanzar', r.hechas === 1 && r.turnos === 0 && r.avisoDeTurnos === FALTA_MIGRACION_TURNOS && /253_transcripcion_quien_habla/.test(resumenDeLaPasada(r)), resumenDeLaPasada(r))
    }
    // Un fallo cualquiera de la base al pedir la lista o al guardar
    {
      const m = mundo({ pendientes: [llamada(1)], sinTurnos: pendientes(2) })
      m.fallosDeAlmacen.pendientesDeTurnos = true
      const r = await pasada(m)
      ok('si la base falla al pedir las conversaciones, la llamada nueva sigue hecha y la pasada no revienta', r.hechas === 1 && r.turnos === 0 && /Ha fallado algo al separar/.test(r.avisoDeTurnos ?? ''))
    }
    {
      const m = mundo({ pendientes: [], sinTurnos: pendientes(2) })
      m.fallosDeAlmacen.guardarTurnos = true
      const r = await pasada(m)
      ok('si la base falla al guardar, no revienta y no se cuenta como separada', r.turnos === 0 && /Ha fallado algo/.test(r.avisoDeTurnos ?? ''))
    }
    {
      const registros: string[] = []
      const original = console.error
      console.error = (...a: unknown[]) => registros.push(JSON.stringify(a))
      const m = mundo({ pendientes: [], sinTurnos: [{ llamadaId: 'x', transcripcion: 'Hola, soy Pedro de Joe Black Pets. Mi teléfono es 600112233.' }] })
      m.fallosDeAlmacen.guardarTurnos = true
      await pasada(m)
      console.error = original
      ok('lo que se apunta en la consola no trae lo que se dijo en la llamada', !/Pedro|Joe Black|600112233/.test(registros.join(' ')), registros.join(' '))
    }
  }

  console.log('\n=== el texto de la pasada ===')
  {
    const base: ResultadoDelMotor = { candidatas: 5, hechas: 3, rellamadas: 0, cerrados: 0, turnos: 0, avisoDeTurnos: null, sinContenido: 1, omitidas: 1, fallidas: 0, ajenas: 0, segundos: 330, costeUsd: 0.0312, parada: null, aviso: null, segundos24h: 1200, topeMinutos: 400 }
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
