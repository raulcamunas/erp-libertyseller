/**
 * AGENTE PPC · EL RESUMEN DIARIO (SERVIDOR). §7 de la especificación.
 *
 * A las 09:00 de Madrid el orquestador pide el resumen de cada cuenta y lo publica en #notificaciones-erp (`avisar('resumen', …, { avisar: false })`).
 * Aquí solo se ARMA: las cifras salen del contexto (ventas totales y TACoS primero, «Ayer» provisional sin ACoS, 7 días cerrados, el mes contra el techo),
 * de lo que hizo el agente en las últimas 24 h (por `agente_at`), de los veredictos medidos que llegan como parámetro y de lo que necesita a una persona
 * (retenidas, productos sin coste, sin marca o sin objetivo). Las frases de la IA solo van en «La lectura» (el informe de la última llamada de hoy).
 * El texto lo escribe `textoDelResumen` (avisos-calculo). No publica nada.
 */

import { createServiceClient } from '@/lib/supabase/service'
import type { CuentaParaSincronizar } from '../sincronizar'
import type { ClaseDeCambio, ConfigDelAgente, ContextoDelAgente, DatosDelResumen, ProductoDelContexto, SalidaDelCerebro, Veredicto } from './tipos'
import { textoDelResumen } from './avisos-calculo'
import { claseDeCambio } from './guardarrailes-calculo'
import { horaEnMadrid } from './pasos-calculo'
import { limpiarTextoIa } from './cerebro-calculo'
import { informeDesde } from './cerebro-ia'

const HORA_MS = 3_600_000
const MAX_POR_GRUPO = 3

const numeroONull = (x: unknown): number | null => {
  if (x == null) return null
  const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN
  return Number.isFinite(n) ? n : null
}

// ─────────────────────────────────────────────────────────────────────────────
// Puras (exportadas para resumen-servidor.prueba.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lo hecho por el agente en 24 h, por clase. Cuenta lo aplicado (también lo que luego se deshizo) y lo ensayado. Lo ENSAYADO, sin repetidas (la misma campaña,
 * segmentación o término y el mismo tipo cuentan una vez, con la clave de `cambiosDistintosDelEnsayo`): es el informe con el que se decide pasar a activo y una
 * pausa ensayada dos veces no son dos campañas pausadas.
 */
export function hechosPorClase(
  filas: ReadonlyArray<{ tipo: string; estado: string; valorActual: number | null; valorNuevo: number | null; metricas: { pedidos?: unknown } | null; campaignId?: string | null; objetivoId?: string | null; termino?: string | null }>,
): Partial<Record<ClaseDeCambio, number>> {
  const r: Partial<Record<ClaseDeCambio, number>> = {}
  const ensayadas = new Set<string>()
  for (const f of filas) {
    if (f.estado !== 'aplicada' && f.estado !== 'ensayada' && f.estado !== 'deshecha') continue
    if (f.estado === 'ensayada') {
      const clave = `${f.campaignId ?? ''}|${f.objetivoId ?? (f.termino ?? '').trim().toLowerCase()}|${f.tipo}`
      if (ensayadas.has(clave)) continue
      ensayadas.add(clave)
    }
    const c = claseDeCambio({ tipo: f.tipo, valorActual: f.valorActual, valorNuevo: f.valorNuevo, metricas: { pedidos: numeroONull(f.metricas?.pedidos) ?? 0 } })
    r[c] = (r[c] ?? 0) + 1
  }
  return r
}

/** Recuento de veredictos de los últimos 14 días (sin «sin muestra») */
export function veredictosDelResumen(v: ReadonlyArray<{ veredicto: Veredicto }>): DatosDelResumen['veredictos'] {
  const r = { mejoro: 0, empeoro: 0, neutro: 0, mezclado: 0 }
  for (const x of v) if (x.veredicto !== 'sin_muestra') r[x.veredicto]++
  return r
}

/** «B0A, B0B, B0C y 2 más» */
function listaCorta(asins: readonly string[]): string {
  if (asins.length <= MAX_POR_GRUPO) return asins.join(', ')
  return `${asins.slice(0, MAX_POR_GRUPO).join(', ')} y ${asins.length - MAX_POR_GRUPO} más`
}

/**
 * Lo que necesita a una persona, calculado por el código: propuestas retenidas, productos sin coste (sin ACoS de equilibrio: solo defensivos o sin crecer),
 * productos sin marca y productos sin ACoS objetivo. Cada grupo en una línea corta.
 */
export function necesitaPersona(retenidas: number, productos: ReadonlyArray<Pick<ProductoDelContexto, 'asin' | 'equilibrioPct' | 'soloDefensivo' | 'marca' | 'acosObjetivoPct'>>): string[] {
  const r: string[] = []
  if (retenidas > 0) r.push(`${retenidas.toLocaleString('es-ES')} ${retenidas === 1 ? 'propuesta retenida' : 'propuestas retenidas'}`)
  const sinCosteDefensivo = productos.filter((p) => p.equilibrioPct == null && p.soloDefensivo).map((p) => p.asin)
  const sinCosteOtros = productos.filter((p) => p.equilibrioPct == null && !p.soloDefensivo).map((p) => p.asin)
  const sinMarca = productos.filter((p) => !(p.marca && p.marca.trim())).map((p) => p.asin)
  const sinObjetivo = productos.filter((p) => p.acosObjetivoPct == null).map((p) => p.asin)
  if (sinCosteDefensivo.length) r.push(`${listaCorta(sinCosteDefensivo)} sin coste (solo defensivo)`)
  if (sinCosteOtros.length) r.push(`${listaCorta(sinCosteOtros)} sin coste (no crece)`)
  if (sinObjetivo.length) r.push(`${listaCorta(sinObjetivo)} sin ACoS objetivo`)
  if (sinMarca.length) r.push(`${listaCorta(sinMarca)} sin marca`)
  return r
}

/** Arma los datos del resumen con lo leído (sin base de datos) */
export function datosDelResumen(a: {
  config: Pick<ConfigDelAgente, 'estado' | 'frenoMotivo' | 'frenoDetalle'>
  contexto: ContextoDelAgente
  fecha: string
  hechos: Partial<Record<ClaseDeCambio, number>>
  deshechos: string[]
  retenidas: number
  veredictos: ReadonlyArray<{ veredicto: Veredicto }>
  informeIa: SalidaDelCerebro['informe'] | null
  veda: { nombre: string; hasta: string } | null
  rampa: { dia: number; de: number } | null
}): DatosDelResumen {
  const c = a.contexto
  return {
    nombreCuenta: c.nombreCuenta,
    moneda: c.moneda,
    fecha: a.fecha,
    enEnsayo: a.config.estado === 'ensayo',
    rampa: a.config.estado === 'activo' ? a.rampa : null,
    frenado: a.config.estado === 'frenado' ? { motivo: a.config.frenoMotivo ?? 'manual', detalle: a.config.frenoDetalle } : null,
    evento: c.evento,
    veda: a.veda,
    negocio: {
      ventasTotalesMes: c.cuenta.ventasTotalesMes,
      ventasTotalesMesAnterior: c.cuenta.ventasTotalesMesAnterior,
      tacosMesPct: c.cuenta.tacosMesPct,
      tacosMesAnteriorPct: c.cuenta.tacosMesAnteriorPct,
      tacosObjetivoPct: c.tacosObjetivoPct,
    },
    ayer: { gasto: c.cuenta.gastoAyer || 0, ventas: c.cuenta.ventasAyer || 0 },
    cerrado7: { acosPct: c.cuenta.acos7Pct, acosObjetivoMedioPct: c.acosObjetivoMedioPct, hasta: c.cuenta.hasta7 },
    mes: c.mes,
    hechos: a.hechos,
    deshechos: a.deshechos.map((d) => limpiarTextoIa(d, 160)).filter(Boolean),
    veredictos: veredictosDelResumen(a.veredictos),
    marca: c.cuenta.marca ? { gasto7: c.cuenta.marca.gasto7, acos7Pct: c.cuenta.marca.acos7Pct } : null,
    informeIa: a.informeIa,
    necesitaPersona: necesitaPersona(a.retenidas, c.productos),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Servidor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El resumen diario de una cuenta: `{ titulo, cuerpo, fecha }` (fecha de Madrid, la de la clave del aviso). No publica. Si falta una tabla (sin la 315)
 * o una lectura falla, esa parte sale vacía: el resumen siempre se arma.
 */
export async function prepararResumen(
  cuenta: CuentaParaSincronizar,
  config: ConfigDelAgente,
  ahora: number,
  entrada: { contexto: ContextoDelAgente; veredictos: ReadonlyArray<{ clase: ClaseDeCambio; veredicto: Veredicto }>; veda: { nombre: string; hasta: string } | null; rampa: { dia: number; de: number } | null },
): Promise<{ titulo: string; cuerpo: string; fecha: string }> {
  const db = createServiceClient()
  const perfilId = cuenta.id
  const madrid = horaEnMadrid(ahora)
  const desde24 = new Date(ahora - 24 * HORA_MS).toISOString()

  const [hechos, deshechos, retenidas, informeIa] = await Promise.all([
    (async () => {
      try {
        const { data, error } = await db
          .from('ads_propuestas')
          .select('tipo, estado, valor_actual, valor_nuevo, metricas, campaign_id, objetivo_id, termino')
          .eq('perfil_id', perfilId)
          .gte('agente_at', desde24)
          .in('estado', ['aplicada', 'ensayada', 'deshecha'])
          .limit(2000)
        if (error || !data) return {}
        return hechosPorClase(
          (data as Array<Record<string, unknown>>).map((f) => ({
            tipo: String(f.tipo ?? ''),
            estado: String(f.estado ?? ''),
            valorActual: numeroONull(f.valor_actual),
            valorNuevo: numeroONull(f.valor_nuevo),
            metricas: (f.metricas && typeof f.metricas === 'object' ? f.metricas : null) as { pedidos?: unknown } | null,
            campaignId: f.campaign_id == null ? null : String(f.campaign_id),
            objetivoId: f.objetivo_id == null ? null : String(f.objetivo_id),
            termino: f.termino == null ? null : String(f.termino),
          })),
        )
      } catch {
        return {}
      }
    })(),
    (async () => {
      try {
        const { data, error } = await db.from('ads_agente_eventos').select('titulo').eq('perfil_id', perfilId).eq('tipo', 'deshacer_auto').gte('creado_at', desde24).order('creado_at', { ascending: false }).limit(50)
        if (error || !data) return [] as string[]
        return (data as Array<{ titulo: string | null }>).map((f) => f.titulo ?? '').filter(Boolean)
      } catch {
        return [] as string[]
      }
    })(),
    (async () => {
      try {
        const { count, error } = await db.from('ads_propuestas').select('id', { count: 'exact', head: true }).eq('perfil_id', perfilId).eq('estado', 'pendiente').not('retenida_at', 'is', null)
        return error ? 0 : count ?? 0
      } catch {
        return 0
      }
    })(),
    // «La lectura»: solo el informe de una llamada de las últimas 24 h (el cerebro de la mañana corre a las 08:00)
    informeDesde(perfilId, desde24),
  ])

  const datos = datosDelResumen({ config, contexto: entrada.contexto, fecha: madrid.fecha, hechos, deshechos, retenidas, veredictos: entrada.veredictos, informeIa, veda: entrada.veda, rampa: entrada.rampa })
  const { titulo, cuerpo } = textoDelResumen(datos)
  return { titulo, cuerpo, fecha: madrid.fecha }
}
