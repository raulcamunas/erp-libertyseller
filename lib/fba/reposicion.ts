import { diasEntreInv, type EnvioInventario, type InventarioCliente, type SkuInventario } from './inventario'

/**
 * QUÉ MANDAR A AMAZON: EL CÁLCULO BASE Y CÓMO SE JUNTA CON LA OPINIÓN DE LA IA.
 * =============================================================================
 * PURO: sin base de datos, sin red, sin IA. Se comprueba con reposicion.prueba.ts.
 *
 * El motor de propuestas tiene DOS capas y esta es la primera y la última:
 *
 *   1. CÁLCULO BASE (aquí). Con el ritmo de venta y el stock de cada referencia sale cuánto
 *      hace falta mandar para no quedarse sin producto. Es aritmética, se puede explicar
 *      en una frase y no se inventa nada.
 *   2. LA IA (lib/fba/ia-reposicion.ts). Recibe esos números junto con el contexto —la
 *      tendencia, las devoluciones, lo que lleva parado, la época del año— y decide con
 *      criterio: manda más de lo que sale porque se acerca el Black Friday, no manda un
 *      producto que se devuelve el 40 %, deja fuera lo que solo vende una unidad al mes.
 *   3. LA RED DE SEGURIDAD (aquí otra vez). Lo que diga la IA se comprueba contra el
 *      cálculo base: solo puede proponer referencias que existen, nunca más de un tope
 *      razonable por referencia, y si no contesta o contesta algo ilegible la propuesta
 *      sale igualmente, del cálculo base, y la pantalla lo dice.
 *
 * Una IA que escribe cantidades sin ninguna barandilla acaba, tarde o temprano, proponiendo
 * mil unidades de algo que se vende una al mes. Y una propuesta que depende de que un
 * servicio externo conteste no es una herramienta: es una apuesta.
 *
 *
 * ============ LA CUENTA BASE ============
 *
 *   plazo      lo que tarda un envío en estar a la venta desde que sale (tránsito y
 *              recepción de Amazon). Durante ese tiempo se sigue vendiendo.
 *   cobertura  cuántos días de venta debe aguantar el envío una vez llegado.
 *   margen     un colchón extra de días de venta, porque el ritmo no es una ley.
 *
 *   Lo que habrá cuando llegue el envío:   max(0, stock + de camino − ritmo × plazo)
 *   Lo que se quiere tener entonces:        ritmo × (cobertura + margen)
 *   Lo que hay que mandar:                  lo segundo menos lo primero, redondeado a la caja.
 *
 * Si el producto se va a agotar ANTES de que llegue el envío, esas ventas perdidas no se
 * «recuperan» mandando más: se manda para cubrir los días que vienen, que es lo que
 * importa. Restar el stock a ritmo × (plazo + cobertura) mandaría de más justo en los
 * productos que ya están agotados.
 */

export interface ParametrosReposicion {
  /** Días de venta que debe cubrir el envío una vez llegado */
  coberturaObjetivo: number
  /** Días que tarda un envío en estar a la venta desde que sale */
  plazoDias: number
  /** Colchón extra, en días de venta */
  margenDias: number
  /** Se manda de N en N (cajas de N unidades). 1 = sin múltiplo */
  multiplo: number
  /** Una línea con menos que esto solo se manda si es urgente */
  minimoLinea: number
  /** Total de unidades que se pueden mandar (lo que tiene el cliente, el presupuesto…). null = sin tope */
  topeUnidades: number | null
  /** Lo que la agencia quiere que la IA tenga en cuenta, en sus palabras */
  notas: string
}

export const PARAMETROS_POR_DEFECTO: ParametrosReposicion = {
  coberturaObjetivo: 60,
  plazoDias: 10,
  margenDias: 7,
  multiplo: 1,
  minimoLinea: 2,
  topeUnidades: null,
  notas: '',
}

/** Los límites de lo que se acepta de una pantalla o de una petición */
export const LIMITES_PARAMETROS = {
  coberturaObjetivo: { min: 7, max: 180 },
  plazoDias: { min: 1, max: 60 },
  margenDias: { min: 0, max: 60 },
  multiplo: { min: 1, max: 1000 },
  minimoLinea: { min: 1, max: 100 },
  notas: 1500,
} as const

const acotar = (v: unknown, min: number, max: number, defecto: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : Number.NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : defecto
}

/** Lo que llega de fuera, limpio y dentro de los límites. Nunca revienta */
export function normalizarParametros(crudo: unknown): ParametrosReposicion {
  const p = (typeof crudo === 'object' && crudo !== null ? crudo : {}) as Record<string, unknown>
  const L = LIMITES_PARAMETROS
  const D = PARAMETROS_POR_DEFECTO
  // Un tope de cero o negativo no significa «no mandes nada»: significa que no hay tope
  const crudoTope = typeof p.topeUnidades === 'number' ? p.topeUnidades : typeof p.topeUnidades === 'string' ? Number(p.topeUnidades.replace(',', '.')) : Number.NaN
  const tope = Number.isFinite(crudoTope) && crudoTope >= 1 ? Math.min(1_000_000, Math.round(crudoTope)) : null
  return {
    coberturaObjetivo: acotar(p.coberturaObjetivo, L.coberturaObjetivo.min, L.coberturaObjetivo.max, D.coberturaObjetivo),
    plazoDias: acotar(p.plazoDias, L.plazoDias.min, L.plazoDias.max, D.plazoDias),
    margenDias: acotar(p.margenDias, L.margenDias.min, L.margenDias.max, D.margenDias),
    multiplo: acotar(p.multiplo, L.multiplo.min, L.multiplo.max, D.multiplo),
    minimoLinea: acotar(p.minimoLinea, L.minimoLinea.min, L.minimoLinea.max, D.minimoLinea),
    topeUnidades: tope,
    // Es texto de una persona que acaba dentro de un mensaje a la IA: sin caracteres de control y acotado
    notas: typeof p.notas === 'string' ? p.notas.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, L.notas) : '',
  }
}

/* ------------------------------------------------------------------ */
/* El plazo real de los envíos                                         */
/* ------------------------------------------------------------------ */

export interface PlazoDeEnvios {
  /** Días desde que sale hasta que Amazon recibe la primera unidad: la mediana */
  mediana: number | null
  /** Con cuántos envíos se ha medido */
  envios: number
  /** Lo que se propone usar: la mediana más lo que tarda en estar a la venta, o el valor de siempre */
  sugerido: number
}

/**
 * Lo que tardan de verdad los envíos de este cliente.
 *
 * Se mide con los envíos registrados que ya tienen llegada: los días entre la fecha de salida
 * y la primera entrada en el libro mayor. A eso se le suman unos días de recepción, que es
 * lo que tarda Amazon en dejar la mercancía a la venta. Con menos de dos envíos medidos no
 * hay base: se queda el plazo de siempre.
 */
export function plazoDeEnvios(envios: EnvioInventario[], recepcionDias = 4): PlazoDeEnvios {
  const medidos = envios
    .filter((e) => (e.estado === 'enviada' || e.estado === 'cerrada') && e.llegadaAt)
    .map((e) => diasEntreInv(e.fechaEnvio, e.llegadaAt!.slice(0, 10)))
    .filter((d) => d >= 0 && d <= 60)
    .sort((a, b) => a - b)
  if (medidos.length < 2) {
    return { mediana: medidos.length === 1 ? medidos[0] : null, envios: medidos.length, sugerido: PARAMETROS_POR_DEFECTO.plazoDias }
  }
  const mitad = Math.floor(medidos.length / 2)
  const mediana = medidos.length % 2 === 1 ? medidos[mitad] : (medidos[mitad - 1] + medidos[mitad]) / 2
  return {
    mediana,
    envios: medidos.length,
    sugerido: Math.min(LIMITES_PARAMETROS.plazoDias.max, Math.max(LIMITES_PARAMETROS.plazoDias.min, Math.round(mediana + recepcionDias))),
  }
}

/* ------------------------------------------------------------------ */
/* El cálculo base de cada referencia                                  */
/* ------------------------------------------------------------------ */

export type Urgencia = 'critica' | 'alta' | 'normal' | 'baja'

export interface BaseSku {
  sku: string
  /** Unidades que salen de la cuenta, ya redondeadas a la caja. 0 = no hace falta */
  unidades: number
  /** Lo máximo que se acepta para esta referencia, venga de donde venga la cantidad */
  tope: number
  /** Cuánto se espera tener cuando llegue el envío */
  enLlegada: number
  /** Cuánto se quiere tener entonces */
  meta: number
  urgencia: Urgencia
  /** La cuenta, dicha en una frase */
  explicacion: string
}

/** Más de lo que sale de la cuenta, hasta aquí: un tope para que nada se dispare */
const MARGEN_DE_TOPE = 1.6

export function calcularBase(s: SkuInventario, p: ParametrosReposicion): BaseSku {
  const ritmo = s.ritmoPlan
  const disponible = s.vendibles + s.entrante
  const enLlegada = Math.max(0, disponible - ritmo * p.plazoDias)
  const meta = ritmo * (p.coberturaObjetivo + p.margenDias)
  const bruto = ritmo > 0 ? Math.max(0, Math.ceil(meta - enLlegada)) : 0
  const aLaCaja = bruto > 0 ? Math.ceil(bruto / p.multiplo) * p.multiplo : 0
  const tope = ritmo > 0 ? Math.max(p.multiplo, Math.ceil((ritmo * (p.plazoDias + p.coberturaObjetivo + p.margenDias) * MARGEN_DE_TOPE) / p.multiplo) * p.multiplo) : 0

  let urgencia: Urgencia = 'baja'
  if (ritmo > 0) {
    if (s.vendibles <= 0 && s.entrante === 0) urgencia = 'critica'
    else if (s.cobertura !== null && s.cobertura <= p.plazoDias) urgencia = 'alta'
    else if (s.cobertura !== null && s.cobertura <= p.plazoDias + p.coberturaObjetivo) urgencia = 'normal'
  }

  // Los ritmos de una talla suelta son de 0,05 al día: con un decimal saldrían «0 ud/día»
  const f = (n: number) => (Math.round(n * (n < 1 ? 100 : 10)) / (n < 1 ? 100 : 10)).toLocaleString('es-ES')
  const explicacion =
    ritmo <= 0
      ? 'Sin ventas en el último mes: no hay ritmo con el que calcular.'
      : bruto === 0
        ? `Vende ${f(ritmo)} ud/día y con lo que tiene (${f(disponible)}) llega de sobra: a la llegada tendrá ${f(enLlegada)} y quiere ${f(meta)}.`
        : `Vende ${f(ritmo)} ud/día. Cuando llegue el envío (${p.plazoDias} d) tendrá ${f(enLlegada)} y quiere tener ${f(meta)} (${p.coberturaObjetivo} d + ${p.margenDias} d de margen): faltan ${aLaCaja}.`

  return { sku: s.sku, unidades: aLaCaja, tope, enLlegada: Math.round(enLlegada * 10) / 10, meta: Math.round(meta * 10) / 10, urgencia, explicacion }
}

/* ------------------------------------------------------------------ */
/* Qué referencias se le enseñan a la IA                                */
/* ------------------------------------------------------------------ */

export interface CandidataRepo {
  sku: SkuInventario
  base: BaseSku
}

/** Las referencias que merece la pena analizar: las que el cálculo manda, o están agotadas o a punto */
const ESTADOS_QUE_PIDEN_ENVIO = new Set(['agotado', 'urgente', 'bajo'])

const PESO_URGENCIA: Record<Urgencia, number> = { critica: 0, alta: 1, normal: 2, baja: 3 }

/** Hasta cuántas se le pasan a la IA de una vez: la respuesta tiene que caber */
export const MAX_CANDIDATAS_IA = 120

export interface SeleccionIa {
  candidatas: CandidataRepo[]
  /** Candidatas que no han cabido, por si hay que decirlo */
  quedanFuera: number
  /** Referencias con stock que NO se proponen y por qué: lo que hay que contarle a la IA */
  sinNecesidad: number
}

export function seleccionarCandidatas(inv: InventarioCliente, p: ParametrosReposicion): SeleccionIa {
  const todas: CandidataRepo[] = []
  let sinNecesidad = 0
  for (const sku of inv.skus) {
    const base = calcularBase(sku, p)
    const pide = base.unidades > 0 || (sku.ritmoPlan > 0 && ESTADOS_QUE_PIDEN_ENVIO.has(sku.estado))
    if (pide) todas.push({ sku, base })
    else if (sku.enAmazon > 0) sinNecesidad += 1
  }
  todas.sort((a, b) => {
    const u = PESO_URGENCIA[a.base.urgencia] - PESO_URGENCIA[b.base.urgencia]
    if (u !== 0) return u
    // Dentro de la misma urgencia, lo que más dinero mueve: ritmo por precio (o solo ritmo si no hay precio)
    const va = a.sku.ritmoPlan * (a.sku.precio ?? 1)
    const vb = b.sku.ritmoPlan * (b.sku.precio ?? 1)
    return vb - va || a.sku.sku.localeCompare(b.sku.sku)
  })
  return { candidatas: todas.slice(0, MAX_CANDIDATAS_IA), quedanFuera: Math.max(0, todas.length - MAX_CANDIDATAS_IA), sinNecesidad }
}

/* ------------------------------------------------------------------ */
/* La respuesta de la IA, comprobada y mezclada con el cálculo         */
/* ------------------------------------------------------------------ */

export type Nivel = 'alta' | 'media' | 'baja'

export interface RespuestaIa {
  resumen: string
  estrategia: string
  lineas: Array<{ sku: string; unidades: number; prioridad: Nivel; confianza: Nivel; motivo: string }>
  descartadas: Array<{ sku: string; motivo: string }>
  riesgos: string[]
  dudas: string[]
}

export interface LineaGenerada {
  sku: string
  /** Como se guarda en la línea de la remesa: el título de Amazon, o «nombre y color» si el cliente tiene base de datos */
  nombre: string | null
  asin: string | null
  fnsku: string | null
  /** Solo los clientes con base de datos de referencias (ShoesF) */
  referencia: string | null
  variante: string | null
  ean: string | null
  /** Lo que propone. Es lo que la pantalla deja editar */
  unidades: number
  /** Lo que sale de la cuenta base, para poder comparar */
  base: number
  /** Quién ha puesto la cantidad: la IA (comprobada) o el cálculo base */
  origen: 'ia' | 'calculo'
  /** La cantidad de la IA se ha recortado porque pasaba del tope de esta referencia */
  recortada: boolean
  prioridad: Nivel
  confianza: Nivel | null
  motivo: string
  /** Lo que se ve de esa referencia en la pantalla de revisión */
  enAmazon: number
  vendibles: number
  entrante: number
  ritmo: number
  cobertura: number | null
  tendencia: SkuInventario['tendencia']
  tasaDevolucion: number | null
  edadMediaDias: number | null
  estado: SkuInventario['estado']
  precio: number | null
}

export interface DescartadaGenerada {
  sku: string
  nombre: string | null
  motivo: string
  /** Lo que habría salido de la cuenta base, para saber qué se está dejando fuera */
  base: number
  ritmo: number
}

const PRIORIDAD_DE_URGENCIA: Record<Urgencia, Nivel> = { critica: 'alta', alta: 'alta', normal: 'media', baja: 'baja' }
const ORDEN_NIVEL: Record<Nivel, number> = { alta: 0, media: 1, baja: 2 }

/** Texto que viene de la IA y acaba en pantalla: sin control, acotado */
export const textoSeguro = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : ''

export interface ResultadoMezcla {
  lineas: LineaGenerada[]
  descartadas: DescartadaGenerada[]
  /** Cosas que decir sobre cómo se ha hecho la mezcla: SKU que la IA se inventó, cantidades recortadas… */
  notas: string[]
}

const aLaCaja = (n: number, multiplo: number) => (n > 0 ? Math.ceil(n / multiplo) * multiplo : 0)

function lineaDe(c: CandidataRepo, unidades: number, origen: LineaGenerada['origen'], prioridad: Nivel, confianza: Nivel | null, motivo: string, recortada: boolean): LineaGenerada {
  return {
    sku: c.sku.sku,
    nombre: c.sku.nombre,
    asin: c.sku.asin,
    fnsku: c.sku.fnsku,
    referencia: null,
    variante: null,
    ean: null,
    unidades,
    base: c.base.unidades,
    origen,
    recortada,
    prioridad,
    confianza,
    motivo,
    enAmazon: c.sku.enAmazon,
    vendibles: c.sku.vendibles,
    entrante: c.sku.entrante,
    ritmo: c.sku.ritmoPlan,
    cobertura: c.sku.cobertura,
    tendencia: c.sku.tendencia,
    tasaDevolucion: c.sku.tasaDevolucion90,
    edadMediaDias: c.sku.edadMediaDias,
    estado: c.sku.estado,
    precio: c.sku.precio,
  }
}

/**
 * LA IA PROPONE, EL CÁLCULO COMPRUEBA.
 *
 *   · Solo cuentan las referencias que se le han enseñado. Un SKU que no estaba entre las
 *     candidatas se ignora y se cuenta en las notas.
 *   · La cantidad de la IA se acota a [0, tope de esa referencia] y se lleva a la caja.
 *   · Una candidata que la IA no menciona ni en líneas ni en descartadas NO desaparece: si el
 *     cálculo base dice que hace falta, entra con la cantidad del cálculo y lo dice.
 *   · Sin respuesta (null) sale todo del cálculo base.
 *   · Con el cálculo base, una línea por debajo del mínimo solo entra si es urgente.
 */
export function combinarConIa(candidatas: CandidataRepo[], respuesta: RespuestaIa | null, p: ParametrosReposicion): ResultadoMezcla {
  const lineas: LineaGenerada[] = []
  const descartadas: DescartadaGenerada[] = []
  const notas: string[] = []

  const porSku = new Map(candidatas.map((c) => [c.sku.sku, c]))
  const delaIa = new Map<string, RespuestaIa['lineas'][number]>()
  const descartaIa = new Map<string, string>()
  let desconocidas = 0
  if (respuesta) {
    for (const l of respuesta.lineas) {
      if (!porSku.has(l.sku)) desconocidas += 1
      else if (!delaIa.has(l.sku)) delaIa.set(l.sku, l)
    }
    for (const d of respuesta.descartadas) {
      if (!porSku.has(d.sku)) desconocidas += 1
      else if (!delaIa.has(d.sku) && !descartaIa.has(d.sku)) descartaIa.set(d.sku, textoSeguro(d.motivo, 300))
    }
  }
  if (desconocidas > 0) notas.push(`La IA nombró ${desconocidas} referencia${desconocidas === 1 ? '' : 's'} que no estaban en el análisis: se han ignorado.`)

  const fuera = (c: CandidataRepo, motivo: string) =>
    descartadas.push({ sku: c.sku.sku, nombre: c.sku.nombre, motivo, base: c.base.unidades, ritmo: c.sku.ritmoPlan })

  let recortadas = 0
  let sinComentario = 0
  for (const c of candidatas) {
    const ia = delaIa.get(c.sku.sku)
    if (ia) {
      const pedido = aLaCaja(Math.max(0, Math.floor(Number.isFinite(ia.unidades) ? ia.unidades : 0)), p.multiplo)
      const unidades = Math.min(pedido, c.base.tope)
      const recortada = pedido > c.base.tope
      if (recortada) recortadas += 1
      const motivo = textoSeguro(ia.motivo, 300) || 'Sin comentario de la IA.'
      if (unidades <= 0) fuera(c, motivo)
      else lineas.push(lineaDe(c, unidades, 'ia', ia.prioridad, ia.confianza, recortada ? `${motivo} (Se ha recortado al máximo razonable de ${c.base.tope}.)` : motivo, recortada))
      continue
    }
    const descarte = descartaIa.get(c.sku.sku)
    if (descarte !== undefined) {
      fuera(c, descarte || 'Descartada por la IA.')
      continue
    }
    // La IA no ha dicho nada de esta: manda el cálculo base
    if (c.base.unidades <= 0) continue
    if (!respuesta) {
      lineas.push(lineaDe(c, c.base.unidades, 'calculo', PRIORIDAD_DE_URGENCIA[c.base.urgencia], null, c.base.explicacion, false))
      continue
    }
    sinComentario += 1
    lineas.push(lineaDe(c, c.base.unidades, 'calculo', PRIORIDAD_DE_URGENCIA[c.base.urgencia], null, `La IA no la ha comentado: se deja lo que sale del cálculo. ${c.base.explicacion}`, false))
  }
  if (recortadas > 0) notas.push(`${recortadas} cantidad${recortadas === 1 ? '' : 'es'} de la IA se han recortado al máximo razonable de su referencia.`)
  if (sinComentario > 0) notas.push(`${sinComentario} referencia${sinComentario === 1 ? '' : 's'} que la IA no ha comentado se han dejado con la cantidad del cálculo.`)

  // El cálculo base no manda una línea ridícula si no es urgente
  const finales: LineaGenerada[] = []
  for (const l of lineas) {
    const c = porSku.get(l.sku)!
    if (l.origen === 'calculo' && l.unidades < p.minimoLinea && c.base.urgencia !== 'critica' && c.base.urgencia !== 'alta') {
      fuera(c, `Salen ${l.unidades} unidad${l.unidades === 1 ? '' : 'es'}: menos de ${p.minimoLinea}, no compensa un envío.`)
    } else finales.push(l)
  }

  return { lineas: ordenar(finales), descartadas, notas }
}

/** De más a menos urgente, y dentro de cada nivel por referencia */
export function ordenar(lineas: LineaGenerada[]): LineaGenerada[] {
  return [...lineas].sort((a, b) => ORDEN_NIVEL[a.prioridad] - ORDEN_NIVEL[b.prioridad] || b.ritmo - a.ritmo || a.sku.localeCompare(b.sku))
}

/**
 * EL TOPE DE UNIDADES.
 *
 * Si el total pasa del tope, se llena de lo más urgente a lo menos hasta agotarlo: lo que no
 * cabe pasa a descartadas con su motivo, y la última línea que cabe a medias se queda con lo
 * que quepa. Es lo que haría una persona con un número de cajas limitado.
 */
export function ajustarATope(lineas: LineaGenerada[], tope: number | null, multiplo: number): { lineas: LineaGenerada[]; fuera: DescartadaGenerada[]; nota: string | null } {
  if (tope === null) return { lineas, fuera: [], nota: null }
  const total = lineas.reduce((s, l) => s + l.unidades, 0)
  if (total <= tope) return { lineas, fuera: [], nota: null }

  const dentro: LineaGenerada[] = []
  const fuera: DescartadaGenerada[] = []
  let queda = tope
  for (const l of ordenar(lineas)) {
    if (queda <= 0) {
      fuera.push({ sku: l.sku, nombre: l.nombre, motivo: `Fuera por el tope de ${tope} unidades: hay cosas más urgentes.`, base: l.base, ritmo: l.ritmo })
      continue
    }
    if (l.unidades <= queda) {
      dentro.push(l)
      queda -= l.unidades
      continue
    }
    // Cabe a medias: lo que quepa, a la caja hacia abajo
    const cabe = Math.floor(queda / multiplo) * multiplo
    if (cabe > 0) {
      dentro.push({ ...l, unidades: cabe, motivo: `${l.motivo} (Reducida a ${cabe} por el tope de ${tope} unidades.)` })
      queda -= cabe
    } else {
      fuera.push({ sku: l.sku, nombre: l.nombre, motivo: `Fuera por el tope de ${tope} unidades: no cabe ni una caja más.`, base: l.base, ritmo: l.ritmo })
    }
    queda = 0
  }
  return {
    lineas: dentro,
    fuera,
    nota: `Con el tope de ${tope.toLocaleString('es-ES')} unidades se han dejado fuera ${fuera.length} referencia${fuera.length === 1 ? '' : 's'} (lo menos urgente).`,
  }
}
