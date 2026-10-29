/**
 * LOS PARTNERS DE COLD CALLING: LO QUE SE DICE DE CADA UNO — PURO.
 * ================================================================
 * Un partner no es un cliente potencial sino un posible socio que nos derive clientes: una agencia de desarrollo ecommerce, una empresa de fulfillment, un registrador de marcas, una
 * gestoría. Viven en `cold_leads` con `tipo_lead = 'partner'` (migración 262) para tener GRATIS todo el seguimiento de siempre —estado, rellamada, historial, llamadas de Rinkel,
 * correo, WhatsApp— y lo que cambia es cómo se enseñan: sus datos son los de Google Maps (prioridad, puntos, valoración, enlaces) y no hay facturación ni «¿vende en Amazon?».
 *
 * Aquí está lo que decide qué se dice de cada uno, para que la lista, la ficha, la tabla y el filtro hablen igual y para poder comprobarlo con pruebas.
 */

import type { TonoEstado } from '@/lib/estilo/denso'
import type { ColdLead } from '@/lib/types/cold-leads'

/** La prioridad de un partner: es lo que decide a quién se llama primero. El criterio viene de la columna «Prioridad» del Excel de la captación */
export const PRIORIDADES_DE_PARTNER: Record<1 | 2 | 3 | 4, { corta: string; etiqueta: string; tono: TonoEstado; pista: string }> = {
  1: { corta: 'P1', etiqueta: 'Llamar primero', tono: 'verde', pista: 'Tiene teléfono y correo: es de los primeros a los que llamar' },
  2: { corta: 'P2', etiqueta: 'Segunda ronda', tono: 'ambar', pista: 'Se le puede llamar, pero después de los de «Llamar primero»' },
  3: { corta: 'P3', etiqueta: 'Solo email', tono: 'gris', pista: 'Sin teléfono, o persona física (no se llama en frío): se le escribe por correo' },
  4: { corta: 'P4', etiqueta: 'Revisar (posible competencia)', tono: 'rojo', pista: 'Puede ser competencia: míralo antes de contactarle' },
}

export function esPrioridadDePartner(v: unknown): v is 1 | 2 | 3 | 4 {
  return v === 1 || v === 2 || v === 3 || v === 4
}

/** El orden de la lista y de las preferencias: las cuatro prioridades, de la que se llama primero a la que se revisa */
export const ORDEN_DE_PRIORIDADES: ReadonlyArray<1 | 2 | 3 | 4> = [1, 2, 3, 4]

/** Cuántos hay de cada prioridad. Solo cuenta partners; dentro de la lista elegida (la prioridad solo tiene sentido en una lista de partners) */
export function contarPrioridadesDe(leads: ReadonlyArray<Pick<ColdLead, 'tipo_lead' | 'prioridad' | 'source_list'>>, lista: string, listaDe: (l: Pick<ColdLead, 'source_list'>) => string): Record<1 | 2 | 3 | 4, number> {
  const c: Record<1 | 2 | 3 | 4, number> = { 1: 0, 2: 0, 3: 0, 4: 0 }
  for (const l of leads) {
    if (l.tipo_lead !== 'partner') continue
    if (lista !== 'all' && listaDe(l) !== lista) continue
    if (esPrioridadDePartner(l.prioridad)) c[l.prioridad] += 1
  }
  return c
}

/**
 * Una dirección web que se puede abrir. Solo http y https: el dato viene de un Excel y de la web de cada negocio, y un `javascript:` o un `data:` en un enlace sería ejecutar lo que
 * ponga ahí. Sin protocolo («www.ejemplo.es») se le pone https. Cualquier otra cosa da null y el enlace no se pinta.
 */
export function urlSegura(valor: string | null | undefined): string | null {
  const t = (valor ?? '').trim()
  if (!t) return null
  const conProtocolo = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`
  try {
    const u = new URL(conProtocolo)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

/** «aeuroweb.com»: el dominio de una web, sin protocolo, sin «www.» y sin lo que lleve detrás (las de Google Maps traen utm_source y demás). Para enseñarlo en una celda */
export function dominioDeWeb(valor: string | null | undefined): string | null {
  const u = urlSegura(valor)
  if (!u) return null
  return new URL(u).hostname.replace(/^www\./i, '') || null
}

/** «@aeuroweb» o el final de la dirección de su LinkedIn, para el texto del enlace */
export function textoDeLinkedin(valor: string | null | undefined): string | null {
  const u = urlSegura(valor)
  if (!u) return null
  const ruta = new URL(u).pathname.replace(/\/+$/, '').split('/').filter(Boolean)
  const i = ruta.findIndex((p) => p === 'company' || p === 'in')
  const nombre = i >= 0 ? ruta[i + 1] : ruta[ruta.length - 1]
  return nombre ? decodeURIComponent(nombre) : 'LinkedIn'
}

/** «4,8 · 385 reseñas». Sin valoración, solo las reseñas; sin ninguna de las dos, null */
export function valoracionDe(rating: number | null | undefined, resenas: number | null | undefined): string | null {
  const r = rating == null ? null : Number(rating)
  const n = resenas == null ? null : Number(resenas)
  const partes: string[] = []
  if (r != null && Number.isFinite(r) && r > 0) partes.push(r.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
  if (n != null && Number.isFinite(n) && n >= 0 && (partes.length > 0 || n > 0)) partes.push(`${n.toLocaleString('es-ES')} ${n === 1 ? 'reseña' : 'reseñas'}`)
  return partes.length > 0 ? partes.join(' · ') : null
}

/** Las búsquedas de Google Maps con las que se encontró: «agencia Shopify, diseño tiendas online» -> dos etiquetas, sin vacías ni repetidas */
export function busquedasDeOrigen(texto: string | null | undefined): string[] {
  const vistas = new Set<string>()
  const salida: string[] = []
  for (const trozo of (texto ?? '').split(',')) {
    const t = trozo.replace(/\s+/g, ' ').trim()
    const clave = t.toLowerCase()
    if (t && !vistas.has(clave)) {
      vistas.add(clave)
      salida.push(t)
    }
  }
  return salida
}

/** El nombre del segmento sin el prefijo de la lista: «Partners - Gestorías» -> «Gestorías» */
export function segmentoDeLista(lista: string | null | undefined): string | null {
  const t = (lista ?? '').trim()
  if (!t) return null
  return t.replace(/^partners\s*[-–·:]\s*/i, '') || t
}
