/** Contrato de pantallas del módulo Remesas (spec remesas-pro §11.6). Solo tipos. */
import type { SaludCliente } from '@/lib/fba/plan-tipos'

export type VistaRemesas = 'hoy' | 'plan' | 'cliente' | 'tablero' | 'alertas'
export type SeccionCliente = 'resumen' | 'stock' | 'ventas' | 'reposicion' | 'envios' | 'lotes' | 'propuestas' | 'base'

export interface SesionRemesas {
  usuarioId: string
  rol: 'admin' | 'employee' | 'cliente'
  actor: 'agencia' | 'cliente'
  esAgencia: boolean
  esAdmin: boolean
  /** null = todos los clientes */
  clientesPermitidos: string[] | null
  /** Clientes donde puede editar (null = todos los permitidos) */
  editables: string[] | null
}

export interface ClienteRemesas {
  id: string; nombre: string
  tieneCatalogo: boolean
  /** Mercado de la lectura elegida (de dónde se leen las ventas) */
  mercadoLectura: string | null
  /** Mercado con el que se crean remesas (D20) */
  mercadoRemesa: string
  moneda: string
  conectado: boolean
  salud: SaludCliente | null
  contadores: { envios: number; propuestas: number; enviosNuevos: number }
  puedeEditar: boolean
}

export type IrA = (vista: VistaRemesas, seccion?: SeccionCliente, params?: Record<string, string>) => void

export interface CallbacksRemesas {
  onAbrirEnvioPropuesto: (id: string) => void
  onIrA: IrA
  onPropuestaAMedida: (clienteId: string) => void
  onImportarPedidos: (clienteId: string) => void
}

export interface AjustesReposicionProps {
  clienteId: string; clienteNombre: string; puedeEditar: boolean; compacto?: boolean; alGuardar?: () => void
}

export interface PanelEnvioPropuestoProps {
  envioId: string | null; onCerrar(): void; onConvertida(remesaId: string, clienteId: string): void
}
