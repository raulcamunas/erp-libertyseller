import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { AmazonApiError } from './errors'

/**
 * QUIÉN PUEDE TOCAR LAS RUTAS DE /api/amazon
 * ==========================================
 * SOLO SERVIDOR.
 *
 * EL AGUJERO QUE ESTE FICHERO TAPA
 * --------------------------------
 * middleware.ts cierra /dashboard/amazon-api a los admins, pero ese bloque solo
 * se evalúa sobre rutas que empiezan por /dashboard: a /api/amazon/** NO LLEGA
 * NUNCA. Peor: en el propio middleware, todo lo que empieza por /api/ está en
 * la lista de rutas públicas, así que una ruta de API que no compruebe nada
 * contesta a cualquiera, con sesión o sin ella. Es el mismo agujero que
 * documenta lib/vacations/api.ts, y aquí importa más: por estas rutas se
 * generan enlaces que enganchan tiendas de clientes y se destruyen llaves de
 * acceso.
 *
 * Por eso cada ruta empieza con requireAmazonAdmin(), sin excepciones.
 *
 * Y el rol se lee de la BASE DE DATOS con la sesión de quien llama, nunca del
 * cuerpo de la petición ni de una cabecera: un {"role":"admin"} en el JSON no
 * convierte a nadie en admin.
 */

export type AmazonSupabase = Awaited<ReturnType<typeof createClient>>

export interface AmazonSession {
  supabase: AmazonSupabase
  userId: string
  role: string
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function fail(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

/**
 * Convierte cualquier fallo en una respuesta que se pueda leer.
 *
 * Los AmazonApiError salen con su mensaje: están escritos en español, dicen qué
 * hacer y NUNCA llevan dentro el token ni las credenciales — eso está cuidado
 * en lib/amazon/errors.ts. Todo lo demás (un error de Postgres, por ejemplo)
 * se registra y sale como un 500 genérico: su texto no le dice nada a nadie y a
 * veces lleva nombres de columnas.
 */
export function errorResponse(error: unknown, context: string): NextResponse {
  console.error(`${context}:`, error)
  if (error instanceof AmazonApiError) {
    return fail(error.kind === 'config' ? 503 : 502, error.humanMessage)
  }
  if (error instanceof Error && error.message) {
    return fail(400, error.message)
  }
  return fail(
    500,
    'No se ha podido completar la operación. Vuelve a intentarlo y avisa si sigue fallando'
  )
}

/**
 * Sesión iniciada Y rol admin, o la respuesta de error ya montada.
 *
 * No hay una variante «cualquiera con permiso a la app» como en vacaciones, y
 * es deliberado: este módulo entero es solo-admin (decisión A), así que una
 * segunda puerta más baja solo serviría para que alguien la usara por error.
 * El permiso de user_app_permissions ni se mira — un admin lo tiene por la
 * migración 118, y para quien no es admin no hay nada que consultar.
 */
export async function requireAmazonAdmin(): Promise<AmazonSession | NextResponse> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail(401, 'Hay que iniciar sesión')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const role = profile?.role ?? 'employee'
  if (role !== 'admin') {
    return fail(
      403,
      'Solo un administrador puede gestionar las conexiones de Amazon: desde aquí se cambian precios y stock en las tiendas de los clientes'
    )
  }

  return { supabase, userId: user.id, role }
}

/** Texto obligatorio del cuerpo, recortado y con tope */
export function readText(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().slice(0, max)
  return v === '' ? null : v
}
