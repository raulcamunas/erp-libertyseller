/**
 * PLATAFORMA · EL EFECTO DE UN CRITERIO, ANTES DE GUARDARLO
 * =========================================================
 * SOLO SERVIDOR: importa el cliente de service_role.
 *
 *
 * QUÉ PROBLEMA RESUELVE
 * ---------------------
 * El criterio de «SKU en seguimiento» son trece interruptores y tres listas. Con
 * un catálogo de 13.700 referencias delante, cambiar uno y guardar es configurar
 * a ciegas: nadie puede prever de cabeza cuántas referencias entran o salen al
 * encender «todo lo de FBM» o al bajar el tope de 2.000 a 800.
 *
 * Y equivocarse cuesta caro en los dos sentidos, que es lo que hace que esto
 * exista:
 *
 *   · DEMASIADO ANCHO revienta el cupo de Amazon de esa cuenta, que se cuenta
 *     por vendedor. La ventana nocturna se llena y los demás trabajos no entran.
 *   · DEMASIADO ESTRECHO deja referencias sin histórico, y EL HISTÓRICO NO SE
 *     RECUPERA HACIA ATRÁS: el ranking de un día que no se guardó se perdió.
 *
 * Así que esta función contesta, sobre el catálogo de verdad y sin escribir ni
 * una fila: cuántas entran, cuántas salen, cuántas se quedan igual, y POR QUÉ se
 * cae cada grupo.
 *
 *
 * NO ESCRIBE NADA. NUNCA.
 * -----------------------
 * Es la diferencia entera con lib/plataforma/tareas/recalcular-activos.ts, que
 * hace este mismo cálculo y además lo escribe en amazon_listings. Aquí se lee, se
 * decide en memoria y se devuelve el resultado. Por eso se puede pulsar las veces
 * que haga falta mientras se afina el criterio: no gasta ni una llamada a Amazon
 * ni deja rastro en el catálogo.
 *
 *
 * EL DIFF SE MIDE CONTRA EL VALOR EFECTIVO, NO CONTRA activo_calculado
 * -------------------------------------------------------------------
 * Lo que hoy está en seguimiento es COALESCE(activo_manual, activo_calculado).
 * Comparar contra `activo_calculado` a secas contaría como «entra» un SKU que ya
 * estaba dentro porque una persona lo puso, y como «sale» uno que va a seguir
 * dentro por lo mismo. El aviso más caro de una pantalla de configuración es el
 * que cuenta movimientos que no van a ocurrir.
 *
 *
 * EL TOPE ES POR UNIDAD DE TRABAJO, Y POR ESO ESTE CÁLCULO TAMBIÉN
 * ---------------------------------------------------------------
 * `recalcular_activos` procesa una unidad (conexión × marketplace) por lote
 * entero, precisamente porque un tope no se puede aplicar por trozos. Aquí se
 * respeta el mismo grano: cada unidad se resuelve completa y con su propio tope,
 * y los totales son la suma. Simular las cuatro unidades de un cliente como si
 * fueran una sola daría un recorte distinto del que va a pasar de verdad.
 */

import { createServiceClient } from '@/lib/supabase/service'
import {
  describirCriterio,
  resolverActivos,
  type CandidatoActivo,
  type CausaActivo,
  type CriterioActivos,
  type DecisionActivo,
} from './activos'
import {
  conexionesDeCliente,
  listingsDeUnidad,
  unidadesDe,
  ventasDesde,
  type ListingParaActivos,
  type UnidadDeTrabajo,
} from './datos'
import {
  cadenciaBsr,
  porQueSinBsr,
  type CadenciaBsr,
  type ModeloNegocio,
  type PoliticaBsr,
} from './modelo-negocio'
import { inicioDeVentana } from './refresco'
import { unidadesPorSku } from './ventas'

/**
 * TOPE DE FILAS QUE SE LEEN EN UN SIMULACRO.
 *
 * No es un umbral de negocio —esos los pone el usuario y no se graban en el
 * código—: es el techo de una petición HTTP. Un cliente con cinco cuentas y
 * cuatro países son veinte unidades de trabajo, y traerse el catálogo de las
 * veinte para pintar unos contadores deja la pantalla colgada.
 *
 * Cuando se alcanza NO se miente con los totales: se dicen las unidades que se
 * han podido simular y las que se han quedado fuera, y quien mira elige un país
 * concreto para verlo entero.
 */
const MAX_LISTINGS = 60000

/** Cuántas filas de ejemplo se devuelven de cada movimiento */
const MAX_MUESTRA = 25

/* ------------------------------------------------------------------ */
/* Lo que sale                                                         */
/* ------------------------------------------------------------------ */

/** Un SKU que cambia de lado con el criterio nuevo */
export interface CambioSimulado {
  sku: string
  /** Estaba en seguimiento hoy */
  antes: boolean
  /** Lo estaría con el criterio propuesto */
  ahora: boolean
  motivo: string
}

export interface UnidadSimulada {
  connectionId: string
  connectionName: string
  marketplaceId: string

  evaluados: number
  /** Cuántos quedarían en seguimiento */
  activos: number
  /** De esos, los que están porque lo dijo una persona */
  activosManuales: number
  /** Cuántos están en seguimiento HOY */
  activosHoy: number

  entran: number
  salen: number
  igual: number

  topeAlcanzado: boolean
  recortados: number
  /** Frases del motor sobre cosas que no frenan pero explican un resultado raro */
  avisos: string[]

  /** Por qué se ha decidido cada cosa, ya agrupado y contado */
  causas: Array<{ causa: CausaActivo; cuantos: number }>
  muestra: CambioSimulado[]

  /** De los que quedarían activos, a cuántos se les pediría el BSR a diario */
  bsrDiario: number
  bsrBajoDemanda: number
}

export interface SimulacroActivos {
  /** El criterio contado en una frase, para cotejar que dice lo que se cree */
  descripcion: string
  unidades: UnidadSimulada[]

  evaluados: number
  activos: number
  activosHoy: number
  entran: number
  salen: number
  topeAlcanzado: boolean
  recortados: number

  bsrDiario: number
  bsrBajoDemanda: number
  /** Del cliente entero. null cuando sí se mide a diario */
  porQueSinBsr: string | null
  modelo: ModeloNegocio
  politica: PoliticaBsr
  cadencia: CadenciaBsr

  /** ¿Se ha usado la vía de rotación, y con qué cobertura de ventas? */
  usaRotacion: boolean
  sinDatosDeVenta: number

  /** Unidades que no se han simulado por el techo de filas. Ver MAX_LISTINGS */
  unidadesSinSimular: number
  truncado: boolean

  simuladoAt: string
}

/* ------------------------------------------------------------------ */
/* El simulacro                                                        */
/* ------------------------------------------------------------------ */

export async function simularRegla(params: {
  clientId: string
  criterio: CriterioActivos
  /** Vacío = todos los países del cliente, igual que la regla guardada */
  marketplaceIds: string[]
  /** Solo esta unidad. Es lo que permite ver un país entero cuando el cliente
      tiene tantos que el techo de filas corta */
  connectionId?: string | null
  marketplaceId?: string | null
  ahora?: Date
}): Promise<SimulacroActivos> {
  const ahora = params.ahora ?? new Date()

  const cliente = await clienteDe(params.clientId)
  const conexiones = await conexionesDeCliente(params.clientId)
  const filtradas = params.connectionId
    ? conexiones.filter((c) => c.id === params.connectionId)
    : conexiones
  const nombrePorConexion = new Map(conexiones.map((c) => [c.id, c.name]))

  let unidades: UnidadDeTrabajo[] = unidadesDe(filtradas, params.marketplaceIds)
  if (params.marketplaceId) {
    unidades = unidades.filter((u) => u.marketplaceId === params.marketplaceId)
  }

  const salida: UnidadSimulada[] = []
  let leidas = 0
  let unidadesSinSimular = 0
  let sinDatosDeVenta = 0

  for (const unidad of unidades) {
    if (leidas >= MAX_LISTINGS) {
      unidadesSinSimular += 1
      continue
    }

    const listings = await listingsDeUnidad(unidad, null)
    leidas += listings.length

    // ---------- Ventas, solo si el criterio las usa ----------
    // Con `min_unidades` a null la vía de rotación está apagada y traerse el
    // histórico de ventas serían miles de filas para nada. Es la misma
    // condición que aplica la tarea nocturna.
    let unidadesVendidas = new Map<string, number>()
    if (params.criterio.min_unidades !== null) {
      const desde = inicioDeVentana(ahora, params.criterio.ventana_dias)
      const filas = await ventasDesde(params.clientId, unidad.marketplaceId, desde)
      unidadesVendidas = unidadesPorSku(filas, unidad.marketplaceId)
    }

    const candidatos: CandidatoActivo[] = listings.map((l) => aCandidato(l, unidadesVendidas))
    if (params.criterio.min_unidades !== null) {
      sinDatosDeVenta += candidatos.filter((c) => c.unidadesVentana === null).length
    }

    const resultado = resolverActivos(params.criterio, candidatos)

    salida.push(
      compararConHoy({
        unidad,
        connectionName: nombrePorConexion.get(unidad.connectionId) ?? unidad.connectionId,
        listings,
        decisiones: resultado.decisiones,
        activos: resultado.activos,
        activosManuales: resultado.activosManuales,
        topeAlcanzado: resultado.topeAlcanzado,
        recortados: resultado.recortados,
        avisos: resultado.avisos,
        cliente,
      })
    )
  }

  const suma = (leer: (u: UnidadSimulada) => number) =>
    salida.reduce((total, u) => total + leer(u), 0)

  /**
   * La cadencia del cliente entero.
   *
   * `esMarcaPropia` va a `true` cuando el modelo es «mix» porque en mix la
   * pregunta no tiene respuesta a nivel de cliente: se resuelve SKU a SKU, y
   * decir «este cliente no mide el BSR» sería falso. Es la misma decisión que
   * toma el planificador antes de encolar el barrido.
   */
  const esMix = cliente.modelo === 'mix'
  const cadencia = cadenciaBsr({
    modelo: cliente.modelo,
    politica: cliente.politica,
    esMarcaPropia: esMix,
  })

  return {
    descripcion: describirCriterio(params.criterio),
    unidades: salida,
    evaluados: suma((u) => u.evaluados),
    activos: suma((u) => u.activos),
    activosHoy: suma((u) => u.activosHoy),
    entran: suma((u) => u.entran),
    salen: suma((u) => u.salen),
    topeAlcanzado: salida.some((u) => u.topeAlcanzado),
    recortados: suma((u) => u.recortados),
    bsrDiario: suma((u) => u.bsrDiario),
    bsrBajoDemanda: suma((u) => u.bsrBajoDemanda),
    porQueSinBsr: porQueSinBsr({
      modelo: cliente.modelo,
      politica: cliente.politica,
      esMarcaPropia: esMix,
    }),
    modelo: cliente.modelo,
    politica: cliente.politica,
    cadencia,
    usaRotacion: params.criterio.min_unidades !== null,
    sinDatosDeVenta,
    unidadesSinSimular,
    truncado: unidadesSinSimular > 0,
    simuladoAt: ahora.toISOString(),
  }
}

/* ------------------------------------------------------------------ */
/* Comparar con lo que hay hoy                                         */
/* ------------------------------------------------------------------ */

function compararConHoy(entrada: {
  unidad: UnidadDeTrabajo
  connectionName: string
  listings: ListingParaActivos[]
  decisiones: DecisionActivo[]
  activos: number
  activosManuales: number
  topeAlcanzado: boolean
  recortados: number
  avisos: string[]
  cliente: ClienteBsr
}): UnidadSimulada {
  // Por SKU y no por posición, igual que escribirActivos: el día que el motor
  // devuelva las decisiones en otro orden, esto seguiría casando bien.
  const porSku = new Map(entrada.listings.map((l) => [l.sku, l]))

  const causas = new Map<CausaActivo, number>()
  const muestra: CambioSimulado[] = []

  let entran = 0
  let salen = 0
  let igual = 0
  let activosHoy = 0
  let bsrDiario = 0
  let bsrBajoDemanda = 0

  for (const listing of entrada.listings) {
    // El valor efectivo de HOY. Ver la cabecera: contra activo_calculado a
    // secas, los SKU decididos a mano saldrían como movimientos falsos.
    if ((listing.activo_manual ?? listing.activo_calculado) === true) activosHoy += 1
  }

  for (const decision of entrada.decisiones) {
    causas.set(decision.causa, (causas.get(decision.causa) ?? 0) + 1)

    const listing = porSku.get(decision.sku)
    if (!listing) continue

    const antes = listing.activo_manual ?? listing.activo_calculado
    const ahora = decision.activo

    if (ahora) {
      // De lo que quedaría en seguimiento, ¿a cuánto se le pediría el ranking
      // cada noche? En «mix» decide la columna del SKU; en los otros dos
      // modelos la respuesta es la misma para todos y da igual lo que diga.
      const diario = cadenciaBsr({
        modelo: entrada.cliente.modelo,
        politica: entrada.cliente.politica,
        esMarcaPropia: listing.es_marca_propia,
      })
      if (diario === 'diario') bsrDiario += 1
      else if (diario === 'bajo_demanda') bsrBajoDemanda += 1
    }

    if (antes === ahora) {
      igual += 1
      continue
    }

    if (ahora) entran += 1
    else salen += 1

    if (muestra.length < MAX_MUESTRA) {
      muestra.push({ sku: decision.sku, antes, ahora, motivo: decision.motivo })
    }
  }

  return {
    connectionId: entrada.unidad.connectionId,
    connectionName: entrada.connectionName,
    marketplaceId: entrada.unidad.marketplaceId,
    evaluados: entrada.decisiones.length,
    activos: entrada.activos,
    activosManuales: entrada.activosManuales,
    activosHoy,
    entran,
    salen,
    igual,
    topeAlcanzado: entrada.topeAlcanzado,
    recortados: entrada.recortados,
    avisos: entrada.avisos,
    causas: [...causas.entries()]
      .map(([causa, cuantos]) => ({ causa, cuantos }))
      .sort((a, b) => b.cuantos - a.cuantos),
    muestra,
    bsrDiario,
    bsrBajoDemanda,
  }
}

/**
 * De una fila del catálogo al candidato del dominio puro.
 *
 * Copia deliberada de la de recalcular-activos.ts y no un import: aquella vive
 * dentro de una tarea del motor, con su contexto y sus eventos, y este módulo no
 * puede depender del motor para simular. Lo importante —que `unidadesVentana`
 * vaya a null y NO a cero cuando no hay dato— está escrito en los dos sitios.
 */
function aCandidato(
  listing: ListingParaActivos,
  unidadesVendidas: Map<string, number>
): CandidatoActivo {
  const vendidas = unidadesVendidas.get(listing.sku)
  return {
    sku: listing.sku,
    marketplaceId: listing.marketplace_id,
    esFba: listing.is_fba,
    esMarcaPropia: listing.es_marca_propia,
    listingStatus: listing.listing_status ?? [],
    precio: listing.price,
    marca: listing.marca,
    clasificacionItem: listing.clasificacion_item,
    unidadesVentana: vendidas === undefined ? null : vendidas,
    // El BSR vive en la serie temporal, no en el listing. A null: solo se usa
    // para ordenar al recortar por el tope, y con null esos SKU van al final,
    // que es lo correcto — nadie se cuela por un dato que nos falta.
    bsr: null,
    activoManual: listing.activo_manual,
    motivoManual: listing.activo_motivo,
  }
}

/* ------------------------------------------------------------------ */
/* El cliente                                                          */
/* ------------------------------------------------------------------ */

export interface ClienteBsr {
  id: string
  name: string
  modelo: ModeloNegocio
  politica: PoliticaBsr
}

/**
 * El modelo de negocio y la política de BSR del cliente.
 *
 * Los valores por omisión son los mismos que los DEFAULT de la migración 123
 * ('mix' y 'auto') y no una elección de aquí: una columna que todavía no existe
 * en una base a medio migrar tiene que comportarse igual que una recién creada.
 */
export async function clienteDe(clientId: string): Promise<ClienteBsr> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_clients')
    .select('id, name, modelo_negocio, bsr_politica')
    .eq('id', clientId)
    .limit(1)
  if (error) throw error

  const fila = ((data ?? [])[0] ?? null) as {
    id: string
    name: string
    modelo_negocio: string | null
    bsr_politica: string | null
  } | null

  if (!fila) throw new Error('Ese cliente no existe o ya no está activo')

  return {
    id: fila.id,
    name: fila.name,
    modelo: (fila.modelo_negocio ?? 'mix') as ModeloNegocio,
    politica: (fila.bsr_politica ?? 'auto') as PoliticaBsr,
  }
}
