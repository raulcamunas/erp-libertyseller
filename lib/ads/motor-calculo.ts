/**
 * AMAZON ADS · EL MOTOR: DE LOS TÉRMINOS Y LA FICHA A LAS PROPUESTAS CONCRETAS. PURO.
 *
 * Aplica las reglas del SOP (reglas.ts) producto a producto, cada uno con SU ACoS objetivo (que sale de su coste), resuelve a qué campaña sube un término y descarta lo que ya se propuso o se
 * resolvió hace poco (la cuarentena de 14 días del SOP: «un cambio cada vez y con ventana de lectura»). No habla con Amazon ni con la base: quien llama le da los datos y la función `destino`.
 */

import { asinDeCampana } from './productos-agrupar'
import { esLaPropiaSegmentacion, partesDeNombre, proponerCambios, type ObjetivosParaReglas, type TerminoDeBusqueda, type TipoDePropuesta, type UmbralesDeFicha } from './reglas'
import type { Rol } from './estructura'
import type { FilaDeTermino } from './terminos'
import type { UmbralesEstimados } from './umbrales'

export interface DestinoDeCampana {
  campaignId: string
  nombre: string
  adGroupId: string | null
  /** El papel real de la campaña encontrada (se pide EXACTA / ESTABILIDAD y puede contestar la DOMINIO si es la única EXACTA del producto) */
  rol?: Rol
}

export interface PropuestaNueva {
  tipo: TipoDePropuesta
  asin: string
  termino: string
  campaignId: string
  campaignNombre: string
  adGroupId: string | null
  desdeRol: Rol | null
  haciaRol: Rol | null
  haciaCampaignId: string | null
  haciaCampaignNombre: string | null
  haciaAdGroupId: string | null
  negativizarEnOrigen: boolean
  motivo: string
  metricas: { clics: number; gasto: number; pedidos: number; ventas: number; acosPct: number | null; precioEstimado?: number; revisar?: boolean; cvrPct?: number }
  esAsin: boolean
}

export interface PlanDelMotor {
  nuevas: PropuestaNueva[]
  /** Productos con términos pero sin ACoS objetivo fijado (o sin precio): no se les puede calcular el CPA objetivo y no se les propone nada */
  sinObjetivo: string[]
  /** Términos de campañas con la nomenclatura del SOP que se han evaluado */
  evaluados: number
  /** Propuestas descartadas por ya estar pendientes o resueltas hace poco */
  repetidas: number
  /** Cosechas que no se proponen porque el término YA está como segmentación en la campaña de destino */
  yaCosechadas: number
}

/**
 * EL MISMO TÉRMINO EN VARIOS GRUPOS DE UNA CAMPAÑA SE JUZGA SUMADO. La negativa se pone en la campaña entera, así que lo que cuenta es lo que el término ha gastado en toda ella; antes se juzgaba solo
 * la primera fila que aparecía y un término repartido en dos grupos podía no llegar nunca al tope. Se queda el grupo donde más gastó (es donde se pone la negativa de un ASIN, que va por grupo).
 * `esSuSegmentacion` se marca si en ALGUNA de las filas el término es la propia keyword.
 */
export function sumarPorCampana(terminos: readonly FilaDeTermino[]): Array<FilaDeTermino & TerminoDeBusqueda> {
  const por = new Map<string, FilaDeTermino & TerminoDeBusqueda & { gastoDelGrupo: number }>()
  for (const t of terminos) {
    // Minúsculas sí (Amazon devuelve el término en minúsculas), tildes NO: «jamón» y «jamon» son búsquedas y negativas distintas
    const clave = `${t.campaignId}|${t.termino.trim().toLowerCase()}`
    const propia = esLaPropiaSegmentacion(t.termino, t.keyword)
    const x = por.get(clave)
    if (!x) {
      por.set(clave, { ...t, esSuSegmentacion: propia, gastoDelGrupo: t.gasto })
      continue
    }
    x.clics += t.clics
    x.gasto += t.gasto
    x.ventas += t.ventas
    x.compras += t.compras
    x.impresiones += t.impresiones
    x.esSuSegmentacion = Boolean(x.esSuSegmentacion || propia)
    if (t.gasto > x.gastoDelGrupo) {
      x.gastoDelGrupo = t.gasto
      x.adGroupId = t.adGroupId
      x.keyword = t.keyword
      x.matchType = t.matchType
    }
  }
  return [...por.values()].map(({ gastoDelGrupo: _g, ...resto }) => resto)
}

const clave = (campaignId: string, termino: string, tipo: string) => `${campaignId}|${termino.trim().toLowerCase()}|${tipo}`

export function planificarPropuestas(a: {
  terminos: readonly FilaDeTermino[]
  umbrales: UmbralesDeFicha
  /** Por ASIN: el objetivo del producto, o null si no tiene ACoS objetivo fijado */
  objetivos: ReadonlyMap<string, ObjetivosParaReglas | null>
  /** La campaña a la que sube un término de ese producto, o null si no existe */
  destino: (asin: string, rol: Rol) => DestinoDeCampana | null
  /** ¿Ya hay (o hubo hace poco) una propuesta así? */
  yaHay: (campaignId: string, termino: string, tipo: TipoDePropuesta) => boolean
  /** ¿El término ya está como segmentación en una campaña de ese rol de ese producto? (cosechar dos veces crea una keyword duplicada que Amazon rechaza o que compite consigo misma) */
  yaEsta?: (asin: string, rol: Rol, termino: string) => boolean
  /** Por ASIN, el precio estimado con el que se ha calculado su objetivo (si no tiene precio en su ficha). Se guarda en las métricas para que la pantalla lo marque como estimación */
  precioEstimado?: ReadonlyMap<string, number>
  /** El CVR de referencia de una campaña de ese producto */
  cvrDe?: (campaignId: string, asin: string) => number
  /** Las palabras que describen un producto (para la regla de irrelevantes) */
  palabrasDe?: (asin: string) => readonly string[]
  estimados?: UmbralesEstimados
}): PlanDelMotor {
  const porAsin = new Map<string, Array<FilaDeTermino & TerminoDeBusqueda>>()
  for (const t of sumarPorCampana(a.terminos)) {
    if (!partesDeNombre(t.campaignName)) continue // fuera de la nomenclatura: no se toca
    const asin = asinDeCampana(t.campaignName)
    if (!asin) continue
    const lista = porAsin.get(asin)
    if (lista) lista.push(t)
    else porAsin.set(asin, [t])
  }

  const nuevas: PropuestaNueva[] = []
  const sinObjetivo: string[] = []
  let evaluados = 0
  let repetidas = 0
  let yaCosechadas = 0

  for (const [asin, terminos] of porAsin) {
    const objetivos = a.objetivos.get(asin)
    if (!objetivos) {
      sinObjetivo.push(asin)
      continue
    }
    evaluados += terminos.length
    // De dónde salió cada término (grupo de anuncios), para poder negativizar en el sitio exacto
    const origen = new Map(terminos.map((t) => [`${t.campaignId}|${t.termino.trim().toLowerCase()}`, t]))

    const cvrDe = a.cvrDe ? (campaignId: string) => (a.cvrDe as NonNullable<typeof a.cvrDe>)(campaignId, asin) : undefined
    for (const p of proponerCambios(terminos, a.umbrales, objetivos, { cvrDe, palabrasDelProducto: a.palabrasDe?.(asin), estimados: a.estimados })) {
      if (a.yaHay(p.campaignId, p.termino, p.tipo)) {
        repetidas += 1
        continue
      }
      if (p.tipo === 'promover' && p.haciaRol && a.yaEsta?.(asin, p.haciaRol, p.termino)) {
        yaCosechadas += 1
        continue
      }
      const fila = origen.get(`${p.campaignId}|${p.termino.toLowerCase()}`)
      const destino = p.haciaRol ? a.destino(asin, p.haciaRol) : null
      const estimado = a.precioEstimado?.get(asin)
      nuevas.push({
        tipo: p.tipo,
        asin,
        termino: p.termino,
        campaignId: p.campaignId,
        campaignNombre: p.campaignName,
        adGroupId: fila?.adGroupId || null,
        desdeRol: p.desdeRol,
        haciaRol: destino?.rol ?? p.haciaRol,
        haciaCampaignId: destino?.campaignId ?? null,
        haciaCampaignNombre: destino?.nombre ?? null,
        haciaAdGroupId: destino?.adGroupId ?? null,
        negativizarEnOrigen: p.negativizarEnOrigen,
        motivo: p.motivo,
        metricas: { clics: p.clics, gasto: p.gasto, pedidos: p.compras, ventas: Math.round((fila?.ventas ?? 0) * 100) / 100, acosPct: p.acosPct, ...(estimado ? { precioEstimado: estimado } : {}), ...(p.revisar ? { revisar: true } : {}), ...(cvrDe ? { cvrPct: Math.round(cvrDe(p.campaignId) * 1000) / 10 } : {}) },
        esAsin: p.esAsin,
      })
    }
  }
  return { nuevas, sinObjetivo, evaluados, repetidas, yaCosechadas }
}

export { clave as claveDePropuesta }

/* ------------------------------------------------------------------ */
/* Los candados de «aplicar»                                           */
/* ------------------------------------------------------------------ */

export interface EntradaDeAplicar {
  modo: 'apagado' | 'sugiere' | 'aprueba' | 'autopiloto'
  /** ¿Lo aplica el piloto automático (y no una persona)? */
  automatica: boolean
  tipo: TipoDePropuesta
  estado: string
  fichaFirmada: boolean
  campaignNombre: string
  haciaRol: string | null
  haciaCampaignId: string | null
  haciaAdGroupId: string | null
  /** El grupo de anuncios de origen: la negativa de un ASIN se pone por grupo, no por campaña */
  adGroupId?: string | null
  /** El término es un ASIN */
  esAsin?: boolean
  /** Negativa por irrelevancia, marcada para revisar */
  revisar?: boolean
  aplicadasHoy: number
  topeDiario: number
}

/**
 * ¿SE PUEDE APLICAR ESTA PROPUESTA AHORA? Todos los candados en un sitio, sin tocar nada: lo comprueba el servidor SIEMPRE antes de escribir en Amazon (la pantalla solo lo enseña).
 * Devuelve el motivo en español si no.
 */
export function decidirSiSePuedeAplicar(e: EntradaDeAplicar): { ok: true } | { ok: false; motivo: string } {
  if (e.modo !== 'aprueba' && e.modo !== 'autopiloto') return { ok: false, motivo: 'La cuenta está en modo «solo sugiere» o apagada: enciende «Aprueba y aplica» para poder aplicar propuestas.' }
  if (e.automatica && e.modo !== 'autopiloto') return { ok: false, motivo: 'La cuenta no está en autopiloto.' }
  if (e.automatica && e.tipo !== 'negativizar') return { ok: false, motivo: 'El piloto automático solo negativiza: cosechar un término, pausar o cambiar pujas y presupuestos necesita aprobación.' }
  // Excluir un ASIN es una segmentación negativa por PRODUCTO (otra llamada a Amazon); hasta que se haya visto funcionar en una cuenta real, la aprueba siempre una persona
  if (e.automatica && e.revisar) return { ok: false, motivo: 'Un término marcado para revisar (sin relación aparente con el producto) lo decide siempre una persona.' }
  if (e.automatica && e.esAsin) return { ok: false, motivo: 'El piloto automático no excluye fichas de producto (ASIN): apruébalo a mano.' }
  if (!e.fichaFirmada) return { ok: false, motivo: 'La ficha de cuenta no está firmada.' }
  if (!partesDeNombre(e.campaignNombre)) return { ok: false, motivo: 'Esa campaña no sigue la nomenclatura del SOP: el motor no la toca.' }
  if (e.estado !== 'pendiente' && e.estado !== 'aprobada' && e.estado !== 'error') return { ok: false, motivo: `Esa propuesta ya está ${e.estado}.` }
  if (e.tipo === 'negativizar' && e.esAsin && !e.adGroupId) return { ok: false, motivo: 'No se sabe en qué grupo de anuncios apareció este ASIN: exclúyelo a mano en Amazon (segmentación negativa por productos).' }
  if (e.tipo === 'promover' && (!e.haciaCampaignId || !e.haciaAdGroupId)) return { ok: false, motivo: `No se puede aplicar: este producto no tiene campaña ${e.haciaRol ?? 'de destino'} con un grupo de anuncios activo. Créala primero (pestaña «Crear campañas»).` }
  if (e.aplicadasHoy >= e.topeDiario) return { ok: false, motivo: `Tope diario alcanzado (${e.topeDiario} cambios ${e.automatica ? 'del piloto automático' : 'aplicados hoy'} en esta cuenta).` }
  return { ok: true }
}
