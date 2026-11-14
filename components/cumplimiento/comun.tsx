'use client'

import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { Gravedad, Nivel } from '@/lib/cumplimiento/tipos'

export const COLOR_GRAVEDAD: Record<Gravedad, string> = { error: COLOR_ESTADO.rojo, aviso: COLOR_ESTADO.ambar, info: COLOR_ESTADO.azul }
export const TEXTO_GRAVEDAD: Record<Gravedad, string> = { error: 'Error', aviso: 'Aviso', info: 'Info' }

/** El puntito de color de la gravedad, alineado con la primera línea del texto */
export function ColorDeGravedad({ gravedad }: { gravedad: Gravedad }) {
  return <span aria-label={TEXTO_GRAVEDAD[gravedad]} title={TEXTO_GRAVEDAD[gravedad]} className="mt-[6px] h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: COLOR_GRAVEDAD[gravedad], boxShadow: `0 0 0 3px color-mix(in srgb, ${COLOR_GRAVEDAD[gravedad]} 18%, transparent)` }} />
}

/** «hace 3 h», «hace 12 días»… */
export function haceTiempo(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (!Number.isFinite(s)) return '—'
  if (s < 90) return 'hace un momento'
  if (s < 3600) return `hace ${Math.round(s / 60)} min`
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`
  const d = Math.round(s / 86400)
  return d === 1 ? 'hace 1 día' : `hace ${d} días`
}

/** El color de cada importancia: lo que bloquea en rojo, la normativa en violeta (como su tarjeta del panel), lo demás apagado */
export const COLOR_NIVEL: Record<Nivel, string> = { bloquea: COLOR_ESTADO.rojo, normativa: COLOR_ESTADO.violeta, afecta: COLOR_ESTADO.ambar, menor: 'var(--ls-t4)' }

/**
 * El plazo que da Amazon, en palabras y con su color: vencido (rojo: puede retirarlo cualquier día), en menos de 30
 * días (ámbar) o más lejos (gris). `hoy` llega de fuera para que se pueda probar.
 */
export function textoPlazo(plazo: string, hoy = new Date()): { texto: string; color: string } {
  const t = Date.parse(`${plazo}T00:00:00Z`)
  const fecha = new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const dias = Math.ceil((t - hoy.getTime()) / 86_400_000)
  if (dias < 0) return { texto: `Plazo de Amazon vencido el ${fecha}`, color: COLOR_ESTADO.rojo }
  if (dias <= 30) return { texto: `Plazo: ${fecha} (${dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días`})`, color: COLOR_ESTADO.ambar }
  return { texto: `Plazo: ${fecha}`, color: 'var(--ls-t3)' }
}
