/**
 * LAS CLASES DE RESPUESTA QUE DISTINGUE LA IA Y CÓMO SE LLAMAN — PURO Y PEQUEÑO.
 * ==============================================================================
 * Viven aparte de clasificar.ts (que lleva el prompt de la IA) para que la pantalla de Secuencias las pinte sin llevarse los prompts en el paquete
 * del navegador. Se comprueban con clasificar.prueba.ts.
 */

export const CLASES_DE_RESPUESTA = ['interesado', 'pide_info', 'no_interesa', 'baja', 'mas_tarde', 'derivacion', 'fuera_de_oficina', 'otro'] as const
export type ClaseDeRespuesta = (typeof CLASES_DE_RESPUESTA)[number]

export const CONFIANZAS = ['alta', 'media', 'baja'] as const
export type Confianza = (typeof CONFIANZAS)[number]

/** Lo que se hace con una respuesta: nada, pasar el lead a «No le interesa», poner la rellamada o dejarlo para que lo mire una persona */
export const ACCIONES_CON_UNA_RESPUESTA = ['ninguna', 'cerrar', 'rellamar', 'revisar'] as const
export type AccionConUnaRespuesta = (typeof ACCIONES_CON_UNA_RESPUESTA)[number]

export const ETIQUETA_DE_CLASE: Record<ClaseDeRespuesta, string> = {
  interesado: 'Interesado',
  pide_info: 'Pide información',
  no_interesa: 'No le interesa',
  baja: 'Pide la baja',
  mas_tarde: 'Más adelante',
  derivacion: 'Te deriva a otra persona',
  fuera_de_oficina: 'Fuera de oficina',
  otro: 'Otra cosa',
}

/** El color con que se pinta cada clase: bien (verde), mal (rojo), espera (ámbar) o neutro (gris) */
export const TONO_DE_CLASE: Record<ClaseDeRespuesta, 'bien' | 'mal' | 'espera' | 'neutro'> = {
  interesado: 'bien',
  pide_info: 'bien',
  no_interesa: 'mal',
  baja: 'mal',
  mas_tarde: 'espera',
  derivacion: 'espera',
  fuera_de_oficina: 'neutro',
  otro: 'neutro',
}

export const ETIQUETA_DE_CONFIANZA: Record<Confianza, string> = { alta: 'segura', media: 'bastante segura', baja: 'poco segura' }

export const esClaseDeRespuesta = (v: unknown): v is ClaseDeRespuesta => typeof v === 'string' && (CLASES_DE_RESPUESTA as readonly string[]).includes(v)
export const esConfianza = (v: unknown): v is Confianza => typeof v === 'string' && (CONFIANZAS as readonly string[]).includes(v)
export const esAccionConUnaRespuesta = (v: unknown): v is AccionConUnaRespuesta => typeof v === 'string' && (ACCIONES_CON_UNA_RESPUESTA as readonly string[]).includes(v)
