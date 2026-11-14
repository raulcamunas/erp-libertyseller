import type { IdAccion } from './acciones'
import type { Incidencia } from './tipos'

/**
 * CUMPLIMIENTO · CORREGIR UNA INCIDENCIA DESDE EL ERP. LA PARTE PURA.
 * Sin red ni base de datos: lo importan igual el servidor (correccion-servidor.ts) que la pantalla (PanelCorregir.tsx).
 * Se prueba en correccion.prueba.ts.
 *
 *   1. QUIÉN LO ARREGLA. Cada tarea de «Hoy» se arregla de una de tres formas: desde el ERP (rellenando un dato de la ficha),
 *      solo en Seller Central (subir una imagen, apelar, reactivar…) o hace falta algo del cliente (un registro, una
 *      aprobación, un documento). Es lo que decide el botón principal de la tarjeta.
 *   2. EL FORMULARIO. Amazon publica, por tipo de producto, un JSON Schema de cada atributo (Product Type Definitions API).
 *      De ese esquema se saca un formulario SOLO con los atributos que nombra la incidencia: textos, números, desplegables
 *      con los valores que admite Amazon, sí/no y unidades.
 *   3. LOS PATCHES. Lo escrito en el formulario se convierte en operaciones `replace` de patchListingsItem, solo de los
 *      atributos que de verdad cambian, y se guarda lo que había antes para poder deshacerlo a mano.
 *   4. LO QUE CONTESTA AMAZON. Sus issues, de forma legible y colgados del atributo al que se refieren.
 */

/* ------------------------------------------------------------------ */
/* 1. Quién lo arregla                                                 */
/* ------------------------------------------------------------------ */

export type Resolucion = 'erp' | 'seller-central' | 'cliente'

export const ROTULO_RESOLUCION: Record<Resolucion, { corto: string; largo: string }> = {
  erp: { corto: 'Corregible desde el ERP', largo: 'Se arregla rellenando un dato de la ficha: se valida con Amazon y se envía desde aquí' },
  'seller-central': { corto: 'Solo en Seller Central', largo: 'Hay que hacerlo en Seller Central (subir imágenes, reactivar, apelar…): la API no lo permite' },
  cliente: { corto: 'Necesita al cliente', largo: 'Hace falta algo del cliente: un registro, una aprobación, documentos o un permiso' },
}

/**
 * Cómo se resuelve cada tarea. Lo que es «erp» se corrige con atributos de la ficha; lo de «cliente» necesita algo que
 * no tenemos (registros RAP, aprobaciones de marca, certificados); lo de «seller-central» se hace allí y luego se pulsa
 * «Revisar de nuevo».
 */
export const RESOLUCION: Record<IdAccion, Resolucion> = {
  'aprobacion-marca': 'cliente',
  restringido: 'cliente',
  transparency: 'cliente',
  precio: 'seller-central',
  rap: 'cliente',
  'gpsr-responsable': 'erp',
  'gpsr-seguridad': 'erp',
  'documento-cumplimiento': 'cliente',
  'etiqueta-energetica': 'cliente',
  'ley-de-datos': 'cliente',
  'equipos-radio': 'erp',
  'info-alimentaria': 'erp',
  'seguridad-retirada': 'cliente',
  'propiedad-intelectual': 'cliente',
  'dato-ficha': 'erp',
  'imagen-principal': 'seller-central',
  'imagenes-no-se-ven': 'seller-central',
  'texto-retirado': 'erp',
  variantes: 'erp',
  'codigo-de-barras': 'cliente',
  'oferta-en-pausa': 'seller-central',
  peligrosas: 'erp',
  marca: 'cliente',
  'oculto-otros': 'seller-central',
  'normativa-otros': 'cliente',
  'menor-recomendacion': 'erp',
  'menor-envio-rechazado': 'erp',
  'menor-error-de-amazon': 'seller-central',
  'menor-imagen-no-descargada': 'seller-central',
}

/** Categorías de Amazon que dicen «falta o no vale un atributo»: con ellas cualquier incidencia se puede intentar corregir aquí */
const CATEGORIAS_DE_ATRIBUTO = new Set(['MISSING_ATTRIBUTE', 'INVALID_ATTRIBUTE', 'CONFLICTING_ATTRIBUTE', 'INVALID_ATTRIBUTE_VALUE'])

/** Atributos que no se tocan desde aquí aunque los nombre una incidencia: el precio y el stock tienen sus módulos, las imágenes se suben en Seller Central */
const ATRIBUTOS_FUERA = new Set(['purchasable_offer', 'fulfillment_availability', 'list_price'])
const esImagen = (a: string) => /_image_locator$|^main_product_image|^other_product_image|^swatch_product_image/.test(a)

/** Los atributos de la incidencia que se pueden editar desde el formulario */
export function atributosEditables(atributos: readonly string[]): string[] {
  return [...new Set(atributos)].filter((a) => a && !ATRIBUTOS_FUERA.has(a) && !esImagen(a))
}

/**
 * ¿Se puede corregir ESTA incidencia desde el ERP? Hace falta que Amazon diga qué atributos son (sin eso no hay
 * formulario) y que la tarea se arregle con datos de la ficha, o que Amazon la catalogue como un atributo que falta o no vale.
 */
export function corregibleDesdeErp(i: Pick<Incidencia, 'atributos' | 'categorias'>, accion: IdAccion): boolean {
  if (atributosEditables(i.atributos).length === 0) return false
  if (RESOLUCION[accion] === 'erp') return true
  return RESOLUCION[accion] === 'seller-central' && accion === 'oculto-otros' && i.categorias.some((c) => CATEGORIAS_DE_ATRIBUTO.has(c))
}

/* ------------------------------------------------------------------ */
/* 2. Del esquema de Amazon a un formulario                            */
/* ------------------------------------------------------------------ */

export type TipoDeCampo = 'texto' | 'textoLargo' | 'numero' | 'entero' | 'booleano' | 'opcion'

export interface OpcionDeCampo {
  valor: string
  texto: string
}

export interface CampoDeAtributo {
  /** La ruta dentro de un elemento del atributo, con puntos: 'value', 'unit', 'length.value', 'contact_information.0.email' */
  clave: string
  titulo: string
  descripcion?: string
  tipo: TipoDeCampo
  /** Valores que admite Amazon (siempre como texto en el formulario) */
  opciones?: OpcionDeCampo[]
  /** Con opciones, ¿se admite además un texto libre? (anyOf de Amazon) */
  libre?: boolean
  obligatorio: boolean
  maxLength?: number
  minimo?: number
  maximo?: number
  ejemplo?: string
  /** Tipo JSON real del valor, para volver a convertir el texto del formulario */
  json: 'string' | 'number' | 'integer' | 'boolean'
}

export interface DefinicionDeAtributo {
  nombre: string
  titulo: string
  descripcion?: string
  campos: CampoDeAtributo[]
  /** Cuántos elementos admite (las viñetas, 5; casi todo lo demás, 1) */
  maxElementos: number
  obligatorio: boolean
  /** ¿Cada elemento lleva marketplace_id / language_tag? Se rellenan solos */
  conMercado: boolean
  conIdioma: boolean
  /** false = el esquema es demasiado raro para un formulario: se dice y se manda a Seller Central */
  soportado: boolean
  motivo?: string
}

type Esquema = Record<string, unknown>
const esObjeto = (v: unknown): v is Esquema => typeof v === 'object' && v !== null && !Array.isArray(v)
const texto = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const numero = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** Resuelve un `$ref` local («#/$defs/marketplace_id») contra las definiciones del esquema raíz */
function resolver(s: unknown, defs: Esquema, profundidad = 0): Esquema {
  if (!esObjeto(s)) return {}
  const ref = texto(s.$ref)
  if (!ref || profundidad > 5) return s
  const m = /^#\/(?:\$defs|definitions)\/(.+)$/.exec(ref)
  const destino = m ? defs[m[1]] : undefined
  const { $ref: _ref, ...resto } = s
  return { ...resolver(destino, defs, profundidad + 1), ...resto }
}

/** Las opciones de un esquema: enum/enumNames, o las de cada rama de un anyOf/oneOf. `libre` si alguna rama admite cualquier texto */
function opcionesDe(s: Esquema, defs: Esquema): { opciones: OpcionDeCampo[]; libre: boolean } | null {
  const ramas = [s, ...((Array.isArray(s.anyOf) ? s.anyOf : Array.isArray(s.oneOf) ? s.oneOf : []) as unknown[]).map((r) => resolver(r, defs))]
  const opciones: OpcionDeCampo[] = []
  let libre = false
  let hayEnum = false
  for (const r of ramas) {
    if (Array.isArray(r.enum)) {
      hayEnum = true
      const nombres = Array.isArray(r.enumNames) ? r.enumNames : []
      r.enum.forEach((v, i) => {
        const valor = String(v)
        if (!opciones.some((o) => o.valor === valor)) opciones.push({ valor, texto: texto(nombres[i]) ?? valor })
      })
    } else if (r !== s && (r.type === 'string' || r.type === 'number' || r.type === 'integer')) {
      libre = true
    }
  }
  return hayEnum ? { opciones, libre } : null
}

function tipoJson(s: Esquema, defs: Esquema): CampoDeAtributo['json'] | null {
  const t = s.type ?? (Array.isArray(s.anyOf) ? resolver(s.anyOf[0], defs).type : undefined)
  return t === 'string' || t === 'number' || t === 'integer' || t === 'boolean' ? t : null
}

const OCULTOS = new Set(['marketplace_id', 'language_tag'])
const MAX_CAMPOS = 24

/**
 * Los campos «hoja» de un elemento del atributo, recorriendo objetos y arrays de objetos (del array, el primer elemento).
 * Se saltan marketplace_id y language_tag (los pone el ERP), lo oculto y lo que Amazon marca como no editable.
 */
function hojas(props: Esquema, requeridos: readonly string[], defs: Esquema, prefijo: string, salida: CampoDeAtributo[], profundidad: number): boolean {
  for (const [clave, crudo] of Object.entries(props)) {
    if (salida.length >= MAX_CAMPOS) return false
    if (!prefijo && OCULTOS.has(clave)) continue
    const s = resolver(crudo, defs)
    if (s.hidden === true || s.editable === false) continue
    const ruta = prefijo ? `${prefijo}.${clave}` : clave
    const obligatorio = requeridos.includes(clave)
    if (s.type === 'object' && esObjeto(s.properties)) {
      if (profundidad >= 3) return false
      if (!hojas(s.properties, (s.required as string[]) ?? [], defs, ruta, salida, profundidad + 1)) return false
      continue
    }
    if (s.type === 'array') {
      const item = resolver(s.items, defs)
      if (item.type === 'object' && esObjeto(item.properties)) {
        if (profundidad >= 3) return false
        if (!hojas(item.properties, (item.required as string[]) ?? [], defs, `${ruta}.0`, salida, profundidad + 1)) return false
        continue
      }
      // Una lista de valores sueltos (el «mapa de color» de Amazon): si no es obligatoria, se deja como está y no se enseña
      if (obligatorio) return false
      continue
    }
    const json = tipoJson(s, defs)
    if (!json) return false
    const ops = json === 'boolean' ? null : opcionesDe(s, defs)
    const titulo = texto(s.title) ?? clave
    const campo: CampoDeAtributo = {
      clave: ruta,
      titulo,
      descripcion: texto(s.description),
      tipo: json === 'boolean' ? 'booleano' : ops ? 'opcion' : json === 'integer' ? 'entero' : json === 'number' ? 'numero' : (numero(s.maxLength) ?? 0) > 300 ? 'textoLargo' : 'texto',
      obligatorio,
      json,
    }
    if (ops) {
      campo.opciones = ops.opciones
      if (ops.libre) campo.libre = true
    }
    if (json === 'boolean') {
      const nombres = Array.isArray(s.enumNames) && Array.isArray(s.enum) ? s.enum.map((v, i) => ({ valor: String(v), texto: texto((s.enumNames as unknown[])[i]) ?? (v ? 'Sí' : 'No') })) : null
      campo.opciones = nombres ?? [
        { valor: 'true', texto: 'Sí' },
        { valor: 'false', texto: 'No' },
      ]
    }
    const maxLength = numero(s.maxLength) ?? numero(s.maxUtf8ByteLength)
    if (maxLength != null) campo.maxLength = maxLength
    const minimo = numero(s.minimum) ?? numero(s.exclusiveMinimum)
    const maximo = numero(s.maximum) ?? numero(s.exclusiveMaximum)
    if (minimo != null) campo.minimo = minimo
    if (maximo != null) campo.maximo = maximo
    const ej = Array.isArray(s.examples) ? s.examples.find((e) => typeof e === 'string' || typeof e === 'number') : undefined
    if (ej != null) campo.ejemplo = String(ej)
    salida.push(campo)
  }
  return true
}

/**
 * La definición de un atributo a partir del JSON Schema que publica Amazon para el tipo de producto.
 * `esquema` es `schema.properties[nombre]` y `defs` el `$defs` de la raíz. Si no se entiende, `soportado: false` con el motivo.
 */
export function definicionDeAtributo(nombre: string, esquema: unknown, defs: Esquema = {}, requeridosRaiz: readonly string[] = []): DefinicionDeAtributo {
  const s = resolver(esquema, defs)
  const base: DefinicionDeAtributo = {
    nombre,
    titulo: texto(s.title) ?? nombre,
    descripcion: texto(s.description),
    campos: [],
    maxElementos: 1,
    obligatorio: requeridosRaiz.includes(nombre),
    conMercado: false,
    conIdioma: false,
    soportado: false,
  }
  if (!esObjeto(esquema)) return { ...base, motivo: 'Amazon no tiene este atributo en el tipo de producto del listing.' }
  if (s.type !== 'array') return { ...base, motivo: 'El atributo no tiene la forma habitual de Amazon (una lista de valores).' }
  const item = resolver(s.items, defs)
  if (item.type !== 'object' || !esObjeto(item.properties)) return { ...base, motivo: 'El atributo no tiene la forma habitual de Amazon.' }
  const campos: CampoDeAtributo[] = []
  const bien = hojas(item.properties, (item.required as string[]) ?? [], defs, '', campos, 0)
  const max = numero(s.maxUniqueItems) ?? numero(s.maxItems) ?? 1
  const definicion: DefinicionDeAtributo = {
    ...base,
    campos,
    maxElementos: Math.max(1, Math.min(10, max)),
    conMercado: 'marketplace_id' in item.properties,
    conIdioma: 'language_tag' in item.properties,
    soportado: bien && campos.length > 0,
  }
  if (!definicion.soportado) definicion.motivo = campos.length === 0 && bien ? 'Este atributo no tiene nada editable.' : 'Este atributo es demasiado complejo para editarlo aquí: hazlo en Seller Central.'
  return definicion
}

/* ------------------------------------------------------------------ */
/* 3. Valores: de Amazon al formulario y vuelta                        */
/* ------------------------------------------------------------------ */

/** Una fila del formulario: el texto de cada campo, por su clave */
export type FilaDeFormulario = Record<string, string>
/** El formulario entero: por atributo, sus elementos */
export type Formulario = Record<string, FilaDeFormulario[]>

/** Los elementos de un atributo que valen para ESTE país (los que no dicen país valen para todos) */
export function elementosDelPais(atributos: Record<string, unknown> | null | undefined, nombre: string, marketplaceId: string): Esquema[] {
  const lista = atributos?.[nombre]
  if (!Array.isArray(lista)) return []
  return lista.filter((e): e is Esquema => esObjeto(e) && (e.marketplace_id == null || e.marketplace_id === marketplaceId))
}

function leerRuta(o: unknown, clave: string): unknown {
  let actual: unknown = o
  for (const parte of clave.split('.')) {
    if (Array.isArray(actual)) actual = actual[Number(parte)]
    else if (esObjeto(actual)) actual = actual[parte]
    else return undefined
  }
  return actual
}

function escribirRuta(o: Esquema, clave: string, valor: unknown): void {
  const partes = clave.split('.')
  let actual: Esquema | unknown[] = o
  partes.forEach((parte, i) => {
    const ultima = i === partes.length - 1
    const siguienteEsIndice = !ultima && /^\d+$/.test(partes[i + 1])
    if (Array.isArray(actual)) {
      const n = Number(parte)
      if (ultima) actual[n] = valor
      else {
        if (actual[n] == null) actual[n] = siguienteEsIndice ? [] : {}
        actual = actual[n] as Esquema | unknown[]
      }
    } else {
      if (ultima) actual[parte] = valor
      else {
        if (actual[parte] == null || typeof actual[parte] !== 'object') actual[parte] = siguienteEsIndice ? [] : {}
        actual = actual[parte] as Esquema | unknown[]
      }
    }
  })
}

/** Los elementos actuales de Amazon, como filas del formulario (siempre al menos una, vacía si no hay nada) */
export function aFormulario(def: DefinicionDeAtributo, elementos: readonly unknown[]): FilaDeFormulario[] {
  const filas = elementos.slice(0, def.maxElementos).map((e) => {
    const fila: FilaDeFormulario = {}
    for (const c of def.campos) {
      const v = leerRuta(e, c.clave)
      fila[c.clave] = v == null ? '' : String(v)
    }
    return fila
  })
  return filas.length > 0 ? filas : [Object.fromEntries(def.campos.map((c) => [c.clave, '']))]
}

/** Errores de una fila, por clave. Vacío = bien */
export function erroresDeFila(def: DefinicionDeAtributo, fila: FilaDeFormulario): Record<string, string> {
  const errores: Record<string, string> = {}
  const vacia = def.campos.every((c) => !(fila[c.clave] ?? '').trim())
  if (vacia) return errores
  for (const c of def.campos) {
    const v = (fila[c.clave] ?? '').trim()
    if (!v) {
      if (c.obligatorio && !c.clave.includes('.')) errores[c.clave] = 'Obligatorio'
      continue
    }
    if (c.json === 'number' || c.json === 'integer') {
      const n = Number(v.replace(',', '.'))
      if (!Number.isFinite(n)) errores[c.clave] = 'Tiene que ser un número'
      else if (c.json === 'integer' && !Number.isInteger(n)) errores[c.clave] = 'Tiene que ser un número entero'
      else if (c.minimo != null && n < c.minimo) errores[c.clave] = `Mínimo ${c.minimo}`
      else if (c.maximo != null && n > c.maximo) errores[c.clave] = `Máximo ${c.maximo}`
    } else if (c.json === 'boolean') {
      if (v !== 'true' && v !== 'false') errores[c.clave] = 'Elige sí o no'
    } else if (c.opciones && !c.libre && !c.opciones.some((o) => o.valor === v)) {
      errores[c.clave] = 'Elige uno de los valores de Amazon'
    } else if (c.maxLength != null && v.length > c.maxLength) {
      errores[c.clave] = `Como mucho ${c.maxLength} caracteres (lleva ${v.length})`
    }
  }
  return errores
}

/** Una fila del formulario, convertida a un elemento de Amazon (con su país e idioma). null si la fila está vacía */
export function deFila(def: DefinicionDeAtributo, fila: FilaDeFormulario, marketplaceId: string, languageTag: string): Esquema | null {
  const elemento: Esquema = {}
  let algo = false
  for (const c of def.campos) {
    const v = (fila[c.clave] ?? '').trim()
    if (!v) continue
    algo = true
    const valor = c.json === 'boolean' ? v === 'true' : c.json === 'number' || c.json === 'integer' ? Number(v.replace(',', '.')) : v
    escribirRuta(elemento, c.clave, valor)
  }
  if (!algo) return null
  if (def.conIdioma) elemento.language_tag = languageTag
  if (def.conMercado) elemento.marketplace_id = marketplaceId
  return elemento
}

/** El idioma de la ficha: el que ya trae el atributo, o el del país */
export const IDIOMA_DE_MERCADO: Record<string, string> = {
  A1RKKUPIHCS9HS: 'es_ES',
  A1PA6795UKMFR9: 'de_DE',
  A13V1IB3VIYZZH: 'fr_FR',
  APJ6JRA9NG5V4: 'it_IT',
  A1F83G8C2ARO7P: 'en_GB',
  ATVPDKIKX0DER: 'en_US',
  A2EUQ1WTGCTBG2: 'en_CA',
  A1AM78C64UM0Y8: 'es_MX',
  A1805IZSGTT6HS: 'nl_NL',
  A2NODRKZP88ZB9: 'sv_SE',
  A1C3SOZRARQ6R3: 'pl_PL',
  AMEN7PMS3EDWL: 'fr_BE',
  A33AVAJ2PDY3EV: 'tr_TR',
  A2Q3Y263D00KWC: 'pt_BR',
}

export function idiomaDe(atributos: Record<string, unknown> | null | undefined, marketplaceId: string): string {
  const nombre = elementosDelPais(atributos, 'item_name', marketplaceId)[0]?.language_tag
  return typeof nombre === 'string' && nombre ? nombre : IDIOMA_DE_MERCADO[marketplaceId] ?? 'es_ES'
}

export interface OperacionDePatch {
  op: 'replace'
  path: string
  value: unknown[]
}

/** Comparación estable (las claves en orden), para saber si algo ha cambiado y para la huella */
export function estable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(estable).join(',')}]`
  if (esObjeto(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${estable(v[k])}`).join(',')}}`
  return JSON.stringify(v ?? null)
}

/**
 * Los patches de una corrección: un `replace` por cada atributo que CAMBIA (lo que no cambia no se manda), con lo que
 * había antes de cada uno. `replace` es de valor absoluto (repetirlo deja lo mismo) y Amazon lo admite en VALIDATION_PREVIEW.
 * Un atributo que se deja vacío no se borra: borrar un dato obligatorio nunca arregla una incidencia y lo haría peor.
 */
export function patchesDeCorreccion(
  definiciones: readonly DefinicionDeAtributo[],
  formulario: Formulario,
  atributosActuales: Record<string, unknown> | null | undefined,
  marketplaceId: string,
  languageTag: string
): { patches: OperacionDePatch[]; anteriores: Record<string, unknown[]>; errores: string[] } {
  const patches: OperacionDePatch[] = []
  const anteriores: Record<string, unknown[]> = {}
  const errores: string[] = []
  for (const def of definiciones) {
    if (!def.soportado) continue
    const filas = formulario[def.nombre] ?? []
    filas.forEach((f, i) => {
      for (const [, e] of Object.entries(erroresDeFila(def, f))) errores.push(`${def.titulo}${filas.length > 1 ? ` (${i + 1})` : ''}: ${e.toLowerCase()}`)
    })
    const nuevos = filas.map((f) => deFila(def, f, marketplaceId, languageTag)).filter((e): e is Esquema => e !== null)
    if (nuevos.length === 0) continue
    const actuales = elementosDelPais(atributosActuales, def.nombre, marketplaceId)
    // Lo actual, pasado por el mismo molde del formulario: así un campo que el formulario no enseña no cuenta como cambio
    const actualesNormalizados = aFormulario(def, actuales)
      .map((f) => deFila(def, f, marketplaceId, languageTag))
      .filter((e): e is Esquema => e !== null)
    if (estable(nuevos) === estable(actualesNormalizados)) continue
    // Se conserva lo que el formulario no enseña de cada elemento (otros campos que Amazon ya tenía)
    const value = nuevos.map((n, i) => (actuales[i] ? mezclar(actuales[i], n) : n))
    patches.push({ op: 'replace', path: `/attributes/${def.nombre}`, value })
    anteriores[def.nombre] = actuales
  }
  return { patches, anteriores, errores }
}

/** El elemento actual con lo nuevo encima (lo nuevo gana; los objetos se mezclan, el resto se sustituye) */
function mezclar(base: Esquema, encima: Esquema): Esquema {
  const salida: Esquema = { ...base }
  for (const [k, v] of Object.entries(encima)) {
    const b = base[k]
    if (esObjeto(v) && esObjeto(b)) salida[k] = mezclar(b, v)
    // Un array de objetos (el contacto del fabricante…) se mezcla elemento a elemento
    else if (Array.isArray(v) && Array.isArray(b)) salida[k] = v.map((x, i) => (esObjeto(x) && esObjeto(b[i]) ? mezclar(b[i] as Esquema, x) : x))
    else salida[k] = v
  }
  return salida
}

/** La huella de unos patches (FNV-1a de 32 bits sobre su forma estable): une un «Enviar» con su «Validar» */
export function huellaDe(patches: readonly OperacionDePatch[], sku: string, marketplaceId: string): string {
  const s = `${marketplaceId}|${sku}|${estable(patches)}`
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/* ------------------------------------------------------------------ */
/* 4. Lo que contesta Amazon, legible                                  */
/* ------------------------------------------------------------------ */

export interface IssueDeAmazon {
  code?: string
  message?: string
  severity?: string
  attributeNames?: string[]
  categories?: string[]
}

export interface IssueLegible {
  gravedad: 'error' | 'aviso' | 'info'
  codigo: string | null
  mensaje: string
  /** Los atributos a los que se refiere, con el título del formulario si se conoce */
  atributos: Array<{ nombre: string; titulo: string }>
}

const MENSAJE_DE_CATEGORIA: Record<string, string> = {
  MISSING_ATTRIBUTE: 'Falta un dato obligatorio.',
  INVALID_ATTRIBUTE: 'Un dato no tiene un valor válido.',
  INVALID_ATTRIBUTE_VALUE: 'Un dato no tiene un valor válido.',
  CONFLICTING_ATTRIBUTE: 'Un dato choca con lo que Amazon ya tiene en el catálogo.',
  QUALIFICATION_REQUIRED: 'Hace falta una aprobación de Amazon.',
}

/** Los issues de Amazon, ordenados (errores primero), sin repetidos y con el nombre de cada atributo como sale en el formulario */
export function issuesLegibles(issues: readonly IssueDeAmazon[] | null | undefined, definiciones: readonly Pick<DefinicionDeAtributo, 'nombre' | 'titulo'>[] = []): IssueLegible[] {
  const titulos = new Map(definiciones.map((d) => [d.nombre, d.titulo]))
  const vistos = new Set<string>()
  const salida: IssueLegible[] = []
  for (const i of issues ?? []) {
    const sev = (i.severity ?? 'ERROR').toUpperCase()
    const gravedad: IssueLegible['gravedad'] = sev === 'ERROR' ? 'error' : sev === 'WARNING' ? 'aviso' : 'info'
    const mensaje = texto(i.message) ?? (i.categories ?? []).map((c) => MENSAJE_DE_CATEGORIA[c]).find(Boolean) ?? `Amazon ha devuelto el problema ${i.code ?? 'sin código'}.`
    const clave = `${gravedad}|${i.code ?? ''}|${mensaje}`
    if (vistos.has(clave)) continue
    vistos.add(clave)
    salida.push({
      gravedad,
      codigo: i.code ?? null,
      mensaje,
      atributos: [...new Set(i.attributeNames ?? [])].map((n) => ({ nombre: n, titulo: titulos.get(n) ?? n })),
    })
  }
  const peso = { error: 0, aviso: 1, info: 2 }
  return salida.sort((a, b) => peso[a.gravedad] - peso[b.gravedad])
}

/** ¿Algún issue impide aplicar el cambio? (como hasBlockingIssues de lib/amazon/errors, sin importarlo en la pantalla) */
export function hayErrores(issues: readonly IssueDeAmazon[] | null | undefined, estado?: string | null): boolean {
  return estado === 'INVALID' || (issues ?? []).some((i) => (i.severity ?? 'ERROR').toUpperCase() === 'ERROR')
}

/* ------------------------------------------------------------------ */
/* El registro (cumplimiento_correcciones), como lo ve la pantalla      */
/* ------------------------------------------------------------------ */

export type EstadoCorreccion = 'valido' | 'aceptado' | 'invalido' | 'error'

export interface CorreccionRegistrada {
  id: string
  sku: string
  marketplaceId: string
  codigoIncidencia: string | null
  productType: string
  modo: 'validar' | 'enviar'
  estado: EstadoCorreccion
  atributos: string[]
  submissionId: string | null
  mensaje: string | null
  nIssues: number
  creadoPor: string | null
  creadoAt: string
}

export const ROTULO_CORRECCION: Record<'validar' | 'enviar', Record<EstadoCorreccion, string>> = {
  validar: { valido: 'Validado: Amazon lo acepta', aceptado: 'Validado', invalido: 'Validado: Amazon no lo acepta', error: 'No se pudo validar' },
  enviar: { valido: 'Enviado', aceptado: 'Enviado a Amazon y aceptado', invalido: 'Enviado: Amazon lo rechazó', error: 'No se pudo enviar' },
}

/** Los atributos que toca una lista de patches («/attributes/item_name» → «item_name») */
export function atributosDePatches(patches: unknown): string[] {
  if (!Array.isArray(patches)) return []
  return patches.map((p) => (esObjeto(p) && typeof p.path === 'string' ? p.path.replace(/^\/attributes\//, '') : '')).filter(Boolean)
}

/** Cuánto vale una validación para poder enviar: la misma huella, del mismo usuario, en este rato */
export const VALIDEZ_DE_VALIDACION_MS = 30 * 60 * 1000
