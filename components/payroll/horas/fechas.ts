import { toMadrid } from '@/lib/timezone'

/** Rótulos de fechas de «Mis Horas». Todo en hora de España: el ciclo y el mes se deciden allí. */
export const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
export const MESES_LARGOS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]
export const INICIALES_SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
export const DIAS_LARGOS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

const pad = (n: number) => String(n).padStart(2, '0')

/** 'ago' a partir de '2026-08' */
export function nombreCortoDeMes(mes: string): string {
  return MESES_CORTOS[Number(mes.slice(5, 7)) - 1] ?? mes
}

/** 'yyyy-MM-dd' del día de hoy en hora de España */
export function claveDeHoy(): string {
  const d = toMadrid(new Date())
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const numeroDeDia = (clave: string) => Number(clave.split('-')[2])

/** «17 nov» */
export function diaYMes(clave: string): string {
  const [, m, d] = clave.split('-').map(Number)
  return `${d} ${MESES_CORTOS[m - 1]}`
}

/** «17 de noviembre» */
export function diaYMesLargo(clave: string): string {
  const [, m, d] = clave.split('-').map(Number)
  return `${d} de ${MESES_LARGOS[m - 1]}`
}
