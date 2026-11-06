import { createClient } from '@supabase/supabase-js'

/**
 * Cliente de Supabase con service_role (bypass RLS).
 * SOLO usar en el servidor (rutas API, webhooks). Nunca en el cliente.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Next 14 guarda estas lecturas en su caché aunque la página sea `force-dynamic`: el informe público de un cliente
    // seguía enseñando las cifras viejas después de actualizarlo, hasta el siguiente despliegue.
    global: { fetch: (entrada, opciones) => fetch(entrada, { ...opciones, cache: 'no-store' }) },
  })
}
