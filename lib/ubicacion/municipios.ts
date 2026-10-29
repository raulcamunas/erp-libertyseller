/**
 * EL ÍNDICE DE MUNICIPIOS DE ESPAÑA — buscar un municipio por el nombre tal como lo escribe la gente.
 * ===================================================================================================
 * La lista es la oficial del INE (datos/municipios-ine.json: 8.132 municipios, agrupados por provincia). Cada municipio se indexa con TODAS las formas razonables de su
 * nombre, con tres fuerzas, y una búsqueda devuelve solo los de la fuerza más alta que encuentre:
 *
 *   3 (oficial)  el nombre del INE con el artículo en su sitio («Coruña, A» -> «a coruña»; «Rozas de Madrid, Las» -> «las rozas de madrid»), cada mitad de un nombre
 *                doble con barra («Alacant/Alicante» -> «alacant», «alicante») y las dos juntas («donostia san sebastián»).
 *   2 (alias)    las formas que escribe la gente y no están en el INE (alias-municipios.ts).
 *   1 (débil)    el nombre sin su artículo («rozas de madrid») y cada mitad de un nombre con guion («vitoria», «gasteiz»).
 *
 * Así «Granada» es la ciudad de Granada aunque exista un municipio «Granada, La» en Barcelona (su forma sin artículo es débil y la oficial de la ciudad, fuerte).
 * Todo se compara normalizado (lib/ubicacion/texto.ts): sin tildes, en minúsculas y sin signos.
 */

import tabla from './datos/municipios-ine.json'
import { ALIAS_DE_MUNICIPIOS } from './alias-municipios'
import { normalizar } from './texto'
import { ccaaDeProvincia, type CodigoCcaa } from './zonas'

export interface Municipio {
  /** El código INE de cinco dígitos: provincia + municipio. «28079» es Madrid */
  ine: string
  /** El nombre oficial del INE, tal cual («Coruña, A») */
  nombre: string
  /** La provincia, de dos dígitos */
  prov: string
  ccaa: CodigoCcaa
}

const FILAS = tabla as unknown as Record<string, ReadonlyArray<readonly [string, string]>>

/** El artículo que el INE manda al final del nombre: «Coruña, A», «Hospitalet de Llobregat, L'», «Pobla de Segur, la» */
const ARTICULO_AL_FINAL = /^(.+?),\s*(l'|la|el|los|las|lo|les|els|a|o|os|as|es|sa|ses|s'|na)\s*$/i

interface Entrada {
  m: Municipio
  fuerza: 1 | 2 | 3
}

interface Indice {
  porNombre: Map<string, Entrada[]>
  porIne: Map<string, Municipio>
  /** Los alias cuyo destino no existe en el INE (debería ser siempre vacío: lo comprueba el test) */
  aliasRotos: string[]
}

/** Las formas de un nombre del INE: las oficiales (3) y las débiles (1) */
export function variantesDeNombre(nombreIne: string): { oficiales: string[]; debiles: string[] } {
  const oficiales = new Set<string>()
  const debiles = new Set<string>()
  const partes = nombreIne.split('/').map((p) => p.trim()).filter(Boolean)
  const colocadas: string[] = []
  for (const parte of partes) {
    const m = ARTICULO_AL_FINAL.exec(parte)
    if (m) {
      oficiales.add(normalizar(`${m[2]} ${m[1]}`))
      debiles.add(normalizar(m[1]))
      colocadas.push(`${m[2]} ${m[1]}`)
    } else {
      oficiales.add(normalizar(parte))
      colocadas.push(parte)
    }
    if (parte.includes('-')) for (const mitad of parte.split('-')) if (normalizar(mitad).length >= 5) debiles.add(normalizar(mitad))
  }
  if (partes.length > 1) oficiales.add(normalizar(colocadas.join(' ')))
  oficiales.delete('')
  debiles.delete('')
  for (const o of oficiales) debiles.delete(o)
  return { oficiales: [...oficiales], debiles: [...debiles] }
}

let cacheado: Indice | null = null

function construir(): Indice {
  const porNombre = new Map<string, Entrada[]>()
  const porIne = new Map<string, Municipio>()
  const poner = (clave: string, m: Municipio, fuerza: 1 | 2 | 3) => {
    const lista = porNombre.get(clave)
    if (!lista) porNombre.set(clave, [{ m, fuerza }])
    else if (!lista.some((e) => e.m.ine === m.ine && e.fuerza >= fuerza)) lista.push({ m, fuerza })
  }
  for (const [prov, filas] of Object.entries(FILAS)) {
    const ccaa = ccaaDeProvincia(prov)
    if (!ccaa) continue
    for (const [cod, nombre] of filas) {
      const m: Municipio = { ine: prov + cod, nombre, prov, ccaa }
      porIne.set(m.ine, m)
      const v = variantesDeNombre(nombre)
      for (const o of v.oficiales) poner(o, m, 3)
      for (const d of v.debiles) poner(d, m, 1)
    }
  }
  const aliasRotos: string[] = []
  for (const [alias, destino] of Object.entries(ALIAS_DE_MUNICIPIOS)) {
    const [prov, ...resto] = destino.split(':')
    const nombre = resto.join(':')
    let hallado: Municipio | undefined
    for (const m of porIne.values()) if (m.prov === prov && m.nombre === nombre) { hallado = m; break }
    if (hallado) poner(normalizar(alias), hallado, 2)
    else aliasRotos.push(alias)
  }
  return { porNombre, porIne, aliasRotos }
}

const indice = (): Indice => (cacheado ??= construir())

/**
 * Los municipios que se llaman así (el texto ya normalizado). Devuelve los de la fuerza más alta que haya: si existe uno oficial, los débiles no cuentan.
 * Vacío si ninguno. Más de uno = el nombre es ambiguo (Villanueva del Arzobispo está en Jaén y en Ciudad Real, por ejemplo).
 */
export function buscarMunicipios(normalizado: string): Municipio[] {
  const lista = indice().porNombre.get(normalizado)
  if (!lista) return []
  const mejor = Math.max(...lista.map((e) => e.fuerza))
  const vistos = new Set<string>()
  const salida: Municipio[] = []
  for (const e of lista) if (e.fuerza === mejor && !vistos.has(e.m.ine)) { vistos.add(e.m.ine); salida.push(e.m) }
  return salida
}

/** Un municipio por su código INE de cinco dígitos */
export const municipioDeIne = (ine: string): Municipio | undefined => indice().porIne.get(ine)

/** Cuántos municipios hay y los alias que no encuentran su destino (para el test) */
export const estadoDelIndice = () => ({ municipios: indice().porIne.size, aliasRotos: indice().aliasRotos })
