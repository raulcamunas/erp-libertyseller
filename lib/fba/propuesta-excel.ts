import { Libro, type Estilo } from './excel/escritor'
import { LOGO_ALTO_PX, LOGO_ANCHO_PX, logoPng } from './excel/logo-marca'
import { COLOR, COLOR_PESTANA, FUENTE } from './excel/marca'

/**
 * EL EXCEL DE UNA PROPUESTA DE ENVÍO, PARA MANDÁRSELO AL CLIENTE.
 * ==============================================================
 * Puro: entran las líneas, salen los bytes. Se comprueba con propuesta-excel.prueba.ts.
 *
 * Es un documento para LEER, no para calcular: qué se va a enviar a Amazon, de qué
 * producto, con qué SKU y cuántas unidades. Ni fórmulas, ni ritmos de venta, ni cobertura:
 * eso es trabajo de la agencia y al cliente se le entrega el resultado. Por eso todo son
 * valores y el único número «calculado» es el total, que se escribe ya sumado.
 *
 * Lleva la marca que ya llevan los Excel que la agencia entrega (ver lib/fba/excel/marca.ts):
 * la banda oscura con la franja naranja y el logo, el título en Sora, las tarjetas de cifras
 * en crema y la tabla con la cabecera oscura.
 *
 *
 * ============ LAS COLUMNAS SE ADAPTAN A LO QUE HAY ============
 *
 * Producto, SKU y Cantidad salen siempre. «Referencia» solo si alguna línea la lleva (el
 * cliente con base de datos de referencias, ShoesF) y la columna de variante —«Talla» en
 * ese caso— solo si alguna línea tiene variante: una columna entera de guiones no ayuda a
 * nadie a leer la tabla.
 */

export interface LineaPropuesta {
  sku: string
  unidades: number
  referencia: string | null
  nombre: string | null
  variante: string | null
}

export interface DatosPropuesta {
  cliente: string
  nombre: string | null
  /** 'YYYY-MM-DD': el día previsto de envío */
  fechaEnvio: string
  nota: string | null
  /** 'YYYY-MM-DD': el día en que se genera el documento */
  hoy: string
  lineas: LineaPropuesta[]
  /** «Talla» para el cliente de las zapatillas; «Variante» para el resto */
  rotuloVariante?: string
}

export interface ExcelDePropuesta {
  xlsx: Uint8Array
  lineas: number
  unidades: number
  /** Ya limpio y en ASCII: sirve tal cual para la cabecera Content-Disposition */
  nombreFichero: string
}

/* ------------------------------------------------------------------ */
/* Pequeñas cuentas                                                    */
/* ------------------------------------------------------------------ */

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

const esDia = (f: string) => /^\d{4}-\d{2}-\d{2}$/.test(f)

/** «2026-10-22» → «22 de octubre de 2026». Lo que no sea un día se deja como está */
export function fechaLarga(f: string): string {
  if (!esDia(f)) return f
  return `${Number(f.slice(8, 10))} de ${MESES[Number(f.slice(5, 7)) - 1]} de ${f.slice(0, 4)}`
}

/** «2026-10-22» → «22/10/2026» */
export function fechaCorta(f: string): string {
  return esDia(f) ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : f
}

/** Orden humano: «2» antes que «10», sin mirar mayúsculas ni acentos */
export const natural = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' })

/** Para un nombre de fichero: sin acentos, solo letras, números y guiones */
export function limpio(texto: string, max = 40): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, max)
    .replace(/-+$/g, '')
}

/** Cuántas líneas ocupa un texto en una columna de `ancho` caracteres, partiendo por palabras */
export function lineasDe(texto: string, ancho: number): number {
  let total = 0
  for (const parrafo of texto.split(/\r?\n/)) {
    let actual = 0
    let n = 1
    for (const palabra of parrafo.split(/\s+/).filter(Boolean)) {
      const largo = palabra.length
      if (actual === 0) actual = largo
      else if (actual + 1 + largo <= ancho) actual += 1 + largo
      else {
        n += 1
        actual = largo
      }
      // Una palabra más larga que la columna se parte sola
      while (actual > ancho) {
        n += 1
        actual -= ancho
      }
    }
    total += n
  }
  return Math.max(1, total)
}

/* ------------------------------------------------------------------ */
/* El documento                                                        */
/* ------------------------------------------------------------------ */

interface Columna {
  id: 'ref' | 'producto' | 'variante' | 'sku' | 'cantidad'
  titulo: string
  ancho: number
  h: 'left' | 'center' | 'right'
}

export function excelDePropuesta(datos: DatosPropuesta): ExcelDePropuesta {
  // Se ordena como se leería en la hoja del cliente: por referencia, luego producto y talla
  const lineas = datos.lineas
    .filter((l) => Number.isInteger(l.unidades) && l.unidades > 0 && l.sku.trim() !== '')
    .map((l) => ({
      sku: l.sku.trim(),
      unidades: l.unidades,
      referencia: l.referencia?.trim() || null,
      nombre: l.nombre?.trim() || null,
      variante: l.variante?.trim() || null,
    }))
    .sort(
      (a, b) =>
        natural(a.referencia ?? '', b.referencia ?? '') ||
        natural(a.nombre ?? '', b.nombre ?? '') ||
        natural(a.variante ?? '', b.variante ?? '') ||
        natural(a.sku, b.sku)
    )

  const unidades = lineas.reduce((s, l) => s + l.unidades, 0)
  const hayRef = lineas.some((l) => l.referencia)
  const hayVariante = lineas.some((l) => l.variante)

  const columnas: Columna[] = [
    ...(hayRef ? [{ id: 'ref' as const, titulo: 'Referencia', ancho: 14, h: 'left' as const }] : []),
    { id: 'producto', titulo: 'Producto', ancho: 46, h: 'left' },
    ...(hayVariante ? [{ id: 'variante' as const, titulo: datos.rotuloVariante ?? 'Variante', ancho: 11, h: 'center' as const }] : []),
    { id: 'sku', titulo: 'SKU', ancho: 26, h: 'left' },
    { id: 'cantidad', titulo: 'Cantidad', ancho: 13, h: 'right' },
  ]
  // A es un margen; la tabla empieza en B y a su derecha hay otro margen
  const primera = 2
  const ultima = primera + columnas.length - 1
  const margenDerecho = ultima + 1
  const colDe = (id: Columna['id']) => primera + columnas.findIndex((c) => c.id === id)
  const anchoTabla = columnas.reduce((s, c) => s + c.ancho, 0)

  const libro = new Libro()
  libro.titulo = `Propuesta de envío · ${datos.cliente}`
  libro.creado = `${esDia(datos.hoy) ? datos.hoy : new Date().toISOString().slice(0, 10)}T12:00:00Z`
  const hoja = libro.hoja('Propuesta')
  hoja.colorPestana = COLOR_PESTANA

  hoja.anchoColumna(1, 2.4)
  columnas.forEach((c, i) => hoja.anchoColumna(primera + i, c.ancho))
  hoja.anchoColumna(margenDerecho, 2.4)

  /* ---------- la banda de cabecera ---------- */
  const banda: Estilo = { relleno: COLOR.banda }
  const pintaBanda = (fila: number, alto: number) => {
    hoja.pintar(fila, 1, margenDerecho, banda)
    hoja.altoFila(fila, alto)
  }

  hoja.pintar(1, 1, margenDerecho, { relleno: COLOR.naranja })
  hoja.altoFila(1, 6)
  pintaBanda(2, 10)
  pintaBanda(3, 30)
  pintaBanda(4, 16)
  pintaBanda(5, 31)
  pintaBanda(6, 31)
  pintaBanda(7, 20)
  pintaBanda(8, 12)

  // El logo, en la banda: es blanco y naranja, y sobre blanco no se vería
  const anchoLogo = 150
  hoja.imagen = {
    png: logoPng(),
    fila: 3,
    col: primera,
    desplazamientoX: 0,
    desplazamientoY: 5,
    anchoPx: anchoLogo,
    altoPx: Math.round((anchoLogo * LOGO_ALTO_PX) / LOGO_ANCHO_PX),
    descripcion: 'Liberty Seller',
  }

  const nombreMayusculas = datos.nombre?.trim() ? ` · ${datos.nombre.trim().toUpperCase()}` : ''
  hoja.poner(4, primera, `PROPUESTA DE ENVÍO A AMAZON${nombreMayusculas}`, { ...banda, nombre: FUENTE.titulo, tam: 9, negrita: true, color: COLOR.naranja, v: 'center' })
  hoja.poner(5, primera, 'Qué vamos a enviar', { ...banda, nombre: FUENTE.titulo, tam: 20, negrita: true, color: COLOR.blanco, v: 'center' })
  hoja.poner(6, primera, datos.cliente, { ...banda, nombre: FUENTE.titulo, tam: 20, negrita: true, color: COLOR.naranja, v: 'center' })
  hoja.poner(
    7,
    primera,
    `${lineas.length.toLocaleString('es-ES')} referencia${lineas.length === 1 ? '' : 's'} · ${unidades.toLocaleString('es-ES')} unidades · Envío previsto: ${fechaLarga(datos.fechaEnvio)}`,
    { ...banda, nombre: FUENTE.cuerpo, tam: 9, color: COLOR.claro, v: 'center' }
  )

  /* ---------- las tres tarjetas de cifras ---------- */
  hoja.altoFila(9, 14)
  /**
   * Las tarjetas ocupan columnas enteras de la tabla, y las columnas no miden lo mismo:
   * repartirlas por número («2, 2 y 1») dejaba a la última en una columna de 13 de ancho,
   * donde la fecha se cortaba. Se prueban todos los cortes y se elige el que deja las tres
   * tarjetas más parejas en ANCHO, sin que la última baje de 20 ni las otras de 11.
   */
  const reparto = (() => {
    const n = columnas.length
    const anchos = columnas.map((c) => c.ancho)
    const suma = (a: number, b: number) => anchos.slice(a, b).reduce((s, x) => s + x, 0)
    let mejor = { i: 1, j: 2, coste: Number.POSITIVE_INFINITY }
    for (let i = 1; i < n - 1; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const w = [suma(0, i), suma(i, j), suma(j, n)]
        const coste = Math.max(...w) - Math.min(...w) + (w[2] < 20 ? 100 : 0) + (w[0] < 11 || w[1] < 11 ? 100 : 0)
        if (coste < mejor.coste) mejor = { i, j, coste }
      }
    }
    const cortes = [0, mejor.i, mejor.j, n]
    return [0, 1, 2].map((k) => ({
      desde: primera + cortes[k],
      hasta: primera + cortes[k + 1] - 1,
      ancho: suma(cortes[k], cortes[k + 1]),
    }))
  })()
  const tarjetas = [
    { rotulo: 'REFERENCIAS', valor: lineas.length.toLocaleString('es-ES'), nota: 'productos distintos' },
    { rotulo: 'UNIDADES', valor: unidades.toLocaleString('es-ES'), nota: 'en total' },
    { rotulo: 'ENVÍO PREVISTO', valor: fechaCorta(datos.fechaEnvio), nota: 'salida prevista' },
  ]
  const filasTarjeta = [10, 11, 12]
  hoja.altoFila(10, 17)
  hoja.altoFila(11, 32)
  hoja.altoFila(12, 17)
  tarjetas.forEach((t, i) => {
    const { desde, hasta, ancho } = reparto[i]
    const separa = i < tarjetas.length - 1
    const base: Estilo = { relleno: COLOR.crema, h: 'left', v: 'center', sangria: 1 }
    // La cifra se encoge si no cabe: Sora en negrita gasta unas 0,105 unidades de ancho por
    // cada punto de cuerpo y carácter. Entre 11 y 19 puntos.
    const tamCifra = Math.max(11, Math.min(19, Math.floor((ancho - 2) / (Math.max(1, t.valor.length) * 0.105))))
    const estilos: Estilo[] = [
      { ...base, nombre: FUENTE.cuerpo, tam: 7, color: COLOR.etiqueta, arriba: { estilo: 'thick', color: COLOR.naranja } },
      { ...base, nombre: FUENTE.titulo, tam: tamCifra, negrita: true, color: COLOR.tinta },
      { ...base, nombre: FUENTE.cuerpo, tam: 8, color: COLOR.etiqueta },
    ]
    const textos = [t.rotulo, t.valor, t.nota]
    filasTarjeta.forEach((fila, k) => {
      for (let c = desde; c <= hasta; c += 1) {
        // El hueco blanco entre tarjetas es un borde grueso blanco en su último borde derecho
        const estilo: Estilo = c === hasta && separa ? { ...estilos[k], derecha: { estilo: 'thick', color: COLOR.blanco } } : estilos[k]
        hoja.poner(fila, c, c === desde ? textos[k] : null, estilo)
      }
      hoja.combinar(fila, desde, fila, hasta)
    })
  })
  hoja.altoFila(13, 16)

  /* ---------- el título de la sección ---------- */
  hoja.altoFila(14, 16)
  // «01» en naranja y el rótulo en gris, en la MISMA celda: en otra columna quedaba a un
  // mundo de distancia cuando la primera columna de la tabla es la ancha (Producto)
  hoja.poner(
    14,
    primera,
    [
      { texto: '01', color: COLOR.naranja },
      { texto: '    LO QUE VAMOS A ENVIAR', color: COLOR.etiqueta },
    ],
    { nombre: FUENTE.titulo, tam: 9, negrita: true, color: COLOR.etiqueta, v: 'bottom' }
  )
  hoja.altoFila(15, 26)
  hoja.poner(15, primera, 'Detalle por referencia', {
    nombre: FUENTE.titulo,
    tam: 15,
    negrita: true,
    color: COLOR.tinta,
    v: 'center',
    abajo: { estilo: 'medium', color: COLOR.naranja },
  })
  hoja.altoFila(16, 8)

  /* ---------- la tabla ---------- */
  const filaCabecera = 17
  hoja.altoFila(filaCabecera, 28)
  columnas.forEach((c, i) => {
    hoja.poner(filaCabecera, primera + i, c.titulo, {
      relleno: COLOR.banda,
      nombre: FUENTE.titulo,
      tam: 8,
      negrita: true,
      color: COLOR.blanco,
      h: c.h === 'right' ? 'right' : c.h === 'center' ? 'center' : 'left',
      v: 'center',
      ajustar: true,
      sangria: 1,
      arriba: { estilo: 'medium', color: COLOR.naranja },
    })
  })

  const anchoProducto = columnas.find((c) => c.id === 'producto')!.ancho
  lineas.forEach((l, i) => {
    const fila = filaCabecera + 1 + i
    const relleno = i % 2 === 0 ? COLOR.crema : undefined
    const base: Estilo = { relleno, nombre: FUENTE.cuerpo, tam: 9, color: COLOR.tinta, v: 'center', sangria: 1, abajo: { estilo: 'thin', color: COLOR.raya } }
    const textoProducto = l.nombre ?? l.sku
    hoja.altoFila(fila, Math.max(19, lineasDe(textoProducto, Math.floor(anchoProducto * 1.05)) * 12.5 + 7))

    if (hayRef) hoja.poner(fila, colDe('ref'), l.referencia, { ...base, h: 'left', negrita: true })
    hoja.poner(fila, colDe('producto'), textoProducto, { ...base, h: 'left', ajustar: true })
    if (hayVariante) hoja.poner(fila, colDe('variante'), l.variante, { ...base, h: 'center' })
    hoja.poner(fila, colDe('sku'), l.sku, { ...base, h: 'left', color: COLOR.etiqueta, tam: 8.5 })
    hoja.poner(fila, colDe('cantidad'), l.unidades, { ...base, h: 'right', negrita: true, tam: 10, formato: '#,##0' })
  })

  // El total, ya sumado: es lo único que se calcula y se escribe como valor
  const filaTotal = filaCabecera + 1 + lineas.length
  hoja.altoFila(filaTotal, 27)
  const total: Estilo = { relleno: COLOR.banda, v: 'center', sangria: 1 }
  hoja.pintar(filaTotal, primera, ultima, total)
  hoja.poner(filaTotal, primera, 'TOTAL A ENVIAR', { ...total, nombre: FUENTE.titulo, tam: 9, negrita: true, color: COLOR.blanco, h: 'left' })
  hoja.poner(filaTotal, colDe('cantidad'), unidades, { ...total, nombre: FUENTE.titulo, tam: 12, negrita: true, color: COLOR.naranjaClaro, h: 'right', formato: '#,##0' })

  /* ---------- la nota, si la hay ---------- */
  let fila = filaTotal + 1
  hoja.altoFila(fila, 14)
  fila += 1
  const nota = datos.nota?.trim()
  if (nota) {
    const filo: Estilo = { relleno: COLOR.aviso, izquierda: { estilo: 'thick', color: COLOR.naranja } }
    hoja.altoFila(fila, 20)
    hoja.pintar(fila, primera, ultima, { relleno: COLOR.aviso })
    hoja.poner(fila, primera, 'NOTA', { ...filo, nombre: FUENTE.titulo, tam: 9, negrita: true, color: COLOR.naranja, v: 'center', sangria: 1 })
    fila += 1
    hoja.pintar(fila, primera, ultima, { relleno: COLOR.aviso })
    hoja.poner(fila, primera, nota, { ...filo, nombre: FUENTE.cuerpo, tam: 9, color: COLOR.tinta, h: 'left', v: 'top', ajustar: true, sangria: 1 })
    hoja.combinar(fila, primera, fila, ultima)
    hoja.altoFila(fila, Math.max(30, lineasDe(nota, Math.floor(anchoTabla * 1.05)) * 13 + 12))
    fila += 1
    hoja.altoFila(fila, 14)
    fila += 1
  }

  /* ---------- el pie ---------- */
  hoja.altoFila(fila, 15)
  hoja.poner(fila, primera, 'Es una propuesta: las cantidades se confirman antes de crear el envío en Amazon.', { nombre: FUENTE.cuerpo, tam: 8, color: COLOR.etiqueta, v: 'center' })
  fila += 1
  hoja.altoFila(fila, 15)
  hoja.poner(fila, primera, `Liberty Seller · Propuesta generada el ${fechaLarga(datos.hoy)}`, { nombre: FUENTE.cuerpo, tam: 8, color: COLOR.discreto, v: 'center' })

  const sufijo = limpio(datos.nombre ?? '') || (esDia(datos.fechaEnvio) ? datos.fechaEnvio : 'borrador')
  return {
    xlsx: libro.empaquetar(),
    lineas: lineas.length,
    unidades,
    nombreFichero: `propuesta-envio-${limpio(datos.cliente) || 'cliente'}-${sufijo}.xlsx`,
  }
}
