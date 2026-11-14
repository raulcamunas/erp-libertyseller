/**
 * LA HORA LOCAL DE CADA PERSONA — PURO. Cada persona elige su zona horaria (o se coge la del navegador la primera vez) y el chat enseña «allí son las 22:40», con un aviso si es hora de
 * descansar. Solo zonas de una lista corta, para que no se guarde cualquier cosa.
 */

export interface ZonaHoraria {
  id: string
  nombre: string
}

export const ZONAS: readonly ZonaHoraria[] = [
  { id: 'Europe/Madrid', nombre: 'España (Madrid)' },
  { id: 'Atlantic/Canary', nombre: 'Canarias' },
  { id: 'Europe/London', nombre: 'Reino Unido' },
  { id: 'Europe/Lisbon', nombre: 'Portugal' },
  { id: 'Europe/Paris', nombre: 'Francia / Alemania / Italia' },
  { id: 'America/Mexico_City', nombre: 'México' },
  { id: 'America/Bogota', nombre: 'Colombia' },
  { id: 'America/Lima', nombre: 'Perú' },
  { id: 'America/Guayaquil', nombre: 'Ecuador' },
  { id: 'America/Caracas', nombre: 'Venezuela' },
  { id: 'America/Santiago', nombre: 'Chile' },
  { id: 'America/Argentina/Buenos_Aires', nombre: 'Argentina' },
  { id: 'America/Montevideo', nombre: 'Uruguay' },
  { id: 'America/La_Paz', nombre: 'Bolivia' },
  { id: 'America/Asuncion', nombre: 'Paraguay' },
  { id: 'America/Panama', nombre: 'Panamá' },
  { id: 'America/Costa_Rica', nombre: 'Costa Rica' },
  { id: 'America/Santo_Domingo', nombre: 'República Dominicana' },
  { id: 'America/Sao_Paulo', nombre: 'Brasil (São Paulo)' },
  { id: 'America/New_York', nombre: 'EE. UU. (Este)' },
  { id: 'America/Chicago', nombre: 'EE. UU. (Centro)' },
  { id: 'America/Denver', nombre: 'EE. UU. (Montaña)' },
  { id: 'America/Los_Angeles', nombre: 'EE. UU. (Pacífico)' },
  { id: 'Asia/Dubai', nombre: 'Emiratos (Dubái)' },
  { id: 'Asia/Riyadh', nombre: 'Arabia Saudí' },
  { id: 'Europe/Istanbul', nombre: 'Turquía' },
  { id: 'Asia/Kolkata', nombre: 'India' },
  { id: 'Asia/Singapore', nombre: 'Singapur' },
  { id: 'Asia/Shanghai', nombre: 'China' },
  { id: 'Asia/Tokyo', nombre: 'Japón' },
  { id: 'Australia/Sydney', nombre: 'Australia (Sídney)' },
]

export const zonaValida = (z: unknown): z is string => typeof z === 'string' && ZONAS.some((x) => x.id === z)

/** La zona del navegador, si está en la lista; si no, null (y se elige a mano) */
export function zonaDetectada(candidata: string | null | undefined): string | null {
  if (!candidata) return null
  if (zonaValida(candidata)) return candidata
  // Algunos navegadores dan nombres antiguos de la misma zona
  const alias: Record<string, string> = { 'America/Buenos_Aires': 'America/Argentina/Buenos_Aires', 'Asia/Calcutta': 'Asia/Kolkata', 'Europe/Kiev': 'Europe/Kyiv' }
  return alias[candidata] && zonaValida(alias[candidata]) ? alias[candidata] : null
}

export interface HoraLocal {
  /** «22:40» */
  hora: string
  /** 0-23 */
  horaEntera: number
  /** El día de la semana corto («lun») cuando es otro distinto del de quien mira */
  otroDia: string | null
}

/** La hora de una zona en un instante, y si allí es otro día que en la zona de quien mira */
export function horaLocal(zona: string, ahora: number, zonaDeQuienMira: string = 'Europe/Madrid'): HoraLocal | null {
  if (!zonaValida(zona)) return null
  const f = (z: string, opciones: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-ES', { timeZone: z, ...opciones }).format(new Date(ahora))
  const hora = f(zona, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const diaAllí = f(zona, { year: 'numeric', month: '2-digit', day: '2-digit' })
  const diaAqui = f(zonaValida(zonaDeQuienMira) ? zonaDeQuienMira : 'Europe/Madrid', { year: 'numeric', month: '2-digit', day: '2-digit' })
  return { hora, horaEntera: Number(hora.slice(0, 2)), otroDia: diaAllí === diaAqui ? null : f(zona, { weekday: 'short' }).replace('.', '') }
}

/** ¿Es hora de descansar? De 22:00 a 7:59 */
export const esHoraDeDescanso = (horaEntera: number): boolean => horaEntera >= 22 || horaEntera < 8

/** La frase para enseñar: «22:40 allí» o «02:40 (mañana)» */
export function frasePorZona(zona: string | null | undefined, ahora: number, zonaDeQuienMira?: string): { texto: string; descansando: boolean; nombreDeZona: string } | null {
  if (!zona) return null
  const h = horaLocal(zona, ahora, zonaDeQuienMira)
  if (!h) return null
  return { texto: `${h.hora}${h.otroDia ? ` (${h.otroDia})` : ''}`, descansando: esHoraDeDescanso(h.horaEntera), nombreDeZona: ZONAS.find((z) => z.id === zona)?.nombre ?? zona }
}
