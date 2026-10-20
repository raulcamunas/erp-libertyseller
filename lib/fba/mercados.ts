import { AMAZON_MARKETPLACES, marketplaceById, marketplaceLabel, mercadosDeConexion, type AmazonRegion } from '@/lib/types/amazon'

/**
 * EN QUÉ MERCADO ESTÁ UN ENVÍO, Y CÓMO SE LEE LA FECHA DE SU NOMBRE.
 * ==================================================================
 * PURO. Se comprueba con mercados.prueba.ts. Lo usan «Traer envío de Amazon»
 * (app/api/fba/remesas/importar-envio y su diálogo) y la lectura de ventas.
 *
 *
 * ============ POR QUÉ EXISTE ============
 *
 * El diálogo de traer un envío llevaba el mercado fijo en España. Con Portico LLC —una cuenta de
 * Norteamérica, con todos sus productos en Amazon.com— se importaron tres envíos de Estados
 * Unidos como si fueran de España, y de ahí colgó todo lo demás:
 *
 *   · no se trajeron nombres ni ASIN (el catálogo se busca por mercado y en España no hay nada),
 *   · la pasada de la noche pedía a Amazon el libro mayor de España con credenciales de EE. UU.,
 *   · el botón «Leer de Amazon» del panel leía México, el mercado por defecto de la conexión.
 *
 * Nada de eso da error en pantalla: las ventas se quedan en cero y parece que no se ha vendido.
 * Por eso el mercado de un envío no se da por España: se comprueba contra lo que la cuenta vende
 * y, si lo que se pide no está, se elige el mercado donde la cuenta tiene sus productos en FBA.
 */

export interface ConexionParaMercado {
  marketplace_ids: string[] | null
  marketplaces_activos?: string[] | null
  default_marketplace_id: string | null
}

export interface MercadoDeEnvio {
  id: string
  /** «España», «Estados Unidos»… Para pantalla */
  nombre: string
  region: AmazonRegion | null
  /** true si NO es el que se pidió: la pantalla lo cuenta */
  cambiado: boolean
}

const conId = (id: string, cambiado: boolean): MercadoDeEnvio => ({
  id,
  nombre: marketplaceLabel(id),
  region: marketplaceById(id)?.region ?? null,
  cambiado,
})

/**
 * ¿La cuenta está dada de alta en este mercado?
 *
 * Con la lista de la conexión vacía no se puede saber, y se da por buena: es una conexión antigua o
 * a medio rellenar, y bloquear lo que hasta ahora funcionaba sería peor que dejarlo pasar.
 */
export function participaEn(conexion: Pick<ConexionParaMercado, 'marketplace_ids'>, mercado: string): boolean {
  const ids = conexion.marketplace_ids ?? []
  return ids.length === 0 || ids.includes(mercado)
}

/**
 * El mercado de un envío que se trae de Amazon.
 *
 *   1. El que se pide, si la cuenta está en él. Es lo de siempre: los clientes de España piden España.
 *   2. Si no, el mercado de la cuenta donde más productos en FBA tiene (`fbaPorMercado`).
 *   3. Si no hay datos de productos, el mercado por defecto de la conexión, si alguien lo marcó y la cuenta está en él.
 *   4. Y si tampoco, el primero que la cuenta tenga, en el orden de AMAZON_MARKETPLACES (España primero).
 */
export function mercadoDeEnvio(opciones: {
  pedido: string | null | undefined
  conexion: ConexionParaMercado
  fbaPorMercado?: ReadonlyMap<string, number>
}): MercadoDeEnvio {
  const { conexion } = opciones
  const pedido = (opciones.pedido ?? '').trim() || null
  // «Cambiado» solo tiene sentido si se pidió algo: sin pedido no se ha cambiado nada
  const elegido = (id: string): MercadoDeEnvio => conId(id, pedido !== null && id !== pedido)

  if (pedido && participaEn(conexion, pedido)) return elegido(pedido)

  const ids = conexion.marketplace_ids ?? []
  const candidatos = mercadosDeConexion({ marketplace_ids: ids, marketplaces_activos: conexion.marketplaces_activos })
  const fba = opciones.fbaPorMercado ?? new Map<string, number>()

  // Ordenar es estable: a igualdad de productos, el orden de la conexión
  const porProductos = [...candidatos].sort((a, b) => (fba.get(b) ?? 0) - (fba.get(a) ?? 0))
  if (porProductos.length > 0 && (fba.get(porProductos[0]) ?? 0) > 0) return elegido(porProductos[0])

  // Solo el que alguien dejó marcado: resolveMarketplace() también devuelve «el primero del array», y ese
  // orden es el que devolvió Amazon, no una decisión de nadie
  const porDefecto = conexion.default_marketplace_id
  if (porDefecto && participaEn(conexion, porDefecto)) return elegido(porDefecto)

  const orden = new Map(AMAZON_MARKETPLACES.map((m, i) => [m.id, i]))
  const primero = [...candidatos].sort((a, b) => (orden.get(a) ?? 1e6) - (orden.get(b) ?? 1e6))[0]
  if (primero) return elegido(primero)

  return elegido(pedido ?? AMAZON_MARKETPLACES[0].id)
}

/** Lo que la pantalla dice cuando el mercado no es el que se esperaba, o cuando no hay forma de leer ahí */
export function mercadosQueVendeLaCuenta(conexion: ConexionParaMercado): string[] {
  return mercadosDeConexion({ marketplace_ids: conexion.marketplace_ids ?? [], marketplaces_activos: conexion.marketplaces_activos }).map(marketplaceLabel)
}

/**
 * EL DÍA EN QUE SE CREÓ UN ENVÍO, LEÍDO DEL NOMBRE QUE LE PONE AMAZON: «FBA STA (06/10/2026 10:17)-MIT2».
 *
 * El orden de los números depende del país de la cuenta: en España es día/mes/año y en Estados Unidos
 * mes/día/año. El diálogo lo daba siempre por día/mes, y «07/08/2026» de una cuenta de EE. UU. (8 de
 * julio) salía como 7 de agosto, y «07/19/2026» ni siquiera daba una fecha.
 *
 * Cuando un número pasa de 12 no hay duda posible —solo puede ser el día—, y eso manda sobre la región.
 * Devuelve 'YYYY-MM-DD', o null si el nombre no lleva fecha o la fecha no es de verdad.
 */
export function diaDeCreacionDeEnvio(nombre: string | null | undefined, region: AmazonRegion | null): string | null {
  const m = /\((\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(nombre ?? '')
  if (!m) return null
  const a = Number(m[1])
  const b = Number(m[2])
  let diaPrimero = region !== 'na'
  if (a > 12) diaPrimero = true
  else if (b > 12) diaPrimero = false
  const dia = diaPrimero ? a : b
  const mes = diaPrimero ? b : a
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
  const f = new Date(Date.UTC(Number(m[3]), mes - 1, dia))
  // 31/02 no existe: Date lo corre al mes siguiente y aquí se descarta
  if (f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== dia) return null
  return `${m[3]}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}
