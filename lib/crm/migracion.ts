/**
 * ¿LA MIGRACIÓN DEL HUB ESTÁ LANZADA? Las migraciones de este ERP se lanzan a mano en el editor SQL de Supabase y el código llega antes: una pantalla que lee tablas nuevas
 * tiene que saber distinguir «esa tabla todavía no existe» (un aviso, no un fallo) de «la consulta ha fallado de verdad». Es puro y lo usan el servidor y el navegador.
 */

export const FALTA_MIGRACION_258 = 'Falta lanzar en el editor SQL de Supabase la migración 258_crm_hub_fases_y_notas_de_reunion.sql (crea las notas de Gemini y el historial de fases del CRM).'

/** ¿El error de PostgREST/Postgres es «esa tabla o columna no existe»? */
export function esTablaInexistente(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null | undefined
  return e?.code === '42P01' || e?.code === '42703' || e?.code === 'PGRST205' || e?.code === 'PGRST204' || /does not exist|schema cache|Could not find the .* (table|column)/i.test(e?.message ?? '')
}
