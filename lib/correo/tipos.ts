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

/**
 * Lo que está abierto en la barra de buzones: «Mis correos» (la bandeja unificada), «Asignados a mí», un buzón suelto, el resumen del equipo
 * o las secuencias. «Destacados» y «Pendientes» de la barra no son carpetas: son «Mis correos» con esa vista puesta.
 */
export type Carpeta = { tipo: 'mios' } | { tipo: 'asignados' } | { tipo: 'buzon'; buzonId: string } | { tipo: 'equipo' } | { tipo: 'secuencias' }

/**
 * Cuánto dura un silencio (de buzón, de hilo o de remitente): 8 horas, hasta mañana a las 8:00 (hora de Madrid), una semana o para siempre.
 * Este fichero es su ÚNICO dueño: preferencias.ts y las piezas de la pantalla la importan de aquí.
 */
export type Duracion = '8h' | 'manana' | 'semana' | 'siempre'

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
  /** La firma DEL BUZÓN: se manda a quien puede escribir desde él (el dueño, o quien lo tiene asignado con respuesta) */
  firma: string | null
  /** Las cuentas del buzón entero (hilosSinLeer es el total, sin descontar lo silenciado por nadie) */
  resumen: ResumenDeBuzon
  /** Puede enviar, responder, marcar leído y destacar desde aquí: es el dueño, o un administrador se lo ha asignado con respuesta */
  puedeResponder: boolean
  /** Un administrador se lo ha asignado a quien mira (migración 318) */
  asignado: boolean
  /** Está en «Mis correos» de quien mira, ya resuelto el «por defecto» (propios y asignados sí; el resto, no) */
  enMisCorreos: boolean
  /** Su puesto en «Mis correos», si quien mira lo ha ordenado */
  orden: number | null
  /** Silenciado AHORA para quien mira (ya resuelta la fecha): no avisa ni suma en el número del menú */
  silenciado: boolean
  /** Hasta cuándo dura ese silencio (null = para siempre, o no está silenciado) */
  silenciadoHasta: string | null
  /** Las personas que lo trabajan. Solo se rellena para el dueño y para un administrador; para el resto, [] */
  asignaciones: Array<{ personaId: string; nombre: string; puedeResponder: boolean }>
  /** Conversaciones sin leer descontando las silenciadas por quien mira (el número de la barra) */
  hilosSinLeerMios: number
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
  /** El buzón del hilo: en la bandeja unificada se mezclan varios */
  buzonId: string
  /** Silenciado para quien mira, por el hilo o por su remitente. Sale atenuado, no oculto */
  silenciado: boolean
  /** La persona encargada de la conversación, si alguien se la ha asignado y no está hecha */
  asignadoA: { id: string; nombre: string } | null
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
  /**
   * Quién del ERP lo envió. OPCIONAL: solo viene en los salientes enviados desde el ERP por alguien que NO es el dueño del buzón (sin la
   * migración 318, nunca). id null si esa persona ya no existe
   */
  enviadoPor?: { id: string | null; nombre: string } | null
}

export interface HiloAbierto {
  id: string
  buzonId: string
  asunto: string
  destacado: boolean
  mensajes: MensajeDeHilo[]
  /** El hilo tiene más mensajes de los que se enseñan (se enseñan los más recientes) */
  recortado: boolean
  /** Quien mira puede contestar, marcar y destacar (es el dueño, o lo tiene asignado con respuesta) */
  puedeResponder: boolean
  /** Lo que quien mira tiene silenciado: el hilo, o a su remitente en todos los buzones */
  silenciado: { hilo: boolean; remitente: boolean }
  /** La persona encargada de la conversación, si la hay y no está hecha */
  asignacion: { personaId: string; nombre: string; asignadoPor: string | null; nota: string | null; asignadoAt: string } | null
}

export interface AccesoRegistrado {
  id: string
  quien: string
  /** 'aviso' = vio el aviso de un correo nuevo; 'envio' = envió un correo desde el buzón (migración 318 en adelante; la columna es texto libre) */
  accion: 'lista' | 'hilo' | 'busqueda' | 'adjunto' | 'aviso' | 'envio'
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

/** Cómo contesta GET /api/correo/buzones (y POST /api/correo/preferencias) */
export interface RespuestaDeBuzones {
  buzones: BuzonVisible[]
  cifradoConfigurado: boolean
  /** Conversaciones sin leer de «Mis correos» que avisan (sin los buzones ni los hilos silenciados): el número del menú */
  sinLeerMios: number
  /** false si falta lanzar la migración 318: no se puede elegir, asignar ni silenciar */
  preferenciasDisponibles: boolean
}
