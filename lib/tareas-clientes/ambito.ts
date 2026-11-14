/**
 * EL ÁMBITO DE UN ESPACIO DE TRABAJO: un cliente, «Todas las tareas» «Mis tareas» o «Mi día». Sale de la dirección (`/dashboard/tareas-clientes/<cliente | todas | mis-tareas>`).
 *
 * Cambiar de ámbito NO pide nada al servidor: el espacio ya tiene todas las tareas de todos los clientes y solo cambia el filtro. Por eso la dirección se cambia con
 * `history.pushState` (Next lo sigue en `usePathname`) en vez de con `router.push`, que obligaba a renderizar la página en el servidor (comprobar la sesión otra vez,
 * leer el perfil…) y a montar de nuevo toda la pantalla: de 3 a 5 segundos por cambio.
 */

export type Ambito = { tipo: 'cliente'; id: string } | { tipo: 'todas' } | { tipo: 'mias' } | { tipo: 'dia' }

const RAIZ = '/dashboard/tareas-clientes'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** El ámbito de una dirección del módulo; null si no es la de un espacio de trabajo (el inicio, otra aplicación…) */
export function ambitoDeRuta(ruta: string | null | undefined): Ambito | null {
  if (!ruta) return null
  const m = new RegExp(`^${RAIZ}/([^/?#]+)/?$`).exec(ruta.split('?')[0].split('#')[0])
  if (!m) return null
  if (m[1] === 'todas') return { tipo: 'todas' }
  if (m[1] === 'mis-tareas') return { tipo: 'mias' }
  if (m[1] === 'mi-dia') return { tipo: 'dia' }
  return UUID.test(m[1]) ? { tipo: 'cliente', id: m[1].toLowerCase() } : null
}

export function rutaDeAmbito(a: Ambito): string {
  return a.tipo === 'todas' ? `${RAIZ}/todas` : a.tipo === 'mias' ? `${RAIZ}/mis-tareas` : a.tipo === 'dia' ? `${RAIZ}/mi-dia` : `${RAIZ}/${a.id}`
}

export const mismoAmbito = (a: Ambito, b: Ambito): boolean => a.tipo === b.tipo && (a.tipo !== 'cliente' || (b.tipo === 'cliente' && a.id === b.id))
