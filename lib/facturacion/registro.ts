import { createServiceClient } from '@/lib/supabase/service'
import type { TipoRegistro } from './tipos'

/**
 * DEJAR RASTRO DE LO QUE SE HA HECHO.
 *
 * Se llama DESPUÉS de escribir en Zoho, así que nunca revienta: si falla, lo
 * hecho en Zoho ya está hecho y decirle al usuario que ha fallado le haría
 * repetirlo. Va al log del servidor y se sigue.
 */
export async function registrar(
  quien: { userId: string; nombre: string | null },
  fila: {
    tipo: TipoRegistro
    zohoId?: string | null
    numero?: string | null
    cliente?: string | null
    treasuryClientId?: string | null
    period?: string | null
    importe?: number | null
    moneda?: string | null
    detalle?: Record<string, unknown>
  }
): Promise<void> {
  try {
    const { error } = await createServiceClient()
      .from('facturacion_registro')
      .insert({
        tipo: fila.tipo,
        zoho_id: fila.zohoId ?? null,
        numero: fila.numero ?? null,
        cliente: fila.cliente ?? null,
        treasury_client_id: fila.treasuryClientId ?? null,
        period: fila.period ?? null,
        importe: fila.importe ?? null,
        moneda: fila.moneda ?? null,
        detalle: fila.detalle ?? {},
        hecho_por: quien.userId,
        hecho_por_nombre: quien.nombre,
      })
    if (error) console.error('No se ha podido guardar el registro de facturación:', error.message)
  } catch (e) {
    console.error('No se ha podido guardar el registro de facturación:', e)
  }
}
