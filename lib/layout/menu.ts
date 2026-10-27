/**
 * CÓMO SE AGRUPA EL MENÚ LATERAL — SOLO CÁLCULO, SIN REACT NI ICONOS.
 * ===================================================================
 * Va aparte del componente (components/layout/AppSidebar.tsx) para poder comprobarlo con menu.prueba.ts sin montar nada.
 *
 * Dos entradas del menú son DESPLEGABLES que reúnen varias aplicaciones («Contabilidad», «Herramientas Agencia»; lib/config/apps.ts: GRUPOS_DEL_MENU). Son solo una
 * forma de ordenar el menú: NO tienen permiso propio. Quien ve una aplicación dentro de un grupo es quien ya la veía antes (su casilla en Gestión de Usuarios, o ser
 * administrador en las que son solo de administradores); el grupo existe para quien ve al menos dos de sus aplicaciones.
 *
 *   · Un grupo sin ninguna aplicación visible no sale.
 *   · Un grupo con UNA sola aplicación visible no sale como grupo: sale esa aplicación suelta, donde le tocaba. Un desplegable de una sola entrada es un clic de más.
 *   · Un grupo con dos o más sale como una entrada que se despliega, colocada justo detrás de la aplicación que dice `despuesDe` (si esa persona no la ve, donde le
 *     tocaría a la primera de las suyas), con las aplicaciones dentro en el orden en que el grupo las declara.
 *   · El orden del resto del menú no cambia: es el de `apps`.
 */

export interface GrupoParaElMenu {
  id: string
  /** Los ids de las aplicaciones que viven dentro, en el orden en que se enseñan */
  apps: readonly string[]
  /** Se pinta justo detrás de la entrada de esta aplicación (si esa persona la ve) */
  despuesDe?: string
}

export type EntradaDelMenu<A extends { id: string }, G extends GrupoParaElMenu> = { tipo: 'app'; app: A } | { tipo: 'grupo'; grupo: G; apps: A[] }

export function armarMenu<A extends { id: string }, G extends GrupoParaElMenu>(visibles: readonly A[], grupos: readonly G[]): Array<EntradaDelMenu<A, G>> {
  const grupoDe = new Map<string, G>()
  for (const g of grupos) for (const id of g.apps) if (!grupoDe.has(id)) grupoDe.set(id, g)

  // Las aplicaciones de cada grupo que esta persona ve, en el orden del grupo
  const miembros = new Map<string, A[]>()
  for (const g of grupos) {
    const lista: A[] = []
    for (const id of g.apps) {
      const app = visibles.find((a) => a.id === id)
      if (app && grupoDe.get(id) === g) lista.push(app)
    }
    miembros.set(g.id, lista)
  }

  // La base: todo lo que no va dentro de un desplegable, en el orden de siempre (también la aplicación que se queda sola de su grupo)
  const base: Array<EntradaDelMenu<A, G>> = []
  const orden = new Map(visibles.map((a, i) => [a.id, i]))
  for (const app of visibles) {
    const g = grupoDe.get(app.id)
    if (g && (miembros.get(g.id)?.length ?? 0) >= 2) continue
    base.push({ tipo: 'app', app })
  }

  // Los grupos que sí se despliegan, cada uno en su sitio
  for (const g of grupos) {
    const apps = miembros.get(g.id) ?? []
    if (apps.length < 2) continue
    const entrada: EntradaDelMenu<A, G> = { tipo: 'grupo', grupo: g, apps }

    let indice = -1
    if (g.despuesDe) {
      // Detrás de esa aplicación y de los grupos que ya se hayan puesto detrás de ella, para que se queden en el orden en que se declaran
      const ancla = base.findIndex((e) => e.tipo === 'app' && e.app.id === g.despuesDe)
      if (ancla >= 0) {
        indice = ancla + 1
        while (indice < base.length && base[indice].tipo === 'grupo') indice += 1
      }
    }
    if (indice < 0) {
      // Donde le tocaría a su primera aplicación: antes de la primera entrada suelta que viene detrás de ella en el orden de siempre
      const primera = orden.get(apps[0].id) ?? Number.MAX_SAFE_INTEGER
      const siguiente = base.findIndex((e) => e.tipo === 'app' && (orden.get(e.app.id) ?? -1) > primera)
      indice = siguiente < 0 ? base.length : siguiente
    }
    base.splice(indice, 0, entrada)
  }
  return base
}

/** Las aplicaciones del menú, una detrás de otra en el orden en que se ven (las de dentro de un grupo, en su sitio) */
export function aplanarMenu<A extends { id: string }, G extends GrupoParaElMenu>(menu: ReadonlyArray<EntradaDelMenu<A, G>>): A[] {
  const salida: A[] = []
  for (const e of menu) {
    if (e.tipo === 'app') salida.push(e.app)
    else salida.push(...e.apps)
  }
  return salida
}

/** El id del grupo que contiene la aplicación con esa ruta, o null si está suelta (o no es de ningún grupo que se despliegue) */
export function grupoDeLaRuta<A extends { id: string; route: string }, G extends GrupoParaElMenu>(menu: ReadonlyArray<EntradaDelMenu<A, G>>, ruta: string | null): string | null {
  if (ruta === null) return null
  for (const e of menu) if (e.tipo === 'grupo' && e.apps.some((a) => a.route === ruta)) return e.grupo.id
  return null
}

/**
 * Qué pantallas cuelgan de otra aunque no tengan entrada propia en el menú: estando en ellas se enciende la de su madre. «Actividad del equipo» ya no está en el
 * menú —se llega desde Mi rendimiento— y, mientras se mira, el que se enciende es Mi rendimiento.
 */
export const PANTALLAS_QUE_CUELGAN_DE: Readonly<Record<string, string>> = {
  '/dashboard/actividad': '/dashboard/rendimiento',
}

/** La ruta con la que se busca la entrada encendida: la de la pantalla en la que se está, o la de la que cuelga */
export function rutaParaElMenu(actual: string): string {
  const limpia = (actual ?? '').split(/[?#]/)[0].replace(/\/+$/, '') || '/'
  for (const [hija, madre] of Object.entries(PANTALLAS_QUE_CUELGAN_DE)) {
    if (limpia === hija || limpia.startsWith(`${hija}/`)) return madre
  }
  return actual
}
