/**
 * AMAZON ADS · EL AGENTE PPC: QUÉ PASO TOCA, SI CABE, ENSAYO, RAMPA Y TEXTO DE ESTADO. PURO (nada de servidor).
 *
 * - `siguientePaso` elige UN paso por prioridad: vigilar → aplicar → objetivos → cerebro → resumen → efectos → terminos_semana → calibrar.
 *   vigilar y aplicar van por minutos desde su sello; objetivos, efectos y terminos_semana por la fecha LOCAL del marketplace (entra ya
 *   calculada en `local`); cerebro y resumen por la hora de MADRID (`horaEnMadrid`). En `frenado` solo vigilar, objetivos, resumen,
 *   efectos y terminos_semana; en `apagado` nada.
 * - `pasoCabe`: solo se empieza un paso si en la pasada queda su coste (`COSTE_DE_PASO_MS`).
 * - Ensayo de 3 días (`finDeEnsayo`, `ensayoTerminado`, que da false durante la veda de temporada) y rampa de 7 días (`diaDeRampa`).
 * - `textoDeEstado`: la frase de la pantalla («En ensayo hasta el jueves 19 nov, 14:00», «Activo (rampa, día 2 de 7)»…), con Intl y la zona.
 *
 * No importa de ningún otro *-calculo: la hora local y la veda entran como parámetros.
 */

import { AGENTE, COSTE_DE_PASO_MS, RAMPA, type ConfigDelAgente, type EstadoDelAgente, type MarcasDePasos, type MotivoDeFreno, type PasoDelAgente } from './tipos'

const ZONA_DE_MADRID = 'Europe/Madrid'

const MIN_MS = 60_000
const DIA_MS = 86_400_000

const dos = (n: number) => String(n).padStart(2, '0')

/** Las piezas de la hora de pared de ese instante en la zona */
function partes(ms: number, zona: string): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const v: Record<string, number> = {}
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') v[p.type] = Number(p.value)
  return { y: v.year, m: v.month, d: v.day, h: (v.hour ?? 0) % 24, mi: v.minute ?? 0, s: v.second ?? 0 }
}

/** Cuánto va la zona por delante de UTC en ese instante (ms) */
function desfase(ms: number, zona: string): number {
  const p = partes(ms, zona)
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - (ms - (((ms % 1000) + 1000) % 1000))
}

const fechaDe = (p: { y: number; m: number; d: number }) => `${p.y}-${dos(p.m)}-${dos(p.d)}`

/** El instante (ms) de la hora de pared `fecha hora:00` en la zona (dos vueltas por el cambio de horario) */
function instanteDePared(fecha: string, hora: number, zona: string): number {
  const [y, m, d] = fecha.split('-').map(Number)
  const pared = Date.UTC(y, (m || 1) - 1, d || 1, hora, 0, 0)
  let t = pared - desfase(pared, zona)
  t = pared - desfase(t, zona)
  // Una hora de pared que no existe (salto de horario): la siguiente que sí
  if (fechaDe(partes(t, zona)) !== fecha) {
    const t2 = pared - desfase(t + 3_600_000, zona)
    if (fechaDe(partes(t2, zona)) === fecha) t = t2
  }
  return t
}

/** Días enteros entre dos fechas 'YYYY-MM-DD' (b − a); NaN si alguna no se entiende */
function diasEntre(a: string, b: string): number {
  const pa = Date.parse(`${a.slice(0, 10)}T00:00:00Z`)
  const pb = Date.parse(`${b.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(pa) || !Number.isFinite(pb)) return NaN
  return Math.round((pb - pa) / DIA_MS)
}

/** Suma días a una fecha 'YYYY-MM-DD' */
function sumarDias(fecha: string, n: number): string {
  const t = Date.parse(`${fecha.slice(0, 10)}T00:00:00Z`)
  return new Date(t + n * DIA_MS).toISOString().slice(0, 10)
}

const msDe = (iso: string | null): number | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/**
 * La hora en Madrid (la del cerebro y el resumen). `fecha` 'YYYY-MM-DD', `hora` 0–23, `minutos` 0–59 dentro de la hora,
 * `inicioDelDia` y `inicioDelMes`: el instante ISO (UTC) de las 00:00 de Madrid de hoy y del día 1 del mes.
 */
export function horaEnMadrid(ahora: number): { fecha: string; hora: number; minutos: number; inicioDelDia: string; inicioDelMes: string } {
  const p = partes(ahora, ZONA_DE_MADRID)
  const fecha = fechaDe(p)
  const primero = `${p.y}-${dos(p.m)}-01`
  return {
    fecha,
    hora: p.h,
    minutos: p.mi,
    inicioDelDia: new Date(instanteDePared(fecha, 0, ZONA_DE_MADRID)).toISOString(),
    inicioDelMes: new Date(instanteDePared(primero, 0, ZONA_DE_MADRID)).toISOString(),
  }
}

/** El lunes (fecha local 'YYYY-MM-DD') de la semana de esa fecha local; el domingo es del lunes anterior */
export function lunesLocal(fechaLocal: string): string {
  const t = Date.parse(`${fechaLocal.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(t)) return fechaLocal
  const dia = new Date(t).getUTCDay() // 0 = domingo
  return new Date(t - ((dia + 6) % 7) * DIA_MS).toISOString().slice(0, 10)
}

/** Pasos que se dan con el agente frenado (medir y avisar; nada que escriba ni piense) */
const PASOS_EN_FRENADO: ReadonlySet<PasoDelAgente> = new Set<PasoDelAgente>(['vigilar', 'objetivos', 'resumen', 'efectos', 'terminos_semana'])

/** ¿Hace al menos `min` minutos del sello (o no lo hay)? */
const pasaronMinutos = (sello: string | null, ahora: number, min: number): boolean => {
  const t = msDe(sello)
  return t === null || ahora - t >= min * MIN_MS
}

/**
 * El siguiente paso de la cuenta, o null si no toca ninguno. Prioridad: vigilar → aplicar → objetivos → cerebro → resumen → efectos →
 * terminos_semana → calibrar. Las marcas son los sellos de `ads_agente` (el orquestador los pone ANTES de ejecutar).
 */
export function siguientePaso(e: {
  estado: EstadoDelAgente
  marcas: MarcasDePasos
  ahora: number
  local: { fecha: string; hora: number; minutos: number }
  hayPendientes: boolean
  rarasSinIa: number
  hayTerminosSinIa: boolean
  pensarYa: boolean
}): PasoDelAgente | null {
  if (e.estado === 'apagado') return null
  const { marcas: m, ahora, local } = e
  const madrid = horaEnMadrid(ahora)
  const frenado = e.estado === 'frenado'

  const candidatos: Array<[PasoDelAgente, () => boolean]> = [
    ['vigilar', () => pasaronMinutos(m.vigilarAt, ahora, AGENTE.MIN_ENTRE_VIGILAR)],
    ['aplicar', () => (e.estado === 'ensayo' || e.estado === 'activo') && e.hayPendientes && pasaronMinutos(m.aplicarAt, ahora, AGENTE.MIN_ENTRE_APLICAR)],
    ['objetivos', () => m.objetivosDia !== local.fecha],
    [
      'cerebro',
      () => {
        if (e.pensarYa) return true
        if (madrid.hora >= AGENTE.HORA_CEREBRO_MANANA) {
          const ochoDeHoy = instanteDePared(madrid.fecha, AGENTE.HORA_CEREBRO_MANANA, ZONA_DE_MADRID)
          const ultimo = msDe(m.cerebroAt)
          if (ultimo === null || ultimo < ochoDeHoy) return true
        }
        return madrid.hora >= AGENTE.HORA_CEREBRO_TARDE && m.cerebroTardeDia !== madrid.fecha && (e.rarasSinIa > 0 || e.hayTerminosSinIa)
      },
    ],
    ['resumen', () => madrid.hora >= AGENTE.HORA_RESUMEN && m.resumenDia !== madrid.fecha],
    ['efectos', () => m.efectosResto || (local.hora >= AGENTE.HORA_EFECTOS_LOCAL && m.efectosDia !== local.fecha)],
    ['terminos_semana', () => m.terminosSemana !== lunesLocal(local.fecha)],
    ['calibrar', () => pasaronMinutos(m.calibradoAt, ahora, AGENTE.DIAS_ENTRE_CALIBRACIONES * 24 * 60)],
  ]

  for (const [paso, toca] of candidatos) {
    if (frenado && !PASOS_EN_FRENADO.has(paso)) continue
    if (toca()) return paso
  }
  return null
}

/** ¿Queda en la pasada lo que cuesta el paso? (cerebro, 75 s: a 170 s de 240 ya no cabe) */
export function pasoCabe(paso: PasoDelAgente, transcurridoMs: number, presupuestoMs: number): boolean {
  return presupuestoMs - Math.max(0, transcurridoMs) >= COSTE_DE_PASO_MS[paso]
}

/** Hasta cuándo dura el ensayo (ISO): 3 días desde el encendido; null si se salta */
export function finDeEnsayo(encendidoAt: number, saltarEnsayo: boolean): string | null {
  if (saltarEnsayo || !Number.isFinite(encendidoAt)) return null
  return new Date(encendidoAt + AGENTE.DIAS_DE_ENSAYO * DIA_MS).toISOString()
}

/**
 * Lo que se pone en la fila al REANUDAR y al ENCENDER: sin sello de vigilar. Mientras está frenado (o en una sesión anterior) el vigilar sella `vigilar_ok_at`
 * sin evaluar el freno; si se heredara, aplicar escribiría en Amazon hasta 30 min sin que nadie haya mirado el freno con el «ignorar» nuevo. Sin sellos, el
 * siguiente paso es vigilar (siguientePaso: sin vigilarAt → vigilar, y gana a aplicar) y aplicar no escribe hasta que ese vigilar termina bien.
 */
export const SIN_SELLO_DE_VIGILAR: { readonly vigilar_ok_at: null; readonly vigilar_at: null } = { vigilar_ok_at: null, vigilar_at: null }

/**
 * Al REANUDAR un agente que se frenó en el ensayo: un ensayo COMPLETO nuevo desde ahora (ISO). Un freno en ensayo es mala señal, y sin mover `ensayo_hasta` el siguiente
 * vigilar lo pasaría a activo (escribir en Amazon) en cuanto el freno hubiera durado más que lo que quedaba de ensayo.
 */
export function ensayoAlReanudar(ahora: number): string {
  return new Date(ahora + AGENTE.DIAS_DE_ENSAYO * DIA_MS).toISOString()
}

/** ¿Toca pasar de ensayo a activo? Solo en ensayo, con la fecha cumplida y FUERA de la veda de temporada */
export function ensayoTerminado(c: Pick<ConfigDelAgente, 'estado' | 'ensayoHasta'>, ahora: number, veda: { hasta: string } | null): boolean {
  if (c.estado !== 'ensayo') return false
  if (veda) return false
  const hasta = msDe(c.ensayoHasta)
  return hasta !== null && ahora >= hasta
}

/** Días enteros de rampa entre la fecha local en que empezó y hoy local (0 = primer día activo); null sin rampa */
export function diaDeRampa(rampaDesdeFechaLocal: string | null, hoyLocal: string): number | null {
  if (!rampaDesdeFechaLocal) return null
  const n = diasEntre(rampaDesdeFechaLocal, hoyLocal)
  if (!Number.isFinite(n)) return null
  return Math.max(0, n)
}

/** Días que dura la rampa (el último escalón empieza el día `desdeDia`, que es el día `desdeDia + 1`) */
const DIAS_DE_RAMPA = RAMPA[RAMPA.length - 1].desdeDia + 1

const TEXTO_DE_FRENO: Record<MotivoDeFreno, string> = {
  gasto_disparado: 'el gasto de hoy se ha disparado',
  acos_cuenta: 'el ACoS de la cuenta ha empeorado',
  errores_amazon: 'errores seguidos de Amazon',
  datos_viejos: 'los datos están desactualizados',
  ventas_caidas: 'las ventas totales se han hundido',
  manual: 'lo ha frenado una persona',
}

const sinPunto = (s: string) => s.replace(/\.$/, '')

/** «jueves 19 nov, 14:00» de un instante en la zona */
function fechaYHora(ms: number, zona: string): string {
  const f = new Intl.DateTimeFormat('es-ES', { timeZone: zona, weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const v: Record<string, string> = {}
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') v[p.type] = p.value
  return `${v.weekday} ${v.day} ${sinPunto(v.month)}, ${v.hour}:${v.minute}`
}

/** «3 dic» de una fecha 'YYYY-MM-DD' (es una fecha local ya calculada: se formatea en UTC para no moverla) */
function diaCorto(fecha: string): string {
  const t = Date.parse(`${fecha.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(t)) return fecha
  const f = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'short' })
  const v: Record<string, string> = {}
  for (const p of f.formatToParts(new Date(t))) if (p.type !== 'literal') v[p.type] = p.value
  return `${v.day} ${sinPunto(v.month)}`
}

/** La fecha local 'YYYY-MM-DD' de un instante en la zona */
const fechaLocalDe = (ms: number, zona: string) => fechaDe(partes(ms, zona))

/**
 * La frase de estado de la pantalla. Ejemplos: «Apagado», «En ensayo hasta el jueves 19 nov, 14:00», «En ensayo hasta el … · no pasa a activo
 * hasta el 3 dic (Black Friday)», «Ensayo terminado: activo desde el 3 dic (Black Friday)», «Activo (rampa, día 2 de 7)», «Activo desde el 3 dic»,
 * «Frenado: el gasto de hoy se ha disparado. <detalle>». `veda` es la veda de activación de HOY (o null).
 */
export function textoDeEstado(
  c: Pick<ConfigDelAgente, 'estado' | 'ensayoHasta' | 'frenoMotivo' | 'frenoDetalle' | 'encendidoAt' | 'activoDesde' | 'rampaDesde'> | null,
  ahora: number,
  zona: string,
  veda: { nombre: string; hasta: string } | null,
): string {
  if (!c || c.estado === 'apagado') return 'Apagado'
  const activoTrasVeda = veda ? diaCorto(sumarDias(veda.hasta, 1)) : null

  if (c.estado === 'ensayo') {
    const hasta = msDe(c.ensayoHasta)
    if (hasta === null) return veda ? `En ensayo · no pasa a activo hasta el ${activoTrasVeda} (${veda.nombre})` : 'En ensayo'
    if (ahora >= hasta) {
      if (veda) return `Ensayo terminado: activo desde el ${activoTrasVeda} (${veda.nombre})`
      return 'Ensayo terminado: pasa a activo en la próxima vigilancia'
    }
    const base = `En ensayo hasta el ${fechaYHora(hasta, zona)}`
    // La veda solo importa si el ensayo acaba dentro de ella
    if (veda && fechaLocalDe(hasta, zona) <= veda.hasta) return `${base} · no pasa a activo hasta el ${activoTrasVeda} (${veda.nombre})`
    return base
  }

  if (c.estado === 'frenado') {
    const motivo = c.frenoMotivo ? TEXTO_DE_FRENO[c.frenoMotivo] ?? c.frenoMotivo : 'sin motivo apuntado'
    const detalle = c.frenoDetalle?.trim()
    return `Frenado: ${motivo}${detalle ? `. ${detalle}` : ''}`
  }

  // activo
  const desde = msDe(c.rampaDesde)
  if (desde !== null) {
    const dia = diaDeRampa(fechaLocalDe(desde, zona), fechaLocalDe(ahora, zona))
    if (dia !== null && dia < DIAS_DE_RAMPA) return `Activo (rampa, día ${dia + 1} de ${DIAS_DE_RAMPA})`
  }
  const activo = msDe(c.activoDesde)
  return activo !== null ? `Activo desde el ${diaCorto(fechaLocalDe(activo, zona))}` : 'Activo'
}

/**
 * PURO. ¿El agente dice estar en marcha (ensayo o activo) con el motor en otro modo que «agente»? Entonces NO corre: cuentasDelAgente solo acepta esas cuentas
 * con el modo «agente» (no vigila, no frena, no avisa). Pasa si al reanudar o encender falla la escritura del modo, o si alguien cambia el modo a mano.
 * El panel lo dice en rojo y el bucle lo deja en la consola. No se frena solo: frenar escribe el modo «Aprueba y aplica», y eso pisaría el que haya puesto una persona.
 */
export function motorFueraDeModoAgente(estado: EstadoDelAgente | null | undefined, modoDelMotor: string | null | undefined): boolean {
  return (estado === 'ensayo' || estado === 'activo') && modoDelMotor !== 'agente'
}
