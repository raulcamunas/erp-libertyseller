/**
 * QUÉ SKU ESTÁN EN SEGUIMIENTO — DOMINIO PURO
 * ===========================================
 * Sin Supabase, sin red y sin reloj del sistema: todo entra por parámetro,
 * incluida la fecha. Se puede ejecutar en una prueba sin levantar nada.
 *
 *
 * QUÉ PROBLEMA RESUELVE, QUE NO ES OBVIO LEYENDO EL CÓDIGO
 * -------------------------------------------------------
 * La especificación lo pone así: «No traigas 13.700 SKUs a diario». El refresco
 * diario tiene que caber en una ventana nocturna y el cupo de Amazon es por
 * cuenta de vendedor, así que la pregunta «¿de qué SKU nos ocupamos cada día?»
 * es la que decide si la plataforma funciona o si tarda catorce horas.
 *
 * Y la respuesta CAMBIA POR CLIENTE: Bodegas Valhalla son cuarenta referencias
 * de marca propia en FBA y hay que mirarlas todas; ShoesF son 13.700 de marcas
 * ajenas mayoritariamente FBM y hay que mirar las que rotan. Por eso el criterio
 * vive en una tabla (amazon_tracking_rules) y aquí solo está el motor que la
 * aplica.
 *
 *
 * EL ORDEN DE EVALUACIÓN ES EL DISEÑO. En este orden y no en otro:
 *
 *   1. LO QUE DIJO UNA PERSONA GANA SIEMPRE, en los dos sentidos. Si no fuera lo
 *      primero, el recálculo nocturno se llevaría por delante lo que un gestor
 *      marcó ayer y al día siguiente nadie entendería por qué un producto ha
 *      dejado de seguirse.
 *   2. La lista de inclusión forzada. Es el «vigila esto aunque no cumpla nada»,
 *      que es como se siguen los candidatos antes de que tengan historia.
 *   3. Las exclusiones. Van ANTES que las inclusiones porque son más fuertes:
 *      una marca excluida no entra ni siendo FBA.
 *   4. Los filtros de sanidad (listado vivo, precio, variación padre).
 *   5. Las vías de entrada: canal, marca propia, rotación.
 *   6. EL TOPE, que es el freno. Se aplica al final sobre lo que ha quedado.
 *
 * Cada decisión sale con SU MOTIVO EN ESPAÑOL, ya redactado. No es adorno: es lo
 * que contesta «¿por qué este producto no se refresca a diario?» sin que nadie
 * tenga que reproducir la regla a mano.
 */

import type { OrdenTope, ReglaActivos } from './tipos'

/* ------------------------------------------------------------------ */
/* Lo que hace falta saber de un SKU para decidir                      */
/* ------------------------------------------------------------------ */

/**
 * Un candidato, con lo MÍNIMO que hace falta.
 *
 * Deliberadamente no es un `ListingConCatalogo`: así esta función se puede
 * probar con objetos de cuatro campos, y el día que el criterio necesite un dato
 * más se ve aquí en vez de perderse dentro de una fila de veinte columnas.
 */
export interface CandidatoActivo {
  sku: string
  marketplaceId: string
  /** Lo gestiona Amazon */
  esFba: boolean
  /** Marca del cliente (dato nuestro; Amazon no lo sabe) */
  esMarcaPropia: boolean
  /** BUYABLE / DISCOVERABLE, tal cual lo devuelve Amazon */
  listingStatus: string[]
  precio: number | null
  marca: string | null
  clasificacionItem: string | null
  /**
   * Unidades vendidas en la ventana de la regla.
   *
   * null = NO LO SABEMOS, que no es cero. La diferencia decide: un SKU sin datos
   * de ventas no se descarta por rotación, porque descartarlo sería castigarlo
   * por un dato que nos falta a nosotros.
   */
  unidadesVentana: number | null
  /** Mejor rank conocido. Solo se usa para ordenar al recortar por el tope */
  bsr: number | null
  /** Lo que dijo una persona. null = nadie se ha pronunciado */
  activoManual: boolean | null
  /** El motivo que escribió esa persona. Se conserva tal cual */
  motivoManual: string | null
}

export interface DecisionActivo {
  sku: string
  marketplaceId: string
  activo: boolean
  /** En español y ya redactado. Va a la columna activo_motivo */
  motivo: string
  /** true si la decisión la tomó una persona y no la regla */
  manual: boolean
}

export interface ResultadoActivos {
  decisiones: DecisionActivo[]
  /** Cuántos quedan en seguimiento */
  activos: number
  /** De esos, los que están porque lo dijo una persona */
  activosManuales: number
  evaluados: number
  /** Se ha alcanzado el tope y se ha recortado. Esto TIENE que hacer ruido */
  topeAlcanzado: boolean
  /** Cuántos se han quedado fuera solo por el tope */
  recortados: number
  /**
   * Frases en español sobre cosas que no frenan pero explican un resultado raro.
   * Mismo papel que los `avisos` del simulacro de stock: sin ellas se redactan,
   * se enseñan una vez y se pierden.
   */
  avisos: string[]
}

/* ------------------------------------------------------------------ */
/* La regla                                                            */
/* ------------------------------------------------------------------ */

/**
 * Lo que esta función necesita de una regla. Es un subconjunto de
 * `ReglaActivos` para que se pueda invocar con un objeto literal en una prueba
 * sin inventar quince campos de auditoría.
 */
export type CriterioActivos = Pick<
  ReglaActivos,
  | 'incluir_fba'
  | 'incluir_fbm'
  | 'incluir_marca_propia'
  | 'min_unidades'
  | 'ventana_dias'
  | 'solo_listados_activos'
  | 'excluir_sin_precio'
  | 'excluir_variacion_padre'
  | 'marcas_excluidas'
  | 'skus_excluidos'
  | 'skus_incluidos'
  | 'tope_skus'
  | 'orden_tope'
>

/** Los mismos valores de fábrica que siembra la migración 123 */
export const CRITERIO_DE_FABRICA: CriterioActivos = {
  incluir_fba: true,
  incluir_fbm: false,
  incluir_marca_propia: true,
  min_unidades: null,
  ventana_dias: 30,
  solo_listados_activos: true,
  excluir_sin_precio: true,
  excluir_variacion_padre: true,
  marcas_excluidas: [],
  skus_excluidos: [],
  skus_incluidos: [],
  tope_skus: 2000,
  orden_tope: 'ventas',
}

/**
 * Normaliza para comparar marcas y SKU.
 *
 * Sin esto, «PIKOLINOS» y «Pikolinos» son marcas distintas y una exclusión
 * escrita a mano no coge la mitad del catálogo. Se recorta y se pasa a
 * minúsculas; NO se quitan acentos, porque una marca con tilde es otra marca.
 */
function normalizar(valor: string | null | undefined): string {
  return (valor ?? '').trim().toLowerCase()
}

function conjuntoDe(valores: string[]): Set<string> {
  return new Set(valores.map(normalizar).filter((v) => v !== ''))
}

/** ¿El listing está a la venta? BUYABLE es lo que importa; DISCOVERABLE es
    «se ve pero no se compra» */
function estaALaVenta(listingStatus: string[]): boolean {
  return listingStatus.some((s) => s.toUpperCase() === 'BUYABLE')
}

/* ------------------------------------------------------------------ */
/* El motor                                                            */
/* ------------------------------------------------------------------ */

/**
 * Decide qué SKU quedan en seguimiento.
 *
 * Devuelve una decisión POR CADA candidato, también por los que se quedan fuera:
 * quien escribe en la base necesita poder apagar los que antes estaban dentro, y
 * la pantalla necesita poder explicar una ausencia.
 *
 * La lista de salida va en el mismo orden que la de entrada, para que el
 * resultado sea reproducible y comparable entre dos ejecuciones.
 */
export function resolverActivos(
  criterio: CriterioActivos,
  candidatos: CandidatoActivo[]
): ResultadoActivos {
  const excluidos = conjuntoDe(criterio.skus_excluidos)
  const forzados = conjuntoDe(criterio.skus_incluidos)
  const marcasFuera = conjuntoDe(criterio.marcas_excluidas)

  const avisos: string[] = []
  const decisiones: DecisionActivo[] = []
  /** Los que han pasado todos los filtros y compiten por entrar en el tope */
  const aspirantes: CandidatoActivo[] = []

  let sinDatosDeVenta = 0

  for (const c of candidatos) {
    // ---------- 1) La persona manda ----------
    if (c.activoManual !== null) {
      decisiones.push({
        sku: c.sku,
        marketplaceId: c.marketplaceId,
        activo: c.activoManual,
        motivo:
          c.motivoManual ??
          (c.activoManual
            ? 'Lo marcó una persona para que se siga a diario.'
            : 'Lo marcó una persona para que no se siga.'),
        manual: true,
      })
      continue
    }

    const skuNorm = normalizar(c.sku)

    // ---------- 2) Inclusión forzada ----------
    // Va antes que las exclusiones a propósito: si alguien se molesta en poner
    // un SKU en la lista de «siempre dentro», es más específico que una regla
    // de marca escrita hace tres meses.
    if (forzados.has(skuNorm)) {
      decisiones.push({
        sku: c.sku,
        marketplaceId: c.marketplaceId,
        activo: true,
        motivo: 'Está en la lista de SKU que se siguen siempre, sea cual sea el criterio.',
        manual: false,
      })
      continue
    }

    // ---------- 3) Exclusiones ----------
    if (excluidos.has(skuNorm)) {
      decisiones.push(fuera(c, 'Está en la lista de SKU excluidos del criterio de este cliente.'))
      continue
    }

    if (marcasFuera.size > 0 && marcasFuera.has(normalizar(c.marca))) {
      decisiones.push(
        fuera(c, `La marca «${c.marca ?? '—'}» está excluida del criterio de este cliente.`)
      )
      continue
    }

    // ---------- 4) Filtros de sanidad ----------
    if (criterio.excluir_variacion_padre && c.clasificacionItem === 'VARIATION_PARENT') {
      decisiones.push(
        fuera(
          c,
          'Es la variación padre que agrupa a las demás: no se compra ni se vende, así que seguirla no aporta nada.'
        )
      )
      continue
    }

    if (criterio.solo_listados_activos && !estaALaVenta(c.listingStatus)) {
      decisiones.push(
        fuera(
          c,
          'El listing no está a la venta en Amazon, así que no hay Buy Box que perder ni precio que vigilar.'
        )
      )
      continue
    }

    if (criterio.excluir_sin_precio && (c.precio === null || c.precio <= 0)) {
      decisiones.push(
        fuera(c, 'No tiene precio en este marketplace: no hay margen que calcular ni oferta que comparar.')
      )
      continue
    }

    // ---------- 5) Vías de entrada ----------
    const motivos: string[] = []
    if (criterio.incluir_fba && c.esFba) {
      motivos.push('lo gestiona Amazon (FBA), así que cuesta almacenaje cada día')
    }
    if (criterio.incluir_fbm && !c.esFba) {
      motivos.push('lo gestiona el vendedor y el criterio del cliente incluye todo el FBM')
    }
    if (criterio.incluir_marca_propia && c.esMarcaPropia) {
      motivos.push('es de una marca propia del cliente')
    }

    if (criterio.min_unidades !== null) {
      if (c.unidadesVentana === null) {
        // No se descarta por un dato que nos falta A NOSOTROS. Se cuenta para el
        // aviso de abajo, que es lo que hace visible el agujero de cobertura.
        sinDatosDeVenta += 1
      } else if (c.unidadesVentana >= criterio.min_unidades) {
        motivos.push(
          `ha vendido ${c.unidadesVentana} unidades en los últimos ${criterio.ventana_dias} días ` +
            `(el mínimo del cliente son ${criterio.min_unidades})`
        )
      }
    }

    if (motivos.length === 0) {
      decisiones.push(fuera(c, motivoDeNoEntrar(criterio, c)))
      continue
    }

    aspirantes.push(c)
    decisiones.push({
      sku: c.sku,
      marketplaceId: c.marketplaceId,
      activo: true,
      motivo: `En seguimiento porque ${motivos.join('; y porque ')}.`,
      manual: false,
    })
  }

  // ---------- 6) EL TOPE ----------
  // Se aplica al final y sobre los aspirantes, nunca sobre los manuales ni sobre
  // los forzados: si alguien pidió expresamente vigilar algo, un tope calculado
  // no se lo puede quitar sin decírselo.
  let topeAlcanzado = false
  let recortados = 0

  if (aspirantes.length > criterio.tope_skus) {
    topeAlcanzado = true
    const ordenados = ordenarParaElTope(aspirantes, criterio.orden_tope)
    const fueraDelTope = new Set(
      ordenados.slice(criterio.tope_skus).map((c) => claveDe(c.marketplaceId, c.sku))
    )
    recortados = fueraDelTope.size

    for (const d of decisiones) {
      if (!d.activo || d.manual) continue
      if (!fueraDelTope.has(claveDe(d.marketplaceId, d.sku))) continue
      d.activo = false
      d.motivo =
        `Cumple el criterio, pero se ha alcanzado el tope de ${criterio.tope_skus} SKU en ` +
        `seguimiento diario de este cliente y ha quedado por debajo del corte ` +
        `(${etiquetaOrden(criterio.orden_tope)}).`
    }

    avisos.push(
      `El criterio selecciona ${aspirantes.length} SKU y el tope del cliente son ` +
        `${criterio.tope_skus}: se han dejado fuera ${recortados}. O se sube el tope, o se ` +
        `estrecha el criterio: mientras tanto, esos ${recortados} no se refrescan a diario.`
    )
  }

  if (criterio.min_unidades !== null && sinDatosDeVenta > 0) {
    avisos.push(
      `${sinDatosDeVenta} SKU no tienen datos de ventas en la ventana de ${criterio.ventana_dias} ` +
        'días, así que la vía de rotación no ha podido evaluarlos. No se han descartado por eso, ' +
        'pero tampoco han entrado por ahí: importa las ventas para que el criterio funcione entero.'
    )
  }

  const activos = decisiones.filter((d) => d.activo)
  if (activos.length === 0 && decisiones.length > 0) {
    avisos.push(
      'El criterio de este cliente no deja NINGÚN SKU en seguimiento. Con el conjunto activo ' +
        'vacío, el refresco diario no trae nada y todo parece funcionar: revisa la regla.'
    )
  }

  return {
    decisiones,
    activos: activos.length,
    activosManuales: activos.filter((d) => d.manual).length,
    evaluados: decisiones.length,
    topeAlcanzado,
    recortados,
    avisos,
  }
}

function fuera(c: CandidatoActivo, motivo: string): DecisionActivo {
  return { sku: c.sku, marketplaceId: c.marketplaceId, activo: false, motivo, manual: false }
}

export function claveDe(marketplaceId: string, sku: string): string {
  return `${marketplaceId}|${sku}`
}

/**
 * Por qué no ha entrado, contado del derecho.
 *
 * «No cumple el criterio» no le sirve a nadie: lo que hace falta saber es qué
 * puerta estaba cerrada, porque eso es lo que se cambia si el resultado no
 * gusta.
 */
function motivoDeNoEntrar(criterio: CriterioActivos, c: CandidatoActivo): string {
  const puertas: string[] = []
  if (criterio.incluir_fba) puertas.push('estar en FBA')
  if (criterio.incluir_fbm) puertas.push('estar en FBM')
  if (criterio.incluir_marca_propia) puertas.push('ser de marca propia')
  if (criterio.min_unidades !== null) {
    puertas.push(
      `vender al menos ${criterio.min_unidades} unidades en ${criterio.ventana_dias} días`
    )
  }

  const canal = c.esFba ? 'está en FBA' : 'está en FBM'
  const rotacion =
    criterio.min_unidades === null
      ? ''
      : c.unidadesVentana === null
        ? ', y no tenemos sus ventas'
        : `, y ha vendido ${c.unidadesVentana} unidades en la ventana`

  return (
    `No entra por ninguna de las vías del criterio (${puertas.join(', ') || 'ninguna configurada'}): ` +
    `${canal}${c.esMarcaPropia ? ', es de marca propia' : ', no es de marca propia'}${rotacion}.`
  )
}

function etiquetaOrden(orden: OrdenTope): string {
  switch (orden) {
    case 'ventas':
      return 'se ordena por unidades vendidas, de más a menos'
    case 'bsr':
      return 'se ordena por ranking de ventas, del mejor al peor'
    case 'precio':
      return 'se ordena por precio, de más caro a más barato'
    case 'sku':
      return 'se ordena por SKU'
  }
}

/**
 * Ordena los aspirantes para decidir a quién se corta.
 *
 * EL DESEMPATE FINAL POR SKU NO ES COSMÉTICO: sin él, dos recálculos seguidos
 * con los mismos datos pueden dar dos listas distintas —el orden de llegada de
 * las filas de Postgres no está garantizado sin ORDER BY— y entonces un SKU
 * entra y sale del seguimiento cada noche sin que nada haya cambiado. Su serie
 * histórica quedaría llena de huecos imposibles de explicar.
 *
 * Un valor desconocido va SIEMPRE al final: cortar por falta de dato es
 * defendible, colarse por falta de dato no.
 */
function ordenarParaElTope(candidatos: CandidatoActivo[], orden: OrdenTope): CandidatoActivo[] {
  const copia = [...candidatos]

  copia.sort((a, b) => {
    const dif = comparar(a, b, orden)
    if (dif !== 0) return dif
    // Desempate estable y total.
    if (a.sku !== b.sku) return a.sku < b.sku ? -1 : 1
    return a.marketplaceId < b.marketplaceId ? -1 : a.marketplaceId > b.marketplaceId ? 1 : 0
  })

  return copia
}

function comparar(a: CandidatoActivo, b: CandidatoActivo, orden: OrdenTope): number {
  switch (orden) {
    case 'ventas':
      // Más unidades primero. Sin dato, al final.
      return desconocidoAlFinal(a.unidadesVentana, b.unidadesVentana, 'desc')
    case 'bsr':
      // Mejor rank es número MÁS BAJO.
      return desconocidoAlFinal(a.bsr, b.bsr, 'asc')
    case 'precio':
      return desconocidoAlFinal(a.precio, b.precio, 'desc')
    case 'sku':
      return 0
  }
}

function desconocidoAlFinal(a: number | null, b: number | null, sentido: 'asc' | 'desc'): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return sentido === 'asc' ? a - b : b - a
}

/* ------------------------------------------------------------------ */
/* Descripción para pantalla                                           */
/* ------------------------------------------------------------------ */

/**
 * El criterio contado en una frase.
 *
 * Existe porque una regla con nueve interruptores es ilegible en una tabla, y
 * porque quien la configura tiene que poder comprobar de un vistazo que dice lo
 * que cree que dice.
 */
export function describirCriterio(criterio: CriterioActivos): string {
  const entra: string[] = []
  if (criterio.incluir_fba) entra.push('todo lo de FBA')
  if (criterio.incluir_fbm) entra.push('todo lo de FBM')
  if (criterio.incluir_marca_propia) entra.push('la marca propia')
  if (criterio.min_unidades !== null) {
    entra.push(
      `lo que venda ${criterio.min_unidades}+ unidades en ${criterio.ventana_dias} días`
    )
  }
  if (criterio.skus_incluidos.length > 0) {
    entra.push(`${criterio.skus_incluidos.length} SKU marcados a mano`)
  }

  const fuera: string[] = []
  if (criterio.solo_listados_activos) fuera.push('lo que no está a la venta')
  if (criterio.excluir_sin_precio) fuera.push('lo que no tiene precio')
  if (criterio.excluir_variacion_padre) fuera.push('las variaciones padre')
  if (criterio.marcas_excluidas.length > 0) {
    fuera.push(`${criterio.marcas_excluidas.length} marcas excluidas`)
  }
  if (criterio.skus_excluidos.length > 0) {
    fuera.push(`${criterio.skus_excluidos.length} SKU excluidos`)
  }

  const partes = [`Entra ${entra.length > 0 ? entra.join(', ') : 'nada'}`]
  if (fuera.length > 0) partes.push(`fuera ${fuera.join(', ')}`)
  partes.push(`tope de ${criterio.tope_skus} SKU`)
  return `${partes.join('; ')}.`
}
