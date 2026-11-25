/**
 * CUMPLIMIENTO · LO QUE IMPIDE VENDER. PURO (se prueba en bloqueos.prueba.ts).
 *
 * El objetivo del módulo (Raúl, 25 nov 2026): que la mayor parte de los listings que se pueden vender estén ACTIVOS. Aquí solo entra lo que de verdad deja un listing
 * sin vender o a punto de dejarlo, agrupado por lo que hay que hacer, y con stock delante:
 *   · PRECIO: oculto por un error de precio (por debajo del mínimo, por encima del máximo, «posible error de precio»). Se arregla desde el ERP.
 *   · SEGURIDAD Y DOCUMENTACIÓN: retirado o en riesgo por seguridad del producto, GPSR (fabricante, persona responsable, advertencias), RAP o documentos que pide Amazon.
 *   · POLÍTICA Y MARCA: retirado del catálogo, uso indebido de marca, propiedad intelectual, producto restringido o pendiente de aprobación.
 *   · EN PAUSA: ofertas paradas por Amazon (cancelaciones…), que se reactivan confirmándolas.
 *   · FICHA: oculto por la imagen principal, un dato obligatorio o los códigos de barras. Va al final: importa, pero es lo de menos.
 * Lo que solo es un aviso (sin ocultar nada y sin plazo) NO entra: está en las pestañas de siempre.
 *
 * «Bloquea» = alguna incidencia lo oculta ahora (nivel 'bloquea' de lib/cumplimiento/acciones.ts) o el listing está suprimido. «En riesgo» = normativa con plazo
 * (exención vigente o fecha en el mensaje): todavía se vende, pero Amazon lo retirará si no se arregla.
 */

import { ACCIONES, clasificar, plazoDe, type IdAccion } from './acciones'
import type { FilaCumplimiento, Incidencia } from './tipos'

export type GrupoDeBloqueo = 'precio' | 'seguridad' | 'politica' | 'pausa' | 'ficha'

export const GRUPOS: ReadonlyArray<{ id: GrupoDeBloqueo; titulo: string; porque: string }> = [
  { id: 'precio', titulo: 'Errores de precio', porque: 'Amazon ha ocultado la oferta porque el precio está fuera de los límites o le parece un error. Se arregla desde aquí: cambiando el precio o ajustando el límite.' },
  { id: 'seguridad', titulo: 'Seguridad del producto, GPSR y documentación', porque: 'Retirados o a punto de retirarse por seguridad del producto, la información del GPSR (fabricante, persona responsable, advertencias), la RAP o documentos que pide Amazon.' },
  { id: 'politica', titulo: 'Retirados por política, marca o aprobación', porque: 'Amazon los ha sacado del catálogo: uso indebido de marca, propiedad intelectual, producto restringido o pendiente de aprobación.' },
  { id: 'pausa', titulo: 'Ofertas en pausa', porque: 'Amazon ha parado la oferta (por cancelaciones u otra métrica). Se reactiva confirmándola en Seller Central.' },
  { id: 'ficha', titulo: 'Ocultos por la ficha', porque: 'Imagen principal, un dato obligatorio o los códigos de barras. Importa, pero va después de lo anterior.' },
]

const GRUPO_DE_ACCION: Partial<Record<IdAccion, GrupoDeBloqueo>> = {
  precio: 'precio',
  rap: 'seguridad',
  'gpsr-responsable': 'seguridad',
  'gpsr-seguridad': 'seguridad',
  'documento-cumplimiento': 'seguridad',
  'etiqueta-energetica': 'seguridad',
  'ley-de-datos': 'seguridad',
  'equipos-radio': 'seguridad',
  'info-alimentaria': 'seguridad',
  'seguridad-retirada': 'seguridad',
  'normativa-otros': 'seguridad',
  peligrosas: 'seguridad',
  'aprobacion-marca': 'politica',
  restringido: 'politica',
  transparency: 'politica',
  'propiedad-intelectual': 'politica',
  'texto-retirado': 'politica',
  marca: 'politica',
  'oferta-en-pausa': 'pausa',
}

/** Los códigos de Amazon de error de precio (medidos en las cuentas el 25 nov 2026): por si llegan sin el tema «precio» */
export const CODIGOS_DE_PRECIO: ReadonlySet<string> = new Set(['18155', '19038', '18555', '18701', '18639', '100019'])

/** Un plazo de Amazon más lejano que esto no es urgente */
export const DIAS_DE_RIESGO = 60

const ORDEN: Record<GrupoDeBloqueo, number> = { precio: 0, seguridad: 1, politica: 2, pausa: 3, ficha: 4 }

export interface ListingBloqueado {
  sku: string
  asin: string | null
  titulo: string | null
  mercado: string
  conStock: boolean
  grupo: GrupoDeBloqueo
  /** true = ya no se vende; false = se vende, pero con plazo para arreglarlo */
  bloquea: boolean
  accion: IdAccion
  /** Lo que hay que hacer, en corto */
  queHacer: string
  /** El mensaje de Amazon de la incidencia que manda */
  mensaje: string
  codigo: string
  /** Plazo que da Amazon (ISO), si lo hay */
  plazo: string | null
  /** Desde cuándo está así */
  desde: string | null
}

function grupoDe(i: Pick<Incidencia, 'codigo'>, accion: IdAccion): GrupoDeBloqueo {
  if (CODIGOS_DE_PRECIO.has(i.codigo)) return 'precio'
  return GRUPO_DE_ACCION[accion] ?? 'ficha'
}

/** Lo que importa de un listing para esta vista, o null si nada le impide vender */
export function bloqueoDe(f: Pick<FilaCumplimiento, 'sku' | 'asin' | 'titulo' | 'marketplace_id' | 'con_stock' | 'suprimido' | 'incidencias' | 'es_padre'>, ahora: Date): ListingBloqueado | null {
  if (f.es_padre) return null
  let mejor: { i: Incidencia; accion: IdAccion; grupo: GrupoDeBloqueo; bloquea: boolean; plazo: string | null } | null = null
  for (const i of f.incidencias ?? []) {
    const { nivel, accion } = clasificar(i, ahora)
    const plazo = i.exencion?.caduca ?? plazoDe(i.mensaje)
    const bloquea = nivel === 'bloquea'
    // En riesgo: normativa con un plazo FUTURO y cercano. Los plazos ya pasados sin que Amazon haya retirado nada (miles de avisos de la RAP) no son un problema de hoy
    const t = plazo ? Date.parse(plazo) : NaN
    const enRiesgo = !bloquea && nivel === 'normativa' && Number.isFinite(t) && t > ahora.getTime() && t - ahora.getTime() < DIAS_DE_RIESGO * 86_400_000
    if (!bloquea && !enRiesgo) continue
    const grupo = grupoDe(i, accion)
    const candidato = { i, accion, grupo, bloquea, plazo }
    if (!mejor || Number(bloquea) > Number(mejor.bloquea) || (bloquea === mejor.bloquea && ORDEN[grupo] < ORDEN[mejor.grupo])) mejor = candidato
  }
  if (!mejor) return null
  return {
    sku: f.sku,
    asin: f.asin,
    titulo: f.titulo,
    mercado: f.marketplace_id,
    conStock: f.con_stock,
    grupo: mejor.grupo,
    bloquea: mejor.bloquea,
    accion: mejor.accion,
    queHacer: ACCIONES[mejor.accion]?.titulo ?? 'Revisar en Seller Central',
    mensaje: mejor.i.mensaje,
    codigo: mejor.i.codigo,
    plazo: mejor.plazo,
    desde: mejor.i.desde ?? null,
  }
}

export interface ResumenDeBloqueos {
  /** Listings con stock que se pueden comprar ahora (de los revisados con stock) */
  conStock: number
  conStockVendibles: number
  porGrupo: Record<GrupoDeBloqueo, { bloqueados: number; conStock: number; enRiesgo: number }>
  listings: ListingBloqueado[]
}

/**
 * Todos los bloqueos de un cliente: con stock delante, los que ya no se venden antes que los que están en riesgo, y dentro, los más antiguos primero.
 * @param conStockTotal cuántos listings con stock hay (para el porcentaje de vendibles)
 */
export function resumirBloqueos(filas: ReadonlyArray<Parameters<typeof bloqueoDe>[0]>, conStockTotal: number, ahora: Date): ResumenDeBloqueos {
  const listings = filas.map((f) => bloqueoDe(f, ahora)).filter((x): x is ListingBloqueado => x !== null)
  listings.sort((a, b) => ORDEN[a.grupo] - ORDEN[b.grupo] || Number(b.conStock) - Number(a.conStock) || Number(b.bloquea) - Number(a.bloquea) || (a.desde ?? '').localeCompare(b.desde ?? ''))
  const porGrupo = Object.fromEntries(GRUPOS.map((g) => [g.id, { bloqueados: 0, conStock: 0, enRiesgo: 0 }])) as ResumenDeBloqueos['porGrupo']
  for (const l of listings) {
    const g = porGrupo[l.grupo]
    if (l.bloquea) g.bloqueados++
    else g.enRiesgo++
    if (l.conStock && l.bloquea) g.conStock++
  }
  const bloqueadosConStock = listings.filter((l) => l.bloquea && l.conStock).length
  return { conStock: conStockTotal, conStockVendibles: Math.max(0, conStockTotal - bloqueadosConStock), porGrupo, listings }
}
