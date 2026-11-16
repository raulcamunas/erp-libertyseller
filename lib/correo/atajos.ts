/**
 * LOS ATAJOS DE TECLADO DE CORREO.
 * ================================
 * PURO (sin React ni el navegador): de una tecla y del estado de la pantalla sale QUÉ hay que hacer, y la pantalla lo hace. Se comprueba con
 * atajos.prueba.ts.
 *
 *   j / k          siguiente / anterior conversación (y la abre en escritorio)
 *   ↵ / o          abrir la seleccionada
 *   u / Esc        volver a la lista o cerrar el panel
 *   c              redactar
 *   r / a / f      responder / a todos / reenviar (si puede responder y hay un hilo abierto)
 *   s              destacar (si puede responder y hay un hilo abierto)
 *   ⇧U             marcar no leído (si puede responder y hay un hilo abierto)
 *   m              silenciar o reactivar el hilo (es personal: basta con leerlo)
 *   /              buscar
 *   g y luego i    ir a Mis correos
 *   g y luego a    ir a Asignados a mí
 *   ?              la chuleta de atajos
 *   ⌘↵ / Ctrl+↵    enviar (lo que se está escribiendo)
 *
 * Solo actúan si Correo es la app visible (`estado.activa`) y el foco NO está en un campo, salvo Esc y ⌘/Ctrl+Intro. Una tecla con ⌘, Ctrl o
 * Alt no es un atajo (⌘C sigue copiando), salvo ⌘/Ctrl+Intro. Mientras se compone un carácter (tildes, IME) no se hace nada.
 *
 * «g» no hace nada por sí sola: devuelve 'prefijo-g' y la pantalla apunta cuándo (`estado.gDesde`). Si la siguiente tecla llega antes de
 * VENTANA_DE_G_MS y es «i» o «a», va a esa carpeta; cualquier otra cosa anula el prefijo (devuelve null y la pantalla lo borra).
 *
 * El cuerpo de un correo va en un iframe: sus teclas no llegan a la ventana. CuerpoDeCorreo reenvía a `window` las de TECLAS_DE_ATAJO.
 */

export type AccionDeAtajo =
  | 'siguiente'
  | 'anterior'
  | 'abrir'
  | 'volver'
  | 'redactar'
  | 'responder'
  | 'responder-todos'
  | 'reenviar'
  | 'destacar'
  | 'no-leido'
  | 'silenciar'
  | 'buscar'
  | 'ir-mis-correos'
  | 'ir-asignados'
  | 'ayuda'
  | 'enviar'
  /** Se ha pulsado «g»: la pantalla apunta la hora en `gDesde` y espera la segunda tecla */
  | 'prefijo-g'

/** Lo que hace falta de un KeyboardEvent (se puede pasar el evento tal cual, más `enCampo`) */
export interface EventoDeTecla {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  /** Se está componiendo un carácter (tildes, IME) */
  isComposing?: boolean
  /** El foco está en un campo de texto (input, textarea, select o contenteditable): ver esCampoDeTexto */
  enCampo?: boolean
}

export interface EstadoDeAtajos {
  /** Correo es la app visible (AppsPersistentes) */
  activa: boolean
  /** Quien mira puede responder desde el buzón del hilo abierto (o del seleccionado) */
  puedeResponder: boolean
  /** Hay una conversación abierta */
  hiloAbierto: boolean
  /** Cuándo se pulsó «g» (ms), o null si no hay prefijo pendiente */
  gDesde?: number | null
  /** Ahora (ms). Sin él, Date.now() */
  ahora?: number
}

/** Cuánto se espera la segunda tecla tras «g» */
export const VENTANA_DE_G_MS = 1500

/** Las teclas que el iframe del cuerpo tiene que reenviar a la ventana (comparar con `evento.key`) */
export const TECLAS_DE_ATAJO: ReadonlySet<string> = new Set(['j', 'k', 'o', 'u', 'c', 'r', 'a', 'f', 's', 'U', 'm', '/', 'g', 'i', '?', 'Enter', 'Escape'])

/** ¿Este elemento es un campo donde se escribe? Acepta cualquier cosa (el `target` de un evento) sin depender del DOM */
export function esCampoDeTexto(elemento: unknown): boolean {
  if (!elemento || typeof elemento !== 'object') return false
  const e = elemento as { tagName?: unknown; isContentEditable?: unknown; type?: unknown }
  if (e.isContentEditable === true) return true
  const etiqueta = typeof e.tagName === 'string' ? e.tagName.toUpperCase() : ''
  if (etiqueta === 'TEXTAREA' || etiqueta === 'SELECT') return true
  if (etiqueta !== 'INPUT') return false
  // Una casilla o un botón no son sitios donde se escribe
  const tipo = typeof e.type === 'string' ? e.type.toLowerCase() : 'text'
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(tipo)
}

/** ¿Hay que reenviar esta tecla del iframe a la ventana? (sin ⌘, Ctrl ni Alt, salvo ⌘/Ctrl+Intro, que no hace falta: en el iframe no se escribe) */
export function hayQueReenviar(evento: EventoDeTecla): boolean {
  if (evento.metaKey || evento.ctrlKey || evento.altKey || evento.isComposing) return false
  return TECLAS_DE_ATAJO.has(evento.key)
}

/** Qué hay que hacer con esta tecla, o null si nada (y entonces la pantalla no llama a preventDefault) */
export function accionDeTecla(evento: EventoDeTecla, estado: EstadoDeAtajos): AccionDeAtajo | null {
  if (!estado.activa || evento.isComposing) return null
  const { key } = evento
  const conMando = !!(evento.metaKey || evento.ctrlKey)

  // Los dos que actúan también dentro de un campo
  if (key === 'Enter' && conMando && !evento.altKey) return 'enviar'
  if (key === 'Escape') return 'volver'

  if (evento.enCampo) return null
  if (conMando || evento.altKey) return null

  // La segunda tecla de «g …»
  const ahora = estado.ahora ?? Date.now()
  if (estado.gDesde != null && ahora - estado.gDesde >= 0 && ahora - estado.gDesde <= VENTANA_DE_G_MS) {
    if (key === 'i' && !evento.shiftKey) return 'ir-mis-correos'
    if (key === 'a' && !evento.shiftKey) return 'ir-asignados'
    return null
  }

  // Con mayúscula solo valen «?» (que en casi todos los teclados lleva ⇧) y ⇧U
  if (key === '?') return 'ayuda'
  if (evento.shiftKey) {
    if (key === 'U' || key === 'u') return estado.hiloAbierto && estado.puedeResponder ? 'no-leido' : null
    return null
  }

  const conHiloYRespuesta = estado.hiloAbierto && estado.puedeResponder
  switch (key) {
    case 'j':
      return 'siguiente'
    case 'k':
      return 'anterior'
    case 'Enter':
    case 'o':
      return 'abrir'
    case 'u':
      return 'volver'
    case 'c':
      return 'redactar'
    case 'r':
      return conHiloYRespuesta ? 'responder' : null
    case 'a':
      return conHiloYRespuesta ? 'responder-todos' : null
    case 'f':
      return conHiloYRespuesta ? 'reenviar' : null
    case 's':
      return conHiloYRespuesta ? 'destacar' : null
    case 'm':
      return estado.hiloAbierto ? 'silenciar' : null
    case '/':
      return 'buscar'
    case 'g':
      return 'prefijo-g'
    default:
      return null
  }
}

/** La chuleta (AyudaDeAtajos) y las teclas de los tooltips (`<Kbd>`), en el orden en que se enseñan */
export const ATAJOS: ReadonlyArray<{ accion: AccionDeAtajo; teclas: readonly string[]; texto: string; grupo: 'Moverse' | 'Conversación' | 'Escribir' }> = [
  { accion: 'siguiente', teclas: ['j'], texto: 'Siguiente conversación', grupo: 'Moverse' },
  { accion: 'anterior', teclas: ['k'], texto: 'Conversación anterior', grupo: 'Moverse' },
  { accion: 'abrir', teclas: ['↵', 'o'], texto: 'Abrir la seleccionada', grupo: 'Moverse' },
  { accion: 'volver', teclas: ['u', 'Esc'], texto: 'Volver a la lista o cerrar el panel', grupo: 'Moverse' },
  { accion: 'buscar', teclas: ['/'], texto: 'Buscar', grupo: 'Moverse' },
  { accion: 'ir-mis-correos', teclas: ['g', 'i'], texto: 'Ir a Mis correos', grupo: 'Moverse' },
  { accion: 'ir-asignados', teclas: ['g', 'a'], texto: 'Ir a Asignados a mí', grupo: 'Moverse' },
  { accion: 'destacar', teclas: ['s'], texto: 'Destacar', grupo: 'Conversación' },
  { accion: 'no-leido', teclas: ['⇧', 'U'], texto: 'Marcar no leído', grupo: 'Conversación' },
  { accion: 'silenciar', teclas: ['m'], texto: 'Silenciar o reactivar la conversación', grupo: 'Conversación' },
  { accion: 'redactar', teclas: ['c'], texto: 'Redactar', grupo: 'Escribir' },
  { accion: 'responder', teclas: ['r'], texto: 'Responder', grupo: 'Escribir' },
  { accion: 'responder-todos', teclas: ['a'], texto: 'Responder a todos', grupo: 'Escribir' },
  { accion: 'reenviar', teclas: ['f'], texto: 'Reenviar', grupo: 'Escribir' },
  { accion: 'enviar', teclas: ['⌘', '↵'], texto: 'Enviar (Ctrl + ↵ en Windows)', grupo: 'Escribir' },
  { accion: 'ayuda', teclas: ['?'], texto: 'Esta chuleta', grupo: 'Moverse' },
]

/** Las teclas de una acción, para el `<Kbd>` de un tooltip: teclasDe('responder') → ['r'] */
export function teclasDe(accion: AccionDeAtajo): readonly string[] {
  return ATAJOS.find((a) => a.accion === accion)?.teclas ?? []
}
