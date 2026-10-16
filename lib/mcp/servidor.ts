import { createClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { urlBaseApp } from '@/lib/url-app'
import { autenticar, type DepsAuth } from './auth'
import { HERRAMIENTAS, INSTRUCCIONES, type ContextoMcp } from './herramientas'
import { crearLimitador } from './limite'
import { crearManejadorMcp } from './manejador'
import { clienteDeArgs, registrarLlamada } from './registro'

/**
 * EL CONECTOR, CON SUS DEPENDENCIAS DE VERDAD.
 * SOLO SERVIDOR. Lo importan las dos rutas de app/api/mcp; todo lo que se puede
 * probar sin red está en los otros ficheros de esta carpeta.
 */

export const VERSION_CONECTOR = '1.0.0'

const depsAuth: DepsAuth = {
  async verificarToken(jwt) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anon) throw new Error('Faltan las variables de Supabase')
    // Un cliente sin sesión: solo se usa para preguntarle a Supabase por este token
    const supabase = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await supabase.auth.getUser(jwt)
    if (error) {
      // 4xx = Supabase ha contestado que el token no vale. Cualquier otra cosa
      // (red, 5xx) es que no se ha podido preguntar, y no es lo mismo.
      const status = (error as { status?: number }).status
      if (typeof status === 'number' && status >= 400 && status < 500) return null
      throw error
    }
    return data.user ? { id: data.user.id, email: data.user.email ?? null } : null
  },

  async leerRol(userId) {
    const { data, error } = await createServiceClient().from('profiles').select('role').eq('id', userId).maybeSingle()
    if (error) throw error
    return (data as { role: string } | null)?.role ?? null
  },
}

/** 90 llamadas por minuto y persona: de sobra para una conversación, corta un bucle desbocado */
const limitador = crearLimitador({ maximo: 90, ventanaMs: 60_000 })

export const manejadorMcp = crearManejadorMcp<ContextoMcp>({
  baseUrl: urlBaseApp,
  supabaseUrl: () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  autenticar: (authorization) => autenticar(authorization, depsAuth),
  limitador,
  entornoDe: (usuario) => ({
    ctx: { usuario },
    entorno: {
      nombreServidor: 'liberty-seller-erp',
      tituloServidor: 'ERP de Liberty Seller',
      version: VERSION_CONECTOR,
      instrucciones: INSTRUCCIONES,
      herramientas: HERRAMIENTAS,
      alTerminarHerramienta: (info) => {
        void registrarLlamada({
          userId: usuario.id,
          herramienta: info.nombre,
          cliente: clienteDeArgs(info.args),
          esError: info.esError,
          ms: info.ms,
        })
      },
    },
  }),
})
