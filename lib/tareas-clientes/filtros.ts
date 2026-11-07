import type { FiltrosDeTareas, OpcionDeEstado, TareaTC } from './tipos'

/**
 * QUÉ TAREAS SE VEN, EN QUÉ ORDEN Y AGRUPADAS DE QUÉ MANERA — PURO.
 *
 * Los filtros no tocan los datos: la lista completa se queda en la pantalla y esto devuelve la parte que se pinta. Así cambiar de filtro es instantáneo y no hay nada
 * que pedir al servidor.
 */

type Filtrable = Pick<TareaTC, 'titulo' | 'estado' | 'departamento' | 'responsables' | 'responsables_notion' | 'etiquetas'>

const limpio = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

export function filtrarTareas<T extends Filtrable>(tareas: readonly T[], f: FiltrosDeTareas, miId: string, estados: readonly OpcionDeEstado[], nombreDe: (id: string) => string): T[] {
  const texto = limpio(f.busqueda.trim())
  const hechas = new Set(estados.filter((e) => e.grupo === 'hecho').map((e) => e.nombre))
  return tareas.filter((t) => {
    if (f.ocultarHechas && hechas.has(t.estado)) return false
    if (f.soloMias && !t.responsables.includes(miId)) return false
    if (f.responsables.length > 0 && !f.responsables.some((r) => t.responsables.includes(r))) return false
    if (f.departamentos.length > 0 && !(t.departamento && f.departamentos.includes(t.departamento))) return false
    if (texto) {
      const pajar = limpio([t.titulo, t.estado, t.departamento ?? '', ...t.etiquetas, ...t.responsables.map(nombreDe), ...t.responsables_notion.map((r) => r.nombre)].join(' '))
      if (!pajar.includes(texto)) return false
    }
    return true
  })
}

/** ¿Hay algún filtro puesto? Para enseñar el botón «Quitar filtros» */
export const hayFiltros = (f: FiltrosDeTareas): boolean => Boolean(f.busqueda.trim() || f.responsables.length || f.departamentos.length || f.ocultarHechas || f.soloMias)

export interface GrupoDeTareas<T> {
  clave: string
  nombre: string
  tareas: T[]
}

/** Las tareas por grupos, en el orden que se pida; un grupo sin tareas no sale */
export function agruparTareas<T extends Pick<TareaTC, 'estado' | 'departamento' | 'responsables' | 'cliente_id'>>(
  tareas: readonly T[],
  por: FiltrosDeTareas['agruparPor'],
  orden: { estados: readonly string[]; nombreDePersona: (id: string) => string; nombreDeCliente: (id: string) => string }
): Array<GrupoDeTareas<T>> {
  const mapa = new Map<string, GrupoDeTareas<T>>()
  const poner = (clave: string, nombre: string, t: T) => {
    const g = mapa.get(clave) ?? { clave, nombre, tareas: [] }
    g.tareas.push(t)
    mapa.set(clave, g)
  }
  for (const t of tareas) {
    if (por === 'estado') poner(t.estado, t.estado, t)
    else if (por === 'departamento') poner(t.departamento ?? '', t.departamento ?? 'Sin departamento', t)
    else if (por === 'cliente') poner(t.cliente_id, orden.nombreDeCliente(t.cliente_id), t)
    else if (t.responsables.length === 0) poner('', 'Sin asignar', t)
    else for (const r of t.responsables) poner(r, orden.nombreDePersona(r), t)
  }
  const grupos = [...mapa.values()]
  if (por === 'estado') {
    const pos = (c: string) => {
      const i = orden.estados.indexOf(c)
      return i < 0 ? 999 : i
    }
    grupos.sort((a, b) => pos(a.clave) - pos(b.clave))
  } else {
    // Lo que no tiene valor, al final; el resto por nombre
    grupos.sort((a, b) => (a.clave === '' ? 1 : b.clave === '' ? -1 : a.nombre.localeCompare(b.nombre, 'es')))
  }
  return grupos
}

/** Ordena las tareas por su fecha (las que no tienen, al final) y, a igual fecha, por su sitio en el tablero */
export function porFecha<T extends Pick<TareaTC, 'fecha_inicio' | 'orden'>>(tareas: readonly T[]): T[] {
  return [...tareas].sort((a, b) => {
    const x = a.fecha_inicio?.slice(0, 10) ?? '9999-99-99'
    const y = b.fecha_inicio?.slice(0, 10) ?? '9999-99-99'
    return x === y ? Number(a.orden) - Number(b.orden) : x < y ? -1 : 1
  })
}
