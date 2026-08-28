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
 * LO QUE SALE A LA PANTALLA, EXACTAMENTE, Y EN ESTE ORDEN:
 *
 *   1. Un AmazonApiError sale con su `humanMessage`: está escrito en español,
 *      dice qué hacer y NUNCA lleva dentro el token ni las credenciales — eso
 *      está cuidado en lib/amazon/errors.ts.
 *
 *   2. CUALQUIER OTRO `Error` SALE CON SU `message` TAL CUAL, en un 400. Esto
 *      es deliberado y hay medio ERP apoyado en ello: las validaciones de
 *      negocio se escriben como `throw new Error('Hay que decir por qué se
 *      cancela el trabajo')` y llegan a la pantalla por aquí. Quitarlo
 *      convertiría una docena de mensajes útiles en «vuelve a intentarlo».
 *
 *   3. Lo que no es un `Error` —los errores de PostgREST, que son objetos
 *      planos— se registra y sale como un 500 genérico.
 *
 * DE AHÍ SE SIGUE UNA REGLA: una ruta cuyo cuerpo o cuyo proceso maneje una
 * CONTRASEÑA de un cliente NO PUEDE TERMINAR AQUÍ su caso genérico, porque el
 * punto 2 reenviaría el texto de un error de `ssh2` o de la librería de cifrado
 * sin que nadie lo haya tachado. Esas rutas ponen su propio `console.error` y su
 * propia frase fija: ver app/api/stock-sync/perfiles/[id]/credencial y
 * .../explorar.
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

/**
 * Como `requireAmazonAdmin`, pero admitiendo también a quien tenga concedida una
 * app concreta.
 *
 * PARA QUÉ, Y POR QUÉ NO VALE EL DE ADMIN A SECAS.
 *
 * `requireAmazonAdmin` guarda las rutas que CAMBIAN cosas en la tienda de un
 * cliente —precios, stock, ofertas— y ahí el listón de admin es el correcto.
 * Pero hay pantallas que solo LEEN y que se reparten con el permiso de la app:
 * los informes de publicidad los saca quien lleva las campañas, que no es el
 * admin.
 *
 * Con el gate de admin en esas rutas pasaba algo que no parece un fallo de
 * permisos: la app salía en el menú, la pantalla se abría, y todo lo que pedía
 * contestaba 403. Se lee como «no va».
 *
 * El rol y el permiso se leen de la BASE con la sesión de quien llama, nunca del
 * cuerpo de la petición: un {"role":"admin"} en el JSON no convierte a nadie en
 * admin.
 */
export async function requireAppAccess(appId: string): Promise<AmazonSession | NextResponse> {
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
  if (role === 'admin' || role === 'partner') return { supabase, userId: user.id, role }

  const { data: permiso } = await supabase
    .from('user_app_permissions')
    .select('can_access')
    .eq('user_id', user.id)
    .eq('app_id', appId)
    .maybeSingle()

  if (!permiso?.can_access) {
    return fail(403, 'No tienes concedida esta aplicación. Pídesela a un administrador.')
  }

  return { supabase, userId: user.id, role }
}

/** Texto obligatorio del cuerpo, recortado y con tope */
export function readText(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().slice(0, max)
  return v === '' ? null : v
}
