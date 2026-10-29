/**
 * ¿ES FESTIVO ESE DÍA PARA ESE LEAD? — PURO.
 * ===========================================
 * Un lead está en una comunidad autónoma (lib/ubicacion/resolver.ts la deduce de lo que trae) y, si se sabe, en un municipio. Con eso y los calendarios del BOE
 * (lib/festivos/datos/) se sabe qué fiestas laborales caen en un día para él: las de toda España, las de su comunidad y, si es de una isla de Canarias o del Valle de
 * Arán, las de su zona y, donde se han cargado (hoy, los 178 municipios de la Comunidad de Madrid en 2026: lib/festivos/locales.ts), la fiesta local de su municipio. No se inventa nada: un día sin calendario (un año que el BOE aún no ha publicado) no es festivo ni deja de serlo, simplemente no se sabe.
 *
 * Los días son «2026-11-02», el día del calendario de quien mira (lib/cold-calling/fechas.ts diaLocal): nunca se pasa por una fecha con hora, que es donde fallan los
 * cambios de hora y las zonas horarias.
 */

import { CCAA, CODIGOS_CCAA, type CodigoCcaa } from '@/lib/ubicacion/zonas'
import { CALENDARIOS } from './datos'
import { FIESTAS_LOCALES } from './locales'
import type { CodigoZona, Fiesta, Lugar } from './tipos'
import { NOMBRE_DE_ZONA, zonaDeMunicipio } from './zonas-especiales'

interface DiaIndexado {
  comunidades: { n: string; c: 'todas' | readonly CodigoCcaa[] }[]
  zonas: { n: string; z: CodigoZona }[]
  sinFiesta: Set<CodigoZona>
}

const POR_DIA = new Map<string, DiaIndexado>()
const ANIOS = new Set<number>()
const delDia = (dia: string): DiaIndexado => {
  let d = POR_DIA.get(dia)
  if (!d) POR_DIA.set(dia, (d = { comunidades: [], zonas: [], sinFiesta: new Set() }))
  return d
}
for (const cal of CALENDARIOS) {
  ANIOS.add(cal.anio)
  for (const f of cal.fiestas) delDia(f.f).comunidades.push({ n: f.n, c: f.c })
  for (const z of cal.zonas) delDia(z.f).zonas.push({ n: z.n, z: z.z })
  for (const s of cal.sinFiestaEnZona) delDia(s.f).sinFiesta.add(s.z)
}

/** Las fiestas locales: día -> (municipio INE -> su nombre) */
const LOCALES_POR_DIA = new Map<string, Map<string, string>>()
for (const l of FIESTAS_LOCALES) {
  let m = LOCALES_POR_DIA.get(l.f)
  if (!m) LOCALES_POR_DIA.set(l.f, (m = new Map()))
  m.set(l.ine, l.lugar)
}

/** ¿Se conoce el calendario del año de este día? Si no, la app no dice nada de festivos para él */
export const hayCalendarioPara = (dia: string): boolean => ANIOS.has(Number(dia.slice(0, 4)))

/** Los años con calendario, para avisar en Sistema cuando falte el siguiente */
export const aniosConCalendario = (): number[] => [...ANIOS].sort()

/** Las fiestas laborales que caen en ese día para ese lugar. Vacío si es un día normal, si no se sabe dónde está el lead o si no hay calendario */
export function fiestasDe(dia: string, lugar: Lugar | null | undefined): Fiesta[] {
  if (!lugar) return []
  const d = POR_DIA.get(dia)
  const salida: Fiesta[] = []
  if (d) {
    const zona = zonaDeMunicipio(lugar.ine)
    for (const f of d.comunidades) {
      if (f.c !== 'todas' && !f.c.includes(lugar.ccaa)) continue
      if (zona && d.sinFiesta.has(zona)) continue // la sustituye la de su zona (el Valle de Arán)
      salida.push({ dia, nombre: f.n, alcance: f.c === 'todas' ? 'nacional' : 'comunidad' })
    }
    if (zona) for (const z of d.zonas) if (z.z === zona) salida.push({ dia, nombre: z.n, alcance: 'zona' })
  }
  // La fiesta local de su municipio, si se sabe cuál es (solo con el municipio: con solo la comunidad no se puede saber)
  const local = lugar.ine ? LOCALES_POR_DIA.get(dia)?.get(lugar.ine) : undefined
  if (local) salida.push({ dia, nombre: 'Fiesta local', alcance: 'local', lugar: local })
  return salida
}

export const esFestivo = (dia: string, lugar: Lugar | null | undefined): boolean => fiestasDe(dia, lugar).length > 0

// --- el calendario de la semana ---------------------------------------------------------------------------------------------------------------------------------------

/** 0 = domingo … 6 = sábado, contado en el calendario */
export function diaDeLaSemana(dia: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dia)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay() : 0
}

export const esFinDeSemana = (dia: string): boolean => {
  const d = diaDeLaSemana(dia)
  return d === 0 || d === 6
}

const dos = (n: number) => String(n).padStart(2, '0')
const siguiente = (dia: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dia)
  if (!m) return dia
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1)
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`
}

/**
 * El primer día laborable DESPUÉS de `dia` para ese lugar: ni sábado ni domingo ni festivo allí. Sin lugar, solo salta los fines de semana.
 * Si en un mes no hay ninguno (no ocurre con calendarios reales) devuelve el día siguiente, que es mejor que colgarse.
 */
export function proximoDiaHabil(dia: string, lugar: Lugar | null | undefined): string {
  let d = siguiente(dia)
  for (let i = 0; i < 31; i++) {
    if (!esFinDeSemana(d) && !esFestivo(d, lugar)) return d
    d = siguiente(d)
  }
  return siguiente(dia)
}

// --- qué comunidades celebran algo un día -----------------------------------------------------------------------------------------------------------------------------

export interface FestivoDelDia {
  dia: string
  /** Lo celebran las diecinueve: es festivo en toda España */
  nacional: boolean
  /** Las comunidades que lo celebran entero (con todas, las diecinueve) */
  comunidades: CodigoCcaa[]
  /** Las islas o el Valle de Arán que celebran algo propio ese día */
  zonas: CodigoZona[]
  /** Los municipios con fiesta local ese día (sus nombres, por orden alfabético) */
  municipios: string[]
  /** Los nombres distintos de lo que se celebra */
  nombres: string[]
}

/** Qué se celebra ese día y dónde; null si ninguna comunidad, zona ni municipio celebra nada (o no hay calendario) */
export function festivosDelDia(dia: string): FestivoDelDia | null {
  const d = POR_DIA.get(dia)
  const locales = LOCALES_POR_DIA.get(dia)
  const comunidades = d ? CODIGOS_CCAA.filter((c) => d.comunidades.some((f) => f.c === 'todas' || f.c.includes(c))) : []
  const zonas = d ? d.zonas.map((z) => z.z) : []
  const municipios = locales ? [...locales.values()].sort((a, b) => a.localeCompare(b, 'es')) : []
  if (comunidades.length === 0 && zonas.length === 0 && municipios.length === 0) return null
  const nombres = [...new Set([...(d ? d.comunidades.map((f) => f.n) : []), ...(d ? d.zonas.map((z) => z.n) : []), ...(municipios.length > 0 ? ['Fiesta local'] : [])])]
  return { dia, nacional: comunidades.length === CODIGOS_CCAA.length, comunidades, zonas, municipios, nombres }
}

/** Los días laborables (de lunes a viernes) con algún festivo desde `desde` (incluido) durante `dias` días, en orden */
export function proximosFestivos(desde: string, dias = 14): FestivoDelDia[] {
  const salida: FestivoDelDia[] = []
  let d = desde
  for (let i = 0; i < dias; i++) {
    if (!esFinDeSemana(d)) {
      const f = festivosDelDia(d)
      if (f) salida.push(f)
    }
    d = siguiente(d)
  }
  return salida
}

// --- los textos que se ven --------------------------------------------------------------------------------------------------------------------------------------------

/** «hoy», «mañana» o «el lunes 2 de noviembre» */
export function cuandoEs(dia: string, hoy: string): string {
  if (dia === hoy) return 'hoy'
  if (dia === siguiente(hoy)) return 'mañana'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dia)
  if (!m) return dia
  const SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  return `el ${SEMANA[diaDeLaSemana(dia)]} ${Number(m[3])} de ${MESES[Number(m[2]) - 1]}`
}

/** Dónde es festivo, para decir «es festivo en …»: «toda España», «Madrid», «Tenerife (Canarias)», o el municipio si solo es su fiesta local */
export function dondeEsFestivo(fiestas: Fiesta[], lugar: Lugar): string {
  if (fiestas.length > 0 && fiestas.every((f) => f.alcance === 'nacional')) return 'toda España'
  const zona = zonaDeMunicipio(lugar.ine)
  if (zona && fiestas.some((f) => f.alcance === 'zona')) return `${NOMBRE_DE_ZONA[zona]} (${CCAA[lugar.ccaa].corto})`
  const local = fiestas.find((f) => f.alcance === 'local')
  if (local?.lugar && !fiestas.some((f) => f.alcance === 'comunidad')) return local.lugar
  return CCAA[lugar.ccaa].corto
}

export interface AvisoDeFestivo {
  /** «Hoy es festivo en Madrid» */
  titulo: string
  /** «Día siguiente a Todos los Santos» (o varios, separados por « · ») */
  detalle: string
  fiestas: Fiesta[]
}

/** El aviso de ese día para ese lugar, o null si no es festivo */
export function avisoDeFestivo(dia: string, hoy: string, lugar: Lugar | null | undefined): AvisoDeFestivo | null {
  if (!lugar) return null
  const fiestas = fiestasDe(dia, lugar)
  if (fiestas.length === 0) return null
  const cuando = cuandoEs(dia, hoy)
  const donde = dondeEsFestivo(fiestas, lugar)
  const titulo = cuando === 'hoy' ? `Hoy es festivo en ${donde}` : cuando === 'mañana' ? `Mañana es festivo en ${donde}` : `${cuando[0].toUpperCase()}${cuando.slice(1)} es festivo en ${donde}`
  return { titulo, detalle: fiestas.map((f) => f.nombre).join(' · '), fiestas }
}
