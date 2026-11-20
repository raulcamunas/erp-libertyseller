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

/**
 * LA CUARENTENA de generarPropuestas: lo pendiente y lo resuelto desde `desde` (las caducadas no cuentan) → claves «campaña|término|tipo» que no se vuelven a proponer.
 * Una ENSAYADA (el agente en ensayo) lleva resuelta_at, así que cuenta igual que una aplicada: en ensayo no se repite cada día lo mismo. Al pasar a activo se le
 * quita resuelta_at (estado-servidor, sacarEnsayadasDeLaCuarentena) y deja de contar: lo que el ensayo vio necesario se vuelve a proponer y se aplica.
 */
export function clavesEnCuarentena(previas: ReadonlyArray<{ campaign_id: string; termino: string; tipo: string; estado: string; resuelta_at?: string | null }>, desde: string): Set<string> {
  return new Set(previas.filter((r) => r.estado !== 'caducada' && (r.estado === 'pendiente' || (r.resuelta_at ?? '') >= desde)).map((r) => clave(r.campaign_id, r.termino, r.tipo)))
}

/* ------------------------------------------------------------------ */
/* Los candados de «aplicar»                                           */
/* ------------------------------------------------------------------ */

export interface EntradaDeAplicar {
  modo: 'apagado' | 'sugiere' | 'aprueba' | 'autopiloto' | 'agente'
  /** ¿Lo aplica el piloto automático o el agente (y no una persona)? */
  automatica: boolean
  /** 'agente' = lo aplica el agente PPC (exige el modo «agente») */
  origen?: 'agente'
  /** Un término «Revisar» que la IA del agente ha clasificado con confianza (otro producto, intención mala): el agente puede negativizarlo */
  revisarAprobadoPorIa?: boolean
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
  if (e.modo !== 'aprueba' && e.modo !== 'autopiloto' && e.modo !== 'agente') return { ok: false, motivo: 'La cuenta está en modo «solo sugiere» o apagada: enciende «Aprueba y aplica» para poder aplicar propuestas.' }
  if (e.automatica && e.origen === 'agente') {
    // EL AGENTE PPC: solo en modo agente. Aplica todo tipo de cambio (sus topes, rampa y guardarraíles van fuera, en aplicar-servidor), salvo un «Revisar» que la IA no haya aprobado
    if (e.modo !== 'agente') return { ok: false, motivo: 'La cuenta no está en modo agente: el agente PPC no aplica nada.' }
    if (e.revisar && !e.revisarAprobadoPorIa) return { ok: false, motivo: 'Un término marcado para revisar solo lo aplica el agente si la IA lo ha clasificado con confianza; si no, lo decide una persona.' }
  } else {
    if (e.automatica && e.modo !== 'autopiloto') return { ok: false, motivo: 'La cuenta no está en autopiloto.' }
    if (e.automatica && e.tipo !== 'negativizar') return { ok: false, motivo: 'El piloto automático solo negativiza: cosechar un término, pausar o cambiar pujas y presupuestos necesita aprobación.' }
    // Excluir un ASIN es una segmentación negativa por PRODUCTO (otra llamada a Amazon); hasta que se haya visto funcionar en una cuenta real, la aprueba siempre una persona
    if (e.automatica && e.revisar) return { ok: false, motivo: 'Un término marcado para revisar (sin relación aparente con el producto) lo decide siempre una persona.' }
    if (e.automatica && e.esAsin) return { ok: false, motivo: 'El piloto automático no excluye fichas de producto (ASIN): apruébalo a mano.' }
  }
  if (!e.fichaFirmada) return { ok: false, motivo: 'La ficha de cuenta no está firmada.' }
  if (!partesDeNombre(e.campaignNombre)) return { ok: false, motivo: 'Esa campaña no sigue la nomenclatura del SOP: el motor no la toca.' }
  if (e.estado !== 'pendiente' && e.estado !== 'aprobada' && e.estado !== 'error') return { ok: false, motivo: `Esa propuesta ya está ${e.estado}.` }
  if (e.tipo === 'negativizar' && e.esAsin && !e.adGroupId) return { ok: false, motivo: 'No se sabe en qué grupo de anuncios apareció este ASIN: exclúyelo a mano en Amazon (segmentación negativa por productos).' }
  if (e.tipo === 'promover' && (!e.haciaCampaignId || !e.haciaAdGroupId)) return { ok: false, motivo: `No se puede aplicar: este producto no tiene campaña ${e.haciaRol ?? 'de destino'} con un grupo de anuncios activo. Créala primero (pestaña «Crear campañas»).` }
  if (e.aplicadasHoy >= e.topeDiario) return { ok: false, motivo: `Tope diario alcanzado (${e.topeDiario} cambios ${e.automatica ? (e.origen === 'agente' ? 'del agente' : 'del piloto automático') : 'aplicados hoy'} en esta cuenta).` }
  return { ok: true }
}

/**
 * EL ENSAYO: los mismos candados, salvo los que solo protegen la ESCRITURA (el modo, la ficha firmada y el tope diario), que se devuelven como avisos. Un ensayo no
 * escribe nada en Amazon, y sirve justo para probar el camino antes de firmar la ficha y encender el modo que aplica.
 */
export function decidirEnsayo(e: EntradaDeAplicar): { ok: true; avisos: string[] } | { ok: false; motivo: string } {
  const avisos: string[] = []
  if (e.modo !== 'aprueba' && e.modo !== 'autopiloto' && e.modo !== 'agente') avisos.push('De verdad no se podría aplicar todavía: la cuenta está en «solo sugiere» o apagada.')
  if (!e.fichaFirmada) avisos.push('De verdad no se podría aplicar todavía: la ficha de cuenta no está firmada.')
  if (e.aplicadasHoy >= e.topeDiario) avisos.push(`Hoy ya se ha llegado al tope diario (${e.topeDiario}).`)
  const r = decidirSiSePuedeAplicar({ ...e, modo: 'aprueba', automatica: false, fichaFirmada: true, aplicadasHoy: 0 })
  return r.ok ? { ok: true, avisos } : r
}

/* ------------------------------------------------------------------ */
/* Antes de aplicar una puja o un presupuesto: ¿sigue igual en Amazon? */
/* ------------------------------------------------------------------ */

/**
 * La puja de partida de lo cosechado (promover): el CPC que ya pagaba (gasto ÷ clics), o 0,20 sin clics. Con `pujaMaxima` (el agente) nunca pasa de ella.
 * null si no se puede calcular (gasto o clics que no son números, o un tope inválido): quien llama no crea nada.
 */
export function pujaDePromover(metricas: { clics?: unknown; gasto?: unknown } | null | undefined, pujaMaxima?: number | null): number | null {
  const clics = Number(metricas?.clics ?? 0)
  const gasto = Number(metricas?.gasto ?? 0)
  if (!Number.isFinite(clics) || !Number.isFinite(gasto)) return null
  const cpc = clics > 0 ? gasto / clics : 0.2
  if (!Number.isFinite(cpc) || !(cpc > 0)) return null
  if (pujaMaxima != null) {
    if (!Number.isFinite(pujaMaxima) || !(pujaMaxima > 0)) return null
    return Math.min(cpc, pujaMaxima)
  }
  return cpc
}

/* ------------------------------------------------------------------ */
/* Reintentos tras un fallo de transporte al ESCRIBIR                   */
/* ------------------------------------------------------------------ */

/** El prefijo del `error` de una propuesta que volvió a pendiente tras un fallo de transporte (aplicar-servidor: volverAPendiente) */
export const PREFIJO_REINTENTO = 'Reintento (Amazon no ha contestado)'

/**
 * PURO. El texto del `error` de un reintento; con el valor que se intentó escribir (puja/presupuesto) para reconocerlo luego en Amazon. `veces` (desde 2) va
 * como «[n]» justo tras los dos puntos: cuántas veces seguidas ha vuelto por transporte (vecesDeReintento), sin tocar lo que leen valorIntentadoDelReintento
 * y esReintentoDeTransporte.
 */
export function textoDeReintento(error: string, valorIntentado: number | null, veces?: number): string {
  const intentado = valorIntentado != null && Number.isFinite(valorIntentado) ? ` · intentado ${Math.round(valorIntentado * 100) / 100}` : ''
  const cuenta = veces != null && veces > 1 ? `[${Math.floor(veces)}] ` : ''
  return `${PREFIJO_REINTENTO}${intentado}: ${cuenta}${error}`.slice(0, 500)
}

/** PURO. Cuántas veces seguidas ha vuelto la propuesta por un fallo de transporte: 0 si no es un reintento; la marca «[n]» o 1 sin ella */
export function vecesDeReintento(error: string | null | undefined): number {
  if (!esReintentoDeTransporte(error)) return 0
  const m = /^Reintento \(Amazon no ha contestado\)(?: · intentado -?\d+(?:\.\d+)?)?: \[(\d+)\] /.exec(error as string)
  return m ? Number(m[1]) : 1
}

/** Reintentos SEGUIDOS por transporte (sin contar los 429) a partir de los cuales una propuesta se retiene para una persona */
export const MAX_REINTENTOS_DE_TRANSPORTE = 3

/**
 * PURO. Una propuesta del agente vuelve a fallar por transporte: ¿cuántas veces lleva y se retiene ya? Un error POR ELEMENTO desconocido de un 207 cuenta como
 * transporte (clasificarErrorDeAmazon); si es persistente, la misma escritura se repetía cada pasada sin contar como error. Tras MAX_REINTENTOS_DE_TRANSPORTE
 * seguidos se retiene (protección técnica, no un freno). Un 429 no suma: Amazon la rechazó sin aplicarla y se espera que pase.
 */
export function siguienteReintento(errorPrevio: string | null | undefined, httpStatus: number | null): { veces: number; retener: boolean } {
  const antes = vecesDeReintento(errorPrevio)
  const veces = httpStatus === 429 ? Math.max(antes, 1) : antes + 1
  return { veces, retener: veces >= MAX_REINTENTOS_DE_TRANSPORTE && httpStatus !== 429 }
}

/** PURO. ¿La propuesta viene de un reintento por transporte? */
export function esReintentoDeTransporte(error: string | null | undefined): boolean {
  return typeof error === 'string' && error.startsWith(PREFIJO_REINTENTO)
}

/** PURO. El valor que se intentó escribir en el intento que falló (null si no consta) */
export function valorIntentadoDelReintento(error: string | null | undefined): number | null {
  if (!esReintentoDeTransporte(error)) return null
  const m = /^Reintento \(Amazon no ha contestado\) · intentado (-?\d+(?:\.\d+)?):/.exec(error as string)
  return m ? Number(m[1]) : null
}

/**
 * PURO. Puja o presupuesto: el valor releído en Amazon ya NO es el de partida. Si la propuesta viene de un reintento por transporte y lo que hay es lo que el
 * agente intentó escribir (el `intentado` del error, o el valor nuevo de ahora), el cambio SÍ llegó a Amazon: se resuelve como «aplicada» (cuenta en topes,
 * abre su efecto, el freno lo puede deshacer), no como obsoleta. Si no consta el valor de partida, no se puede deshacer: no se confirma.
 */
export function confirmaReintento(p: { error: string | null; valorActual: number | null; valorNuevo: number | null }, valorAhora: number | null): boolean {
  if (!esReintentoDeTransporte(p.error) || p.valorActual == null || valorAhora == null) return false
  if (valorSigueIgual(p.valorActual, valorAhora)) return false
  const intentado = valorIntentadoDelReintento(p.error)
  return (intentado != null && valorSigueIgual(intentado, valorAhora)) || (p.valorNuevo != null && valorSigueIgual(p.valorNuevo, valorAhora))
}

/** PURO. Pausa de campaña o de anuncio: tras un reintento por transporte, si ya está PAUSED es que la pausa llegó → «aplicada» (no obsoleta) */
export function confirmaPausaDeReintento(error: string | null, estadoAhora: string | null): boolean {
  return esReintentoDeTransporte(error) && estadoAhora === 'PAUSED'
}

/**
 * PURO. El `error` con que se LIBERA una propuesta cuando falla la relectura de Amazon. Si venía de un reintento por transporte, se conserva el prefijo y el valor
 * intentado: si no, confirmaReintento ya no la reconocería y un cambio que SÍ llegó a Amazon acabaría «obsoleta», fuera de topes, efecto y deshacer.
 */
export function errorAlLiberar(errorPrevio: string | null | undefined, detalle: string): string {
  return (esReintentoDeTransporte(errorPrevio) ? textoDeReintento(detalle, valorIntentadoDelReintento(errorPrevio)) : detalle).slice(0, 500)
}

/**
 * PURO. Pausar una keyword o una segmentación por producto con el estado releído en Amazon: si es un reintento y ya está pausada, la pausa llegó (confirmar);
 * si no está activa (pausada a mano, archivada, no existe), obsoleta sin escribir; si está activa, se pausa.
 */
export function decidirPausaDeSegmentacion(estadoAhora: string | null, error: string | null): 'aplicar' | 'obsoleta' | 'confirmar' {
  if (confirmaPausaDeReintento(error, estadoAhora)) return 'confirmar'
  return estadoAhora === 'ENABLED' ? 'aplicar' : 'obsoleta'
}

/**
 * PURO. Deshacer la pausa de una segmentación (reactivarla): solo si sigue PAUSED y si lo que el motor pausó estaba activo. Las propuestas antiguas, sin
 * `estadoAnterior`, cuentan como activas (el motor solo las pausaba así).
 */
export function puedeReactivarPausa(estadoAhora: string | null, estadoAnterior: unknown): boolean {
  if (estadoAhora !== 'PAUSED') return false
  return estadoAnterior == null || estadoAnterior === 'ENABLED'
}

/* ------------------------------------------------------------------ */
/* Cosechas: creado a medias, conciliación y deshacer                  */
/* ------------------------------------------------------------------ */

/** Lo que una cosecha o una negativa ha dejado en Amazon (los ids) y en qué punto se quedó */
export interface CreadoDeCosecha {
  keywordId?: string
  targetId?: string
  negativaId?: string
  negativaProductoId?: string
  /** Quedó algo creado a medias (o no se sabe si se creó): al reanudar se CONCILIA con Amazon antes de crear nada */
  incompleta?: boolean
  /** La keyword o segmentación está creada y falta (o no se sabe si está) la negativa en origen */
  negativaPendiente?: boolean
  /** Al deshacer: los ids que ya se han borrado (un reintento se los salta) */
  borrados?: string[]
}

const CAMPOS_DE_ID = ['negativaId', 'negativaProductoId', 'keywordId', 'targetId'] as const

/** PURO. El `aplicada` guardado → lo creado (solo los campos conocidos y bien formados) */
export function leerCreado(aplicada: unknown): CreadoDeCosecha {
  const a = aplicada && typeof aplicada === 'object' ? (aplicada as Record<string, unknown>) : {}
  const c: CreadoDeCosecha = {}
  for (const k of CAMPOS_DE_ID) if (typeof a[k] === 'string' && a[k] !== '') c[k] = a[k] as string
  if (a.incompleta === true) c.incompleta = true
  if (a.negativaPendiente === true) c.negativaPendiente = true
  if (Array.isArray(a.borrados)) c.borrados = a.borrados.filter((x): x is string => typeof x === 'string')
  return c
}

/** PURO. ¿Hay que REANUDAR la cosecha (conciliar con Amazon en vez de crear a ciegas)? */
export function hayQueReanudar(c: CreadoDeCosecha): boolean {
  return Boolean(c.incompleta || c.negativaPendiente)
}

/**
 * PURO. La clase de un fallo al ESCRIBIR en Amazon, para decidir si se compensa (se borra lo creado) o se concilia. Transporte = Amazon no ha dicho que no
 * (red, tiempo agotado, 429, 5xx, «throttled» dentro de un 207): lo pedido puede haber llegado. Autorización = 401/403. Lo demás, validación (Amazon dijo que no).
 * Lo pasajero dentro de un 2xx/207 es lo mismo que reconoce clasificarErrorDeAmazon (RE_207_TRANSPORTE): un cuerpo ILEGIBLE (llamarAds: el cambio pudo llegar),
 * internalServerError / INTERNAL_ERROR, SERVICE_UNAVAILABLE o TEMPORARY. Antes eran «validación» y la cosecha se COMPENSABA: se borraba la exacta mientras la
 * negativa en origen sí había quedado puesta (el término, negativizado en el origen y sin exacta).
 */
export function claseDeFalloAlEscribir(estado: number | null | undefined, mensaje: string): 'transporte' | 'autorizacion' | 'validacion' {
  if (estado === 401 || estado === 403) return 'autorizacion'
  if (estado === 429 || (estado != null && estado >= 500)) return 'transporte'
  if (/throttl|tiempo agotado|timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network|socket|abort/i.test(mensaje)) return 'transporte'
  if (/ilegible|internal.?(server.?)?error|service.?unavailable|temporar/i.test(mensaje)) return 'transporte'
  return 'validacion'
}

/** PURO. ¿Es un DUPLICATE de Amazon («ya existe»)? */
export function esDuplicado(mensaje: string): boolean {
  return /duplicate|already_?exists/i.test(mensaje)
}

/**
 * PURO. Una cosecha (o negativa) que falla a mitad: ¿se CONCILIA (se mira en Amazon qué hay, sin borrar nada) o se COMPENSA (se borra lo creado)?
 *   - La negativa falla por transporte (red, 5xx, 429, tiempo) o con DUPLICATE: puede estar puesta → conciliar. Borrar la exacta dejaría el término
 *     negativizado en el origen y sin exacta: el mejor término dejaría de vender.
 *   - La creación de la keyword o segmentación falla por transporte: puede estar creada → conciliar (al reanudar se busca antes de crearla otra vez).
 *   - Un error de validación cierto (o de autorización): no se ha creado lo que fallaba → compensar lo de antes.
 */
export function decidirCompensacion(e: { paso: 'crear' | 'negativa'; tipoDeFallo: 'transporte' | 'autorizacion' | 'validacion'; duplicado: boolean }): 'conciliar' | 'compensar' {
  if (e.tipoDeFallo === 'transporte') return 'conciliar'
  if (e.paso === 'negativa' && e.duplicado) return 'conciliar'
  return 'compensar'
}

/**
 * PURO. Deshacer una cosecha: qué se borra y en qué orden. PRIMERO la negativa en origen y DESPUÉS la keyword o segmentación: si falla a mitad, el término
 * queda en las dos campañas (como antes de cosechar) y no negativizado en el origen y sin exacta. Se saltan los ids que ya se borraron en un intento anterior.
 */
export function ordenDeBorrado(c: CreadoDeCosecha): Array<{ campo: (typeof CAMPOS_DE_ID)[number]; id: string }> {
  const hechos = new Set(c.borrados ?? [])
  const salida: Array<{ campo: (typeof CAMPOS_DE_ID)[number]; id: string }> = []
  for (const campo of CAMPOS_DE_ID) {
    const id = c[campo]
    if (id && !hechos.has(id)) salida.push({ campo, id })
  }
  return salida
}

/* ------------------------------------------------------------------ */
/* Reservas colgadas («aplicando» de un proceso que murió a mitad)     */
/* ------------------------------------------------------------------ */

export type RutaDeReservaColgada =
  /** Era un DESHACER (la propuesta ya estaba aplicada): vuelve a «aplicada» */
  | { a: 'aplicada'; error: string }
  /** Del agente: vuelve a pendiente como un reintento; la pasada siguiente relee Amazon (o concilia la cosecha) antes de escribir */
  | { a: 'pendiente'; error: string; conciliar: boolean }
  /** De una persona: «error» para que lo revise (probablemente aplicada). Una cosecha se marca para CONCILIAR: si la vuelve a aplicar, se busca en Amazon antes de crear */
  | { a: 'error'; error: string; conciliar: boolean }
  /** Todavía no lleva bastante: no se toca */
  | { a: 'nada' }

/**
 * PURO. Qué hacer con una propuesta que lleva más de `minutos` en reserva («aplicando»/«aprobada»): el proceso que la reclamó murió entre la llamada a Amazon y
 * guardar el resultado (cada despliegue reinicia el contenedor). El cambio puede estar en Amazon sin efecto, sin deshacer y sin contar en los topes.
 * Quién la RESERVÓ se decide por la reserva, no por quién la creó: `origen` solo pasa a 'agente' al guardar el resultado, y casi todo lo que aplica el agente
 * (pujas, pausas, negativas y cosechas del motor) lleva origen 'motor' mientras está «aplicando». reclamar() pone resuelta_por = la persona que aplica, y null
 * cuando aplica una máquina (el agente o el autopiloto): esas vuelven a pendiente como reintento. `resueltaPor` undefined = no se sabe (solo cuenta el origen).
 */
export function rutaDeReservaColgada(
  f: { tipo: string; origen: string | null; aplicada: unknown; valorNuevo: number | null; resueltaAt: string | null; resueltaPor?: string | null },
  ahora: number,
  minutos: number,
): RutaDeReservaColgada {
  const t = f.resueltaAt ? Date.parse(f.resueltaAt) : NaN
  // Sin fecha de reserva no se sabe cuánto lleva: se trata como colgada (nadie la reclama sin poner resuelta_at)
  if (Number.isFinite(t) && ahora - t < minutos * 60_000) return { a: 'nada' }
  const creado = leerCreado(f.aplicada)
  const esDeshacer = f.aplicada != null && typeof f.aplicada === 'object' && !hayQueReanudar(creado) && (f.aplicada as Record<string, unknown>).ensayo !== true
  if (esDeshacer) return { a: 'aplicada', error: 'Deshacer interrumpido (el proceso se cortó a mitad): revisa en Amazon si se llegó a deshacer.' }
  const cosecha = f.tipo === 'promover' || f.tipo === 'negativizar'
  const deUnaMaquina = f.origen === 'agente' || f.resueltaPor === null
  if (!deUnaMaquina) return { a: 'error', error: 'Reserva abandonada (el proceso se cortó a mitad): probablemente aplicada en Amazon, revísala antes de volver a aplicarla.', conciliar: cosecha }
  const valor = f.tipo === 'puja' || f.tipo === 'presupuesto' ? f.valorNuevo : null
  return { a: 'pendiente', error: textoDeReintento('reserva abandonada (el proceso se cortó a mitad; puede estar aplicada en Amazon)', valor), conciliar: cosecha }
}

/* ------------------------------------------------------------------ */
/* Generar: destino activo, negativas que ya no tocan, lecturas topadas */
/* ------------------------------------------------------------------ */

/**
 * PURO. La campaña a la que se cosecha un término: la ESTABILIDAD del producto y, si no la tiene ACTIVA, la DOMINIO. Una campaña PAUSADA nunca es destino: la
 * keyword se crearía sin tráfico mientras la negativa en el origen activo le quita el suyo (el término no saldría en ninguna). Sin ninguna activa, null.
 */
export function elegirDestino(porAsinYRol: ReadonlyMap<string, DestinoDeCampana & { activa: boolean }>, asin: string, rol: Rol): DestinoDeCampana | null {
  const opciones: Rol[] = rol === 'MANUAL EXACTA / ESTABILIDAD' ? ['MANUAL EXACTA / ESTABILIDAD', 'MANUAL EXACTA / DOMINIO'] : [rol]
  for (const r of opciones) {
    const d = porAsinYRol.get(`${asin}|${r}`)
    if (d && d.activa) return { campaignId: d.campaignId, nombre: d.nombre, adGroupId: null, rol: r }
  }
  return null
}

/**
 * PURO. Las negativas PENDIENTES que ya no tocan con los términos de ahora: el término ha empezado a vender en esa campaña (la regla de negativizar exige
 * cero pedidos y cero ventas), o hay una cosecha (promover) del mismo término en la misma campaña, que ya pone su propia negativa en origen.
 * Nunca las que vuelven de un intento cortado (reintento por transporte, o `aplicada` a medias): su negativa puede estar YA en Amazon, y caducada quedaría viva
 * sin propuesta que la mida ni la deshaga. Esas las decide aplicar (decisionDeReintento las retiene para una persona o las concilia).
 */
export function negativasACaducar(
  pendientes: ReadonlyArray<{ id: string; campaign_id: string; termino: string; error?: string | null; aplicada?: unknown }>,
  terminos: readonly FilaDeTermino[],
  promover: ReadonlyArray<{ campaignId: string; termino: string }>,
): Array<{ id: string; motivo: string }> {
  const k = (c: string, t: string) => `${c}|${t.trim().toLowerCase()}`
  const venta = new Map<string, { compras: number; ventas: number }>()
  for (const t of terminos) {
    const x = venta.get(k(t.campaignId, t.termino)) ?? { compras: 0, ventas: 0 }
    x.compras += Number(t.compras) || 0
    x.ventas += Number(t.ventas) || 0
    venta.set(k(t.campaignId, t.termino), x)
  }
  const cosechas = new Set(promover.map((p) => k(p.campaignId, p.termino)))
  const salida: Array<{ id: string; motivo: string }> = []
  for (const n of pendientes) {
    if (esReintentoDeTransporte(n.error ?? null) || hayQueReanudar(leerCreado(n.aplicada))) continue
    const v = venta.get(k(n.campaign_id, n.termino))
    if (v && (v.compras > 0 || v.ventas > 0)) salida.push({ id: n.id, motivo: `el término ya vende en esta campaña (${v.compras} pedidos): no se negativiza` })
    else if (cosechas.has(k(n.campaign_id, n.termino))) salida.push({ id: n.id, motivo: 'hay una cosecha del mismo término en esta campaña, que ya pone su negativa en origen' })
  }
  return salida
}

/**
 * Lee por páginas de 1.000 hasta `tope` filas. Si llega al tope LANZA en vez de devolver un conjunto a medias: una lectura cortada parece completa y
 * esconde justo lo que falta (con orden ascendente, los días recientes: cosechas duplicadas).
 */
export async function leerHastaElTope<T>(pedir: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>, tope: number): Promise<T[]> {
  const salida: T[] = []
  for (let i = 0; ; i += 1000) {
    if (i >= tope) throw new Error(`La lectura llega al tope de ${tope} filas: no se usa a medias.`)
    const { data, error } = await pedir(i, i + 999)
    if (error) throw error
    salida.push(...(data ?? []))
    if (!data || data.length < 1000) return salida
  }
}

/**
 * PURO. Qué hacer con una propuesta del agente cuya ESCRITURA ha fallado por transporte:
 *   - 429: Amazon la ha rechazado sin aplicarla → pendiente (se reintenta en la pasada siguiente).
 *   - puja, presupuesto, pausas: pendiente; la pasada siguiente RELEE Amazon antes de escribir y, si ya está el valor, la confirma (confirmaReintento).
 *   - promover / negativizar con tiempo agotado, red o 5xx: puede estar CREADA en Amazon; reintentar a ciegas daría DUPLICATE y la dejaría viva sin
 *     propuesta «aplicada» que la deshaga → se retiene para una persona.
 */
export function queHacerTrasFalloDeTransporte(tipo: string, httpStatus: number | null): 'reintentar' | 'retener' {
  if (httpStatus === 429) return 'reintentar'
  if (tipo === 'promover' || tipo === 'negativizar') return 'retener'
  return 'reintentar'
}

/** ¿El valor de AHORA en Amazon es el que tenía la propuesta? (al céntimo). Sin valor de partida guardado no se puede comprobar: se da por bueno */
export function valorSigueIgual(esperado: number | null, actual: number | null): boolean {
  if (esperado == null) return true
  if (actual == null) return false
  return Math.round(esperado * 100) === Math.round(actual * 100)
}

const euros = (n: number | null) => (n == null ? '—' : n.toFixed(2).replace('.', ','))

/** El motivo legible de una propuesta que se queda obsoleta porque alguien cambió el valor en Amazon (o ya no existe) */
export function motivoDeObsoleta(tipo: 'puja' | 'presupuesto', esperado: number | null, actual: number | null): string {
  const que = tipo === 'puja' ? 'la puja' : 'el presupuesto diario'
  if (actual == null) return `Amazon ya no encuentra ${tipo === 'puja' ? 'esa segmentación' : 'esa campaña'}: la propuesta queda obsoleta y no se aplica.`
  return `En Amazon ${que} ya es ${euros(actual)} (la propuesta partía de ${euros(esperado)}): alguien lo ha cambiado después. No se pisa; el motor volverá a proponer con el valor nuevo.`
}

/* ------------------------------------------------------------------ */
/* El proceso de fondo: ¿tiene trabajo esta cuenta?                    */
/* ------------------------------------------------------------------ */

/** ¿Hay un informe de términos recogido después de la última generación de propuestas? Sin generado_at (nunca se generó) y con informe, sí */
export function tocaGenerar(ultimoOkAt: string | null, generadoAt: string | null): boolean {
  if (!ultimoOkAt) return false
  if (!generadoAt) return true
  return Date.parse(ultimoOkAt) > Date.parse(generadoAt)
}

export interface EstadoDeCuentaDelMotor {
  modo: string
  /** El informe de términos pedido y sin recoger */
  esperandoTerminos: boolean
  /** Toca pedir el informe de términos (lo dice debeEmpezar) */
  tocaPedirTerminos: boolean
  /** Hay un informe recogido sin propuestas generadas (tocaGenerar) */
  tocaGenerar: boolean
  /** Negativas pendientes (lo único que aplica el autopiloto) */
  negativasPendientes: boolean
  /** Lo que el autopiloto lleva aplicado hoy y su tope */
  aplicadasHoyAuto: number
  topeAuto: number
}

/**
 * PURO. ¿Tiene ESTA cuenta algo que hacer en esta pasada del proceso? Antes, una cuenta en «sugiere» con negativas pendientes contaba como trabajo y abría una fila
 * del registro cada 2 minutos para nada (717 al día). Las pendientes solo son trabajo en AUTOPILOTO y con tope por gastar. En modo AGENTE, como en «aprueba»: las
 * pendientes las aplica el agente PPC desde su propio proceso (cron-agente), no este.
 */
export function motorTieneTrabajo(e: EstadoDeCuentaDelMotor): boolean {
  if (e.modo === 'apagado') return false
  if (e.esperandoTerminos || e.tocaPedirTerminos || e.tocaGenerar) return true
  return e.modo === 'autopiloto' && e.negativasPendientes && e.aplicadasHoyAuto < e.topeAuto
}

/** PURO. ¿Ha hecho algo un paso del motor? Si no (solo «Amazon sigue preparando el informe»), el proceso no abre fila en el registro */
export function pasoHizoAlgo(p: { terminos: string; generado: boolean; nuevas: number; aplicadas: number; fallidas: number; errores: readonly string[] }): boolean {
  return p.terminos === 'pedido' || p.terminos === 'guardado' || p.terminos === 'error' || p.generado || p.nuevas > 0 || p.aplicadas > 0 || p.fallidas > 0 || p.errores.length > 0
}

/** El comienzo del día de HOY en España (el tope diario se cuenta desde la medianoche de Madrid, no la UTC), como ISO */
export function inicioDelDiaEnEspana(ahora: number): string {
  const partes = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date(ahora))
  const v = (t: string) => Number(partes.find((x) => x.type === t)?.value ?? 0)
  // Lo que lleva el día de Madrid (h:m:s) se resta de ahora: así sale la medianoche de Madrid sin calcular el horario de verano
  const transcurrido = ((v('hour') % 24) * 3600 + v('minute') * 60 + v('second')) * 1000 + (ahora % 1000)
  return new Date(ahora - transcurrido).toISOString()
}

/**
 * PURO. Qué va a hacer el motor a continuación, en una frase para la pantalla, y cuándo (si se sabe).
 */
export function proximoPasoDelMotor(e: { modo: string; terminosAt: string | null; generadoAt: string | null; esperandoInforme: boolean; hayGeneradoAt: boolean; intervaloMs: number; ahora: number }): { texto: string; cuando: string | null } {
  if (e.modo === 'apagado') return { texto: 'El motor está apagado: no lee términos ni propone nada.', cuando: null }
  if (e.esperandoInforme) return { texto: `Amazon está preparando el informe de términos; el proceso de fondo lo recoge y genera las propuestas en cuanto esté${e.modo === 'agente' ? ' (y el agente PPC las aplica solo)' : ''}.`, cuando: null }
  if (e.hayGeneradoAt && tocaGenerar(e.terminosAt, e.generadoAt)) return { texto: 'Hay un informe de términos nuevo: el proceso de fondo genera las propuestas en la próxima pasada (cada 2 minutos).', cuando: null }
  if (!e.terminosAt) return { texto: 'Todavía no hay informe de términos: el proceso de fondo lo pide en la próxima pasada.', cuando: null }
  const siguiente = Date.parse(e.terminosAt) + e.intervaloMs
  const texto =
    e.modo === 'autopiloto'
      ? 'Siguiente lectura de términos y propuestas; mientras, el autopiloto aplica negativas hasta su tope diario.'
      : e.modo === 'agente'
        ? 'Siguiente lectura de términos y propuestas; el agente PPC las aplica solo, con sus topes (pestaña «Agente»).'
        : 'Siguiente lectura de términos y propuestas.'
  return { texto, cuando: new Date(Math.max(siguiente, e.ahora)).toISOString() }
}

/* ------------------------------------------------------------------ */
/* Caché de «¿está la columna de la migración?»                         */
/* ------------------------------------------------------------------ */

/** Un `false` (falta la columna) se vuelve a mirar pasado esto: así se nota la migración recién lanzada sin redesplegar */
export const RECOMPROBAR_COLUMNA_MS = 5 * 60_000
export interface CacheDeColumna { valor: boolean | null; at: number }
/** Códigos de columna o tabla inexistente (PostgREST y Postgres) */
const CODIGOS_DE_ESQUEMA = new Set(['PGRST204', '42703', 'PGRST205', '42P01'])

/** ¿Hay que volver a preguntar a la base? `true` se recuerda siempre; `false` caduca; sin dato, sí */
export function hayQueComprobarColumna(c: CacheDeColumna, ahora: number): boolean {
  if (c.valor === true) return false
  if (c.valor === null) return true
  return ahora - c.at >= RECOMPROBAR_COLUMNA_MS
}

/** Qué guardar tras consultar la columna. Un error que NO es de esquema (red, tiempo agotado…) se relanza y no se guarda nada */
export function resultadoDeComprobarColumna(error: { code?: string; message?: string } | null, ahora: number): CacheDeColumna {
  if (!error) return { valor: true, at: ahora }
  if (error.code && CODIGOS_DE_ESQUEMA.has(error.code)) return { valor: false, at: ahora }
  throw new Error(error.message ?? 'Error de la base de datos al comprobar las columnas de ads_propuestas')
}

/**
 * PURO. Las pujas y pausas PENDIENTES de la generación diaria del motor que hay que caducar ANTES de volver a generar (modo agente): se calcularon con la ventana de métricas de otro día y, mientras
 * siguen pendientes, bloquean la segmentación (no se recalcula). Caducadas, la misma generación las vuelve a calcular con la ventana de hoy, así que nada se queda un día sin propuesta.
 * No se tocan las retenidas (las mira una persona) ni los reintentos de transporte (su cambio puede estar ya en Amazon).
 */
export function pujasDelMotorACaducar(
  filas: ReadonlyArray<{ id: string; tipo: string; origen?: string | null; retenida_at?: string | null; error: string | null; creada_at: string }>,
  ahora: number,
  horas: number
): string[] {
  const limite = ahora - horas * 3_600_000
  return filas
    .filter((f) => (f.tipo === 'puja' || f.tipo === 'pausar') && (f.origen ?? 'motor') === 'motor' && !f.retenida_at && !esReintentoDeTransporte(f.error))
    .filter((f) => {
      const t = Date.parse(f.creada_at)
      return Number.isFinite(t) && t < limite
    })
    .map((f) => f.id)
}

/** Las horas que pueden pasar sin releer las segmentaciones (ads_objetivos_diario) antes de dejar de decidir pujas con ellas. La lectura normal es cada 3 h */
export const HORAS_MAX_SIN_RELEER_SEGMENTACIONES = 36

/**
 * PURO. ¿Se pueden decidir pujas y pausas con las segmentaciones guardadas? Devuelve el motivo para NO hacerlo (null = adelante).
 *   · `ultimaLecturaMs`: el `actualizado_at` más reciente de las filas de la ventana (cada lectura buena reescribe los últimos 14 días): si es de hace más de 36 h, el informe de objetivos lleva
 *     fallando y las filas son de días leídos una sola vez, con las ventas a medio atribuir.
 *   · `maxFecha` frente a `hasta`: si el último día de la ventana tuvo gasto en campañas pero no hay ni una fila de segmentaciones, faltan días (se pausaría o bajaría lo que sí vendió).
 * Es relativo (edad), no a una hora fija, para no omitir de madrugada. No cambia ninguna regla: solo impide decidir con datos rotos.
 */
export function motivoSegmentacionesSinReleer(e: { ultimaLecturaMs: number | null; maxFecha: string | null; hasta: string; gastoEnHasta: boolean; ahora: number; maxHoras?: number }): string | null {
  const maxHoras = e.maxHoras ?? HORAS_MAX_SIN_RELEER_SEGMENTACIONES
  if (e.gastoEnHasta && (!e.maxFecha || e.maxFecha < e.hasta)) return `segmentaciones sin releer: no hay filas del ${e.hasta} (último día con datos: ${e.maxFecha ?? 'ninguno'}) y ese día hubo gasto`
  if (e.ultimaLecturaMs != null && e.ahora - e.ultimaLecturaMs > maxHoras * 3_600_000) return `segmentaciones sin releer desde ${new Date(e.ultimaLecturaMs).toISOString().slice(0, 16).replace('T', ' ')} UTC (más de ${maxHoras} h)`
  return null
}
