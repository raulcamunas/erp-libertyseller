import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { urlBaseApp } from '@/lib/url-app'

/**
 * LA PUERTA DE SALIDA DEL CIERRE POR INACTIVIDAD.
 *
 * Aquí llega un empleado cuya sesión ha caducado por llevar un rato sin hacer nada: lo manda el layout del dashboard cuando
 * abre el ERP tras una pausa larga (app/dashboard/layout.tsx) y el navegador cuando la pestaña llevaba parada el tiempo
 * (components/actividad/RegistroDeActividad.tsx). Cierra la sesión de ESTE navegador —no la de otros dispositivos— y lo
 * lleva al inicio de sesión con el motivo, para que la pantalla se lo explique.
 *
 * Vive en /auth/, que el middleware deja pasar con o sin sesión (solo /auth/login rebota a quien ya la tiene): sin eso, el
 * layout lo mandaría aquí, el middleware lo devolvería al escritorio y daría vueltas.
 *
 * SE BORRAN A MANO LAS COOKIES DE SESIÓN ADEMÁS DE PEDIR EL CIERRE. Si por lo que fuera la sesión quedara viva, el
 * middleware vería a alguien con sesión en /auth/login, lo mandaría al escritorio, el layout lo volvería a mandar aquí y
 * sería un bucle sin salida. Borrar las `sb-*` lo hace imposible.
 *
 * La dirección de destino sale de urlBaseApp() y no de las cabeceras de la petición (lib/url-app.ts explica por qué).
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  try {
    // 'local': solo esta sesión del navegador. La que tuviera abierta en otro sitio no se toca
    await supabase.auth.signOut({ scope: 'local' })
  } catch (error) {
    console.warn('[actividad] no se ha podido cerrar la sesión por inactividad', { mensaje: error instanceof Error ? error.message : 'desconocido' })
  }

  const respuesta = NextResponse.redirect(new URL('/auth/login?motivo=inactividad', urlBaseApp()))
  try {
    for (const { name } of (await cookies()).getAll()) {
      if (name.startsWith('sb-')) respuesta.cookies.set(name, '', { path: '/', maxAge: 0 })
    }
  } catch {
    // lo que haya hecho signOut ya vale; esto es el cinturón además de los tirantes
  }
  return respuesta
}
