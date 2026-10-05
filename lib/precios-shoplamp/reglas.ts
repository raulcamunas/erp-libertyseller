import { AMAZON_MARKETPLACES } from '@/lib/types/amazon'

/**
 * PRECIOS DE SHOPLAMP: España manda, los demás se calculan.
 * ========================================================
 *
 * La regla del cliente, literal: el precio de España es la base, y sobre él se
 * suma una cantidad fija en cada país.
 *
 *     Francia   + 7 €
 *     Italia    + 7 €
 *     Alemania  + 6 €
 *
 * Es lo que cuesta mandar el pedido a cada país: el almacén está en España y de
 * ahí sale todo. Nada más. Ni porcentajes, ni redondeo a ,99, ni recálculo de
 * IVA: «+7 €» son siete euros sobre el precio que ve el comprador.
 *
 * SI CAMBIAN, SE CAMBIAN AQUÍ Y YA ESTÁ. Esta tabla es el único sitio donde
 * viven los números: la pantalla, la explicación y las pruebas los leen de
 * aquí, así que no hay ningún otro fichero que tocar ni ninguna cifra suelta
 * que se pueda quedar desfasada. Ya pasó una vez: la regla nació con +11/+11/+8
 * y se corrigió a +7/+7/+6 antes de publicar nada.
 *
 *
 * ============ POR QUÉ LOS RECARGOS VAN EN CÉNTIMOS ENTEROS ============
 *
 * Porque `24.99 + 11` en JavaScript NO es 35,99. Es 35.989999999999995, y ese
 * número llega CRUDO al cuerpo del PATCH: `updatePrice` lo pasa tal cual a
 * `value_with_tax` (lib/amazon/sp-api.ts) y las comprobaciones de cordura de
 * `sendChanges` solo miran que sea finito y positivo, así que nada lo pararía.
 * Amazon o lo redondea a su gusto o lo rechaza con INVALID.
 *
 * No es una rareza de laboratorio: sobre los precios reales de este catálogo,
 * del orden de una de cada ocho sumas se corrompe. Y es INTERMITENTE —19,95 + 11
 * da 30,95 exacto—, así que una prueba a mano con dos ejemplos pasa limpia y el
 * fallo sale en producción.
 *
 * Trabajando en céntimos enteros no hay nada que redondear: 2499 + 1100 = 3599,
 * y la única división es la última.
 *
 *
 * ============ EL CORTAFUEGOS DE LA DIVISA ============
 *
 * Shoplamp tiene ONCE marketplaces autorizados y vende también en Reino Unido,
 * en libras. Sumar 11 a un precio en libras son unos 12,70 € de recargo, el
 * salto por línea es pequeño y ningún freno lo vería: el ERP ya se comió este
 * fallo una vez —un perfil en euros publicando contra amazon.co.uk, el cliente
 * vendiendo un 17 % caro y ni un error por ningún lado— y está escrito en
 * lib/stock-sync/proceso.ts.
 *
 * Por eso Reino Unido no está «sin marcar»: no se puede llegar a él. Los
 * destinos son estos tres y se comprueba además que su divisa sea la misma que
 * la de la base, leyéndola de AMAZON_MARKETPLACES y no del listing —que es un
 * dato que viene de fuera—.
 */

export const MERCADO_BASE = 'A1RKKUPIHCS9HS'

/**
 * CUÁNTAS REFERENCIAS POR PETICIÓN.
 *
 * Vive aquí y no en la ruta ni en la pantalla porque lo usan LAS DOS: la
 * pantalla para partir la selección y la ruta para rechazar lo que se pase. Con
 * la constante duplicada, subir una y no la otra deja un número de tramo que el
 * servidor rechaza entero, y el fallo sale cuando alguien marca 300 filas.
 *
 * El cupo de Amazon es de cinco por segundo, así que 200 son unos 40 segundos de
 * HTTP abierto: por ahí anda el techo de lo que un proxy aguanta sin cortar.
 */
export const MAX_POR_TRAMO = 200

/** Un destino: su mercado y lo que se le suma al precio de España */
export interface ReglaDestino {
  marketplaceId: string
  pais: string
  /** EN CÉNTIMOS. Ver el comentario de arriba: en euros la suma se corrompe */
  recargoCentimos: number
}

export const DESTINOS: readonly ReglaDestino[] = [
  { marketplaceId: 'A13V1IB3VIYZZH', pais: 'Francia', recargoCentimos: 700 },
  { marketplaceId: 'APJ6JRA9NG5V4', pais: 'Italia', recargoCentimos: 700 },
  { marketplaceId: 'A1PA6795UKMFR9', pais: 'Alemania', recargoCentimos: 600 },
] as const

/** Los que NO entran, con el motivo escrito para poder enseñarlo */
export const EXCLUIDOS: ReadonlyArray<{ marketplaceId: string; pais: string; motivo: string }> = [
  {
    marketplaceId: 'A1F83G8C2ARO7P',
    pais: 'Reino Unido',
    motivo:
      'Vende en libras y esta regla está en euros. Sumar 7 a un precio en libras serían unos ' +
      '8,10 € de recargo sin que ningún aviso lo notara, así que no se puede seleccionar.',
  },
]

export function divisaDe(marketplaceId: string): string | null {
  return AMAZON_MARKETPLACES.find((m) => m.id === marketplaceId)?.currency ?? null
}

export function paisDe(marketplaceId: string): string {
  return AMAZON_MARKETPLACES.find((m) => m.id === marketplaceId)?.label ?? marketplaceId
}

/**
 * ¿Se puede aplicar la regla de este destino sobre la base?
 *
 * La divisa se mira contra la TABLA de marketplaces, no contra el `currency` del
 * listing: ese viene de Amazon y de un espejo que puede estar incompleto, y una
 * referencia con el campo vacío pasaría el filtro sin que nadie lo vea.
 */
export function mismaDivisa(destino: string): boolean {
  const a = divisaDe(MERCADO_BASE)
  const b = divisaDe(destino)
  return a !== null && b !== null && a === b
}

/** Un precio de destino, o null si la base no sirve para calcularlo */
export function precioDestino(base: number | null | undefined, recargoCentimos: number): number | null {
  // `null` NO es cero, y esta guarda es la que impide el fallo caro: sin ella,
  // `Math.round(null * 100) + 700` da 7,00 € y una referencia de 60 € saldría
  // publicada a siete euros. Pasa todas las comprobaciones de abajo porque es un
  // número positivo y perfectamente válido.
  if (base === null || base === undefined) return null
  if (!Number.isFinite(base) || base <= 0) return null
  return (Math.round(base * 100) + recargoCentimos) / 100
}

/**
 * ¿Cuánto sube, en tanto por ciento?
 *
 * Se enseña en cada fila a propósito. Un recargo fijo sobre un catálogo con
 * precios de 1 € a 593 € no sube lo mismo arriba que abajo: sobre 1,07 € son
 * +654 %, sobre 200 € son +3,5 %. Quien pulsa el botón tiene que verlo.
 */
export function subidaPct(base: number, destino: number): number {
  if (base <= 0) return 0
  return Math.round(((destino - base) / base) * 1000) / 10
}
