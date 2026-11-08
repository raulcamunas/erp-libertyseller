/**
 * LOS TEMAS DEL CHAT — PURO.
 *
 * Cada persona elige cómo ve el chat: el color, el fondo de la zona de mensajes, si los mensajes van en burbujas o en filas, y cuánto ocupan. Es solo cosa suya y de ese navegador (no cambia
 * lo que ven los demás). Se guarda en el almacenamiento local; aquí vive lo que se puede elegir y cómo se limpia lo que se lee, para que un valor viejo o roto no deje el chat sin estilo.
 * El claro u oscuro lo sigue decidiendo el ERP: el tema solo pone el color y el fondo encima.
 */

import { FONDOS_DEL_CHAT } from './fondos'

export interface TemaDeColor {
  id: string
  nombre: string
  /** El color principal (botones, menciones, marcas) */
  acento: string
  /** Un segundo color que acompaña al principal en los fondos con degradado */
  acentoDos: string
  /** Lo que se escribe encima del acento (negro o blanco, según cuánto brille) */
  tinta: string
}

export const TEMAS: readonly TemaDeColor[] = [
  { id: 'liberty', nombre: 'Liberty', acento: '#FF6600', acentoDos: '#FFB347', tinta: '#14161A' },
  { id: 'oceano', nombre: 'Océano', acento: '#3B82F6', acentoDos: '#06B6D4', tinta: '#FFFFFF' },
  { id: 'bosque', nombre: 'Bosque', acento: '#22A06B', acentoDos: '#A3E635', tinta: '#06210F' },
  { id: 'atardecer', nombre: 'Atardecer', acento: '#EC4899', acentoDos: '#F59E0B', tinta: '#FFFFFF' },
  { id: 'violeta', nombre: 'Violeta', acento: '#8B5CF6', acentoDos: '#EC4899', tinta: '#FFFFFF' },
  { id: 'grafito', nombre: 'Grafito', acento: '#8A93A3', acentoDos: '#CBD0D8', tinta: '#0F1114' },
]

export interface OpcionDeAjuste<T extends string> {
  id: T
  nombre: string
  detalle?: string
}

/** El id de un fondo de lib/chat/fondos.ts */
export type FondoDelChat = string
export type EstiloDeMensajes = 'filas' | 'burbujas'
export type DensidadDelChat = 'comoda' | 'compacta'
export type TextoDelChat = 'normal' | 'grande'

export const FONDOS: ReadonlyArray<OpcionDeAjuste<FondoDelChat>> = FONDOS_DEL_CHAT.map((f) => ({ id: f.id, nombre: f.nombre }))
export const ESTILOS: ReadonlyArray<OpcionDeAjuste<EstiloDeMensajes>> = [
  { id: 'filas', nombre: 'Filas', detalle: 'Como Slack' },
  { id: 'burbujas', nombre: 'Burbujas', detalle: 'Como WhatsApp' },
]
export const DENSIDADES: ReadonlyArray<OpcionDeAjuste<DensidadDelChat>> = [
  { id: 'comoda', nombre: 'Cómoda' },
  { id: 'compacta', nombre: 'Compacta' },
]
export const TEXTOS: ReadonlyArray<OpcionDeAjuste<TextoDelChat>> = [
  { id: 'normal', nombre: 'Normal' },
  { id: 'grande', nombre: 'Grande' },
]

export interface AjustesDelChat {
  tema: string
  fondo: FondoDelChat
  estilo: EstiloDeMensajes
  densidad: DensidadDelChat
  texto: TextoDelChat
}

export const AJUSTES_POR_DEFECTO: AjustesDelChat = { tema: 'liberty', fondo: 'aurora', estilo: 'filas', densidad: 'comoda', texto: 'normal' }

export const CLAVE_DE_ALMACENAMIENTO = 'chat:apariencia'

const entre = <T extends string>(valor: unknown, opciones: ReadonlyArray<{ id: T }>, porDefecto: T): T => (opciones.some((o) => o.id === valor) ? (valor as T) : porDefecto)

/** Lo leído del almacenamiento, limpio: lo que falte o esté roto vuelve al valor de siempre */
export function limpiarAjustes(bruto: unknown): AjustesDelChat {
  const d = AJUSTES_POR_DEFECTO
  if (!bruto || typeof bruto !== 'object') return { ...d }
  const b = bruto as Record<string, unknown>
  return {
    tema: entre(b.tema, TEMAS, d.tema),
    fondo: entre(b.fondo, FONDOS, d.fondo),
    estilo: entre(b.estilo, ESTILOS, d.estilo),
    densidad: entre(b.densidad, DENSIDADES, d.densidad),
    texto: entre(b.texto, TEXTOS, d.texto),
  }
}

export function leerAjustes(texto: string | null | undefined): AjustesDelChat {
  if (!texto) return { ...AJUSTES_POR_DEFECTO }
  try {
    return limpiarAjustes(JSON.parse(texto))
  } catch {
    return { ...AJUSTES_POR_DEFECTO }
  }
}

export const temaDe = (id: string): TemaDeColor => TEMAS.find((t) => t.id === id) ?? TEMAS[0]

/**
 * Las variables de CSS del tema. El tema «Liberty» no pone nada: usa el naranja del propio ERP, así sigue las dos variantes (clara y oscura) sin tocarlas.
 */
export function variablesDeTema(ajustes: AjustesDelChat): Record<string, string> {
  if (ajustes.tema === 'liberty') return {}
  const t = temaDe(ajustes.tema)
  return { '--c-acc': t.acento, '--c-acc-dos': t.acentoDos, '--c-tinta': t.tinta }
}
