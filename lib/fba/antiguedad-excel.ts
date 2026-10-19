import { informeDeAntiguedad, nombreDeFuente, productosDeTramo, tramoDelInforme, type IdTramoInforme, type InformeDeAntiguedad, type ProductoDeTramo } from './antiguedad'
import { Libro, type Estilo } from './excel/escritor'
import { LOGO_ALTO_PX, LOGO_ANCHO_PX, logoPng } from './excel/logo-marca'
import { COLOR, COLOR_PESTANA, FUENTE } from './excel/marca'
import type { InventarioDeCliente, SkuInventario } from './inventario'
import { fechaCorta, fechaLarga, limpio, lineasDe } from './propuesta-excel'

/**
 * EL EXCEL DE LA ANTIGÜEDAD DEL STOCK, CON LA MARCA.
 * =================================================
 * Puro: entran los datos del panel, salen los bytes. Se comprueba con antiguedad-excel.prueba.ts.
 *
 * Es lo que enseña la tarjeta «Cuánto lleva el stock en Amazon», pero en un documento para leer,
 * enviar o filtrar: qué productos hay en cada tramo de antigüedad, cuántas unidades, cuánto valen
 * y cuánto cuesta guardarlas. Lleva la misma marca que el Excel de la propuesta (ver
 * lib/fba/excel/marca.ts): la franja naranja y la banda oscura con el logo, los títulos en Sora, las
 * tarjetas de cifras en crema y las tablas con la cabecera oscura.
 *
 *
 * ============ DOS HOJAS ============
 *
 *   RESUMEN    las cifras gordas y la tabla de tramos: es lo que se enseña de un vistazo.
 *   PRODUCTOS  una fila por producto y tramo, ordenada de lo más antiguo a lo más reciente, con
 *              filtro y la cabecera congelada: es la hoja con la que se trabaja.
 *
 * Si se pide UN tramo —se ha pulsado en la tarjeta—, la hoja de productos lleva solo los de ese
 * tramo y el resumen lo marca. Un producto con unidades en dos tramos sale en los dos, cada uno con
 * las suyas.
 *
 * Todo son valores, no fórmulas: lo que se ve es lo que hay en la celda.
 */

export interface DatosExcelAntiguedad {
  cliente: string
  /** El panel entero: de ahí salen los tramos, los productos y de qué fuente es la edad */
  inventario: InventarioDeCliente
  /** Solo este tramo; null = todos */
  tramo: IdTramoInforme | null
  /** 'YYYY-MM-DD': el día en que se genera */
  hoy: string
}

export interface ExcelDeAntiguedad {
  xlsx: Uint8Array
  /** Filas de la hoja de productos */
  filas: number
  /** Unidades que suman esas filas */
  unidades: number
  /** Ya limpio y en ASCII: sirve tal cual para la cabecera Content-Disposition */
  nombreFichero: string
}

/** Los colores de cada tramo: del verde de lo recién llegado al magenta de lo que lleva más de un año */
const COLOR_TRAMO: Record<string, string> = {
  a0: '4DAF6B',
  a61: '97BF5C',
  a91: 'E0B43A',
  a181: 'F28A30',
  a331: 'E4623B',
  a366: 'D44444',
  a456: 'B04CC4',
  t0: '4DAF6B',
  t91: 'E0B43A',
  t181: 'F28A30',
  t271: 'D44444',
  t366: 'B04CC4',
  anterior: '8C857C',
}
const colorDe = (id: string) => COLOR_TRAMO[id] ?? COLOR.discreto

/** De más antiguo a más reciente: lo que hay que mirar primero, arriba */
const ORDEN_ANTIGUO_PRIMERO: Record<string, number> = { anterior: 0, a456: 1, t366: 1, a366: 2, a331: 3, t271: 3, a181: 4, t181: 4, a91: 5, t91: 5, a61: 6, a0: 7, t0: 6 }
const pesoDe = (id: string) => ORDEN_ANTIGUO_PRIMERO[id] ?? 99

const entero = (n: number) => n.toLocaleString('es-ES')
const euros = (n: number | null, decimales = 0) =>
  n === null ? '—' : n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: decimales, maximumFractionDigits: decimales })
/** 0,03 € o 1.234 €: céntimos cuando la cifra es pequeña */
const eurosFinos = (n: number | null) => euros(n, n !== null && Math.abs(n) < 100 ? 2 : 0)

const esDia = (f: string | null): f is string => !!f && /^\d{4}-\d{2}-\d{2}$/.test(f)

export function excelDeAntiguedad(datos: DatosExcelAntiguedad): ExcelDeAntiguedad {
  const informe: InformeDeAntiguedad = informeDeAntiguedad(datos.inventario)
  const skus: SkuInventario[] = datos.inventario.skus
  const elegido = tramoDelInforme(informe, datos.tramo)
  // Un tramo que no existe (otro cliente, otra fuente) se trata como «todos»: mejor un documento completo que uno vacío
  const soloEste = elegido?.id ?? null

  /* ---------- los productos de cada tramo ---------- */
  const tramosEnOrden = [...informe.tramos].sort((a, b) => pesoDe(a.id) - pesoDe(b.id))
  const filas: Array<{ tramo: InformeDeAntiguedad['tramos'][number]; p: ProductoDeTramo }> = []
  for (const t of tramosEnOrden) {
    if (soloEste !== null && t.id !== soloEste) continue
    for (const p of productosDeTramo(skus, informe, t.id)) filas.push({ tramo: t, p })
  }
  const unidadesFilas = filas.reduce((s, f) => s + f.p.unidades, 0)
  const hayCoste = informe.fuente === 'amazon' && informe.costeMes !== null
  const hayPrecio = filas.some((f) => f.p.valor !== null)
  const valorFilas = filas.reduce((s, f) => s + (f.p.valor ?? 0), 0)
  const costeFilas = filas.reduce((s, f) => s + (f.p.coste ?? 0), 0)

  const antiguas = informe.tramos.filter((t) => t.antiguo)
  const unidadesAntiguas = antiguas.reduce((s, t) => s + t.unidades, 0)
  const valorAntiguas = antiguas.reduce((s, t) => s + t.valor, 0)
  const valorTotal = informe.tramos.reduce((s, t) => s + t.valor, 0)
  const hoy = esDia(datos.hoy) ? datos.hoy : new Date().toISOString().slice(0, 10)

  const libro = new Libro()
  libro.titulo = `Antigüedad del stock · ${datos.cliente}`
  libro.creado = `${hoy}T12:00:00Z`

  const frase = informe.fuente === 'amazon'
    ? `Antigüedad ${nombreDeFuente('amazon')}${esDia(informe.fecha) ? `, foto del ${fechaLarga(informe.fecha)}` : ''}`
    : `Antigüedad ${nombreDeFuente('libro')}${esDia(informe.fecha) ? `, ventas leídas hasta el ${fechaLarga(informe.fecha)}` : ''}`

  /* ================================================================== */
  /* HOJA 1 · RESUMEN                                                    */
  /* ================================================================== */
  {
    const hoja = libro.hoja('Resumen')
    hoja.colorPestana = COLOR_PESTANA

    const columnas = [
      { id: 'tramo', titulo: 'Tramo de antigüedad', ancho: 28, h: 'left' as const },
      { id: 'unidades', titulo: 'Unidades', ancho: 13, h: 'right' as const },
      { id: 'pct', titulo: '%', ancho: 9, h: 'right' as const },
      ...(informe.tramos.some((t) => t.valor > 0) ? [{ id: 'valor', titulo: 'Valor', ancho: 14, h: 'right' as const }] : []),
      ...(hayCoste ? [{ id: 'coste', titulo: 'Almacenaje/mes', ancho: 17, h: 'right' as const }] : []),
    ]
    const tira = 2 // la columna estrecha con el color del tramo
    const primera = 3
    const ultima = primera + columnas.length - 1
    const margenDerecho = ultima + 1
    const colDe = (id: string) => primera + columnas.findIndex((c) => c.id === id)
    const anchoTabla = columnas.reduce((s, c) => s + c.ancho, 0)

    hoja.anchoColumna(1, 2.4)
    hoja.anchoColumna(tira, 1.6)
    columnas.forEach((c, i) => hoja.anchoColumna(primera + i, c.ancho))
    hoja.anchoColumna(margenDerecho, 2.4)

    /* ---------- la banda ---------- */
    const banda: Estilo = { relleno: COLOR.banda }
    const pintaBanda = (fila: number, alto: number) => {
      hoja.pintar(fila, 1, margenDerecho, banda)
      hoja.altoFila(fila, alto)
    }
    hoja.pintar(1, 1, margenDerecho, { relleno: COLOR.naranja })
    hoja.altoFila(1, 6)
    ;[
      [2, 10],
      [3, 30],
      [4, 16],
      [5, 31],
      [6, 31],
      [7, 20],
      [8, 12],
    ].forEach(([f, a]) => pintaBanda(f, a))

    const anchoLogo = 150
    hoja.imagen = {
      png: logoPng(),
      fila: 3,
      col: primera - 1,
      desplazamientoX: 0,
      desplazamientoY: 5,
      anchoPx: anchoLogo,
      altoPx: Math.round((anchoLogo * LOGO_ALTO_PX) / LOGO_ANCHO_PX),
      descripcion: 'Liberty Seller',
    }
    const sufijoTramo = elegido ? ` · ${elegido.texto.toUpperCase()}` : ''
    hoja.poner(4, primera - 1, `ANTIGÜEDAD DEL STOCK EN AMAZON${sufijoTramo}`, { ...banda, nombre: FUENTE.titulo, tam: 9, negrita: true, color: COLOR.naranja, v: 'center' })
    hoja.poner(5, primera - 1, 'Cuánto lleva el stock', { ...banda, nombre: FUENTE.titulo, tam: 20, negrita: true, color: COLOR.blanco, v: 'center' })
    hoja.poner(6, primera - 1, datos.cliente, { ...banda, nombre: FUENTE.titulo, tam: 20, negrita: true, color: COLOR.naranja, v: 'center' })
    hoja.poner(7, primera - 1, `${entero(informe.unidades)} unidades · ${entero(unidadesAntiguas)} de más de 90 días · ${frase}`, { ...banda, nombre: FUENTE.cuerpo, tam: 9, color: COLOR.claro, v: 'center' })

    /* ---------- las tres tarjetas ---------- */
    hoja.altoFila(9, 14)
    const desdeT = primera - 1
    const anchos = [tira ? 1.6 : 0, ...columnas.map((c) => c.ancho)] // la tira cuenta como parte de la primera columna
    const suma = (a: number, b: number) => anchos.slice(a, b).reduce((s, x) => s + x, 0)
    const n = anchos.length
    let mejor = { i: 1, j: 2, coste: Number.POSITIVE_INFINITY }
    for (let i = 1; i < n - 1; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const w = [suma(0, i), suma(i, j), suma(j, n)]
        const coste = Math.max(...w) - Math.min(...w) + (w[2] < 14 ? 100 : 0) + (w[0] < 11 || w[1] < 11 ? 100 : 0)
        if (coste < mejor.coste) mejor = { i, j, coste }
      }
    }
    const cortes = [0, mejor.i, mejor.j, n]
    const reparto = [0, 1, 2].map((k) => ({ desde: desdeT + cortes[k], hasta: desdeT + cortes[k + 1] - 1, ancho: suma(cortes[k], cortes[k + 1]) }))

    const tarjetas = [
      { rotulo: 'UNIDADES EN AMAZON', valor: entero(informe.unidades), nota: informe.fuente === 'amazon' ? 'las que tienen antigüedad' : 'con la edad estimada' },
      { rotulo: 'MÁS DE 90 DÍAS', valor: entero(unidadesAntiguas), nota: valorAntiguas > 0 ? `valen ${euros(valorAntiguas)} a precio de venta` : 'lo que Amazon llama inventario antiguo' },
      hayCoste
        ? { rotulo: 'ALMACENAJE AL MES', valor: eurosFinos(informe.costeMes), nota: (informe.recargoMes ?? 0) > 0 ? `incluye ${eurosFinos(informe.recargoMes)} de recargo por antigüedad` : 'lo que calcula Amazon' }
        : { rotulo: 'VALOR DEL STOCK', valor: euros(valorTotal), nota: 'a precio de venta' },
    ]
    hoja.altoFila(10, 17)
    hoja.altoFila(11, 32)
    hoja.altoFila(12, 17)
    tarjetas.forEach((t, i) => {
      const { desde, hasta, ancho } = reparto[i]
      const separa = i < tarjetas.length - 1
      const base: Estilo = { relleno: COLOR.crema, h: 'left', v: 'center', sangria: 1 }
      const tamCifra = Math.max(11, Math.min(19, Math.floor((ancho - 2) / (Math.max(1, t.valor.length) * 0.105))))
      const estilos: Estilo[] = [
        { ...base, nombre: FUENTE.cuerpo, tam: 7, color: COLOR.etiqueta, arriba: { estilo: 'thick', color: COLOR.naranja } },
        { ...base, nombre: FUENTE.titulo, tam: tamCifra, negrita: true, color: COLOR.tinta },
        { ...base, nombre: FUENTE.cuerpo, tam: 8, color: COLOR.etiqueta, ajustar: true },
      ]
      const textos = [t.rotulo, t.valor, t.nota]
      ;[10, 11, 12].forEach((fila, k) => {
        for (let c = desde; c <= hasta; c += 1) {
          const estilo: Estilo = c === hasta && separa ? { ...estilos[k], derecha: { estilo: 'thick', color: COLOR.blanco } } : estilos[k]
          hoja.poner(fila, c, c === desde ? textos[k] : null, estilo)
        }
        hoja.combinar(fila, desde, fila, hasta)
      })
    })
    hoja.altoFila(13, 16)

    /* ---------- la tabla de tramos ---------- */
    hoja.altoFila(14, 16)
    hoja.poner(
      14,
      primera - 1,
      [
        { texto: '01', color: COLOR.naranja },
        { texto: '    POR TRAMO DE ANTIGÜEDAD', color: COLOR.etiqueta },
      ],
      { nombre: FUENTE.titulo, tam: 9, negrita: true, color: COLOR.etiqueta, v: 'bottom' }
    )
    hoja.altoFila(15, 26)
    hoja.poner(15, primera - 1, 'Cuánto hay en cada tramo', { nombre: FUENTE.titulo, tam: 15, negrita: true, color: COLOR.tinta, v: 'center', abajo: { estilo: 'medium', color: COLOR.naranja } })
    for (let c = primera; c <= ultima; c += 1) hoja.poner(15, c, null, { abajo: { estilo: 'medium', color: COLOR.naranja } })
    hoja.altoFila(16, 8)

    const filaCabecera = 17
    hoja.altoFila(filaCabecera, 28)
    const cabecera = (c: number, texto: string | null, h: 'left' | 'right') =>
      hoja.poner(filaCabecera, c, texto, { relleno: COLOR.banda, nombre: FUENTE.titulo, tam: 8, negrita: true, color: COLOR.blanco, h, v: 'center', ajustar: true, sangria: 1, arriba: { estilo: 'medium', color: COLOR.naranja } })
    cabecera(tira, null, 'left')
    columnas.forEach((c, i) => cabecera(primera + i, c.titulo, c.h))

    const total = Math.max(1, informe.unidades)
    informe.tramos.forEach((t, i) => {
      const fila = filaCabecera + 1 + i
      const vacio = t.unidades === 0
      const marcado = elegido?.id === t.id
      const relleno = marcado ? COLOR.aviso : i % 2 === 0 ? COLOR.crema : undefined
      const base: Estilo = { relleno, nombre: FUENTE.cuerpo, tam: 9, color: vacio ? COLOR.discreto : COLOR.tinta, v: 'center', sangria: 1, abajo: { estilo: 'thin', color: COLOR.raya } }
      hoja.altoFila(fila, 21)
      hoja.poner(fila, tira, null, { relleno: colorDe(t.id), abajo: { estilo: 'thin', color: COLOR.blanco } })
      hoja.poner(fila, colDe('tramo'), t.texto, { ...base, h: 'left', negrita: !vacio })
      hoja.poner(fila, colDe('unidades'), t.unidades, { ...base, h: 'right', negrita: !vacio, tam: 10, formato: '#,##0' })
      // Una fracción con el formato de porcentaje de Excel: «0,8» se ve «80 %». El «%» entre comillas se
      // ve distinto según quién abra el fichero (Quick Look lo multiplicaba por cien dos veces)
      hoja.poner(fila, colDe('pct'), t.unidades / total, { ...base, h: 'right', formato: '0\\ %' })
      if (columnas.some((c) => c.id === 'valor')) hoja.poner(fila, colDe('valor'), t.valor, { ...base, h: 'right', formato: '#,##0.00" €"' })
      if (hayCoste) hoja.poner(fila, colDe('coste'), t.coste ?? 0, { ...base, h: 'right', formato: '#,##0.00" €"' })
    })

    const filaTotal = filaCabecera + 1 + informe.tramos.length
    hoja.altoFila(filaTotal, 27)
    const fondo: Estilo = { relleno: COLOR.banda, v: 'center', sangria: 1 }
    hoja.pintar(filaTotal, tira, ultima, fondo)
    hoja.poner(filaTotal, colDe('tramo'), 'TOTAL', { ...fondo, nombre: FUENTE.titulo, tam: 9, negrita: true, color: COLOR.blanco, h: 'left' })
    hoja.poner(filaTotal, colDe('unidades'), informe.unidades, { ...fondo, nombre: FUENTE.titulo, tam: 12, negrita: true, color: COLOR.naranjaClaro, h: 'right', formato: '#,##0' })
    if (columnas.some((c) => c.id === 'valor')) hoja.poner(filaTotal, colDe('valor'), valorTotal, { ...fondo, nombre: FUENTE.titulo, tam: 10, negrita: true, color: COLOR.blanco, h: 'right', formato: '#,##0.00" €"' })
    if (hayCoste) hoja.poner(filaTotal, colDe('coste'), informe.costeMes ?? 0, { ...fondo, nombre: FUENTE.titulo, tam: 10, negrita: true, color: COLOR.naranjaClaro, h: 'right', formato: '#,##0.00" €"' })

    /* ---------- lo que hay que saber ---------- */
    let fila = filaTotal + 1
    hoja.altoFila(fila, 14)
    fila += 1
    const avisos: string[] = []
    if (informe.fuente === 'libro') {
      avisos.push('Amazon todavía no ha dado su informe de antigüedad: esta es una estimación con el libro mayor, donde lo más antiguo se vende primero.')
      if (informe.tramos.some((t) => t.id === 'anterior')) avisos.push('«Anterior al libro» son unidades que ya estaban en Amazon antes de empezar el libro que leemos: su edad es esa o más.')
    } else if (informe.recargoMes !== null && informe.recargoMes > 0) {
      avisos.push('A partir de 181 días Amazon cobra un recargo por antigüedad: está incluido en el almacenaje al mes.')
    }
    if (avisos.length > 0) {
      const filo: Estilo = { relleno: COLOR.aviso, izquierda: { estilo: 'thick', color: COLOR.naranja } }
      hoja.altoFila(fila, 20)
      hoja.pintar(fila, primera, ultima, { relleno: COLOR.aviso })
      hoja.poner(fila, primera, 'A TENER EN CUENTA', { ...filo, nombre: FUENTE.titulo, tam: 9, negrita: true, color: COLOR.naranja, v: 'center', sangria: 1 })
      fila += 1
      const texto = avisos.join('\n')
      hoja.pintar(fila, primera, ultima, { relleno: COLOR.aviso })
      hoja.poner(fila, primera, texto, { ...filo, nombre: FUENTE.cuerpo, tam: 9, color: COLOR.tinta, h: 'left', v: 'top', ajustar: true, sangria: 1 })
      hoja.combinar(fila, primera, fila, ultima)
      hoja.altoFila(fila, Math.max(30, lineasDe(texto, Math.floor(anchoTabla * 1.05)) * 13 + 12))
      fila += 1
      hoja.altoFila(fila, 14)
      fila += 1
    }
    hoja.altoFila(fila, 15)
    hoja.poner(fila, primera - 1, `Liberty Seller · Informe generado el ${fechaLarga(hoy)}`, { nombre: FUENTE.cuerpo, tam: 8, color: COLOR.discreto, v: 'center' })
  }

  /* ================================================================== */
  /* HOJA 2 · PRODUCTOS                                                  */
  /* ================================================================== */
  {
    const hoja = libro.hoja('Productos')
    hoja.colorPestana = COLOR_PESTANA

    interface Col {
      id: string
      titulo: string
      ancho: number
      h: 'left' | 'center' | 'right'
    }
    const columnas: Col[] = [
      { id: 'tramo', titulo: 'Tramo', ancho: 15, h: 'left' },
      { id: 'producto', titulo: 'Producto', ancho: 46, h: 'left' },
      { id: 'sku', titulo: 'SKU', ancho: 25, h: 'left' },
      { id: 'asin', titulo: 'ASIN', ancho: 13, h: 'left' },
      { id: 'enTramo', titulo: 'En este tramo', ancho: 11, h: 'right' },
      { id: 'total', titulo: 'Total en Amazon', ancho: 11, h: 'right' },
      ...(hayPrecio ? [{ id: 'valor', titulo: 'Valor del tramo', ancho: 13, h: 'right' as const }] : []),
      ...(hayCoste ? [{ id: 'coste', titulo: 'Almacenaje/mes', ancho: 14, h: 'right' as const }] : []),
      { id: 'ritmo', titulo: 'Ud/día', ancho: 9, h: 'right' },
      { id: 'ultima', titulo: 'Última venta', ancho: 13, h: 'center' },
    ]
    const tira = 2
    const primera = 3
    const ultima = primera + columnas.length - 1
    const margenDerecho = ultima + 1
    const colDe = (id: string) => primera + columnas.findIndex((c) => c.id === id)

    hoja.anchoColumna(1, 2.4)
    hoja.anchoColumna(tira, 1.6)
    columnas.forEach((c, i) => hoja.anchoColumna(primera + i, c.ancho))
    hoja.anchoColumna(margenDerecho, 2.4)

    /* ---------- una banda corta: el título y de dónde sale ---------- */
    const banda: Estilo = { relleno: COLOR.banda }
    hoja.pintar(1, 1, margenDerecho, { relleno: COLOR.naranja })
    hoja.altoFila(1, 5)
    hoja.pintar(2, 1, margenDerecho, banda)
    hoja.altoFila(2, 26)
    hoja.pintar(3, 1, margenDerecho, banda)
    hoja.altoFila(3, 16)
    hoja.poner(
      2,
      primera - 1,
      [
        { texto: `PRODUCTOS POR ANTIGÜEDAD${elegido ? ` · ${elegido.texto.toUpperCase()}` : ''}`, color: COLOR.naranja, tam: 9 },
        { texto: `     ${datos.cliente}`, color: COLOR.blanco, tam: 13 },
      ],
      { ...banda, nombre: FUENTE.titulo, tam: 9, negrita: true, color: COLOR.naranja, v: 'center' }
    )
    hoja.poner(3, primera - 1, `${entero(filas.length)} fila${filas.length === 1 ? '' : 's'} · ${entero(unidadesFilas)} unidades · ${frase}`, { ...banda, nombre: FUENTE.cuerpo, tam: 8.5, color: COLOR.claro, v: 'center' })
    hoja.altoFila(4, 8)

    /* ---------- la cabecera de la tabla ---------- */
    const filaCabecera = 5
    hoja.altoFila(filaCabecera, 28)
    hoja.poner(filaCabecera, tira, null, { relleno: COLOR.banda, arriba: { estilo: 'medium', color: COLOR.naranja } })
    columnas.forEach((c, i) => {
      hoja.poner(filaCabecera, primera + i, c.titulo, { relleno: COLOR.banda, nombre: FUENTE.titulo, tam: 8, negrita: true, color: COLOR.blanco, h: c.h, v: 'center', ajustar: true, sangria: 1, arriba: { estilo: 'medium', color: COLOR.naranja } })
    })

    /* ---------- las filas ---------- */
    const anchoProducto = columnas.find((c) => c.id === 'producto')!.ancho
    filas.forEach(({ tramo, p }, i) => {
      const fila = filaCabecera + 1 + i
      const s = p.sku
      const relleno = i % 2 === 0 ? COLOR.crema : undefined
      const base: Estilo = { relleno, nombre: FUENTE.cuerpo, tam: 9, color: COLOR.tinta, v: 'center', sangria: 1, abajo: { estilo: 'thin', color: COLOR.raya } }
      const nombre = s.nombre?.trim() || s.sku
      hoja.altoFila(fila, Math.max(19, lineasDe(nombre, Math.floor(anchoProducto * 1.05)) * 12.5 + 7))

      hoja.poner(fila, tira, null, { relleno: colorDe(tramo.id), abajo: { estilo: 'thin', color: COLOR.blanco } })
      hoja.poner(fila, colDe('tramo'), tramo.texto, { ...base, h: 'left', negrita: true })
      hoja.poner(fila, colDe('producto'), nombre, { ...base, h: 'left', ajustar: true })
      hoja.poner(fila, colDe('sku'), s.sku, { ...base, h: 'left', color: COLOR.etiqueta, tam: 8.5 })
      hoja.poner(fila, colDe('asin'), s.asin, { ...base, h: 'left', color: COLOR.etiqueta, tam: 8.5 })
      hoja.poner(fila, colDe('enTramo'), p.unidades, { ...base, h: 'right', negrita: true, tam: 10, color: COLOR.naranja, formato: '#,##0' })
      hoja.poner(fila, colDe('total'), s.enAmazon, { ...base, h: 'right', formato: '#,##0' })
      if (hayPrecio) hoja.poner(fila, colDe('valor'), p.valor, { ...base, h: 'right', formato: '#,##0.00" €"' })
      if (hayCoste) hoja.poner(fila, colDe('coste'), p.coste, { ...base, h: 'right', formato: '#,##0.00" €"' })
      hoja.poner(fila, colDe('ritmo'), s.ritmoPlan > 0 ? Math.round(s.ritmoPlan * 100) / 100 : null, { ...base, h: 'right', formato: '0.00' })
      hoja.poner(fila, colDe('ultima'), s.ultimaVenta ? fechaCorta(s.ultimaVenta) : 'nunca', { ...base, h: 'center', color: s.ultimaVenta ? COLOR.tinta : COLOR.discreto })
    })

    const ultimaFila = filaCabecera + filas.length
    hoja.congelar = { filas: filaCabecera }
    hoja.filtro = { fila: filaCabecera, desde: tira + 1, hasta: ultima, hastaFila: Math.max(ultimaFila, filaCabecera) }

    /* ---------- el total, fuera del filtro ---------- */
    const filaTotal = ultimaFila + 2
    hoja.altoFila(ultimaFila + 1, 8)
    hoja.altoFila(filaTotal, 27)
    const fondo: Estilo = { relleno: COLOR.banda, v: 'center', sangria: 1 }
    hoja.pintar(filaTotal, tira, ultima, fondo)
    hoja.poner(filaTotal, colDe('producto'), `TOTAL${elegido ? ` · ${elegido.texto.toUpperCase()}` : ''}`, { ...fondo, nombre: FUENTE.titulo, tam: 9, negrita: true, color: COLOR.blanco, h: 'left' })
    hoja.poner(filaTotal, colDe('enTramo'), unidadesFilas, { ...fondo, nombre: FUENTE.titulo, tam: 12, negrita: true, color: COLOR.naranjaClaro, h: 'right', formato: '#,##0' })
    if (hayPrecio) hoja.poner(filaTotal, colDe('valor'), Math.round(valorFilas * 100) / 100, { ...fondo, nombre: FUENTE.titulo, tam: 10, negrita: true, color: COLOR.blanco, h: 'right', formato: '#,##0.00" €"' })
    if (hayCoste) hoja.poner(filaTotal, colDe('coste'), Math.round(costeFilas * 100) / 100, { ...fondo, nombre: FUENTE.titulo, tam: 10, negrita: true, color: COLOR.naranjaClaro, h: 'right', formato: '#,##0.00" €"' })

    hoja.altoFila(filaTotal + 1, 14)
    hoja.altoFila(filaTotal + 2, 15)
    hoja.poner(filaTotal + 2, primera - 1, `Liberty Seller · Informe generado el ${fechaLarga(hoy)}`, { nombre: FUENTE.cuerpo, tam: 8, color: COLOR.discreto, v: 'center' })
    hoja.vertical = false
  }

  const sufijo = elegido ? `-${limpio(elegido.texto, 24)}` : ''
  return {
    xlsx: libro.empaquetar(),
    filas: filas.length,
    unidades: unidadesFilas,
    nombreFichero: `antiguedad-stock-${limpio(datos.cliente) || 'cliente'}-${hoy}${sufijo}.xlsx`,
  }
}
