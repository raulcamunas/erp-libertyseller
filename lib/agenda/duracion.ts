/**
 * LA DURACIÓN DE UNA CITA QUE AGENDA UN COMERCIAL: SIEMPRE UNA HORA.
 * ===================================================================
 * La sesión que agenda un comercial es una consultoría, no una llamada de encaje: dura una hora. Hasta ahora la ficha de la cita nacía de una hora, pero la hora de
 * fin se podía cambiar a mano (y la ruta del servidor se fiaba de lo que mandara el navegador), así que salían citas de media hora, o de quince minutos, que luego
 * dejaban un hueco o se pisaban con la siguiente.
 *
 * Ahora la hora de fin NO la elige el comercial: es siempre la de inicio más una hora. Lo impone la pantalla (la ficha y el arrastrar para reagendar) y, sobre todo,
 * la ruta del servidor (`/api/appointments`), que ignora la hora de fin que le llegue.
 *
 * QUIÉN: todos menos los administradores y los socios (`partner`), que siguen pudiendo poner la hora de fin que quieran (una reunión interna, una sesión larga).
 * Si no se sabe qué rol tiene quien escribe (la consulta del perfil falló), se impone la hora: es la regla de la mayoría y la que protege el calendario.
 *
 * LO QUE NO SE TOCA: una cita que ya existía con otra duración se queda como estaba mientras nadie le cambie la hora. Apuntar una nota o marcarla como cualificada
 * manda también la hora de siempre, y eso no puede alargarla ni, sobre todo, avisar por correo al lead de un «cambio de hora» que no ha habido. Si SE cambia la hora
 * (aunque sea solo la de fin), la cita pasa a durar una hora desde el inicio nuevo.
 *
 * Es puro: no toca la base ni la red, y se comprueba con duracion.prueba.ts. Lo usan la pantalla y las rutas, así que no importa nada del servidor.
 */

export const DURACION_CITA_MINUTOS = 60
export const DURACION_CITA_MS = DURACION_CITA_MINUTOS * 60_000

/** ¿Tiene esta persona la duración fija de una hora? Todos menos los administradores y los socios; si no se sabe, sí */
export function tieneDuracionFija(rol: string | null | undefined): boolean {
  return rol !== 'admin' && rol !== 'partner'
}

const aMs = (v: Date | string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/** La hora de fin de una cita de una hora que empieza en `inicio`. null si el inicio no es una fecha */
export function finDeUnaHora(inicio: Date | string | number | null | undefined): Date | null {
  const t = aMs(inicio)
  return t === null ? null : new Date(t + DURACION_CITA_MS)
}

/** Dos instantes son «la misma hora» al minuto: una cita guardada con segundos y la que devuelve la ficha (siempre en punto) no cuentan como un cambio */
const mismoMinuto = (a: number, b: number): boolean => Math.floor(a / 60_000) === Math.floor(b / 60_000)

export interface HorasGuardadas {
  inicio: string
  fin: string
}

/**
 * La hora de fin que hay que guardar.
 *
 * `inicio` es la hora de inicio con la que se va a guardar (la que manda el navegador o, si no manda ninguna, la que ya tenía la cita) y `fin` la que ha mandado el
 * navegador (puede faltar). `anterior` es lo que había guardado, solo al editar.
 *
 *   · Administrador o socio: lo que manda el navegador (o, si no manda nada, lo que había). Nada cambia respecto a como era.
 *   · Cualquier otro, al crear: el inicio más una hora, mande lo que mande el navegador.
 *   · Cualquier otro, al editar: si ni el inicio ni el fin han cambiado (al minuto), lo que ya había, tal cual; si ha cambiado alguno, el inicio más una hora.
 *
 * Devuelve null si no se puede decidir: el inicio no es una fecha y hay que imponer la hora (la ruta contesta con un 400), o no hay ningún fin que guardar.
 */
export function finQueSeGuarda(p: { rol: string | null | undefined; inicio: string | null | undefined; fin: string | null | undefined; anterior?: HorasGuardadas | null }): string | null {
  if (!tieneDuracionFija(p.rol)) return p.fin ?? p.anterior?.fin ?? null

  const inicio = aMs(p.inicio ?? p.anterior?.inicio)
  if (inicio === null) return null

  if (p.anterior) {
    const inicioAntes = aMs(p.anterior.inicio)
    const finAntes = aMs(p.anterior.fin)
    const finNuevo = aMs(p.fin ?? p.anterior.fin)
    if (inicioAntes !== null && finAntes !== null && finNuevo !== null && mismoMinuto(inicio, inicioAntes) && mismoMinuto(finNuevo, finAntes)) return p.anterior.fin
  }
  return new Date(inicio + DURACION_CITA_MS).toISOString()
}
