/**
 * SEO · LO QUE FALLA EN CADA CAMPO DE LA FICHA, PARA ENSEÑARLO DEBAJO DE DONDE SE ESCRIBE. PURO.
 *
 * Junta la norma de 2026 (lib/seo/norma.ts) y la puntuación (lib/seo/puntuacion.ts) y lo reparte por campo: debajo del título, lo del título (norma, orden, palabras
 * y búsquedas que faltan); debajo de las viñetas, lo de las viñetas y lo que no está en ninguna parte; debajo del backend, lo del backend y el sitio que queda. Se
 * recalcula con cada tecla: así se ve al momento si lo que se escribe arregla o estropea algo.
 */

import { bytesDe, LIMITE_BACKEND_BYTES, type TextosDeFicha } from './cobertura'
import { revisarFicha } from './norma'
import type { PuntuacionDeListing } from './puntuacion'

export type CampoDiagnosticado = 'titulo' | 'highlights' | 'bullets' | 'backend'
export type TonoDeAviso = 'bien' | 'aviso' | 'mal'

export interface AvisoDeCampo {
  texto: string
  tono: TonoDeAviso
}

const lista = (xs: string[], n = 5) => xs.slice(0, n).map((x) => `«${x}»`).join(', ') + (xs.length > n ? ` y ${xs.length - n} más` : '')

export function avisosPorCampo(f: TextosDeFicha, p: PuntuacionDeListing): Record<CampoDiagnosticado, AvisoDeCampo[]> {
  const salida: Record<CampoDiagnosticado, AvisoDeCampo[]> = { titulo: [], highlights: [], bullets: [], backend: [] }
  for (const i of revisarFicha(f).incidencias) {
    const campo = i.campo as CampoDiagnosticado
    if (salida[campo]) salida[campo].push({ texto: i.accion ? `${i.resumen[0].toUpperCase()}${i.resumen.slice(1)}. ${i.accion}` : i.resumen, tono: i.gravedad === 'grave' ? 'mal' : 'aviso' })
  }

  // Título: el orden, las palabras que más venden que no están y las búsquedas principales que faltan
  const orden = p.bloques.find((b) => b.id === 'orden')
  if (orden?.medible && orden.siguiente) salida.titulo.push({ texto: orden.siguiente, tono: 'aviso' })
  const faltanEnTitulo = p.palabras.slice(0, 6).filter((x) => x.donde !== 'titulo' && x.donde !== 'highlights').map((x) => x.palabra)
  if (faltanEnTitulo.length) salida.titulo.push({ texto: `De las palabras que más venden, no están en el título: ${lista(faltanEnTitulo)}.`, tono: 'aviso' })
  const busquedasFuera = p.busquedas.slice(0, 5).filter((b) => !b.enTitulo).map((b) => b.consulta)
  if (busquedasFuera.length) salida.titulo.push({ texto: `Búsquedas principales que no están enteras en el título ni en los highlights: ${lista(busquedasFuera, 3)}.`, tono: 'aviso' })
  if (!salida.titulo.length && f.titulo?.trim()) salida.titulo.push({ texto: 'Título dentro de norma, en orden y con las búsquedas que más venden.', tono: 'bien' })

  // Highlights
  if (!f.highlights?.trim()) salida.highlights.push({ texto: 'Vacío: aquí va lo que no cabe en el título (formato, cantidad, material). Se indexa igual que el título.', tono: 'aviso' })
  else if (!salida.highlights.length) salida.highlights.push({ texto: 'Bien.', tono: 'bien' })

  // Viñetas: lo que no está en NINGUNA parte de la ficha
  const enNingunSitio = p.palabras.filter((x) => !x.donde).map((x) => x.palabra)
  if (enNingunSitio.length) salida.bullets.push({ texto: `Palabras que venden y no están en ninguna parte de la ficha: ${lista(enNingunSitio)}. Mételas en una viñeta o en el backend.`, tono: 'aviso' })
  if (!salida.bullets.length) salida.bullets.push({ texto: 'Bien.', tono: 'bien' })

  // Backend: el sitio que queda
  const bytes = bytesDe(f.backend ?? '')
  if (bytes <= LIMITE_BACKEND_BYTES && bytes < 180) salida.backend.push({ texto: `Quedan ${LIMITE_BACKEND_BYTES - bytes} bytes libres: sinónimos, plurales y búsquedas que no caben arriba.`, tono: 'aviso' })
  if (!salida.backend.length) salida.backend.push({ texto: `Bien (${LIMITE_BACKEND_BYTES - bytes} bytes libres).`, tono: 'bien' })
  return salida
}
