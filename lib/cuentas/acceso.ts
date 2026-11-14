/**
 * QUIÉN LLEVA LAS CUENTAS DE LOS CLIENTES — Cuentas, Marketing Test, SEO Test y Cumplimiento.
 *
 * Hasta el 14 nov 2026 las cuatro eran SOLO ADMIN. Ese día Raúl decidió que la persona de marketing deja de llevarlas y que las llevan los
 * administrativos (puesto «Gestión Administrativa»): SEO, PPC, cumplimiento e informes, de principio a fin y con LIBERTAD TOTAL en Amazon (aprueban
 * y aplican cambios sin pasar por un administrador). Por eso se abren como Tax Reports: persona a persona, con la casilla de cada app en
 * Gestión de Usuarios.
 *
 * Quién entra:
 *   · un administrador, siempre; un CEO (admin con puesto 'ceo'), solo con la casilla, como en el resto del ERP (lib/usuarios/ceo.ts);
 *   · un empleado, solo con la casilla de esa app;
 *   · un partner o un cliente, NUNCA, ni con casilla: son gente de fuera de la agencia (un cliente con rol partner vería las cuentas de los demás).
 *
 * El filtro de verdad está en las rutas de API (en middleware.ts todo lo de /api/ es público), que pasan por requireAppDeCuentas(); el middleware y
 * el redirect de cada página evitan el viaje. Los datos se leen siempre con el cliente de servicio, así que no hay RLS que abrir.
 *
 * Lo que sigue SOLO ADMIN aunque se lleve una cuenta: Amazon API (las llaves de las tiendas y conectar cuentas) y Growth Partner.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fail, type AmazonSession } from '@/lib/amazon/api'
import { esCeo } from '@/lib/usuarios/ceo'

export const APP_CUENTAS = 'cuentas'
export const APPS_DE_CUENTAS = [APP_CUENTAS, 'marketing-test', 'seo-test', 'cumplimiento'] as const
export type AppDeCuentas = (typeof APPS_DE_CUENTAS)[number]

/** PURO. ¿Abre esta app? `tieneCasilla` = su fila en user_app_permissions con can_access */
export function puedeLlevarCuentas(rol: string | null | undefined, puesto: string | null | undefined, tieneCasilla: boolean): boolean {
  if (rol === 'admin') return !esCeo(rol, puesto) || tieneCasilla
  if (rol === 'employee') return tieneCasilla
  return false
}

type Supa = Awaited<ReturnType<typeof createClient>>

/** SOLO SERVIDOR. Para el redirect de cada página: ¿abre esta app quien tiene la sesión? */
export async function entraEnApp(supabase: Supa, userId: string, rol: string | null | undefined, puesto: string | null | undefined, app: AppDeCuentas): Promise<boolean> {
  if (rol === 'admin' && !esCeo(rol, puesto)) return true
  if (rol !== 'admin' && rol !== 'employee') return false
  const { data } = await supabase.from('user_app_permissions').select('can_access').eq('user_id', userId).eq('app_id', app).maybeSingle()
  return puedeLlevarCuentas(rol, puesto, Boolean((data as { can_access?: boolean } | null)?.can_access))
}

/** SOLO SERVIDOR. La guarda de las rutas de API de las cuatro apps. Devuelve la sesión con la misma forma que requireAmazonAdmin() */
export async function requireAppDeCuentas(app: AppDeCuentas): Promise<AmazonSession | NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail(401, 'Hay que iniciar sesión')
  const { data: perfil } = await supabase.from('profiles').select('role, puesto').eq('id', user.id).maybeSingle()
  const p = perfil as { role: string | null; puesto: string | null } | null
  const role = p?.role ?? 'employee'
  if (!(await entraEnApp(supabase, user.id, role, p?.puesto ?? null, app))) {
    return fail(403, 'No tienes concedida esta aplicación. Pídesela a un administrador.')
  }
  return { supabase, userId: user.id, role }
}
