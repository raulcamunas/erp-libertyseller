/**
 * PONER AL DÍA LO QUE LA AGENDA TIENE EN MEMORIA CON LO QUE SE ACABA DE LEER DE LA BASE — PURO.
 * ===============================================================================================
 * La agenda guarda en el navegador las citas de las semanas que se han mirado (components/agenda/useCitas.ts) y las mantiene al día con los avisos en tiempo real. Pero un aviso
 * que se pierde no se recupera, y se pierden: una pestaña que se queda en segundo plano (el portátil que se duerme, el navegador que congela las pestañas que no se miran, medio
 * minuto sin red, el canal que se reconecta) deja de recibirlos, y al volver enseñaba lo de antes sin decir nada. Con dos pestañas abiertas del mismo usuario —la de Cold Calling,
 * desde la que se agenda, y la de la Agenda— cada una enseñaba una cosa distinta, y no había forma de que la atrasada se enterase.
 *
 * Por eso la agenda también RELEE lo que se mira (al volver a la pestaña, al recuperar la red y cada pocos segundos), y esto es cómo se junta lo leído con lo que ya había.
 *
 * LA REGLA: dentro de lo que se leyó, manda lo leído. Para cada rango de tiempo que se pidió a la base:
 *   · una cita que llega y ya estaba IGUAL se deja tal cual, con el MISMO objeto. Los bloques del calendario están memorizados: un objeto nuevo e idéntico los repintaría todos en
 *     cada relectura aunque no haya cambiado nada;
 *   · una que llega distinta, o nueva, sustituye o entra;
 *   · una que estaba en memoria con el inicio dentro de ese rango y YA NO llega se quita (se borró, o se movió a otro día, mientras no se escuchaba);
 *   · lo que cae fuera de los rangos leídos no se toca;
 *   · y las citas INTOCABLES tampoco: una que se acaba de arrastrar a otra hora se ve ya en su sitio nuevo mientras el servidor confirma, y una lectura que cae en ese
 *     hueco trae todavía la hora vieja; aplicarla haría rebotar la tarjeta a su sitio de antes y volver. Se respetan hasta que el servidor responda.
 *
 * Si no cambia nada devuelve LA MISMA memoria (el mismo Map): quien la guarda en un estado de React no repinta.
 */

import type { AppointmentWithPeople } from '@/lib/types/appointments'

type Cita = AppointmentWithPeople

export interface Rango {
  /** ISO. Este instante entra */
  desde: string
  /** ISO. Este instante NO entra: una cita a las 00:00 del lunes siguiente es de la semana de después */
  hasta: string
}

/**
 * ¿Son lo mismo estos dos valores, tal como llegan de la base? (JSON: nulos, números, textos, listas y objetos.)
 * Una propiedad con valor `undefined` cuenta como si no estuviera: así una columna que una lectura trae y otra no (las de la migración 214) no hace distintas dos citas iguales.
 */
export function iguales(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => iguales(x, b[i]))

  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  const clavesDe = (o: Record<string, unknown>) => Object.keys(o).filter((k) => o[k] !== undefined)
  const kx = clavesDe(x)
  const ky = clavesDe(y)
  if (kx.length !== ky.length) return false
  return kx.every((k) => y[k] !== undefined && iguales(x[k], y[k]))
}

/** Junta lo leído en `rangos` con la memoria, según la regla de arriba. No modifica la memoria que recibe */
export function fusionarRangos(
  memoria: ReadonlyMap<string, Cita>,
  rangos: readonly Rango[],
  leidas: readonly Cita[],
  intocables: ReadonlySet<string> = new Set()
): ReadonlyMap<string, Cita> {
  const limites = rangos.map((r) => [Date.parse(r.desde), Date.parse(r.hasta)] as const)
  const dentro = (instante: string): boolean => {
    const t = Date.parse(instante)
    return limites.some(([desde, hasta]) => t >= desde && t < hasta)
  }

  const llegadas = new Map(leidas.map((c) => [c.id, c]))
  let siguiente: Map<string, Cita> | null = null
  /** La copia se hace al primer cambio y no antes: sin cambios se devuelve la memoria de entrada */
  const copia = () => (siguiente ??= new Map(memoria))

  for (const [id, nueva] of llegadas) {
    if (intocables.has(id)) continue
    const actual = memoria.get(id)
    if (actual && iguales(actual, nueva)) continue
    copia().set(id, nueva)
  }
  for (const [id, actual] of memoria) {
    if (intocables.has(id)) continue
    if (!llegadas.has(id) && dentro(actual.start_time)) copia().delete(id)
  }
  return siguiente ?? memoria
}

/**
 * De estas semanas, las que ya están en memoria pero llevan más de `edadMaximaMs` sin confirmarse con la base. `confirmadas` dice cuándo se confirmó cada una por última vez
 * (milisegundos; las que vienen de la página del servidor entran con 0: se leyeron en otro momento y se desconoce cuánto hace). Las que no están en memoria no salen: esas se
 * piden enteras, no se releen.
 */
export function semanasViejas(confirmadas: ReadonlyMap<string, number>, claves: readonly string[], ahora: number, edadMaximaMs: number): string[] {
  return claves.filter((c) => {
    const cuando = confirmadas.get(c)
    return cuando !== undefined && ahora - cuando > edadMaximaMs
  })
}

/** «hace 3 min»: para decir desde cuándo no se ha podido leer la agenda. Redondea hacia abajo y nunca dice menos de un minuto */
export function haceCuanto(desde: number, ahora: number): string {
  const minutos = Math.max(1, Math.floor((ahora - desde) / 60_000))
  if (minutos < 60) return `hace ${minutos} min`
  const horas = Math.floor(minutos / 60)
  return horas < 24 ? `hace ${horas} h` : `hace ${Math.floor(horas / 24)} d`
}
