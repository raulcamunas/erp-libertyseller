/**
 * LOS FESTIVOS VISTOS DESDE UN LEAD Y DESDE UNA CARTERA — PURO.
 * ===============================================================
 * Junta lo que sabe el lead (su comunidad y, si se sabe, su municipio: lib/ubicacion/) con el calendario (festivos.ts) y deja listo lo que la pantalla de Cold Calling
 * necesita: el aviso de la ficha, la marca de la lista y la banda de arriba con «hoy es festivo en … y afecta a N de tus leads». Se comprueba con lead.prueba.ts.
 */

import { CCAA, esCcaa, type CodigoCcaa } from '@/lib/ubicacion/zonas'
import { avisoDeFestivo, cuandoEs, dondeEsFestivo, esFestivo, fiestasDe, hayCalendarioPara, proximoDiaHabil, proximosFestivos, type AvisoDeFestivo } from './festivos'
import type { CodigoZona, Lugar } from './tipos'
import { NOMBRE_DE_ZONA } from './zonas-especiales'

export interface LeadConLugar {
  ccaa?: string | null
  municipio_ine?: string | null
}

/** Dónde está el lead para el calendario, o null si no se sabe (entonces no se avisa de nada: no se inventa) */
export function lugarDelLead(lead: LeadConLugar | null | undefined): Lugar | null {
  const c = lead?.ccaa
  return esCcaa(c) ? { ccaa: c, ine: lead?.municipio_ine ?? null } : null
}

/** ¿Es festivo ese día para ese lead? */
export const esFestivoParaElLead = (dia: string, lead: LeadConLugar | null | undefined): boolean => esFestivo(dia, lugarDelLead(lead))

/**
 * Lo que se dice en la marca de la lista: «Hoy es festivo en Madrid: Día siguiente a Todos los Santos», o null. NO sale en un festivo de toda España (Navidad, el 1 de
 * mayo…): sería la misma marca en todas las filas y no distinguiría a nadie; ese día lo dice la banda de arriba y la ficha de cada lead.
 */
export function marcaDeLista(dia: string, hoy: string, lead: LeadConLugar | null | undefined): string | null {
  const a = avisoDeFestivo(dia, hoy, lugarDelLead(lead))
  if (!a || a.fiestas.every((f) => f.alcance === 'nacional')) return null
  return `${a.titulo}: ${a.detalle}`
}

/* ------------------------------------------------------------------ */
/* El aviso de la ficha                                                */
/* ------------------------------------------------------------------ */

export interface AvisosDeLaFicha {
  /** Hoy es festivo para el lead */
  hoy: AvisoDeFestivo | null
  /** Qué día habría que llamarle: el primer día laborable que no es festivo para él */
  siguienteHabil: string | null
  /** La rellamada ya apuntada (en el futuro) cae en un día festivo para él */
  rellamada: (AvisoDeFestivo & { dia: string; siguienteHabil: string }) | null
}

export function avisosDeLaFicha(lead: (LeadConLugar & { next_call_date?: string | null }) | null | undefined, hoy: string): AvisosDeLaFicha {
  const lugar = lugarDelLead(lead)
  const vacio: AvisosDeLaFicha = { hoy: null, siguienteHabil: null, rellamada: null }
  if (!lugar || !hoy || !hayCalendarioPara(hoy)) return vacio
  const deHoy = avisoDeFestivo(hoy, hoy, lugar)
  const rell = lead?.next_call_date ?? null
  const deLaRellamada = rell && rell > hoy ? avisoDeFestivo(rell, hoy, lugar) : null
  return {
    hoy: deHoy,
    siguienteHabil: deHoy ? proximoDiaHabil(hoy, lugar) : null,
    rellamada: deLaRellamada && rell ? { ...deLaRellamada, dia: rell, siguienteHabil: proximoDiaHabil(rell, lugar) } : null,
  }
}

/** Una advertencia cuando la comunidad no es de fiar: de dónde se ha deducido. null cuando lo dice el propio lead (ciudad, código postal, provincia) */
export function notaDeUbicacion(origen: string | null | undefined, confianza: string | null | undefined): string | null {
  if (origen === 'telefono') return 'Comunidad deducida del prefijo de su teléfono fijo: puede no ser exacta (hay centralitas de otra ciudad).'
  if (origen === 'web') return 'Comunidad deducida de la terminación de su web (.cat, .gal, .eus): puede no ser exacta.'
  if (origen === 'registro') return 'Comunidad del Registro Mercantil donde está inscrita la empresa: puede operar en otro sitio.'
  if (origen === 'direccion' && confianza === 'media') return 'Comunidad deducida del final de su dirección, sin código postal: puede no ser exacta.'
  return null
}

/* ------------------------------------------------------------------ */
/* La banda de arriba                                                  */
/* ------------------------------------------------------------------ */

export interface BandaDeFestivos {
  /** El día del que se habla: hoy, o el próximo día festivo que afecte a esta cartera */
  dia: string
  esHoy: boolean
  /** Es festivo en las diecinueve */
  nacional: boolean
  /** Las comunidades que lo celebran entero */
  comunidades: CodigoCcaa[]
  zonas: CodigoZona[]
  /** Los municipios con fiesta local ese día */
  municipios: string[]
  nombres: string[]
  /** Leads de la cartera para los que ese día es festivo */
  afectados: number
}

/**
 * La banda de «hoy es festivo…»: el día de hoy si es festivo para algún lead de la cartera y, si no, el próximo festivo de los siguientes `margenDias` que le afecte.
 * Nada (null) si no hay calendario, si no hay festivo a la vista o si no afecta a ningún lead de esta cartera: una banda que dice «0 leads» no sirve para nada.
 */
export function bandaDeFestivos(leads: readonly LeadConLugar[], hoy: string, margenDias = 4): BandaDeFestivos | null {
  if (!hoy || !hayCalendarioPara(hoy)) return null
  for (const f of proximosFestivos(hoy, margenDias + 1)) {
    let afectados = 0
    for (const l of leads) if (esFestivo(f.dia, lugarDelLead(l))) afectados++
    if (afectados > 0) return { dia: f.dia, esHoy: f.dia === hoy, nacional: f.nacional, comunidades: f.comunidades, zonas: f.zonas, municipios: f.municipios, nombres: f.nombres, afectados }
  }
  return null
}

const unir = (nombres: readonly string[]): string => (nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`)

/** «Madrid, Andalucía y Aragón», «Madrid, Andalucía y 7 comunidades más», «toda España» */
export function nombreDeComunidades(comunidades: readonly CodigoCcaa[], nacional: boolean, ver = 3): string {
  if (nacional) return 'toda España'
  if (comunidades.length === 0) return 'algunas zonas'
  const cortos = comunidades.map((c) => CCAA[c].corto)
  if (cortos.length <= ver) return unir(cortos)
  const resto = cortos.length - (ver - 1)
  return `${cortos.slice(0, ver - 1).join(', ')} y ${resto} comunidades más`
}

/**
 * Dónde se celebra algo ese día, para el título de la banda: las comunidades, las islas o el Valle de Arán y los municipios con fiesta local, por ese orden. «Andalucía, Aragón y 7
 * comunidades más» si son solo comunidades; «Madrid y Alcalá de Henares» si es un día de fiestas locales; «toda España» si lo celebran las diecinueve.
 */
export function nombreDeSitios(b: Pick<BandaDeFestivos, 'comunidades' | 'zonas' | 'municipios' | 'nacional'>, ver = 3): string {
  if (b.nacional) return 'toda España'
  const sitios = [...b.comunidades.map((c) => CCAA[c].corto), ...b.zonas.map((z) => NOMBRE_DE_ZONA[z]), ...b.municipios]
  if (sitios.length === 0) return 'algunas zonas'
  if (sitios.length <= ver) return unir(sitios)
  const resto = sitios.length - (ver - 1)
  return `${sitios.slice(0, ver - 1).join(', ')} y ${resto} ${b.zonas.length === 0 && b.municipios.length === 0 ? 'comunidades' : 'sitios'} más`
}

/** Las frases de la banda: el título («Hoy es festivo en Madrid, …») y el detalle («Día siguiente a Todos los Santos») */
export function textosDeLaBanda(b: BandaDeFestivos, hoy: string): { titulo: string; detalle: string } {
  const cuando = cuandoEs(b.dia, hoy)
  const donde = nombreDeSitios(b)
  const sujeto = cuando === 'hoy' ? 'Hoy' : cuando === 'mañana' ? 'Mañana' : cuando[0].toUpperCase() + cuando.slice(1)
  return { titulo: `${sujeto} es festivo en ${donde}`, detalle: b.nombres.join(' · ') }
}

/** Todos los sitios de la banda, sin recortar, para el texto que sale al pasar el ratón */
export const comunidadesCompletas = (b: BandaDeFestivos): string =>
  b.nacional ? 'Las 19 comunidades y ciudades autónomas' : [...b.comunidades.map((c) => CCAA[c].nombre), ...b.zonas.map((z) => NOMBRE_DE_ZONA[z]), ...b.municipios.map((m) => `${m} (fiesta local)`)].join(', ')

/** Re-exportados para que la pantalla importe todo de un sitio */
export { cuandoEs, dondeEsFestivo, fiestasDe, proximoDiaHabil }
