/**
 * EL BUSCADOR DEL INICIO EN EL MÓVIL — PURO, se comprueba con buscar.prueba.ts.
 * Sin tildes ni mayúsculas («facturacion» encuentra «Facturación»). Cada palabra de la búsqueda tiene que salir en algún sitio (nombre, nombre corto,
 * grupo o descripción). Primero las que EMPIEZAN por lo buscado, luego las que lo llevan en el nombre, luego por el grupo y por último por la descripción;
 * a igualdad, el orden de entrada (el del menú).
 */

export interface AppBuscable {
  id: string
  name: string
  nombreCorto?: string
  description?: string
  /** El nombre del grupo del menú en el que va («Contabilidad»…) */
  grupo?: string
}

export function normalizar(texto: string): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('es')
    .replace(/\s+/g, ' ')
    .trim()
}

function puntos(app: AppBuscable, palabras: readonly string[]): number {
  const nombre = normalizar(`${app.name} ${app.nombreCorto ?? ''}`)
  const grupo = normalizar(app.grupo ?? '')
  const desc = normalizar(app.description ?? '')
  let total = 0
  for (const p of palabras) {
    const enNombre = nombre.split(' ').some((w) => w.startsWith(p))
    if (enNombre) total += 4
    else if (nombre.includes(p)) total += 3
    else if (grupo.includes(p)) total += 2
    else if (desc.includes(p)) total += 1
    else return 0
  }
  return total
}

export function buscarApps<A extends AppBuscable>(apps: readonly A[], consulta: string): A[] {
  const palabras = normalizar(consulta).split(' ').filter(Boolean)
  if (palabras.length === 0) return [...apps]
  return apps
    .map((app, i) => ({ app, i, p: puntos(app, palabras) }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p || a.i - b.i)
    .map((x) => x.app)
}
