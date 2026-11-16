import type { CambioDePreferencia } from '@/lib/correo/preferencias'
import type { BorradorDeCorreo, ModoDeRedactar } from '@/lib/correo/redactar'
import type { BuzonVisible, Carpeta, Duracion, HiloAbierto, HiloDeLista, MensajeDeHilo, ResumenDeBuzon, VistaDeCorreo } from '@/lib/correo/tipos'

/**
 * LOS CONTRATOS DE LAS PIEZAS DE CORREO (rediseño «Correo Pro», spec sección 1).
 * ===============================================================================
 * SOLO TIPOS. Las pantallas de la oleada 3 implementan estas Props TAL CUAL (`export function X(props: PropsDeX)`), y CorreoApp/PanelCorreo
 * (oleada 4) las montan sin mirar dentro. Si una pieza necesita algo más, lo añade aquí como OPCIONAL y lo dice.
 *
 * Reglas que valen para todas:
 *   · `esMio` es «soy el dueño»: solo decide configurar el buzón y las secuencias. Lo que decide ESCRIBIR (responder, marcar, destacar, firma,
 *     respuesta rápida) es `puedeResponder`.
 *   · Silenciar es personal: basta con poder leer. Nunca se oculta lo silenciado: sale atenuado (55 %) con BellOff.
 *   · Los paneles (`abierto` + `onCambio`) siguen la forma de PanelLateral del kit: `onCambio(false)` es cerrar.
 *   · Los rebotes y el ⚠ de un buzón desconectado nunca salen atenuados.
 */

/* ------------------------------------------------------------------ */
/* Barra de buzones (columna 1; carril de 64 px en tableta; nivel «Carpetas» en el móvil) */
/* ------------------------------------------------------------------ */

export type VarianteDeBarra = 'columna' | 'carril' | 'movil'

export interface PropsDeBarraDeBuzones {
  /** Todos los que quien mira puede leer: los de «Mis correos» (enMisCorreos) van en «Mis buzones», el resto en «Equipo» */
  buzones: BuzonVisible[]
  /** Lo que está abierto: la píldora activa (layoutId="correo-carpeta") */
  carpeta: Carpeta
  /** Abrir una carpeta: Mis correos, Asignados a mí, un buzón (también «Abrir en solo lectura» del menú), el resumen o las secuencias */
  onCarpeta: (carpeta: Carpeta) => void
  /** Conversaciones encargadas a quien mira y sin hacer. «Asignados a mí» solo sale si hay alguna (> 0) */
  sinLeerAsignados: number
  /** Puede ver el resumen del equipo (administrador o supervisor) */
  supervisa: boolean
  /** Es administrador: «Equipo y permisos» */
  esAdmin: boolean
  /** Se enseña la entrada «Secuencias» (admin, o el motor en marcha) */
  verSecuencias: boolean
  /** El lápiz «Elegir» de «Mis buzones»: abre ElegirMisCorreos */
  onElegir: () => void
  /** Silenciar un buzón para mí (o quitarle el silencio con 'quitar'). Desde el menú contextual */
  onSilenciar: (buzonId: string, duracion: Duracion | 'quitar') => void
  /** «Quitar de / añadir a Mis correos» del menú contextual */
  onAlternarMisCorreos: (buzonId: string) => void
  /** «Ajustes del buzón» (solo se ofrece al dueño o a un admin) */
  onAjustes: (buzonId: string) => void
  /** «Conectar buzón» */
  onConectar: () => void
  /** «Resumen del equipo» (solo si supervisa). Equivale a onCarpeta({ tipo: 'equipo' }) */
  onResumen: () => void
  /** «Equipo y permisos» (solo admin) */
  onEquipoYPermisos: () => void
  variante: VarianteDeBarra
  /**
   * OPCIONAL. Sin leer de «Mis correos» (el número del menú, `sinLeerMios` de GET /api/correo/buzones). Si no llega, se suma
   * hilosSinLeerMios de los buzones con enMisCorreos y sin silenciar
   */
  sinLeerMios?: number
  /**
   * OPCIONAL (por defecto true). false = falta la migración 318: «Elegir», «Silenciar…» y «Quitar de / añadir a Mis correos» enseñan la banda
   * «Falta lanzar la migración 318 para elegir, asignar y silenciar correos» en vez de actuar
   */
  preferenciasDisponibles?: boolean
}

/* ------------------------------------------------------------------ */
/* Lista de hilos (columna 2)                                          */
/* ------------------------------------------------------------------ */

/** Qué se lista: un buzón suelto, la bandeja unificada («Mis correos», con la marca de color del buzón en cada fila) o «Asignados a mí» */
export type ModoDeLista = 'buzon' | 'mios' | 'asignados'

export interface PropsDeListaDeHilos {
  hilos: HiloDeLista[]
  cargando: boolean
  cargandoMas: boolean
  /** Hay otra página: el IntersectionObserver (a 600 px del final) llama a onCargarMas; «Ver más antiguos» queda de respaldo al final */
  hayMas: boolean
  /** Pedir la página siguiente (antes `onMas`) */
  onCargarMas: () => void
  seleccionado: string | null
  onElegir: (hiloId: string) => void
  vista: VistaDeCorreo
  onVista: (v: VistaDeCorreo) => void
  soloNoLeidos: boolean
  onSoloNoLeidos: (v: boolean) => void
  /** Con búsqueda (≥ 2 caracteres) los filtros NO se esconden: se aplican sobre los resultados en el cliente */
  busqueda: string
  onBusqueda: (texto: string) => void
  /** Las cuentas del buzón abierto. null en «Mis correos» y «Asignados a mí» (varios buzones) */
  resumen: ResumenDeBuzon | null
  /** Se está trayendo el histórico: la franja «Trayendo correos antiguos · faltan N» */
  importando: { quedan: number } | null
  error: string | null
  modo: ModoDeLista
  /** Los buzones que puede leer quien mira, por id: la marca de color de cada fila y si puede marcar o destacar desde él (puedeResponder) */
  buzonesPorId: ReadonlyMap<string, BuzonVisible>
  /** Silenciar o reactivar un hilo para mí */
  onSilenciar: (hiloId: string, duracion: Duracion | 'quitar') => void
  /** Marcar leído (true) o no leído (false). Solo se ofrece si el buzón del hilo es puedeResponder */
  onAlternarLeido: (hiloId: string, leido: boolean) => void
  /** Destacar (true) o quitar la estrella (false). Solo si puedeResponder */
  onDestacar: (hiloId: string, destacado: boolean) => void
  /** Ids de las filas que acaban de llegar (por el sondeo): entran con la animación. Nunca más de 12 animadas a la vez */
  nuevos: ReadonlySet<string>
  /** El chip «Ocultar silenciados» (solo en «Mis correos»; no se recuerda). Por defecto false: salen atenuados */
  ocultarSilenciados: boolean
  onOcultarSilenciados: (v: boolean) => void
  /** OPCIONAL. «Asignar» de la hoja de acciones del móvil (toque largo o ⋯). Sin él, no se ofrece */
  onAsignar?: (hiloId: string) => void
  /** Quien mira es administrador: puede encargar un hilo aunque no responda desde su buzón (como en la vista del hilo). Por defecto false */
  esAdmin?: boolean
  /** OPCIONAL. Estado vacío de «Mis correos»: [Elegir mis correos] */
  onElegirMisCorreos?: () => void
  /** OPCIONAL. Estado vacío de «Mis correos»: [Ver resumen del equipo] (solo si supervisa) */
  onResumen?: () => void
  /** OPCIONAL. Búsqueda sin resultados: [Buscar en todos los buzones que lees] (solo si supervisa) */
  onBuscarEnTodos?: () => void
}

/** Una fila de la lista (memo con clave el id). 72 px en lg y 76 px en el móvil */
export interface PropsDeFilaDeHilo {
  hilo: HiloDeLista
  /** Es la abierta: fondo --ls-sup2 y filo naranja */
  activo: boolean
  modo: ModoDeLista
  /** El buzón del hilo (para el color en la bandeja unificada y para saber si puede marcar o destacar). undefined si ya no se lee */
  buzon: BuzonVisible | undefined
  /** Acaba de llegar: entra desde arriba con el brillo naranja */
  nuevo: boolean
  onElegir: (hiloId: string) => void
  onSilenciar: (hiloId: string, duracion: Duracion | 'quitar') => void
  onAlternarLeido: (hiloId: string, leido: boolean) => void
  onDestacar: (hiloId: string, destacado: boolean) => void
  /** OPCIONAL. «Asignar» de la hoja de acciones del móvil. Solo se ofrece si se puede responder desde el buzón o quien mira es admin */
  onAsignar?: (hiloId: string) => void
  /** Quien mira es administrador. Por defecto false */
  esAdmin?: boolean
}

/* ------------------------------------------------------------------ */
/* Hilo abierto (columna 3)                                            */
/* ------------------------------------------------------------------ */

export interface PropsDeVistaDeHilo {
  hilo: HiloAbierto | null
  cargando: boolean
  error: string | null
  /** El buzón del hilo: insignia (punto y dirección), «Solo lectura · queda anotado» o «Asignado a ti · …». null mientras carga */
  buzon: BuzonVisible | null
  /** Puede contestar, marcar, destacar y asignar: es el dueño, o lo tiene asignado con respuesta. Manda sobre esMio */
  puedeResponder: boolean
  /** @deprecated Alias de puedeResponder para lo que aún no se ha cambiado. No lo uses para decidir si se puede escribir */
  esMio: boolean
  /** Quien mira (para «Hecho» si la encargada es ella y para «Enviado por» cuando no es el dueño) */
  yoId: string
  esAdmin: boolean
  onAtras: () => void
  onDestacar: () => void
  /** Marcar no leído: YA NO cierra el hilo (se queda abierto y la fila vuelve a negrita) */
  onMarcarNoLeido: () => void
  /** Silenciar o reactivar esta conversación para mí */
  onSilenciarHilo: (duracion: Duracion | 'quitar') => void
  /** Silenciar o reactivar al remitente (la contraparte) en todos los buzones que leo */
  onSilenciarRemitente: (duracion: Duracion | 'quitar') => void
  /** Abrir AsignarHilo (UserPlus, o el avatar de quien lo lleva / [Cambiar]) */
  onAsignar: () => void
  /** [Hecho] de la franja «Lo lleva …» (si es tuyo, o si puedes responder) */
  onHecho: () => void
  /**
   * Responder, a todos, reenviar. `textoInicial`: lo escrito en la respuesta rápida al pulsar «Abrir completo» (en el móvil no hay respuesta
   * rápida: «Responder» abre la hoja de Redactar)
   */
  onResponder: (modo: ModoDeRedactar, mensaje: MensajeDeHilo, textoInicial?: string) => void
  /** OPCIONAL. La respuesta rápida ha salido: recargar el hilo y la lista */
  onRespuestaEnviada?: (hiloId: string, asunto: string, detalle: DetalleDeEnvio) => void
}

/** Lo que cuenta Redactar al enviar. Hoy vive también en Redactar.tsx: es el mismo tipo (W3-REDACTAR puede reexportar este) */
export interface DetalleDeEnvio {
  /** A quién se envió, tal como estaba escrito en «Para» */
  para: string
  /** El texto tal como salió (con la firma debajo) */
  texto: string
  /** true si ya se ha enseñado un aviso de que algo no fue del todo bien (un destinatario rechazado o sin copia en Enviados) */
  conAviso: boolean
}

/** «Responder rápido» al pie del hilo: solo si puedeResponder y solo desde md. Textarea de 1 a 8 líneas, ⌘/Ctrl+↵ envía */
export interface PropsDeRespuestaRapida {
  hilo: HiloAbierto
  /** El buzón desde el que sale (el del hilo): su firma va debajo */
  buzon: BuzonVisible
  /** El mensaje al que se contesta (el último entrante, o el último) */
  mensaje: MensajeDeHilo
  onEnviado: (hiloId: string, asunto: string, detalle: DetalleDeEnvio) => void
  /** «Abrir completo»: pasa lo escrito a Redactar */
  onAbrirCompleto: (texto: string) => void
}

/** «Encárgate tú»: elegir la persona encargada de una conversación (pide GET /api/correo/hilos/[id]/encargables y hace el PATCH) */
export interface PropsDeAsignarHilo {
  abierto: boolean
  onCambio: (abierto: boolean) => void
  hiloId: string
  buzonId: string
  /** Quien lo lleva ahora, si alguien */
  actual: { personaId: string; nombre: string } | null
  /** Quien mira: sale arriba como «Yo» */
  yoId: string
  /** Ya asignado (o quitado, con null): la vista se actualiza sin recargar */
  onAsignado: (asignacion: { personaId: string; nombre: string; nota: string | null } | null) => void
}

/* ------------------------------------------------------------------ */
/* Redactar (hoja a pantalla completa en el móvil, por portal)          */
/* ------------------------------------------------------------------ */

export interface PropsDeRedactar {
  /** El buzón desde el que sale al abrir. Con buzonesParaEnviar, el «De:» puede cambiarlo */
  buzon: BuzonVisible
  /** Quién escribe y si es administrador: de eso depende qué plantillas puede tocar */
  yoId: string
  esAdmin: boolean
  borrador: BorradorDeCorreo
  onCerrar: () => void
  /** Se ha enviado: el hilo en el que ha quedado, el asunto con el que salió y lo que salió */
  onEnviado: (hiloId: string, asunto: string, detalle: DetalleDeEnvio) => void
  /** CorreoRapido enseña su propio aviso de «enviado»: con esto a true no se enseña el de siempre (los de algo que falló, sí) */
  sinAvisoDeExito?: boolean
  /**
   * OPCIONAL (no lo pasa CorreoRapido). Los buzones desde los que se puede enviar (puedeResponder && conectado && !credencialesInvalidas).
   * Con 2 o más sale el «De:». Sin él, el de hoy: solo `buzon`
   */
  buzonesParaEnviar?: BuzonVisible[]
  /** OPCIONAL. Se ha cambiado el «De:» (la firma cambia; los seguimientos se quitan si el nuevo no es esMio) */
  onCambiarBuzon?: (buzonId: string) => void
}

/* ------------------------------------------------------------------ */
/* Paneles                                                             */
/* ------------------------------------------------------------------ */

/** «Elige tus correos» (PanelLateral). Guardar = un solo POST /api/correo/preferencias con todos los cambios */
export interface PropsDeElegirMisCorreos {
  abierto: boolean
  onCambio: (abierto: boolean) => void
  /** Todos los que puede leer quien mira: TUYOS (esMio), ASIGNADOS A TI (asignado) y DEL EQUIPO */
  buzones: BuzonVisible[]
  /** false = falta la migración 318: se enseña la banda y no se puede guardar */
  disponible: boolean
  /** Guardar: la promesa se rechaza con el mensaje si falla (el panel se queda abierto) */
  onGuardar: (cambios: CambioDePreferencia[]) => Promise<void>
}

export type PestanaDeEquipo = 'asignaciones' | 'quien-ve-que' | 'cambios'

/** «Equipo y permisos» (solo admin; sustituye a «Quién ve qué»). PanelLateral ancho={760}; en el móvil, hoja inferior */
export interface PropsDeEquipoYPermisos {
  abierto: boolean
  onCambio: (abierto: boolean) => void
  /** Por defecto 'asignaciones' */
  pestanaInicial?: PestanaDeEquipo
  /** Quien mira: sale como «Yo» arriba del selector de personas */
  yoId: string
}

/** La chuleta de atajos (PanelLateral), con ATAJOS de lib/correo/atajos.ts */
export interface PropsDeAyudaDeAtajos {
  abierto: boolean
  onCambio: (abierto: boolean) => void
}
