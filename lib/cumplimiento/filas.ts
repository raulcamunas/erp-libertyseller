import type { ListingConIncidencias } from '@/lib/amazon/sp-api'
import {
  conservarDesde,
  normalizarIncidencias,
  ordenarIncidencias,
  problemaMasAntiguo,
  resumir,
} from './incidencias'
import { clave } from './pendientes'
import type { Incidencia } from './tipos'

/**
 * DE LO QUE CONTESTA AMAZON A LAS FILAS QUE SE GUARDAN.
 * PURO: sin red ni base de datos; la hora llega de fuera. Se prueba en
 * filas.prueba.ts, incluido que cada columna que escribe existe en la migración 227.
 *
 * Es la mitad de la revisión que se puede equivocar sin que nadie lo vea: si aquí
 * un error se cuenta como aviso, o un listing oculto sale como limpio, la pantalla
 * enseña un dato falso con muy buen aspecto.
 */

/** Lo que se sabe de un listing por el catálogo del ERP, antes de preguntarle a Amazon */
export interface MetaListing {
  conStock: boolean
  esPadre: boolean
  /** Su fila de cumplimiento, si ya se revisó */
  id: string | null
  /** Tenía errores u ocultación: hay que traer sus incidencias para conservar el «desde» */
  abierto: boolean
}

export type Fila = Record<string, unknown>

export function construirFilas(args: {
  connectionId: string
  mercado: string
  items: readonly ListingConIncidencias[]
  noVinieron: readonly string[]
  meta: ReadonlyMap<string, MetaListing>
  /** Las incidencias de la revisión anterior, por SKU */
  previas: ReadonlyMap<string, readonly Incidencia[]>
  ahora: Date
}): { devueltos: Fila[]; ausentes: Fila[]; sinCampo: number } {
  const { connectionId, mercado, meta, previas, ahora } = args
  const ahoraIso = ahora.toISOString()
  let sinCampo = 0

  const devueltos: Fila[] = []
  for (const it of args.items) {
    const m = meta.get(clave(mercado, it.sku))
    // Amazon ha devuelto un SKU que no se pidió: no se inventa una fila para él
    if (!m) continue
    if (it.incidencias === undefined) sinCampo += 1

    const nuevas = normalizarIncidencias(it.incidencias)
    const incidencias = ordenarIncidencias(conservarDesde(nuevas, previas.get(it.sku) ?? [], ahoraIso), ahora)
    const r = resumir(incidencias, ahora)
    devueltos.push({
      connection_id: connectionId,
      marketplace_id: mercado,
      sku: it.sku,
      asin: it.asin,
      titulo: it.titulo,
      estado: it.estado,
      en_amazon: true,
      es_padre: m.esPadre,
      con_stock: m.conStock,
      errores: r.errores,
      avisos: r.avisos,
      suprimido: r.suprimido,
      tema: r.tema,
      temas: r.temas,
      desde: problemaMasAntiguo(incidencias),
      incidencias,
      revisado_at: ahoraIso,
    })
  }

  // Los que Amazon no devolvió, en una escritura aparte y SIN asin ni título: en
  // un upsert las columnas que faltan en el cuerpo se dejan como están, y
  // mandarlas a null borraría lo que se supo la última vez que existió.
  const ausentes: Fila[] = args.noVinieron.map((sku) => ({
    connection_id: connectionId,
    marketplace_id: mercado,
    sku,
    estado: [],
    en_amazon: false,
    es_padre: meta.get(clave(mercado, sku))?.esPadre ?? false,
    con_stock: meta.get(clave(mercado, sku))?.conStock ?? false,
    errores: 0,
    avisos: 0,
    suprimido: false,
    tema: null,
    temas: [],
    desde: null,
    incidencias: [],
    revisado_at: ahoraIso,
  }))

  return { devueltos, ausentes, sinCampo }
}
