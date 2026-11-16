/**
 * Textos y claves de los avisos del agente PPC al canal #notificaciones-erp (puro, sin servidor).
 *
 * Todo lo que publica el agente pasa por aquí: el resumen diario de las 09:00 (Madrid), el freno, el stock, la campaña que más vende sin
 * presupuesto, el fin del ensayo (o la veda de temporada), la primera escritura real, el techo automático y los fallos de la IA.
 * Cada función devuelve `{ titulo, cuerpo }`: el título sale en la campana (texto plano, ≤ 80 caracteres) y el cuerpo en el chat (con
 * **negrita**). Las cifras salen siempre del código; las frases de la IA solo en «La lectura» del resumen.
 */
import { AGENTE, type ClaseDeCambio, type DatosDelResumen, type MotivoDeFreno } from './tipos'

/** Los hechos que avisan. La clave del aviso los separa (uno por cuenta, hecho y día, salvo que se pase un id) */
export type HechoDeAviso =
  | 'resumen'
  | 'freno'
  | 'stock'
  | 'stock-vuelve'
  | 'stock-fallo'
  | 'agotada-top'
  | 'errores'
  | 'ventas-caidas'
  | 'ensayo-fin'
  | 'veda'
  | 'primera-escritura'
  | 'techo-auto'
  | 'ia-fallo'
  | 'ia-tope'
  | 'uso-error'
  | 'deshacer-fallo'

type Texto = { titulo: string; cuerpo: string }

const MAX_TITULO = 80

/** `ads-agente:<perfil>:<hecho>:<fecha>[:<id>]`: la misma clave no se publica dos veces */
/** El id del aviso de stock: «sin stock, aún no pauso» y «pauso» el mismo día tienen claves distintas (si no, el segundo se descarta en silencio) */
export function idDeAvisoDeStock(asin: string, motivo: 'recortar' | 'pausa'): string {
  return `${asin}:${motivo}`
}

/**
 * El id del aviso «sin stock, pauso»: con el ESTADO dentro. «Habría pausado» (ensayo, solo canal), «voy a pausar» (activo, a la campana) y «lo aplica una
 * persona» (frenado) son tres avisos distintos el mismo día: si el agente pasa de ensayo a activo ese día, el aviso real no se descarta como duplicado del ensayado.
 */
export function idDeAvisoDePausaPorStock(asin: string, estado: 'ensayo' | 'activo' | 'frenado'): string {
  return `${idDeAvisoDeStock(asin, 'pausa')}:${estado}`
}

/** Fecha fija de la clave de los avisos que salen UNA vez en la vida de lo que avisan (no una vez al día) */
export const FECHA_UNA_VEZ = 'una-vez'

/**
 * Fecha e id del aviso «vuelve el stock, pero no lo reactivo (una persona tocó la campaña)»: UNA vez por pausa, no cada día. Mientras haya stock la pausa sigue
 * «aplicada» y vigilar la devuelve en cada pasada; con la fecha de hoy en la clave salía un mensaje nuevo cada día, sin fin.
 */
export function avisoDeNoReactivar(asin: string, propuestaId: string): { fecha: string; id: string } {
  return { fecha: FECHA_UNA_VEZ, id: `${asin}:${propuestaId}:no-reactivo` }
}

/**
 * Fecha, id y campana del aviso «sin stock, aún no pauso» (recortar). UNA vez por EPISODIO de stock a 0 (desde `ceroDesde`, la primera lectura a 0 de
 * ads_agente_stock_cero), no cada día: un ASIN agotado no sirve anuncios, su campaña no gasta y la decisión se queda en «solo recortar» mientras dure la rotura.
 * En ensayo va al canal, no a la campana (como el de la pausa ensayada).
 */
export function avisoDeRecortarPorStock(e: { asin: string; ceroDesde: string | null; estado: 'ensayo' | 'activo' | 'frenado'; hoy: string }): { fecha: string; id: string; avisar?: false } {
  const desde = e.ceroDesde && /^\d{4}-\d{2}-\d{2}/.test(e.ceroDesde) ? e.ceroDesde : null
  return {
    fecha: desde ? desde.slice(0, 10) : e.hoy,
    id: desde ? `${idDeAvisoDeStock(e.asin, 'recortar')}:${desde}` : idDeAvisoDeStock(e.asin, 'recortar'),
    ...(e.estado === 'ensayo' ? { avisar: false as const } : {}),
  }
}

export function claveDeAviso(perfilId: string, hecho: HechoDeAviso, fecha: string, id?: string): string {
  const base = `ads-agente:${perfilId}:${hecho}:${fecha}`
  return id ? `${base}:${id}` : base
}

// ─── Formato de números y fechas (es-ES, a mano para que sea igual en cualquier Node) ───

/** Agrupa los miles con punto y pone coma decimal: 9840 → «9.840», 41 con 2 decimales → «41,00» */
function numeroEs(n: number, decimales: number): string {
  const valor = Number.isFinite(n) ? n : 0
  const negativo = valor < 0 && Math.abs(valor) >= 0.5 * 10 ** -decimales
  const [entera, frac] = Math.abs(valor).toFixed(decimales).split('.')
  const agrupada = entera.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${negativo ? '−' : ''}${agrupada}${frac ? `,${frac}` : ''}`
}

/** Importe con 2 decimales si tiene céntimos y es menor de 1.000; si no, redondeado */
function importe(n: number): string {
  const r = Math.round(n * 100) / 100
  const conCentimos = Math.abs(r) < 1000 && !Number.isInteger(r)
  return numeroEs(r, conCentimos ? 2 : 0)
}

function conMoneda(cifra: string, moneda: string | null): string {
  const m = (moneda ?? 'EUR').toUpperCase()
  if (m === 'EUR') return `${cifra} €`
  if (m === 'USD') return `$${cifra}`
  if (m === 'MXN') return `MX$${cifra}`
  if (m === 'GBP') return `£${cifra}`
  if (m === 'CAD') return `CA$${cifra}`
  return `${cifra} ${m}`
}

/** Importe con la moneda de la cuenta: EUR «1.230 €», USD «$1.230», MXN «MX$1.230». Sin moneda, euros */
export function dinero(n: number, moneda: string | null): string {
  return conMoneda(importe(n), moneda)
}

/** Importe siempre con 2 decimales («41,00 €»): el de «Ayer» */
function dinero2(n: number, moneda: string | null): string {
  return conMoneda(numeroEs(Math.round(n * 100) / 100, 2), moneda)
}

/** Porcentaje a 1 decimal, sin «,0»: 7,9 % · 10 % */
function pct(n: number): string {
  const r = Math.round(n * 10) / 10
  return `${numeroEs(r, Number.isInteger(r) ? 0 : 1)} %`
}

/** Variación entera con signo: «+10 %», «−4 %» */
function variacion(actual: number, anterior: number): string | null {
  if (!(anterior > 0)) return null
  const v = Math.round((actual / anterior - 1) * 100)
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} %`
}

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic']

function partesDeFecha(fecha: string): { y: number; m: number; d: number } | null {
  const x = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha)
  if (!x) return null
  return { y: Number(x[1]), m: Number(x[2]), d: Number(x[3]) }
}

/** «2026-11-19» → «19 nov» */
function diaMes(fecha: string): string {
  const p = partesDeFecha(fecha)
  return p ? `${p.d} ${MESES[p.m - 1]}` : fecha
}

/** «2026-11-19» → «jueves 19 nov» */
function diaLargo(fecha: string): string {
  const p = partesDeFecha(fecha)
  if (!p) return fecha
  const dia = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()
  return `${DIAS_SEMANA[dia]} ${p.d} ${MESES[p.m - 1]}`
}

/** El día siguiente a una fecha YYYY-MM-DD (la veda termina el `hasta`; se activa al día siguiente) */
function diaSiguiente(fecha: string): string {
  const p = partesDeFecha(fecha)
  if (!p) return fecha
  return new Date(Date.UTC(p.y, p.m - 1, p.d + 1)).toISOString().slice(0, 10)
}

// ─── Textos ───

/** Una línea, sin saltos, sin caracteres de control y con tope: para textos que vienen de fuera (Amazon, la IA) */
function unaLinea(s: string, max = 300): string {
  // eslint-disable-next-line no-control-regex
  const limpio = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return limpio.length > max ? `${limpio.slice(0, max - 1).trimEnd()}…` : limpio
}

/** Título de la campana: texto plano y ≤ 80 caracteres */
function titulo(s: string): string {
  const plano = s.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
  return plano.length > MAX_TITULO ? `${plano.slice(0, MAX_TITULO - 1).trimEnd()}…` : plano
}

const NOMBRES_DE_CLASE: Record<ClaseDeCambio, [string, string]> = {
  negativizar: ['negativa', 'negativas'],
  promover: ['término promovido', 'términos promovidos'],
  puja_subir: ['subida de puja', 'subidas de puja'],
  puja_bajar: ['bajada de puja', 'bajadas de puja'],
  puja_bajar_sin_pedidos: ['bajada de puja sin pedidos', 'bajadas de puja sin pedidos'],
  pausar: ['pausa', 'pausas'],
  presupuesto_subir: ['subida de presupuesto', 'subidas de presupuesto'],
  presupuesto_bajar: ['bajada de presupuesto', 'bajadas de presupuesto'],
  pausar_campana: ['campaña pausada', 'campañas pausadas'],
}

/** Orden de las clases cuando empatan en número (el de aplicar, §6.1) */
const ORDEN_DE_CLASE: ClaseDeCambio[] = ['pausar_campana', 'negativizar', 'pausar', 'puja_bajar', 'puja_bajar_sin_pedidos', 'presupuesto_bajar', 'puja_subir', 'promover', 'presupuesto_subir']

/** Nombre de la clase de cambio en singular (n = 1) o plural, SIN el número: «negativa», «bajadas de puja» */
export function nombreDeClase(c: ClaseDeCambio, n: number): string {
  const [uno, varios] = NOMBRES_DE_CLASE[c]
  return n === 1 ? uno : varios
}

function plural(n: number, uno: string, varios: string): string {
  return `${numeroEs(n, 0)} ${n === 1 ? uno : varios}`
}

/** «12 cambios (7 negativas, 3 bajadas de puja, 1 pausa)» o null si no hay ninguno */
function listaDeHechos(hechos: Partial<Record<ClaseDeCambio, number>>, palabra: [string, string]): { total: number; texto: string } {
  const filas = ORDEN_DE_CLASE.map((c) => ({ c, n: Math.max(0, Math.round(hechos[c] ?? 0)) }))
    .filter((f) => f.n > 0)
    .sort((a, b) => b.n - a.n || ORDEN_DE_CLASE.indexOf(a.c) - ORDEN_DE_CLASE.indexOf(b.c))
  const total = filas.reduce((s, f) => s + f.n, 0)
  if (total === 0) return { total: 0, texto: '' }
  const detalle = filas.map((f) => `${numeroEs(f.n, 0)} ${nombreDeClase(f.c, f.n)}`).join(', ')
  return { total, texto: `${plural(total, palabra[0], palabra[1])} (${detalle})` }
}

const MOTIVO_DE_FRENO: Record<MotivoDeFreno, string> = {
  gasto_disparado: 'gasto disparado',
  acos_cuenta: 'ACoS de la cuenta muy por encima del objetivo',
  errores_amazon: 'errores de Amazon',
  datos_viejos: 'datos sin actualizar',
  ventas_caidas: 'ventas totales hundidas',
  manual: 'parado a mano',
}

function lineaDeEvento(evento: DatosDelResumen['evento']): string | null {
  if (!evento) return null
  const que =
    evento.fase === 'previo'
      ? 'está a punto de empezar: el freno de gasto es más holgado y no recorto por el ritmo del mes'
      : evento.fase === 'durante'
        ? 'en curso: el freno de gasto es más holgado y no recorto por el ritmo del mes'
        : 'acaba de pasar: 7 días sin subidas basadas en esos días'
  return `🗓️ ${evento.nombre}: ${que}`
}

/**
 * Resumen diario (09:00 Madrid). Primero el NEGOCIO (ventas totales y TACoS del mes), luego «Ayer» provisional sin ACoS, el ACoS de
 * 7 días cerrados, el mes contra el techo, lo hecho, los resultados, la marca propia, «La lectura» (solo si hubo IA) y lo que necesita a
 * una persona. Con freno, el freno va arriba; en evento o veda, una línea «🗓️ …».
 */
export function textoDelResumen(r: DatosDelResumen): Texto {
  const m = r.moneda
  const lineas: string[] = []
  const cabecera = `Agente PPC${r.frenado ? ' frenado' : ''} · ${r.nombreCuenta}`
  lineas.push(`📊 **${cabecera}** — ${diaLargo(r.fecha)}`)

  if (r.frenado) {
    const detalle = r.frenado.detalle ? `: ${unaLinea(r.frenado.detalle)}` : ''
    lineas.push(`🛑 **Frenado** (${MOTIVO_DE_FRENO[r.frenado.motivo]})${detalle}. Para reanudar: Marketing Test → Agente.`)
  }
  const evento = lineaDeEvento(r.evento)
  if (evento) lineas.push(evento)
  if (r.veda && !(r.evento && r.evento.nombre === r.veda.nombre && !r.enEnsayo)) {
    lineas.push(`🗓️ ${r.veda.nombre}: el agente no pasa de ensayo a activo hasta el ${diaMes(diaSiguiente(r.veda.hasta))}`)
  }

  // Negocio
  const n = r.negocio
  const partesVentas: string[] = []
  if (n.ventasTotalesMes != null) {
    let v = dinero(n.ventasTotalesMes, m)
    if (n.ventasTotalesMesAnterior != null) {
      const d = variacion(n.ventasTotalesMes, n.ventasTotalesMesAnterior)
      v += ` (mes anterior a la misma fecha ${dinero(n.ventasTotalesMesAnterior, m)}${d ? `, ${d}` : ''})`
    }
    partesVentas.push(v)
  } else {
    partesVentas.push('sin datos todavía')
  }
  let tacos = `TACoS ${n.tacosMesPct != null ? pct(n.tacosMesPct) : 'sin datos'} (objetivo ${pct(n.tacosObjetivoPct)}`
  tacos += n.tacosMesAnteriorPct != null ? `; mes anterior ${pct(n.tacosMesAnteriorPct)})` : ')'
  lineas.push(`**Ventas totales del mes**: ${partesVentas.join('')} · ${tacos}`)

  // Ayer (provisional, sin ACoS)
  lineas.push(`**Ayer** (provisional, faltan ventas por atribuir): gasto ${dinero2(r.ayer.gasto, m)} · ventas Ads ${dinero2(r.ayer.ventas, m)}`)

  // 7 días cerrados
  const acos7 = r.cerrado7.acosPct != null ? `ACoS ${pct(r.cerrado7.acosPct)}` : 'ACoS sin ventas'
  const obj7 = r.cerrado7.acosObjetivoMedioPct != null ? ` (objetivo ${pct(r.cerrado7.acosObjetivoMedioPct)})` : ''
  lineas.push(`**7 días cerrados** (hasta el ${diaMes(r.cerrado7.hasta)}): ${acos7}${obj7}`)

  // Mes contra el techo
  const mes = r.mes
  const proy = mes.proyeccion != null ? ` (proyección ${dinero(mes.proyeccion, m)})` : ''
  const techo = mes.techo != null ? `${dinero(mes.gastoMes, m)} de ${dinero(mes.techo, m)}${proy}` : `${dinero(mes.gastoMes, m)} sin techo (no subo pujas ni presupuestos)${proy}`
  lineas.push(`**Mes**: ${techo} → ritmo **${mes.ritmo}**`)

  // Hecho (o habría hecho)
  const etiqueta = r.enEnsayo ? '**Habría hecho (ensayo)**' : '**Hecho en 24 h**'
  const rampa = r.rampa && !r.enEnsayo ? ` (rampa: día ${r.rampa.dia} de ${r.rampa.de})` : ''
  const hechos = listaDeHechos(r.hechos, ['cambio', 'cambios'])
  let lineaHechos = `${etiqueta}${rampa}: ${hechos.total > 0 ? hechos.texto : 'ningún cambio'}`
  const deshechos = r.deshechos.filter((d) => d.trim() !== '')
  if (deshechos.length > 0) {
    const ejemplos = deshechos.slice(0, 3).map((d) => `«${unaLinea(d, 120)}»`).join(', ')
    lineaHechos += ` · ${plural(deshechos.length, 'deshecho solo', 'deshechos solos')}: ${ejemplos}${deshechos.length > 3 ? '…' : ''}`
  }
  lineas.push(lineaHechos)

  // Resultados medidos
  const v = r.veredictos
  const partesRes = [
    v.mejoro > 0 ? `${numeroEs(v.mejoro, 0)} ${v.mejoro === 1 ? 'mejoró' : 'mejoraron'}` : null,
    v.empeoro > 0 ? `${numeroEs(v.empeoro, 0)} ${v.empeoro === 1 ? 'empeoró' : 'empeoraron'}` : null,
    v.neutro > 0 ? plural(v.neutro, 'neutro', 'neutros') : null,
    v.mezclado > 0 ? plural(v.mezclado, 'mezclado', 'mezclados') : null,
  ].filter((x): x is string => x != null)
  lineas.push(partesRes.length > 0 ? `**Resultados** (14 d medidos): ${partesRes.join(' · ')}` : '**Resultados**: aún sin mediciones')

  // Marca propia
  if (r.marca) {
    lineas.push(`**Marca propia**: gasto 7 d ${dinero(r.marca.gasto7, m)} · ACoS ${r.marca.acos7Pct != null ? pct(r.marca.acos7Pct) : 'sin ventas'}`)
  }

  // La lectura (solo con IA)
  if (r.informeIa) {
    const partes = [r.informeIa.titular, ...r.informeIa.puntos].map((p) => unaLinea(p, 300)).filter((p) => p !== '')
    const pide = r.informeIa.necesitaPersona.map((p) => unaLinea(p, 200)).filter((p) => p !== '')
    if (pide.length > 0) partes.push(`Para una persona: ${pide.join('; ')}`)
    if (partes.length > 0) lineas.push(`**La lectura**: ${partes.join(' · ')}`)
  }

  // Necesita a una persona (del código)
  const necesita = r.necesitaPersona.map((p) => unaLinea(p, 200)).filter((p) => p !== '')
  if (necesita.length > 0) lineas.push(`**Necesita a una persona**: ${necesita.join(' · ')}`)

  return { titulo: titulo(`${cabecera} — ${diaLargo(r.fecha)}`), cuerpo: lineas.join('\n') }
}

/** Freno automático (o a mano). Errores de Amazon y ventas hundidas tienen su propio encabezado (hechos `errores` y `ventas-caidas`) */
export function textoDeFreno(a: { nombreCuenta: string; motivo: MotivoDeFreno; detalle: string; deshechas: number; noDeshechas?: number; quedan?: number }): Texto {
  const detalle = unaLinea(a.detalle, 500)
  const fallos = a.noDeshechas && a.noDeshechas > 0 ? ` ${plural(a.noDeshechas, 'subida no se ha podido deshacer', 'subidas no se han podido deshacer')}: revísalas en la línea del agente.` : ''
  const quedan = a.quedan && a.quedan > 0 ? ` Quedan ${plural(a.quedan, 'subida', 'subidas')} por deshacer: sigo en las próximas pasadas.` : ''
  const deshecho =
    (a.deshechas > 0
      ? `He deshecho ${plural(a.deshechas, 'subida', 'subidas')} de las últimas ${AGENTE.FRENO_DESHACER_HORAS} h y he vuelto a «Aprueba y aplica».`
      : 'He vuelto a «Aprueba y aplica».') + fallos + quedan
  const reanudar = 'Para reanudar: Marketing Test → Agente.'

  if (a.motivo === 'errores_amazon') {
    const cab = `Errores de Amazon · ${a.nombreCuenta}`
    return {
      titulo: titulo(`Agente PPC frenado: ${cab}`),
      cuerpo: [`⚠️ **${cab}**`, detalle || 'Amazon ha devuelto varios errores seguidos.', `Agente frenado. ${deshecho} ${reanudar}`].join('\n'),
    }
  }
  if (a.motivo === 'ventas_caidas') {
    const cab = `Las ventas totales se han hundido · ${a.nombreCuenta}`
    return {
      titulo: titulo(cab),
      cuerpo: [`📉 **${cab}**`, `${detalle ? `${detalle} ` : ''}Puede ser una ficha suprimida, la Buy Box o el precio. He frenado el agente.`, `${deshecho} ${reanudar}`].join('\n'),
    }
  }
  const cab = `Agente PPC frenado · ${a.nombreCuenta}`
  return {
    titulo: titulo(`${cab} (${MOTIVO_DE_FRENO[a.motivo]})`),
    cuerpo: [`🛑 **${cab}**`, detalle || `Motivo: ${MOTIVO_DE_FRENO[a.motivo]}.`, `${deshecho} ${reanudar}`].join('\n'),
  }
}

/** «1 campaña y 2 anuncios» */
function campanasYAnuncios(campanas: number, anuncios: number): string {
  const partes = [campanas > 0 ? plural(campanas, 'campaña', 'campañas') : null, anuncios > 0 ? plural(anuncios, 'anuncio', 'anuncios') : null].filter(
    (x): x is string => x != null,
  )
  return partes.join(' y ')
}

/** Sin stock (pausas o solo «recortar») y vuelta del stock (reactivado o no, y por qué) */
export function textoDeStock(a: {
  nombreCuenta: string
  producto: string
  asin: string
  campanas: number
  anuncios: number
  fuente: string
  vuelve: boolean
  noReactivada?: string | null
  /** Estado del agente al proponer la pausa (sin él, «activo»). Solo cuenta si no es la vuelta del stock */
  estado?: 'ensayo' | 'activo' | 'frenado'
}): Texto {
  const prod = `${unaLinea(a.producto, 80)} (${a.asin})`
  const que = campanasYAnuncios(a.campanas, a.anuncios)
  if (a.vuelve) {
    const cab = `Vuelve el stock · ${a.nombreCuenta}`
    let cuerpo: string
    if (a.noReactivada) cuerpo = `${prod}: no lo reactivo: ${unaLinea(a.noReactivada, 200)}.`
    else if (que) cuerpo = `${prod}: he reactivado ${que}.`
    else cuerpo = `${prod}: no había nada pausado por el agente.`
    const fuente = a.fuente ? ` (${unaLinea(a.fuente, 200)})` : ''
    return { titulo: titulo(`${cab}: ${a.producto}`), cuerpo: `📦 **${cab}**\n${cuerpo}${fuente ? ` Stock${fuente}.` : ''}` }
  }
  const cab = `Sin stock · ${a.nombreCuenta}`
  const fuente = a.fuente ? ` (${unaLinea(a.fuente, 200)})` : ''
  // Al proponer la pausa todavía NO está aplicada: el texto dice lo que va a pasar según el estado del agente, nunca «he pausado»
  const estado = a.estado ?? 'activo'
  const accion = !que
    ? `Todavía no pauso nada (no se cumple todo para pausar): dejo el producto en «recortar» y lo sigo mirando.`
    : estado === 'ensayo'
      ? `Habría pausado ${que} (ensayo, no escribo en Amazon).`
      : estado === 'frenado'
        ? `Propongo pausar ${que}; el agente está frenado: lo aplica una persona desde Propuestas.`
        : `Voy a pausar ${que} (si queda algo sin aplicar, sale en el resumen). Los reactivo cuando vuelva a haber ${AGENTE.STOCK_REACTIVAR} o más.`
  return { titulo: titulo(`${cab}: ${a.producto}`), cuerpo: `📦 **${cab}**\n${prod}: 0 disponibles${fuente}. ${accion}` }
}

/** No se ha podido reactivar una campaña o anuncio tras volver el stock */
export function textoDeStockFallo(a: { nombreCuenta: string; campana: string; error: string }): Texto {
  const cab = `No he podido reactivar una campaña · ${a.nombreCuenta}`
  return {
    titulo: titulo(cab),
    cuerpo: `⚠️ **${cab}**\n«${unaLinea(a.campana, 120)}»: «${unaLinea(a.error, 300)}». Revísalo a mano.`,
  }
}

/** La campaña que más vende (7 d) se ha quedado sin presupuesto (una vez al día) */
export function textoDeAgotada(a: {
  nombreCuenta: string
  campana: string
  hora: string
  presupuesto: number
  acosPct: number | null
  nuevo: number | null
  moneda: string | null
  porque: string | null
}): Texto {
  const cab = `La campaña que más vende se ha quedado sin presupuesto a las ${a.hora}`
  const datos = `«${unaLinea(a.campana, 120)}»: presupuesto ${dinero(a.presupuesto, a.moneda)} · ACoS 7 d ${a.acosPct != null ? pct(a.acosPct) : 'sin ventas'}.`
  const porque = a.porque ? unaLinea(a.porque, 300) : null
  const decision =
    a.nuevo != null ? `Lo subo a ${dinero(a.nuevo, a.moneda)}${porque ? ` (${porque})` : ''}.` : porque ? `No lo subo: ${porque}.` : 'No lo subo.'
  return {
    titulo: titulo(`Sin presupuesto a las ${a.hora}: ${a.campana}`),
    cuerpo: `⏱️ **${cab}** · ${a.nombreCuenta}\n${datos} ${decision}`,
  }
}

/** Fin del ensayo; con veda de temporada, el ensayo sigue hasta que acaba la veda (hecho `veda`) */
export function textoDeEnsayoFin(a: { nombreCuenta: string; hechos: Partial<Record<ClaseDeCambio, number>>; veda: { nombre: string; hasta: string } | null }): Texto {
  const lista = listaDeHechos(a.hechos, ['cambio distinto', 'cambios distintos'])
  const habria =
    lista.total > 0
      ? `En ${AGENTE.DIAS_DE_ENSAYO} días habría hecho ${lista.texto}.`
      : `En ${AGENTE.DIAS_DE_ENSAYO} días no habría hecho ningún cambio.`
  if (a.veda) {
    const desde = diaMes(diaSiguiente(a.veda.hasta))
    const cab = `Termina el ensayo, pero no activo hasta el ${desde}`
    return {
      titulo: titulo(`${cab} · ${a.nombreCuenta}`),
      cuerpo: `🗓️ **${cab}** · ${a.nombreCuenta}\n${habria} Es la semana de ${a.veda.nombre}: sigo en ensayo (sin escribir en Amazon) hasta entonces.`,
    }
  }
  const cab = `Termina el ensayo del agente · ${a.nombreCuenta}`
  return {
    titulo: titulo(cab),
    cuerpo: `✅ **${cab}**\n${habria} Desde ahora los aplica de verdad, poco a poco: hoy solo negativas y bajadas.`,
  }
}

/** La primera vez que el agente escribe de verdad en Amazon en una cuenta */
export function textoDePrimeraEscritura(a: { nombreCuenta: string; que: string }): Texto {
  return {
    titulo: titulo(`Primera escritura real en Amazon · ${a.nombreCuenta}`),
    cuerpo: `✍️ **Primera escritura real en Amazon** · ${a.nombreCuenta}\n${unaLinea(a.que, 400)}`,
  }
}

/** Techo mensual automático, una vez al congelarlo. Sin gasto (techo null): nada sube hasta que una persona ponga un presupuesto */
export function textoDeTechoAuto(a: { nombreCuenta: string; techo: number | null; detalle: string; moneda: string | null }): Texto {
  const cab = `Sin presupuesto mensual en la ficha · ${a.nombreCuenta}`
  const detalle = unaLinea(a.detalle, 200)
  if (a.techo == null) {
    return {
      titulo: titulo(cab),
      cuerpo: `💶 **${cab}**\nNo hay gasto suficiente para fijar un techo${detalle ? ` (${detalle})` : ''}: no subo pujas ni presupuestos hasta que pongas un presupuesto mensual en la Ficha de cuenta.`,
    }
  }
  return {
    titulo: titulo(cab),
    cuerpo: `💶 **${cab}**\nUso como techo ${dinero(a.techo, a.moneda)}${detalle ? ` (${detalle})` : ''} hasta la revisión del mes que viene (crece como mucho un 25 % al mes, y solo si el TACoS va bien). Si quieres otro, ponlo en la Ficha de cuenta.`,
  }
}

/** La IA no ha contestado (una vez al día) o se ha llegado al tope del mes (una vez al mes) */
export function textoDeIa(a: { nombreCuenta: string; tipo: 'fallo' | 'tope'; tope?: number }): Texto {
  if (a.tipo === 'tope') {
    const tope = numeroEs(Math.round((a.tope ?? AGENTE.IA_TOPE_USD_MES) * 100) / 100, 2)
    const cab = `Tope de IA del mes alcanzado (${tope} $) · ${a.nombreCuenta}`
    return { titulo: titulo(cab), cuerpo: `🤖 **${cab}**\nSigo con reglas hasta el día 1.` }
  }
  return {
    titulo: titulo(`La IA no ha contestado hoy · ${a.nombreCuenta}`),
    cuerpo: `🤖 La IA no ha contestado hoy en ${a.nombreCuenta}: sigo solo con reglas (postura «mantener») y retengo lo raro.`,
  }
}
