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

export function leerCerebro(texto: string): ResultadoCsv<FilaCerebro> {
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
  const salida: FilaCerebro[] = []
  const vistas = new Set<string>()
  for (const f of filas.slice(i + 1)) {
    const keyword = (f[k] ?? '').trim().toLowerCase()
    if (!keyword || keyword.length > 80 || vistas.has(keyword)) continue
    vistas.add(keyword)
    const rank = org >= 0 ? numero(f[org]) : null
    salida.push({ keyword, volumen: v >= 0 ? numero(f[v]) : null, competidores: comp >= 0 ? numero(f[comp]) : null, densidad: dens >= 0 ? numero(f[dens]) : null, pujaSugerida: puja >= 0 ? numero(f[puja]) : null, rankingOrganico: rank && rank > 0 ? rank : null })
  }
  if (salida.length === 0) return { ok: false, error: 'El fichero no trae ninguna keyword.' }
  return { ok: true, filas: salida.slice(0, 3000), columnas: cab }
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
