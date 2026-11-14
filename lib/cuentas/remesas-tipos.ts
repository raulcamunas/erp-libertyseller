/**
 * CUENTAS DE CLIENTES · LA FORMA DE LO QUE SE ENSEÑA DE REMESAS. PURO: lo importan la pantalla (navegador) y lib/cuentas/remesas.ts (servidor),
 * para que el navegador no arrastre el cliente de servicio de Supabase.
 */

export const FASES_ABIERTAS = ['borrador', 'aprobada', 'encajando', 'lista', 'enviada'] as const
export type FaseAbierta = (typeof FASES_ABIERTAS)[number]
export type SeveridadFba = 'critica' | 'alta' | 'media' | 'info'

export interface RemesaAbierta {
  id: string
  nombre: string | null
  estado: FaseAbierta
  /** Estado del envío según Amazon (WORKING, SHIPPED, IN_TRANSIT, RECEIVING…), tal cual. null = sin seguimiento */
  estadoAmazon: string | null
  fechaEnvio: string
  referencia: string | null
  marketplaceId: string
  unidades: number
  actualizada: string | null
}

export interface AlertaFbaResumida {
  id: string
  tipo: string
  severidad: SeveridadFba
  titulo: string
  detalle: string | null
  sku: string | null
  impacto: number
  desde: string
}

export interface StockFba {
  marketplaceId: string
  /** Cuántos países tienen stock leído (en Europa el mismo almacén sale en varios: se enseña el que más tiene, no la suma) */
  mercados: number
  referencias: number
  disponible: number
  total: number
  /** Desglose de la 271. null = sin la migración o sin leer todavía */
  deCamino: number | null
  reservado: number | null
  noApto: number | null
}

export interface ResumenRemesas {
  /** false = quien mira no tiene Remesas de este cliente */
  acceso: boolean
  porFase: Record<FaseAbierta, number>
  abiertas: number
  /** La fecha del último envío real (enviada o cerrada) */
  ultimoEnvio: string | null
  totalRemesas: number
  alertas: Record<SeveridadFba, number>
  /** Falta la migración 267 (alertas) */
  faltaAlertas: boolean
  error: string | null
  /** Solo en el detalle */
  remesas?: RemesaAbierta[]
  listaAlertas?: AlertaFbaResumida[]
  stock?: StockFba | null
}

