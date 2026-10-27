import type { SupabaseClient } from '@supabase/supabase-js'
import { almacenDeSupabase, esTablaInexistente, FALTA_MIGRACION_NOTAS } from './almacen'
import { fuenteDeGoogleReal, googleEstaConfigurado } from './google'
import { sincronizarNotasDeGemini, type ResultadoDeSincronizacion } from './sincronizar'

/**
 * UNA PASADA DE SINCRONIZACIÓN, CON LAS PIEZAS DE VERDAD, Y EL TEXTO QUE SE ENSEÑA DE ELLA.
 * =========================================================================================
 * Lo comparten la ruta del cron y el botón «Sincronizar ahora» de la pantalla: las dos hacen exactamente lo mismo y solo cambia quién las lanza.
 *
 * SON DOS PASOS Y NO UNO, A PROPÓSITO: primero `motivoParaSaltar` (¿está Google configurado? ¿está lanzada la migración?) y después `pasadaDeNotas`. La ruta del cron envuelve
 * SOLO la segunda en `conRegistro`, que abre la fila del registro ANTES de trabajar: eso es lo que impide que, mientras una pasada larga (puede llegar a cuatro minutos) sigue
 * en marcha, el cron del minuto siguiente arranque otra encima y gaste la IA dos veces en la misma nota. Un «todavía no» (sin Google o sin migración) no es una pasada y no
 * se registra.
 */

/** Por qué NO se puede hacer una pasada ahora (null = se puede). No es un error: es un «todavía no» */
export async function motivoParaSaltar(db: SupabaseClient): Promise<string | null> {
  if (!googleEstaConfigurado()) return 'Google no está configurado en el servidor (GOOGLE_SA_CLIENT_EMAIL, GOOGLE_SA_PRIVATE_KEY, GOOGLE_IMPERSONATE_SUBJECT)'
  // Una consulta de nada para saber si la migración está lanzada
  const { error } = await db.from('crm_notas_reunion').select('id').limit(1)
  if (error && esTablaInexistente(error)) return FALTA_MIGRACION_NOTAS
  if (error) throw new Error(error.message)
  return null
}

export interface PasadaDeNotas {
  resultado: ResultadoDeSincronizacion
  resumen: string
}

/** Una línea para el registro de Sistema y para la pantalla: lo que ha pasado, y si algo necesita que alguien haga algo, qué */
export function resumenDeLaPasada(r: ResultadoDeSincronizacion): string {
  let texto = [`${r.nuevas} nuevas`, `${r.ignoradas} internas`, `${r.completadas} completadas`, `${r.recasadas} casadas`, `${r.analizadas} analizadas`].join(' · ')
  if (r.detenida) texto += ` · PARADA: ${r.detenida}`
  else if (r.avisos.length > 0) texto += ` · AVISO: ${r.avisos[0]}`
  return texto
}

export async function pasadaDeNotas(db: SupabaseClient): Promise<PasadaDeNotas> {
  const resultado = await sincronizarNotasDeGemini(fuenteDeGoogleReal(), almacenDeSupabase(db))
  return { resultado, resumen: resumenDeLaPasada(resultado) }
}
