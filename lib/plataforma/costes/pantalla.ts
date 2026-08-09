/**
 * PLATAFORMA · A5 — LO QUE LEEN LAS PANTALLAS
 * ===========================================
 * SOLO SERVIDOR.
 *
 * Junta el catálogo, los costes vigentes y el veredicto de completitud en las
 * tres vistas que hacen falta: la tabla de costes, la cobertura y la ficha de un
 * SKU. Aquí no se decide nada: el juicio lo ponen las funciones puras de
 * completitud.ts y vigencia.ts, y este fichero solo va a buscar los datos y los
 * junta.
 *
 * LO QUE CUESTA LA TABLA, ESCRITO PARA QUE NADIE SE LO ENCUENTRE DE SORPRESA:
 * se trae el catálogo entero del cliente y su histórico de costes, y filtra y
 * pagina en memoria. En ShoesF son 13.700 listings y unos cuantos miles de
 * tramos: alrededor de veinte viajes a la base y menos de dos megas. Se hace así
 * porque los filtros que de verdad se usan —«enséñame los que NO tienen coste» y
 * «los que lo tienen incompleto»— no se pueden expresar en PostgREST sin un JOIN
 * lateral con el tramo vigente, que es justo lo que la función SQL de cobertura
 * hace para contar. Para CONTAR se usa Postgres; para LISTAR, esto. Si algún día
 * un cliente pasa de treinta mil referencias, lo que hay que escribir es una
 * segunda función SQL que devuelva la página, no cambiar el juicio de sitio.
 */

import { marketplaceById } from '@/lib/types/amazon'
import {
  clasificarCobertura,
  evaluarCosteEnCanales,
  exigenciasDe,
  type EstadoCoste,
  type ResumenCobertura,
} from './completitud'
import {
  coberturaDeCostes,
  costesDeCliente,
  listingsDeCliente,
  politicaDe,
  tramosDeSku,
  auditoriaDeSku,
  type ListingCoste,
} from './datos'
import {
  canalDeListing,
  type CanalCoste,
  type CosteA5,
  type FiltroEstado,
  type PoliticaCostes,
} from './tipos'
import {
  costesVigentesPorSku,
  estadoVigencia,
  hoyIso,
  porQueCaducado,
  type EstadoVigencia,
} from './vigencia'

/* ------------------------------------------------------------------ */
/* La tabla de costes                                                  */
/* ------------------------------------------------------------------ */

/**
 * El filtro se ha mudado a tipos.ts, que es un módulo puro.
 *
 * Aquí se re-exporta porque la ruta de API lo importa de este fichero desde el
 * primer día y no hay ninguna razón para hacerle cambiar el `import`. La
 * mudanza tiene motivo: la PANTALLA necesita las etiquetas, y este fichero
 * arrastra datos.ts y con él el cliente de `service_role`.
 */
export { FILTRO_ESTADO_LABELS } from './tipos'
export type { FiltroEstado } from './tipos'

export interface ConsultaCostes {
  clientId: string
  texto?: string
  estado?: FiltroEstado
  marketplaceId?: string
  soloSeguimiento?: boolean
  /** La fecha en la que se mira. Por defecto hoy: el margen de marzo se calcula
      con el coste de marzo, así que la fecha tiene que poder cambiarse */
  fecha?: string
  pagina?: number
}

export interface FilaCoste {
  sku: string
  asin: string | null
  titulo: string | null
  /** Los canales por los que se vende este SKU. Dos cuando está en FBA en un
      país y sale de nuestro almacén en otro */
  canales: CanalCoste[]
  marketplaces: string[]
  enSeguimiento: boolean

  /** El tramo vigente en la fecha consultada. null = no hay ninguno */
  coste: CosteA5 | null
  /** Cuántos tramos tiene en total, para saber si hay histórico que mirar */
  tramos: number

  estado: EstadoCoste
  /** Qué patas faltan, en castellano */
  faltan: string[]
  /** El coste unitario total. null siempre que el estado no sea 'completo' */
  total: number | null
  moneda: string | null
  motivo: string

  vigencia: EstadoVigencia
  dias: number | null
  vigenciaMotivo: string
}

export const LIMITE_TABLA = 200

export interface VistaCostes {
  filas: FilaCoste[]
  /** Cuántas cumplen el filtro en total; `filas` es una página */
  total: number
  /** Recuento por estado sobre el catálogo entero, no sobre la página */
  porEstado: Record<EstadoCoste, number>
  caducados: number
  politica: PoliticaCostes
  fecha: string
  limite: number
  /** El catálogo está vacío: no es lo mismo que «sin costes» */
  catalogoVacio: boolean
}

export async function tablaDeCostes(consulta: ConsultaCostes): Promise<VistaCostes> {
  const fecha = consulta.fecha ?? hoyIso()
  const politica = await politicaDe(consulta.clientId)
  const exigencias = exigenciasDe(politica)

  const listings = await listingsDeCliente(consulta.clientId)
  const costes = await costesDeCliente(consulta.clientId)
  const vigentes = costesVigentesPorSku(costes, fecha)

  const tramosPorSku = new Map<string, number>()
  for (const coste of costes) tramosPorSku.set(coste.sku, (tramosPorSku.get(coste.sku) ?? 0) + 1)

  const filas = agrupar(listings, consulta.marketplaceId).map((grupo) => {
    const vigente = (vigentes.get(grupo.sku) as CosteA5 | undefined) ?? null
    const veredicto = evaluarCosteEnCanales(vigente, grupo.canales, exigencias)
    const { estado: vigenciaEstado, dias } = estadoVigencia(vigente, fecha, politica.dias_caducidad)

    return {
      sku: grupo.sku,
      asin: grupo.asin,
      titulo: grupo.titulo,
      canales: grupo.canales,
      marketplaces: grupo.marketplaces,
      enSeguimiento: grupo.enSeguimiento,
      coste: vigente,
      tramos: tramosPorSku.get(grupo.sku) ?? 0,
      estado: veredicto.estado,
      faltan: veredicto.faltan.map((f) => f.etiqueta),
      total: veredicto.total,
      moneda: veredicto.moneda,
      motivo: veredicto.motivo,
      vigencia: vigenciaEstado,
      dias,
      vigenciaMotivo: porQueCaducado(vigenciaEstado, dias, politica.dias_caducidad),
    } satisfies FilaCoste
  })

  const porEstado: Record<EstadoCoste, number> = { sin_coste: 0, incompleto: 0, completo: 0 }
  let caducados = 0
  for (const fila of filas) {
    porEstado[fila.estado] += 1
    if (fila.vigencia === 'caducado') caducados += 1
  }

  const texto = (consulta.texto ?? '').trim().toLowerCase()
  const estado = consulta.estado ?? 'todos'

  const filtradas = filas.filter((fila) => {
    if (consulta.soloSeguimiento && !fila.enSeguimiento) return false
    if (estado === 'caducado' && fila.vigencia !== 'caducado') return false
    if (estado !== 'todos' && estado !== 'caducado' && fila.estado !== estado) return false
    if (!texto) return true
    return (
      fila.sku.toLowerCase().includes(texto) ||
      (fila.asin ?? '').toLowerCase().includes(texto) ||
      (fila.titulo ?? '').toLowerCase().includes(texto)
    )
  })

  // Orden estable y sin `localeCompare`: tiene que dar lo mismo en el servidor y
  // en cualquier máquina, sin depender del locale instalado.
  filtradas.sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0))

  const pagina = Math.max(0, consulta.pagina ?? 0)
  return {
    filas: filtradas.slice(pagina * LIMITE_TABLA, (pagina + 1) * LIMITE_TABLA),
    total: filtradas.length,
    porEstado,
    caducados,
    politica,
    fecha,
    limite: LIMITE_TABLA,
    catalogoVacio: listings.length === 0,
  }
}

/** Un SKU, con todo lo que sabemos de él en los distintos marketplaces */
interface SkuAgrupado {
  sku: string
  asin: string | null
  titulo: string | null
  canales: CanalCoste[]
  marketplaces: string[]
  enSeguimiento: boolean
}

/**
 * De listings (uno por conexión, marketplace y SKU) a SKU.
 *
 * EL COSTE ES POR SKU Y NO POR PAÍS, y esa es la razón de este agrupado: lo que
 * costó comprar una unidad no cambia porque se venda en Francia. El CANAL sí
 * cambia —un SKU puede estar en FBA en España y salir de nuestro almacén en
 * Francia—, así que se conservan los dos y el veredicto los exige los dos.
 */
function agrupar(listings: ListingCoste[], marketplaceId?: string): SkuAgrupado[] {
  const porSku = new Map<string, SkuAgrupado>()

  for (const listing of listings) {
    if (marketplaceId && listing.marketplace_id !== marketplaceId) continue

    const canal = canalDeListing(listing)
    const activo = listing.activo_manual ?? listing.activo_calculado
    const pais = marketplaceById(listing.marketplace_id)?.label ?? listing.marketplace_id

    const previo = porSku.get(listing.sku)
    if (!previo) {
      porSku.set(listing.sku, {
        sku: listing.sku,
        asin: listing.asin,
        titulo: listing.title,
        canales: [canal],
        marketplaces: [pais],
        enSeguimiento: activo,
      })
      continue
    }

    if (!previo.canales.includes(canal)) previo.canales.push(canal)
    if (!previo.marketplaces.includes(pais)) previo.marketplaces.push(pais)
    // En seguimiento en CUALQUIER país cuenta como en seguimiento: si se refresca
    // en alguno, su coste hace falta.
    if (activo) previo.enSeguimiento = true
    if (!previo.asin && listing.asin) previo.asin = listing.asin
    if (!previo.titulo && listing.title) previo.titulo = listing.title
  }

  return [...porSku.values()]
}

/* ------------------------------------------------------------------ */
/* La cobertura                                                        */
/* ------------------------------------------------------------------ */

export interface VistaCobertura {
  unidades: Array<ResumenCobertura & { pais: string }>
  politica: PoliticaCostes
  fecha: string
  /** Divisas distintas que han entrado, de todas las unidades juntas */
  monedas: string[]
}

/**
 * La cobertura de costes de un cliente.
 *
 * Cuenta en Postgres y JUZGA aquí, con la misma función que juzga un coste
 * suelto. Ver la migración 126.
 */
export async function coberturaDe(clientId: string, fecha?: string): Promise<VistaCobertura> {
  const dia = fecha ?? hoyIso()
  const politica = await politicaDe(clientId)
  const exigencias = exigenciasDe(politica)
  const filas = await coberturaDeCostes(clientId, dia)

  const monedas = new Set<string>()
  for (const fila of filas) for (const moneda of fila.monedas) monedas.add(moneda)

  return {
    unidades: filas.map((fila) => ({
      ...clasificarCobertura(fila, exigencias),
      pais: marketplaceById(fila.marketplace_id)?.label ?? fila.marketplace_id,
    })),
    politica,
    fecha: dia,
    monedas: [...monedas].sort(),
  }
}

/* ------------------------------------------------------------------ */
/* La ficha de un SKU                                                  */
/* ------------------------------------------------------------------ */

export interface FichaCoste {
  sku: string
  canales: CanalCoste[]
  marketplaces: string[]
  /** Todos los tramos, del más nuevo al más antiguo */
  tramos: CosteA5[]
  /** Qué se está aplicando hoy y qué le falta */
  vigente: FilaCoste | null
  /** Quién tocó qué y cuándo */
  auditoria: Awaited<ReturnType<typeof auditoriaDeSku>>
  politica: PoliticaCostes
  fecha: string
}

/**
 * Todo lo que se sabe del coste de UN SKU.
 *
 * El `clientId` va en todas las consultas y no solo en la primera: el SKU viaja
 * desde el navegador, y un SKU de otro cliente devolvería los costes de otra
 * tienda. Es la misma comprobación que hace la ficha de SKU de A1.
 */
export async function fichaDeSku(
  clientId: string,
  sku: string,
  fecha?: string
): Promise<FichaCoste> {
  const dia = fecha ?? hoyIso()
  const politica = await politicaDe(clientId)
  const exigencias = exigenciasDe(politica)

  const listings = (await listingsDeCliente(clientId)).filter((l) => l.sku === sku)
  const tramos = await tramosDeSku(clientId, sku)
  const auditoria = await auditoriaDeSku(clientId, sku)

  const grupo = agrupar(listings)[0] ?? null
  const canales = grupo?.canales ?? []
  const vigenteFila = (costesVigentesPorSku(tramos, dia).get(sku) as CosteA5 | undefined) ?? null
  const veredicto = evaluarCosteEnCanales(vigenteFila, canales, exigencias)
  const { estado: vigenciaEstado, dias } = estadoVigencia(vigenteFila, dia, politica.dias_caducidad)

  return {
    sku,
    canales,
    marketplaces: grupo?.marketplaces ?? [],
    tramos,
    vigente: grupo
      ? {
          sku,
          asin: grupo.asin,
          titulo: grupo.titulo,
          canales,
          marketplaces: grupo.marketplaces,
          enSeguimiento: grupo.enSeguimiento,
          coste: vigenteFila,
          tramos: tramos.length,
          estado: veredicto.estado,
          faltan: veredicto.faltan.map((f) => f.etiqueta),
          total: veredicto.total,
          moneda: veredicto.moneda,
          motivo: veredicto.motivo,
          vigencia: vigenciaEstado,
          dias,
          vigenciaMotivo: porQueCaducado(vigenciaEstado, dias, politica.dias_caducidad),
        }
      : null,
    auditoria,
    politica,
    fecha: dia,
  }
}
