/**
 * AMAZON ADS · EL AGENTE PPC: LO QUE EL AGENTE LE PASA A LA GENERACIÓN DIARIA DE PUJAS (SOLO SERVIDOR).
 *
 * En modo «agente», motor-pujas genera las pujas y pausas del día con estos ajustes (`AjustesDelAgenteParaPujas`):
 *   · por ASIN: objetivo para BAJAR (efectivo, con postura) y para SUBIR (el BASE, nunca el efectivo), umbrales ya combinados y ACOTADOS (`combinarAjustes`), si puede subir, fase, marca y puja máxima;
 *   · la presión del día por campaña (R2/R3, la calculó vigilar con días cerrados);
 *   · campañas de marca y campañas con ajuste de ubicación > 100 % (sus subidas son raras);
 *   · si la cuenta no deja subir nada (ritmo recorte, rampa en solo bajadas, techo nulo, 7 días tras un evento);
 *   · lo bloqueado por un EFECTO abierto (medición provisional pendiente): consulta propia a `ads_efectos`.
 * Corre una vez al día por cuenta, dentro del motor: la única lectura de Amazon es la de los ajustes de ubicación (y si falla, sigue sin ellos).
 *
 * Sin la 315, lanza `Error(FALTA_MIGRACION_315)`.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { todasLasFilas } from '../paginar'
import { asinDeCampana } from '../productos-agrupar'
import { cvrsDeCuenta, leerUmbrales } from '../umbrales-cuenta'
import { campanaEsDeMarca, cuentaDePerfil, desplazar, lanzar, leerConfigPropia, leerCuenta } from './contexto-servidor'
import { topesDelDia } from './guardarrailes-calculo'
import { subidasVetadasPorEfectos } from './efectos-calculo'
import { combinarAjustes, pujaMaxima } from './objetivos-calculo'
import { diaDeRampa } from './pasos-calculo'
import { AGENTE, TOPES_DE_PARTIDA, topePujaDeSerie, type AjustesDelAgenteParaPujas, type Presion } from './tipos'
import { horaLocal } from './uso-calculo'
import { leerAjustesDeUbicacion } from './uso-servidor'

const CLASES_DE_PRESUPUESTO = ['presupuesto_subir', 'presupuesto_bajar', 'pausar_campana']

/** PURO. La presión guardada vale si es de hoy o de ayer (se recalcula tras las 03:00 locales; el motor puede correr antes) */
export function presionVigente(presion: Record<string, Presion>, presionFecha: string | null, hoyLocal: string): Record<string, Presion> {
  if (!presionFecha) return {}
  return presionFecha === hoyLocal || presionFecha === desplazar(hoyLocal, -1) ? { ...presion } : {}
}

/** Los efectos abiertos (sin medición provisional) de la cuenta: segmentaciones y campañas que no se tocan */
async function efectosAbiertosPropios(perfilId: string): Promise<{ objetivos: string[]; campanas: string[] }> {
  const service = createServiceClient()
  const r = await todasLasFilas<{ clase: string; objetivo_id: string | null; campaign_id: string | null }>((a, b) =>
    service
      .from('ads_efectos')
      .select('clase, objetivo_id, campaign_id')
      .eq('perfil_id', perfilId)
      .is('revisado_7d_at', null)
      .order('propuesta_id')
      .range(a, b) as unknown as PromiseLike<{ data: Array<{ clase: string; objetivo_id: string | null; campaign_id: string | null }> | null; error: { code?: string; message?: string } | null }>,
  20_000)
  if (r.error) lanzar(r.error)
  const objetivos = new Set<string>()
  const campanas = new Set<string>()
  for (const f of r.data) {
    if (f.objetivo_id) objetivos.add(String(f.objetivo_id))
    if (f.campaign_id && CLASES_DE_PRESUPUESTO.includes(f.clase)) campanas.add(String(f.campaign_id))
  }
  return { objetivos: Array.from(objetivos), campanas: Array.from(campanas) }
}

/**
 * Las subidas vetadas de la cuenta (subidasVetadasPorEfectos): puja_subir y presupuesto_subir medidas como «empeoró» o deshechas solas en los últimos
 * AGENTE.DIAS_SIN_REPETIR_SUBIDA_EMPEORADA días. Lanza si falla la lectura (falla cerrado: sin saber qué está vetado, quien llama no sube).
 */
export async function subidasVetadasDeCuenta(perfilId: string, hoyLocal: string): Promise<{ objetivos: Set<string>; campanas: Set<string> }> {
  const desdeDia = desplazar(hoyLocal, -AGENTE.DIAS_SIN_REPETIR_SUBIDA_EMPEORADA)
  type Fila = { clase: string; objetivo_id: string | null; campaign_id: string | null; veredicto: string | null; deshecho_auto: boolean | null; aplicada_dia: string }
  const service = createServiceClient()
  const r = await todasLasFilas<Fila>((a, b) =>
    service
      .from('ads_efectos')
      .select('clase, objetivo_id, campaign_id, veredicto, deshecho_auto, aplicada_dia')
      .eq('perfil_id', perfilId)
      .in('clase', ['puja_subir', 'presupuesto_subir'])
      .gte('aplicada_dia', desdeDia)
      .or('veredicto.eq.empeoro,deshecho_auto.eq.true')
      .order('propuesta_id')
      .range(a, b) as unknown as PromiseLike<{ data: Fila[] | null; error: { code?: string; message?: string } | null }>,
  20_000)
  if (r.error) lanzar(r.error)
  return subidasVetadasPorEfectos(r.data, desdeDia)
}

export async function ajustesParaPujas(perfilId: string, ahora: number): Promise<AjustesDelAgenteParaPujas> {
  const config = await leerConfigPropia(perfilId)
  const l = await leerCuenta(perfilId, config, ahora, 35)
  const { local, rendimiento, hasta, productos, ficha, perfil } = l
  const [{ umbrales }, efectos, vetadas] = await Promise.all([leerUmbrales(perfilId), efectosAbiertosPropios(perfilId), subidasVetadasDeCuenta(perfilId, l.local.fecha)])
  const cvrs = await cvrsDeCuenta(perfilId, umbrales.cvrPorDefectoPct)

  // ¿La cuenta deja subir? Ritmo recorte, rampa en «solo bajadas», techo nulo, o en los 7 días posteriores a un evento
  const rampaLocal = config?.rampaDesde ? horaLocal(Date.parse(config.rampaDesde), perfil.zona).fecha : null
  const hoyTopes = topesDelDia(config?.topes ?? TOPES_DE_PARTIDA, {
    enEnsayo: config?.estado === 'ensayo',
    diaRampa: config?.estado === 'activo' ? diaDeRampa(rampaLocal, local.fecha) : null,
    cuentaPequena: l.cuentaPequena,
    erroresRecientes: false,
  })
  const ritmoDeEsteMes = config?.ritmoFecha && config.ritmoFecha.slice(0, 7) === local.mes ? config.ritmo : 'normal'
  const sinSubidas = ritmoDeEsteMes === 'recorte' || hoyTopes.soloBajadas || l.techoMes == null || l.evento?.fase === 'posterior'

  // Por ASIN: objetivo base, postura y umbrales combinados (la presión por campaña la aplica motor-pujas)
  const porAsin: AjustesDelAgenteParaPujas['porAsin'] = {}
  const topeFijo = config?.pujaMax != null && config.pujaMax > 0 ? config.pujaMax : topePujaDeSerie(l.perfil.moneda)
  for (const p of productos) {
    if (!p.activo || p.acosObjetivoPct == null) continue
    // En recorte las posturas «crecer» pasan a «mantener»
    const postura = ritmoDeEsteMes === 'recorte' && p.postura === 'crecer' ? 'mantener' : p.postura
    const c = combinarAjustes(umbrales, {
      postura,
      presion: null,
      objetivoBase: p.acosObjetivoPct,
      equilibrioPct: p.equilibrioPct,
      soloDefensivo: p.soloDefensivo,
      esMarca: false,
      cuentaPequena: l.cuentaPequena,
      sinSubidasCuenta: sinSubidas,
    })
    const cvr = cvrs.de('', p.asin).cvr
    porAsin[p.asin] = {
      acosParaBajar: c.acosParaBajar,
      acosParaSubir: c.acosParaSubir,
      umbrales: c.umbrales,
      postura,
      sinSubidas: c.sinSubidas,
      soloDefensivo: p.soloDefensivo,
      fase: p.fase,
      marca: p.marca,
      pujaMaxima: pujaMaxima({ precio: p.precio, cvrPct: cvr * 100, acosObjetivoPct: p.acosObjetivoPct, topeFijo }),
    }
  }

  // Campañas conocidas (30 días de rendimiento): las de marca y, en Amazon, su ajuste por ubicación
  const nombres = new Map<string, string>()
  for (const f of rendimiento) if (f.fecha >= desplazar(hasta, -29)) nombres.set(f.campaignId, f.nombre)
  const marcaDe = new Map(productos.map((p) => [p.asin, p.marca]))
  const campanasDeMarca: string[] = []
  for (const [id, nombre] of Array.from(nombres.entries())) {
    const asin = asinDeCampana(nombre)
    if (campanaEsDeMarca(nombre, asin ? (marcaDe.get(asin) ?? null) : null)) campanasDeMarca.push(id)
  }
  let campanasConUbicacionAlta: string[] = []
  const ids = Array.from(nombres.keys())
  if (ids.length > 0) {
    try {
      const cuenta = await cuentaDePerfil(perfilId)
      const ubic = await leerAjustesDeUbicacion(cuenta, ids)
      campanasConUbicacionAlta = Array.from(ubic.entries())
        .filter(([, pct]) => pct > AGENTE.UBICACION_RARA_PCT)
        .map(([id]) => id)
    } catch (err) {
      // Sin los ajustes de ubicación las subidas no se marcan como raras por eso; el resto sigue
      console.error(`[agente] ajustes de ubicación de ${perfilId}:`, err)
    }
  }

  return {
    porAsin,
    presion: presionVigente(config?.presion ?? {}, config?.presionFecha ?? null, local.fecha),
    campanasDeMarca,
    campanasConUbicacionAlta,
    sinSubidas,
    presupuestosLosHaceElAgente: true,
    bloqueadasPorEfecto: efectos.objetivos,
    campanasBloqueadasPorEfecto: efectos.campanas,
    subidasVetadas: Array.from(vetadas.objetivos),
    muestraMinimaClics: ficha.muestraMinimaClics,
    cuentaPequena: l.cuentaPequena,
  }
}
