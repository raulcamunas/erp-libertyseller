import { redirect } from 'next/navigation'

/**
 * La «Liquidación del mes» ya vive dentro del panel de Comisiones (clientes a la izquierda, detalle a la derecha). Esta dirección se
 * queda solo para que los enlaces y marcadores antiguos no den un 404.
 */
export default function LiquidacionPage() {
  redirect('/dashboard/commissions')
}
