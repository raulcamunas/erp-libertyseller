import {
  analizarProductos,
  CLASE_TEXTO,
  diasEntre,
  resumenDeRitmo,
  serieDeRemesa,
  type Clase,
  type DiaSerie,
  type FilaProducto,
  type ResumenRitmo,
} from './analisis'
import type { RemesaDePanel, SkuDePanel } from './datos'
import { recepcionContada } from './fifo'
import { ESTADO_INBOUND_TEXTO } from './inbound-estados'
import { ESTADOS_AMAZON_MALOS, PASOS_AMAZON, estaEnlazada, fechasDePasos, indicePasoAmazon } from './vista'
import { fechaCorta, fechaLarga } from './propuesta-excel'

/**
 * EL INFORME DE UN PEDIDO: CÓMO ESTÁ A DÍA DE HOY, CONTADO EN CIFRAS Y EN PALABRAS.
 * =================================================================================
 * PURO: entra lo que el panel ya calcula, sale lo que el PDF tiene que pintar. No toca la base
 * ni la red. Se comprueba con informe-pedido.prueba.ts.
 *
 * Responde a lo que se pregunta de un envío cuando ya ha salido: cuántas unidades mandamos,
 * cuántas ha recibido Amazon y cuántas no, cuántas se han vendido y a qué ritmo, y cuántas
 * quedan en el almacén y para cuántos días.
 *
 *
 * ============ LAS MISMAS CIFRAS QUE LA PANTALLA ============
 *
 * No se recalcula nada del reparto: `analizarProductos`, `resumenDeRitmo` y `serieDeRemesa` son
 * los de las pestañas del envío, y «Vendidas» es lo mismo que enseña la pantalla (lo que ha
 * salido del stock de este envío, neto de devoluciones, retiradas y mermas incluidas). Un
 * informe que dijera 64 donde la pantalla dice 60 se desmentiría solo delante del cliente.
 *
 *
 * ============ UN ENVÍO QUE TODAVÍA NO HA LLEGADO NO «FALTA» ============
 *
 * Mientras el envío va de camino Amazon contesta cero unidades recibidas, y ese cero SE GUARDA
 * (ver recepcionContada en fifo.ts). Leerlo como «llegaron 0 de 120, faltan 120» sería decirle al
 * cliente que ha perdido el pedido entero. Solo se hace caso a lo recibido cuando Amazon ha
 * empezado a contarlo; antes, el informe dice que está en camino y no inventa una falta.
 */

export type Recepcion =
  /** Amazon ha empezado a contarlo (registrado, recibiendo o cerrado): lo recibido es cierto */
  | 'contada'
  /** Está enlazado y todavía no ha llegado: lo que contesta Amazon es cero porque no ha contado */
  | 'en_camino'
  /** Sin número de envío o sin consultar: no se sabe qué ha recibido, y el reparto usa lo enviado */
  | 'sin_confirmar'

export interface CifrasDePedido {
  referencias: number
  enviadas: number
  /** null = no se sabe todavía (en camino o sin confirmar) */
  recibidas: number | null
  /** Enviadas menos recibidas, solo cuando Amazon ya ha contado. Es lo que se puede reclamar */
  faltan: number
  /** Lo contrario: unidades que Amazon ha recibido de MÁS en las referencias donde recibió más de lo enviado, y en cuántas */
  sobrantes: number
  referenciasConDeMas: number
  /** Como en la pantalla: lo que ha salido del stock, neto de devoluciones. Incluye retiradas y mermas */
  vendidas: number
  retiradas: number
  mermas: number
  /** Lo que de `vendidas` son ventas de verdad: sin las retiradas ni las mermas */
  ventasReales: number
  devueltas: number
  quedan: number
  /** Referencias de las que ya no queda nada */
  agotadas: number
  /** Sobre lo que se repartió: lo recibido si Amazon ha contado, lo enviado si no */
  base: number
  /** 0-100. Lo recibido sobre lo enviado. null si no se sabe */
  pctRecibido: number | null
  pctVendido: number
  pctQuedan: number
  udDia7: number
  udDia30: number
  udDiaTotal: number
  /** Días de stock de todo el envío al ritmo de la última semana */
  cobertura: number | null
  seAgotaEl: string | null
}

export type IdParteEmbudo = 'vendidas' | 'retiradas' | 'quedan' | 'faltan'

export interface ParteEmbudo {
  id: IdParteEmbudo
  texto: string
  unidades: number
  /** 0-100 sobre el total de las cuatro partes */
  pct: number
}

export interface ProductoDeInforme extends FilaProducto {
  /** El texto de cómo rota: «Rápida», «Lenta»… */
  rotacion: string
}

export interface PasoDeAmazon {
  texto: string
  /** 'YYYY-MM-DD' en que se vio por primera vez; null = no se vio (el envío se mira cada hora y a veces salta pasos) */
  fecha: string | null
  hecho: boolean
}

export interface LineaQueNoLlego {
  sku: string
  nombre: string | null
  variante: string | null
  enviadas: number
  recibidas: number
  faltan: number
}

export interface InformeDePedido {
  cliente: string
  titulo: string
  referenciaEnvio: string | null
  /** «Cerrado», «En tránsito»… como lo llama la pantalla */
  estadoTexto: string
  hoy: string
  /** Hasta qué día están leídas las ventas ('YYYY-MM-DD'). Amazon las entrega con retraso: lo posterior todavía no cuenta. null = no se sabe */
  ventasHasta: string | null
  fechaEnvio: string
  /** 'YYYY-MM-DD'. null = no se sabe cuándo entró */
  llegada: string | null
  /** Desde cuándo cuenta el reparto: la llegada o, si no, el envío */
  cuentaDesde: string
  /** Días que lleva en el almacén (o desde el envío si no se sabe la llegada). null si todavía no ha llegado */
  diasDeVida: number | null
  destinos: string[]
  recepcion: Recepcion
  pasos: PasoDeAmazon[]
  cifras: CifrasDePedido
  embudo: ParteEmbudo[]
  /** Un día por fila, sin huecos, desde `cuentaDesde` hasta hoy. Vacía si todavía no ha llegado */
  serie: DiaSerie[]
  ritmo: ResumenRitmo
  productos: ProductoDeInforme[]
  noLlegaron: LineaQueNoLlego[]
  /** El pedido contado en cuatro frases */
  resumen: string[]
  /** Lo que hay que saber para leer bien las cifras */
  avisos: string[]
}

/* ------------------------------------------------------------------ */
/* Pequeñas cuentas                                                    */
/* ------------------------------------------------------------------ */

const n0 = (x: number) => x.toLocaleString('es-ES')
const n1 = (x: number) => x.toLocaleString('es-ES', { maximumFractionDigits: 1 })
const cuantas = (c: number, uno: string, varios: string) => `${n0(c)} ${c === 1 ? uno : varios}`
const pct = (parte: number, total: number) => (total > 0 ? Math.round((parte / total) * 100) : 0)

/** «a, b y c» */
function unir(partes: string[]): string {
  if (partes.length <= 1) return partes.join('')
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}

/**
 * El estado del envío con las mismas palabras que la insignia de la pantalla
 * (components/remesas/envios/estadoAmazon.tsx): quien lee el PDF y la pantalla a la vez no debería
 * ver «Cerrado» en un sitio y «Finalizado» en otro.
 */
export function textoDeEstado(r: Pick<RemesaDePanel, 'referenciaEnvio' | 'estadoAmazon' | 'seguimientoError'>): string {
  if (!estaEnlazada(r)) return 'Sin enlazar con Amazon'
  if (r.seguimientoError) return 'Amazon no lo reconoce'
  const e = r.estadoAmazon
  if (!e) return 'Sin consultar'
  if (ESTADOS_AMAZON_MALOS.includes(e)) return ESTADO_INBOUND_TEXTO[e]?.texto ?? e
  switch (e) {
    case 'CLOSED':
      return 'Cerrado'
    case 'RECEIVING':
      return 'Recibiendo'
    case 'CHECKED_IN':
      return 'Registrado'
    case 'DELIVERED':
      return 'Entregado'
    case 'SHIPPED':
    case 'IN_TRANSIT':
      return 'En tránsito'
    default:
      return ESTADO_INBOUND_TEXTO[e]?.texto ?? e
  }
}

/** Qué se sabe de lo recibido. Ver «UN ENVÍO QUE TODAVÍA NO HA LLEGADO NO FALTA» */
export function recepcionDe(r: Pick<RemesaDePanel, 'referenciaEnvio' | 'estadoAmazon' | 'seguimientoError'>): Recepcion {
  if (recepcionContada(r.estadoAmazon)) return 'contada'
  if (estaEnlazada(r) && !r.seguimientoError && r.estadoAmazon && !ESTADOS_AMAZON_MALOS.includes(r.estadoAmazon)) return 'en_camino'
  return 'sin_confirmar'
}

/* ------------------------------------------------------------------ */
/* El informe                                                          */
/* ------------------------------------------------------------------ */

export function informeDePedido(entrada: { cliente: string; remesa: RemesaDePanel; skus: SkuDePanel[]; hoy: string; ventasHasta?: string | null }): InformeDePedido {
  const { cliente, remesa, skus, hoy } = entrada
  const ventasHasta = entrada.ventasHasta && /^\d{4}-\d{2}-\d{2}$/.test(entrada.ventasHasta) ? entrada.ventasHasta : null
  const recepcion = recepcionDe(remesa)
  const contada = recepcion === 'contada'
  const enCamino = recepcion === 'en_camino'

  const filas = analizarProductos(remesa, new Map(skus.map((s) => [s.sku, s])), hoy)
  const ritmo = resumenDeRitmo(remesa, filas, hoy)

  /* ---------- las cifras ---------- */
  const enviadas = remesa.lineas.reduce((s, l) => s + l.enviadas, 0)
  // Lo recibido solo vale cuando Amazon ha empezado a contar; una línea sin respuesta cuenta con lo declarado, como en el reparto
  const recibidas = contada ? remesa.lineas.reduce((s, l) => s + (l.recibidas ?? l.enviadas), 0) : null
  const faltan = contada ? remesa.lineas.reduce((s, l) => s + (l.recibidas !== null && l.recibidas < l.enviadas ? l.enviadas - l.recibidas : 0), 0) : 0
  // Recibir de más en una referencia no compensa lo que falta en otra: «faltan» solo cuenta las que se quedaron cortas
  const conDeMas = contada ? remesa.lineas.filter((l) => l.recibidas !== null && l.recibidas > l.enviadas) : []
  const sobrantes = conDeMas.reduce((s, l) => s + ((l.recibidas as number) - l.enviadas), 0)
  const vendidas = remesa.lineas.reduce((s, l) => s + l.consumidas, 0)
  const retiradas = remesa.lineas.reduce((s, l) => s + l.retiradas, 0)
  const mermas = remesa.lineas.reduce((s, l) => s + l.mermas, 0)
  const devueltas = remesa.lineas.reduce((s, l) => s + l.devueltas, 0)
  const quedan = remesa.quedan
  const ventasReales = Math.max(0, vendidas - retiradas - mermas)
  const agotadas = remesa.lineas.filter((l) => l.quedan === 0).length
  // La base es la misma que usó el reparto: lo recibido si Amazon ha contado, lo enviado si no
  const base = Math.max(1, contada ? (recibidas ?? enviadas) : enviadas)

  const cifras: CifrasDePedido = {
    referencias: remesa.lineas.length,
    enviadas,
    recibidas,
    faltan,
    sobrantes,
    referenciasConDeMas: conDeMas.length,
    vendidas,
    retiradas,
    mermas,
    ventasReales,
    devueltas,
    quedan,
    agotadas,
    base,
    pctRecibido: recibidas === null ? null : pct(recibidas, Math.max(1, enviadas)),
    pctVendido: pct(vendidas, base),
    pctQuedan: pct(quedan, base),
    udDia7: ritmo.udDia7,
    udDia30: ritmo.udDia30,
    udDiaTotal: ritmo.udDiaRemesa,
    cobertura: ritmo.cobertura,
    seAgotaEl: ritmo.seAgotaEl,
  }

  /* ---------- del envío al almacén: en qué ha quedado cada unidad ---------- */
  const partes: Array<Omit<ParteEmbudo, 'pct'>> = [
    { id: 'vendidas', texto: 'Vendidas', unidades: ventasReales },
    { id: 'retiradas', texto: 'Retiradas y mermas', unidades: Math.max(0, vendidas - ventasReales) },
    { id: 'quedan', texto: 'En el almacén', unidades: quedan },
    { id: 'faltan', texto: 'No han llegado', unidades: faltan },
  ]
  const totalPartes = partes.reduce((s, p) => s + p.unidades, 0)
  const embudo: ParteEmbudo[] = partes.map((p) => ({ ...p, pct: pct(p.unidades, totalPartes) }))

  /* ---------- fechas y recorrido en Amazon ---------- */
  const llegada = remesa.llegadaAt ? remesa.llegadaAt.slice(0, 10) : null
  const diasDeVida = enCamino ? null : Math.max(0, diasEntre(remesa.cuentaDesde, hoy))
  const idxPaso = indicePasoAmazon(remesa.estadoAmazon)
  const fechasPaso = fechasDePasos(remesa.eventos)
  const hayRecorrido = estaEnlazada(remesa) && !!remesa.estadoAmazon && !ESTADOS_AMAZON_MALOS.includes(remesa.estadoAmazon)
  const pasos: PasoDeAmazon[] = hayRecorrido
    ? PASOS_AMAZON.map((p, i) => ({ texto: p.texto, fecha: fechasPaso[i] ? fechasPaso[i]!.slice(0, 10) : null, hecho: i <= idxPaso }))
    : []
  const destinos = [...new Set(remesa.envios.map((e) => (e.destino ?? '').trim()).filter(Boolean))]

  /* ---------- los productos: lo más vendido arriba ---------- */
  const productos: ProductoDeInforme[] = filas
    .map((f) => ({ ...f, rotacion: CLASE_TEXTO[f.clase as Clase].texto }))
    .sort((a, b) => b.vendidas - a.vendidas || b.quedan - a.quedan || a.sku.localeCompare(b.sku))

  const noLlegaron: LineaQueNoLlego[] = contada
    ? remesa.lineas
        .filter((l) => l.recibidas !== null && l.recibidas < l.enviadas)
        .map((l) => ({ sku: l.sku, nombre: l.nombre, variante: l.variante, enviadas: l.enviadas, recibidas: l.recibidas as number, faltan: l.enviadas - (l.recibidas as number) }))
        .sort((a, b) => b.faltan - a.faltan || a.sku.localeCompare(b.sku))
    : []

  const serie = enCamino ? [] : serieDeRemesa(remesa, hoy)

  const informe: InformeDePedido = {
    cliente,
    titulo: remesa.nombre?.trim() || `Envío del ${fechaCorta(remesa.fechaEnvio)}`,
    referenciaEnvio: estaEnlazada(remesa) ? (remesa.referenciaEnvio ?? '').trim() : null,
    estadoTexto: textoDeEstado(remesa),
    hoy,
    ventasHasta,
    fechaEnvio: remesa.fechaEnvio,
    llegada,
    cuentaDesde: remesa.cuentaDesde,
    diasDeVida,
    destinos,
    recepcion,
    pasos,
    cifras,
    embudo,
    serie,
    ritmo,
    productos,
    noLlegaron,
    resumen: [],
    avisos: [],
  }
  informe.resumen = resumenEnPalabras(informe, remesa)
  informe.avisos = avisosDe(informe)
  return informe
}

/* ------------------------------------------------------------------ */
/* El pedido contado en frases                                         */
/* ------------------------------------------------------------------ */

function resumenEnPalabras(i: InformeDePedido, remesa: Pick<RemesaDePanel, 'agotadaEl'>): string[] {
  const c = i.cifras
  const frases: string[] = []

  /* 1 · lo que se mandó y lo que ha llegado */
  let envio = `Se enviaron ${cuantas(c.enviadas, 'unidad', 'unidades')} de ${cuantas(c.referencias, 'referencia', 'referencias')} el ${fechaLarga(i.fechaEnvio)}.`
  if (i.recepcion === 'contada') {
    envio +=
      c.faltan > 0
        ? ` Amazon ha recibido ${n0(c.recibidas ?? 0)}: faltan ${n0(c.faltan)}.`
        : ` Amazon las ha recibido todas${i.llegada ? ` (entraron en el almacén el ${fechaLarga(i.llegada)})` : ''}.`
  } else if (i.recepcion === 'en_camino') {
    envio += ' Todavía no han llegado: el envío va de camino y Amazon no ha empezado a recibirlo.'
  } else {
    envio += ' Amazon no ha confirmado cuántas ha recibido, así que las cifras se calculan con lo enviado.'
  }
  frases.push(envio)

  if (i.recepcion === 'en_camino') return frases

  /* 2 · lo que se ha vendido y a qué ritmo */
  const dias = i.diasDeVida ?? 0
  const desde = `${i.llegada ? 'llegó' : 'se envió'}${dias > 0 ? ` (hace ${cuantas(dias, 'día', 'días')})` : ''}`
  if (c.vendidas <= 0) {
    frases.push(`Desde que ${desde} todavía no se ha vendido ninguna unidad.`)
  } else {
    let venta = `Desde que ${desde} se han vendido ${cuantas(c.vendidas, 'unidad', 'unidades')}, el ${c.pctVendido} % de lo ${i.recepcion === 'contada' ? 'recibido' : 'enviado'}`
    venta += `: ${n1(c.udDiaTotal)} al día de media${c.udDia7 !== c.udDiaTotal ? ` y ${n1(c.udDia7)} en la última semana` : ''}.`
    const noVentas = c.vendidas - c.ventasReales
    if (noVentas > 0) {
      const partes = [c.retiradas > 0 ? `${cuantas(c.retiradas, 'retirada', 'retiradas')} del almacén` : '', c.mermas > 0 ? cuantas(c.mermas, 'merma', 'mermas') : ''].filter(Boolean)
      venta += ` De ellas, ${n0(noVentas)} ${noVentas === 1 ? 'no es una venta' : 'no son ventas'} (${unir(partes)}).`
    }
    frases.push(venta)
  }

  /* 3 · lo que queda y para cuánto */
  if (c.quedan <= 0) {
    frases.push(`El pedido está agotado${remesa.agotadaEl ? ` desde el ${fechaLarga(remesa.agotadaEl)}` : ''}.`)
  } else if (c.cobertura !== null && c.cobertura > 365) {
    // Un ritmo ínfimo da «duran 4.000 días»: más que una cifra, es «no se mueve»
    frases.push(`Quedan ${cuantas(c.quedan, 'unidad', 'unidades')} en el almacén; al ritmo de la última semana duran más de un año.`)
  } else if (c.cobertura !== null && c.seAgotaEl) {
    frases.push(`Quedan ${cuantas(c.quedan, 'unidad', 'unidades')} en el almacén; al ritmo de la última semana duran unos ${n0(Math.max(1, Math.round(c.cobertura)))} días (se agotarían hacia el ${fechaLarga(c.seAgotaEl)}).`)
  } else {
    frases.push(`Quedan ${cuantas(c.quedan, 'unidad', 'unidades')} en el almacén; esta semana no se ha vendido ninguna, así que no se puede estimar cuánto durarán.`)
  }

  /* 4 · lo que hay que vigilar. La primera dice «referencias»; las siguientes no lo repiten («…, una se agotará…») */
  const alertas: string[] = []
  const alerta = (cantidad: number, uno: string, varios: string, resto = '') => {
    if (cantidad <= 0) return
    const texto = alertas.length === 0 ? cuantas(cantidad, `referencia ${uno}`, `referencias ${varios}`) : `${cantidad === 1 ? 'una' : n0(cantidad)} ${cantidad === 1 ? uno : varios}`
    alertas.push(`${texto}${resto}`)
  }
  alerta(i.ritmo.agotadas, 'está agotada', 'están agotadas')
  alerta(i.ritmo.encaminoDeAgotarse, 'se agotará', 'se agotarán', ' en menos de una semana')
  alerta(i.ritmo.sinVentas, 'no se ha vendido', 'no se han vendido', ' en los últimos 30 días')
  if (alertas.length > 0) frases.push(`${unir(alertas)}.`)

  return frases
}

/* ------------------------------------------------------------------ */
/* Lo que hay que saber para leer las cifras                           */
/* ------------------------------------------------------------------ */

function avisosDe(i: InformeDePedido): string[] {
  const c = i.cifras
  const avisos: string[] = []
  // Las ventas se leen del libro mayor de Amazon, que llega con retraso. Con un día o dos es lo normal y basta con decir hasta
  // cuándo están; con más, el informe «a día de hoy» se queda corto y lo primero que hay que saber es eso
  if (i.ventasHasta) {
    const atraso = diasEntre(i.ventasHasta, i.hoy)
    if (atraso >= 3) {
      avisos.push(`Las ventas están leídas hasta el ${fechaLarga(i.ventasHasta)}, hace ${atraso} días: lo vendido desde entonces todavía no cuenta, así que las unidades que quedan pueden ser menos de las que aquí salen.`)
    }
  }
  if (i.recepcion === 'en_camino') {
    avisos.push('El envío todavía no ha llegado al almacén de Amazon, así que no hay ventas que repartir. Este informe se puede volver a generar cuando Amazon empiece a recibirlo.')
    return avisos
  }
  if (i.recepcion === 'sin_confirmar') {
    avisos.push('Amazon no ha confirmado qué ha recibido de este envío (o no está enlazado con su número de envío FBA): las cifras de almacén se calculan con las unidades enviadas.')
  }
  // «80 enviadas, 78 recibidas, faltan 4» parece una resta mal hecha: se explica
  if (c.faltan > 0 && c.sobrantes > 0 && c.recibidas !== null) {
    const diferencia = c.enviadas - c.recibidas
    avisos.push(
      diferencia > 0
        ? `En ${cuantas(c.referenciasConDeMas, 'referencia', 'referencias')} Amazon ha recibido más de lo que se envió (${cuantas(c.sobrantes, 'unidad de más', 'unidades de más')} en total): por eso la diferencia entre enviadas y recibidas (${n0(diferencia)}) es menor que lo que falta (${n0(c.faltan)}), que solo cuenta las referencias que se quedaron cortas.`
        : `Amazon ha recibido en total tantas unidades como se enviaron o más, pero no en las mismas referencias: faltan ${n0(c.faltan)} en unas y le sobran ${n0(c.sobrantes)} en otras.`
    )
  }
  const noVentas = c.vendidas - c.ventasReales
  if (noVentas > 0) {
    avisos.push(
      `«Vendidas» incluye ${cuantas(noVentas, 'unidad que no es una venta', 'unidades que no son ventas')}: ${unir([c.retiradas > 0 ? `${n0(c.retiradas)} retirada${c.retiradas === 1 ? '' : 's'} del almacén` : '', c.mermas > 0 ? `${n0(c.mermas)} merma${c.mermas === 1 ? '' : 's'} (pérdidas o daños)` : ''].filter(Boolean))}. Salen del stock, por eso restan.`
    )
  }
  if (c.devueltas > 0) {
    avisos.push(`${cuantas(c.devueltas, 'unidad devuelta', 'unidades devueltas')} por los clientes ya ${c.devueltas === 1 ? 'está descontada' : 'están descontadas'} de lo vendido.`)
  }
  avisos.push(
    'Amazon no distingue lotes: mezcla en el almacén la mercancía de varios envíos del mismo producto. Las ventas se asignan a cada pedido por orden de llegada, el más antiguo primero. Es una convención contable: el total sí cuadra con el stock de Amazon, el reparto entre pedidos no es un dato físico.'
  )
  return avisos
}
