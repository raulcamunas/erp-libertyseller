/**
 * AMAZON ADS · EL AGENTE PPC: OBJETIVOS AUTOMÁTICOS CONGELADOS Y TECHO DEL MES (SOLO SERVIDOR; solo base de datos).
 *
 * Una vez al día (paso «objetivos»):
 *   · ACoS objetivo AUTOMÁTICO de los productos SIN uno humano: el primero se calcula y se CONGELA (`ads_agente_objetivos`); después solo hay una revisión al mes (día local ≥ 4, sin ventanas que toquen
 *     un evento de temporada; sube como mucho 2 puntos, baja libre). Un ACoS humano NUNCA se pisa: el producto que lo tiene no se toca aquí.
 *   · Techo mensual: el de la ficha manda; si no, el congelado (revisado una vez al mes: max(gasto 30 d, TACoS objetivo × ventas totales), como mucho +25 %); si no (primera vez), el automático,
 *     que se congela en `ads_agente` (techo_mensual, techo_automatico, techo_congelado_at).
 *   · Fase y marca: la fase se calcula al leer (manual o < 60 días desde la primera estructura); aquí se devuelven los productos sin marca para pedírsela a una persona.
 * No anota eventos ni avisa: lo devuelve todo y el orquestador lo hace (regla de dependencias de la oleada 2).
 *
 * Sin la 315, lanza `Error(FALTA_MIGRACION_315)`.
 */

import { createServiceClient } from '@/lib/supabase/service'
import type { CuentaParaSincronizar } from '../sincronizar'
import { asinDeCampana } from '../productos-agrupar'
import { acosDe, desplazar, lanzar, leerCuenta, sumarDias } from './contexto-servidor'
import { acosAutomatico, revisarObjetivo } from './objetivos-calculo'
import { ventanaTocaEvento } from './temporada-calculo'
import type { ConfigDelAgente, FuenteDeObjetivo } from './tipos'

export async function recalcularObjetivos(
  cuenta: CuentaParaSincronizar,
  config: ConfigDelAgente | null,
  ahora: number,
): Promise<{
  nuevos: Array<{ asin: string; acosObjetivoPct: number; fuente: FuenteDeObjetivo; detalle: string }>
  revisados: Array<{ asin: string; antes: number; despues: number }>
  sinObjetivo: Array<{ asin: string; motivo: string }>
  sinMarca: string[]
  techo: { techo: number | null; automatico: boolean; detalle: string; congelado: boolean; cambia: boolean }
}> {
  const l = await leerCuenta(cuenta.id, config, ahora, 90)
  const { local, rendimiento, hasta, productos, ventas, ficha, perfil } = l
  const service = createServiceClient()
  const ahoraIso = new Date(ahora).toISOString()

  const nuevos: Array<{ asin: string; acosObjetivoPct: number; fuente: FuenteDeObjetivo; detalle: string }> = []
  const revisados: Array<{ asin: string; antes: number; despues: number }> = []
  const sinObjetivo: Array<{ asin: string; motivo: string }> = []

  // La ventana de 30 días del cálculo, ¿toca un evento de temporada? (entonces no se revisa este mes todavía)
  const desde30 = desplazar(hasta, -29)
  const toca = ventanaTocaEvento(desde30, hasta, perfil.pais, config?.eventosManuales ?? []) != null

  for (const p of productos) {
    if (!p.activo) continue
    // Un ACoS humano manda siempre: nunca se pisa ni se le calcula uno automático
    if (p.humano != null && p.humano > 0) continue

    const deAsin = (f: { nombre: string }) => asinDeCampana(f.nombre) === p.asin
    const s30 = sumarDias(rendimiento, desde30, hasta, deAsin)
    const s90 = sumarDias(rendimiento, desplazar(hasta, -89), hasta, deAsin)
    const candidato = acosAutomatico({
      precio: p.costes.precioFicha,
      ivaPct: p.costes.ivaPct,
      costeProducto: p.costes.costeProducto,
      comisionPct: p.costes.comisionPct,
      tarifaFba: p.costes.tarifaFba,
      otrosCostes: p.costes.otrosCostes,
      acos30Pct: acosDe(s30.gasto, s30.ventas),
      acos90Pct: acosDe(s90.gasto, s90.ventas),
      pedidos30: s30.pedidos,
      ventasAds30: s30.ventas,
      ventasTotales30: ventas.v30[p.asin]?.ventas ?? null,
      tacosObjetivoPct: ficha.tacosObjetivoPct,
    })
    const actual = p.automatico ? { acosObjetivoPct: p.automatico.acosObjetivoPct, revisadoMes: p.automatico.revisadoMes } : null
    const r = revisarObjetivo(actual, candidato, { mes: local.mes, dia: local.dia }, toca)

    if (!actual) {
      if (r.acosObjetivoPct == null || !candidato.fuente) {
        sinObjetivo.push({ asin: p.asin, motivo: candidato.motivoSinObjetivo ?? candidato.detalle })
        continue
      }
      const { error } = await service.from('ads_agente_objetivos').insert({
        perfil_id: cuenta.id,
        asin: p.asin,
        acos_objetivo_pct: r.acosObjetivoPct,
        fuente: candidato.fuente,
        solo_defensivo: candidato.soloDefensivo,
        detalle: candidato.detalle.slice(0, 500),
        congelado_at: ahoraIso,
        revisado_mes: r.revisadoMes,
        calculado_at: ahoraIso,
      })
      // 23505: otra pasada lo acaba de congelar; no se pisa
      if (error && error.code !== '23505') lanzar(error)
      if (!error) nuevos.push({ asin: p.asin, acosObjetivoPct: r.acosObjetivoPct, fuente: candidato.fuente, detalle: candidato.detalle })
      continue
    }

    // Con fila: solo cambia en la revisión mensual
    if (r.cambia && r.acosObjetivoPct != null && candidato.fuente) {
      const { error } = await service
        .from('ads_agente_objetivos')
        .update({
          acos_objetivo_pct: r.acosObjetivoPct,
          fuente: candidato.fuente,
          solo_defensivo: candidato.soloDefensivo,
          detalle: r.detalle.slice(0, 500),
          revisado_mes: r.revisadoMes,
          calculado_at: ahoraIso,
        })
        .eq('perfil_id', cuenta.id)
        .eq('asin', p.asin)
      if (error) lanzar(error)
      revisados.push({ asin: p.asin, antes: actual.acosObjetivoPct, despues: r.acosObjetivoPct })
    } else if (r.revisadoMes !== actual.revisadoMes) {
      // Revisado sin cambio: se apunta el mes para no revisarlo otra vez
      const { error } = await service.from('ads_agente_objetivos').update({ revisado_mes: r.revisadoMes, calculado_at: ahoraIso }).eq('perfil_id', cuenta.id).eq('asin', p.asin)
      if (error) lanzar(error)
    }
  }

  // Productos activos sin marca: «Necesita a una persona: pon la marca de B0…»
  const sinMarca = productos.filter((p) => p.activo && !p.marca).map((p) => p.asin)

  // Techo: si toca congelarlo (primera vez, sin ficha) o revisarlo (una vez al mes), se guarda en la fila del agente; techo_congelado_at marca el mes de la revisión
  let congelado = false
  if (l.techo.congelar && l.techo.techo != null && config) {
    const { data, error } = await service
      .from('ads_agente')
      .update({ techo_mensual: l.techo.techo, techo_automatico: true, techo_congelado_at: ahoraIso, updated_at: ahoraIso })
      .eq('perfil_id', cuenta.id)
      .select('perfil_id')
    if (error) lanzar(error)
    congelado = Array.isArray(data) && data.length > 0
  }

  return { nuevos, revisados, sinObjetivo, sinMarca, techo: { techo: l.techo.techo, automatico: l.techo.automatico, detalle: l.techo.detalle, congelado, cambia: congelado && l.techo.cambia } }
}
