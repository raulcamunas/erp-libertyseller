'use client'

import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { Gravedad } from '@/lib/cumplimiento/tipos'

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
