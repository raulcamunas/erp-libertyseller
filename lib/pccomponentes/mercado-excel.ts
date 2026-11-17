import { Libro, type Estilo, type Hoja } from '@/lib/fba/excel/escritor'
import { LOGO_ALTO_PX, LOGO_ANCHO_PX, logoPng } from '@/lib/fba/excel/logo-marca'
import { COLOR, COLOR_PESTANA, FUENTE } from '@/lib/fba/excel/marca'
import type { FilaMercado } from './mercado'
import type { JuicioDeMercado } from './margenes'

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
