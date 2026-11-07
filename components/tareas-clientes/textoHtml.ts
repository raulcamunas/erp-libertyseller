import { juntarIguales, type Segmento } from '@/lib/tareas-clientes/bloques'
import { COLORES_NOTION } from '@/lib/tareas-clientes/tipos'

/**
 * EL TEXTO CON FORMATO DE UN BLOQUE, ENTRE SU FORMA GUARDADA (`Segmento[]`) Y EL HTML QUE EDITA EL NAVEGADOR.
 *
 * `segmentosAHtml` construye texto: escapa todo y solo deja pasar los enlaces http(s) y mailto. `htmlASegmentos` recorre lo que el navegador ha dejado en el elemento
 * editable y se queda SOLO con lo que entiende (negrita, cursiva, subrayado, tachado, código, enlace y color): cualquier otra etiqueta —un `<script>`, un `style`,
 * un `onclick`— se pierde al leerla y nunca se vuelve a escribir. Lo que se pega desde otra web llega limpio por el mismo camino.
 */

const escapar = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const enlaceSeguro = (u: string | undefined): string | null => (u && /^(https?:\/\/|mailto:)/i.test(u.trim()) ? u.trim() : null)

const colorBase = (k: string) => k.replace(/_background$/, '')
const colorConocido = (k: string | undefined): k is string => Boolean(k && (COLORES_NOTION as readonly string[]).includes(colorBase(k)))

export function segmentosAHtml(segmentos: readonly Segmento[]): string {
  return segmentos
    .map((s) => {
      let h = escapar(s.t).replace(/\n/g, '<br>')
      if (s.c) h = `<code>${h}</code>`
      if (s.b) h = `<strong>${h}</strong>`
      if (s.i) h = `<em>${h}</em>`
      if (s.u) h = `<u>${h}</u>`
      if (s.s) h = `<s>${h}</s>`
      const enlace = enlaceSeguro(s.l)
      if (enlace) h = `<a href="${escapar(enlace)}" target="_blank" rel="noopener noreferrer">${h}</a>`
      if (colorConocido(s.k)) h = `<span data-k="${s.k}">${h}</span>`
      return h
    })
    .join('')
}

interface Formato {
  b?: boolean
  i?: boolean
  u?: boolean
  s?: boolean
  c?: boolean
  l?: string
  k?: string
}

const ETIQUETAS_DE_BLOQUE = new Set(['DIV', 'P', 'LI'])

/** Lo que hay dentro de un elemento editable, como segmentos. Un salto de línea sale como «\n» */
export function htmlASegmentos(raiz: Node): Segmento[] {
  const salida: Segmento[] = []
  const recorrer = (nodo: Node, f: Formato, primero: { valor: boolean }) => {
    if (nodo.nodeType === 3) {
      const t = nodo.textContent ?? ''
      if (t) salida.push({ t, ...(f.b ? { b: true } : {}), ...(f.i ? { i: true } : {}), ...(f.u ? { u: true } : {}), ...(f.s ? { s: true } : {}), ...(f.c ? { c: true } : {}), ...(f.l ? { l: f.l } : {}), ...(f.k ? { k: f.k } : {}) })
      primero.valor = false
      return
    }
    if (nodo.nodeType !== 1) return
    const el = nodo as HTMLElement
    const etiqueta = el.tagName
    // Lo que no es texto (un script, un estilo) no se lee: ni su contenido pasa a ser texto
    if (etiqueta === 'SCRIPT' || etiqueta === 'STYLE' || etiqueta === 'NOSCRIPT' || etiqueta === 'TEMPLATE') return
    if (etiqueta === 'BR') {
      salida.push({ t: '\n', ...(f.c ? { c: true } : {}) })
      return
    }
    const g: Formato = { ...f }
    if (etiqueta === 'B' || etiqueta === 'STRONG') g.b = true
    else if (etiqueta === 'I' || etiqueta === 'EM') g.i = true
    else if (etiqueta === 'U') g.u = true
    else if (etiqueta === 'S' || etiqueta === 'STRIKE' || etiqueta === 'DEL') g.s = true
    else if (etiqueta === 'CODE') g.c = true
    else if (etiqueta === 'A') {
      const enlace = enlaceSeguro(el.getAttribute('href') ?? undefined)
      if (enlace) g.l = enlace
    } else if (etiqueta === 'SPAN') {
      const k = el.getAttribute('data-k') ?? undefined
      if (colorConocido(k)) g.k = k
    }
    // Un div o un párrafo que el navegador mete al pulsar Enter es otra línea
    if (ETIQUETAS_DE_BLOQUE.has(etiqueta) && !primero.valor) salida.push({ t: '\n' })
    primero.valor = false
    for (const hijo of Array.from(el.childNodes)) recorrer(hijo, g, { valor: false })
  }
  const inicio = { valor: true }
  for (const hijo of Array.from(raiz.childNodes)) recorrer(hijo, {}, inicio)
  // El navegador deja un <br> final en un bloque vacío o al final de una línea: no es texto
  const junto = juntarIguales(salida)
  const ultimo = junto[junto.length - 1]
  if (ultimo && ultimo.t.endsWith('\n')) ultimo.t = ultimo.t.slice(0, -1)
  return junto.filter((s) => s.t.length > 0)
}
