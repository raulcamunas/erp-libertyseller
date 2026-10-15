import { createServiceClient } from '@/lib/supabase/service'

/**
 * LAS CUENTAS DE AMAZON DE UN CLIENTE.
 * SOLO SERVIDOR.
 *
 * Es el único sitio por el que el módulo de cumplimiento pasa de «un cliente» a
 * «unas conexiones»: la pantalla y las rutas mandan un cliente y nunca un
 * identificador de conexión, así que no se puede pedir la cuenta de otro.
 */

export interface ConexionRevisable {
  id: string
  marketplace_ids: string[]
  marketplaces_activos?: string[] | null
}

/** Las conexiones activas de un cliente (casi siempre es una) */
export async function conexionesDeCliente(amazonClientId: string): Promise<ConexionRevisable[]> {
  const { data, error } = await createServiceClient()
    .from('amazon_connections')
    .select('id, marketplace_ids, marketplaces_activos')
    .eq('client_id', amazonClientId)
    .eq('is_active', true)
    .eq('status', 'activa')
  if (error) throw error
  return (data ?? []) as ConexionRevisable[]
}
