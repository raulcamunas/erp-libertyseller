/**
 * Distribuye eventos que se solapan en columnas, al estilo Google
 * Calendar/Outlook: agrupa por "clusters" de solapamiento transitivo y
 * asigna cada evento a la primera columna libre dentro de su cluster.
 */
export interface LayoutResult<T> {
  event: T
  col: number
  totalCols: number
}

export function layoutOverlappingEvents<T>(
  events: T[],
  getStart: (e: T) => number,
  getEnd: (e: T) => number
): LayoutResult<T>[] {
  const sorted = [...events].sort((a, b) => getStart(a) - getStart(b))
  const result: LayoutResult<T>[] = []
  let i = 0

  while (i < sorted.length) {
    let clusterEnd = getEnd(sorted[i])
    let j = i + 1
    while (j < sorted.length && getStart(sorted[j]) < clusterEnd) {
      clusterEnd = Math.max(clusterEnd, getEnd(sorted[j]))
      j++
    }

    const cluster = sorted.slice(i, j)
    const columnEnds: number[] = []
    const clusterResult: LayoutResult<T>[] = []

    for (const ev of cluster) {
      let col = columnEnds.findIndex((end) => end <= getStart(ev))
      if (col === -1) {
        col = columnEnds.length
        columnEnds.push(getEnd(ev))
      } else {
        columnEnds[col] = getEnd(ev)
      }
      clusterResult.push({ event: ev, col, totalCols: 0 })
    }

    const totalCols = columnEnds.length
    clusterResult.forEach((r) => (r.totalCols = totalCols))
    result.push(...clusterResult)
    i = j
  }

  return result
}
