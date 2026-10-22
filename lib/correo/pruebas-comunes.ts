import type { ImapFlow } from 'imapflow'
import type { Almacen, FilaDeBuzon, FilaDeCarpeta, FilaDeMensaje, HiloBasico, RolDeCarpeta } from '@/lib/correo/almacen'

/**
 * PIEZAS PARA LAS PRUEBAS DEL CORREO: UN SERVIDOR IMAP FALSO Y UNA BASE FALSA EN MEMORIA.
 * ======================================================================================
 * Solo las usan los ficheros `.prueba.ts` de esta carpeta. No se importan desde la aplicación.
 *
 * El servidor falso hace lo mínimo de IMAP que usa la lectura (listar, abrir una carpeta, buscar por fecha, pedir
 * metadatos, cuerpos y banderas) y APUNTA cada orden, para poder comprobar que la lectura nunca escribe en el servidor.
 * La base falsa repite lo que hacen las funciones SQL de la migración 236 (buscar hilos en los dos sentidos, fusionar,
 * recalcular), de modo que la lógica de hilos se prueba sin Postgres. El mismo recorrido contra Postgres de verdad se
 * hizo al validar la migración.
 */

/* ------------------------------------------------------------------ */
/* Correos de prueba                                                   */
/* ------------------------------------------------------------------ */

export interface CorreoDePrueba {
  id: string | null
  de: string
  para: string
  asunto: string
  fecha: string
  enRespuestaA?: string
  referencias?: string[]
  cuerpo?: string
  cabeceras?: string
  cc?: string
}

export function crudo(c: CorreoDePrueba): Buffer {
  const lineas = [
    ...(c.id ? [`Message-ID: <${c.id}>`] : []),
    `Date: ${new Date(c.fecha).toUTCString()}`,
    `From: ${c.de}`,
    `To: ${c.para}`,
    ...(c.cc ? [`Cc: ${c.cc}`] : []),
    `Subject: ${c.asunto}`,
    ...(c.enRespuestaA ? [`In-Reply-To: <${c.enRespuestaA}>`] : []),
    ...(c.referencias && c.referencias.length > 0 ? [`References: ${c.referencias.map((r) => `<${r}>`).join(' ')}`] : []),
    ...(c.cabeceras ? [c.cabeceras] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    c.cuerpo ?? 'Hola, esto es una prueba.',
  ]
  return Buffer.from(lineas.join('\r\n'), 'utf8')
}

/* ------------------------------------------------------------------ */
/* Servidor IMAP falso                                                 */
/* ------------------------------------------------------------------ */

export interface MensajeEnServidor {
  uid: number
  fuente: Buffer
  fecha: Date
  flags: string[]
  /** Si se indica, es el tamaño que dice el servidor (para probar los mensajes enormes sin crearlos) */
  tamano?: number
}

export interface CarpetaEnServidor {
  path: string
  specialUse?: string
  uidValidity: number
  mensajes: MensajeEnServidor[]
}

export class ServidorFalso {
  carpetas: CarpetaEnServidor[]
  ordenes: string[] = []
  abierta: CarpetaEnServidor | null = null
  /** Si se pone, la orden FETCH con esta marca falla */
  fallarEnFetch = false

  constructor(carpetas: CarpetaEnServidor[]) {
    this.carpetas = carpetas
  }

  carpeta(path: string): CarpetaEnServidor {
    const c = this.carpetas.find((x) => x.path === path)
    if (!c) throw new Error(`la carpeta de prueba ${path} no existe`)
    return c
  }

  añadir(path: string, m: Omit<MensajeEnServidor, 'uid'> & { uid?: number }): number {
    const c = this.carpeta(path)
    const uid = m.uid ?? Math.max(0, ...c.mensajes.map((x) => x.uid)) + 1
    c.mensajes.push({ ...m, uid })
    return uid
  }

  /** El cliente que se le da a la lectura */
  cliente(): ImapFlow {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const s = this
    const cliente = {
      get mailbox() {
        return s.abierta ? { path: s.abierta.path, uidValidity: BigInt(s.abierta.uidValidity), exists: s.abierta.mensajes.length } : false
      },
      async list() {
        s.ordenes.push('LIST')
        return s.carpetas.map((c) => ({ path: c.path, name: c.path, delimiter: '.', flags: new Set<string>(), specialUse: c.specialUse }))
      },
      async getMailboxLock(path: string, opciones?: { readOnly?: boolean }) {
        s.ordenes.push(`${opciones?.readOnly ? 'EXAMINE' : 'SELECT'} ${path}`)
        const c = s.carpetas.find((x) => x.path === path)
        if (!c) throw Object.assign(new Error('Mailbox does not exist'), { mailboxMissing: true })
        s.abierta = c
        return { release: () => void (s.abierta = null) }
      },
      async search(consulta: { since?: Date }) {
        s.ordenes.push('SEARCH')
        if (!s.abierta) return false
        const desde = consulta.since ? Date.UTC(consulta.since.getUTCFullYear(), consulta.since.getUTCMonth(), consulta.since.getUTCDate()) : 0
        return s.abierta.mensajes.filter((m) => m.fecha.getTime() >= desde).map((m) => m.uid).sort((a, b) => a - b)
      },
      fetch(rango: string, consulta: Record<string, unknown>) {
        s.ordenes.push(`FETCH ${Object.keys(consulta).filter((k) => k !== 'uid').join(',')}`)
        const uids = new Set(String(rango).split(',').map(Number))
        const carpeta = s.abierta
        const fallar = s.fallarEnFetch && consulta.source === true
        return (async function* () {
          if (fallar) throw Object.assign(new Error('conexión cortada'), { code: 'ECONNRESET' })
          if (!carpeta) return
          for (const m of carpeta.mensajes) {
            if (!uids.has(m.uid)) continue
            yield {
              seq: m.uid,
              uid: m.uid,
              flags: consulta.flags ? new Set(m.flags) : undefined,
              internalDate: consulta.internalDate ? m.fecha : undefined,
              size: consulta.size ? (m.tamano ?? m.fuente.length) : undefined,
              source: consulta.source ? m.fuente : undefined,
              headers: consulta.headers ? m.fuente.subarray(0, Math.max(0, m.fuente.indexOf('\r\n\r\n'))) : undefined,
            }
          }
        })()
      },
      async fetchOne(seq: string, consulta: Record<string, unknown>) {
        s.ordenes.push(`FETCHONE ${Object.keys(consulta).filter((k) => k !== 'uid').join(',')}`)
        const m = s.abierta?.mensajes.find((x) => x.uid === Number(seq))
        if (!m) return false
        return { seq: m.uid, uid: m.uid, headers: consulta.headers ? m.fuente.subarray(0, Math.max(0, m.fuente.indexOf('\r\n\r\n'))) : undefined }
      },
    }
    return cliente as unknown as ImapFlow
  }

  /** ¿Se ha mandado alguna orden que escriba en el servidor? */
  huboEscrituras(): boolean {
    return this.ordenes.some((o) => /^(SELECT|STORE|APPEND|EXPUNGE|COPY|MOVE|DELETE|CREATE)/.test(o))
  }
}

/* ------------------------------------------------------------------ */
/* Base de datos falsa                                                 */
/* ------------------------------------------------------------------ */

export interface HiloEnMemoria {
  id: string
  buzon_id: string
  asunto: string
  clave_asunto: string
  participantes: string[]
  primer_mensaje_at: string
  ultimo_mensaje_at: string
  mensajes: number
  no_leidos: number
  entrantes: number
  salientes: number
  ultimo_es_entrante: boolean
  automatico: boolean
}

export interface MensajeEnMemoria extends FilaDeMensaje {
  id: string
}

export class BaseFalsa implements Almacen {
  buzon: FilaDeBuzon
  carpetas: FilaDeCarpeta[] = []
  hilos: HiloEnMemoria[] = []
  mensajes: MensajeEnMemoria[] = []
  llamadas: string[] = []
  private contador = 0
  /** Si se pone, la próxima inserción de mensaje lanza este error */
  fallarAlInsertar: Error | null = null

  constructor(buzon: Partial<FilaDeBuzon> = {}) {
    this.buzon = {
      id: 'buzon-1',
      user_id: 'usuario-1',
      direccion: 'ana@liberty.test',
      nombre: 'Ana',
      usuario: 'ana@liberty.test',
      proveedor: 'hostinger',
      imap_host: 'imap.hostinger.com',
      imap_puerto: 993,
      imap_seguro: true,
      smtp_host: 'smtp.hostinger.com',
      smtp_puerto: 465,
      smtp_seguro: true,
      desde_fecha: '2026-08-01T00:00:00.000Z',
      firma: null,
      vinculado_at: '2026-10-01T00:00:00.000Z',
      ultimo_sync_at: null,
      ultimo_intento_at: null,
      ultimo_error: null,
      fallos_seguidos: 0,
      credenciales_invalidas: false,
      historico_completo: false,
      lectura_hasta: null,
      ...buzon,
    }
  }

  private nuevoId(prefijo: string): string {
    this.contador += 1
    return `${prefijo}-${this.contador}`
  }

  async tomarTurno(_buzonId: string, hastaMs: number) {
    if (this.buzon.lectura_hasta && Date.parse(this.buzon.lectura_hasta) > Date.now()) return false
    this.buzon.lectura_hasta = new Date(hastaMs).toISOString()
    return true
  }
  async soltarTurno() {
    this.buzon.lectura_hasta = null
  }
  async anotarBuzon(_id: string, cambios: Partial<FilaDeBuzon>) {
    Object.assign(this.buzon, cambios)
  }

  async asegurarCarpeta(buzonId: string, rol: RolDeCarpeta, ruta: string) {
    let c = this.carpetas.find((x) => x.buzon_id === buzonId && x.rol === rol)
    if (!c) {
      c = { id: this.nuevoId('carpeta'), buzon_id: buzonId, ruta, rol, uidvalidity: null, ultimo_sync_at: null }
      this.carpetas.push(c)
    }
    c.ruta = ruta
    return { ...c }
  }
  async anotarCarpeta(carpetaId: string, cambios: { uidvalidity?: number; ultimo_sync_at?: string }) {
    const c = this.carpetas.find((x) => x.id === carpetaId)!
    if (cambios.uidvalidity !== undefined) c.uidvalidity = cambios.uidvalidity
    if (cambios.ultimo_sync_at !== undefined) c.ultimo_sync_at = cambios.ultimo_sync_at
  }
  async despegarUids(carpetaId: string) {
    this.llamadas.push('despegarUids')
    for (const m of this.mensajes) if (m.carpeta_id === carpetaId) m.uid = null
  }
  async uidsGuardados(carpetaId: string) {
    return this.mensajes.filter((m) => m.carpeta_id === carpetaId && m.uid !== null).map((m) => m.uid as number)
  }

  async hilosDeIds(buzonId: string, ids: string[]): Promise<HiloBasico[]> {
    const conjunto = new Set(ids)
    const encontrados = new Set<string>()
    for (const m of this.mensajes) {
      if (m.buzon_id !== buzonId) continue
      if ((m.message_id && conjunto.has(m.message_id)) || (m.en_respuesta_a && conjunto.has(m.en_respuesta_a)) || m.referencias.some((r) => conjunto.has(r))) encontrados.add(m.hilo_id)
    }
    return this.hilos.filter((h) => encontrados.has(h.id)).map((h) => ({ id: h.id, participantes: h.participantes, primerMensajeAt: h.primer_mensaje_at, ultimoMensajeAt: h.ultimo_mensaje_at }))
  }
  async hilosPorAsunto(buzonId: string, clave: string): Promise<HiloBasico[]> {
    return this.hilos
      .filter((h) => h.buzon_id === buzonId && h.clave_asunto === clave && h.mensajes > 0)
      .map((h) => ({ id: h.id, participantes: h.participantes, primerMensajeAt: h.primer_mensaje_at, ultimoMensajeAt: h.ultimo_mensaje_at }))
  }
  async crearHilo(buzonId: string, asunto: string, claveAsunto: string, fecha: Date) {
    const id = this.nuevoId('hilo')
    this.hilos.push({
      id, buzon_id: buzonId, asunto, clave_asunto: claveAsunto, participantes: [], primer_mensaje_at: fecha.toISOString(), ultimo_mensaje_at: fecha.toISOString(),
      mensajes: 0, no_leidos: 0, entrantes: 0, salientes: 0, ultimo_es_entrante: false, automatico: false,
    })
    return id
  }
  async fusionarHilos(destino: string, origenes: string[]) {
    this.llamadas.push(`fusionarHilos ${destino} <- ${origenes.join(',')}`)
    for (const m of this.mensajes) if (origenes.includes(m.hilo_id) && m.hilo_id !== destino) m.hilo_id = destino
    this.hilos = this.hilos.filter((h) => !origenes.includes(h.id) || h.id === destino)
    await this.actualizarHilo(destino)
  }
  async actualizarHilo(hiloId: string) {
    this.llamadas.push(`actualizarHilo ${hiloId}`)
    const h = this.hilos.find((x) => x.id === hiloId)
    if (!h) return
    const ms = this.mensajes.filter((m) => m.hilo_id === hiloId).sort((a, b) => Date.parse(a.fecha) - Date.parse(b.fecha))
    if (ms.length === 0) return
    h.asunto = ms[0].asunto || h.asunto
    h.mensajes = ms.length
    h.entrantes = ms.filter((m) => m.direccion === 'entrante').length
    h.salientes = ms.filter((m) => m.direccion === 'saliente').length
    h.no_leidos = ms.filter((m) => !m.leido).length
    h.primer_mensaje_at = ms[0].fecha
    h.ultimo_mensaje_at = ms[ms.length - 1].fecha
    const ultimo = ms[ms.length - 1]
    h.ultimo_es_entrante = ultimo.direccion === 'entrante' && !ultimo.automatico
    const entrantes = ms.filter((m) => m.direccion === 'entrante')
    h.automatico = entrantes.length > 0 && entrantes.every((m) => m.automatico)
    const todos = new Set<string>()
    for (const m of ms) {
      if (m.de_direccion) todos.add(m.de_direccion.toLowerCase())
      for (const p of [...m.para, ...m.cc]) todos.add(p.direccion.toLowerCase())
    }
    todos.delete(this.buzon.direccion.toLowerCase())
    h.participantes = [...todos].sort()
  }

  async contarSinUid(carpetaId: string) {
    return this.mensajes.filter((m) => m.carpeta_id === carpetaId && m.uid === null).length
  }
  async adoptarSinUid(buzonId: string, carpetaId: string, direccion: 'entrante' | 'saliente', messageId: string, uid: number) {
    const m = this.mensajes.find((x) => x.buzon_id === buzonId && x.carpeta_id === carpetaId && x.message_id === messageId && x.direccion === direccion && x.uid === null)
    if (!m) return null
    if (this.mensajes.some((x) => x.carpeta_id === carpetaId && x.uid === uid)) return null
    m.uid = uid
    return { hiloId: m.hilo_id }
  }
  async insertarMensaje(fila: FilaDeMensaje) {
    this.llamadas.push('insertarMensaje')
    if (this.fallarAlInsertar) {
      const e = this.fallarAlInsertar
      this.fallarAlInsertar = null
      throw e
    }
    if (fila.uid !== null && this.mensajes.some((m) => m.carpeta_id === fila.carpeta_id && m.uid === fila.uid)) return false
    this.mensajes.push({ ...fila, id: this.nuevoId('mensaje') })
    return true
  }
  async noLeidosDeCarpeta(carpetaId: string, limite: number) {
    return this.mensajes
      .filter((m) => m.carpeta_id === carpetaId && !m.leido && m.uid !== null)
      .sort((a, b) => (b.uid as number) - (a.uid as number))
      .slice(0, limite)
      .map((m) => ({ id: m.id, uid: m.uid as number, hiloId: m.hilo_id }))
  }
  async marcarLeidos(ids: string[]) {
    for (const m of this.mensajes) if (ids.includes(m.id)) m.leido = true
  }

  /** Para las comprobaciones */
  hilosConMensajes(): HiloEnMemoria[] {
    return this.hilos.filter((h) => this.mensajes.some((m) => m.hilo_id === h.id))
  }
  asuntosDelHilo(hiloId: string): string[] {
    return this.mensajes.filter((m) => m.hilo_id === hiloId).map((m) => m.asunto)
  }
}
