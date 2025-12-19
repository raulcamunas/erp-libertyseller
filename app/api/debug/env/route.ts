import { NextResponse } from 'next/server'

/**
 * Endpoint de debug para verificar variables de entorno
 * GET /api/debug/env
 */
export async function GET() {
  // No exponer valores completos por seguridad, solo indicar si existen
  const envVars = {
    WISE_API_KEY: {
      exists: !!process.env.WISE_API_KEY,
      length: process.env.WISE_API_KEY?.length || 0,
      firstChars: process.env.WISE_API_KEY ? process.env.WISE_API_KEY.substring(0, 5) + '...' : 'N/A'
    },
    WISE_PROFILE_ID: {
      exists: !!process.env.WISE_PROFILE_ID,
      value: process.env.WISE_PROFILE_ID || 'N/A'
    },
    NEXT_PUBLIC_SUPABASE_URL: {
      exists: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      hasValue: !!process.env.NEXT_PUBLIC_SUPABASE_URL
    },
    // Listar todas las variables que empiezan con WISE
    allWiseVars: Object.keys(process.env)
      .filter(k => k.startsWith('WISE'))
      .map(k => ({
        key: k,
        exists: true,
        length: process.env[k]?.length || 0
      }))
  }

  return NextResponse.json({
    success: true,
    environment: process.env.NODE_ENV,
    vars: envVars,
    allEnvKeys: Object.keys(process.env).filter(k => k.includes('WISE') || k.includes('SUPABASE'))
  })
}


