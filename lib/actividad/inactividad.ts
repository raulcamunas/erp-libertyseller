/**
 * CERRAR LA SESIÓN DE QUIEN LLEVA UN RATO SIN HACER NADA.
 * PURO. Se prueba en inactividad.prueba.ts.
 *
 * Lo pidió Raúl el 23 oct 2026: que a los empleados se les cierre la sesión tras X tiempo de inactividad, para que cada vez
 * que se pongan a trabajar tengan que iniciar sesión (y su hora de entrada quede apuntada de verdad en el registro de
 * actividad). X = 30 minutos por defecto, cambiable con la variable INACTIVIDAD_MINUTOS (entre 5 y 720).
 *
 * SON DOS CAPAS, y las dos hacen falta:
 *
 *   1. EL NAVEGADOR (components/actividad/RegistroDeActividad.tsx) cierra la sesión de una pestaña ABIERTA: un minuto antes
 *      avisa, y al llegar a X cierra. También al despertar el ordenador o volver a la pestaña: se mira la hora de verdad, no
 *      un contador que se paró con el portátil cerrado, y el primer toque tras el parón NO revive la sesión.
 *   2. EL SERVIDOR (app/dashboard/layout.tsx) cierra la de un navegador que se CERRÓ: al abrir el ERP de nuevo, mira cuándo
 *      fue la última actividad real y, si pasó más de X, no deja entrar (ruta /auth/inactividad).
 *
 * Solo a los empleados: a un administrador, un socio o un cliente no se les cierra nada.
 * Y si no se sabe cuándo fue la última actividad (la tabla no está, la base no contesta) NO se echa a nadie: un fallo del
 * registro nunca puede dejar fuera al equipo.
 */

export const MINUTOS_POR_DEFECTO = 30
export const MINUTOS_MINIMOS = 5
export const MINUTOS_MAXIMOS = 720
/** El aviso sale cuando faltan estos segundos */
export const AVISO_ANTES_S = 60

/** Lo que dice la configuración (un texto de variable de entorno, un número...) convertido en minutos válidos */
export function limiteDeInactividadMin(valor: unknown): number {
  const n = typeof valor === 'number' ? valor : typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : Number.NaN
  if (!Number.isFinite(n)) return MINUTOS_POR_DEFECTO
  return Math.min(MINUTOS_MAXIMOS, Math.max(MINUTOS_MINIMOS, Math.round(n)))
}

export type EstadoDeInactividad = { fase: 'activa' } | { fase: 'aviso'; segundos: number } | { fase: 'cerrar' }

/**
 * En qué punto está una pestaña: activa, a punto de cerrarse (con los segundos que faltan) o ya hay que cerrarla.
 * `ultimaMs` es el último toque de ratón o teclado en CUALQUIER pestaña del navegador.
 */
export function estadoDeInactividad(ahoraMs: number, ultimaMs: number, limiteMin: number): EstadoDeInactividad {
  const restante = Math.ceil((limiteMin * 60_000 - (ahoraMs - ultimaMs)) / 1000)
  if (restante <= 0) return { fase: 'cerrar' }
  if (restante <= AVISO_ANTES_S) return { fase: 'aviso', segundos: restante }
  return { fase: 'activa' }
}

/** El más reciente de unos instantes, ignorando los que faltan o no son un número */
export function ultimaActividadEfectiva(...marcas: Array<number | null | undefined>): number | null {
  let mejor: number | null = null
  for (const m of marcas) if (typeof m === 'number' && Number.isFinite(m) && (mejor === null || m > mejor)) mejor = m
  return mejor
}

/**
 * LA DECISIÓN DEL SERVIDOR al abrir el ERP: ¿se le cierra la sesión a esta persona?
 *
 * La última actividad es lo MÁS RECIENTE entre el último movimiento apuntado en el registro y la hora en que inició
 * sesión. Lo segundo no es un adorno: justo después de iniciar sesión el registro todavía puede no tener el apunte del
 * login (se manda en segundo plano al entrar), y sin esto la persona se vería echada nada más entrar, en bucle.
 */
export function debeCerrarseLaSesion(d: {
  rol: string | null | undefined
  ahoraMs: number
  ultimoEventoMs: number | null
  inicioDeSesionMs: number | null
  limiteMin: number
}): boolean {
  if (d.rol !== 'employee') return false
  const ultima = ultimaActividadEfectiva(d.ultimoEventoMs, d.inicioDeSesionMs)
  if (ultima === null) return false
  return d.ahoraMs - ultima >= d.limiteMin * 60_000
}
