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

/* ================================================================== */
/* EL EXCEL PARA ENTRAIS: POR QUÉ CADA PRECIO                          */
/* ================================================================== */

/**
 * Para dárselo al cliente (Domingo, de Entrais): de dónde sale el precio que se pondría en PcComponentes, producto a producto, con TODAS las cuentas a
 * la vista y que sumen: lo que cuesta (proveedor + canon + porte) + lo que cobra PcComponentes + el beneficio = precio sin IVA; + IVA = precio de venta.
 * Al lado, el precio más bajo que hay hoy en PcComponentes (la Buy Box, con IVA), sin análisis de margen a ese precio: solo si el nuestro queda por
 * debajo, igual o por encima. Sin vocabulario interno ni promesas.
 */

const r2 = (n: number) => Math.round(n * 100) / 100

interface Desglose {
  proveedor: number | null
  canon: number | null
  porte: number | null
  coste: number
  pct: number
  fija: number
  porDefecto: boolean
  base: number | null
  comision: number | null
  beneficio: number | null
  iva: number | null
  precio: number | null
}

/** Las cuentas de un producto, redondeadas a céntimos de forma que SUMEN exactamente (lo que ve el cliente tiene que cuadrar a mano) */
export function desgloseDelPrecio(f: FilaParaExcel): Desglose {
  const c = f.j.comision
  const precio = f.j.suelo
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
    base,
    comision,
    beneficio: base === null || comision === null ? null : r2(base - comision - f.coste),
    iva: precio === null || base === null ? null : r2(precio - base),
    precio,
  }
}

export function excelParaEntrais(d: DatosDelExcel): Uint8Array {
  const m = `${(Math.round(d.margenObjetivo * 1000) / 10).toLocaleString('es-ES')} %`
  const libro = new Libro()
  libro.titulo = 'Entrais · Precios en PcComponentes'
  libro.creado = `${d.hoy}T12:00:00Z`
  const filas = [...d.filas].sort((a, b) => (a.categoria ?? '').localeCompare(b.categoria ?? '', 'es') || a.titulo.localeCompare(b.titulo, 'es'))

  /* ---------- 1. Cómo se calcula ---------- */
  {
    const hoja = libro.hoja('Cómo se calcula el precio')
    hoja.colorPestana = COLOR_PESTANA
    hoja.anchoColumna(1, 2)
    hoja.anchoColumna(2, 46)
    hoja.anchoColumna(3, 16)
    hoja.anchoColumna(4, 70)
    hoja.anchoColumna(5, 2)
    banda(hoja, 5, 'Precios en PcComponentes · cómo se calculan', `Entrais · ${d.hoy} · beneficio del ${m} sobre el precio sin IVA`)
    const rotulo: Estilo = { nombre: FUENTE.titulo, tam: 11, negrita: true, color: COLOR.naranja }
    const cuerpo: Estilo = { nombre: FUENTE.cuerpo, tam: 10, color: COLOR.tinta, v: 'center', ajustar: true }
    const nota: Estilo = { nombre: FUENTE.cuerpo, tam: 9, color: COLOR.etiqueta, v: 'center', ajustar: true }
    let f = 8
    hoja.poner(f, 2, 'LA IDEA', rotulo)
    f += 1
    const idea = [
      `El precio de cada producto se calcula para que, después de pagar el producto, el canon, el porte y la comisión de PcComponentes, a Entrais le quede un beneficio del ${m} del precio sin IVA.`,
      'El cliente final paga el precio CON IVA. El IVA no es de Entrais: se ingresa a Hacienda. Por eso todas las cuentas se hacen sobre el precio sin IVA.',
      'PcComponentes cobra su comisión sobre el precio sin IVA: un porcentaje que depende de la categoría del producto y, en algunas categorías, una cantidad fija por unidad.',
    ]
    for (const t of idea) {
      hoja.poner(f, 2, t, cuerpo)
      hoja.combinar(f, 2, f, 4)
      hoja.altoFila(f, 30)
      f += 1
    }

    const ejemplo = filas.find((x) => x.j.suelo !== null && x.precioProveedor !== null && x.precioMin !== null && x.coste < 300) ?? filas.find((x) => x.j.suelo !== null)
    if (ejemplo) {
      const e = desgloseDelPrecio(ejemplo)
      f += 1
      hoja.poner(f, 2, 'UN EJEMPLO, PASO A PASO', rotulo)
      f += 1
      hoja.poner(f, 2, `${ejemplo.titulo}`, { ...cuerpo, negrita: true })
      hoja.combinar(f, 2, f, 4)
      hoja.altoFila(f, 22)
      f += 1
      const paso = (t: string, v: number | null, n: string, fuerte = false, relleno?: string) => {
        const base: Estilo = { ...cuerpo, ...(relleno ? { relleno } : {}), abajo: fino }
        hoja.poner(f, 2, t, { ...base, negrita: fuerte })
        hoja.poner(f, 3, v, { ...base, formato: EUR, h: 'right', negrita: fuerte, nombre: fuerte ? FUENTE.titulo : FUENTE.cuerpo })
        hoja.poner(f, 4, n, { ...nota, ...(relleno ? { relleno } : {}), abajo: fino })
        hoja.altoFila(f, 24)
        f += 1
      }
      paso('Precio del proveedor', e.proveedor, 'Lo que cuesta el producto al proveedor, sin IVA')
      paso('+ Canon', e.canon, 'Canon digital u otros que lleve el producto (0 si no tiene)')
      paso('+ Porte (envío al cliente)', e.porte, 'El envío del pedido hasta el cliente')
      paso('= Coste total (sin IVA)', e.coste, 'Lo que le cuesta a Entrais poner el producto en casa del cliente', true, COLOR.crema)
      paso(`+ Comisión de PcComponentes`, e.comision, `${(Math.round(e.pct * 1000) / 10).toLocaleString('es-ES')} % del precio sin IVA${e.fija ? ` + ${e.fija.toFixed(2).replace('.', ',')} € fijos` : ''}${e.porDefecto ? ' (categoría sin histórico: se usa la comisión más alta vista)' : ''}`)
      paso(`+ Beneficio de Entrais (${m})`, e.beneficio, `El ${m} del precio sin IVA`)
      paso('= Precio sin IVA', e.base, `Se despeja: (coste + comisión fija) ÷ (1 − ${m} − % de comisión)`, true, COLOR.crema)
      paso('+ IVA (21 %)', e.iva, 'Lo paga el cliente y se ingresa a Hacienda')
      paso('= PRECIO DE VENTA EN PCCOMPONENTES', e.precio, 'Lo que pagaría el cliente final', true, COLOR.aviso)
      paso('Precio más bajo hoy en PcComponentes (con IVA)', ejemplo.precioMin, `La oferta más barata de ese producto ahora mismo${ejemplo.tiendaMin ? ` (${ejemplo.tiendaMin})` : ''}`)
    }

    f += 1
    hoja.poner(f, 2, 'A TENER EN CUENTA', rotulo)
    f += 1
    for (const t of [
      'La comisión de cada categoría sale de las ventas reales de Entrais en PcComponentes. Si una categoría no aparece en esas ventas, se usa la comisión más alta vista (17 % + 0,70 €), para no quedarse corto.',
      'El «precio más bajo hoy» es el de la oferta más barata que hay ahora mismo en PcComponentes para ese producto, con IVA. Cambia a diario.',
      'Las cuentas no descuentan las devoluciones.',
    ]) {
      hoja.poner(f, 2, t, nota)
      hoja.combinar(f, 2, f, 4)
      hoja.altoFila(f, 28)
      f += 1
    }
  }

  /* ---------- 2. Producto a producto ---------- */
  {
    const hoja = libro.hoja('Precios producto a producto')
    hoja.colorPestana = COLOR_PESTANA
    hoja.vertical = false
    type Col = { t: string; a: number; g: string; fmt?: string; h?: 'left' | 'center' | 'right'; v: (f: FilaParaExcel, e: Desglose) => string | number | null; fuerte?: boolean }
    const G = {
      p: { titulo: 'EL PRODUCTO', relleno: 'EDE6DC', tinta: COLOR.tinta },
      c: { titulo: '1 · LO QUE CUESTA (sin IVA)', relleno: 'DCEBF7', tinta: '1F4E79' },
      k: { titulo: '2 · COMISIÓN DE PCCOMPONENTES', relleno: 'FBEFE8', tinta: '9A3F07' },
      v: { titulo: '3 · EL PRECIO DE VENTA', relleno: 'E2F2E6', tinta: '1E5E32' },
      b: { titulo: '4 · PCCOMPONENTES HOY', relleno: 'E8E0F5', tinta: '4B2E83' },
    } as const
    const frente = (f: FilaParaExcel, e: Desglose) => {
      if (f.precioMin === null) return 'Nadie lo vende'
      if (e.precio === null) return '—'
      const dif = r2(e.precio - f.precioMin)
      return Math.abs(dif) < 0.005 ? 'Igual' : dif < 0 ? 'Más barato' : 'Más caro'
    }
    const cols: Col[] = [
      { t: 'SKU', a: 9, g: 'p', v: (f) => f.sku },
      { t: 'EAN', a: 15, g: 'p', v: (f) => f.ean },
      { t: 'Producto', a: 50, g: 'p', v: (f) => f.titulo },
      { t: 'Categoría', a: 18, g: 'p', v: (f) => f.categoria ?? '' },
      { t: 'Precio del proveedor', a: 12, g: 'c', fmt: EUR, h: 'right', v: (_, e) => e.proveedor },
      { t: 'Canon', a: 9, g: 'c', fmt: EUR, h: 'right', v: (_, e) => e.canon },
      { t: 'Porte (envío al cliente)', a: 11, g: 'c', fmt: EUR, h: 'right', v: (_, e) => e.porte },
      { t: 'Coste total', a: 12, g: 'c', fmt: EUR, h: 'right', fuerte: true, v: (_, e) => e.coste },
      { t: 'Comisión % (sobre el precio sin IVA)', a: 13, g: 'k', fmt: PCT, h: 'right', v: (_, e) => e.pct },
      { t: 'Comisión fija', a: 10, g: 'k', fmt: EUR, h: 'right', v: (_, e) => e.fija },
      { t: 'Comisión total', a: 11, g: 'k', fmt: EUR, h: 'right', fuerte: true, v: (_, e) => e.comision },
      { t: `Beneficio de Entrais (${m})`, a: 12, g: 'v', fmt: EUR, h: 'right', v: (_, e) => e.beneficio },
      { t: 'Precio sin IVA', a: 12, g: 'v', fmt: EUR, h: 'right', v: (_, e) => e.base },
      { t: 'IVA (21 %)', a: 10, g: 'v', fmt: EUR, h: 'right', v: (_, e) => e.iva },
      { t: 'PRECIO DE VENTA (con IVA)', a: 14, g: 'v', fmt: EUR, h: 'right', fuerte: true, v: (_, e) => e.precio },
      { t: 'Precio más bajo hoy (con IVA)', a: 14, g: 'b', fmt: EUR, h: 'right', v: (f) => f.precioMin },
      { t: 'Tienda', a: 18, g: 'b', v: (f) => f.tiendaMin ?? '' },
      { t: 'Nuestro precio frente al más bajo', a: 16, g: 'b', h: 'center', v: frente },
      { t: 'Diferencia (con IVA)', a: 12, g: 'b', fmt: '+#,##0.00 "€";-#,##0.00 "€";0.00 "€"', h: 'right', v: (f, e) => (f.precioMin === null || e.precio === null ? null : r2(e.precio - f.precioMin)) },
    ]
    const primera = 2
    const ultima = primera + cols.length - 1
    hoja.anchoColumna(1, 2)
    cols.forEach((c, i) => hoja.anchoColumna(primera + i, c.a))
    hoja.anchoColumna(ultima + 1, 2)
    banda(hoja, ultima + 1, 'Precios en PcComponentes · producto a producto', `${filas.length.toLocaleString('es-ES')} productos · coste + comisión + beneficio del ${m} = precio sin IVA; + IVA = precio de venta · ${d.hoy}`)

    const fg = 8
    const fc = 9
    let c = primera
    while (c <= ultima) {
      const g = cols[c - primera].g
      let fin = c
      while (fin + 1 <= ultima && cols[fin + 1 - primera].g === g) fin += 1
      const o = G[g as keyof typeof G]
      hoja.pintar(fg, c, fin, { relleno: o.relleno, color: o.tinta, nombre: FUENTE.titulo, tam: 9, negrita: true, h: 'center', v: 'center' })
      hoja.poner(fg, c, o.titulo, { relleno: o.relleno, color: o.tinta, nombre: FUENTE.titulo, tam: 9, negrita: true, h: 'center', v: 'center' })
      hoja.combinar(fg, c, fg, fin)
      c = fin + 1
    }
    hoja.altoFila(fg, 20)
    cols.forEach((col, i) => hoja.poner(fc, primera + i, col.t, { relleno: COLOR.banda, color: COLOR.blanco, nombre: FUENTE.titulo, tam: 9, negrita: true, h: col.h ?? 'left', v: 'center', ajustar: true, abajo: { estilo: 'medium', color: COLOR.naranja } }))
    hoja.altoFila(fc, 40)

    const tono: Record<string, Estilo> = {
      'Más barato': { relleno: 'E2F2E6', color: '1E5E32', negrita: true },
      Igual: { relleno: 'E2F2E6', color: '1E5E32', negrita: true },
      'Más caro': { relleno: 'FDF0D8', color: '8A5A00', negrita: true },
      'Nadie lo vende': { relleno: 'EEEEEE', color: '5E5852', negrita: true },
    }
    filas.forEach((f, n) => {
      const e = desgloseDelPrecio(f)
      const fila = fc + 1 + n
      const alterna = n % 2 === 1 ? { relleno: COLOR.crema } : {}
      cols.forEach((col, i) => {
        const v = col.v(f, e)
        let est: Estilo = { ...alterna, nombre: FUENTE.cuerpo, tam: 10, color: COLOR.tinta, h: col.h ?? 'left', v: 'center', formato: col.fmt, abajo: fino, negrita: col.fuerte }
        if (col.t === 'PRECIO DE VENTA (con IVA)') est = { ...est, relleno: 'E2F2E6', color: '1E5E32', nombre: FUENTE.titulo }
        if (col.t === 'Nuestro precio frente al más bajo' && typeof v === 'string') est = { ...est, ...tono[v] }
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
