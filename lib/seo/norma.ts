/**
 * SEO · ¿CUMPLE LA FICHA LAS REGLAS DE 2026? PURO (se prueba sin Amazon).
 *
 * Las reglas son las del SOP de la agencia (skill «seo-listing-amazon»), y los recuentos se CALCULAN aquí, nunca a ojo (es el error 6 del SOP):
 *   · Título: 75 caracteres como mucho (salvo media); ninguna palabra más de dos veces; sin ! $ ? _ { } ^ ¬ ¦; sin lenguaje promocional ni precio. Un título fuera de norma lo reescribe la IA de
 *     Amazon y se pierde el control del posicionamiento: por eso es «grave».
 *   · Viñetas: cinco, y 1.000 bytes sumando las cinco.
 *   · Backend: 249 bytes; un byte de más y Amazon ignora el campo ENTERO. Sin repetir palabras que ya están arriba (título y viñetas): Amazon indexa palabras sueltas, repetir no suma y gasta
 *     bytes que podrían llevar otra búsqueda.
 *   · Item Highlights (125 caracteres): la Listings API no los devuelve en lo que lee el ERP, así que no se pueden revisar aquí; la pantalla lo dice en vez de darlos por buenos.
 */

import { bytesDe, caracteresDe, LIMITE_BACKEND_BYTES, LIMITE_BULLETS_BYTES, LIMITE_TITULO_CARACTERES, normalizar, palabras, raiz, tokens, type TextosDeFicha } from './cobertura'

export type Gravedad = 'grave' | 'atencion' | 'info'
export type Campo = 'titulo' | 'highlights' | 'bullets' | 'backend'

export interface Incidencia {
  /** Estable entre lecturas: sirve para recordar que ya se ha revisado */
  id: string
  gravedad: Gravedad
  campo: Campo
  /** Una línea corta para listas («título fuera de norma: 103 de 75 caracteres») */
  resumen: string
  texto: string
  accion: string
}

export interface MedidasDeFicha {
  tituloCaracteres: number
  bullets: number
  bulletsBytes: number
  backendBytes: number
  /** Bytes del backend gastados en palabras que ya están en el título o en las viñetas (o repetidas dentro del propio backend) */
  backendDesperdiciado: number
  /** Esas palabras, tal cual */
  backendRepetidas: string[]
}

/** Los caracteres que Amazon no admite en un título */
export const PROHIBIDOS_TITULO = ['!', '$', '?', '_', '{', '}', '^', '¬', '¦'] as const

/**
 * Palabras y expresiones promocionales que Amazon no quiere en el título. Se buscan como palabras enteras sobre el texto normalizado (sin tildes): «mejor» suelto no está porque «para un mejor
 * agarre» es una descripción, pero «el mejor» sí.
 */
const PROMOCIONALES = ['oferta', 'ofertas', 'barato', 'barata', 'baratos', 'baratas', 'gratis', 'descuento', 'rebaja', 'rebajas', 'promocion', 'el mejor', 'la mejor', 'los mejores', 'las mejores', 'top ventas', 'mas vendido', 'mas vendida', 'numero 1', 'n 1', 'best seller', 'bestseller', 'free', 'sale', 'cheap', 'discount', 'best', 'black friday']

const PRECIO = /\d+(?:[.,]\d+)?\s?(?:€|eur\b|euros?\b|\$|usd\b|£)/i

/** Las palabras que salen más de dos veces en el título (con su forma legible) */
export function repetidasEnTitulo(titulo: string): string[] {
  const cuenta = new Map<string, { forma: string; n: number }>()
  for (const t of tokens(titulo)) {
    const x = cuenta.get(t.raiz) ?? { forma: t.forma, n: 0 }
    x.n++
    cuenta.set(t.raiz, x)
  }
  return [...cuenta.values()].filter((x) => x.n > 2).map((x) => x.forma)
}

export function promocionalesEn(texto: string): string[] {
  const n = ` ${normalizar(texto)} `
  return PROMOCIONALES.filter((p) => n.includes(` ${p} `))
}

/** Las palabras del backend que no aportan nada: ya están arriba o repetidas dentro del propio backend */
export function backendRepetido(backend: string, arriba: string): { palabras: string[]; bytes: number } {
  const yaArriba = new Set(palabras(arriba))
  const vistas = new Set<string>()
  const repetidas: string[] = []
  let bytes = 0
  for (const w of (backend ?? '').split(/[\s,;]+/).filter(Boolean)) {
    const n = normalizar(w)
    if (!n) continue
    // Una «palabra» con espacios por dentro tras normalizar (p. ej. «7-8kg») se mira por trozos
    const raices = n.split(' ').map(raiz)
    if (raices.every((r) => yaArriba.has(r) || vistas.has(r))) {
      repetidas.push(w)
      bytes += bytesDe(w) + 1
    }
    for (const r of raices) vistas.add(r)
  }
  return { palabras: repetidas, bytes }
}

export function medidasDe(f: TextosDeFicha): MedidasDeFicha {
  const arriba = [f.titulo ?? '', ...f.bullets].join(' ')
  const rep = backendRepetido(f.backend ?? '', arriba)
  return {
    tituloCaracteres: caracteresDe(f.titulo),
    bullets: f.bullets.length,
    bulletsBytes: f.bullets.reduce((s, b) => s + bytesDe(b), 0),
    backendBytes: bytesDe(f.backend),
    backendDesperdiciado: rep.bytes,
    backendRepetidas: rep.palabras,
  }
}

const ORDEN: Record<Gravedad, number> = { grave: 0, atencion: 1, info: 2 }
const miles = (n: number) => n.toLocaleString('es-ES')

/** LA REVISIÓN: lo que incumple, de lo más grave a lo menos, con qué hacer en cada caso */
export function revisarFicha(f: TextosDeFicha): { medidas: MedidasDeFicha; incidencias: Incidencia[] } {
  const m = medidasDe(f)
  const titulo = f.titulo ?? ''
  const inc: Incidencia[] = []

  if (!titulo.trim()) inc.push({ id: 'titulo-vacio', resumen: 'sin título', gravedad: 'grave', campo: 'titulo', texto: 'La ficha no tiene título.', accion: 'Escribirlo: marca + tipo de producto + atributo + variante, en 75 caracteres.' })
  else {
    if (m.tituloCaracteres > LIMITE_TITULO_CARACTERES)
      inc.push({
        id: 'titulo-largo', resumen: `título fuera de norma (${m.tituloCaracteres} de ${LIMITE_TITULO_CARACTERES} caracteres)`,
        gravedad: 'grave',
        campo: 'titulo',
        texto: `El título tiene ${m.tituloCaracteres} caracteres y el límite de 2026 es ${LIMITE_TITULO_CARACTERES} (sobran ${m.tituloCaracteres - LIMITE_TITULO_CARACTERES}). Amazon reescribe con su IA los títulos fuera de norma y se pierde el control del posicionamiento.`,
        accion: 'Dejarlo en 75: marca → término de categoría con más demanda → nicho → atributo diferenciador → variante. Lo que no quepa, a los Item Highlights.',
      })
    const prohibidos = PROHIBIDOS_TITULO.filter((c) => titulo.includes(c))
    if (prohibidos.length > 0) inc.push({ id: 'titulo-simbolos', resumen: `símbolos no admitidos en el título (${prohibidos.join(' ')})`, gravedad: 'grave', campo: 'titulo', texto: `El título lleva caracteres que Amazon no admite: ${prohibidos.join(' ')}`, accion: 'Quitarlos.' })
    const repes = repetidasEnTitulo(titulo)
    if (repes.length > 0) inc.push({ id: 'titulo-repetidas', resumen: `palabras repetidas en el título (${repes.join(', ')})`, gravedad: 'atencion', campo: 'titulo', texto: `En el título hay palabras más de dos veces: ${repes.join(', ')}.`, accion: 'Dejar cada palabra como mucho dos veces: repetir no suma posicionamiento y ocupa sitio.' })
    const promo = promocionalesEn(titulo)
    if (promo.length > 0) inc.push({ id: 'titulo-promocional', resumen: `lenguaje promocional en el título (${promo.join(', ')})`, gravedad: 'grave', campo: 'titulo', texto: `El título tiene lenguaje promocional: ${promo.join(', ')}.`, accion: 'Quitarlo: Amazon no lo admite en el título.' })
    if (PRECIO.test(titulo)) inc.push({ id: 'titulo-precio', resumen: 'precio en el título', gravedad: 'grave', campo: 'titulo', texto: 'El título menciona un precio.', accion: 'Quitarlo: el precio no va en el título.' })
  }

  if (m.bullets === 0) inc.push({ id: 'bullets-vacios', resumen: 'sin viñetas', gravedad: 'grave', campo: 'bullets', texto: 'La ficha no tiene viñetas.', accion: 'Escribir cinco: beneficio concreto delante y un grupo de búsquedas por viñeta, unos 200 bytes cada una.' })
  else if (m.bullets < 5) inc.push({ id: 'bullets-pocos', resumen: `${m.bullets} de 5 viñetas`, gravedad: 'atencion', campo: 'bullets', texto: `Tiene ${m.bullets} de 5 viñetas.`, accion: 'Completar hasta cinco: cada viñeta es sitio para otro grupo de búsquedas.' })
  if (m.bulletsBytes > LIMITE_BULLETS_BYTES)
    inc.push({ id: 'bullets-largos', resumen: `viñetas demasiado largas (${miles(m.bulletsBytes)} de ${miles(LIMITE_BULLETS_BYTES)} bytes)`, gravedad: 'grave', campo: 'bullets', texto: `Las viñetas suman ${miles(m.bulletsBytes)} bytes y el límite es ${miles(LIMITE_BULLETS_BYTES)} sumando las cinco.`, accion: 'Recortarlas a unos 200 bytes cada una, con el beneficio delante.' })

  if (!(f.backend ?? '').trim()) inc.push({ id: 'backend-vacio', resumen: 'backend vacío', gravedad: 'atencion', campo: 'backend', texto: 'El backend está vacío: son 249 bytes gratis para búsquedas que no caben arriba.', accion: 'Llenarlo con sinónimos, el segundo idioma si procede y los términos que no deben ir a la vista, sin repetir nada del título ni de las viñetas.' })
  else {
    if (m.backendBytes > LIMITE_BACKEND_BYTES)
      inc.push({ id: 'backend-largo', resumen: `backend ignorado por Amazon (${m.backendBytes} de ${LIMITE_BACKEND_BYTES} bytes)`, gravedad: 'grave', campo: 'backend', texto: `El backend ocupa ${m.backendBytes} bytes y el límite es ${LIMITE_BACKEND_BYTES}: con un byte de más Amazon ignora el campo ENTERO.`, accion: `Recortarlo por debajo de ${LIMITE_BACKEND_BYTES} bytes; empezar por las palabras que ya están arriba.` })
    if (m.backendRepetidas.length > 0)
      inc.push({
        id: 'backend-repetidas', resumen: `${m.backendDesperdiciado} bytes del backend repetidos`,
        gravedad: 'atencion',
        campo: 'backend',
        texto: `${m.backendDesperdiciado} bytes del backend se gastan en palabras que ya están en el título o las viñetas (o repetidas): ${m.backendRepetidas.slice(0, 12).join(', ')}${m.backendRepetidas.length > 12 ? '…' : ''}.`,
        accion: 'Quitarlas y usar ese sitio para otras búsquedas: Amazon indexa palabras sueltas y repetir no suma.',
      })
    if (/,/.test(f.backend ?? '')) inc.push({ id: 'backend-comas', resumen: 'comas en el backend', gravedad: 'info', campo: 'backend', texto: 'El backend lleva comas.', accion: 'Separar solo con espacios: las comas gastan bytes y no aportan.' })
  }

  inc.sort((a, b) => ORDEN[a.gravedad] - ORDEN[b.gravedad])
  return { medidas: m, incidencias: inc }
}
