import { createServiceClient } from '@/lib/supabase/service'
import { ajustesDesdeFila, type FilaReposicionConfig } from './ajustes-reposicion'
import { construirIndice } from './catalogo/indice'
import { listarCatalogo } from './catalogo/servidor'
import { mercadoDeRemesaDe, tieneCatalogo } from './clientes-de-sesion'
import { leerComprometido } from './comprometido-datos'
import { construirMensajes, type ExtraCatalogo } from './ia-prompt'
import { pedirPropuestaIa } from './ia-reposicion'
import { enviosDelCliente, inventarioDeCliente } from './inventario-datos'
import { medirCadencia, medirRecepcion, medirTransporte } from './medidas-cliente'
import { leerTodo } from './paginar'
import type { AjustesReposicion, MedidasCliente, PlazoEtapas } from './plan-tipos'
import { plazoDelCliente } from './planificador'
import { faltaLaTabla } from './planificacion'
import {
  ajustarATope,
  combinarConIa,
  comprometidoQueCuenta,
  parametrosDesdeAjustes,
  notaDeComprometido,
  plazoDeEnvios,
  seleccionarCandidatas,
  type DescartadaGenerada,
  type LineaGenerada,
  type ParametrosReposicion,
  type PlazoDeEnvios,
} from './reposicion'
import { ritmoParaLotes } from './ventas-servidor'

/**
 * UNA PROPUESTA DE REPOSICIÓN, DE PUNTA A PUNTA.
 * ==============================================
 * SOLO SERVIDOR. Junta las piezas —cada una se prueba sola—:
 *
 *   inventario (lib/fba/inventario.ts)         qué hay, qué se vende, qué lleva parado
 *   candidatas (lib/fba/reposicion.ts)         qué referencias merece la pena analizar
 *   la IA      (lib/fba/ia-reposicion.ts)      qué haría un planificador con criterio
 *   la mezcla  (lib/fba/reposicion.ts)         lo que diga la IA, comprobado
 *
 * y devuelve la propuesta LISTA PARA REVISAR: no escribe nada en la base.
 *
 * CAMBIOS DE COMPORTAMIENTO (spec remesas-pro §3 y §11 D20, D40), anotados:
 *   · Lo COMPROMETIDO en remesas sin enviar (borrador, aprobada, encajando, lista; `leerComprometido`) se resta en el cálculo
 *     base de cada referencia, igual que lo que va de camino: antes una referencia con una remesa abierta se volvía a pedir.
 *     Un borrador parado 21 días o más no cuenta (D3). La propuesta dice cuánto se ha restado.
 *   · Los parámetros de partida (`parametrosDelCliente`) salen del plazo por etapas del planificador (`plazoDelCliente`) y de
 *     los ajustes del cliente (`ajustesDesdeFila`), no de los valores sueltos de siempre.
 *   · Si tiene base de datos de referencias se decide por DATOS (`tieneCatalogo`: filas en `fba_catalogo` o ShoesF), no solo por el nombre.
 *   · La propuesta lleva `mercadoRemesa` (D20): el mercado con el que se crea la remesa (el de su última enviada o el de la región
 *     de la conexión), nunca el de la lectura de ventas. Crear la remesa
 * es otro paso, y es de la persona que ha mirado las líneas y ha corregido lo que no le
 * convence (la pantalla de revisión). Una IA que crea envíos sin que nadie los vea sería
 * muy rápida y muy poco de fiar.
 */

export class ErrorDePropuesta extends Error {
  constructor(
    message: string,
    readonly estado = 400
  ) {
    super(message)
    this.name = 'ErrorDePropuesta'
  }
}

export interface PropuestaGenerada {
  clienteId: string
  hoy: string
  /** ISO */
  generadaEn: string
  lineas: LineaGenerada[]
  descartadas: DescartadaGenerada[]
  resumen: string | null
  estrategia: string | null
  riesgos: string[]
  dudas: string[]
  /** Cosas que decir sobre cómo se ha montado: recortes, tope, referencias sin comentario */
  notas: string[]
  ia: { usada: boolean; modelo: string | null; aviso: string | null; tokens: { entrada: number; salida: number } | null }
  parametros: ParametrosReposicion
  plazo: PlazoDeEnvios
  /** Referencias que se han analizado, las que tienen stock y no hace falta reponer, y las que no han cabido */
  analizadas: number
  sinNecesidad: number
  quedanFuera: number
  /** Lo que ya está en remesas sin enviar y se ha restado (y lo parado que no) */
  comprometido: { unidades: number; remesas: number; referenciasCubiertas: number; parado: { unidades: number; remesas: number } }
  /** El mercado con el que se crea la remesa (D20) */
  mercadoRemesa: string
  libro: 'ok' | 'corto' | 'sin_leer'
  /** Hasta qué día llegan las ventas con las que se ha calculado ('YYYY-MM-DD'). Lo posterior no cuenta */
  leidoHasta: string | null
  avisosInventario: string[]
}

export async function generarPropuestaIa(entrada: {
  clienteId: string
  clienteNombre: string
  parametros: ParametrosReposicion
  hoy: string
  usarIa?: boolean
  /** Si ya se sabe (ClienteRemesas.tieneCatalogo); si no, se mira en los datos */
  tieneCatalogo?: boolean
}): Promise<PropuestaGenerada> {
  const service = createServiceClient()
  const { clienteId, clienteNombre, parametros, hoy } = entrada

  const inventarioBruto = await inventarioDeCliente(clienteId, { hoy })
  if (!inventarioBruto.conectado) {
    throw new ErrorDePropuesta('Este cliente no tiene la cuenta de Amazon conectada: sin ella no hay inventario ni ventas con las que proponer nada.', 409)
  }

  // A6.1: el ritmo del PLANIFICADOR (el mismo que el plan y Reposición), no el del inventario, que divide las ventas también por los días agotados: un SKU
  // agotado quedaba con ritmo 0 y fuera de las candidatas (Creative Toys: el plan pedía 78 ud y la IA ni lo miraba). Sin pasada reciente, el de siempre
  const ritmoPlan = await ritmoParaLotes(service, clienteId, hoy, async () => inventarioBruto.skus).catch(() => null)
  const inventario =
    ritmoPlan && ritmoPlan.origen === 'plan'
      ? {
          ...inventarioBruto,
          skus: inventarioBruto.skus.map((k) => {
            const r = ritmoPlan.ritmo.get(k.sku)
            if (r == null || !(r > 0)) return k
            return { ...k, ritmoPlan: r, cobertura: Math.round((k.vendibles / r) * 10) / 10 }
          }),
        }
      : inventarioBruto
  if (inventario.libro === 'sin_leer') {
    throw new ErrorDePropuesta(
      'Todavía no se ha leído el libro mayor de Amazon de este cliente: sin las ventas no se puede calcular qué reponer. Se lee solo una vez al día; si acaba de conectarse, espera a la siguiente lectura.',
      409
    )
  }

  const [envios, porSkuComprometido, mercadoRemesa, conCatalogo] = await Promise.all([
    enviosDelCliente(service, clienteId),
    // Sin poder leer lo comprometido no se propone: saldría pedido dos veces lo que ya está en una remesa abierta
    leerComprometido(service, clienteId, hoy),
    mercadoDeRemesaDe(clienteId, service),
    entrada.tieneCatalogo ?? tieneCatalogo(clienteId, clienteNombre, service),
  ])
  const plazo = plazoDeEnvios(envios)
  const comprometido = comprometidoQueCuenta(porSkuComprometido)
  const seleccion = seleccionarCandidatas(inventario, parametros, comprometido.porSku, comprometido.vivoPorSku)

  /* ---------- lo que sabe de las referencias el catálogo propio del cliente (ShoesF, o cualquiera con filas: D40) ---------- */
  const extras = new Map<string, ExtraCatalogo>()
  const fichas = new Map<string, { ref: string; nombre: string; talla: string; ean: string | null; fnsku: string | null; asin: string | null }>()
  if (conCatalogo) {
    const { filas } = await listarCatalogo(service, clienteId)
    const indice = construirIndice(filas)
    for (const c of seleccion.candidatas) {
      const f = indice.porSku.get(c.sku.sku)
      if (!f) continue
      extras.set(c.sku.sku, { modelo: `${f.ref} ${f.nombre}`.trim(), talla: f.talla, continuidad: f.continuidad })
      fichas.set(c.sku.sku, { ref: f.ref, nombre: f.nombre, talla: f.talla, ean: f.ean, fnsku: f.fnsku, asin: f.asin })
    }
  }

  /* ---------- la IA, si se pide y hay algo que analizar ---------- */
  let respuesta = null as Awaited<ReturnType<typeof pedirPropuestaIa>>['respuesta']
  let modelo: string | null = null
  let aviso: string | null = null
  let tokens: { entrada: number; salida: number } | null = null
  if (entrada.usarIa !== false && seleccion.candidatas.length > 0) {
    // La IA ve el cálculo base ya neto de lo comprometido; se le dice en una línea para que no lo vuelva a pedir por su cuenta
    const notaComprometido = notaDeComprometido(comprometido.porSku, seleccion.candidatas.map((c) => c.sku.sku))
    const paraIa = notaComprometido ? { ...parametros, notas: [parametros.notas, notaComprometido].filter(Boolean).join('\n') } : parametros
    const mensajes = construirMensajes({ clienteNombre, hoy, inventario, seleccion, parametros: paraIa, plazo, extras })
    const r = await pedirPropuestaIa(mensajes)
    respuesta = r.respuesta
    modelo = r.modelo
    aviso = r.aviso
    tokens = r.tokens
  } else if (entrada.usarIa === false) {
    aviso = 'Propuesta calculada sin la IA, como se pidió.'
  }

  /* ---------- la IA propone, el cálculo comprueba ---------- */
  const mezcla = combinarConIa(seleccion.candidatas, respuesta, parametros)
  const tope = ajustarATope(mezcla.lineas, parametros.topeUnidades, parametros.multiplo)
  const notas = [...mezcla.notas]
  if (tope.nota) notas.push(tope.nota)
  if (comprometido.unidades > 0) {
    notas.push(
      `Ya hay ${comprometido.unidades} ud en ${comprometido.remesas === 1 ? 'una remesa' : `${comprometido.remesas} remesas`} sin enviar y se han restado${
        seleccion.cubiertasPorComprometido > 0 ? `: ${seleccion.cubiertasPorComprometido} referencias ya quedan cubiertas` : ''
      }.`
    )
  }
  if (comprometido.parado.unidades > 0) {
    notas.push(
      `Hay ${comprometido.parado.unidades} ud en ${comprometido.parado.remesas === 1 ? 'un borrador parado' : `${comprometido.parado.remesas} borradores parados`} desde hace 21 días o más: no se cuentan. Bórralo o retómalo.`
    )
  }
  if (seleccion.quedanFuera > 0) {
    notas.push(`Hay ${seleccion.quedanFuera} referencias más que también piden envío y no han cabido en el análisis: se miran en el siguiente.`)
  }

  /* ---------- las líneas, con los datos que necesita una remesa ---------- */
  const lineas = tope.lineas.map((l) => {
    const f = fichas.get(l.sku)
    return f
      ? { ...l, referencia: f.ref, nombre: f.nombre, variante: f.talla, ean: f.ean, fnsku: f.fnsku ?? l.fnsku, asin: f.asin ?? l.asin }
      : l
  })

  return {
    clienteId,
    hoy,
    generadaEn: new Date().toISOString(),
    lineas,
    descartadas: [...mezcla.descartadas, ...tope.fuera],
    resumen: respuesta?.resumen || null,
    estrategia: respuesta?.estrategia || null,
    riesgos: respuesta?.riesgos ?? [],
    dudas: respuesta?.dudas ?? [],
    notas,
    ia: { usada: respuesta !== null, modelo: respuesta ? modelo : null, aviso, tokens },
    parametros,
    plazo,
    analizadas: seleccion.candidatas.length,
    sinNecesidad: seleccion.sinNecesidad,
    quedanFuera: seleccion.quedanFuera,
    comprometido: {
      unidades: comprometido.unidades,
      remesas: comprometido.remesas,
      referenciasCubiertas: seleccion.cubiertasPorComprometido,
      parado: comprometido.parado,
    },
    mercadoRemesa,
    libro: inventario.libro,
    leidoHasta: inventario.leidoHasta,
    avisosInventario: inventario.avisos,
  }
}

/* ------------------------------------------------------------------ */
/* Los parámetros de partida de un cliente (GET de la ruta)            */
/* ------------------------------------------------------------------ */

type Servicio = ReturnType<typeof createServiceClient>

export interface ParametrosDelCliente {
  parametros: ParametrosReposicion
  /** El plazo por etapas del planificador del que salen `plazoDias` (L) y `margenDias` */
  plazoEtapas: PlazoEtapas
  ajustes: AjustesReposicion
  /** De dónde sale el plazo: la última pasada del planificador (≤ 36 h) o calculado aquí con la misma función */
  origenPlazo: 'pasada' | 'calculado'
  /** El mercado con el que se crea la remesa (D20) */
  mercadoRemesa: string
  /** Sin la tabla `fba_reposicion_config` (316) los ajustes son los de partida */
  faltaMigracion316: boolean
}

/** Una pasada guardada vale como fuente del plazo durante este tiempo (el mismo umbral que las alertas, D30) */
const VIDA_PASADA_MS = 36 * 3_600_000
/** Envíos que se miran para medir transporte, recepción y cadencia (las medidas usan los 6-8 últimos) */
const ENVIOS_A_MEDIR = 12

const esPlazo = (x: unknown): x is PlazoEtapas => {
  const p = x as Partial<PlazoEtapas> | null
  return !!p && typeof p === 'object' && [p.preparacion, p.transporte, p.recepcion, p.margen, p.hastaLaVenta].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)
}

/** Transporte, recepción (con el libro) y cadencia de los últimos envíos del cliente: las mismas medidas que el planificador */
async function medidasParaPropuesta(service: Servicio, clienteId: string, hoy: string): Promise<MedidasCliente> {
  const { data, error } = await service
    .from('fba_remesas')
    .select('id, fecha_envio, referencia_envio')
    .eq('client_id', clienteId)
    .in('estado', ['enviada', 'cerrada'])
    .not('fecha_envio', 'is', null)
    .order('fecha_envio', { ascending: false })
    .limit(ENVIOS_A_MEDIR)
  if (error) throw error
  const remesas = (data ?? []) as Array<{ id: string; fecha_envio: string; referencia_envio: string | null }>
  if (remesas.length === 0) return { transporteMediano: null, recepcionP75: null, enviosMedidos: 0, cadenciaDias: null, tamanoTipico: null }

  const ids = remesas.map((r) => r.id)
  const refs = [...new Set(remesas.map((r) => r.referencia_envio).filter((r): r is string => !!r))]
  const [lineas, recibos] = await Promise.all([
    leerTodo<{ remesa_id: string; unidades: number | null }>((a, b) =>
      service.from('fba_remesa_lineas').select('remesa_id, unidades').in('remesa_id', ids).order('id', { ascending: true }).range(a, b)
    ),
    refs.length
      ? leerTodo<{ referencia: string; marketplace_id: string | null; fecha: string; cantidad: number | null }>((a, b) =>
          service
            .from('fba_movimientos')
            .select('referencia, marketplace_id, fecha, cantidad')
            .in('referencia', refs)
            .eq('tipo', 'Receipts')
            .order('fecha', { ascending: true })
            .range(a, b)
        )
      : Promise.resolve([] as Array<{ referencia: string; marketplace_id: string | null; fecha: string; cantidad: number | null }>),
  ])
  const unidades = new Map<string, number>()
  for (const l of lineas) unidades.set(l.remesa_id, (unidades.get(l.remesa_id) ?? 0) + (Number(l.unidades) || 0))
  // El libro es de toda la cuenta y se guarda una copia por mercado leído (§0.2): por envío se toma UNA copia (la más completa), nunca la suma
  const porRefMercado = new Map<string, Map<string, Array<{ fecha: string; cantidad: number }>>>()
  for (const r of recibos) {
    const c = Number(r.cantidad) || 0
    if (c <= 0) continue
    const mercados = porRefMercado.get(r.referencia) ?? new Map<string, Array<{ fecha: string; cantidad: number }>>()
    const lista = mercados.get(r.marketplace_id ?? '') ?? []
    lista.push({ fecha: r.fecha.slice(0, 10), cantidad: c })
    mercados.set(r.marketplace_id ?? '', lista)
    porRefMercado.set(r.referencia, mercados)
  }
  const porRef = new Map<string, Array<{ fecha: string; cantidad: number }>>()
  const total = (l: Array<{ cantidad: number }>) => l.reduce((s, x) => s + x.cantidad, 0)
  for (const [ref, mercados] of porRefMercado) {
    let mejor: Array<{ fecha: string; cantidad: number }> = []
    for (const l of mercados.values()) if (total(l) > total(mejor)) mejor = l
    porRef.set(ref, mejor)
  }
  const envios = remesas.map((r) => {
    const rec = r.referencia_envio ? porRef.get(r.referencia_envio) ?? [] : []
    const primer = rec.reduce<string | null>((m, x) => (m === null || x.fecha < m ? x.fecha : m), null)
    return { fechaEnvio: r.fecha_envio.slice(0, 10), unidades: unidades.get(r.id) ?? 0, recibos: rec, primer }
  })
  const cad = medirCadencia(envios.map((e) => ({ fechaEnvio: e.fechaEnvio, unidades: e.unidades })))
  return {
    transporteMediano: medirTransporte(envios.map((e) => ({ fechaEnvio: e.fechaEnvio, primerReceipt: e.primer }))),
    recepcionP75: medirRecepcion(envios.filter((e) => e.recibos.length > 0).map((e) => ({ enviadas: e.unidades, receipts: e.recibos })), hoy),
    enviosMedidos: Math.min(6, envios.filter((e) => e.primer && e.primer >= e.fechaEnvio).length),
    cadenciaDias: cad.cadenciaDias,
    tamanoTipico: cad.tamanoTipico,
  }
}

/**
 * LOS PARÁMETROS DE PARTIDA DE LA PROPUESTA A MEDIDA (spec §3, cambio de comportamiento anotado): el plazo es el del planificador
 * (`plazoDelCliente`: manual > medido > de partida) y la cobertura, la caja y el mínimo, los ajustes del cliente (`ajustesDesdeFila`).
 * Si hay una pasada del planificador de las últimas 36 h se toma su plazo tal cual (el mismo número que enseña el plan); si no, se
 * calcula aquí con la misma función y las mismas medidas. Sin la migración 316 los ajustes son los de partida. Solo lectura.
 */
export async function parametrosDelCliente(clienteId: string, hoy: string, service: Servicio = createServiceClient()): Promise<ParametrosDelCliente> {
  let faltaMigracion316 = false
  const [filaR, pasadaR, mercadoRemesa] = await Promise.all([
    service.from('fba_reposicion_config').select('*').eq('client_id', clienteId).maybeSingle(),
    service.from('fba_plan_pasadas').select('plazo, calculado_at').eq('client_id', clienteId).order('calculado_at', { ascending: false }).limit(1),
    mercadoDeRemesaDe(clienteId, service),
  ])
  let fila: FilaReposicionConfig | null = null
  if (filaR.error) {
    if (!faltaLaTabla(filaR.error)) throw filaR.error
    faltaMigracion316 = true
  } else fila = (filaR.data as FilaReposicionConfig | null) ?? null

  const pasada = !pasadaR.error ? ((pasadaR.data ?? []) as Array<{ plazo: unknown; calculado_at: string }>)[0] ?? null : null
  const reciente = pasada && Date.now() - Date.parse(pasada.calculado_at) <= VIDA_PASADA_MS && esPlazo(pasada.plazo)

  let plazoEtapas: PlazoEtapas
  let ajustes: AjustesReposicion
  if (reciente) {
    // Los campos que usa la propuesta (cobertura, caja, mínimo) no dependen de las medidas: no hace falta medir
    ajustes = ajustesDesdeFila(fila, null)
    plazoEtapas = pasada!.plazo as PlazoEtapas
  } else {
    const [medidas, configR] = await Promise.all([
      medidasParaPropuesta(service, clienteId, hoy),
      service.from('fba_alertas_config').select('*').eq('client_id', clienteId).maybeSingle(),
    ])
    if (configR.error && !faltaLaTabla(configR.error)) throw configR.error
    const c = (configR.error ? null : configR.data) as Record<string, unknown> | null
    const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    const config = c
      ? { diasPreparacion: n(c.dias_preparacion), diasTransporte: n(c.dias_transporte), diasRecepcion: n(c.dias_recepcion), diasMargen: n(c.margen_dias), total: n(c.plazo_reposicion_dias) }
      : null
    ajustes = ajustesDesdeFila(fila, medidas)
    plazoEtapas = plazoDelCliente(config, medidas, hoy, ajustes)
  }

  return {
    parametros: parametrosDesdeAjustes(ajustes, plazoEtapas),
    plazoEtapas,
    ajustes,
    origenPlazo: reciente ? 'pasada' : 'calculado',
    mercadoRemesa,
    faltaMigracion316,
  }
}
