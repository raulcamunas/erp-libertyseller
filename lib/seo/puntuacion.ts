/**
 * SEO · LA PUNTUACIÓN DE UN LISTING, DE 0 A 100. PURO (se prueba sin base de datos). La usa el «Estudio de listing» en vivo, mientras se escribe.
 *
 * Seis bloques que suman 100. Cada uno dice cuánto lleva, cuánto le falta y QUÉ hacer para llegar al máximo:
 *   · Norma 2026 (25): título ≤ 75 caracteres sin símbolos, precio ni lenguaje promocional (10); 5 viñetas y ≤ 1.000 bytes (8); backend ≤ 249 bytes, sin repetir lo de arriba ni comas (7).
 *   · Búsquedas en el título (25): las 20 búsquedas DEL producto que más compras mueven, enteras en el título o en los Item Highlights (lo que más indexa), pesadas por sus compras.
 *   · Orden del título (10): la marca delante (3), la búsqueda que más vende al principio, en los primeros 45 caracteres (4), y las palabras que pesan ordenadas de más a
 *     menos compras (3). Es lo que pide el SOP: marca → término con más demanda → nicho → atributo → variante (y lo que lee el comprador en el móvil, los primeros caracteres).
 *   · Búsquedas en la ficha (15): las 40 primeras, enteras en ALGÚN sitio (título, highlights, viñetas, descripción o backend), pesadas por compras.
 *   · Palabras que pesan (15): las 15 palabras con más compras detrás, en alguna parte; las 5 primeras cuentan doble si están en el título.
 *   · Item Highlights (5): puestos y ≤ 125 caracteres.
 *   · Aprovechar el sitio (5): título de 60 caracteres o más (2), backend de 180 bytes o más (2), viñetas de 150 bytes de media o más (1).
 *
 * Sin búsquedas de Brand Analytics, los tres bloques de búsquedas no se pueden medir: se puntúa sobre lo que queda y se escala a 100 (y se dice).
 * «Del producto» = lo que SEO no descarta (ni ruido, ni otro precio, ni ajenas: lib/seo/embudo.ts).
 */

import type { ConsultaGuardada } from './datos'
import { bytesDe, caracteresDe, coberturaDe, LIMITE_BACKEND_BYTES, LIMITE_BULLETS_BYTES, LIMITE_HIGHLIGHTS_CARACTERES, LIMITE_TITULO_CARACTERES, tokens, type TextosDeFicha } from './cobertura'
import { esDelProducto, type BusquedaDiagnosticada } from './embudo'
import { backendRepetido, PROHIBIDOS_TITULO, promocionalesEn, repetidasEnTitulo } from './norma'

export type IdBloque = 'norma' | 'titulo' | 'orden' | 'ficha' | 'palabras' | 'highlights' | 'sitio'

export interface Comprobacion {
  texto: string
  ok: boolean
}

export interface BloqueDePuntuacion {
  id: IdBloque
  nombre: string
  puntos: number
  maximo: number
  /** false = no se puede medir (sin búsquedas): no cuenta */
  medible: boolean
  /** Lo siguiente que hay que hacer para subir este bloque (null = está al máximo) */
  siguiente: string | null
  comprobaciones: Comprobacion[]
}

export interface PalabraDelEstudio {
  palabra: string
  raiz: string
  compras: number
  donde: 'titulo' | 'highlights' | 'bullets' | 'backend' | 'descripcion' | null
}

export interface BusquedaDelEstudio {
  consulta: string
  compras: number
  volumen: number | null
  enTitulo: boolean
  enFicha: boolean
  faltan: string[]
}

export interface PuntuacionDeListing {
  total: number
  bloques: BloqueDePuntuacion[]
  palabras: PalabraDelEstudio[]
  busquedas: BusquedaDelEstudio[]
  sinBusquedas: boolean
  /** Las 3 acciones que más puntos suman, de mayor a menor */
  siguientes: Array<{ bloque: IdBloque; texto: string; puntos: number }>
}

const PRECIO = /\d+([.,]\d+)?\s?(€|eur|euros|\$|usd)\b/i
const redondear = (x: number) => Math.round(x * 10) / 10
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))

export function puntuarListing(entrada: Omit<TextosDeFicha, 'descripcion'> & { descripcion?: string | null }, diagnosticadas: ReadonlyArray<BusquedaDiagnosticada<ConsultaGuardada>>, opciones: { marca?: string | null } = {}): PuntuacionDeListing {
  const f: TextosDeFicha = { ...entrada, descripcion: entrada.descripcion ?? null }
  const titulo = f.titulo ?? ''
  const highlights = f.highlights ?? ''
  const bullets = f.bullets.filter((b) => b.trim())
  const backend = f.backend ?? ''
  const bloques: BloqueDePuntuacion[] = []

  // ---------- Norma 2026 (25) ----------
  {
    const cars = caracteresDe(titulo)
    const prohibidos = PROHIBIDOS_TITULO.filter((c) => titulo.includes(c))
    const promo = promocionalesEn(titulo)
    const repes = repetidasEnTitulo(titulo)
    const bytesB = bytesDe(bullets.join(''))
    const bytesK = bytesDe(backend)
    const repK = backendRepetido(backend, [titulo, highlights, ...bullets].join(' '))
    const c: Comprobacion[] = [
      { texto: titulo.trim() ? `Título de ${cars} de ${LIMITE_TITULO_CARACTERES} caracteres` : 'Hay título', ok: !!titulo.trim() && cars <= LIMITE_TITULO_CARACTERES },
      { texto: 'Sin símbolos no admitidos, precio ni lenguaje promocional en el título', ok: prohibidos.length === 0 && promo.length === 0 && !PRECIO.test(titulo) },
      { texto: 'Ninguna palabra más de dos veces en el título', ok: repes.length === 0 },
      { texto: `${bullets.length} de 5 viñetas`, ok: bullets.length >= 5 },
      { texto: `Viñetas: ${bytesB} de ${LIMITE_BULLETS_BYTES} bytes`, ok: bytesB <= LIMITE_BULLETS_BYTES && bytesB > 0 },
      { texto: `Backend: ${bytesK} de ${LIMITE_BACKEND_BYTES} bytes`, ok: bytesK > 0 && bytesK <= LIMITE_BACKEND_BYTES },
      { texto: 'El backend no repite lo de arriba ni lleva comas', ok: repK.palabras.length === 0 && !backend.includes(',') },
    ]
    let p = 0
    if (c[0].ok) p += 6
    if (c[1].ok && titulo.trim()) p += 3
    if (c[2].ok && titulo.trim()) p += 1
    p += Math.min(bullets.length, 5) * 1 // 5
    if (c[4].ok) p += 3
    if (c[5].ok) p += 4
    if (c[6].ok && bytesK > 0) p += 3
    const primero = c.find((x) => !x.ok)
    const siguiente = !primero
      ? null
      : primero === c[0]
        ? titulo.trim()
          ? `Recorta el título a ${LIMITE_TITULO_CARACTERES} caracteres (sobran ${cars - LIMITE_TITULO_CARACTERES}): lo que no quepa, a los Item Highlights.`
          : 'Escribe el título: marca + término principal + atributo + variante.'
        : primero === c[1]
          ? `Quita del título: ${[...prohibidos, ...promo].join(', ') || 'el precio'}.`
          : primero === c[2]
            ? `Deja como mucho dos veces: ${repes.join(', ')}.`
            : primero === c[3]
              ? `Escribe ${5 - bullets.length} viñeta${5 - bullets.length === 1 ? '' : 's'} más: cada una es sitio para otro grupo de búsquedas.`
              : primero === c[4]
                ? `Recorta las viñetas ${bytesB - LIMITE_BULLETS_BYTES} bytes.`
                : primero === c[5]
                  ? bytesK === 0
                    ? 'Llena el backend: 249 bytes gratis para sinónimos y lo que no cabe arriba.'
                    : `Recorta el backend ${bytesK - LIMITE_BACKEND_BYTES} bytes: con uno de más, Amazon lo ignora entero.`
                  : `Quita del backend lo repetido${repK.palabras.length ? ` (${repK.palabras.slice(0, 6).join(', ')})` : ''} y las comas.`
    bloques.push({ id: 'norma', nombre: 'Norma 2026', puntos: p, maximo: 25, medible: true, siguiente, comprobaciones: c })
  }

  // ---------- Búsquedas y palabras ----------
  const delProducto = diagnosticadas.filter(esDelProducto).filter((d) => (d.fila.comprasTotal ?? 0) > 0)
  const vistas = new Set<string>()
  const unicas = delProducto
    .sort((a, b) => (b.fila.comprasTotal ?? 0) - (a.fila.comprasTotal ?? 0) || (b.fila.volumen ?? 0) - (a.fila.volumen ?? 0))
    .filter((d) => {
      const k = d.fila.consulta.trim().toLowerCase()
      if (vistas.has(k)) return false
      vistas.add(k)
      return true
    })
  const sinBusquedas = unicas.length === 0
  const busquedas: BusquedaDelEstudio[] = unicas.slice(0, 40).map((d) => {
    const cob = coberturaDe(d.fila.consulta, f)
    return { consulta: d.fila.consulta, compras: d.fila.comprasTotal ?? 0, volumen: d.fila.volumen, enTitulo: cob.titulo || cob.highlights, enFicha: cob.faltan.length === 0, faltan: cob.faltan }
  })

  // Título (25)
  {
    const top = busquedas.slice(0, 20)
    const total = top.reduce((s, b) => s + b.compras, 0)
    const dentro = top.filter((b) => b.enTitulo).reduce((s, b) => s + b.compras, 0)
    const p = total > 0 ? (dentro / total) * 25 : 0
    const fuera = top.filter((b) => !b.enTitulo)
    const mejor = fuera[0]
    bloques.push({
      id: 'titulo',
      nombre: 'Búsquedas en el título',
      puntos: redondear(p),
      maximo: 25,
      medible: !sinBusquedas,
      siguiente: sinBusquedas ? null : mejor ? `Mete «${mejor.consulta}» entera en el título o en los Item Highlights (${mejor.compras.toLocaleString('es-ES')} compras en Amazon).` : null,
      comprobaciones: top.slice(0, 8).map((b) => ({ texto: b.consulta, ok: b.enTitulo })),
    })
  }
  // Ficha (15)
  {
    const total = busquedas.reduce((s, b) => s + b.compras, 0)
    const dentro = busquedas.filter((b) => b.enFicha).reduce((s, b) => s + b.compras, 0)
    const p = total > 0 ? (dentro / total) * 15 : 0
    const mejor = busquedas.find((b) => !b.enFicha)
    bloques.push({
      id: 'ficha',
      nombre: 'Búsquedas en la ficha',
      puntos: redondear(p),
      maximo: 15,
      medible: !sinBusquedas,
      siguiente: sinBusquedas ? null : mejor ? `Falta «${mejor.faltan.join(' ')}» para cubrir «${mejor.consulta}»: ponlo en una viñeta o en el backend.` : null,
      comprobaciones: [{ texto: `${busquedas.filter((b) => b.enFicha).length} de ${busquedas.length} búsquedas enteras en algún sitio`, ok: busquedas.every((b) => b.enFicha) }],
    })
  }
  // Palabras que pesan (15)
  const conjunto = (t: string | null | undefined) => new Set(tokens(t ?? '').map((x) => x.raiz))
  const zonas: Array<[PalabraDelEstudio['donde'], Set<string>]> = [
    ['titulo', conjunto(titulo)],
    ['highlights', conjunto(highlights)],
    ['bullets', conjunto(bullets.join(' '))],
    ['backend', conjunto(backend)],
    ['descripcion', conjunto(f.descripcion)],
  ]
  const porRaiz = new Map<string, PalabraDelEstudio>()
  for (const d of unicas) {
    for (const [raiz, forma] of new Map(tokens(d.fila.consulta).map((x) => [x.raiz, x.forma]))) {
      if (forma.length < 3 || /^\d+$/.test(forma) || forma === 'amazon' || promocionalesEn(forma).length > 0) continue
      const x = porRaiz.get(raiz) ?? { palabra: forma, raiz, compras: 0, donde: zonas.find(([, s]) => s.has(raiz))?.[0] ?? null }
      x.compras += d.fila.comprasTotal ?? 0
      porRaiz.set(raiz, x)
    }
  }
  const palabras = [...porRaiz.values()].sort((a, b) => b.compras - a.compras).slice(0, 15)
  {
    // 15 puntos: cada palabra vale por sus compras; las 5 primeras, la mitad de su valor solo si están en el título
    const total = palabras.reduce((s, x) => s + x.compras, 0)
    let p = 0
    if (total > 0)
      for (const [i, x] of palabras.entries()) {
        const peso = (x.compras / total) * 15
        if (i < 5) p += x.donde === 'titulo' || x.donde === 'highlights' ? peso : x.donde ? peso / 2 : 0
        else p += x.donde ? peso : 0
      }
    const falta = palabras.find((x) => !x.donde) ?? palabras.slice(0, 5).find((x) => x.donde !== 'titulo' && x.donde !== 'highlights')
    bloques.push({
      id: 'palabras',
      nombre: 'Palabras que pesan',
      puntos: redondear(p),
      maximo: 15,
      medible: !sinBusquedas,
      siguiente: sinBusquedas || !falta ? null : falta.donde ? `Sube «${falta.palabra}» al título: es de las 5 que más venden.` : `Añade «${falta.palabra}»: no está en ninguna parte (${falta.compras.toLocaleString('es-ES')} compras detrás).`,
      comprobaciones: palabras.slice(0, 10).map((x) => ({ texto: x.palabra, ok: !!x.donde })),
    })
  }
  // Orden del título (10): marca delante, la búsqueda que más vende al principio y las palabras que pesan de más a menos
  {
    const palabrasT = tokens(titulo)
    const raices = palabrasT.map((x) => x.raiz)
    const marca = opciones.marca ? tokens(opciones.marca).map((x) => x.raiz) : []
    const c: Comprobacion[] = []
    let p = 0
    let siguiente: string | null = null
    // a) La marca, delante
    if (marca.length === 0) p += 3
    else {
      const delante = marca.every((r, i) => raices[i] === r)
      c.push({ texto: 'La marca, lo primero del título', ok: delante })
      if (delante) p += 3
      else siguiente = `Empieza el título por la marca («${opciones.marca}»).`
    }
    // b) La búsqueda que más vende, entera en los primeros 45 caracteres
    const principal = busquedas[0]
    if (!principal || sinBusquedas) p += 4
    else {
      const inicio = titulo.slice(0, 45)
      const cabeza = coberturaDe(principal.consulta, { ...f, titulo: inicio, highlights: null, bullets: [], backend: '', descripcion: null }).titulo
      c.push({ texto: `«${principal.consulta}» al principio del título`, ok: cabeza })
      if (cabeza) p += 4
      else if (principal.enTitulo) {
        p += 2
        siguiente ??= `Adelanta «${principal.consulta}»: es la búsqueda que más vende (${principal.compras.toLocaleString('es-ES')} compras) y tiene que leerse en los primeros caracteres.`
      } else siguiente ??= `Pon «${principal.consulta}» al principio del título: es la búsqueda que más vende (${principal.compras.toLocaleString('es-ES')} compras).`
    }
    // c) Las palabras que pesan, de más a menos compras (las 6 primeras que estén en el título)
    const posicion = (r: string) => raices.indexOf(r)
    const enTitulo = palabras.filter((x) => posicion(x.raiz) >= 0).slice(0, 6)
    let pares = 0
    let malos = 0
    let peor: [PalabraDelEstudio, PalabraDelEstudio] | null = null
    for (let i = 0; i < enTitulo.length; i++)
      for (let j = i + 1; j < enTitulo.length; j++) {
        pares++
        // enTitulo va de más a menos compras: la de i debería ir antes que la de j
        if (posicion(enTitulo[i].raiz) > posicion(enTitulo[j].raiz) && enTitulo[i].compras > enTitulo[j].compras * 1.5) {
          malos++
          if (!peor) peor = [enTitulo[i], enTitulo[j]]
        }
      }
    const bienOrdenado = pares === 0 || malos === 0
    c.push({ texto: 'Las palabras que más venden, antes', ok: bienOrdenado })
    p += pares === 0 ? 3 : 3 * (1 - malos / pares)
    if (peor) siguiente ??= `Pon «${peor[0].palabra}» (${peor[0].compras.toLocaleString('es-ES')} compras) antes que «${peor[1].palabra}» (${peor[1].compras.toLocaleString('es-ES')}).`
    bloques.push({ id: 'orden', nombre: 'Orden del título', puntos: redondear(p), maximo: 10, medible: titulo.trim().length > 0, siguiente: titulo.trim() ? siguiente : null, comprobaciones: c })
  }
  // Item Highlights (5)
  {
    const cars = caracteresDe(highlights)
    const ok = highlights.trim().length > 0 && cars <= LIMITE_HIGHLIGHTS_CARACTERES
    bloques.push({
      id: 'highlights',
      nombre: 'Item Highlights',
      puntos: ok ? 5 : highlights.trim() ? 2 : 0,
      maximo: 5,
      medible: true,
      siguiente: ok ? null : highlights.trim() ? `Recorta los Item Highlights a ${LIMITE_HIGHLIGHTS_CARACTERES} caracteres (sobran ${cars - LIMITE_HIGHLIGHTS_CARACTERES}).` : 'Escribe los Item Highlights (125 caracteres): lo que no cabe en el título, se indexa igual.',
      comprobaciones: [{ texto: highlights.trim() ? `${cars} de ${LIMITE_HIGHLIGHTS_CARACTERES} caracteres` : 'Sin Item Highlights', ok }],
    })
  }
  // Aprovechar el sitio (5)
  {
    const cars = caracteresDe(titulo)
    const bytesK = bytesDe(backend)
    const media = bullets.length ? bytesDe(bullets.join('')) / Math.max(5, bullets.length) : 0
    const c: Comprobacion[] = [
      { texto: `Título de 60 caracteres o más (${cars})`, ok: cars >= 60 && cars <= LIMITE_TITULO_CARACTERES },
      { texto: `Backend de 180 bytes o más (${bytesK})`, ok: bytesK >= 180 && bytesK <= LIMITE_BACKEND_BYTES },
      { texto: `Viñetas de 150 bytes de media o más (${Math.round(media)})`, ok: media >= 150 },
    ]
    const p = (c[0].ok ? 2 : clamp(cars / 60, 0, 1) * 1.5) + (c[1].ok ? 2 : clamp(bytesK / 180, 0, 1) * 1.5) + (c[2].ok ? 1 : clamp(media / 150, 0, 1) * 0.7)
    const primero = c.find((x) => !x.ok)
    bloques.push({
      id: 'sitio',
      nombre: 'Aprovechar el sitio',
      puntos: redondear(p),
      maximo: 5,
      medible: true,
      siguiente: !primero ? null : primero === c[0] ? 'Alarga el título hasta 60–75 caracteres con otra búsqueda del producto.' : primero === c[1] ? `Añade ${Math.max(0, 180 - bytesK)} bytes al backend: sinónimos, plurales y búsquedas que no caben arriba.` : 'Alarga las viñetas (unos 200 bytes cada una) con el beneficio delante.',
      comprobaciones: c,
    })
  }

  const medibles = bloques.filter((b) => b.medible)
  const maximo = medibles.reduce((s, b) => s + b.maximo, 0)
  const puntos = medibles.reduce((s, b) => s + b.puntos, 0)
  const total = maximo > 0 ? Math.round((puntos / maximo) * 100) : 0
  const siguientes = medibles
    .filter((b) => b.siguiente)
    .map((b) => ({ bloque: b.id, texto: b.siguiente as string, puntos: Math.round(((b.maximo - b.puntos) / maximo) * 100) }))
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, 3)
  return { total: clamp(total, 0, 100), bloques, palabras, busquedas, sinBusquedas, siguientes }
}
