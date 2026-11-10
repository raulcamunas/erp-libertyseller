/**
 * EL TABLERO DE REMESAS: una columna por cliente, con sus envíos como tarjetas — los TIPOS y lo puro (se comprueba con tablero.prueba.ts). Lo que lee la base está en tablero-servidor.ts.
 */

export interface TarjetaTablero {
  id: string
  nombre: string | null
  fechaEnvio: string
  referenciaEnvio: string
  estadoAmazon: string | null
  seguimientoError: string | null
  quedan: number
  enviadas: number
  vendidas: number
  noLlegaron: number
  referencias: number
  /** Días que le quedan de stock al ritmo de la última semana. null = no se vende o no hay datos */
  cobertura: number | null
  /** Ventas diarias de los últimos 14 días, para la chispa */
  chispa: number[]
}

export interface ColumnaTablero {
  clienteId: string
  nombre: string
  puedeEditar: boolean
  /** Los envíos reales (enlazados con Amazon), los más recientes primero */
  tarjetas: TarjetaTablero[]
  /** Propuestas en marcha (borrador, aprobada, encajando, lista) */
  propuestas: number
}

/** ¿Sigue vivo? Le queda mercancía. Los agotados se esconden detrás de «Ver agotados» para que no tapen lo que importa */
export const estaVivo = (t: Pick<TarjetaTablero, 'quedan'>): boolean => t.quedan > 0

/** Las tarjetas de una columna, de la que más urge a la que menos: primero las que se agotan pronto, luego por fecha de envío */
export function ordenarTarjetas(tarjetas: readonly TarjetaTablero[]): TarjetaTablero[] {
  const urge = (t: TarjetaTablero) => (t.quedan > 0 && t.cobertura !== null && t.cobertura < 14 ? t.cobertura : Infinity)
  return [...tarjetas].sort((a, b) => urge(a) - urge(b) || b.fechaEnvio.localeCompare(a.fechaEnvio))
}

/** Las columnas con algo vivo o en marcha, primero (y por nombre); las vacías, al final y apagadas */
export function ordenarColumnas(columnas: readonly ColumnaTablero[]): ColumnaTablero[] {
  const peso = (c: ColumnaTablero) => (c.tarjetas.some(estaVivo) || c.propuestas > 0 ? 0 : 1)
  return [...columnas].sort((a, b) => peso(a) - peso(b) || a.nombre.localeCompare(b.nombre, 'es'))
}
