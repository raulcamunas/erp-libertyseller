/**
 * LOS CANALES DE VOZ — PURO. Un canal de voz es un canal abierto de siempre (tiene su charla escrita) con una marca en `origen_id`: empieza por «voz:». Se entra a la sala con un clic, sin que
 * suene a nadie; quien está dentro se ve en la barra, debajo del nombre. Las llamadas en privado (directos) siguen como estaban. Se comprueba en voz.prueba.ts.
 */

export const PREFIJO_DE_VOZ = 'voz:'

export const esCanalDeVoz = (origenId: string | null | undefined): boolean => typeof origenId === 'string' && origenId.startsWith(PREFIJO_DE_VOZ)

/** Los canales de voz con los que nace el chat: el equipo los puede usar desde el primer día */
export const CANALES_DE_VOZ_POR_DEFECTO: ReadonlyArray<{ clave: string; nombre: string; descripcion: string }> = [
  { clave: 'sala-general', nombre: 'sala-general', descripcion: 'Charla de voz de todo el equipo' },
  { clave: 'comercial', nombre: 'comercial', descripcion: 'Para el equipo comercial: dudas, guion, cierres' },
  { clave: 'reuniones', nombre: 'reuniones', descripcion: 'Reuniones y llamadas con pantalla compartida' },
]

/** La marca que se guarda en `origen_id` de un canal de voz nuevo (única por canal) */
export const origenDeVoz = (clave: string): string => `${PREFIJO_DE_VOZ}${clave}`
