/**
 * AGENTE PPC · EL CEREBRO CON IA (SERVIDOR). §5 de la especificación.
 *
 * Dos veces al día como mucho (o con «Pensar ahora») el agente le enseña a la IA el estado compacto de la cuenta y le pide, en JSON estricto:
 *   · una POSTURA por producto (crecer / mantener / recortar), que luego se acota por reglas (`posturaFinal`) y se guarda en `ads_agente_posturas`;
 *   · «aplicar» o «retener» para cada propuesta RARA pendiente (las DEVUELVE: las guarda el orquestador con `guardarDecisionesIa`);
 *   · una etiqueta para cada término de búsqueda REVISAR o de mucho gasto sin etiqueta vigente (`ads_terminos_ia`, caduca a los 180 días o si cambia el título);
 *   · el informe del día (va a `ads_agente_ia.salida`, ya limpio, y de ahí a «La lectura» del resumen).
 *
 * La IA nunca pone una cifra ni llama a Amazon. Si falla, no hay clave o se pasa del tope del mes, las posturas salen por reglas y lo raro se queda
 * sin decisión (se retiene a las 30 h). Cada llamada (bien o mal) deja una fila con su coste en `ads_agente_ia`.
 *
 * Reglas de dependencias (§1): importa SOLO de la oleada 1 y del código que ya existía. El contexto y los veredictos le llegan como parámetro;
 * no avisa ni guarda decisiones de propuestas: lo hace el orquestador con lo que devuelve.
 */

import OpenAI from 'openai'
import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { parametrosDeIa } from '@/lib/ia/modelo'
import type { CuentaParaSincronizar } from '../sincronizar'
import { esAsin, normalizarTexto } from '../reglas'
import { asinDeCampana } from '../productos-agrupar'
import { todasLasFilas } from '../paginar'
import {
  AGENTE,
  FALTA_MIGRACION_315,
  type ClaseDeCambio,
  type ConfigDelAgente,
  type ContextoDelAgente,
  type EstadoParaIa,
  type EtiquetaDeTermino,
  type FuenteDePostura,
  type Postura,
  type ProductoDelContexto,
  type SalidaDelCerebro,
  type Veredicto,
} from './tipos'
import {
  ESQUEMA_DEL_CEREBRO,
  PROMPT_DEL_CEREBRO,
  costeDeLlamada,
  costeDelMes,
  estadoCompacto,
  hashDeTitulo,
  limpiarTermino,
  limpiarTextoIa,
  posturaFinal,
  validarSalidaDelCerebro,
} from './cerebro-calculo'
import { posturaPorReglas } from './ritmo-calculo'
import { acuerdoIaPersona, esRara } from './guardarrailes-calculo'
import { horaEnMadrid } from './pasos-calculo'
import { inicioDelDiaLocal } from './uso-calculo'

// ─────────────────────────────────────────────────────────────────────────────
// Auxiliares puras (exportadas para las pruebas de cerebro-ia.prueba.ts)
// ─────────────────────────────────────────────────────────────────────────────

const DIA_MS = 86_400_000
const ETIQUETAS: readonly EtiquetaDeTermino[] = ['relevante', 'otro_producto', 'marca_ajena', 'intencion_mala', 'dudoso']

const finito = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const numero = (x: unknown): number => {
  const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN
  return Number.isFinite(n) ? n : 0
}
const numeroONull = (x: unknown): number | null => {
  if (x == null) return null
  const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN
  return Number.isFinite(n) ? n : null
}
const importe = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

/** La clave con la que se guarda y se busca un término en `ads_terminos_ia`: limpio (≤ 80), sin tildes, en minúsculas y con los espacios normalizados */
export function claveDeTermino(termino: string): string {
  return normalizarTexto(limpiarTermino(termino)).trim()
}

/** Es un REVISAR de reglas.ts (negativizar marcado para revisar: «no comparte ninguna palabra con el producto») */
export function esRevisar(p: { tipo: string; motivo: string | null; metricas: Record<string, unknown> | null }): boolean {
  return p.tipo === 'negativizar' && (p.metricas?.revisar === true || /^REVISAR:/i.test(p.motivo ?? ''))
}

/** Una línea que dice QUÉ hace una propuesta, para la IA: «Pausar «jamon iberico» en … AMPLIA», «Presupuesto de …: 20 → 26» */
export function queDePropuesta(p: { tipo: string; termino: string; campaignNombre: string; valorActual: number | null; valorNuevo: number | null; objetivoTipo?: string | null }): string {
  const t = limpiarTermino(p.termino)
  const c = limpiarTermino(p.campaignNombre)
  const cambio = finito(p.valorActual) && finito(p.valorNuevo) ? `: ${importe(p.valorActual)} → ${importe(p.valorNuevo)}` : ''
  switch (p.tipo) {
    case 'negativizar':
      return `Negativizar «${t}» en ${c}`
    case 'promover':
      return `Promover «${t}» desde ${c}`
    case 'puja':
      return `Puja de «${t}» en ${c}${cambio}`
    case 'presupuesto':
      return `Presupuesto de ${c}${cambio}`
    case 'pausar':
      return p.objetivoTipo === 'anuncio' ? `Pausar el anuncio de «${t}» en ${c}` : `Pausar «${t}» en ${c}`
    case 'pausar-campana':
      return `Pausar la campaña ${c}`
    default:
      return `${p.tipo} «${t}» en ${c}`
  }
}

/** Lo que lee el cerebro de una propuesta pendiente */
export interface PendienteParaCerebro {
  id: string
  tipo: string
  asin: string | null
  termino: string
  campaignId: string
  campaignNombre: string
  motivo: string
  metricas: Record<string, unknown>
  valorActual: number | null
  valorNuevo: number | null
  objetivoTipo: string | null
  iaDecision: string | null
  creadaAt: string
}

/**
 * Las propuestas RARAS (sin decisión de la IA todavía) con el contexto de la cuenta: gasto del producto en 30 d, stock y cobertura, y las campañas con ajuste
 * de ubicación alto (las marca motor-pujas con la métrica `ubicacionAlta`). Los REVISAR van por la etiqueta del término, no por aquí.
 */
export function rarasDeLasPendientes(pendientes: readonly PendienteParaCerebro[], productos: readonly ProductoDelContexto[]): EstadoRara[] {
  const porAsin = new Map(productos.map((p) => [p.asin.toUpperCase(), p]))
  const conUbicacionAlta = [...new Set(pendientes.filter((p) => p.metricas?.ubicacionAlta === true).map((p) => p.campaignId))]
  const raras: EstadoRara[] = []
  for (const p of pendientes) {
    if (p.iaDecision) continue
    if (esRevisar(p)) continue
    const prod = p.asin ? porAsin.get(p.asin.toUpperCase()) : undefined
    const m = p.metricas ?? {}
    const r = esRara(
      {
        tipo: p.tipo,
        termino: p.termino,
        esAsin: esAsin(p.termino),
        valorActual: p.valorActual,
        valorNuevo: p.valorNuevo,
        metricas: { gasto: numero(m.gasto), pedidos: numero(m.pedidos) },
        campaignId: p.campaignId,
      },
      { gastoProducto30: prod?.gasto30 ?? 0, stock: prod ? prod.stock : null, coberturaDias: prod ? prod.coberturaDias : null, campanasConUbicacionAlta: conUbicacionAlta },
    )
    if (!r.rara) continue
    raras.push({
      id: p.id,
      tipo: p.tipo,
      asin: p.asin,
      que: queDePropuesta(p),
      motivo: `${r.porque ? `Rara: ${r.porque}. ` : ''}${p.motivo ?? ''}`,
      metricas: { clics: numero(m.clics), gasto: numero(m.gasto), pedidos: numero(m.pedidos), ventas: numero(m.ventas) },
    })
  }
  return raras
}
type EstadoRara = { id: string; tipo: string; asin: string | null; que: string; motivo: string; metricas: { clics: number; gasto: number; pedidos: number; ventas: number } }

/** ¿La etiqueta guardada sigue valiendo? No si ha caducado o si el título del producto ya no es el mismo (con hash conocido) */
export function etiquetaSigueValiendo(fila: { caduca_at: string | null; titulo_hash: string | null }, tituloHash: string | null, ahora: number): boolean {
  const caduca = fila.caduca_at ? Date.parse(fila.caduca_at) : NaN
  if (!Number.isFinite(caduca) || caduca <= ahora) return false
  if (tituloHash != null && fila.titulo_hash !== tituloHash) return false
  return true
}

/**
 * Los términos que se le mandan a la IA, por orden: primero los REVISAR pendientes (más gasto primero), luego los de más gasto en 30 días sin pedidos de los
 * productos de la cuenta; fuera los ASIN, los repetidos y los que ya tienen etiqueta vigente. Como mucho `AGENTE.IA_MAX_TERMINOS`.
 */
export function terminosParaLaIa(
  revisar: ReadonlyArray<{ asin: string | null; termino: string; clics: number; gasto: number }>,
  delInforme: ReadonlyArray<{ asin: string | null; termino: string; clics: number; gasto: number; pedidos: number }>,
  conEtiqueta: (asin: string, clave: string) => boolean,
): Array<{ asin: string; termino: string; clics: number; gasto: number }> {
  const vistos = new Set<string>()
  const salida: Array<{ asin: string; termino: string; clics: number; gasto: number }> = []
  const meter = (t: { asin: string | null; termino: string; clics: number; gasto: number }) => {
    if (salida.length >= AGENTE.IA_MAX_TERMINOS) return
    if (!t.asin) return
    const asin = t.asin.toUpperCase()
    const clave = claveDeTermino(t.termino)
    if (!clave || esAsin(clave)) return
    const k = `${asin}|${clave}`
    if (vistos.has(k)) return
    vistos.add(k)
    if (conEtiqueta(asin, clave)) return
    salida.push({ asin, termino: t.termino, clics: t.clics, gasto: t.gasto })
  }
  for (const t of [...revisar].sort((a, b) => b.gasto - a.gasto)) meter(t)
  for (const t of [...delInforme].filter((x) => x.pedidos <= 0 && x.clics > 0).sort((a, b) => b.gasto - a.gasto)) meter(t)
  return salida
}

/** Los resultados medidos para la IA: por clase (mejoró, empeoró, neutro) y los últimos que empeoraron con su detalle */
export function resultadosParaLaIa(veredictos: ReadonlyArray<{ clase: ClaseDeCambio; veredicto: Veredicto; detalle: string | null }>): EstadoParaIa['resultados'] {
  const porClase: EstadoParaIa['resultados']['porClase'] = {}
  const ultimosEmpeorados: string[] = []
  for (const v of veredictos) {
    if (v.veredicto === 'mejoro' || v.veredicto === 'empeoro' || v.veredicto === 'neutro') {
      const c = (porClase[v.clase] ??= { mejoro: 0, empeoro: 0, neutro: 0 })
      c[v.veredicto]++
    }
    if (v.veredicto === 'empeoro' && v.detalle && ultimosEmpeorados.length < 10) ultimosEmpeorados.push(v.detalle)
  }
  return { porClase, ultimosEmpeorados }
}

/**
 * La postura de cada producto: la de la IA (si la dio) o la de las reglas, acotada con `posturaFinal` (stock, cobertura, ritmo, ACoS, defensivo, marca,
 * equilibrio, lanzamiento). Sin IA → `ia = null` para todos (fuente «reglas» salvo que un tope la cambie).
 */
export function posturasDeLosProductos(
  contexto: Pick<ContextoDelAgente, 'productos' | 'mes' | 'tacosObjetivoPct' | 'muestraMinimaClics'>,
  ia: ReadonlyMap<string, { postura: Postura; motivo: string }> | null,
): Array<{ asin: string; nombre: string; postura: Postura; fuente: FuenteDePostura; motivo: string }> {
  const ritmo = contexto.mes.ritmo
  return contexto.productos.map((p) => {
    const tieneEquilibrio = finito(p.equilibrioPct) && p.equilibrioPct > 0
    const esMarca = !!(p.marca && p.marca.trim())
    const reglas = posturaPorReglas(
      {
        acos14Pct: p.acos14Pct,
        clics14: p.clics14,
        muestraMinima: contexto.muestraMinimaClics,
        acosObjetivoPct: p.acosObjetivoPct,
        tieneEquilibrio,
        tacos30Pct: p.tacos30Pct,
        tacosObjetivoPct: contexto.tacosObjetivoPct,
        ventasTotalesCrecen: p.tendenciaVentasTotalesPct == null ? null : p.tendenciaVentasTotalesPct > 0,
        tacosBaja: p.tacosMesPct != null && p.tacosMesAnteriorPct != null ? p.tacosMesPct < p.tacosMesAnteriorPct : null,
        coberturaDias: p.coberturaDias,
        stock: p.stock,
        soloDefensivo: p.soloDefensivo,
        esMarca,
        fase: p.fase,
      },
      ritmo,
    )
    const deIa = ia?.get(p.asin.toUpperCase()) ?? ia?.get(p.asin) ?? null
    const f = posturaFinal({
      ia: deIa?.postura ?? null,
      motivoIa: deIa?.motivo ?? null,
      reglas,
      ritmo,
      stock: p.stock,
      coberturaDias: p.coberturaDias,
      acos14Pct: p.acos14Pct,
      acosObjetivoPct: p.acosObjetivoPct,
      soloDefensivo: p.soloDefensivo,
      esMarca,
      tieneEquilibrio,
      fase: p.fase,
    })
    return { asin: p.asin, nombre: p.nombre, postura: f.postura, fuente: f.fuente, motivo: limpiarTextoIa(f.motivo, 300) }
  })
}

/** La etiqueta que dijo la IA según el motivo de la retención («La IA dice: otro producto (0,92). …»); null si no se entiende */
export function etiquetaDelMotivo(motivo: string | null): EtiquetaDeTermino | null {
  const m = /La IA dice:\s*([^(.·]+)/i.exec(motivo ?? '')
  if (!m) return null
  const t = normalizarTexto(m[1]).replace(/_/g, ' ').trim()
  for (const e of ETIQUETAS) if (t === e.replace(/_/g, ' ')) return e
  return null
}

/** Lo que se le cuenta del día anterior (fecha LOCAL del marketplace): cuántas aplicó, ensayó, deshizo y retuvo el agente, y el gasto y ventas Ads de ayer */
export function ayerParaLaIa(
  filas: ReadonlyArray<{ estado: string; agente_at: string | null; retenida_at: string | null }>,
  deshechas: number,
  ventana: { desde: number; hasta: number },
  cuenta: { gastoAyer: number; ventasAyer: number },
): EstadoParaIa['ayer'] {
  const dentro = (iso: string | null) => {
    const t = iso ? Date.parse(iso) : NaN
    return Number.isFinite(t) && t >= ventana.desde && t < ventana.hasta
  }
  let aplicadas = 0
  let ensayadas = 0
  let retenidas = 0
  for (const f of filas) {
    if (dentro(f.agente_at) && (f.estado === 'aplicada' || f.estado === 'deshecha')) aplicadas++
    if (dentro(f.agente_at) && f.estado === 'ensayada') ensayadas++
    if (dentro(f.retenida_at)) retenidas++
  }
  return { aplicadas, ensayadas, deshechas, retenidas, gasto: cuenta.gastoAyer || 0, ventas: cuenta.ventasAyer || 0, acosPct: null }
}

// ─────────────────────────────────────────────────────────────────────────────
// Servidor
// ─────────────────────────────────────────────────────────────────────────────

type Db = ReturnType<typeof createServiceClient>
type ErrorDb = { code?: string; message?: string } | null

const faltaLa315 = (e: ErrorDb) => !!e && (isMissingSchema(e) || e.code === '23514')

interface ResultadoDePensar {
  ok: boolean
  motivo: string | null
  tope: boolean
  coste: number
  posturas: number
  terminos: number
  decisiones: Array<{ id: string; decision: 'aplicar' | 'retener'; motivo: string }>
}

/** Lo gastado en IA este mes (desde el día 1 a las 00:00 de Madrid) */
async function gastoIaDelMes(db: Db, perfilId: string, ahora: number): Promise<{ filas: Array<{ creado_at: string; coste_usd: number; ok: boolean; error: string | null }>; error: ErrorDb }> {
  const { inicioDelMes } = horaEnMadrid(ahora)
  const { data, error } = await db
    .from('ads_agente_ia')
    .select('creado_at, coste_usd, ok, error')
    .eq('perfil_id', perfilId)
    .gte('creado_at', inicioDelMes)
    .order('creado_at', { ascending: false })
    .limit(2000)
  const filas = ((data ?? []) as Array<Record<string, unknown>>).map((f) => ({ creado_at: String(f.creado_at), coste_usd: numero(f.coste_usd), ok: f.ok !== false, error: (f.error as string | null) ?? null }))
  return { filas, error: error as ErrorDb }
}

/** Una fila en ads_agente_ia por llamada (bien o mal). Nunca lanza */
async function anotarLlamada(db: Db, perfilId: string, f: { modelo: string | null; entrada: number; cache: number; salida: number; coste: number; ok: boolean; error: string | null; datos: unknown }): Promise<void> {
  try {
    const { error } = await db.from('ads_agente_ia').insert({
      perfil_id: perfilId,
      tipo: 'cerebro',
      modelo: f.modelo,
      tokens_entrada: f.entrada,
      tokens_cache: f.cache,
      tokens_salida: f.salida,
      coste_usd: f.coste,
      ok: f.ok,
      error: f.error ? f.error.slice(0, 500) : null,
      salida: f.datos ?? null,
    })
    if (error) console.error('[agente-ia] no se ha podido anotar la llamada:', error.message)
  } catch (e) {
    console.error('[agente-ia] no se ha podido anotar la llamada:', e instanceof Error ? e.message : e)
  }
}

/** Guarda las posturas (upsert) y anota un evento «postura» por cada producto que cambia. Devuelve cuántas se guardaron. Nunca lanza */
async function guardarPosturas(db: Db, perfilId: string, posturas: ReadonlyArray<{ asin: string; nombre: string; postura: Postura; fuente: FuenteDePostura; motivo: string }>): Promise<number> {
  if (posturas.length === 0) return 0
  try {
    const { data: antes } = await db.from('ads_agente_posturas').select('asin, postura').eq('perfil_id', perfilId).limit(2000)
    const previa = new Map(((antes ?? []) as Array<{ asin: string; postura: Postura }>).map((f) => [String(f.asin).toUpperCase(), f.postura]))
    const ahoraIso = new Date().toISOString()
    const { error } = await db.from('ads_agente_posturas').upsert(
      posturas.map((p) => ({ perfil_id: perfilId, asin: p.asin, postura: p.postura, fuente: p.fuente, motivo: p.motivo, actualizado_at: ahoraIso })),
      { onConflict: 'perfil_id,asin' },
    )
    if (error) {
      console.error('[agente-ia] no se han podido guardar las posturas:', error.message)
      return 0
    }
    const cambios = posturas.filter((p) => previa.has(p.asin.toUpperCase()) && previa.get(p.asin.toUpperCase()) !== p.postura)
    if (cambios.length > 0) {
      const { error: eEv } = await db.from('ads_agente_eventos').insert(
        cambios.map((p) => ({
          perfil_id: perfilId,
          tipo: 'postura',
          titulo: limpiarTextoIa(`Postura de ${p.nombre || p.asin}: ${previa.get(p.asin.toUpperCase())} → ${p.postura}`, 160),
          detalle: p.motivo,
          datos: { asin: p.asin, antes: previa.get(p.asin.toUpperCase()), despues: p.postura, fuente: p.fuente },
        })),
      )
      if (eEv) console.error('[agente-ia] no se han podido anotar los cambios de postura:', eEv.message)
    }
    return posturas.length
  } catch (e) {
    console.error('[agente-ia] no se han podido guardar las posturas:', e instanceof Error ? e.message : e)
    return 0
  }
}

/** Posturas por reglas para todos (cuando no hay IA). Nunca lanza */
async function posturasPorReglas(db: Db, perfilId: string, contexto: ContextoDelAgente): Promise<number> {
  try {
    return await guardarPosturas(db, perfilId, posturasDeLosProductos(contexto, null))
  } catch {
    return 0
  }
}

const COLUMNAS_PENDIENTE = 'id, tipo, asin, termino, campaign_id, campaign_nombre, motivo, metricas, valor_actual, valor_nuevo, objetivo_tipo, ia_decision, creada_at'

function dePendiente(f: Record<string, unknown>): PendienteParaCerebro {
  return {
    id: String(f.id),
    tipo: String(f.tipo ?? ''),
    asin: (f.asin as string | null) ?? null,
    termino: String(f.termino ?? ''),
    campaignId: String(f.campaign_id ?? ''),
    campaignNombre: String(f.campaign_nombre ?? ''),
    motivo: String(f.motivo ?? ''),
    metricas: (f.metricas && typeof f.metricas === 'object' ? f.metricas : {}) as Record<string, unknown>,
    valorActual: numeroONull(f.valor_actual),
    valorNuevo: numeroONull(f.valor_nuevo),
    objetivoTipo: (f.objetivo_tipo as string | null) ?? null,
    iaDecision: (f.ia_decision as string | null) ?? null,
    creadaAt: String(f.creada_at ?? ''),
  }
}

/**
 * Piensa una cuenta: tope del mes, raras sin decisión, términos REVISAR y de mucho gasto sin etiqueta, estado compacto, llamada en JSON estricto,
 * validación, fila en ads_agente_ia con su coste, posturas (IA acotada por reglas) y etiquetas de términos. NO guarda las decisiones de las propuestas
 * (las devuelve) ni avisa. Si falla o se ha llegado al tope: posturas por reglas y `{ ok: false, motivo, tope }`.
 */
export async function pensarCuenta(
  cuenta: CuentaParaSincronizar,
  config: ConfigDelAgente,
  ahora: number,
  momento: 'manana' | 'tarde',
  entrada: { contexto: ContextoDelAgente; veredictos: ReadonlyArray<{ clase: ClaseDeCambio; veredicto: Veredicto; detalle: string | null }> },
): Promise<ResultadoDePensar> {
  const db = createServiceClient()
  const perfilId = cuenta.id
  const { contexto } = entrada
  const fallo = async (motivo: string, extra: Partial<ResultadoDePensar> = {}): Promise<ResultadoDePensar> => ({
    ok: false,
    motivo,
    tope: false,
    coste: 0,
    posturas: await posturasPorReglas(db, perfilId, contexto),
    terminos: 0,
    decisiones: [],
    ...extra,
  })

  // 1) Tope del mes
  const mes = await gastoIaDelMes(db, perfilId, ahora)
  if (faltaLa315(mes.error)) return { ok: false, motivo: FALTA_MIGRACION_315, tope: false, coste: 0, posturas: 0, terminos: 0, decisiones: [] }
  const gastado = costeDelMes(mes.filas, ahora)
  const tope = finito(config.topeIaUsdMes) ? config.topeIaUsdMes : AGENTE.IA_TOPE_USD_MES
  if (gastado >= tope) {
    return fallo(`Tope de IA del mes alcanzado: ${gastado.toLocaleString('es-ES', { maximumFractionDigits: 2 })} $ de ${tope.toLocaleString('es-ES', { maximumFractionDigits: 2 })} $`, { tope: true })
  }

  // 2) Propuestas pendientes libres: las raras sin decisión y los REVISAR
  const { data: dPend, error: ePend } = await db
    .from('ads_propuestas')
    .select(COLUMNAS_PENDIENTE)
    .eq('perfil_id', perfilId)
    .eq('estado', 'pendiente')
    .is('retenida_at', null)
    .order('creada_at', { ascending: false })
    .limit(300)
  if (faltaLa315(ePend as ErrorDb)) return fallo(FALTA_MIGRACION_315)
  if (ePend) return fallo(`No he podido leer las propuestas pendientes: ${ePend.message}`)
  const pendientes = ((dPend ?? []) as Array<Record<string, unknown>>).map(dePendiente)
  const raras = rarasDeLasPendientes(pendientes, contexto.productos)

  // 3) Términos: REVISAR pendientes y los de más gasto sin pedidos, sin etiqueta vigente
  const hashPorAsin = new Map(contexto.productos.map((p) => [p.asin.toUpperCase(), hashDeTitulo(p.nombre)]))
  // Paginado y con orden total (la clave): con `.limit(5000)` PostgREST cortaba en 1.000 filas en silencio, los términos ya etiquetados se reenviaban a la IA, ocupaban las plazas y los
  // REVISAR nuevos se quedaban sin etiqueta
  type FilaEtiqueta = { asin: string; termino: string; titulo_hash: string | null; caduca_at: string | null }
  const { data: dEtiq, error: eEtiq } = await todasLasFilas<FilaEtiqueta>(
    (a, b) =>
      db
        .from('ads_terminos_ia')
        .select('asin, termino, titulo_hash, caduca_at')
        .eq('perfil_id', perfilId)
        .gt('caduca_at', new Date(ahora).toISOString())
        .order('asin')
        .order('termino')
        .range(a, b) as unknown as PromiseLike<{ data: FilaEtiqueta[] | null; error: { code?: string; message?: string } | null }>,
    { tope: 200_000, lanzarAlTope: true }
  )
  if (eEtiq) console.error(`[agente] etiquetas de términos de ${perfilId}: ${eEtiq.message ?? eEtiq.code}; hoy no se mandan términos a la IA`)
  const vigentes = new Set<string>()
  for (const f of dEtiq) {
    const asin = String(f.asin).toUpperCase()
    if (etiquetaSigueValiendo(f, hashPorAsin.get(asin) ?? null, ahora)) vigentes.add(`${asin}|${f.termino}`)
  }
  const revisar = pendientes
    .filter((p) => esRevisar(p))
    .map((p) => ({ asin: p.asin, termino: p.termino, clics: numero(p.metricas.clics), gasto: numero(p.metricas.gasto) }))
  const asinsDeLaCuenta = new Set(contexto.productos.map((p) => p.asin.toUpperCase()))
  const { data: dTer } = await db.from('ads_terminos').select('campaign_nombre, termino, clics, gasto, pedidos').eq('perfil_id', perfilId).eq('pedidos', 0).gt('clics', 0).order('gasto', { ascending: false }).limit(400)
  const delInforme = ((dTer ?? []) as Array<Record<string, unknown>>)
    .map((t) => ({ asin: asinDeCampana(String(t.campaign_nombre ?? '')), termino: String(t.termino ?? ''), clics: numero(t.clics), gasto: numero(t.gasto), pedidos: numero(t.pedidos) }))
    .filter((t) => t.asin != null && asinsDeLaCuenta.has(t.asin.toUpperCase()))
  // Sin saber qué está ya etiquetado no se manda ningún término (se reenviarían los de siempre y se gastaría la IA en ellos); las posturas y las raras siguen
  const terminos = eEtiq ? [] : terminosParaLaIa(revisar, delInforme, (asin, clave) => vigentes.has(`${asin}|${clave}`))

  if (contexto.productos.length === 0 && raras.length === 0 && terminos.length === 0) {
    return { ok: true, motivo: 'Nada que pensar: sin productos, raras ni términos', tope: false, coste: 0, posturas: 0, terminos: 0, decisiones: [] }
  }

  // 4) Lo de ayer (día local del marketplace)
  const hoyIni = Date.parse(inicioDelDiaLocal(contexto.fechaLocal, contexto.zonaHoraria))
  const ayerFecha = new Date(Date.parse(`${contexto.fechaLocal}T00:00:00Z`) - DIA_MS).toISOString().slice(0, 10)
  const ayerIni = Date.parse(inicioDelDiaLocal(ayerFecha, contexto.zonaHoraria))
  const ayerIniIso = new Date(ayerIni).toISOString()
  const hoyIniIso = new Date(hoyIni).toISOString()
  const [{ data: dAyerA }, { data: dAyerR }, { count: nDeshechas }] = await Promise.all([
    db.from('ads_propuestas').select('estado, agente_at, retenida_at').eq('perfil_id', perfilId).gte('agente_at', ayerIniIso).lt('agente_at', hoyIniIso).limit(2000),
    db.from('ads_propuestas').select('estado, agente_at, retenida_at').eq('perfil_id', perfilId).gte('retenida_at', ayerIniIso).lt('retenida_at', hoyIniIso).limit(2000),
    db.from('ads_agente_eventos').select('id', { count: 'exact', head: true }).eq('perfil_id', perfilId).in('tipo', ['deshacer_auto', 'deshacer_freno']).gte('creado_at', ayerIniIso).lt('creado_at', hoyIniIso),
  ])
  const filasAyer = [
    ...((dAyerA ?? []) as Array<{ estado: string; agente_at: string | null; retenida_at: string | null }>).map((f) => ({ ...f, retenida_at: null })),
    ...((dAyerR ?? []) as Array<{ estado: string; agente_at: string | null; retenida_at: string | null }>).map((f) => ({ ...f, agente_at: null })),
  ]
  const ayer = ayerParaLaIa(filasAyer, nDeshechas ?? 0, { desde: ayerIni, hasta: hoyIni }, contexto.cuenta)

  // 5) Estado compacto
  const { estado, refsPropuestas, refsTerminos } = estadoCompacto({ contexto, raras, terminos, resultados: resultadosParaLaIa(entrada.veredictos), ayer })

  // 6) La llamada
  const clave = process.env.OPENAI_API_KEY
  const params = parametrosDeIa({ maxSalida: AGENTE.IA_MAX_SALIDA, esfuerzo: 'low' })
  if (!clave) {
    await anotarLlamada(db, perfilId, { modelo: params.model, entrada: 0, cache: 0, salida: 0, coste: 0, ok: false, error: 'Falta OPENAI_API_KEY en el servidor', datos: null })
    return fallo('Falta OPENAI_API_KEY en el servidor')
  }

  let salida: SalidaDelCerebro
  let coste = 0
  try {
    const cliente = new OpenAI({ apiKey: clave, maxRetries: AGENTE.IA_REINTENTOS, timeout: AGENTE.IA_TIMEOUT_MS })
    const r = await cliente.chat.completions.create({
      ...params,
      response_format: { type: 'json_schema', json_schema: { name: 'cerebro_agente_ppc', strict: true, schema: ESQUEMA_DEL_CEREBRO as unknown as Record<string, unknown> } },
      messages: [
        { role: 'system', content: PROMPT_DEL_CEREBRO },
        { role: 'user', content: `${momento === 'tarde' ? 'Pasada de la TARDE: céntrate en las propuestas raras y los términos; el informe puede ser breve.\n' : ''}ESTADO DE LA CUENTA (JSON):\n${JSON.stringify(estado)}` },
      ],
    })
    const c = costeDeLlamada(r.model || params.model, r.usage ?? null)
    coste = c.coste
    const eleccion = r.choices?.[0]
    const contenido = eleccion?.message?.content ?? null
    const rechazo = (eleccion?.message as { refusal?: string | null } | undefined)?.refusal ?? null
    if (!contenido || rechazo || eleccion?.finish_reason === 'length') {
      const motivo = rechazo ? 'La IA se ha negado a contestar' : eleccion?.finish_reason === 'length' ? 'La IA se ha quedado sin espacio para contestar' : 'La IA no ha devuelto nada'
      await anotarLlamada(db, perfilId, { modelo: r.model || params.model, entrada: c.entrada, cache: c.cache, salida: c.salida, coste, ok: false, error: motivo, datos: null })
      return fallo(motivo, { coste })
    }
    try {
      salida = validarSalidaDelCerebro(contenido, estado)
    } catch (e) {
      const motivo = `La respuesta de la IA no es válida: ${e instanceof Error ? e.message : String(e)}`
      await anotarLlamada(db, perfilId, { modelo: r.model || params.model, entrada: c.entrada, cache: c.cache, salida: c.salida, coste, ok: false, error: motivo, datos: null })
      return fallo(motivo, { coste })
    }
    await anotarLlamada(db, perfilId, { modelo: r.model || params.model, entrada: c.entrada, cache: c.cache, salida: c.salida, coste, ok: true, error: null, datos: { ...salida, momento } })
  } catch (e) {
    const x = e as { status?: number; code?: string; message?: string }
    const motivo = `La IA no ha contestado${x?.status ? ` (${x.status})` : ''}${x?.code ? ` [${x.code}]` : ''}`
    console.error('[agente-ia] la llamada al cerebro ha fallado', { perfilId, estado: x?.status ?? null, codigo: x?.code ?? null })
    await anotarLlamada(db, perfilId, { modelo: params.model, entrada: 0, cache: 0, salida: 0, coste: 0, ok: false, error: `${motivo}: ${x?.message ?? ''}`, datos: null })
    return fallo(motivo)
  }

  // 7) Posturas: IA acotada por reglas
  const iaPorAsin = new Map(salida.posturas.map((p) => [p.asin.toUpperCase(), { postura: p.postura, motivo: p.motivo }]))
  const nPosturas = await guardarPosturas(db, perfilId, posturasDeLosProductos(contexto, iaPorAsin))

  // 8) Términos → ads_terminos_ia (clave limpia, hash del título y caducidad)
  const caduca = new Date(ahora + AGENTE.IA_ETIQUETA_DIAS * DIA_MS).toISOString()
  const creado = new Date(ahora).toISOString()
  const filasTer = new Map<string, Record<string, unknown>>()
  for (const t of salida.terminos) {
    const ref = refsTerminos.get(t.ref)
    if (!ref) continue
    const asin = ref.asin.toUpperCase()
    const termino = claveDeTermino(ref.termino)
    if (!termino) continue
    filasTer.set(`${asin}|${termino}`, {
      perfil_id: perfilId,
      asin,
      termino,
      etiqueta: t.etiqueta,
      confianza: Math.min(1, Math.max(0, Math.round(t.confianza * 100) / 100)),
      razon: limpiarTextoIa(t.razon, 120),
      modelo: params.model,
      titulo_hash: hashPorAsin.get(asin) ?? null,
      creado_at: creado,
      caduca_at: caduca,
    })
  }
  let nTerminos = 0
  if (filasTer.size > 0) {
    const { error } = await db.from('ads_terminos_ia').upsert([...filasTer.values()], { onConflict: 'perfil_id,asin,termino' })
    if (error) console.error('[agente-ia] no se han podido guardar las etiquetas de términos:', error.message)
    else nTerminos = filasTer.size
  }

  // 9) Decisiones de lo raro: se devuelven (las guarda el orquestador)
  const decisiones: ResultadoDePensar['decisiones'] = []
  for (const p of salida.propuestas) {
    const id = refsPropuestas.get(p.ref)
    if (id) decisiones.push({ id, decision: p.decision, motivo: p.motivo || (p.decision === 'aplicar' ? 'La IA la aprueba' : 'La IA prefiere que la vea una persona') })
  }

  return { ok: true, motivo: null, tope: false, coste, posturas: nPosturas, terminos: nTerminos, decisiones }
}

/** El informe de la última llamada que salió bien (opcionalmente, solo si es posterior a `desdeIso`). null si no hay o falta la 315 */
export async function informeDesde(perfilId: string, desdeIso: string | null): Promise<SalidaDelCerebro['informe'] | null> {
  try {
    let q = createServiceClient().from('ads_agente_ia').select('salida, creado_at').eq('perfil_id', perfilId).eq('ok', true).not('salida', 'is', null)
    if (desdeIso) q = q.gte('creado_at', desdeIso)
    const { data, error } = await q.order('creado_at', { ascending: false }).limit(1).maybeSingle()
    if (error || !data) return null
    const inf = ((data as { salida?: { informe?: unknown } }).salida?.informe ?? null) as Record<string, unknown> | null
    if (!inf || typeof inf !== 'object') return null
    const lista = (x: unknown, max: number, cuantos: number) => (Array.isArray(x) ? x.map((s) => limpiarTextoIa(String(s ?? ''), max)).filter(Boolean).slice(0, cuantos) : [])
    const informe = { titular: limpiarTextoIa(String(inf.titular ?? ''), 160), puntos: lista(inf.puntos, 240, 6), necesitaPersona: lista(inf.necesitaPersona, 240, 5) }
    return informe.titular || informe.puntos.length || informe.necesitaPersona.length ? informe : null
  } catch {
    return null
  }
}

/** El informe de la última llamada que salió bien */
export async function ultimoInforme(perfilId: string): Promise<SalidaDelCerebro['informe'] | null> {
  return informeDesde(perfilId, null)
}

/** Coste de IA del mes (Madrid), llamadas, la última y su error si falló. Sin la 315 → ceros */
export async function costeIaDelMes(perfilId: string, ahora: number): Promise<{ coste: number; llamadas: number; ultimaAt: string | null; ultimoError: string | null }> {
  try {
    const { filas, error } = await gastoIaDelMes(createServiceClient(), perfilId, ahora)
    if (error) return { coste: 0, llamadas: 0, ultimaAt: null, ultimoError: null }
    const ultima = filas[0] ?? null
    return { coste: costeDelMes(filas, ahora), llamadas: filas.length, ultimaAt: ultima?.creado_at ?? null, ultimoError: ultima && !ultima.ok ? ultima.error ?? 'Error' : null }
  } catch {
    return { coste: 0, llamadas: 0, ultimaAt: null, ultimoError: null }
  }
}

/** La etiqueta vigente de un término (no caducada y del mismo título si se pasa su hash). null si no hay, caducó, cambió el título o falta la 315 */
export async function etiquetaVigente(perfilId: string, asin: string, termino: string, tituloHash: string | null, ahora: number): Promise<{ etiqueta: EtiquetaDeTermino; confianza: number } | null> {
  const clave = claveDeTermino(termino)
  if (!asin || !clave) return null
  try {
    const { data, error } = await createServiceClient()
      .from('ads_terminos_ia')
      .select('etiqueta, confianza, titulo_hash, caduca_at')
      .eq('perfil_id', perfilId)
      .eq('asin', asin.toUpperCase())
      .eq('termino', clave)
      .maybeSingle()
    if (error || !data) return null
    const f = data as { etiqueta: string; confianza: unknown; titulo_hash: string | null; caduca_at: string | null }
    if (!etiquetaSigueValiendo(f, tituloHash, ahora)) return null
    if (!ETIQUETAS.includes(f.etiqueta as EtiquetaDeTermino)) return null
    return { etiqueta: f.etiqueta as EtiquetaDeTermino, confianza: Math.min(1, Math.max(0, numero(f.confianza))) }
  } catch {
    return null
  }
}

/**
 * ¿Está validada la IA por las personas? REVISAR retenidos con «La IA dice: …» y resueltos por una persona (resuelta_por): aplicada = de acuerdo si la IA
 * decía negativizar; descartada = de acuerdo si decía relevante. Validada con ≥ 50 resueltas y ≥ 80 % de acuerdo. Sin la 315 → no validada.
 */
export async function validacionDeLaIa(perfilId: string): Promise<{ resueltas: number; deAcuerdo: number; ok: boolean }> {
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('ads_propuestas')
      .select('asin, termino, estado, retenida_motivo')
      .eq('perfil_id', perfilId)
      .eq('tipo', 'negativizar')
      .in('estado', ['aplicada', 'descartada'])
      .not('resuelta_por', 'is', null)
      .like('retenida_motivo', 'La IA dice:%')
      .order('resuelta_at', { ascending: false })
      .limit(2000)
    if (error || !data) return acuerdoIaPersona([])
    const filas = data as Array<{ asin: string | null; termino: string; estado: 'aplicada' | 'descartada'; retenida_motivo: string | null }>

    // Las que no se entienden por el motivo, por la etiqueta guardada
    const sinEtiqueta = filas.filter((f) => !etiquetaDelMotivo(f.retenida_motivo) && f.asin)
    const guardadas = new Map<string, EtiquetaDeTermino>()
    if (sinEtiqueta.length > 0) {
      const { data: dEt } = await db.from('ads_terminos_ia').select('asin, termino, etiqueta').eq('perfil_id', perfilId).limit(5000)
      for (const e of (dEt ?? []) as Array<{ asin: string; termino: string; etiqueta: EtiquetaDeTermino }>) guardadas.set(`${String(e.asin).toUpperCase()}|${e.termino}`, e.etiqueta)
    }
    const resueltas: Array<{ etiqueta: EtiquetaDeTermino; resultado: 'aplicada' | 'descartada' }> = []
    for (const f of filas) {
      const etiqueta = etiquetaDelMotivo(f.retenida_motivo) ?? (f.asin ? guardadas.get(`${f.asin.toUpperCase()}|${claveDeTermino(f.termino)}`) : undefined)
      if (etiqueta) resueltas.push({ etiqueta, resultado: f.estado })
    }
    return acuerdoIaPersona(resueltas)
  } catch {
    return acuerdoIaPersona([])
  }
}
