/**
 * AMAZON ADS · EL MARGEN DE UN PRODUCTO Y LOS OBJETIVOS QUE SALEN DE ÉL.
 *
 * Funciones PURAS (sin base de datos ni Amazon): lo que se teclea en la ficha de un producto entra y salen las cifras que el SOP pide calcular, «no estimar»:
 *
 *   ACoS de equilibrio = margen bruto ANTES de publicidad ÷ precio de venta.
 *
 * Es el ACoS al que cada venta publicitaria deja el beneficio justo en cero: por encima se pierde dinero con cada pedido que trae el anuncio.
 *
 *
 * ============ POR QUÉ SE DIVIDE ENTRE EL PRECIO CON IVA ============
 *
 * Amazon Ads cuenta las ventas atribuidas CON el IVA incluido (en Europa el precio de la ficha lo lleva). El ACoS es gasto ÷ esas ventas, así que el equilibrio tiene que medirse contra el mismo
 * número: el beneficio que queda tras quitar el IVA, el coste, la comisión (que Amazon calcula sobre el precio con IVA) y el FBA, dividido entre el precio que ve el comprador. Con el precio sin IVA
 * en el denominador el equilibrio saldría inflado y se gastaría de más sin darse cuenta.
 */

export interface DatosDeCoste {
  /** Precio de venta en Amazon, tal y como lo ve el comprador (con IVA si el país lo incluye) */
  precio: number | null
  /** IVA incluido en ese precio, en %. 0 para países que no lo incluyen (EE. UU.) */
  ivaPct: number
  /** Lo que cuesta el producto puesto en el almacén */
  costeProducto: number | null
  /** Comisión de Amazon en % del precio */
  comisionPct: number
  /** Tarifa FBA por unidad */
  tarifaFba: number
  /** Cualquier otro coste por unidad (envío a Amazon, preparación, devoluciones…) */
  otrosCostes: number
}

export interface MargenDeProducto {
  /** El precio sin IVA */
  netoSinIva: number
  comision: number
  /** Beneficio por unidad antes de gastar un euro en publicidad. Puede ser negativo */
  margen: number
  /** ACoS de equilibrio en % (0 si el producto ya pierde dinero sin publicidad) */
  acosEquilibrioPct: number
}

const redondear = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d

/**
 * El margen de un producto, o null si faltan el precio o el coste: sin ellos no se puede calcular y un «0 %» inventado se leería como un dato.
 */
export function margenDeProducto(d: DatosDeCoste): MargenDeProducto | null {
  if (d.precio == null || d.costeProducto == null) return null
  if (!(d.precio > 0) || d.costeProducto < 0) return null
  const neto = d.precio / (1 + d.ivaPct / 100)
  const comision = (d.precio * d.comisionPct) / 100
  const margen = neto - d.costeProducto - comision - d.tarifaFba - d.otrosCostes
  return {
    netoSinIva: redondear(neto),
    comision: redondear(comision),
    margen: redondear(margen),
    acosEquilibrioPct: margen > 0 ? redondear((margen / d.precio) * 100, 1) : 0,
  }
}

export interface ObjetivosDeProducto {
  acosObjetivoPct: number
  /** Lo que se puede gastar para conseguir UNA venta y quedar en el objetivo, en la moneda de la cuenta */
  cpaObjetivo: number
  /** Gasto sin venta a partir del cual el SOP manda negativizar el término (junto con los clics mínimos) */
  gastoMaximoSinVenta: number
}

/**
 * LOS OBJETIVOS DE UN PRODUCTO a partir del ACoS objetivo que ha FIJADO una persona (ya no sale de una fórmula sobre el equilibrio):
 *
 *   CPA objetivo = precio × ACoS objetivo          gasto máximo sin venta = (veces el CPA de la ficha) × CPA objetivo
 *
 * null si falta el precio o el ACoS objetivo, o si no valen (el precio tiene que ser positivo y el ACoS estar entre 0 y 100): sin esos dos números no se puede decidir nada y NO se inventa un valor.
 */
export function objetivosDesdeAcos(precio: number | null | undefined, acosObjetivoPct: number | null | undefined, gastoSinVentaX: number): ObjetivosDeProducto | null {
  if (precio == null || acosObjetivoPct == null || !(precio > 0) || !(acosObjetivoPct > 0) || acosObjetivoPct > 100 || !(gastoSinVentaX > 0)) return null
  const cpaObjetivo = redondear((precio * acosObjetivoPct) / 100)
  return { acosObjetivoPct: redondear(acosObjetivoPct, 1), cpaObjetivo, gastoMaximoSinVenta: redondear(cpaObjetivo * gastoSinVentaX) }
}

/**
 * EL PRECIO CON EL QUE DECIDE EL MOTOR. El de la ficha del producto manda; si no lo hay (cuentas sin Seller Central conectado: el ERP no puede leer el precio de Amazon, caso Ham Master), se usa el
 * TICKET MEDIO de lo que la publicidad ha vendido de ese producto (ventas atribuidas ÷ unidades) y se marca como estimación. Sin ninguno de los dos, null: no se inventa.
 *
 * Por qué el ticket y no nada: sin precio no hay CPA objetivo y el motor no puede decir cuánto puede gastar un término sin vender, así que la cuenta piloto se quedaba SIN NINGUNA propuesta aunque
 * tuviera keywords quemando dinero. El SOP lo permite así: «si falta, estima, di que es estimación y deja la celda marcada».
 */
export function precioParaMotor(precio: number | null | undefined, ticketMedio: number | null | undefined): { precio: number; estimado: boolean } | null {
  if (precio != null && precio > 0) return { precio, estimado: false }
  if (ticketMedio != null && Number.isFinite(ticketMedio) && ticketMedio > 0) return { precio: redondear(ticketMedio), estimado: true }
  return null
}

/** El ticket medio por ASIN a partir de filas de rendimiento (ventas y unidades atribuidas). Solo los ASIN con alguna unidad vendida */
export function ticketsMedios(filas: ReadonlyArray<{ asin: string | null; ventas: number; unidades: number }>): Map<string, number> {
  const suma = new Map<string, { ventas: number; unidades: number }>()
  for (const f of filas) {
    if (!f.asin) continue
    const x = suma.get(f.asin) ?? { ventas: 0, unidades: 0 }
    x.ventas += Number(f.ventas) || 0
    x.unidades += Number(f.unidades) || 0
    suma.set(f.asin, x)
  }
  const salida = new Map<string, number>()
  for (const [asin, x] of suma) if (x.unidades > 0 && x.ventas > 0) salida.set(asin, redondear(x.ventas / x.unidades))
  return salida
}

/**
 * Una puja de partida razonable: lo máximo que se puede pagar por un clic si 1 de cada 10 clics compra y se quiere quedar en el ACoS objetivo (puja = precio × ACoS objetivo × conversión).
 * Es un PUNTO DE PARTIDA que la persona ve y edita antes de crear las campañas: la conversión real de cada producto se conoce después, no antes. Mínimo 0,10 para no proponer una puja que no sirve.
 */
export function pujaBaseSugerida(precio: number | null, acosObjetivoPct: number | null, conversion = 0.1): number | null {
  if (precio == null || acosObjetivoPct == null || !(precio > 0) || !(acosObjetivoPct > 0)) return null
  return Math.max(0.1, redondear(precio * (acosObjetivoPct / 100) * conversion))
}

/**
 * El IVA que lleva por defecto el precio de un país de Amazon (el que ve el comprador). Es una propuesta que se edita en la ficha del producto: 0 donde el precio no lo incluye (EE. UU., Canadá,
 * México). Países que no están en la lista: 21.
 */
export function ivaPorDefecto(pais: string): number {
  const tabla: Record<string, number> = { ES: 21, FR: 20, IT: 22, DE: 19, UK: 20, GB: 20, NL: 21, BE: 21, IE: 23, PL: 23, SE: 25, AE: 5, SA: 15, US: 0, CA: 0, MX: 0, BR: 0 }
  return tabla[pais] ?? 21
}
