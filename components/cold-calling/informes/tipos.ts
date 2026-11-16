/**
 * El JSON del panel «Informes» (lib/analisis-amazon/panel.ts) y los formatos que comparten sus piezas. Las horas, siempre en Madrid.
 */
export type { ComercialDelPanel, Cuenta, EstadoDelProceso, FilaDelLog, PanelDeInformes } from '@/lib/analisis-amazon/panel'

const ZONA = 'Europe/Madrid'
const fHora = new Intl.DateTimeFormat('es-ES', { timeZone: ZONA, hour: '2-digit', minute: '2-digit' })
const fDiaCorto = new Intl.DateTimeFormat('es-ES', { timeZone: ZONA, day: 'numeric', month: 'short' })
const fDiaSemana = new Intl.DateTimeFormat('es-ES', { timeZone: ZONA, weekday: 'short', day: 'numeric', month: 'short' })
const fHoraDia = new Intl.DateTimeFormat('es-ES', { timeZone: ZONA, hour: '2-digit' })

/** «16 nov · 09:30» */
export const cuandoCorto = (iso: string) => `${fDiaCorto.format(new Date(iso))} · ${fHora.format(new Date(iso))}`
export const soloHora = (iso: string) => fHora.format(new Date(iso))
export const diaCorto = (iso: string) => fDiaCorto.format(new Date(iso))
/** «lun, 8 dic» */
export const diaConSemana = (iso: string) => fDiaSemana.format(new Date(iso))
/** «09 h» */
export const horaDelDia = (iso: string) => `${fHoraDia.format(new Date(iso))} h`
/** Un día 'YYYY-MM-DD' (de Madrid) en corto: «13 nov» */
export const etiquetaDeDia = (dia: string) => fDiaCorto.format(new Date(`${dia}T12:00:00Z`))

export const entero = (n: number) => Math.round(n).toLocaleString('es-ES')
export const decimal = (n: number, d = 1) => n.toLocaleString('es-ES', { maximumFractionDigits: d, minimumFractionDigits: 0 })

/** Días desde ahora hasta una fecha ISO (redondeado hacia arriba; 0 si ya pasó) */
export const diasHasta = (iso: string | null, ahora = Date.now()) => (iso ? Math.max(0, Math.ceil((Date.parse(iso) - ahora) / 86_400_000)) : null)

export const TEXTO_TIPO = { amazon: 'Amazon', sin: 'Sin Amazon' } as const
