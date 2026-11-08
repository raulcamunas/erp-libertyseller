/** Los tipos del chat del equipo, los mismos en el servidor y en la pantalla */

export type TipoDeCanal = 'canal' | 'privado' | 'directo'

export interface AdjuntoChat {
  nombre: string
  url: string
  tipo: string
  tamano: number
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
}

/** Lo que viaja por el canal en directo de cada persona (`chat:<id>`) */
export type EventoDeChat =
  | { tipo: 'mensaje'; mensaje: MensajeChat }
  | { tipo: 'editado'; mensaje: MensajeChat }
  | { tipo: 'borrado'; canalId: string; id: number }
  | { tipo: 'reaccion'; canalId: string; id: number; reacciones: Record<string, string[]> }
  /** Cambió algo del canal o de quién está en él: la pantalla relee la lista */
  | { tipo: 'canales' }
  /** Alguien ha abierto una junta en este canal */
  | { tipo: 'junta'; canalId: string; de: string; sala: string; estado: 'llama' }
