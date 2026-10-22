import type { Persona } from './direcciones'

/**
 * LO QUE VIAJA ENTRE EL SERVIDOR Y LA PANTALLA DE CORREO.
 * =======================================================
 * Solo tipos, sin código: los importan a la vez las rutas de /api/correo y los componentes del navegador, y por eso
 * no pueden traer detrás nada del servidor (ni la base, ni las librerías de correo).
 *
 * Ninguno lleva la contraseña del buzón ni nada de lo que sirve para conectarse a él: eso no sale del servidor.
 */

export type VistaDeCorreo = 'todos' | 'recibidos' | 'enviados' | 'destacados' | 'pendientes'

export interface ResumenDeBuzon {
  hilos: number
  hilosSinLeer: number
  sinLeer: number
  esperandoRespuesta: number
  ultimoMensajeAt: string | null
}

export interface BuzonVisible {
  id: string
  direccion: string
  nombre: string | null
  proveedor: string
  propietario: { id: string; nombre: string }
  /** Es el buzón de quien lo mira */
  esMio: boolean
  /** Tiene una contraseña guardada: se puede leer y, si es mío, escribir */
  conectado: boolean
  /** El servidor rechazó la contraseña: hay que volver a ponerla. Mientras, no se lee */
  credencialesInvalidas: boolean
  ultimoSyncAt: string | null
  ultimoError: string | null
  /** Ya se ha traído todo lo que cae dentro de la fecha elegida */
  historicoCompleto: boolean
  desdeFecha: string
  /** Solo se manda al dueño */
  firma: string | null
  resumen: ResumenDeBuzon
}

export interface HiloDeLista {
  id: string
  asunto: string
  contraparte: string
  contraparteDireccion: string
  vistaPrevia: string
  ultimoMensajeAt: string
  mensajes: number
  noLeidos: number
  entrantes: number
  salientes: number
  tieneAdjuntos: boolean
  destacado: boolean
  /** El último lo escribió una persona del otro lado: espera respuesta nuestra */
  esperandoRespuesta: boolean
  /** Todo lo que ha llegado en el hilo es automático (avisos, boletines…) */
  automatico: boolean
}

export interface AdjuntoDeMensaje {
  nombre: string
  tipo: string
  tamano: number
  /** Posición del adjunto: es lo que se manda a /api/correo/adjuntos para descargarlo */
  n: number
}

export interface MensajeDeHilo {
  id: string
  direccion: 'entrante' | 'saliente'
  deNombre: string
  deDireccion: string
  para: Persona[]
  cc: Persona[]
  /** A quién hay que contestar si no es a quien lo envía (Reply-To) */
  responderA: Persona[]
  asunto: string
  fecha: string
  texto: string
  /** El HTML ya limpio, o null si el correo solo trae texto */
  html: string | null
  adjuntos: AdjuntoDeMensaje[]
  leido: boolean
  automatico: boolean
  /** Message-ID del mensaje, para contestarlo */
  messageId: string | null
}

export interface HiloAbierto {
  id: string
  buzonId: string
  asunto: string
  destacado: boolean
  mensajes: MensajeDeHilo[]
  /** El hilo tiene más mensajes de los que se enseñan (se enseñan los más recientes) */
  recortado: boolean
}

export interface AccesoRegistrado {
  id: string
  quien: string
  accion: 'lista' | 'hilo' | 'busqueda' | 'adjunto'
  asunto: string | null
  cuando: string
}

export interface ResultadoDeLecturaVisible {
  importados: number
  quedan: number
  completo: boolean
}

/** Cómo contesta POST /api/correo/sincronizar */
export interface RespuestaDeSincronizar {
  ok: boolean
  /** Otra lectura de este buzón está en marcha */
  ocupada?: boolean
  /** Se ha leído hace nada y no se ha vuelto a preguntar al servidor */
  recienLeido?: boolean
  lectura?: ResultadoDeLecturaVisible
  error?: string
  /** La contraseña ya no vale: hay que volver a escribirla */
  credencialesInvalidas?: boolean
}
