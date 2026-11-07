import type { ResolutorDePersonas, ResolutorInverso } from './mapeo'

/**
 * QUÉ PERSONA DE NOTION ES CADA PERSONA DEL ERP — PURO.
 *
 * Se resuelve en este orden: (1) la persona enlazada y confirmada por su id de Notion, (2) el mismo nombre completo, (3) el nombre de pila si en el ERP solo se llama así y
 * es único («Daniella» en el ERP, «Daniella Villarroel» en Notion). Si hay duda, no se enlaza: esa persona se queda en `responsables_notion`, sin perderse, hasta que alguien
 * la confirme. Un enlace por nombre nunca se da por confirmado.
 */

export interface PerfilParaEnlazar {
  id: string
  nombre: string
}

export interface EnlaceGuardado {
  perfil_id: string | null
  notion_user_id: string | null
}

const limpio = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

export interface TablaDePersonas {
  deNotion: ResolutorDePersonas
  haciaNotion: ResolutorInverso
  /** Enlaces nuevos deducidos por nombre en esta pasada, para guardarlos sin confirmar */
  nuevos: Array<{ perfil_id: string; notion_user_id: string; notion_nombre: string }>
}

export function tablaDePersonas(perfiles: readonly PerfilParaEnlazar[], enlaces: readonly EnlaceGuardado[]): TablaDePersonas {
  const porNotion = new Map<string, string>()
  const aNotion = new Map<string, string>()
  for (const e of enlaces) {
    if (e.perfil_id && e.notion_user_id) {
      porNotion.set(e.notion_user_id, e.perfil_id)
      if (!aNotion.has(e.perfil_id)) aNotion.set(e.perfil_id, e.notion_user_id)
    }
  }
  const porNombre = new Map<string, string[]>()
  const porNombreDePila = new Map<string, string[]>()
  for (const p of perfiles) {
    const n = limpio(p.nombre)
    if (!n) continue
    porNombre.set(n, [...(porNombre.get(n) ?? []), p.id])
    if (!n.includes(' ')) porNombreDePila.set(n, [...(porNombreDePila.get(n) ?? []), p.id])
  }
  const nuevos: TablaDePersonas['nuevos'] = []

  const deNotion: ResolutorDePersonas = (notionUserId, nombre) => {
    const guardado = porNotion.get(notionUserId)
    if (guardado) return guardado
    if (!nombre) return null
    const n = limpio(nombre)
    const exacto = porNombre.get(n)
    const pila = porNombreDePila.get(n.split(' ')[0])
    const elegido = exacto?.length === 1 ? exacto[0] : !exacto && pila?.length === 1 ? pila[0] : null
    if (!elegido) return null
    porNotion.set(notionUserId, elegido)
    if (!aNotion.has(elegido)) aNotion.set(elegido, notionUserId)
    nuevos.push({ perfil_id: elegido, notion_user_id: notionUserId, notion_nombre: nombre })
    return elegido
  }
  return { deNotion, haciaNotion: (perfilId) => aNotion.get(perfilId) ?? null, nuevos }
}
