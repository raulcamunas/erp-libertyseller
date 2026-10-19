import { TRAMOS_EDAD, type IdTramo, type InventarioDeCliente, type SkuInventario } from './inventario'
import { TRAMOS_MAS_DE_90, type IdTramoAmazon } from './planificacion'

/**
 * LA ANTIGÜEDAD DEL STOCK DE UN CLIENTE, COMO UNA LISTA DE TRAMOS CON SUS PRODUCTOS.
 * =================================================================================
 * PURO. Se comprueba con antiguedad.prueba.ts. Lo usan la tarjeta del panel —que al pulsar un
 * tramo enseña qué productos lo forman— y el Excel de antigüedad.
 *
 * Hay DOS fuentes de edad y el panel enseña la mejor que tenga:
 *
 *   · `amazon`  la del informe de planificación de Amazon (lib/fba/planificacion.ts): la edad real,
 *               con los siete tramos de Seller Central.
 *   · `libro`   la estimada con el libro mayor (FIFO, lib/fba/inventario.ts), mientras Amazon no ha
 *               dado la suya: cinco tramos más «anterior al libro».
 *
 * Esta función las pone en la misma forma —tramos, y para cada producto cuántas unidades tiene
 * en cada uno— para que quien las pinta no tenga que saber de cuál viene.
 */

export type FuenteEdad = 'amazon' | 'libro'

/** Los tramos de la edad de Amazon y los de la estimada del libro, más el cajón de lo que no tiene edad */
export type IdTramoInforme = IdTramoAmazon | IdTramo | 'anterior'

export interface TramoDeAntiguedad {
  id: IdTramoInforme
  texto: string
  unidades: number
  /** Las unidades a precio de venta. Solo cuentan los productos que tienen precio */
  valor: number
  /** Lo que cuesta guardarlas al mes. null = no se sabe */
  coste: number | null
  /** De más de 90 días: lo que Seller Central llama inventario antiguo */
  antiguo: boolean
}

export interface InformeDeAntiguedad {
  fuente: FuenteEdad
  /** El día de la foto de Amazon, o el último día leído del libro */
  fecha: string | null
  tramos: TramoDeAntiguedad[]
  unidades: number
  /** Lo que Amazon calcula que costará guardar todo el stock el mes que viene. Solo con la fuente `amazon` */
  costeMes: number | null
  recargoMes: number | null
  moneda: string | null
}

export function informeDeAntiguedad(d: InventarioDeCliente, opciones: { costeDe?: (unidades: number) => number } = {}): InformeDeAntiguedad {
  const ea = d.edadAmazon
  if (ea) {
    const tramos: TramoDeAntiguedad[] = ea.tramos.map((t) => ({
      id: t.id,
      texto: t.texto,
      unidades: t.unidades,
      valor: t.valor,
      coste: t.coste,
      antiguo: TRAMOS_MAS_DE_90.includes(t.id),
    }))
    return { fuente: 'amazon', fecha: ea.fecha, tramos, unidades: ea.unidades, costeMes: ea.costeMes, recargoMes: ea.recargoMes, moneda: ea.moneda }
  }

  const r = d.resumen
  const tramos: TramoDeAntiguedad[] = TRAMOS_EDAD.map((t) => ({
    id: t.id,
    texto: t.texto,
    unidades: r.porTramo[t.id],
    valor: r.valorPorTramo[t.id],
    coste: opciones.costeDe ? opciones.costeDe(r.porTramo[t.id]) : null,
    antiguo: t.desde >= 91,
  }))
  if (r.anteriorALaLectura > 0) {
    tramos.push({
      id: 'anterior',
      texto: d.libro === 'sin_leer' ? 'Edad desconocida (sin libro mayor)' : `Anterior al libro${d.diasDeLibro !== null ? ` (más de ${d.diasDeLibro} d)` : ''}`,
      unidades: r.anteriorALaLectura,
      valor: 0,
      coste: opciones.costeDe ? opciones.costeDe(r.anteriorALaLectura) : null,
      antiguo: false,
    })
  }
  return {
    fuente: 'libro',
    fecha: d.leidoHasta,
    tramos,
    unidades: tramos.reduce((s, t) => s + t.unidades, 0),
    costeMes: null,
    recargoMes: null,
    moneda: null,
  }
}

/** Cuántas unidades de este producto hay en ese tramo */
export function unidadesEnTramo(s: SkuInventario, informe: Pick<InformeDeAntiguedad, 'fuente'>, id: IdTramoInforme): number {
  if (informe.fuente === 'amazon') return s.edadAmazon?.edad[id as IdTramoAmazon] ?? 0
  if (id === 'anterior') return s.anteriorALaLectura
  return s.porTramo[id as IdTramo] ?? 0
}

export interface ProductoDeTramo {
  sku: SkuInventario
  unidades: number
  /** Esas unidades a precio de venta. null si el producto no tiene precio */
  valor: number | null
  /** Lo que cuesta guardarlas al mes. null si no se sabe */
  coste: number | null
}

/**
 * Los productos que tienen unidades en un tramo: primero los que más, y a igualdad los que más
 * valen. Un producto con unidades en dos tramos sale en los dos, con las de cada uno.
 */
export function productosDeTramo(skus: SkuInventario[], informe: Pick<InformeDeAntiguedad, 'fuente'>, id: IdTramoInforme): ProductoDeTramo[] {
  const lista: ProductoDeTramo[] = []
  for (const sku of skus) {
    const unidades = unidadesEnTramo(sku, informe, id)
    if (unidades <= 0) continue
    lista.push({
      sku,
      unidades,
      valor: sku.precio === null ? null : Math.round(unidades * sku.precio * 100) / 100,
      coste: informe.fuente === 'amazon' ? (sku.edadAmazon?.costePorTramo?.[id as IdTramoAmazon] ?? null) : null,
    })
  }
  return lista.sort((a, b) => b.unidades - a.unidades || (b.valor ?? 0) - (a.valor ?? 0) || a.sku.sku.localeCompare(b.sku.sku))
}

/** El tramo con ese id, o null si el informe no lo tiene (por ejemplo, tras cambiar de cliente) */
export const tramoDelInforme = (informe: InformeDeAntiguedad, id: string | null): TramoDeAntiguedad | null =>
  id === null ? null : (informe.tramos.find((t) => t.id === id) ?? null)

/** Texto para decir qué es la fuente: «según Amazon» o «estimada con el libro mayor» */
export const nombreDeFuente = (f: FuenteEdad): string => (f === 'amazon' ? 'según Amazon' : 'estimada con el libro mayor')
