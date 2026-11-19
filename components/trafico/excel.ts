import { buyBox, conversion, diasDe, diasEntre, juegoDe, matriz, mesesEntre, nombreDeMes, porJuego, precioMedio, sumarTodas, type FilaAgregada } from '@/lib/trafico/calculo'
import type { DatosDelPanel } from '@/lib/trafico/servidor'

/**
 * EL EXCEL DE LO QUE SE ESTÁ VIENDO: las mismas hojas que el Excel que se mandaba a mano (resumen, por juego, por ASIN, unidades por día, por mes y los datos de
 * partida), calculadas con el periodo y la comparación elegidos en la página. Se genera en el navegador con SheetJS (cargado solo al pulsar el botón).
 */
export async function descargarExcel(d: DatosDelPanel, textoPeriodo: string, textoComparacion: string | null) {
  const XLSX = await import('xlsx')
  const libro = XLSX.utils.book_new()
  const p = d.periodo
  const nP = diasEntre(p.desde, p.hasta)
  const tP = sumarTodas(p.total)
  const tC = d.comparacion ? sumarTodas(d.comparacion.total) : null
  const nC = d.comparacion ? diasEntre(d.comparacion.desde, d.comparacion.hasta) : null
  const hoja = (nombre: string, filas: unknown[][], anchos?: number[]) => {
    const h = XLSX.utils.aoa_to_sheet(filas)
    if (anchos) h['!cols'] = anchos.map((w) => ({ wch: w }))
    XLSX.utils.book_append_sheet(libro, h, nombre.slice(0, 31))
  }
  const r4 = (x: number | null) => (x == null ? null : Math.round(x * 10000) / 10000)
  const r2 = (x: number | null) => (x == null ? null : Math.round(x * 100) / 100)

  hoja(
    'Resumen',
    [
      [`${d.titulo} · Tráfico y conversión por juego`],
      [textoPeriodo + (textoComparacion ? ` · comparado con ${textoComparacion}` : '')],
      [],
      ['Métrica', 'Periodo', textoComparacion ? 'Comparación' : null],
      ['Días del periodo', nP, nC],
      ['Sesiones', tP.sesiones, tC?.sesiones ?? null],
      ['Sesiones al día', r2(tP.sesiones / nP), tC && nC ? r2(tC.sesiones / nC) : null],
      ['Unidades', tP.unidades, tC?.unidades ?? null],
      ['Unidades al día', r2(tP.unidades / nP), tC && nC ? r2(tC.unidades / nC) : null],
      ['Conversión', r4(conversion(tP)), tC ? r4(conversion(tC)) : null],
      ['Ventas encargadas', r2(tP.ventas), tC ? r2(tC.ventas) : null],
      ['Ventas al día', r2(tP.ventas / nP), tC && nC ? r2(tC.ventas / nC) : null],
      ['Precio medio por unidad', r2(precioMedio(tP)), tC ? r2(precioMedio(tC)) : null],
      ['Buy Box medio (ponderado por visitas)', r4(buyBox(tP)), tC ? r4(buyBox(tC)) : null],
    ],
    [38, 16, 16]
  )

  const juegos = porJuego(p.total, d.juegos)
  const comp = d.comparacion ? new Map(porJuego(d.comparacion.total, d.juegos).map((j) => [j.juego, j.cifras])) : new Map()
  hoja(
    'Por juego',
    [
      ['Juego', 'Sesiones', 'Sesiones al día', 'Sesiones al día (comparación)', 'Unidades', 'Ventas', 'Conversión', 'Conversión (comparación)', 'Buy Box', 'Visitas'],
      ...juegos.map((j) => {
        const c = comp.get(j.juego)
        return [j.juego + (j.varios ? ' *' : ''), j.cifras.sesiones, r2(j.cifras.sesiones / nP), c && nC ? r2(c.sesiones / nC) : null, j.cifras.unidades, r2(j.cifras.ventas), r4(conversion(j.cifras)), c ? r4(conversion(c)) : null, r4(buyBox(j.cifras)), j.cifras.visitas]
      }),
      ['Total tienda', tP.sesiones, r2(tP.sesiones / nP), tC && nC ? r2(tC.sesiones / nC) : null, tP.unidades, r2(tP.ventas), r4(conversion(tP)), tC ? r4(conversion(tC)) : null, r4(buyBox(tP)), tP.visitas],
      [],
      ['* Suma las ediciones en otros idiomas y las variantes de color del juego.'],
    ],
    [40, 11, 14, 16, 10, 12, 11, 14, 10, 10]
  )

  hoja(
    'Por ASIN',
    [
      ['Juego', 'ASIN hijo', 'Producto', 'Sesiones', 'Visitas', '% Buy Box', 'Unidades', 'Ventas', 'Conversión'],
      ...juegos.flatMap((j) => j.asins.map((a) => [j.juego, a.asin, a.producto ?? '', a.cifras.sesiones, a.cifras.visitas, r4(buyBox(a.cifras)), a.cifras.unidades, r2(a.cifras.ventas), r4(conversion(a.cifras))])),
    ],
    [32, 13, 60, 10, 10, 10, 10, 12, 11]
  )

  const dias = diasDe(p.desde, p.hasta)
  const m = matriz(p.dias, d.juegos)
  const ordenJuegos = juegos.map((j) => j.juego)
  hoja('Unidades por día', [['Juego', ...dias], ['Total tienda', ...dias.map((x) => m.total.get(x)?.unidades ?? null)], ...ordenJuegos.map((j) => [j, ...dias.map((x) => m.porJuego.get(j)?.get(x)?.unidades || null)])], [32])
  hoja('Sesiones por día', [['Fecha', 'Sesiones', 'Navegador', 'App móvil', 'Unidades', 'Ventas'], ...dias.map((x) => { const c = m.total.get(x); return [x, c?.sesiones ?? 0, c?.navegador ?? 0, c?.app ?? 0, c?.unidades ?? 0, r2(c?.ventas ?? 0)] })], [12, 10, 11, 10, 10, 11])

  const meses = d.meses.length ? mesesEntre(d.meses.map((f) => f.clave).sort()[0] + '-01', d.meses.map((f) => f.clave).sort().slice(-1)[0] + '-01') : []
  const mm = matriz(d.meses, d.juegos)
  const diasDelMes = (mes: string) => (d.ultimoDia && mes === d.ultimoDia.slice(0, 7) ? Number(d.ultimoDia.slice(8, 10)) : new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate())
  const juegosMes = [...mm.porJuego.keys()].sort((a, b) => sumarTodas([...(mm.porJuego.get(b)?.values() ?? [])]).unidades - sumarTodas([...(mm.porJuego.get(a)?.values() ?? [])]).unidades)
  const cab = ['Juego', ...meses.map(nombreDeMes)]
  hoja('Unidades por mes', [cab, ['Días del periodo', ...meses.map(diasDelMes)], ['Total tienda', ...meses.map((x) => mm.total.get(x)?.unidades ?? null)], ...juegosMes.map((j) => [j, ...meses.map((x) => mm.porJuego.get(j)?.get(x)?.unidades || null)])], [32])
  hoja('Sesiones al día por mes', [cab, ['Total tienda', ...meses.map((x) => r2((mm.total.get(x)?.sesiones ?? 0) / diasDelMes(x)))], ...juegosMes.map((j) => [j, ...meses.map((x) => { const c = mm.porJuego.get(j)?.get(x); return c?.sesiones ? r2(c.sesiones / diasDelMes(x)) : null })])], [32])
  hoja('Conversión por mes', [cab, ['Total tienda', ...meses.map((x) => { const c = mm.total.get(x); return c ? r4(conversion(c)) : null })], ...juegosMes.map((j) => [j, ...meses.map((x) => { const c = mm.porJuego.get(j)?.get(x); return c ? r4(conversion(c)) : null })])], [32])

  hoja(
    'Datos',
    [['Fecha', 'Juego', 'ASIN', 'Sesiones', 'Navegador', 'App móvil', 'Visitas', '% Buy Box', 'Unidades', 'Pedidos', 'Ventas'], ...[...p.dias].sort((a, b) => a.clave.localeCompare(b.clave) || a.asin.localeCompare(b.asin)).map((f: FilaAgregada) => [f.clave, juegoDe(f.asin, d.juegos), f.asin, f.sesiones, f.navegador, f.app, f.visitas, r4(buyBox(f)), f.unidades, f.pedidos, r2(f.ventas)])],
    [12, 30, 13]
  )

  XLSX.writeFile(libro, `${d.titulo.replace(/[^\p{L}\p{N} ]/gu, '').trim().replace(/\s+/g, '-')}-trafico-${p.desde}-a-${p.hasta}.xlsx`)
}
