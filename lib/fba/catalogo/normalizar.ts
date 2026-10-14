/**
 * LIMPIAR LO QUE VIENE DE UNA HOJA DE CÁLCULO.
 * PURA: sin pantalla ni red. Se comprueba con catalogo.prueba.ts.
 *
 * La hoja de ShoesF lleva años en uso y se nota: un punto donde iba un FNSKU, un
 * espacio delante de un ASIN, un `#REF!` donde iba una talla, el precio como
 * «74,95» entre comillas. Cada función de aquí arregla UNA clase de suciedad y
 * ninguna inventa un dato: lo que no se puede leer sale vacío, y el importador lo
 * cuenta como falta en lugar de adivinarlo.
 *
 *
 * ============ LO QUE NO SE TOCA, A PROPÓSITO ============
 *
 * El FBASKU se respeta TAL CUAL, guiones finales incluidos. En la hoja hay series
 * enteras que acaban en «-» o «--» (FBA366246-39--, FBA629708-40-) y esa
 * irregularidad —dos guiones en unas tallas y uno en otras— no se parece a un
 * descuido de limpieza sino a SKUs que existen así en Amazon. «Arreglarlos» haría
 * que el manifiesto citase un SKU que no existe.
 */

/** Lo que una hoja de cálculo escribe cuando no hay dato */
const MARCAS_DE_VACIO = new Set(['.', '-', '--', '—', '–', 'n/a', 'na', 'n.a.', 's/n', 'null', 'undefined'])

/** Los errores de fórmula de Excel y de Google Sheets: #REF!, #N/A, #¡VALOR!… */
const ERROR_DE_HOJA = /^#(n\/a|ref!?|value!?|name\??|div\/0!?|null!?|num!?|error!?|¡valor!?|¿nombre\?|¡ref!?)$/i

function base(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
    .replace(/[ ​﻿]/g, ' ')
    .trim()
}

function esMarcaDeVacio(s: string): boolean {
  return s === '' || MARCAS_DE_VACIO.has(s.toLowerCase()) || ERROR_DE_HOJA.test(s)
}

/** Un texto libre: sin espacios de más y vacío si no dice nada */
export function limpiarTexto(v: unknown): string {
  const s = base(v).replace(/\s+/g, ' ')
  return esMarcaDeVacio(s) ? '' : s
}

/**
 * El FBASKU: solo se recortan los espacios. Distingue mayúsculas, no se acorta y no
 * se le quita ningún guion (ver arriba).
 */
export function limpiarSku(v: unknown): string {
  const s = base(v).replace(/\s+/g, '')
  return esMarcaDeVacio(s) ? '' : s
}

/** FNSKU y ASIN: en mayúsculas y sin espacios. «B072M2Q2RL » → «B072M2Q2RL» */
export function limpiarCodigoAmazon(v: unknown): string {
  const s = base(v).replace(/\s+/g, '').toUpperCase()
  return esMarcaDeVacio(s) ? '' : s
}

/**
 * El EAN: solo cifras. Si tiene espacios o guiones se quitan; si aun así no son
 * cifras —«8,43522E+12», que es lo que deja una hoja que lo convirtió en número— se
 * devuelve tal cual para que el aviso lo señale: recomponerlo sería inventarlo.
 */
export function limpiarEan(v: unknown): string {
  const s = base(v)
  if (esMarcaDeVacio(s)) return ''
  const sinSeparadores = s.replace(/[\s-]/g, '')
  return /^\d+$/.test(sinSeparadores) ? sinSeparadores : s
}

/** La talla: «39.0» pasa a «39». Lo que no es número («UNICA», «37/38») se queda */
export function limpiarTalla(v: unknown): string {
  const s = limpiarTexto(v)
  if (/^\d+[.,]0+$/.test(s)) return s.replace(/[.,]0+$/, '')
  return s
}

/**
 * El precio, en euros. Entiende «74,95», «74.95», «1.234,56», «1,234.56» y «99 €».
 * Lo que no es un número («REVISAR PRECIO») sale null.
 *
 * Con un solo separador se decide por lo que viene detrás: hasta dos cifras es
 * decimal y tres es de miles («1.234» son mil doscientos treinta y cuatro).
 */
export function limpiarPrecio(v: unknown): number | null {
  let s = base(v).replace(/[€$£\s]/g, '').replace(/eur(os)?/i, '')
  if (s === '' || !/^[\d.,]+$/.test(s)) return null

  const ultimaComa = s.lastIndexOf(',')
  const ultimoPunto = s.lastIndexOf('.')
  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    // Los dos: el que aparece último es el decimal
    const decimal = ultimaComa > ultimoPunto ? ',' : '.'
    const miles = decimal === ',' ? '.' : ','
    s = s.split(miles).join('').replace(decimal, '.')
  } else if (ultimaComa >= 0 || ultimoPunto >= 0) {
    const sep = ultimaComa >= 0 ? ',' : '.'
    const partes = s.split(sep)
    const ultimaParte = partes[partes.length - 1]
    if (partes.length > 2 || ultimaParte.length === 3) {
      s = partes.join('') // de miles
    } else {
      s = partes.join('.') // decimal
    }
  }

  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
}

/**
 * «Si» / «No» de la columna CONTINUIDAD. null = no dice nada, y el importador no
 * cambia lo que ya hubiera.
 */
export function limpiarContinuidad(v: unknown): boolean | null {
  const s = base(v)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  if (['si', 's', 'yes', 'true', '1', 'x', 'verdadero'].includes(s)) return true
  if (['no', 'n', 'false', '0', 'falso'].includes(s)) return false
  return null
}

/* ------------------------------------------------------------------ */
/* Orden                                                               */
/* ------------------------------------------------------------------ */

/** REF y colores: «F0047» antes que «F0354», y «9578» antes que «13451ST» */
export function compararNatural(a: string, b: string): number {
  return a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' })
}

const TALLAS_DE_LETRA = ['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl', '3xl', '4xl']

function numeroDeTalla(t: string): number | null {
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) && /^\d/.test(t) ? n : null
}

/**
 * Las tallas en el orden en que se leen: 35 · 36 · 36,5 · 37 … y S · M · L · XL.
 * Las numéricas van primero, después las de letra, y lo que no se reconoce al final.
 */
export function compararTalla(a: string, b: string): number {
  const na = numeroDeTalla(a)
  const nb = numeroDeTalla(b)
  if (na !== null && nb !== null) return na - nb || compararNatural(a, b)
  if (na !== null) return -1
  if (nb !== null) return 1
  const la = TALLAS_DE_LETRA.indexOf(a.toLowerCase())
  const lb = TALLAS_DE_LETRA.indexOf(b.toLowerCase())
  if (la >= 0 && lb >= 0) return la - lb
  if (la >= 0) return -1
  if (lb >= 0) return 1
  return compararNatural(a, b)
}

/**
 * «36-41» → 36, 37, 38, 39, 40, 41 y «39, 40, 42» → 39, 40, 42. Para teclear de
 * golpe las tallas de un modelo nuevo. Un rango solo es válido con enteros y de
 * hasta 40 tallas; lo demás se devuelve vacío y la pantalla lo avisa.
 */
export function expandirTallas(texto: string): string[] {
  const salida: string[] = []
  // «36 - 41» y «36 a 41» se juntan en «36-41» antes de partir por espacios
  const unido = texto.replace(/(\d)\s*[-–]\s*(\d)/g, '$1-$2').replace(/(\d)\s+(?:a|hasta)\s+(\d)/gi, '$1-$2')
  for (const trozo of unido.split(/[\s,;]+/).filter(Boolean)) {
    const rango = /^(\d{1,3})-(\d{1,3})$/.exec(trozo)
    if (rango) {
      const desde = Number(rango[1])
      const hasta = Number(rango[2])
      if (hasta < desde || hasta - desde > 40) return []
      for (let t = desde; t <= hasta; t++) salida.push(String(t))
    } else {
      const t = limpiarTalla(trozo)
      if (t) salida.push(t)
    }
  }
  return Array.from(new Set(salida)).sort(compararTalla)
}

/* ------------------------------------------------------------------ */
/* FBASKU                                                              */
/* ------------------------------------------------------------------ */

/**
 * La propuesta de FBASKU para una talla nueva: «FBA» + código de artículo + «-» + talla.
 * Es la convención con la que están dados de alta cuatro de cada cinco SKUs de la hoja
 * (FBA047768-40). El código de artículo a veces ya lleva la talla puesta (912683-44);
 * entonces no se repite.
 *
 * Es solo una PROPUESTA: aparece rellena y se puede cambiar. El SKU de verdad es el
 * que está en Seller Central, y esa convención no es una regla (hay series enteras con
 * guiones de más).
 */
export function sugerirFbasku(codArt: string, talla: string): string {
  const c = limpiarSku(codArt)
  const t = limpiarTalla(talla)
  if (!c || !t) return ''
  const escapada = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return `FBA${c.replace(new RegExp(`-${escapada}$`), '')}-${t}`
}
