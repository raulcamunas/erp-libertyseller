import { Libro, type Estilo, type Hoja } from '@/lib/fba/excel/escritor'
import { LOGO_ALTO_PX, LOGO_ANCHO_PX, logoPng } from '@/lib/fba/excel/logo-marca'
import { COLOR, COLOR_PESTANA, FUENTE } from '@/lib/fba/excel/marca'
import type { FilaMercado } from './mercado'
import { comisionDe, precioMinimoParaMargen, type JuicioDeMercado } from './margenes'

/**
 * EL EXCEL DE «MERCADO Y MARGEN» DE ENTRAIS EN PCCOMPONENTES. PURO: devuelve los bytes del .xlsx (se arma en el navegador).
 *
 * Antes salía con SheetJS, sin formato, y solo con lo que hubiera filtrado en pantalla (con «Competitivos» marcado: 537 de 4.411). Ahora lleva TODO,
 * con la marca de Liberty Seller y repartido en pestañas:
 *
 *   Resumen                 las cifras, cómo se calcula el margen y DE DÓNDE SALE CADA COLUMNA
 *   Todos                   los productos del proveedor que existen en PcComponentes
 *   Competitivos            se puede igualar al más barato y quedarse con el margen objetivo
 *   Por encima del mercado  alguien lo vende más barato de lo que nos sale
 *   Nadie lo vende          existe en PcComponentes pero sin ninguna oferta
 *
 * Las cabeceras van agrupadas y coloreadas por el ORIGEN del dato (proveedor, PcComponentes, comisión estimada, cálculo), para que se vea sin leer de dónde viene cada cifra.
 */

export interface FilaParaExcel extends FilaMercado {
  j: JuicioDeMercado
  publicada: boolean
}

export interface DatosDelExcel {
  filas: FilaParaExcel[]
  margenObjetivo: number
  conEan: number
  existen: number
  actualizadoAt: string | null
  hoy: string
}

const EUR = '#,##0.00 "€"'
const PCT = '0.0%'

/** Los orígenes de los datos, cada uno con su color de cabecera (tonos suaves que se leen sobre blanco) */
const ORIGEN = {
  producto: { titulo: 'EL PRODUCTO', relleno: 'EDE6DC', tinta: COLOR.tinta },
  proveedor: { titulo: 'COSTE · proveedor', relleno: 'DCEBF7', tinta: '1F4E79' },
  pcc: { titulo: 'PCCOMPONENTES · el mercado', relleno: 'E8E0F5', tinta: '4B2E83' },
  comision: { titulo: 'COMISIÓN · estimada del histórico', relleno: 'FBEFE8', tinta: '9A3F07' },
  resultado: { titulo: 'LO QUE QUEDA · cálculo', relleno: 'E2F2E6', tinta: '1E5E32' },
} as const
type Origen = keyof typeof ORIGEN

interface Columna {
  titulo: string
  ancho: number
  origen: Origen
  formato?: string
  h?: 'left' | 'center' | 'right'
  valor: (f: FilaParaExcel) => string | number | null
}

const estado = (f: FilaParaExcel) => (f.precioMin === null ? 'Nadie lo vende' : f.j.competitivo ? 'Competitivo' : 'Por encima del mercado')

function columnas(margen: number): Columna[] {
  const m = `${Math.round(margen * 1000) / 10} %`
  return [
    { titulo: 'SKU', ancho: 10, origen: 'producto', valor: (f) => f.sku },
    { titulo: 'EAN', ancho: 16, origen: 'producto', valor: (f) => f.ean },
    { titulo: 'Producto', ancho: 58, origen: 'producto', valor: (f) => f.titulo },
    { titulo: 'Marca', ancho: 14, origen: 'producto', valor: (f) => f.marca ?? '' },
    { titulo: 'Categoría', ancho: 20, origen: 'producto', valor: (f) => f.categoria ?? '' },
    { titulo: 'Coste (sin IVA)', ancho: 18, origen: 'proveedor', formato: EUR, h: 'right', valor: (f) => f.coste },
    { titulo: 'Precio más bajo (con IVA)', ancho: 15, origen: 'pcc', formato: EUR, h: 'right', valor: (f) => f.precioMin },
    { titulo: 'Tienda más barata', ancho: 20, origen: 'pcc', valor: (f) => f.tiendaMin ?? '' },
    { titulo: 'Tiendas', ancho: 9, origen: 'pcc', h: 'center', valor: (f) => f.ofertas },
    { titulo: 'Comisión %', ancho: 11, origen: 'comision', formato: PCT, h: 'right', valor: (f) => f.j.comision.pct },
    { titulo: 'Comisión fija', ancho: 11, origen: 'comision', formato: EUR, h: 'right', valor: (f) => f.j.comision.fija },
    { titulo: 'Tarifa', ancho: 15, origen: 'comision', valor: (f) => (f.j.comision.porDefecto ? 'Por defecto (prudente)' : 'De su categoría') },
    { titulo: 'Comisión € a ese precio', ancho: 13, origen: 'resultado', formato: EUR, h: 'right', valor: (f) => f.j.alMercado?.comision ?? null },
    { titulo: 'Beneficio € por unidad', ancho: 13, origen: 'resultado', formato: EUR, h: 'right', valor: (f) => f.j.alMercado?.beneficio ?? null },
    { titulo: 'Margen', ancho: 10, origen: 'resultado', formato: PCT, h: 'right', valor: (f) => f.j.alMercado?.margen ?? null },
    { titulo: `Precio mínimo para el ${m}`, ancho: 15, origen: 'resultado', formato: EUR, h: 'right', valor: (f) => f.j.suelo },
    { titulo: 'Estado', ancho: 20, origen: 'resultado', h: 'center', valor: estado },
    { titulo: 'Ya publicada', ancho: 10, origen: 'resultado', h: 'center', valor: (f) => (f.publicada ? 'Sí' : '') },
  ]
}

const fino = { estilo: 'thin' as const, color: COLOR.raya }

function banda(hoja: Hoja, ultimaCol: number, titulo: string, subtitulo: string) {
  hoja.pintar(1, 1, ultimaCol, { relleno: COLOR.naranja })
  hoja.altoFila(1, 5)
  for (const [fila, alto] of [
    [2, 10],
    [3, 30],
    [4, 22],
    [5, 18],
    [6, 10],
  ] as const) {
    hoja.pintar(fila, 1, ultimaCol, { relleno: COLOR.banda })
    hoja.altoFila(fila, alto)
  }
  const anchoLogo = 130
  hoja.imagen = { png: logoPng(), fila: 3, col: 2, desplazamientoX: 0, desplazamientoY: 6, anchoPx: anchoLogo, altoPx: Math.round((anchoLogo * LOGO_ALTO_PX) / LOGO_ANCHO_PX), descripcion: 'Liberty Seller' }
  hoja.poner(4, 2, titulo, { relleno: COLOR.banda, color: COLOR.blanco, nombre: FUENTE.titulo, tam: 15, negrita: true })
  hoja.poner(5, 2, subtitulo, { relleno: COLOR.banda, color: COLOR.apagado, nombre: FUENTE.cuerpo, tam: 10 })
}

function hojaDeTabla(libro: Libro, nombre: string, filas: FilaParaExcel[], d: DatosDelExcel, explicacion: string) {
  const cols = columnas(d.margenObjetivo)
  const hoja = libro.hoja(nombre)
  hoja.colorPestana = COLOR_PESTANA
  hoja.vertical = false
  const primera = 2
  const ultima = primera + cols.length - 1
  hoja.anchoColumna(1, 2)
  cols.forEach((c, i) => hoja.anchoColumna(primera + i, c.ancho))
  hoja.anchoColumna(ultima + 1, 2)
  banda(hoja, ultima + 1, `Entrais en PcComponentes · ${nombre}`, `${filas.length.toLocaleString('es-ES')} productos · ${explicacion} · margen objetivo ${Math.round(d.margenObjetivo * 1000) / 10} % · ${d.hoy}`)

  // Fila de grupos: de dónde sale cada dato
  const filaGrupo = 8
  const filaCab = 9
  let c = primera
  while (c <= ultima) {
    const origen = cols[c - primera].origen
    let fin = c
    while (fin + 1 <= ultima && cols[fin + 1 - primera].origen === origen) fin += 1
    const o = ORIGEN[origen]
    hoja.pintar(filaGrupo, c, fin, { relleno: o.relleno, color: o.tinta, nombre: FUENTE.titulo, tam: 9, negrita: true, h: 'center', v: 'center', izquierda: { estilo: 'thin', color: COLOR.blanco } })
    hoja.poner(filaGrupo, c, o.titulo, { relleno: o.relleno, color: o.tinta, nombre: FUENTE.titulo, tam: 9, negrita: true, h: 'center', v: 'center' })
    hoja.combinar(filaGrupo, c, filaGrupo, fin)
    c = fin + 1
  }
  hoja.altoFila(filaGrupo, 20)

  cols.forEach((col, i) => {
    hoja.poner(filaCab, primera + i, col.titulo, { relleno: COLOR.banda, color: COLOR.blanco, nombre: FUENTE.titulo, tam: 9, negrita: true, h: col.h ?? 'left', v: 'center', ajustar: true, abajo: { estilo: 'medium', color: COLOR.naranja } })
  })
  hoja.altoFila(filaCab, 32)

  const tonoEstado: Record<string, Estilo> = {
    Competitivo: { relleno: 'E2F2E6', color: '1E5E32', negrita: true },
    'Por encima del mercado': { relleno: 'FDF0D8', color: '8A5A00', negrita: true },
    'Nadie lo vende': { relleno: 'EEEEEE', color: '5E5852', negrita: true },
  }

  filas.forEach((f, n) => {
    const fila = filaCab + 1 + n
    const alterna = n % 2 === 1 ? { relleno: COLOR.crema } : {}
    cols.forEach((col, i) => {
      const v = col.valor(f)
      let e: Estilo = { ...alterna, nombre: FUENTE.cuerpo, tam: 10, color: COLOR.tinta, h: col.h ?? 'left', v: 'center', formato: col.formato, abajo: fino }
      if (col.titulo === 'Estado' && typeof v === 'string') e = { ...e, ...tonoEstado[v], h: 'center' }
      if (col.titulo === 'Beneficio € por unidad' && typeof v === 'number') e = { ...e, negrita: true, color: v >= 0 ? '1E5E32' : 'B42318' }
      if (col.titulo === 'Margen' && typeof v === 'number') e = { ...e, color: v >= d.margenObjetivo ? '1E5E32' : v >= 0 ? '8A5A00' : 'B42318' }
      if (col.titulo === 'Tarifa' && f.j.comision.porDefecto) e = { ...e, color: '9A3F07', cursiva: true }
      if ((col.titulo === 'SKU' || col.titulo === 'EAN') && v !== null) e = { ...e, color: COLOR.etiqueta }
      hoja.poner(fila, primera + i, v, e)
    })
  })

  hoja.congelar = { filas: filaCab, columnas: primera + 2 }
  if (filas.length) hoja.filtro = { fila: filaCab, desde: primera, hasta: ultima, hastaFila: filaCab + filas.length }
}

function hojaResumen(libro: Libro, d: DatosDelExcel, grupos: Array<[string, number, string]>) {
  const hoja = libro.hoja('Resumen')
  hoja.colorPestana = COLOR_PESTANA
  const ultima = 6
  hoja.anchoColumna(1, 2)
  hoja.anchoColumna(2, 30)
  hoja.anchoColumna(3, 44)
  hoja.anchoColumna(4, 64)
  hoja.anchoColumna(5, 2)
  hoja.anchoColumna(6, 2)
  banda(hoja, ultima, 'Entrais en PcComponentes · Mercado y margen', `Generado el ${d.hoy}${d.actualizadoAt ? ` · mercado leído el ${d.actualizadoAt.slice(0, 10)}` : ''} · margen objetivo ${Math.round(d.margenObjetivo * 1000) / 10} %`)

  const rotulo: Estilo = { nombre: FUENTE.titulo, tam: 11, negrita: true, color: COLOR.naranja }
  const cuerpo: Estilo = { nombre: FUENTE.cuerpo, tam: 10, color: COLOR.tinta, v: 'top', ajustar: true }
  const nota: Estilo = { nombre: FUENTE.cuerpo, tam: 9, color: COLOR.etiqueta, v: 'top', ajustar: true }

  let f = 8
  hoja.poner(f, 2, 'LAS CIFRAS', rotulo)
  f += 1
  const cifras: Array<[string, number, string]> = [
    ['Productos del proveedor con EAN', d.conEan, 'Los que se pueden buscar en PcComponentes'],
    ['Existen en PcComponentes', d.existen, `${d.conEan ? Math.round((d.existen / d.conEan) * 100) : 0} % del catálogo`],
    ['No existen en PcComponentes', Math.max(0, d.conEan - d.existen), 'No se pueden vender ahí: no están en su catálogo (no van en este Excel)'],
    ...grupos,
  ]
  for (const [t, n, e] of cifras) {
    hoja.poner(f, 2, t, { ...cuerpo, relleno: COLOR.crema, negrita: true, izquierda: { estilo: 'medium', color: COLOR.naranja } })
    hoja.poner(f, 3, n, { ...cuerpo, relleno: COLOR.crema, nombre: FUENTE.titulo, tam: 13, negrita: true, formato: '#,##0', h: 'left' })
    hoja.poner(f, 4, e, { ...nota, relleno: COLOR.crema, v: 'center' })
    hoja.altoFila(f, 22)
    f += 1
  }

  f += 1
  hoja.poner(f, 2, 'CÓMO SE CALCULA', rotulo)
  f += 1
  const calculo = [
    'El comprador paga el precio CON IVA. La comisión de PcComponentes se calcula sobre el precio SIN IVA: comisión = fija + % × (precio ÷ 1,21).',
    'Beneficio por unidad = precio sin IVA − comisión − coste.   Margen = beneficio ÷ precio sin IVA.',
    `«Precio mínimo para el ${Math.round(d.margenObjetivo * 1000) / 10} %» es el precio con IVA a partir del cual se gana ese margen. Si es igual o menor que el precio más bajo del mercado, el producto es «Competitivo».`,
    'NO descuenta las devoluciones (entre un 9 % y un 25 % de lo vendido según el año): el margen real será algo menor.',
  ]
  for (const t of calculo) {
    hoja.poner(f, 2, t, cuerpo)
    hoja.combinar(f, 2, f, 4)
    hoja.altoFila(f, 30)
    f += 1
  }

  f += 1
  hoja.poner(f, 2, 'DE DÓNDE SALE CADA DATO', rotulo)
  f += 1
  const fuentes: Array<[Origen, string, string]> = [
    ['producto', 'Nombre, marca y categoría', 'De la ficha del producto en PcComponentes (su catálogo, buscado por EAN). SKU y EAN son los del proveedor de Entrais.'],
    ['proveedor', 'Coste', 'Del motor de precios de Entrais en Amazon: precio del proveedor + canon + porte, SIN IVA. Es el mismo coste con el que se calculan los precios de Amazon.'],
    ['pcc', 'Precio más bajo, tienda y nº de tiendas', 'De las ofertas que hay hoy en PcComponentes para ese producto (la API de Mirakl de PcComponentes). Es aproximado: PcComponentes no dice cómo elige la oferta destacada.'],
    ['comision', 'Comisión % y fija', 'Estimada del histórico real de ventas de Entrais en PcComponentes, por categoría. Si la categoría no aparece en el histórico, se usa la más alta vista (17 % + 0,70 €), que es la prudente: sale marcada «Por defecto».'],
    ['resultado', 'Beneficio, margen, precio mínimo y estado', 'Calculados aquí con las fórmulas de arriba, vendiendo al precio más bajo del mercado. «Ya publicada»: Entrais ya tiene esa oferta en PcComponentes.'],
  ]
  for (const [o, t, e] of fuentes) {
    const c = ORIGEN[o]
    hoja.poner(f, 2, c.titulo, { ...cuerpo, relleno: c.relleno, color: c.tinta, nombre: FUENTE.titulo, tam: 9, negrita: true, v: 'center' })
    hoja.poner(f, 3, t, { ...cuerpo, negrita: true, v: 'center' })
    hoja.poner(f, 4, e, { ...nota, v: 'center' })
    hoja.altoFila(f, 44)
    f += 1
  }
}

export function excelDeMercado(d: DatosDelExcel): Uint8Array {
  const porBeneficio = [...d.filas].sort((a, b) => (b.j.alMercado?.beneficio ?? -1e9) - (a.j.alMercado?.beneficio ?? -1e9))
  const competitivos = porBeneficio.filter((f) => f.j.competitivo)
  const encima = porBeneficio.filter((f) => f.precioMin !== null && !f.j.competitivo).sort((a, b) => (a.j.sobreElMercado ?? 1e9) - (b.j.sobreElMercado ?? 1e9))
  const nadie = porBeneficio.filter((f) => f.precioMin === null).sort((a, b) => b.coste - a.coste)

  const libro = new Libro()
  libro.titulo = 'Entrais en PcComponentes · Mercado y margen'
  libro.creado = `${d.hoy}T12:00:00Z`
  hojaResumen(libro, d, [
    ['Competitivos', competitivos.length, 'Se puede igualar al más barato y ganar el margen objetivo'],
    ['Por encima del mercado', encima.length, 'Alguien lo vende más barato de lo que nos sale'],
    ['Nadie lo vende', nadie.length, 'Existe en PcComponentes pero sin ninguna oferta'],
  ])
  hojaDeTabla(libro, 'Todos', porBeneficio, d, 'todo lo que existe en PcComponentes, de más a menos beneficio')
  hojaDeTabla(libro, 'Competitivos', competitivos, d, 'de más a menos beneficio por unidad')
  hojaDeTabla(libro, 'Por encima del mercado', encima, d, 'de más cerca a más lejos de ser competitivo')
  hojaDeTabla(libro, 'Nadie lo vende', nadie, d, 'de más a menos coste')
  return libro.empaquetar()
}

/* ================================================================== */
/* EL EXCEL PARA ENTRAIS: EL PRECIO RECOMENDADO Y POR QUÉ              */
/* ================================================================== */

/**
 * Para dárselo al cliente (Domingo, de Entrais). La política, decidida con Raúl el 17 nov 2026:
 *
 *   · Margen MÍNIMO: 10 % del precio sin IVA si el producto cuesta menos de 100 €, 8 % si cuesta 100 € o más (las devoluciones, entre un 9 y un
 *     25 %, se comen un 5 % en lo barato).
 *   · Precio RECOMENDADO: un céntimo por debajo del más barato de PcComponentes (la Buy Box), y nunca por debajo del mínimo. Si nadie lo vende, el mínimo.
 *
 * Cada fila es una suma que cuadra al céntimo: coste (proveedor + canon + porte) + comisión de PcComponentes + beneficio = precio sin IVA; + IVA = precio.
 * Sin vocabulario interno ni promesas.
 */
export const POLITICA_ENTRAIS = { limiteCoste: 100, margenBajo: 0.1, margenAlto: 0.08 } as const

const r2 = (n: number) => Math.round(n * 100) / 100

export const margenMinimoDe = (coste: number) => (coste < POLITICA_ENTRAIS.limiteCoste ? POLITICA_ENTRAIS.margenBajo : POLITICA_ENTRAIS.margenAlto)

export interface PrecioRecomendado {
  proveedor: number | null
  canon: number | null
  porte: number | null
  coste: number
  pct: number
  fija: number
  porDefecto: boolean
  margenMinimo: number
  /** El precio con IVA que deja justo el margen mínimo */
  minimo: number | null
  /** El que se recomienda poner, con IVA */
  precio: number | null
  como: 'bajo_buybox' | 'minimo_buybox_mas_baja' | 'minimo_sin_competencia' | 'imposible'
  base: number | null
  iva: number | null
  comision: number | null
  beneficio: number | null
}

/** El precio recomendado de un producto y sus cuentas, redondeadas a céntimos para que SUMEN exactamente */
export function precioRecomendado(f: FilaParaExcel): PrecioRecomendado {
  const c = comisionDe(f.categoria)
  const margenMinimo = margenMinimoDe(f.coste)
  const minimo = precioMinimoParaMargen(f.coste, margenMinimo, c)
  let precio: number | null = null
  let como: PrecioRecomendado['como'] = 'imposible'
  if (minimo !== null) {
    if (f.precioMin === null) {
      precio = minimo
      como = 'minimo_sin_competencia'
    } else if (r2(f.precioMin - 0.01) >= minimo) {
      precio = r2(f.precioMin - 0.01)
      como = 'bajo_buybox'
    } else {
      precio = minimo
      como = 'minimo_buybox_mas_baja'
    }
  }
  const base = precio === null ? null : r2(precio / 1.21)
  const comision = base === null ? null : r2(c.fija + c.pct * base)
  return {
    proveedor: f.precioProveedor,
    canon: f.canon,
    porte: f.porte,
    coste: r2(f.coste),
    pct: c.pct,
    fija: c.fija,
    porDefecto: c.porDefecto,
    margenMinimo,
    minimo,
    precio,
    como,
    base,
    iva: precio === null || base === null ? null : r2(precio - base),
    comision,
    beneficio: base === null || comision === null ? null : r2(base - comision - f.coste),
  }
}

const COMO: Record<PrecioRecomendado['como'], string> = {
  bajo_buybox: '1 céntimo por debajo del más barato',
  minimo_buybox_mas_baja: 'Nuestro mínimo (el más barato está por debajo)',
  minimo_sin_competencia: 'Nuestro mínimo (nadie más lo vende)',
  imposible: 'Sin precio posible',
}

const pctTexto = (n: number) => `${(Math.round(n * 1000) / 10).toLocaleString('es-ES')} %`

export function excelParaEntrais(d: DatosDelExcel): Uint8Array {
  const libro = new Libro()
  libro.titulo = 'Entrais · Precios recomendados en PcComponentes'
  libro.creado = `${d.hoy}T12:00:00Z`
  const filas = [...d.filas].sort((a, b) => (a.categoria ?? '').localeCompare(b.categoria ?? '', 'es') || a.titulo.localeCompare(b.titulo, 'es'))
  const calc = new Map(filas.map((f) => [f.sku, precioRecomendado(f)]))
  const bajo = pctTexto(POLITICA_ENTRAIS.margenBajo)
  const alto = pctTexto(POLITICA_ENTRAIS.margenAlto)
  const n = { bajo: 0, minimo: 0, solo: 0 }
  for (const r of calc.values()) {
    if (r.como === 'bajo_buybox') n.bajo += 1
    else if (r.como === 'minimo_buybox_mas_baja') n.minimo += 1
    else if (r.como === 'minimo_sin_competencia') n.solo += 1
  }

  /* ---------- 1. Cómo se fija el precio ---------- */
  {
    const hoja = libro.hoja('Cómo se fija el precio')
    hoja.colorPestana = COLOR_PESTANA
    hoja.anchoColumna(1, 2)
    hoja.anchoColumna(2, 48)
    hoja.anchoColumna(3, 16)
    hoja.anchoColumna(4, 72)
    hoja.anchoColumna(5, 2)
    banda(hoja, 5, 'Precios recomendados en PcComponentes', `Entrais · ${d.hoy} · ${filas.length.toLocaleString('es-ES')} productos`)
    const rotulo: Estilo = { nombre: FUENTE.titulo, tam: 11, negrita: true, color: COLOR.naranja }
    const cuerpo: Estilo = { nombre: FUENTE.cuerpo, tam: 10, color: COLOR.tinta, v: 'center', ajustar: true }
    const nota: Estilo = { nombre: FUENTE.cuerpo, tam: 9, color: COLOR.etiqueta, v: 'center', ajustar: true }
    let f = 8
    const parrafo = (t: string, e: Estilo = cuerpo, alto = 30) => {
      hoja.poner(f, 2, t, e)
      hoja.combinar(f, 2, f, 4)
      hoja.altoFila(f, alto)
      f += 1
    }
    hoja.poner(f, 2, 'LA REGLA', rotulo)
    f += 1
    parrafo(`1. Un margen mínimo para cada producto: un ${bajo} del precio sin IVA si el producto cuesta menos de ${POLITICA_ENTRAIS.limiteCoste} €, y un ${alto} si cuesta ${POLITICA_ENTRAIS.limiteCoste} € o más. En lo barato hace falta más margen porque una devolución (porte de ida y vuelta) se come el beneficio de varias ventas.`, cuerpo, 42)
    parrafo('2. El precio que se pone es un céntimo por debajo de la oferta más barata que hay hoy en PcComponentes, para quedar los primeros. Nunca por debajo del mínimo: si el más barato está por debajo de nuestro mínimo, se pone el mínimo (no se vende a pérdida). Si nadie más lo vende, también el mínimo.', cuerpo, 42)
    parrafo('El margen se cuenta sobre el precio SIN IVA: el IVA lo paga el cliente final y se ingresa a Hacienda, no es de Entrais.', cuerpo, 30)
    parrafo('La comisión de PcComponentes, en cambio, se calcula sobre el precio CON IVA (el que paga el cliente): un porcentaje según la categoría y, en algunas, una cantidad fija por unidad. Por eso en las tablas el porcentaje sale de dos formas: el de PcComponentes sobre el precio con IVA (el que se ve en su panel) y lo que ese mismo importe supone sobre el precio sin IVA. Es la misma comisión en euros, contada sobre dos bases.', cuerpo, 54)
    parrafo('PcComponentes añade el 21 % de IVA a su comisión. Ese IVA no es un gasto: Entrais lo recupera en su declaración de IVA, así que no se resta.', cuerpo, 30)

    f += 1
    hoja.poner(f, 2, 'EN CIFRAS', rotulo)
    f += 1
    for (const [t, v, e] of [
      ['Productos que quedan los más baratos', n.bajo, 'Se ponen 1 céntimo por debajo de la oferta más barata, ganando al menos el margen mínimo'],
      ['Productos en los que otro es más barato', n.minimo, 'El más barato está por debajo de nuestro mínimo: se ponen al mínimo'],
      ['Productos que nadie más vende', n.solo, 'Se ponen al mínimo'],
    ] as Array<[string, number, string]>) {
      hoja.poner(f, 2, t, { ...cuerpo, relleno: COLOR.crema, negrita: true, izquierda: { estilo: 'medium', color: COLOR.naranja } })
      hoja.poner(f, 3, v, { ...cuerpo, relleno: COLOR.crema, nombre: FUENTE.titulo, tam: 13, negrita: true, formato: '#,##0', h: 'left' })
      hoja.poner(f, 4, e, { ...nota, relleno: COLOR.crema })
      hoja.altoFila(f, 24)
      f += 1
    }

    const ejemplo = filas.find((x) => x.sku === '38426' && calc.get(x.sku)?.como === 'bajo_buybox') ?? filas.find((x) => calc.get(x.sku)?.como === 'bajo_buybox' && x.precioProveedor !== null && x.coste < 100)
    if (ejemplo) {
      const e = calc.get(ejemplo.sku)!
      f += 1
      hoja.poner(f, 2, 'UN EJEMPLO, PASO A PASO', rotulo)
      f += 1
      parrafo(ejemplo.titulo, { ...cuerpo, negrita: true }, 22)
      const paso = (t: string, v: number | null, explica: string, fuerte = false, relleno?: string) => {
        const b: Estilo = { ...cuerpo, ...(relleno ? { relleno } : {}), abajo: fino }
        hoja.poner(f, 2, t, { ...b, negrita: fuerte })
        hoja.poner(f, 3, v, { ...b, formato: EUR, h: 'right', negrita: fuerte, nombre: fuerte ? FUENTE.titulo : FUENTE.cuerpo })
        hoja.poner(f, 4, explica, { ...nota, ...(relleno ? { relleno } : {}), abajo: fino })
        hoja.altoFila(f, 24)
        f += 1
      }
      paso('Oferta más barata hoy en PcComponentes (con IVA)', ejemplo.precioMin, `La de ${ejemplo.tiendaMin ?? 'otra tienda'}`)
      paso(`Nuestro mínimo (margen del ${pctTexto(e.margenMinimo)})`, e.minimo, 'Por debajo de este precio no se pone')
      paso('PRECIO RECOMENDADO (con IVA)', e.precio, '1 céntimo por debajo del más barato: quedamos los primeros', true, COLOR.aviso)
      paso('− IVA (21 %)', e.iva, 'Lo paga el cliente y se ingresa a Hacienda')
      paso('= Precio sin IVA', e.base, 'Lo que entra de verdad', true, COLOR.crema)
      paso('− Precio del proveedor', e.proveedor, 'Lo que cuesta el producto, sin IVA')
      paso('− Canon', e.canon, 'Canon digital u otros (0 si no tiene)')
      paso('− Porte (envío al cliente)', e.porte, 'El envío del pedido hasta el cliente')
      paso('− Comisión de PcComponentes', e.comision, `${pctTexto(e.pct / 1.21)} del precio con IVA (= ${pctTexto(e.pct)} del precio sin IVA)${e.fija ? ` + ${e.fija.toFixed(2).replace('.', ',')} € fijos` : ''}`)
      paso('= BENEFICIO DE ENTRAIS', e.beneficio, 'Lo que queda por cada unidad vendida', true, 'E2F2E6')
    }

    f += 1
    hoja.poner(f, 2, 'A TENER EN CUENTA', rotulo)
    f += 1
    for (const t of [
      'La comisión de cada categoría sale de las ventas reales de Entrais en PcComponentes. Si una categoría no aparece en esas ventas, se usa la comisión más alta vista (14 % del precio con IVA + 0,70 €), para no quedarse corto.',
      'La oferta más barata cambia a diario: el precio recomendado es el de hoy.',
      'Las cuentas no descuentan las devoluciones.',
    ])
      parrafo(t, nota, 28)
  }

  /* ---------- 2. Producto a producto ---------- */
  {
    const hoja = libro.hoja('Precios producto a producto')
    hoja.colorPestana = COLOR_PESTANA
    hoja.vertical = false
    type Col = { t: string; a: number; g: keyof typeof G; fmt?: string; h?: 'left' | 'center' | 'right'; v: (f: FilaParaExcel, e: PrecioRecomendado) => string | number | null; fuerte?: boolean }
    const G = {
      p: { titulo: 'EL PRODUCTO', relleno: 'EDE6DC', tinta: COLOR.tinta },
      b: { titulo: 'PCCOMPONENTES HOY', relleno: 'E8E0F5', tinta: '4B2E83' },
      r: { titulo: 'PRECIO RECOMENDADO', relleno: 'FBEFE8', tinta: '9A3F07' },
      c: { titulo: 'LO QUE CUESTA (sin IVA)', relleno: 'DCEBF7', tinta: '1F4E79' },
      k: { titulo: 'COMISIÓN DE PCCOMPONENTES', relleno: 'F3E3D3', tinta: '7A4A12' },
      v: { titulo: 'LO QUE QUEDA', relleno: 'E2F2E6', tinta: '1E5E32' },
    } as const
    const cols: Col[] = [
      { t: 'SKU', a: 9, g: 'p', v: (f) => f.sku },
      { t: 'EAN', a: 15, g: 'p', v: (f) => f.ean },
      { t: 'Producto', a: 48, g: 'p', v: (f) => f.titulo },
      { t: 'Categoría', a: 17, g: 'p', v: (f) => f.categoria ?? '' },
      { t: 'Oferta más barata (con IVA)', a: 13, g: 'b', fmt: EUR, h: 'right', v: (f) => f.precioMin },
      { t: 'Tienda', a: 17, g: 'b', v: (f) => f.tiendaMin ?? '' },
      { t: 'PRECIO RECOMENDADO (con IVA)', a: 15, g: 'r', fmt: EUR, h: 'right', fuerte: true, v: (_, e) => e.precio },
      { t: 'Cómo se ha fijado', a: 30, g: 'r', v: (_, e) => COMO[e.como] },
      { t: 'Margen mínimo', a: 9, g: 'r', fmt: PCT, h: 'right', v: (_, e) => e.margenMinimo },
      { t: 'Precio mínimo (con IVA)', a: 12, g: 'r', fmt: EUR, h: 'right', v: (_, e) => e.minimo },
      { t: 'Precio del proveedor', a: 11, g: 'c', fmt: EUR, h: 'right', v: (_, e) => e.proveedor },
      { t: 'Canon', a: 8, g: 'c', fmt: EUR, h: 'right', v: (_, e) => e.canon },
      { t: 'Porte (envío al cliente)', a: 10, g: 'c', fmt: EUR, h: 'right', v: (_, e) => e.porte },
      { t: 'Coste total', a: 11, g: 'c', fmt: EUR, h: 'right', fuerte: true, v: (_, e) => e.coste },
      { t: 'Comisión % sobre precio CON IVA', a: 11, g: 'k', fmt: PCT, h: 'right', fuerte: true, v: (_, e) => e.pct / 1.21 },
      { t: 'Equivale sobre precio SIN IVA', a: 11, g: 'k', fmt: PCT, h: 'right', v: (_, e) => e.pct },
      { t: 'Comisión fija', a: 9, g: 'k', fmt: EUR, h: 'right', v: (_, e) => e.fija },
      { t: 'Comisión total', a: 10, g: 'k', fmt: EUR, h: 'right', fuerte: true, v: (_, e) => e.comision },
      { t: 'Precio sin IVA', a: 11, g: 'v', fmt: EUR, h: 'right', v: (_, e) => e.base },
      { t: 'IVA (21 %)', a: 10, g: 'v', fmt: EUR, h: 'right', v: (_, e) => e.iva },
      { t: 'Beneficio por unidad', a: 12, g: 'v', fmt: EUR, h: 'right', fuerte: true, v: (_, e) => e.beneficio },
    ]
    const primera = 2
    const ultima = primera + cols.length - 1
    hoja.anchoColumna(1, 2)
    cols.forEach((c, i) => hoja.anchoColumna(primera + i, c.a))
    hoja.anchoColumna(ultima + 1, 2)
    banda(hoja, ultima + 1, 'Precios recomendados en PcComponentes · producto a producto', `${filas.length.toLocaleString('es-ES')} productos · precio = 1 céntimo bajo el más barato, nunca por debajo del mínimo (${bajo} si cuesta menos de ${POLITICA_ENTRAIS.limiteCoste} €, ${alto} si más) · ${d.hoy}`)
    const fg = 8
    const fc = 9
    let c = primera
    while (c <= ultima) {
      const g = cols[c - primera].g
      let fin = c
      while (fin + 1 <= ultima && cols[fin + 1 - primera].g === g) fin += 1
      const o = G[g]
      hoja.pintar(fg, c, fin, { relleno: o.relleno, color: o.tinta, nombre: FUENTE.titulo, tam: 9, negrita: true, h: 'center', v: 'center' })
      hoja.poner(fg, c, o.titulo, { relleno: o.relleno, color: o.tinta, nombre: FUENTE.titulo, tam: 9, negrita: true, h: 'center', v: 'center' })
      hoja.combinar(fg, c, fg, fin)
      c = fin + 1
    }
    hoja.altoFila(fg, 20)
    cols.forEach((col, i) => hoja.poner(fc, primera + i, col.t, { relleno: COLOR.banda, color: COLOR.blanco, nombre: FUENTE.titulo, tam: 9, negrita: true, h: col.h ?? 'left', v: 'center', ajustar: true, abajo: { estilo: 'medium', color: COLOR.naranja } }))
    hoja.altoFila(fc, 40)
    const tono: Record<PrecioRecomendado['como'], Estilo> = {
      bajo_buybox: { color: '1E5E32', negrita: true },
      minimo_buybox_mas_baja: { color: '8A5A00', negrita: true },
      minimo_sin_competencia: { color: '5E5852', negrita: true },
      imposible: { color: 'B42318', negrita: true },
    }
    filas.forEach((f, idx) => {
      const e = calc.get(f.sku)!
      const fila = fc + 1 + idx
      const alterna = idx % 2 === 1 ? { relleno: COLOR.crema } : {}
      cols.forEach((col, i) => {
        const v = col.v(f, e)
        let est: Estilo = { ...alterna, nombre: FUENTE.cuerpo, tam: 10, color: COLOR.tinta, h: col.h ?? 'left', v: 'center', formato: col.fmt, abajo: fino, negrita: col.fuerte }
        if (col.t.startsWith('PRECIO RECOMENDADO')) est = { ...est, relleno: 'FBEFE8', color: '9A3F07', nombre: FUENTE.titulo }
        if (col.t === 'Cómo se ha fijado') est = { ...est, ...tono[e.como] }
        if (col.t === 'Beneficio por unidad' && typeof v === 'number') est = { ...est, color: v >= 0 ? '1E5E32' : 'B42318' }
        if ((col.t === 'SKU' || col.t === 'EAN') && v !== null) est = { ...est, color: COLOR.etiqueta }
        if (col.t.startsWith('Comisión %') && e.porDefecto) est = { ...est, color: '9A3F07', cursiva: true }
        hoja.poner(fila, primera + i, v, est)
      })
    })
    hoja.congelar = { filas: fc, columnas: primera + 2 }
    if (filas.length) hoja.filtro = { fila: fc, desde: primera, hasta: ultima, hastaFila: fc + filas.length }
  }

  return libro.empaquetar()
}
