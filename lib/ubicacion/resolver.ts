/**
 * EN QUÉ COMUNIDAD AUTÓNOMA ESTÁ UN LEAD — a partir de lo que dice de sí mismo. PURO.
 * ===================================================================================
 * Un lead trae su sitio escrito de muchas maneras, según de dónde vino: la ciudad («Madrid», «Seville», «L'Hospitalet de Llobregat»), la provincia de Amazon
 * («BARCELONA», pero también «CATALUÑA», «MOLINA DE SEGURA» o «ESPAÑA»), la dirección con su código postal, el Registro Mercantil («Registro Mercantil de Asturias, Tomo
 * 3550…»), el prefijo de un teléfono fijo o la terminación de la web. Esto lo deja todo en lo único que importa para saber si hoy es festivo: la comunidad autónoma
 * (ISO 3166-2:ES), y cuando se sabe, la provincia y el municipio (INE).
 *
 * Las fuentes se miran por este orden y gana la primera que da respuesta:
 *   1 ciudad       lo que el lead dice de sí mismo, lo más preciso (alta)
 *   2 dirección    su código postal y, si lo trae, el municipio escrito al lado (alta); sin código postal, el municipio al final de la dirección (media)
 *   3 provincia    el campo «provincia» de Amazon: una provincia, una comunidad o un municipio (alta)
 *   4 registro     dónde está inscrita la empresa (media: puede operar en otro sitio)
 *   5 teléfono     el prefijo de un fijo (baja: hay centralitas virtuales)
 *   6 web          .cat, .gal, .eus (baja)
 * Una pista que no se entiende no bloquea: se pasa a la siguiente. Si ninguna sirve, devuelve null y el lead se queda sin ubicar, que es lo honesto.
 *
 * Reglas que evitan los errores típicos:
 *   - Un código postal manda sobre los nombres de su propio texto: en «C/ Almansa, 20, 03205 Elche» Almansa es la calle (y un municipio de Albacete), pero el 03 es Alicante.
 *   - Un nombre que vale para varios municipios se decide con lo que diga el propio texto, luego con las demás pistas del lead y, al final, por el más grande.
 *   - «Madrid» en el campo ciudad es el municipio; en el campo provincia es la provincia.
 */

import { PREFERIDOS_SI_HAY_DUDA } from './alias-municipios'
import { buscarMunicipios, type Municipio } from './municipios'
import { noDiceDonde, normalizar, trozosDeLugar } from './texto'
import { CCAA, ccaaDeProvincia, PREFIJOS_FIJOS, PROVINCIAS, type CodigoCcaa } from './zonas'

export type OrigenDeUbicacion = 'ciudad' | 'direccion' | 'provincia' | 'registro' | 'telefono' | 'web'
export type ConfianzaDeUbicacion = 'alta' | 'media' | 'baja'

export interface Ubicacion {
  ccaa: CodigoCcaa
  /** Código INE de dos dígitos, si se sabe la provincia */
  provincia: string | null
  /** Código INE de cinco dígitos, si se sabe el municipio */
  ine: string | null
  origen: OrigenDeUbicacion
  confianza: ConfianzaDeUbicacion
}

export interface PistasDeUbicacion {
  ciudad?: string | null
  provincia?: string | null
  direccion?: string | null
  registro?: string | null
  telefono?: string | null
  web?: string | null
}

/** Lo que otro campo del lead dice sobre dónde está: sirve para deshacer una duda, nunca para llevar la contraria a un nombre claro */
export interface Pista {
  provincia: string | null
  ccaa: CodigoCcaa | null
}

// --- nombres de provincia y de comunidad, normalizados ---------------------------------------------------------------------------------------------------------------

const PROVINCIA_POR_NOMBRE = new Map<string, string>()
for (const p of PROVINCIAS) {
  for (const n of [p.nombre, ...p.alias]) {
    const k = normalizar(n)
    // un nombre que valga para dos provincias no se usa (ninguno hoy; por si se añade uno)
    if (PROVINCIA_POR_NOMBRE.has(k) && PROVINCIA_POR_NOMBRE.get(k) !== p.cod) PROVINCIA_POR_NOMBRE.set(k, '')
    else PROVINCIA_POR_NOMBRE.set(k, p.cod)
  }
}
for (const [k, v] of PROVINCIA_POR_NOMBRE) if (v === '') PROVINCIA_POR_NOMBRE.delete(k)

const CCAA_POR_NOMBRE = new Map<string, CodigoCcaa>()
for (const [cod, c] of Object.entries(CCAA) as [CodigoCcaa, (typeof CCAA)[CodigoCcaa]][]) {
  for (const n of [c.nombre, c.corto, ...c.alias]) CCAA_POR_NOMBRE.set(normalizar(n), cod)
}

// --- el código postal -------------------------------------------------------------------------------------------------------------------------------------------------

/** Cinco cifras sueltas que empiezan por una provincia que existe (01 a 52). Un número de seis cifras, de un teléfono o de otro país (4 o 7 cifras) no cuenta */
const CODIGO_POSTAL = /(?<!\d)(0[1-9]|[1-4]\d|5[0-2])\d{3}(?!\d)/g

/** Un texto con país extranjero escrito al final (», RO», », CN»): su código postal no es de aquí */
const PAIS_EXTRANJERO_AL_FINAL = /,\s*(?!ES\b)[A-Z]{2}\s*$/

/** El último código postal español de un texto, o null */
export function codigoPostalDe(texto: string | null | undefined): string | null {
  if (!texto || PAIS_EXTRANJERO_AL_FINAL.test(texto.trim())) return null
  let ultimo: string | null = null
  for (const m of texto.matchAll(CODIGO_POSTAL)) ultimo = m[0]
  return ultimo
}

/** El texto sin sus códigos postales ni el «C.P.», para que «28037 Madrid» deje «Madrid» */
const sinCodigosPostales = (texto: string): string => texto.replace(/(?<!\d)\d{5}(?!\d)/g, ',').replace(/\bC\.?\s?P\.?(?=[\s:,.-])/gi, ',')

// --- buscar un lugar dentro de un texto ------------------------------------------------------------------------------------------------------------------------------

interface Hallazgo {
  ccaa: CodigoCcaa
  provincia: string | null
  ine: string | null
  /** Se supo el municipio exacto */
  municipio: boolean
}

/** La pista que dan los nombres de un texto: la primera provincia y la primera comunidad que aparezcan (una provincia dice también su comunidad) */
function pistaDeNombres(piezas: string[]): Pista {
  let provincia: string | null = null
  let ccaa: CodigoCcaa | null = null
  for (const p of piezas) {
    if (!provincia) provincia = PROVINCIA_POR_NOMBRE.get(p) ?? null
    if (!ccaa) ccaa = CCAA_POR_NOMBRE.get(p) ?? null
  }
  if (provincia && !ccaa) ccaa = ccaaDeProvincia(provincia)
  return { provincia, ccaa }
}

/** Entre varios municipios con el mismo nombre, los que cuadran con la primera pista que los reduzca (sin dejarlos a cero) */
function reducirConPistas(candidatos: Municipio[], pistas: Pista[]): Municipio[] {
  if (candidatos.length <= 1) return candidatos
  for (const pista of pistas) {
    if (pista.provincia) {
      const r = candidatos.filter((m) => m.prov === pista.provincia)
      if (r.length > 0) return r
    }
    if (pista.ccaa) {
      const r = candidatos.filter((m) => m.ccaa === pista.ccaa)
      if (r.length > 0) return r
    }
  }
  return candidatos
}

/** De los candidatos a un nombre: un municipio, lo que tengan en común (provincia, comunidad), el preferido por tamaño, o nada */
function resolverCandidatos(candidatos: Municipio[], nombre: string): Hallazgo | null {
  if (candidatos.length === 0) return null
  const primero = candidatos[0]
  if (candidatos.length === 1) return { ccaa: primero.ccaa, provincia: primero.prov, ine: primero.ine, municipio: true }
  const preferido = PREFERIDOS_SI_HAY_DUDA[nombre]
  const elegido = preferido ? candidatos.find((m) => m.prov === preferido) : undefined
  if (elegido) return { ccaa: elegido.ccaa, provincia: elegido.prov, ine: elegido.ine, municipio: true }
  if (candidatos.every((m) => m.prov === primero.prov)) return { ccaa: primero.ccaa, provincia: primero.prov, ine: null, municipio: false }
  if (candidatos.every((m) => m.ccaa === primero.ccaa)) return { ccaa: primero.ccaa, provincia: null, ine: null, municipio: false }
  return null
}

const hallazgoDeProvincia = (cod: string): Hallazgo | null => {
  const ccaa = ccaaDeProvincia(cod)
  return ccaa ? { ccaa, provincia: cod, ine: null, municipio: false } : null
}

interface Opciones {
  /** Qué se prueba antes en cada pieza: el municipio (campo ciudad, dirección) o la provincia (campo provincia) */
  primero: 'municipio' | 'provincia'
  /** El código postal del propio texto: manda sobre los nombres (el municipio ha de ser de su provincia) */
  codigoPostal?: string | null
  /** Lo que dicen los demás campos del lead: solo desempatan */
  contexto?: Pista[]
  /** Recorrer las piezas del final al principio (una dirección acaba en el municipio) */
  desdeElFinal?: boolean
}

/** Busca un lugar en un texto libre */
function lugarEnTexto(texto: string, o: Opciones): Hallazgo | null {
  const piezas = trozosDeLugar(texto, o.desdeElFinal)
  const cp = o.codigoPostal ?? null
  if (piezas.length === 0 && !cp) return null
  const nombres = pistaDeNombres(piezas)
  const provinciaDelCp = cp ? cp.slice(0, 2) : null

  const comoMunicipio = (): Hallazgo | null => {
    for (const p of piezas) {
      let candidatos = buscarMunicipios(p)
      if (candidatos.length === 0) continue
      // el propio texto veta: con código postal, de su provincia; con una provincia o comunidad escrita, de su comunidad
      if (provinciaDelCp) candidatos = candidatos.filter((m) => m.prov === provinciaDelCp)
      else if (nombres.ccaa) candidatos = candidatos.filter((m) => m.ccaa === nombres.ccaa)
      if (candidatos.length === 0) continue
      const h = resolverCandidatos(reducirConPistas(candidatos, [nombres, ...(o.contexto ?? [])]), p)
      if (h) return h
    }
    return null
  }
  const comoProvincia = (): Hallazgo | null => {
    for (const p of piezas) {
      const cod = PROVINCIA_POR_NOMBRE.get(p)
      if (cod) return hallazgoDeProvincia(cod)
    }
    return null
  }
  const comoComunidad = (): Hallazgo | null => {
    for (const p of piezas) {
      const c = CCAA_POR_NOMBRE.get(p)
      if (c) return { ccaa: c, provincia: null, ine: null, municipio: false }
    }
    return null
  }

  const orden = o.primero === 'municipio' ? [comoMunicipio, comoProvincia, comoComunidad] : [comoProvincia, comoComunidad, comoMunicipio]
  // con código postal, su provincia es lo único seguro: va antes que una provincia o comunidad escrita (que puede ser una referencia vaga)
  if (provinciaDelCp) {
    const h = comoMunicipio()
    if (h) return h
    return hallazgoDeProvincia(provinciaDelCp)
  }
  for (const paso of orden) {
    const h = paso()
    if (h) return h
  }
  return null
}

const aUbicacion = (h: Hallazgo, origen: OrigenDeUbicacion, confianza: ConfianzaDeUbicacion): Ubicacion => ({ ccaa: h.ccaa, provincia: h.provincia, ine: h.ine, origen, confianza })

// --- las seis fuentes ------------------------------------------------------------------------------------------------------------------------------------------------

export function desdeCiudad(ciudad: string | null | undefined, contexto: Pista[] = []): Ubicacion | null {
  if (!ciudad || !ciudad.trim()) return null
  const cp = codigoPostalDe(ciudad)
  const h = lugarEnTexto(cp ? sinCodigosPostales(ciudad) : ciudad, { primero: 'municipio', codigoPostal: cp, contexto })
  return h ? aUbicacion(h, 'ciudad', h.municipio ? 'alta' : 'media') : null
}

export function desdeDireccion(direccion: string | null | undefined, contexto: Pista[] = []): Ubicacion | null {
  if (!direccion || !direccion.trim()) return null
  const cp = codigoPostalDe(direccion)
  const h = lugarEnTexto(cp ? sinCodigosPostales(direccion) : direccion, { primero: 'municipio', codigoPostal: cp, contexto, desdeElFinal: true })
  if (!h) return null
  // con el código postal la provincia es segura; sin él, un nombre de lugar suelto al final de la dirección es solo un indicio
  return aUbicacion(h, 'direccion', cp ? 'alta' : 'media')
}

export function desdeProvincia(provincia: string | null | undefined, contexto: Pista[] = []): Ubicacion | null {
  if (!provincia || !provincia.trim()) return null
  const cp = codigoPostalDe(provincia)
  const h = lugarEnTexto(cp ? sinCodigosPostales(provincia) : provincia, { primero: 'provincia', codigoPostal: cp, contexto })
  return h ? aUbicacion(h, 'provincia', 'alta') : null
}

/** «Registro Mercantil de la provincia de Asturias, Tomo 3550…» -> lo que viene tras el «de», probado de más largo a más corto (1 a 4 palabras) */
const REGISTRO_DE = /\b(?:registro\s+mercantil|reg\.?\s+mercantil)\s+(?:de\s+|del\s+)?(?:la\s+)?(?:provincia\s+de\s+)?(.+)$/i

export function desdeRegistro(registro: string | null | undefined): Ubicacion | null {
  if (!registro || !registro.trim()) return null
  const m = REGISTRO_DE.exec(registro)
  const palabras = normalizar(m ? m[1] : registro).split(' ').filter(Boolean)
  for (let n = Math.min(4, palabras.length); n >= 1; n--) {
    const frase = palabras.slice(0, n).join(' ')
    if (noDiceDonde(frase)) continue
    const cod = PROVINCIA_POR_NOMBRE.get(frase)
    if (cod) {
      const h = hallazgoDeProvincia(cod)
      if (h) return aUbicacion(h, 'registro', 'media')
    }
    const c = CCAA_POR_NOMBRE.get(frase)
    if (c) return aUbicacion({ ccaa: c, provincia: null, ine: null, municipio: false }, 'registro', 'media')
    const h = resolverCandidatos(buscarMunicipios(frase), frase)
    if (h) return aUbicacion(h, 'registro', 'media')
  }
  return null
}

/** Las cifras de un teléfono español, sin el +34 ni el 0034: nueve cifras o nada */
export function cifrasDeTelefonoEspanol(telefono: string | null | undefined): string | null {
  if (!telefono) return null
  let d = telefono.replace(/\D/g, '')
  if (d.startsWith('0034')) d = d.slice(4)
  else if (d.startsWith('34') && d.length === 11) d = d.slice(2)
  return d.length === 9 ? d : null
}

export function desdeTelefono(telefono: string | null | undefined): Ubicacion | null {
  const d = cifrasDeTelefonoEspanol(telefono)
  if (!d || d[0] !== '9') return null
  const prov = PREFIJOS_FIJOS[d.slice(0, 3)] ?? PREFIJOS_FIJOS[d.slice(0, 2)]
  const h = prov ? hallazgoDeProvincia(prov) : null
  return h ? aUbicacion(h, 'telefono', 'baja') : null
}

const COMUNIDAD_POR_DOMINIO: Readonly<Record<string, CodigoCcaa>> = { cat: 'CT', gal: 'GA', eus: 'PV' }

export function desdeWeb(web: string | null | undefined): Ubicacion | null {
  if (!web) return null
  const m = /^(?:[a-z]+:\/\/)?(?:[^/?#]*@)?([^/?#:]+)/i.exec(web.trim())
  const tld = m ? m[1].toLowerCase().split('.').pop() : undefined
  const ccaa = tld ? COMUNIDAD_POR_DOMINIO[tld] : undefined
  return ccaa ? aUbicacion({ ccaa, provincia: null, ine: null, municipio: false }, 'web', 'baja') : null
}

// --- todo junto --------------------------------------------------------------------------------------------------------------------------------------------------------

const pistaDe = (u: Ubicacion | null): Pista[] => (u ? [{ provincia: u.provincia, ccaa: u.ccaa }] : [])

/** Lo que dice cada fuente, en el orden en que se prefieren (para la auditoría: enseña los casos en que dos fuentes no coinciden) */
export function ubicacionesPosibles(p: PistasDeUbicacion): Ubicacion[] {
  // lo que dicen las fuentes más seguras sirve de contexto para desempatar un nombre de ciudad ambiguo («Torrent» con un 46… es el de València)
  const cp = desdeDireccion(p.direccion)
  const prov = desdeProvincia(p.provincia)
  const reg = desdeRegistro(p.registro)
  const tel = desdeTelefono(p.telefono)
  const contexto = [...pistaDe(cp), ...pistaDe(prov), ...pistaDe(reg), ...pistaDe(tel)]
  const ciudad = desdeCiudad(p.ciudad, contexto)
  // la dirección y la provincia se vuelven a resolver con la ciudad como contexto cuando son ambiguas
  const direccion = p.direccion && !cp?.ine ? desdeDireccion(p.direccion, [...pistaDe(ciudad), ...pistaDe(prov), ...pistaDe(reg), ...pistaDe(tel)]) : cp
  return [ciudad, direccion, prov, reg, tel, desdeWeb(p.web)].filter((u): u is Ubicacion => u !== null)
}

/** La ubicación del lead, o null si nada de lo que trae dice dónde está */
export function ubicar(p: PistasDeUbicacion): Ubicacion | null {
  return ubicacionesPosibles(p)[0] ?? null
}
