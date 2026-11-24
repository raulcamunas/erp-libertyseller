/**
 * REHACER INFORMES YA HECHOS (24 nov 2026, Raúl): los «sin Amazon» de tiendas multimarca se hicieron como si la tienda fuera una marca
 * («tu marca no está en Amazon») y había que rehacerlos con el enfoque de reventa. Se rehacen en la MISMA fila (mismo enlace: el lead que
 * ya lo tiene ve el nuevo), desde la recogida del servidor, con el saldo de Keepa compartido con los informes nuevos.
 *
 * rehacer.json (Storage, bucket analisis-keepa): { pendientes, ultimoFueRehacer, hechos, fallidos }.
 *  - fase 'primero': van delante de todo menos de los urgentes (los leads ya contactados).
 *  - fase 'mezcla': uno rehecho por cada informe nuevo; si no hay nuevos que hacer, seguidos.
 * Si uno no sale (web caída, nada en Amazon…), se queda el informe de antes y se apunta en `fallidos`.
 */
export interface PorRehacer {
  lead: string
  /** id de la fila de analisis_amazon que se sobrescribe */
  fila: string
  tienda: string
  fase: 'primero' | 'mezcla'
}

export interface ListaRehacer {
  pendientes: PorRehacer[]
  ultimoFueRehacer?: boolean
  hechos?: number
  fallidos?: Array<{ lead: string; tienda: string; motivo: string; at: string }>
}

export const FICHERO_REHACER = 'rehacer.json'

export function listaValida(x: unknown): ListaRehacer {
  const l = (x && typeof x === 'object' ? x : {}) as Partial<ListaRehacer>
  return { ...l, pendientes: Array.isArray(l.pendientes) ? l.pendientes : [] }
}

/** ¿Toca rehacer ahora? Los 'primero' siempre; los de 'mezcla', si el último no fue rehecho o no hay nada nuevo que hacer */
export function siguienteRehacer(l: ListaRehacer, hayNuevo: boolean): PorRehacer | null {
  const primero = l.pendientes.find((p) => p.fase === 'primero')
  if (primero) return primero
  const mezcla = l.pendientes.find((p) => p.fase === 'mezcla')
  if (!mezcla) return null
  return !l.ultimoFueRehacer || !hayNuevo ? mezcla : null
}

/** Quita el ya intentado y apunta el resultado. `motivo` = no ha salido (se queda el de antes) */
export function trasRehacer(l: ListaRehacer, p: PorRehacer, motivo: string | null, at: string): ListaRehacer {
  const pendientes = l.pendientes.filter((x) => !(x.lead === p.lead && x.fila === p.fila))
  return motivo === null
    ? { ...l, pendientes, ultimoFueRehacer: true, hechos: (l.hechos ?? 0) + 1 }
    : { ...l, pendientes, ultimoFueRehacer: true, fallidos: [...(l.fallidos ?? []), { lead: p.lead, tienda: p.tienda, motivo: motivo.slice(0, 200), at }].slice(-300) }
}
