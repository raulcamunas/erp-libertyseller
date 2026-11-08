/** Los tipos del chat del equipo, los mismos en el servidor y en la pantalla */

import type { NivelDeAvisos } from './avisos'
import type { EncuestaChat } from './encuesta'
import type { EstadoChat } from './estado'

export type { EstadoChat, NivelDeAvisos, EncuestaChat }

export type TipoDeCanal = 'canal' | 'privado' | 'directo'

export interface AdjuntoChat {
  nombre: string
  /** La ruta en el almacén privado: es lo que se guarda y lo que viaja al enviar */
  ruta?: string
  /** El enlace firmado para abrirlo (lo pone el servidor al leer; caduca) */
  url: string
  tipo: string
  tamano: number
  /** Una nota de voz: cuánto dura (segundos) y lo que dice, escrito por la IA cuando termina de transcribirla */
  voz?: boolean
  duracion?: number
  transcripcion?: string
}

export interface CanalChat {
  id: string
  tipo: TipoDeCanal
  /** null en los directos: el nombre sale de la otra persona */
  nombre: string | null
  descripcion: string
  cliente_id: string | null
  auto_unirse: boolean
  archivado: boolean
  ultimo_mensaje_en: string | null
  creado_en: string
  /** Los miembros (ids). En un canal abierto con muchos miembros puede venir recortado; en directos y privados viene entero */
  miembros: string[]
  soy_miembro: boolean
  no_leidos: number
  menciones: number
  silenciado: boolean
  /** Hasta cuándo he leído (para la marca «Nuevos») */
  ultimo_leido_en: string | null
  /** Cuántos mensajes fijados tiene */
  fijados: number
  /** Cuánto me avisa este canal */
  avisos: NivelDeAvisos
  /** Un canal de anuncios: solo publican quienes lo administran */
  anuncios: boolean
  /** Administro este canal (o soy administrador del ERP): puedo publicar en uno de anuncios y cambiarlo */
  soy_admin: boolean
}

/** Lo que dice el mensaje al que se responde, para pintar la cita sin pedirlo aparte */
export interface CitaChat {
  id: number
  autor_id: string | null
  /** El principio del mensaje, en texto plano */
  texto: string
  /** El original se ha eliminado */
  borrado: boolean
}

export interface MensajeChat {
  id: number
  canal_id: string
  autor_id: string | null
  cuerpo: string
  hilo_de: number | null
  /** El mensaje que se cita al responder (no es lo mismo que un hilo) */
  cita: CitaChat | null
  menciones: string[]
  adjuntos: AdjuntoChat[]
  editado_en: string | null
  /** Cuándo se fijó arriba del canal (null = no está fijado) */
  fijado_en: string | null
  /** Si el mensaje es una encuesta, sus datos; los votos van en `votos` */
  encuesta: EncuestaChat | null
  /** opción → quién la ha votado */
  votos: Record<number, string[]>
  /** Quién lo escribió si no es del ERP (una importación de Slack) */
  autor_externo: string | null
  borrado_en: string | null
  creado_en: string
  /** emoji → quién ha reaccionado */
  reacciones: Record<string, string[]>
  /** Cuántas respuestas tiene el hilo (solo en los mensajes de arriba) */
  respuestas: number
}

export interface PersonaChat {
  id: string
  nombre: string
  email: string | null
  /** Su zona horaria (`Europe/Madrid`…) si la ha puesto */
  zona?: string | null
}

/** Lo que viaja por el canal en directo de cada persona (`chat:<id>`) */
export type EventoDeChat =
  | { tipo: 'mensaje'; mensaje: MensajeChat }
  | { tipo: 'editado'; mensaje: MensajeChat }
  | { tipo: 'borrado'; canalId: string; id: number }
  | { tipo: 'reaccion'; canalId: string; id: number; reacciones: Record<string, string[]> }
  /** Cambió algo del canal o de quién está en él: la pantalla relee la lista */
  | { tipo: 'canales' }
  /** Alguien ha cambiado su estado (null = lo ha quitado) */
  | { tipo: 'estado'; usuario: string; estado: EstadoChat | null }
  /** Alguien ha abierto una junta en este canal */
  | { tipo: 'junta'; canalId: string; de: string; sala: string; estado: 'llama' }

/** Un mensaje en una lista aparte (menciones, guardados, fijados) con el canal al que pertenece */
export interface ItemDeBandeja {
  mensaje: MensajeChat
  canalId: string
}

export interface ResultadoDeBusqueda {
  id: number
  canalId: string
  autor_id: string | null
  /** El principio del mensaje */
  cuerpo: string
  hilo_de: number | null
  creado_en: string
}

export interface RecordatorioChat {
  id: string
  texto: string
  canal_id: string | null
  mensaje_id: number | null
  avisar_en: string
  enviado_en: string | null
}

export interface ProgramadoChat {
  id: string
  canal_id: string
  cuerpo: string
  enviar_en: string
  estado: 'pendiente' | 'enviado' | 'cancelado' | 'error'
  error: string | null
  adjuntos: AdjuntoChat[]
}

export interface ResumenDeCanal {
  resumen: string
  decisiones: string[]
  pendientes: string[]
  preguntas: string[]
  /** Cuántos mensajes se han leído para hacerlo, y desde cuándo */
  mensajes: number
  desde: string
}
