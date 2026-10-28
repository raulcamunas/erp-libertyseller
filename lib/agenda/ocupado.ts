/**
 * UN HUECO OCUPADO NO SE PUEDE AGENDAR.
 * =====================================
 * El calendario de la agenda es UNO (business@libertyseller.com): ahí están las citas que agendan los comerciales y los eventos que ya tenía ese calendario en Google
 * (reuniones fijas de cada semana, bloques de los managers…), que el ERP trae como «huecos de Google» y pinta rayados como «Ocupado». Hasta ahora se veían pero no
 * se respetaban: cualquiera podía agendar una cita justo encima (la propia migración 072 los trajo «para no agendar citas encima de huecos ya ocupados», pero nadie lo
 * impedía). Ahora una cita nueva, o una que se mueve de hora, NO se guarda si se solapa con otra cita o con un hueco de Google.
 *
 * QUÉ OCUPA UN HUECO: cualquier cita del ERP que no esté cancelada (agendada, confirmada, reagendada, no asistió, cualificada o no) y cualquier hueco de Google. Dos
 * reuniones seguidas (una acaba a las 10:00 y la otra empieza a las 10:00) NO se solapan.
 *
 * QUIÉN: todos. Los administradores y los socios (`partner`) pueden agendar encima si lo confirman a propósito (`forzar_hueco`), igual que ya pueden poner la hora de
 * fin que quieran (lib/agenda/duracion.ts): un comercial no.
 *
 * LO QUE NO SE TOCA: una cita que YA estaba encima de otra (las hay de antes) se puede seguir editando mientras no se le cambie la hora: apuntar una nota o cualificarla
 * no vuelve a mirar los huecos. Solo cuenta cuando se crea, cuando se cambia la hora o cuando se «reactiva» una cancelada.
 *
 * Es puro: no toca la base ni la red, y se comprueba con ocupado.prueba.ts. Lo usan la ficha, el arrastre del calendario y las rutas del servidor
 * (lib/agenda/ocupado-servidor.ts), así que no importa nada del servidor.
 */

/** Las únicas citas que no ocupan su hueco: las que se anularon */
export const ESTADOS_QUE_LIBERAN_EL_HUECO: ReadonlySet<string> = new Set(['cancelled'])

/** Lo mínimo de una cita (o de un hueco de Google, que es una fila más de `appointments` con `is_external`) para saber si ocupa un hueco */
export interface CitaQueOcupa {
  id: string
  start_time: string
  end_time: string
  status?: string | null
  is_external?: boolean | null
  lead_name?: string | null
}

/** Una cita u hueco con el que choca lo que se quiere agendar */
export interface Choque {
  id: string
  inicio: string
  fin: string
  /** Un hueco de Google (no es una cita del ERP) */
  externo: boolean
  estado: string
  /** Con quién es la cita (el nombre del contacto); null en un hueco de Google, que no trae título */
  con: string | null
}

const aMs = (v: Date | string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null
  const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/** Dos tramos [inicio, fin) se solapan si cada uno empieza antes de que acabe el otro. Si acaban justo cuando empieza el otro, no */
export function seSolapan(aInicio: number, aFin: number, bInicio: number, bFin: number): boolean {
  return aInicio < bFin && bInicio < aFin
}

/** ¿Esta cita ocupa su hueco? (todas menos las canceladas) */
export function ocupaSuHueco(c: { status?: string | null }): boolean {
  return !ESTADOS_QUE_LIBERAN_EL_HUECO.has(c.status ?? '')
}

/** ¿Puede esta persona agendar encima de un hueco ocupado si lo confirma? Los administradores y los socios; si no se sabe el rol, no */
export function puedeForzarHueco(rol: string | null | undefined): boolean {
  return rol === 'admin' || rol === 'partner'
}

/**
 * Lo que choca con una cita que va de `inicio` a `fin`, por orden de hora. `ignorarId` es la propia cita cuando se está moviendo (no choca consigo misma).
 * Un inicio o un fin que no son fechas, o un fin que no es posterior al inicio, no choca con nada: no hay nada que comprobar y de eso se ocupa quien valida la hora.
 */
export function choquesCon(inicio: Date | string | number | null | undefined, fin: Date | string | number | null | undefined, citas: readonly CitaQueOcupa[], ignorarId?: string | null): Choque[] {
  const i = aMs(inicio)
  const f = aMs(fin)
  if (i === null || f === null || f <= i) return []
  const salida: Choque[] = []
  for (const c of citas) {
    if (ignorarId && c.id === ignorarId) continue
    if (!ocupaSuHueco(c)) continue
    const ci = aMs(c.start_time)
    const cf = aMs(c.end_time)
    if (ci === null || cf === null || !seSolapan(i, f, ci, cf)) continue
    salida.push({ id: c.id, inicio: c.start_time, fin: c.end_time, externo: c.is_external === true, estado: c.status ?? 'scheduled', con: c.is_external === true ? null : c.lead_name?.trim() || null })
  }
  return salida.sort((a, b) => (aMs(a.inicio) ?? 0) - (aMs(b.inicio) ?? 0))
}

/** ¿Es «la misma hora» al minuto? Una cita guardada con segundos y la que devuelve la ficha (siempre en punto) no cuentan como un cambio */
const mismoMinuto = (a: number, b: number): boolean => Math.floor(a / 60_000) === Math.floor(b / 60_000)

export interface HorasYEstado {
  inicio: string
  fin: string
  estado: string | null | undefined
}

/**
 * ¿Hay que mirar si el hueco está libre al guardar ESTA EDICIÓN de una cita? Solo si al terminar ocupa su hueco (una que se cancela lo libera) y, o bien le han cambiado la
 * hora (al minuto), o bien antes no lo ocupaba (era una cancelada y se reactiva). Apuntar una nota o cualificarla no cambia nada de eso.
 */
export function hayQueComprobarAlEditar(antes: HorasYEstado, despues: HorasYEstado): boolean {
  if (!ocupaSuHueco({ status: despues.estado })) return false
  if (!ocupaSuHueco({ status: antes.estado })) return true
  const a = { inicio: aMs(antes.inicio), fin: aMs(antes.fin) }
  const d = { inicio: aMs(despues.inicio), fin: aMs(despues.fin) }
  if (d.inicio === null || d.fin === null) return false
  if (a.inicio === null || a.fin === null) return true
  return !mismoMinuto(a.inicio, d.inicio) || !mismoMinuto(a.fin, d.fin)
}

/* ------------------------------------------------------------------ */
/* Lo que se le dice a quien agenda                                    */
/* ------------------------------------------------------------------ */

/** La hora en España, «09:30»: es la que se ve en el calendario, esté donde esté el navegador (hay comerciales en Latinoamérica) */
const FORMATO_DE_HORA = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export const horaDeEspana = (iso: string | number | Date): string => FORMATO_DE_HORA.format(new Date(iso))

/** «la cita con «Merce Lopez» de 09:00 a 10:00» o «un evento del calendario de 10:00 a 11:00» */
export function describirChoque(c: Choque): string {
  const horas = `de ${horaDeEspana(c.inicio)} a ${horaDeEspana(c.fin)}`
  return c.externo ? `un evento del calendario ${horas}` : `la cita con «${c.con ?? 'otro contacto'}» ${horas}`
}

/** Lo que sigue a «Ese hueco ya está ocupado: …»: hasta dos de las cosas que lo ocupan y cuántas más hay. La ficha lo pone tras un título en negrita */
export function detalleDeHuecoOcupado(choques: readonly Choque[]): string {
  if (choques.length === 0) return ''
  const primeros = choques.slice(0, 2).map(describirChoque)
  const resto = choques.length - primeros.length
  const lista = primeros.length === 2 ? `${primeros[0]} y ${primeros[1]}` : primeros[0]
  return `${lista}${resto > 0 ? ` (y ${resto} más)` : ''}. Elige otra hora.`
}

export const TITULO_DE_HUECO_OCUPADO = 'Ese hueco ya está ocupado:'

/** El aviso entero, para un mensaje de texto (el que sale al arrastrar o el que devuelve el servidor) */
export function mensajeDeHuecoOcupado(choques: readonly Choque[]): string {
  return choques.length === 0 ? '' : `${TITULO_DE_HUECO_OCUPADO} ${detalleDeHuecoOcupado(choques)}`
}

/** Lo que las rutas contestan (409) cuando el hueco está ocupado, y lo que la pantalla busca para saber que es eso y no otro error */
export const CODIGO_DE_HUECO_OCUPADO = 'hueco_ocupado'

export interface CuerpoDeHuecoOcupado {
  error: string
  codigo: typeof CODIGO_DE_HUECO_OCUPADO
  choques: Choque[]
  /** Si quien agenda puede hacerlo igualmente confirmándolo (un administrador o un socio): la pantalla le pregunta */
  puede_forzar: boolean
}

export function cuerpoDeHuecoOcupado(choques: Choque[], puedeForzar: boolean): CuerpoDeHuecoOcupado {
  return { error: mensajeDeHuecoOcupado(choques), codigo: CODIGO_DE_HUECO_OCUPADO, choques, puede_forzar: puedeForzar }
}
