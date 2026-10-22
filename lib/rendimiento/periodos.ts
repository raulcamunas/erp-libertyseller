import { diasDelMes, esDia, etiquetaDeDia, etiquetaDeMes, indiceDeSemana, mesDe, sumarDias, sumarMeses } from './dia'

/**
 * LOS PERIODOS DEL PANEL DE RENDIMIENTO: UN DÍA, UNA SEMANA O UN MES.
 * ====================================================================
 * PURO. Se comprueba con periodos.prueba.ts. Lo usan el navegador y las pruebas.
 *
 * Un periodo es un tipo y un día «ancla» cualquiera de dentro de él: la semana del miércoles 21 y la del lunes 19
 * son la misma. Todo se expresa en fechas civiles de Madrid ('2026-10-21'), como en dia.ts, y los dos extremos de
 * un rango cuentan (`desde` y `hasta` son días, no instantes).
 *
 * LA SEMANA EMPIEZA EN LUNES y acaba en domingo, igual que el calendario del panel. Un día LABORABLE es de lunes a
 * viernes: no se descuentan festivos ni vacaciones, porque no hay forma de saberlos y un día sin actividad es
 * justamente lo que el panel tiene que dejar ver.
 */

export type TipoDePeriodo = 'dia' | 'semana' | 'mes'

export interface Periodo {
  tipo: TipoDePeriodo
  /** Cualquier día de dentro del periodo */
  ancla: string
}

/** Dos días civiles, AMBOS incluidos */
export interface Rango {
  desde: string
  hasta: string
}

const dos = (n: number) => String(n).padStart(2, '0')

const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const
/** «los lunes», «los sábados»: de lunes a viernes el plural es el mismo */
const DIAS_EN_PLURAL = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos'] as const
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const

const MAXIMO_DE_DIAS = 400

export const lunesDe = (dia: string): string => sumarDias(dia, -indiceDeSemana(dia))
export const esLaborable = (dia: string): boolean => indiceDeSemana(dia) < 5
export const nombreDelDia = (dia: string): string => DIAS[indiceDeSemana(dia)]
export const nombreDelDiaEnPlural = (dia: string): string => DIAS_EN_PLURAL[indiceDeSemana(dia)]

const primeraMayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

export function primerDiaDelMes(dia: string): string {
  const { anio, mes } = mesDe(dia)
  return `${anio}-${dos(mes)}-01`
}

export function ultimoDiaDelMes(dia: string): string {
  const { anio, mes } = mesDe(dia)
  const dias = diasDelMes(anio, mes)
  return dias[dias.length - 1]
}

/** Los días de un periodo: de cuál a cuál */
export function rangoDe(p: Periodo): Rango {
  switch (p.tipo) {
    case 'dia':
      return { desde: p.ancla, hasta: p.ancla }
    case 'semana': {
      const lunes = lunesDe(p.ancla)
      return { desde: lunes, hasta: sumarDias(lunes, 6) }
    }
    case 'mes':
      return { desde: primerDiaDelMes(p.ancla), hasta: ultimoDiaDelMes(p.ancla) }
  }
}

/** Todos los días de un rango, en orden. Un rango absurdo (más de 400 días) es un fallo de quien llama, no algo que recorrer */
export function diasDelRango(r: Rango): string[] {
  const dias: string[] = []
  for (let d = r.desde; d <= r.hasta; d = sumarDias(d, 1)) {
    dias.push(d)
    if (dias.length > MAXIMO_DE_DIAS) throw new Error(`El rango ${r.desde} - ${r.hasta} pasa de ${MAXIMO_DE_DIAS} días`)
  }
  return dias
}

/** El mismo rango sin pasar de `tope` (normalmente hoy). null si todo él es posterior */
export function recortarA(r: Rango, tope: string): Rango | null {
  if (r.desde > tope) return null
  return { desde: r.desde, hasta: r.hasta < tope ? r.hasta : tope }
}

/** Cuántos días de lunes a viernes tiene un rango */
export function laborablesEn(r: Rango): number {
  return diasDelRango(r).filter(esLaborable).length
}

/** Cuántos días laborables LLEVA el rango: los que hay hasta hoy, sin contar los que aún no han llegado */
export function laborablesTranscurridos(r: Rango, hoy: string): number {
  const hasta = recortarA(r, hoy)
  return hasta ? laborablesEn(hasta) : 0
}

/**
 * `n` días laborables después (o antes, con n negativo). Pasar de viernes al lunes y de lunes al viernes es un paso.
 * Desde un sábado o un domingo, el primer paso cae en el laborable más cercano en esa dirección.
 */
export function sumarLaborables(dia: string, n: number): string {
  const sentido = n < 0 ? -1 : 1
  let d = dia
  for (let pasos = Math.abs(n); pasos > 0; pasos -= 1) {
    do d = sumarDias(d, sentido)
    while (!esLaborable(d))
  }
  return d
}

/** El periodo anterior (n negativo) o posterior (n positivo). Un día salta los fines de semana; las semanas y los meses, no */
export function moverPeriodo(p: Periodo, n: number): Periodo {
  switch (p.tipo) {
    case 'dia':
      return { tipo: 'dia', ancla: sumarLaborables(p.ancla, n) }
    case 'semana':
      return { tipo: 'semana', ancla: sumarDias(lunesDe(p.ancla), 7 * n) }
    case 'mes': {
      const { anio, mes } = mesDe(p.ancla)
      const nuevo = sumarMeses(anio, mes, n)
      return { tipo: 'mes', ancla: `${nuevo.anio}-${dos(nuevo.mes)}-01` }
    }
  }
}

/** ¿Empieza el periodo después de hoy? Entonces no hay nada que enseñar y no se puede avanzar hasta ahí */
export function empiezaEnElFuturo(p: Periodo, hoy: string): boolean {
  return rangoDe(p).desde > hoy
}

/** ¿Está hoy dentro del periodo? */
export function contieneHoy(p: Periodo, hoy: string): boolean {
  const r = rangoDe(p)
  return r.desde <= hoy && hoy <= r.hasta
}

/** «22 oct», «19–25 oct» o «26 oct – 1 nov» */
export function etiquetaDeRango(r: Rango): string {
  const [, m1, d1] = r.desde.split('-').map(Number)
  const [, m2, d2] = r.hasta.split('-').map(Number)
  if (r.desde === r.hasta) return `${d1} ${MESES_CORTOS[m1 - 1]}`
  return m1 === m2 ? `${d1}–${d2} ${MESES_CORTOS[m1 - 1]}` : `${d1} ${MESES_CORTOS[m1 - 1]} – ${d2} ${MESES_CORTOS[m2 - 1]}`
}

/** Cómo se llama un periodo en la barra: «Hoy · jueves 22 de octubre», «Esta semana · 19–25 oct», «Octubre 2026» */
export function etiquetaDePeriodo(p: Periodo, hoy: string): string {
  switch (p.tipo) {
    case 'dia': {
      const dia = etiquetaDeDia(p.ancla)
      if (p.ancla === hoy) return `Hoy · ${dia}`
      if (p.ancla === sumarDias(hoy, -1)) return `Ayer · ${dia}`
      return primeraMayuscula(dia)
    }
    case 'semana': {
      const r = rangoDe(p)
      const actual = rangoDe({ tipo: 'semana', ancla: hoy })
      const prefijo = r.desde === actual.desde ? 'Esta semana' : r.desde === sumarDias(actual.desde, -7) ? 'Semana pasada' : 'Semana'
      return `${prefijo} · ${etiquetaDeRango(r)}`
    }
    case 'mes': {
      const { anio, mes } = mesDe(p.ancla)
      const ahora = mesDe(hoy)
      const anterior = sumarMeses(ahora.anio, ahora.mes, -1)
      const nombre = primeraMayuscula(etiquetaDeMes(anio, mes))
      if (anio === ahora.anio && mes === ahora.mes) return `Este mes · ${nombre}`
      if (anio === anterior.anio && mes === anterior.mes) return `Mes pasado · ${nombre}`
      return nombre
    }
  }
}

/** Lo que se lee de la dirección: un periodo válido, o el de hoy si lo que llega no se entiende o es del futuro */
export function periodoDeTexto(tipo: unknown, ancla: unknown, hoy: string): Periodo {
  const t: TipoDePeriodo = tipo === 'semana' || tipo === 'mes' || tipo === 'dia' ? tipo : 'dia'
  const a = typeof ancla === 'string' && esDia(ancla) && ancla <= hoy ? ancla : hoy
  return { tipo: t, ancla: a }
}
