/** dd/mm/aa, o un guion si no hay fecha */
export function fecha(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a.slice(2)}`
}

/** Verde con margen, ámbar cuando aprieta, rojo cuando ya no da tiempo */
export function colorDeCobertura(dias: number | null): string {
  if (dias === null) return 'text-white/30'
  if (dias <= 14) return 'text-red-400'
  if (dias <= 30) return 'text-amber-400'
  return 'text-emerald-400'
}
