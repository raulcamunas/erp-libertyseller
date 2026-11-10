/**
 * AMAZON ADS · EL MOTOR: DE LOS TÉRMINOS Y LA FICHA A LAS PROPUESTAS CONCRETAS. PURO.
 *
 * Aplica las reglas del SOP (reglas.ts) producto a producto, cada uno con SU ACoS objetivo (que sale de su coste), resuelve a qué campaña sube un término y descarta lo que ya se propuso o se
 * resolvió hace poco (la cuarentena de 14 días del SOP: «un cambio cada vez y con ventana de lectura»). No habla con Amazon ni con la base: quien llama le da los datos y la función `destino`.
 */

import { asinDeCampana } from './productos-agrupar'
import { partesDeNombre, proponerCambios, type ObjetivosParaReglas, type TipoDePropuesta, type UmbralesDeFicha } from './reglas'
import type { Rol } from './estructura'
import type { FilaDeTermino } from './terminos'

export interface DestinoDeCampana {
  campaignId: string
  nombre: string
  adGroupId: string | null
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
  metricas: { clics: number; gasto: number; pedidos: number; ventas: number; acosPct: number | null }
}

export interface PlanDelMotor {
  nuevas: PropuestaNueva[]
  /** Productos con términos pero sin coste puesto: no se les puede calcular el CPA objetivo y no se les propone nada */
  sinCoste: string[]
  /** Términos de campañas con la nomenclatura del SOP que se han evaluado */
  evaluados: number
  /** Propuestas descartadas por ya estar pendientes o resueltas hace poco */
  repetidas: number
}

const clave = (campaignId: string, termino: string, tipo: string) => `${campaignId}|${termino.trim().toLowerCase()}|${tipo}`

export function planificarPropuestas(a: {
  terminos: readonly FilaDeTermino[]
  umbrales: UmbralesDeFicha
  /** Por ASIN: el objetivo del producto, o null si le falta el coste */
  objetivos: ReadonlyMap<string, ObjetivosParaReglas | null>
  /** La campaña a la que sube un término de ese producto, o null si no existe */
  destino: (asin: string, rol: Rol) => DestinoDeCampana | null
  /** ¿Ya hay (o hubo hace poco) una propuesta así? */
  yaHay: (campaignId: string, termino: string, tipo: TipoDePropuesta) => boolean
}): PlanDelMotor {
  const porAsin = new Map<string, FilaDeTermino[]>()
  for (const t of a.terminos) {
    if (!partesDeNombre(t.campaignName)) continue // fuera de la nomenclatura: no se toca
    const asin = asinDeCampana(t.campaignName)
    if (!asin) continue
    const lista = porAsin.get(asin)
    if (lista) lista.push(t)
    else porAsin.set(asin, [t])
  }

  const nuevas: PropuestaNueva[] = []
  const sinCoste: string[] = []
  let evaluados = 0
  let repetidas = 0

  for (const [asin, terminos] of porAsin) {
    const objetivos = a.objetivos.get(asin)
    if (!objetivos) {
      sinCoste.push(asin)
      continue
    }
    evaluados += terminos.length
    // De dónde salió cada término (grupo de anuncios), para poder negativizar en el sitio exacto
    const origen = new Map(terminos.map((t) => [`${t.campaignId}|${t.termino.trim().toLowerCase()}`, t]))

    for (const p of proponerCambios(terminos, a.umbrales, objetivos)) {
      if (a.yaHay(p.campaignId, p.termino, p.tipo)) {
        repetidas += 1
        continue
      }
      const fila = origen.get(`${p.campaignId}|${p.termino.toLowerCase()}`)
      const destino = p.haciaRol ? a.destino(asin, p.haciaRol) : null
      nuevas.push({
        tipo: p.tipo,
        asin,
        termino: p.termino,
        campaignId: p.campaignId,
        campaignNombre: p.campaignName,
        adGroupId: fila?.adGroupId || null,
        desdeRol: p.desdeRol,
        haciaRol: p.haciaRol,
        haciaCampaignId: destino?.campaignId ?? null,
        haciaCampaignNombre: destino?.nombre ?? null,
        haciaAdGroupId: destino?.adGroupId ?? null,
        negativizarEnOrigen: p.negativizarEnOrigen,
        motivo: p.motivo,
        metricas: { clics: p.clics, gasto: p.gasto, pedidos: p.compras, ventas: fila?.ventas ?? 0, acosPct: p.acosPct },
      })
    }
  }
  return { nuevas, sinCoste, evaluados, repetidas }
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
  if (e.automatica && e.tipo !== 'negativizar') return { ok: false, motivo: 'El piloto automático solo negativiza: promover un término crea una keyword nueva y necesita aprobación.' }
  if (!e.fichaFirmada) return { ok: false, motivo: 'La ficha de cuenta no está firmada.' }
  if (!partesDeNombre(e.campaignNombre)) return { ok: false, motivo: 'Esa campaña no sigue la nomenclatura del SOP: el motor no la toca.' }
  if (e.estado !== 'pendiente' && e.estado !== 'aprobada' && e.estado !== 'error') return { ok: false, motivo: `Esa propuesta ya está ${e.estado}.` }
  if (e.tipo === 'promover' && (!e.haciaCampaignId || !e.haciaAdGroupId)) return { ok: false, motivo: `No se puede aplicar: este producto no tiene campaña ${e.haciaRol ?? 'de destino'} con un grupo de anuncios activo. Créala primero (pestaña «Crear campañas»).` }
  if (e.aplicadasHoy >= e.topeDiario) return { ok: false, motivo: `Tope diario alcanzado (${e.topeDiario} cambios ${e.automatica ? 'del piloto automático' : 'aplicados hoy'} en esta cuenta).` }
  return { ok: true }
}
