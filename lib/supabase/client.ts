import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  
  // Durante el build, si las variables no están disponibles, usar valores placeholder
  // Esto solo afecta el pre-renderizado, no el runtime
  if (!supabaseUrl || !supabaseAnonKey) {
    // Valores placeholder solo para el build
    return createBrowserClient(
      supabaseUrl || 'https://placeholder.supabase.co',
      supabaseAnonKey || 'placeholder-key',
      {
        realtime: {
          params: {
            eventsPerSecond: 10,
          },
        },
      }
    )
  }
  
  const client = createBrowserClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    }
  )
  return client
}
