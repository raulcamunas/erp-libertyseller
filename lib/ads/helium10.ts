/**
 * LOS CSV DE HELIUM 10 (Cerebro / Magnet y ASIN Grabber) — PURO. Se leen en el navegador y viajan ya como filas.
 *
 * Los nombres de columna cambian con el idioma y la versión de la exportación, así que se buscan por parecido («Keyword Phrase», «Frase de
 * palabra clave», «Search Volume», «Volumen de búsqueda»…) y no por posición. Lo que no se reconoce no se inventa: se dice qué falta.
 */

export interface FilaCerebro {
  keyword: string
  volumen: number | null
  /** Productos que compiten (Competing Products) */
  competidores: number | null
  /** Densidad del título: cuántos de la primera página la llevan en el título */
  densidad: number | null
  /** Puja sugerida de Helium 10 (H10 PPC Sugg. Bid) */
  pujaSugerida: number | null
  /** Posición orgánica del producto propio, si el export la trae */
  rankingOrganico: number | null
  /** SEO Test (migración 312): lo demás que trae el export y antes se tiraba */
  cerebroIq?: number | null
  /** Tendencia del volumen de búsqueda (en %, como lo da Helium 10) */
  tendencia?: number | null
  rangoPatrocinado?: number | null
  /** Cerebro multi-ASIN: el rango orgánico de cada ASIN (una columna por ASIN) */
  rangosRivales?: Record<string, number>
}

export type TipoH10 = 'cerebro' | 'magnet' | 'keyword_tracker'

export interface FilaKeywordTracker {
  keyword: string
  volumen: number | null
  rangoOrganico: number | null
  rangoPatrocinado: number | null
  /** La fecha de la fila (el tracker exporta una por día); se queda la más reciente */
  fecha: string | null
}

export interface FilaGrabber {
  asin: string
  titulo: string | null
  marca: string | null
  precio: number | null
  valoracion: number | null
  resenas: number | null
}

export type ResultadoCsv<T> = { ok: true; filas: T[]; columnas: string[] } | { ok: false; error: string }

/** Parte un CSV respetando comillas (los títulos de Amazon llevan comas). Detecta «;» si la cabecera lo usa */
export function partirCsv(texto: string): string[][] {
  const limpio = texto.replace(/^﻿/, '')
  const primera = limpio.split(/\r?\n/, 1)[0] ?? ''
  const sep = (primera.match(/;/g)?.length ?? 0) > (primera.match(/,/g)?.length ?? 0) ? ';' : ','
  const filas: string[][] = []
  let fila: string[] = []
  let campo = ''
  let comillas = false
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i]
    if (comillas) {
      if (c === '"') {
        if (limpio[i + 1] === '"') {
          campo += '"'
          i++
        } else comillas = false
      } else campo += c
    } else if (c === '"') comillas = true
    else if (c === sep) {
      fila.push(campo)
      campo = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && limpio[i + 1] === '\n') i++
      fila.push(campo)
      if (fila.some((x) => x.trim() !== '')) filas.push(fila)
      fila = []
      campo = ''
    } else campo += c
  }
  fila.push(campo)
  if (fila.some((x) => x.trim() !== '')) filas.push(fila)
  return filas
}

const normal = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** «1.234», «1,234», «1.234,56», «1,234.56», «€0,85», «-» → número o null. Un solo separador seguido de grupos de 3 cifras es de miles */
export function numero(v: string | undefined): number | null {
  if (v == null) return null
  let t = v.replace(/[^\d.,-]/g, '')
  if (!/\d/.test(t)) return null
  if (t.includes('.') && t.includes(',')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  else if (t.includes(',')) t = /^-?\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.')
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  const x = Number(t)
  return Number.isFinite(x) ? x : null
}

function columna(cabecera: string[], ...candidatas: string[]): number {
  const cab = cabecera.map(normal)
  for (const c of candidatas.map(normal)) {
    const exacta = cab.indexOf(c)
    if (exacta >= 0) return exacta
  }
  for (const c of candidatas.map(normal)) {
    const parecida = cab.findIndex((h) => h.includes(c))
    if (parecida >= 0) return parecida
  }
  return -1
}

/** Busca la fila de cabecera (algunos exports traen líneas de título antes) */
function cabeceraDe(filas: string[][], debeTener: string[]): number {
  for (let i = 0; i < Math.min(filas.length, 8); i++) {
    const h = filas[i].map(normal)
    if (debeTener.some((d) => h.some((x) => x.includes(normal(d))))) return i
  }
  return -1
}

/** Las columnas de un Cerebro multi-ASIN que son el rango de un ASIN (la cabecera lleva el ASIN) */
function columnasDeAsin(cabecera: string[]): Array<{ i: number; asin: string }> {
  const salida: Array<{ i: number; asin: string }> = []
  cabecera.forEach((h, i) => {
    const m = h.toUpperCase().match(/\bB0[A-Z0-9]{8}\b/)
    if (m) salida.push({ i, asin: m[0] })
  })
  return salida
}

/** ¿Qué export es? Por las columnas: Keyword Tracker (rango y fecha, sin IQ), Magnet (Magnet IQ) o Cerebro (lo demás) */
export function detectarTipoH10(texto: string): TipoH10 {
  const filas = partirCsv(texto.slice(0, 20000))
  const i = cabeceraDe(filas, ['keyword phrase', 'frase de palabra clave', 'palabra clave', 'keyword'])
  const cab = (filas[Math.max(0, i)] ?? []).map(normal)
  const tiene = (t: string) => cab.some((h) => h.includes(t))
  if (tiene('magnet iq')) return 'magnet'
  if (tiene('cerebro iq')) return 'cerebro'
  if ((tiene('organic rank') || tiene('rango organico') || tiene('posicion organica')) && (tiene('date') || tiene('fecha') || tiene('sponsored position') || tiene('keyword sales'))) return 'keyword_tracker'
  return 'cerebro'
}

export function leerCerebro(texto: string, asinPropio?: string | null): ResultadoCsv<FilaCerebro> {
  const filas = partirCsv(texto)
  const i = cabeceraDe(filas, ['keyword phrase', 'frase de palabra clave', 'palabra clave', 'keyword'])
  if (i < 0) return { ok: false, error: 'No parece un export de Cerebro o Magnet: no encuentro la columna «Keyword Phrase».' }
  const cab = filas[i]
  const k = columna(cab, 'keyword phrase', 'frase de palabra clave', 'palabra clave', 'keyword')
  const v = columna(cab, 'search volume', 'volumen de busqueda', 'volumen')
  const comp = columna(cab, 'competing products', 'productos competidores', 'competing')
  const dens = columna(cab, 'title density', 'densidad del titulo', 'densidad')
  const puja = columna(cab, 'h10 ppc sugg bid', 'sugg bid', 'puja sugerida')
  const org = columna(cab, 'organic rank', 'posicion organica', 'ranking organico')
  const iq = columna(cab, 'cerebro iq score', 'magnet iq score', 'iq score')
  const tend = columna(cab, 'search volume trend', 'tendencia del volumen', 'tendencia')
  const spon = columna(cab, 'sponsored rank', 'sponsored position', 'posicion patrocinada')
  const deAsin = columnasDeAsin(cab).filter((c) => ![k, v, comp, dens, puja, org, iq, tend, spon].includes(c.i))
  const propia = asinPropio ? deAsin.find((c) => c.asin === asinPropio.toUpperCase()) : undefined
  const salida: FilaCerebro[] = []
  const vistas = new Set<string>()
  for (const f of filas.slice(i + 1)) {
    const keyword = (f[k] ?? '').trim().toLowerCase()
    if (!keyword || keyword.length > 80 || vistas.has(keyword)) continue
    vistas.add(keyword)
    const rankDirecto = org >= 0 ? numero(f[org]) : null
    const rank = rankDirecto ?? (propia ? numero(f[propia.i]) : null)
    const rangosRivales: Record<string, number> = {}
    for (const c of deAsin) {
      if (c === propia) continue
      const r = numero(f[c.i])
      if (r && r > 0) rangosRivales[c.asin] = r
    }
    const patro = spon >= 0 ? numero(f[spon]) : null
    salida.push({
      keyword,
      volumen: v >= 0 ? numero(f[v]) : null,
      competidores: comp >= 0 ? numero(f[comp]) : null,
      densidad: dens >= 0 ? numero(f[dens]) : null,
      pujaSugerida: puja >= 0 ? numero(f[puja]) : null,
      rankingOrganico: rank && rank > 0 ? rank : null,
      cerebroIq: iq >= 0 ? numero(f[iq]) : null,
      tendencia: tend >= 0 ? numero(f[tend]) : null,
      rangoPatrocinado: patro && patro > 0 ? patro : null,
      ...(Object.keys(rangosRivales).length > 0 ? { rangosRivales } : {}),
    })
  }
  if (salida.length === 0) return { ok: false, error: 'El fichero no trae ninguna keyword.' }
  return { ok: true, filas: salida.slice(0, 5000), columnas: cab }
}

/** Los ASIN que trae un Cerebro multi-ASIN como columnas (sin el propio): candidatos a seguir en la competencia */
export function asinsDelCerebro(texto: string, asinPropio?: string | null): string[] {
  const filas = partirCsv(texto.slice(0, 20000))
  const i = cabeceraDe(filas, ['keyword phrase', 'frase de palabra clave', 'palabra clave', 'keyword'])
  if (i < 0) return []
  return [...new Set(columnasDeAsin(filas[i]).map((c) => c.asin))].filter((a) => a !== asinPropio?.toUpperCase())
}

/**
 * KEYWORD TRACKER de Helium 10: el rango orgánico (y patrocinado) del producto por palabra, que ninguna API de Amazon da. Exporta una fila por palabra y
 * día: se queda la más reciente de cada palabra. Si trae columna ASIN y se dice cuál es el propio, solo esas filas.
 */
export function leerKeywordTracker(texto: string, asinPropio?: string | null): ResultadoCsv<FilaKeywordTracker> {
  const filas = partirCsv(texto)
  const i = cabeceraDe(filas, ['keyword', 'palabra clave'])
  if (i < 0) return { ok: false, error: 'No parece un export del Keyword Tracker: no encuentro la columna «Keyword».' }
  const cab = filas[i]
  const k = columna(cab, 'keyword', 'palabra clave')
  const v = columna(cab, 'search volume', 'volumen de busqueda', 'volumen')
  const org = columna(cab, 'organic rank', 'rango organico', 'posicion organica')
  const spon = columna(cab, 'sponsored position', 'sponsored rank', 'posicion patrocinada')
  const fecha = columna(cab, 'date', 'fecha')
  const asinCol = columna(cab, 'asin')
  if (org < 0) return { ok: false, error: 'El fichero no trae la columna «Organic Rank»: ¿es un export del Keyword Tracker?' }
  const porKeyword = new Map<string, FilaKeywordTracker>()
  for (const f of filas.slice(i + 1)) {
    const keyword = (f[k] ?? '').trim().toLowerCase()
    if (!keyword || keyword.length > 80) continue
    if (asinPropio && asinCol >= 0 && (f[asinCol] ?? '').trim() && (f[asinCol] ?? '').trim().toUpperCase() !== asinPropio.toUpperCase()) continue
    const d = fecha >= 0 ? (f[fecha] ?? '').trim() || null : null
    const r = numero(f[org])
    const p = spon >= 0 ? numero(f[spon]) : null
    const fila = { keyword, volumen: v >= 0 ? numero(f[v]) : null, rangoOrganico: r && r > 0 ? r : null, rangoPatrocinado: p && p > 0 ? p : null, fecha: d }
    const antes = porKeyword.get(keyword)
    const tiempo = (x: string | null) => (x ? Date.parse(x) || 0 : 0)
    if (!antes || tiempo(d) >= tiempo(antes.fecha)) porKeyword.set(keyword, fila)
  }
  const salida = [...porKeyword.values()]
  if (salida.length === 0) return { ok: false, error: 'El fichero no trae ninguna keyword.' }
  return { ok: true, filas: salida.slice(0, 5000), columnas: cab }
}

export function leerGrabber(texto: string): ResultadoCsv<FilaGrabber> {
  const filas = partirCsv(texto)
  const i = cabeceraDe(filas, ['asin'])
  if (i < 0) return { ok: false, error: 'No parece un export de ASIN Grabber: no encuentro la columna «ASIN».' }
  const cab = filas[i]
  const a = columna(cab, 'asin')
  const t = columna(cab, 'product name', 'title', 'titulo', 'nombre del producto')
  const m = columna(cab, 'brand', 'marca')
  const p = columna(cab, 'price', 'precio')
  const r = columna(cab, 'ratings', 'rating', 'valoracion', 'estrellas')
  const n = columna(cab, 'review count', 'reviews', 'resenas', 'opiniones', 'numero de valoraciones')
  const salida: FilaGrabber[] = []
  const vistas = new Set<string>()
  for (const f of filas.slice(i + 1)) {
    const asin = (f[a] ?? '').trim().toUpperCase()
    if (!/^B0[A-Z0-9]{8}$/.test(asin) || vistas.has(asin)) continue
    vistas.add(asin)
    salida.push({ asin, titulo: t >= 0 ? (f[t] ?? '').trim() || null : null, marca: m >= 0 ? (f[m] ?? '').trim() || null : null, precio: p >= 0 ? numero(f[p]) : null, valoracion: r >= 0 ? numero(f[r]) : null, resenas: n >= 0 ? numero(f[n]) : null })
  }
  if (salida.length === 0) return { ok: false, error: 'El fichero no trae ningún ASIN.' }
  return { ok: true, filas: salida.slice(0, 500), columnas: cab }
}
