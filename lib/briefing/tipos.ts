/**
 * EL BRIEFING DIARIO, TAL COMO LO CONSTRUYE LA RUTINA «BRIEFING DIARIO LIBERTY SELLER» Y TAL COMO LO PINTA EL ERP.
 * ================================================================================================================
 * Solo tipos y constantes: nada que importe Supabase ni el servidor, así que lo usan igual el validador (esquema.ts), el servidor, el conector MCP y la pantalla.
 *
 * Es el MISMO JSON que la rutina ya mete en el artefacto de claude.ai (el bloque `briefing-data` de su plantilla): mismas claves, mismos nombres. La rutina lo
 * publica además en el ERP llamando a la herramienta `publicar_briefing` del conector (lib/mcp/briefing.ts), y aquí se guarda ya LIMPIO (esquema.ts): textos
 * recortados, enlaces solo https, números o null, listas con tope. Lo que llega de un modelo no se pinta tal cual.
 *
 * Todo lo que no es una cifra son frases cortas pensadas para leerse en un minuto.
 */

export type NivelDeAviso = 'alta' | 'media'

export interface PuntoDeAgenda {
  /** «9:00», «Mañana 10:00» */
  hora: string
  titulo: string
  /** «Meet · confirmada», «Meet · 3 sin confirmar» */
  nota: string
}

/** Un punto de «Revisa hoy»: lo que necesita a Raúl o a Marius */
export interface PuntoARevisar {
  /** Identifica el punto dentro de su día: es lo que se marca como resuelto. Lo pone el validador, no la IA */
  clave: string
  nivel: NivelDeAviso
  /** «Comercial», «Entrais», «Solter»… */
  area: string
  titulo: string
  texto: string
  /** Dónde está («Gmail · Entrais, 25/10») */
  fuente: string
  /** Enlace https a la fuente, o null */
  url: string | null
}

export interface PersonaComercial {
  nombre: string
  url: string | null
  llamadas: number | null
  whatsapps: number | null
  respuestas: number | null
  citas: number | null
  resumen: string
}

export interface AlertaComercial {
  quien: string
  texto: string
}

export interface EquipoComercial {
  periodo: string
  totales: { llamadas: number | null; whatsapps: number | null; respuestas: number | null; citas: number | null }
  kpi_nota_llamadas: string
  kpi_nota_citas: string
  lectura: string
  alertas: AlertaComercial[]
  personas: PersonaComercial[]
}

export interface PersonaDeCuentas {
  nombre: string
  rol: string
  fecha_label: string
  url: string | null
  hecho: string[]
  en_curso: string[]
  bloqueos: string[]
}

export interface EquipoDeCuentas {
  periodo: string
  personas: PersonaDeCuentas[]
  /** Quién no tiene briefing reciente y su último día (AAAA-MM-DD) */
  sin_briefing: Array<{ nombre: string; ultimo: string }>
}

export interface ComentarioDeTarea {
  tarea: string
  cliente: string
  autor: string
  fecha: string
  texto: string
  /** ¿Pide algo a Raúl o a Marius? */
  pide: boolean
  url: string | null
}

export interface TareaEnRevision {
  tarea: string
  cliente: string
  responsable: string
  checklist: string
  url: string | null
}

export interface TareaDestacada extends TareaEnRevision {
  /** El motivo corto por el que se destaca */
  texto: string
}

export interface PendientesDeCliente {
  cliente: string
  pendientes: number
  en_revision: number
}

export interface TareasDeClientes {
  nota: string
  totales: { en_progreso: number | null; en_revision: number | null; sin_responsable: number | null; clientes: number | null }
  comentarios: ComentarioDeTarea[]
  en_revision: TareaEnRevision[]
  destacadas: TareaDestacada[]
  por_cliente: PendientesDeCliente[]
}

export interface CorreoPendiente {
  /** Lo que se marca como resuelto. Lo pone el validador */
  clave: string
  nivel: NivelDeAviso
  titulo: string
  de: string
  fecha: string
  texto: string
  url: string | null
}

export interface Briefing {
  /** «Martes 27 de octubre de 2026» */
  fecha_label: string
  /** «27/10 · 07:40» */
  actualizado: string
  titular: string
  agenda: PuntoDeAgenda[]
  revisar: PuntoARevisar[]
  comerciales: EquipoComercial | null
  equipo: EquipoDeCuentas | null
  tareas: TareasDeClientes | null
  correo: CorreoPendiente[]
  pie: string
}

/** Lo que se guarda de un briefing en la base */
export interface BriefingGuardado {
  /** AAAA-MM-DD, día de Madrid */
  dia: string
  briefing: Briefing
  publicadoAt: string
  actualizadoAt: string
}

/** Un día con briefing, para el selector de la pantalla */
export interface DiaConBriefing {
  dia: string
  titular: string
  puntosARevisar: number
}

/** Una marca de «resuelto» */
export interface MarcaDeResuelto {
  /** Quién la puso (nombre), si se sabe */
  por: string | null
  /** Cuándo, ISO */
  cuando: string
}

/** Cómo está el conector de la rutina (lo enseña la pantalla a los administradores). Nunca lleva el enlace: de él solo se guarda la huella */
export interface EstadoDelConector {
  hayEnlace: boolean
  creadoAt: string | null
  ultimoUsoAt: string | null
}

/** El tipo de briefing. Hoy solo hay el diario; la columna existe para el día que haya otro (el semanal de los lunes) */
export const TIPO_DE_BRIEFING = 'diario'

/** Los permisos y nombres del módulo. El id de la app va LETRA POR LETRA igual que en lib/config/apps.ts y middleware.ts */
export const APP_BRIEFING = 'briefing'
