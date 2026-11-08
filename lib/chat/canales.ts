import type { CanalChat, PersonaChat } from './tipos'

/** Los dos ids ordenados: es la clave de un mensaje directo, la misma pregunte quien pregunte */
export const claveDeDirecto = (a: string, b: string): string => [a, b].sort().join(':')

export const NOMBRE_MAX = 40

/**
 * El nombre de un canal tal como se guarda: en minúsculas, sin «#», con guiones en vez de espacios y solo letras, números, «-» y «_». `null` si no queda nada.
 * «#Ventas España» → «ventas-españa».
 */
export function normalizarNombreDeCanal(entrada: unknown): string | null {
  if (typeof entrada !== 'string') return null
  const limpio = entrada
    .normalize('NFC')
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, NOMBRE_MAX)
  return limpio.length > 0 ? limpio : null
}

/** Cómo se llama un canal en pantalla: «# ventas», «🔒 secreto» o el nombre de la otra persona en un directo */
export function nombreVisible(canal: Pick<CanalChat, 'tipo' | 'nombre' | 'miembros'>, yo: string, personas: ReadonlyMap<string, PersonaChat> | ((id: string) => PersonaChat | undefined)): string {
  if (canal.tipo !== 'directo') return canal.nombre ?? 'sin nombre'
  const buscar = typeof personas === 'function' ? personas : (id: string) => personas.get(id)
  const otro = canal.miembros.find((m) => m !== yo)
  return otro ? buscar(otro)?.nombre ?? 'Alguien del equipo' : 'Alguien del equipo'
}

/** Lo último arriba; sin mensajes, por nombre */
export function ordenarCanales<T extends Pick<CanalChat, 'ultimo_mensaje_en' | 'nombre' | 'creado_en'>>(canales: readonly T[]): T[] {
  return [...canales].sort((a, b) => {
    const fa = Date.parse(a.ultimo_mensaje_en ?? a.creado_en)
    const fb = Date.parse(b.ultimo_mensaje_en ?? b.creado_en)
    if (fa !== fb) return fb - fa
    return (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es')
  })
}

/** Las tres listas de la barra lateral: canales (abiertos y privados a los que pertenezco), directos, y los abiertos a los que aún no me he unido */
export function repartirCanales<T extends Pick<CanalChat, 'tipo' | 'soy_miembro' | 'archivado' | 'ultimo_mensaje_en' | 'nombre' | 'creado_en'>>(canales: readonly T[]) {
  const vivos = canales.filter((c) => !c.archivado)
  return {
    canales: ordenarCanales(vivos.filter((c) => c.tipo !== 'directo' && c.soy_miembro)).sort((a, b) => (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es')),
    directos: ordenarCanales(vivos.filter((c) => c.tipo === 'directo' && c.soy_miembro)),
    sinUnirme: vivos.filter((c) => c.tipo === 'canal' && !c.soy_miembro).sort((a, b) => (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es')),
  }
}

/** Lo que hay sin leer en total (sin contar los canales silenciados, salvo si te mencionan) */
export function totalSinLeer(canales: ReadonlyArray<Pick<CanalChat, 'soy_miembro' | 'silenciado' | 'no_leidos' | 'menciones' | 'archivado'>>): { mensajes: number; menciones: number } {
  let mensajes = 0
  let menciones = 0
  for (const c of canales) {
    if (!c.soy_miembro || c.archivado) continue
    menciones += c.menciones
    if (!c.silenciado) mensajes += c.no_leidos
  }
  return { mensajes, menciones }
}
