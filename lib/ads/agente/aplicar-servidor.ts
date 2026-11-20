/**
 * AMAZON ADS · EL AGENTE PPC: APLICAR COMO AGENTE (paso «aplicar», §6.1). SOLO SERVIDOR.
 *
 * Cada 10 minutos (si hay pendientes libres) el agente recorre las propuestas pendientes SIN retener y decide, una a una:
 *   1. Solo con el motor en modo «agente», el agente en ensayo o activo y sin parada general.
 *   2. Pendientes con consulta PROPIA (`pendientesLibres`, 300, más gasto primero).
 *   3. Topes del día con la rampa (`topesDelDia`): día 1 solo bajadas al 25 %, días 2–3 al 50 % sin subir presupuestos, 4–6 al 75 %, desde el 7.º completos.
 *   4. Términos REVISAR: la etiqueta vigente de la IA (`etiquetaVigente`) decide (`decisionDeTermino`): un término que ha vendido o una IA sin validar → para una persona;
 *      «otro producto» / «intención mala» seguros → negativa SIEMPRE en exacta; «relevante» seguro → se descarta. SIN etiqueta a las 30 h (la IA ha fallado, tope o
 *      sin clave) no se negativiza a ciegas: se caduca y se vuelve a proponer; si falla la LECTURA de la etiqueta, se espera.
 *   5. RARAS (`esRara`): la IA dice «aplicar» → en FORMA REDUCIDA (`formaReducida`), y se mide a los 3 días; «retener» → para una persona; sin decisión, se espera 30 h.
 *   6. Subidas (puja, presupuesto, promover): por un motivo PASAJERO (postura «recortar», sin stock, ritmo «recorte», techo nulo, 7 días tras un evento, cuenta
 *      pequeña) se CADUCAN (se vuelven a proponer cuando el motivo pase); por producto solo defensivo o marca, se retienen para una persona.
 *      Las que solo frena la RAMPA esperan (mañana la rampa puede dejarlas). Una pausa por stock con el stock de vuelta o de hace > 12 h se caduca.
 *   7. Guardarraíles: puja ±25 % y puja máxima (`limitarPuja`); subida de presupuesto contra el techo y la suma de hace 7 días (`limitarSubidaDePresupuesto`).
 *   8. Orden (`ordenDeAplicar`): pausar campaña, negativas, pausas, bajadas de puja, bajadas de presupuesto (donantes primero), subidas de puja, promover, subidas de presupuesto.
 *      Como mucho 8 por pasada y nunca a menos de 15 s del final de la pasada.
 *   9. ANTES de cada aplicación: parada general, estado del agente y lo hecho hoy (releído) contra los topes.
 *  10. En ensayo `ensayarComoAgente` (no escribe); activo `aplicarPropuesta` con origen 'agente'.
 *  11. Tras una escritura real: abre la medición (`abrirEfecto`) y, la primera vez en la cuenta, avisa («primera escritura»).
 *  12. Errores clasificados (`clasificarErrorDeAmazon`): transporte → vuelve a pendiente y no cuenta; autorización → cuenta (freno); validación → queda en error/obsoleta.
 *
 * Las funciones PURAS de decisión están arriba y exportadas (se prueban en aplicar-servidor.prueba.ts).
 */

import { createServiceClient } from '@/lib/supabase/service'
import { leerPujaActual } from '../escritura'
import { esReintentoDeTransporte, pujaDePromover, queHacerTrasFalloDeTransporte, textoDeReintento } from '../motor-calculo'
import {
  aplicarPropuesta,
  ajustarConcordancia,
  ajustarValorNuevo,
  caducarComoAgente,
  descartarComoAgente,
  ensayarComoAgente,
  leerModo,
  marcarRetenida,
  pendientesLibres,
  type Propuesta,
} from '../motor'
import { asinDeCampana } from '../productos-agrupar'
import { esAsin, partesDeNombre } from '../reglas'
import type { CuentaParaSincronizar } from '../sincronizar'
import { textoDePrimeraEscritura } from './avisos-calculo'
import { hashDeTitulo } from './cerebro-calculo'
import { esRevisar, etiquetaVigente, queDePropuesta, validacionDeLaIa } from './cerebro-ia'
import { desplazar, filasDeUso, leerCuenta, leerStockPorAsin, nombreDeCuenta, sumarDias, type StockDeAsin } from './contexto-servidor'
import { abrirEfecto, cvrDeMetricas } from './efectos-servidor'
import { actualizarAgente, hechosDeHoy, leerConfigDelAgente, paradaGeneral } from './estado-servidor'
import { anotarEvento, avisar } from './eventos-servidor'
import {
  claseDeCambio,
  clasificarErrorDeAmazon,
  decisionDeTermino,
  esRara,
  formaReducida,
  limitarPuja,
  limitarSubidaDePresupuesto,
  ordenDeAplicar,
  presupuestoUtil,
  quedaTope,
  topesDelDia,
} from './guardarrailes-calculo'
import { esCampanaDeMarca, esTextoDeMarca, pujaMaxima } from './objetivos-calculo'
import { diaDeRampa, horaEnMadrid } from './pasos-calculo'
import { coberturaDias, stockEsViejo } from './stock-calculo'
import { pedidosHistoricosDeTermino } from './terminos-semana-servidor'
import {
  AGENTE,
  type ClaseDeCambio,
  type ConfigDelAgente,
  type DiaDeUso,
  type EtiquetaDeTermino,
  type FaseDeProducto,
  type Postura,
  type RitmoDelMes,
  type TipoDeErrorDeAmazon,
} from './tipos'
import { horaLocal, inicioDelDiaLocal } from './uso-calculo'
import { sumaDePresupuestos } from './vigilar-servidor'

const HORA_MS = 3_600_000
const DIA_MS = 86_400_000
/** Cuántas pendientes se miran por pasada (las que más gastan) */
const PENDIENTES_A_MIRAR = 300

const finito = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const num = (x: unknown): number => {
  const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN
  return Number.isFinite(n) ? n : 0
}
const euros = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const conf = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** El nombre de una etiqueta en el motivo («otro producto»): etiquetaDelMotivo (cerebro-ia) lo lee igual */
const NOMBRE_DE_ETIQUETA: Record<EtiquetaDeTermino, string> = {
  relevante: 'relevante',
  otro_producto: 'otro producto',
  marca_ajena: 'marca ajena',
  intencion_mala: 'intención mala',
  dudoso: 'dudoso',
}

/* =============================================================================================================================================================
 * PURO: la decisión sobre UNA propuesta
 * ============================================================================================================================================================= */

/** Lo que hace falta saber de la propuesta (un subconjunto de Propuesta, para poder probarlo sin base de datos) */
export interface PropuestaParaDecidir {
  id: string
  tipo: string
  asin: string | null
  termino: string
  campaignId: string
  campaignNombre: string
  haciaCampaignNombre: string | null
  motivo: string
  metricas: Record<string, unknown>
  objetivoTipo: string | null
  valorActual: number | null
  valorNuevo: number | null
  iaDecision: 'aplicar' | 'retener' | null
  iaMotivo: string | null
  creadaAt: string
  /** Quién la creó: 'agente' (vigilar: R1/R4, recortes, stock) o 'motor' (la generación diaria). Sin el dato, como 'agente' */
  origen?: 'agente' | 'motor'
}

/** El producto de la propuesta, con lo que pide la decisión */
export interface ProductoParaDecidir {
  postura: Postura
  soloDefensivo: boolean
  marca: string | null
  fase: FaseDeProducto
  gasto30: number
  stock: number | null
  coberturaDias: number | null
  acosObjetivoPct: number | null
  precio: number | null
  /** El stock es de hace ≥ LISTING_FRESCO_HORAS (o sin fecha): para SUBIR cuenta como desconocido. Sin el dato, fresco */
  stockViejo?: boolean
}

export interface CuentaParaDecidir {
  ahora: number
  /** Restricciones de HOY por la rampa (topesDelDia) */
  rampa: { soloBajadas: boolean; sinPresupuestoSubir: boolean }
  /** Cuenta pequeña: sin subidas de presupuesto (topesDelDia ya las pone a 0; aquí se retienen con su porqué) */
  cuentaPequena: boolean
  ritmoRecorte: boolean
  techoNulo: boolean
  /** Nombre del evento si estamos en sus 7 días posteriores (las ventanas lo tocan) */
  eventoPosterior: string | null
  /** Puja máxima fija (ads_agente.puja_max o la de serie) */
  topePuja: number
  /** La API de uso de presupuesto falla: no se sabe cuánto se gasta hoy, así que nada SUBE (espera a que vuelva) */
  gastoDesconocido?: boolean
  /** Inicio del día LOCAL de la cuenta (ms): una subida R1 («se agota HOY») creada antes es de otro día y se caduca. Sin el dato, no se mira */
  inicioDelDiaLocal?: number
  /** La lectura del stock ha FALLADO (no es «stock desconocido»): no se sabe qué productos están sin cobertura, así que nada SUBE (espera a la próxima pasada) */
  stockSinLeer?: boolean
}

/** Lo que se ha leído para un término REVISAR */
export interface DatosDeTermino {
  etiqueta: { etiqueta: EtiquetaDeTermino; confianza: number } | null
  /** null = no se ha podido comprobar (falla la lectura): nunca se negativiza sin saberlo */
  pedidosHistoricos: number | null
  validacionOk: boolean
  /** La lectura de la etiqueta ha FALLADO (la base, no «no hay etiqueta»): `etiqueta` es null pero no se sabe si la IA lo miró */
  etiquetaError?: boolean
}

export type DecisionDelAgente =
  | { accion: 'esperar'; motivo: string }
  | { accion: 'retener'; motivo: string }
  | { accion: 'descartar'; motivo: string }
  /** Se creó con otras reglas o con datos de otro día: pendiente → caducada (si sigue haciendo falta, se vuelve a proponer) */
  | { accion: 'caducar'; motivo: string }
  | {
      accion: 'aplicar'
      clase: ClaseDeCambio
      orden: number
      gasto: number
      /** Valor nuevo si cambia (guardarraíl o forma reducida); null = el de la propuesta */
      valorNuevo: number | null
      /** Una pausa rara que pasa a ser una bajada de puja */
      tipoNuevo: 'puja' | null
      /** Con `tipoNuevo`: la puja leída en Amazon, que pasa a ser el valor actual de la propuesta (para comprobar que sigue igual y para los guardarraíles al reintentar) */
      valorActualNuevo: number | null
      /** Lo que se añade al motivo («Forma reducida: …», «Guardarraíl: …») */
      nota: string | null
      iaAprueba: boolean
      concordanciaExacta: boolean
      raraAplicada: boolean
      /** Promover: la puja máxima del agente para la keyword o segmentación que se crea (la de partida, el CPC histórico, se recorta a ella) */
      pujaMaxima?: number
    }

/** Las horas que lleva creada la propuesta */
export function horasDesde(iso: string, ahora: number): number {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? Math.max(0, (ahora - t) / HORA_MS) : 0
}

/** El rol de una campaña: el de la nomenclatura; si no la sigue (p. ej. «… | DEFENSA», que no es un rol del generador), el último tramo tras «|» */
function rolDeCampana(nombre: string): string | null {
  const rol = partesDeNombre(nombre)?.rol
  if (rol) return rol
  const tramos = nombre.split('|')
  return tramos.length > 1 ? tramos[tramos.length - 1].trim() || null : null
}

/** ¿Es de marca (el término, su campaña o la campaña a la que va)? */
export function propuestaDeMarca(p: Pick<PropuestaParaDecidir, 'termino' | 'campaignNombre' | 'haciaCampaignNombre'>, marca: string | null): boolean {
  if (esTextoDeMarca(p.termino, marca)) return true
  for (const nombre of [p.campaignNombre, p.haciaCampaignNombre]) {
    if (nombre && esCampanaDeMarca(nombre, rolDeCampana(nombre), marca)) return true
  }
  return false
}

/** Una pausa por stock (campaña o anuncio) nunca pasa por la IA ni por la forma reducida */
const esPausaDeStock = (p: Pick<PropuestaParaDecidir, 'tipo' | 'objetivoTipo'>) => p.tipo === 'pausar-campana' || (p.tipo === 'pausar' && p.objetivoTipo === 'anuncio')

/** El principio del motivo con que se caduca un REVISAR sin etiqueta de la IA (lo busca `avisarSinEtiquetas` para contar los del día) */
export const MOTIVO_SIN_ETIQUETA = 'Sin etiqueta de la IA'

const CLASES_QUE_SUBEN: ReadonlySet<ClaseDeCambio> = new Set<ClaseDeCambio>(['puja_subir', 'presupuesto_subir', 'promover'])

/**
 * PURO. Qué hace el agente con UNA propuesta (pasos 4–7 de §6.1, sin los topes ni la suma de presupuestos, que se miran justo antes de aplicar).
 * `pujaLeida`: la puja de ahora en Amazon de la segmentación de una PAUSA rara aprobada por la IA (para su forma reducida); null si no se ha podido leer.
 */
export function decidirPropuesta(
  p: PropuestaParaDecidir,
  c: CuentaParaDecidir,
  producto: ProductoParaDecidir | null,
  extra: { termino: DatosDeTermino | null; pujaLeida: number | null; campanasConUbicacionAlta: readonly string[] },
): DecisionDelAgente {
  const horas = horasDesde(p.creadaAt, c.ahora)
  const gasto = num(p.metricas?.gasto)
  const pedidos = num(p.metricas?.pedidos)
  let tipo = p.tipo
  let valorActual = p.valorActual
  let valorNuevo = p.valorNuevo
  let tipoNuevo: 'puja' | null = null
  const notas: string[] = []
  let iaAprueba = false
  let concordanciaExacta = false
  let raraAplicada = false
  let cambiaValor = false

  // ---- 3b. Subidas que no pasaron los frenos del agente o son de otro día: se caducan (nunca se aplican) ----
  const sube = finito(p.valorActual) && finito(p.valorNuevo) && (p.valorNuevo as number) > (p.valorActual as number)
  if (p.tipo === 'puja' && sube && p.metricas?.agente !== true) {
    // Solo filtrarSubidaDelAgente (motor-pujas con los ajustes del agente) marca `agente: true`: sin la marca, la generó el motor sin subidaPermitida ni la cuarentena por efecto
    return { accion: 'caducar', motivo: 'subida de puja generada sin los frenos del agente (p. ej. con el motor en «Aprueba y aplica» mientras estaba frenado)' }
  }
  if (p.tipo === 'presupuesto' && sube) {
    if (p.origen === 'motor') return { accion: 'caducar', motivo: 'subida de presupuesto del motor: en modo agente los presupuestos solo los sube R1' }
    const regla = typeof p.metricas?.regla === 'string' ? (p.metricas.regla as string) : ''
    const creada = Date.parse(p.creadaAt)
    if (/^R1/.test(regla) && c.inicioDelDiaLocal !== undefined && (!Number.isFinite(creada) || creada < c.inicioDelDiaLocal)) {
      return { accion: 'caducar', motivo: `${regla} de otro día: la campaña se agotaba entonces, no se sabe si hoy` }
    }
  }

  // ---- 3c. Pausa por stock: solo mientras el producto siga a 0 y la decisión sea reciente. Si el stock ha vuelto, o lleva más de
  //      STOCK_PAUSA_PENDIENTE_HORAS esperando (sin tope ese día, frenado…), se caduca: aplicarla ahora pausaría una campaña CON stock y el vigilar
  //      siguiente la reactivaría (dos escrituras, dos huecos del tope y la campaña parada entre medias). Si sigue a 0, vigilar la vuelve a proponer ----
  if (esPausaDeStock(p)) {
    if (producto && producto.stock != null && producto.stock > 0) return { accion: 'caducar', motivo: `el producto vuelve a tener stock (${producto.stock}): ya no hay que pausar` }
    if (horas > AGENTE.STOCK_PAUSA_PENDIENTE_HORAS) return { accion: 'caducar', motivo: `pausa por stock de hace más de ${AGENTE.STOCK_PAUSA_PENDIENTE_HORAS} h: si sigue a 0, se vuelve a proponer con el stock de ahora` }
  }

  // ---- 4. Términos REVISAR: decide la etiqueta de la IA ----
  if (esRevisar({ tipo: p.tipo, motivo: p.motivo, metricas: p.metricas })) {
    const t = extra.termino ?? { etiqueta: null, pedidosHistoricos: 0, validacionOk: false }
    // Fallar cerrado: sin saber si el término ha vendido, no se negativiza (espera a la próxima pasada; si no se puede en 30 h, para una persona)
    if (t.pedidosHistoricos == null) {
      if (horas > AGENTE.IA_HORAS_ESPERA) return { accion: 'descartar', motivo: 'No he podido comprobar si el término ha vendido: no lo negativizo.' }
      return { accion: 'esperar', motivo: 'No he podido comprobar si el término ha vendido: espero a la próxima pasada' }
    }
    const d = decisionDeTermino(t.etiqueta, horas, { pedidosHistoricos: t.pedidosHistoricos, validacionOk: t.validacionOk })
    const dice = t.etiqueta ? `La IA dice: ${NOMBRE_DE_ETIQUETA[t.etiqueta.etiqueta]} (${conf(t.etiqueta.confianza)})` : null
    if (d === 'esperar') return { accion: 'esperar', motivo: 'Término sin etiqueta segura de la IA todavía' }
    if (d === 'descartar') return { accion: 'descartar', motivo: `${dice ?? 'La IA dice: relevante'}. Alguien que busca eso compraría el producto: no lo negativizo.` }
    if (d === 'retener') {
      // Sin personas de por medio (20 nov 2026, Raúl): lo que ha vendido no se negativiza; lo demás, sí
      if (t.pedidosHistoricos > 0) return { accion: 'descartar', motivo: `Ha vendido (${t.pedidosHistoricos} pedidos en 90 días): no lo negativizo.${dice ? ` ${dice}.` : ''}` }
      // Sin etiqueta NO es un criterio de negocio: es que falta el dato (la IA ha fallado, ha llegado al tope del mes o no hay clave). Negativizar a ciegas a las 30 h
      // con «aprobada por la IA» sería decidir con un dato que falta (igual que con pedidosHistoricos null). Si la lectura de la etiqueta ha fallado, se espera a la
      // próxima pasada; si de verdad no hay etiqueta, se CADUCA (no se descarta): el motor lo vuelve a proponer y, cuando la IA responda, se decide con su etiqueta
      if (!t.etiqueta) {
        if (t.etiquetaError) return { accion: 'esperar', motivo: 'No he podido leer la etiqueta de la IA: espero a la próxima pasada' }
        return { accion: 'caducar', motivo: `${MOTIVO_SIN_ETIQUETA} en ${AGENTE.IA_HORAS_ESPERA} h (la IA no ha podido mirarlo): no lo negativizo` }
      }
    }
    // aplicar: negativa en exacta, aprobada por la IA
    iaAprueba = true
    concordanciaExacta = true
  } else if (!esPausaDeStock(p) && !/Forma reducida/.test(p.motivo)) {
    // ---- 5. RARAS: la IA decide; si aprueba, forma reducida ----
    const prod = producto
    const r = esRara(
      { tipo: p.tipo, termino: p.termino, esAsin: esAsin(p.termino), valorActual: p.valorActual, valorNuevo: p.valorNuevo, metricas: { gasto, pedidos }, campaignId: p.campaignId },
      { gastoProducto30: prod?.gasto30 ?? 0, stock: prod ? prod.stock : null, coberturaDias: prod ? prod.coberturaDias : null, campanasConUbicacionAlta: extra.campanasConUbicacionAlta },
    )
    if (r.rara) {
      const porque = r.porque ?? 'cambio poco habitual'
      if (p.iaDecision === 'retener') return { accion: 'retener', motivo: `Rara (${porque}): la IA la retiene${p.iaMotivo ? ` — ${p.iaMotivo}` : ''}.` }
      if (p.iaDecision !== 'aplicar') {
        if (horas > AGENTE.IA_HORAS_ESPERA) return { accion: 'retener', motivo: `Rara (${porque}): la IA no ha decidido en ${AGENTE.IA_HORAS_ESPERA} h. Lo decide una persona.` }
        return { accion: 'esperar', motivo: `Rara (${porque}): espera a la IA` }
      }
      // La IA aprueba: forma reducida
      const base = p.tipo === 'pausar' && !finito(p.valorActual) ? extra.pujaLeida : p.valorActual
      const fr = formaReducida({ tipo: p.tipo, valorActual: base, valorNuevo: p.valorNuevo, metricas: { pedidos } })
      if (fr) {
        if (fr.valorNuevo == null || !(fr.valorNuevo > 0)) return { accion: 'retener', motivo: `Rara (${porque}): la IA la aprueba, pero no he podido leer la puja de ahora para bajarla un 25 % en vez de pausar.` }
        if (p.tipo === 'pausar' && fr.tipo === 'puja') {
          tipo = 'puja'
          tipoNuevo = 'puja'
          valorActual = base
        }
        valorNuevo = fr.valorNuevo
        cambiaValor = true
        notas.push(fr.nota)
      }
      raraAplicada = true
      iaAprueba = true
    }
  }

  const clase = claseDeCambio({ tipo, valorActual, valorNuevo, metricas: { pedidos } })

  // ---- Fallar cerrado: una puja o un presupuesto sin valor actual o nuevo se saltaría los guardarraíles (±25 %, puja máxima, techo, 7 días) y la comprobación de que
  //      Amazon sigue igual (valorSigueIgual(null, x) da true): no se aplica ----
  if ((tipo === 'puja' || tipo === 'presupuesto') && (!finito(valorActual) || !finito(valorNuevo))) {
    return { accion: 'descartar', motivo: `Sin ${!finito(valorActual) ? 'valor actual' : 'valor nuevo'} de ${tipo === 'puja' ? 'la puja' : 'el presupuesto'}: no se puede aplicar.` }
  }

  // ---- 6. Subidas: postura, ritmo, defensivo, marca, techo, evento; la rampa solo hace esperar ----
  //      Dos clases de razones. PASAJERAS (postura «recortar», sin stock o poca cobertura, ritmo «recorte», sin techo, 7 días tras un evento, cuenta pequeña):
  //      la subida se CADUCA (no escribe nada). Retenida seguiría pendiente y bloquearía la segmentación o la campaña (cuarentena de pujas, cuarentena de
  //      términos, índice único de pendientes) hasta 14 días aunque el motivo desapareciera; caducada, el motor o vigilar la vuelven a proponer con los
  //      datos de ese momento. De UNA PERSONA (solo defensivo, marca propia): se retiene, porque no cambia sola.
  if (CLASES_QUE_SUBEN.has(clase)) {
    const marca = producto?.marca ?? null
    const pasajeras: string[] = []
    const dePersona: string[] = []
    if (producto?.postura === 'recortar') pasajeras.push('el producto está en «recortar»')
    // Red de seguridad (§6.5): aunque la postura guardada siga en «mantener»/«crecer» (vigilar no ha podido guardarla o aún no ha pasado), sin stock o con poca cobertura no se sube
    else if (producto && ((producto.stock != null && producto.stock <= 0) || (producto.coberturaDias != null && producto.coberturaDias < AGENTE.COBERTURA_RECORTAR_DIAS))) {
      pasajeras.push(producto.stock != null && producto.stock <= 0 ? 'el producto está sin stock' : `el producto tiene poca cobertura de stock (${Math.round((producto.coberturaDias as number) * 10) / 10} días)`)
    }
    if (c.ritmoRecorte) pasajeras.push('el mes va en «recorte» (por encima del techo)')
    if (producto?.soloDefensivo) dePersona.push('el producto es «solo defensivo» (sin coste ni ACoS de una persona)')
    if (propuestaDeMarca(p, marca)) dePersona.push('es de marca propia')
    if (c.techoNulo) pasajeras.push('no hay techo de gasto del mes')
    if (c.eventoPosterior) pasajeras.push(`los datos tocan ${c.eventoPosterior}`)
    if (clase === 'presupuesto_subir' && c.cuentaPequena) pasajeras.push(`la cuenta es pequeña (menos de ${AGENTE.CUENTA_PEQUENA_GASTO30} de gasto en 30 días)`)
    if (dePersona.length > 0) return { accion: 'descartar', motivo: `No subo: ${[...dePersona, ...pasajeras].join('; ')}.` }
    if (pasajeras.length > 0) return { accion: 'caducar', motivo: `No subo: ${pasajeras.join('; ')}. Si deja de pasar, se volverá a proponer con los datos de ese momento.` }
    if (c.gastoDesconocido) return { accion: 'esperar', motivo: 'No sé cuánto se gasta hoy (falla la lectura del uso de presupuesto): no subo hasta que vuelva' }
    // Sin poder leer el stock (o con un stock de hace horas) no se sabe si el producto tiene cobertura: la red de seguridad de arriba no vería un «sin stock». Espera
    if (c.stockSinLeer) return { accion: 'esperar', motivo: 'No he podido leer el stock: no subo hasta que vuelva' }
    if (producto?.stockViejo) return { accion: 'esperar', motivo: `El stock se leyó hace ${AGENTE.LISTING_FRESCO_HORAS} h o más: no subo hasta que se relea` }
    if (c.rampa.soloBajadas) return { accion: 'esperar', motivo: 'Rampa: hoy solo negativas y bajadas' }
    if (clase === 'presupuesto_subir' && c.rampa.sinPresupuestoSubir) return { accion: 'esperar', motivo: 'Rampa: todavía no se suben presupuestos' }
  }

  // ---- 7. Guardarraíl de la puja (el del presupuesto se mira justo antes de aplicar, con la suma de ese momento) ----
  if (tipo === 'puja' && finito(valorActual) && finito(valorNuevo)) {
    const pujaMax =
      clase === 'puja_subir'
        ? pujaMaxima({ precio: producto?.precio ?? null, cvrPct: finito(p.metricas?.cvrPct) ? (p.metricas.cvrPct as number) : null, acosObjetivoPct: producto?.acosObjetivoPct ?? 0, topeFijo: c.topePuja })
        : null
    const l = limitarPuja(valorActual, valorNuevo, pujaMax)
    if (l.descartar) return { accion: 'descartar', motivo: `Guardarraíl: con el ±${Math.round(AGENTE.PUJA_CAMBIO_MAX * 100)} %${pujaMax != null ? ` y la puja máxima (${euros(pujaMax)})` : ''} el cambio ya no merece la pena.` }
    if (l.recortada) {
      valorNuevo = l.valor
      cambiaValor = true
      notas.push(`Guardarraíl: puja ${euros(valorActual)} → ${euros(l.valor)} (como mucho ±${Math.round(AGENTE.PUJA_CAMBIO_MAX * 100)} %${pujaMax != null ? ` y puja máxima ${euros(pujaMax)}` : ''})`)
    }
  }

  // ---- 7b. Promover: la keyword o segmentación nueva nace con el CPC histórico; nunca por encima de la puja máxima del agente ----
  let pujaDePromoverMax: number | undefined
  if (clase === 'promover') {
    const pujaMax = pujaMaxima({ precio: producto?.precio ?? null, cvrPct: finito(p.metricas?.cvrPct) ? (p.metricas.cvrPct as number) : null, acosObjetivoPct: producto?.acosObjetivoPct ?? 0, topeFijo: c.topePuja })
    const partida = pujaDePromover(p.metricas as { clics?: unknown; gasto?: unknown })
    if (!finito(pujaMax) || !(pujaMax > 0) || partida == null) return { accion: 'descartar', motivo: 'Promover: no puedo calcular la puja de partida o la puja máxima.' }
    pujaDePromoverMax = pujaMax
    if (partida > pujaMax) notas.push(`Guardarraíl: la puja de partida (CPC ${euros(partida)}) se queda en la puja máxima ${euros(pujaMax)}`)
  }

  const regla = typeof p.metricas?.regla === 'string' ? (p.metricas.regla as string) : undefined
  return {
    accion: 'aplicar',
    ...(pujaDePromoverMax != null ? { pujaMaxima: pujaDePromoverMax } : {}),
    clase,
    orden: ordenDeAplicar(clase, regla),
    gasto,
    valorNuevo: cambiaValor ? valorNuevo : null,
    tipoNuevo,
    valorActualNuevo: tipoNuevo ? valorActual : null,
    nota: notas.length ? notas.join(' · ') : null,
    iaAprueba,
    concordanciaExacta,
    raraAplicada,
  }
}

/** PURO. ¿Hay un vigilar que TERMINÓ bien (con el freno evaluado) en los últimos `AGENTE.VIGILAR_OK_MAX_MIN` minutos? */
export function vigilarReciente(vigilarOkAt: string | null, ahora: number): boolean {
  const t = vigilarOkAt ? Date.parse(vigilarOkAt) : NaN
  return Number.isFinite(t) && ahora - t <= AGENTE.VIGILAR_OK_MAX_MIN * 60_000
}

/** PURO. Orden de aplicar: por clase (y regla), y dentro, más gasto primero */
export function ordenarParaAplicar<T extends { orden: number; gasto: number }>(planes: readonly T[]): T[] {
  return [...planes].sort((a, b) => a.orden - b.orden || b.gasto - a.gasto)
}

/** Lo que pesa cada campaña en la suma de presupuestos de la cuenta (para el guardarraíl de las subidas de presupuesto) */
export interface SumasDePresupuesto {
  sumaUtil: number
  sumaActual: number
  suma7: number | null
  techoMes: number | null
  /** La suma de presupuestos al encender el agente (el tope de la suma real no baja de ella; null = solo el techo) */
  sumaInicio?: number | null
  /** Por campaña: presupuesto de hoy y máximo de gasto de 14 días (null sin 14 días de datos) */
  campanas: Map<string, { presupuesto: number; max14: number | null }>
}

/**
 * PURO. El guardarraíl de una SUBIDA de presupuesto con las sumas de este momento: { valor, nota }, { retener } o { esperar }.
 * Falla CERRADO: sin lectura de presupuestos de hoy (sumas vacías, p. ej. justo tras la medianoche local o si vigilar no ha podido leer las campañas) o sin la
 * campaña en ella, las sumas valdrían 0 y todo el techo parecería libre → espera (no retiene: en el siguiente vigilar habrá lectura).
 */
export function limitarPresupuestoAhora(actual: number, nuevo: number, s: SumasDePresupuesto, campaignId?: string): { valor: number; nota: string | null } | { retener: string } | { esperar: string } {
  if (s.campanas.size === 0 || !(s.sumaActual > 0) || !(s.sumaUtil > 0)) return { esperar: 'Sin lectura de los presupuestos de hoy: no puedo comprobar la suma de la cuenta' }
  if (campaignId !== undefined && !s.campanas.has(campaignId)) return { esperar: 'La campaña no está en la lectura de presupuestos de hoy: no puedo comprobar la suma de la cuenta' }
  const r = limitarSubidaDePresupuesto({ actual, nuevo, sumaUtil: s.sumaUtil, sumaActual: s.sumaActual, techoMes: s.techoMes, suma7: s.suma7, sumaInicio: s.sumaInicio ?? null })
  if (r.valor == null) return { retener: `Guardarraíl: ${r.motivo ?? 'no cabe la subida de presupuesto'}.` }
  if (r.valor < nuevo - 0.004) return { valor: r.valor, nota: `Guardarraíl: ${r.motivo ?? `subida recortada a ${euros(r.valor)}`}` }
  return { valor: nuevo, nota: null }
}

/**
 * PURO. ¿Está ya la lectura de presupuestos de HOY entera? Hay filas de hoy y de al menos tantas campañas (en cualquier estado) como ayer. Si no (justo tras la
 * medianoche local, vigilar sin poder leer las campañas, una lectura a medias), las sumas saldrían bajas y el techo parecería libre: las subidas esperan.
 */
export function lecturaDeHoyCompleta(dias: readonly DiaDeUso[], fecha: string): boolean {
  const ayer = desplazar(fecha, -1)
  const hoy = new Set<string>()
  const deAyer = new Set<string>()
  for (const d of dias) {
    if (d.fechaLocal === fecha) hoy.add(d.campaignId)
    else if (d.fechaLocal === ayer) deAyer.add(d.campaignId)
  }
  return hoy.size > 0 && hoy.size >= deAyer.size
}

/**
 * PURO. Las sumas cambian al aplicar un presupuesto (la siguiente subida de la misma pasada lo ve). Una SUBIDA cuenta en la suma útil al menos lo que sube
 * (aunque pase de 1,3 × su máximo de 14 días): dos subidas de la misma pasada nunca usan el mismo hueco del techo.
 */
export function moverSumas(s: SumasDePresupuesto, campaignId: string, antes: number, despues: number): void {
  const c = s.campanas.get(campaignId)
  const max14 = c?.max14 ?? null
  const deltaUtil = presupuestoUtil(despues, max14) - presupuestoUtil(antes, max14)
  s.sumaActual = Math.round((s.sumaActual + despues - antes) * 100) / 100
  s.sumaUtil = Math.round((s.sumaUtil + (despues > antes ? Math.max(deltaUtil, despues - antes) : deltaUtil)) * 100) / 100
  s.campanas.set(campaignId, { presupuesto: despues, max14 })
}

/**
 * PURO. Una propuesta que viene de un reintento por transporte puede tener su cambio YA aplicado en Amazon. Si la decisión de ahora es descartarla o
 * caducarla, ese cambio quedaría fuera de todo control: se retiene para una persona. Aplicar (la pasada relee Amazon y lo confirma) y retener, tal cual
 */
export function decisionDeReintento(error: string | null, d: DecisionDelAgente): DecisionDelAgente {
  if (!esReintentoDeTransporte(error)) return d
  if (d.accion !== 'descartar' && d.accion !== 'caducar') return d
  return { accion: 'retener', motivo: `Falló por la red al aplicarla y puede que el cambio esté en Amazon; ahora el agente la ${d.accion === 'descartar' ? 'descartaría' : 'caducaría'} (${d.motivo}). Revísala.` }
}

/** PURO. El código HTTP y el código de Amazon de un error (los mensajes de llamarAds: «Amazon Ads ha contestado 429 a …»; los de un 207: «Amazon no ha creado el elemento …») */
export function datosDelError(mensaje: string): { httpStatus: number | null; codigo: string | null } {
  const m = /contestado\s+(\d{3})\b/i.exec(mensaje)
  let httpStatus = m ? Number(m[1]) : null
  if (httpStatus == null && /Amazon no ha creado el elemento/i.test(mensaje)) httpStatus = 207
  const c = /"code"\s*:\s*"([A-Z0-9_]+)"/.exec(mensaje) ?? /\b(DUPLICATE[A-Z_]*|INVALID_ARGUMENT|THROTTLED|UNAUTHORIZED|ACCESS_DENIED)\b/.exec(mensaje)
  return { httpStatus, codigo: c ? c[1] : null }
}

const RE_RED = /tiempo|timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network|socket|abort/i

/**
 * PURO. La clase del fallo al aplicar. Sin código HTTP: si es de red → transporte; si no, es del propio ERP (candados, obsoleta, reserva…) → validación
 * (no cuenta para el freno: no es Amazon quien falla). Con código, `clasificarErrorDeAmazon`.
 */
export function tipoDeFallo(mensaje: string): TipoDeErrorDeAmazon {
  const { httpStatus, codigo } = datosDelError(mensaje)
  if (httpStatus == null) return RE_RED.test(mensaje) ? 'transporte' : 'validacion'
  return clasificarErrorDeAmazon(httpStatus, codigo, mensaje)
}

/* =============================================================================================================================================================
 * SERVIDOR
 * ============================================================================================================================================================= */

export interface ResultadoDeAplicar {
  aplicadas: number
  ensayadas: number
  retenidas: number
  descartadas: number
  caducadas: number
  fallidas: number
  erroresQueCuentan: number
}

/** ¿Ha habido errores de Amazon QUE CUENTAN (autorización) del agente en los últimos 7 días? (la rampa no pasa del 75 %) */
async function erroresRecientes(perfilId: string, ahora: number): Promise<boolean> {
  try {
    const desde = new Date(ahora - 7 * DIA_MS).toISOString()
    const pedir = (columnas: string) =>
      createServiceClient().from('ads_cambios_log').select(columnas).eq('perfil_id', perfilId).eq('origen', 'agente').eq('ok', false).gte('creado_at', desde).limit(200)
    let r = await pedir('http_status, error')
    if (r.error) r = await pedir('error')
    if (r.error) return false
    return ((r.data ?? []) as unknown as Array<Record<string, unknown>>).some((f) => {
      const status = finito(Number(f.http_status)) && f.http_status != null ? Number(f.http_status) : null
      const msg = String(f.error ?? '')
      return (status != null ? clasificarErrorDeAmazon(status, datosDelError(msg).codigo, msg) : tipoDeFallo(msg)) === 'autorizacion'
    })
  } catch {
    return false
  }
}

/**
 * Una propuesta que falló por transporte (429, 5xx, red) vuelve a pendiente: se reintenta en la siguiente pasada, que RELEE Amazon antes de escribir y, si el
 * cambio ya llegó, lo confirma como aplicado (confirmaReintento). El valor intentado queda en el error para reconocerlo aunque la decisión cambie el valor nuevo
 */
async function volverAPendiente(perfilId: string, id: string, error: string, valorIntentado: number | null): Promise<void> {
  const { error: e } = await createServiceClient()
    .from('ads_propuestas')
    .update({ estado: 'pendiente', error: textoDeReintento(error, valorIntentado), resuelta_at: null, resuelta_por: null })
    .eq('perfil_id', perfilId)
    .eq('id', id)
    .eq('estado', 'error')
  if (e) console.error(`[agente] no se ha podido devolver a pendiente la propuesta ${id}:`, e.message)
}

/**
 * Promover o negativizar que falló por tiempo agotado, red o 5xx: la keyword o la negativa PUEDE estar creada en Amazon. No se reintenta a ciegas (daría DUPLICATE
 * y quedaría viva sin propuesta «aplicada» que la deshaga): vuelve a pendiente RETENIDA para una persona. Solo si sigue en error
 */
async function retenerTrasFalloDeRed(perfilId: string, id: string, error: string): Promise<boolean> {
  const ahora = new Date().toISOString()
  const { data, error: e } = await createServiceClient()
    .from('ads_propuestas')
    .update({
      estado: 'pendiente',
      error: textoDeReintento(error, null),
      resuelta_at: null,
      resuelta_por: null,
      retenida_motivo: `Amazon no ha contestado al crearla: puede estar creada en Amazon. Compruébalo antes de volver a aplicarla (${error})`.slice(0, 500),
      retenida_at: ahora,
    })
    .eq('perfil_id', perfilId)
    .eq('id', id)
    .eq('estado', 'error')
    .select('id')
  if (e) console.error(`[agente] no se ha podido retener la propuesta ${id} tras un fallo de red:`, e.message)
  return !e && (data ?? []).length > 0
}

/** Pone la primera escritura real de la cuenta (solo si no la había) y avisa una vez */
async function marcarPrimeraEscritura(perfilId: string, p: Propuesta, ahora: number): Promise<void> {
  try {
    const { data, error } = await createServiceClient()
      .from('ads_agente')
      .update({ primera_escritura_at: new Date(ahora).toISOString() })
      .eq('perfil_id', perfilId)
      .is('primera_escritura_at', null)
      .select('perfil_id')
    if (error || !data || data.length === 0) return
    const que = queDePropuesta({ tipo: p.tipo, termino: p.termino, campaignNombre: p.campaignNombre, valorActual: p.valorActual, valorNuevo: p.valorNuevo, objetivoTipo: p.objetivoTipo })
    const nombre = await nombreDeCuenta(perfilId)
      .then((n) => n.nombre)
      .catch(() => perfilId)
    await anotarEvento(perfilId, 'primera_escritura', 'Primera escritura real en Amazon', que, { propuestaId: p.id }, p.id)
    await avisar(perfilId, 'primera-escritura', horaEnMadrid(ahora).fecha, textoDePrimeraEscritura({ nombreCuenta: nombre, que }), { avisar: true })
  } catch (e) {
    console.error(`[agente] primera escritura de ${perfilId}:`, e instanceof Error ? e.message : e)
  }
}

/** La propuesta en el formato de la decisión */
const paraDecidir = (p: Propuesta): PropuestaParaDecidir => ({
  id: p.id,
  tipo: p.tipo,
  asin: p.asin,
  termino: p.termino,
  campaignId: p.campaignId,
  campaignNombre: p.campaignNombre,
  haciaCampaignNombre: p.haciaCampaignNombre,
  motivo: p.motivo,
  metricas: (p.metricas ?? {}) as unknown as Record<string, unknown>,
  objetivoTipo: p.objetivoTipo,
  valorActual: p.valorActual,
  valorNuevo: p.valorNuevo,
  iaDecision: p.iaDecision,
  iaMotivo: p.iaMotivo,
  creadaAt: p.creadaAt,
  origen: p.origen,
})

/**
 * Las sumas de presupuesto de HOY (para el guardarraíl de las subidas). Solo con la lectura de hoy entera (`lecturaDeHoyCompleta`): sin ella, null y las subidas esperan.
 */
async function sumasDeHoy(perfilId: string, config: ConfigDelAgente, l: Awaited<ReturnType<typeof leerCuenta>>, fecha: string): Promise<SumasDePresupuesto | null> {
  const dias: DiaDeUso[] = await filasDeUso(perfilId, desplazar(fecha, -7), fecha).catch(() => [] as DiaDeUso[])
  // Sin la lectura de hoy entera, sin sumas (nunca se calcula con 0)
  if (!lecturaDeHoyCompleta(dias, fecha)) return null
  const hoy = dias.filter((d) => d.fechaLocal === fecha && (d.estadoCampana ?? 'ENABLED').toUpperCase() === 'ENABLED')
  const desde14 = desplazar(l.hasta, -13)
  const campanas = new Map<string, { presupuesto: number; max14: number | null }>()
  let sumaUtil = 0
  for (const d of hoy) {
    const pres = d.presupuesto ?? 0
    if (!(pres > 0)) continue
    const w14 = sumarDias(l.rendimiento, desde14, l.hasta, (f) => f.campaignId === d.campaignId)
    const max14 = w14.dias >= 14 ? w14.maxGastoDia : null
    campanas.set(d.campaignId, { presupuesto: pres, max14 })
    sumaUtil += presupuestoUtil(pres, max14)
  }
  if (campanas.size === 0) return null
  return {
    sumaUtil: Math.round(sumaUtil * 100) / 100,
    sumaActual: sumaDePresupuestos(dias, fecha) ?? 0,
    suma7: sumaDePresupuestos(dias, desplazar(fecha, -7), true) ?? config.sumaPresupuestosInicio,
    techoMes: l.techoMes,
    sumaInicio: config.sumaPresupuestosInicio,
    campanas,
  }
}

/**
 * Al DESHACER una bajada de presupuesto (volver a subirlo): hasta dónde deja volver HOY el guardarraíl de la suma (el mismo que las subidas).
 * { valor } (el anterior entero o recortado) o { no: porqué } si no cabe o no se puede comprobar (falla cerrado). Solo base de datos.
 */
export async function permitidoParaVolverPresupuesto(
  cuenta: CuentaParaSincronizar,
  config: ConfigDelAgente,
  ahora: number,
  campaignId: string,
  actual: number,
  anterior: number,
): Promise<{ valor: number } | { no: string }> {
  if (!(anterior > actual)) return { valor: anterior }
  const l = await leerCuenta(cuenta.id, config, ahora, 35)
  const sumas = await sumasDeHoy(cuenta.id, config, l, horaLocal(ahora, l.perfil.zona).fecha)
  if (!sumas) return { no: 'sin la lectura de presupuestos de hoy no puedo comprobar la suma de la cuenta' }
  const g = limitarPresupuestoAhora(actual, anterior, sumas, campaignId)
  if ('esperar' in g) return { no: g.esperar }
  if ('retener' in g) return { no: g.retener }
  return { valor: g.valor }
}

/** PURO. ¿Va el mes en «recorte» (o en sus primeros días tras un mes en recorte)? Lo mismo que mira vigilar para las reglas de ritmo */
export function mesEnRecorte(config: Pick<ConfigDelAgente, 'ritmo' | 'ritmoFecha' | 'ritmoMesAnterior'>, local: { mes: string; dia: number }): boolean {
  const deEsteMes = Boolean(config.ritmoFecha && config.ritmoFecha.slice(0, 7) === local.mes)
  if (deEsteMes && config.ritmo === 'recorte') return true
  return config.ritmoMesAnterior === 'recorte' && local.dia <= AGENTE.DIAS_TRAS_RECORTE
}

/**
 * PURO. ¿Se puede REACTIVAR una campaña que el agente pausó por stock? Reactivar devuelve su presupuesto entero a la suma de la cuenta: mientras estuvo pausada,
 * ese hueco lo pueden haber ocupado subidas (R1), y reactivarla sin mirar dejaría la suma real por encima del tope de exposición (techo ÷ 30,4 × 1,1 o la suma al
 * encender), del × 1,3 de hace 7 días o del ritmo «recorte». Tiene que caber ENTERA como una subida de 0 a su presupuesto (limitarPresupuestoAhora); si no, no
 * se reactiva: se avisa y lo decide una persona (o el agente cuando quepa). Falla cerrado: sin lectura de hoy o sin presupuesto conocido, no.
 */
export function decisionDeReactivarCampana(e: { campaignId: string; presupuesto: number | null; enRecorte: boolean; sumas: SumasDePresupuesto | null }): { ok: true } | { no: string } {
  if (e.enRecorte) return { no: 'el mes va en «recorte»: no devuelvo presupuesto a la cuenta reactivando campañas' }
  if (!e.sumas) return { no: 'sin la lectura de presupuestos de hoy no puedo comprobar que su presupuesto cabe en la suma de la cuenta' }
  // Ya cuenta en la suma de hoy (la lectura la da por activa): reactivarla no añade nada
  if (e.sumas.campanas.has(e.campaignId)) return { ok: true }
  if (e.presupuesto == null || !Number.isFinite(e.presupuesto) || !(e.presupuesto > 0)) return { no: 'no sé su presupuesto de hoy: no puedo comprobar que cabe en la suma de la cuenta' }
  const g = limitarPresupuestoAhora(0, e.presupuesto, e.sumas)
  if ('esperar' in g) return { no: g.esperar.charAt(0).toLowerCase() + g.esperar.slice(1) }
  if ('retener' in g) return { no: `su presupuesto (${euros(e.presupuesto)}) no cabe: ${g.retener.replace(/^Guardarraíl: /, '')}` }
  if (g.valor < e.presupuesto - 0.004) return { no: `su presupuesto (${euros(e.presupuesto)}) no cabe entero en la suma de la cuenta (${(g.nota ?? '').replace(/^Guardarraíl: /, '')})` }
  return { ok: true }
}

/** Antes de REACTIVAR una campaña pausada por stock: lo que dice `decisionDeReactivarCampana` con las sumas de HOY (solo base de datos). Falla cerrado */
export async function permitidoParaReactivarCampana(
  cuenta: CuentaParaSincronizar,
  config: ConfigDelAgente,
  ahora: number,
  campaignId: string,
  /** El ritmo que acaba de calcular vigilar en esta pasada (config puede ser de antes) */
  ritmoDeAhora: RitmoDelMes | null = null,
): Promise<{ ok: true; fecha: string } | { no: string }> {
  try {
    const l = await leerCuenta(cuenta.id, config, ahora, 35)
    const local = horaLocal(ahora, l.perfil.zona)
    const [hoy, sumas] = await Promise.all([filasDeUso(cuenta.id, local.fecha, local.fecha), sumasDeHoy(cuenta.id, config, l, local.fecha)])
    const fila = hoy.find((d) => d.campaignId === campaignId && d.fechaLocal === local.fecha)
    const r = decisionDeReactivarCampana({ campaignId, presupuesto: fila?.presupuesto ?? null, enRecorte: ritmoDeAhora === 'recorte' || mesEnRecorte(config, local), sumas })
    return 'ok' in r ? { ok: true, fecha: local.fecha } : r
  } catch (e) {
    return { no: `no he podido comprobar la suma de presupuestos (${e instanceof Error ? e.message.slice(0, 150) : 'error'})` }
  }
}

/** Tras REACTIVAR una campaña: su fila de hoy de `ads_presupuesto_dia` pasa a ENABLED, para que las sumas de las siguientes subidas (antes de que vigilar relea) la cuenten. Nunca lanza */
export async function anotarCampanaActivaHoy(perfilId: string, campaignId: string, fecha: string): Promise<void> {
  try {
    const { error } = await createServiceClient().from('ads_presupuesto_dia').update({ estado_campana: 'ENABLED' }).eq('perfil_id', perfilId).eq('campaign_id', campaignId).eq('fecha_local', fecha)
    if (error) console.error(`[agente] no se ha podido anotar la campaña reactivada ${campaignId}:`, error.message)
  } catch (e) {
    console.error(`[agente] no se ha podido anotar la campaña reactivada ${campaignId}:`, e instanceof Error ? e.message : e)
  }
}

/** Tras escribir un presupuesto en Amazon (al aplicar o al DESHACER), el nuevo a la fila de hoy (`fecha` local) de `ads_presupuesto_dia` (si la hay). Nunca lanza */
export async function anotarPresupuestoDeHoy(perfilId: string, campaignId: string, fecha: string, presupuesto: number): Promise<void> {
  try {
    const { error } = await createServiceClient().from('ads_presupuesto_dia').update({ presupuesto }).eq('perfil_id', perfilId).eq('campaign_id', campaignId).eq('fecha_local', fecha)
    if (error) console.error(`[agente] no se ha podido anotar el presupuesto nuevo de ${campaignId}:`, error.message)
  } catch (e) {
    console.error(`[agente] no se ha podido anotar el presupuesto nuevo de ${campaignId}:`, e instanceof Error ? e.message : e)
  }
}

/** Cuántos REVISAR caducados por falta de etiqueta en un día abren un evento en la línea de tiempo */
const SIN_ETIQUETA_PARA_AVISAR = 10
const TITULO_SIN_ETIQUETAS = 'Términos REVISAR sin etiqueta de la IA'

/**
 * Si hoy (día local) ya van `SIN_ETIQUETA_PARA_AVISAR` o más REVISAR caducados porque la IA no los ha etiquetado, lo deja UNA vez al día en la línea de tiempo: si la IA
 * cae un fin de semana o llega al tope del mes, esos términos ya no se negativizan a ciegas, pero tampoco se resuelven, y alguien tiene que saberlo. Va con el tipo
 * «ia_fallo» (el tipo nuevo necesitaría tocar el CHECK de la tabla) y se distingue por el título. Nunca lanza.
 */
async function avisarSinEtiquetas(perfilId: string, inicioDelDiaIso: string): Promise<void> {
  try {
    const db = createServiceClient()
    const { count, error } = await db
      .from('ads_propuestas')
      .select('id', { count: 'exact', head: true })
      .eq('perfil_id', perfilId)
      .eq('tipo', 'negativizar')
      .eq('estado', 'caducada')
      .gte('resuelta_at', inicioDelDiaIso)
      .like('error', `%${MOTIVO_SIN_ETIQUETA}%`)
    if (error || (count ?? 0) < SIN_ETIQUETA_PARA_AVISAR) return
    const { count: ya, error: eYa } = await db
      .from('ads_agente_eventos')
      .select('id', { count: 'exact', head: true })
      .eq('perfil_id', perfilId)
      .eq('tipo', 'ia_fallo')
      .eq('titulo', TITULO_SIN_ETIQUETAS)
      .gte('creado_at', inicioDelDiaIso)
    if (eYa || (ya ?? 0) > 0) return
    await anotarEvento(
      perfilId,
      'ia_fallo',
      TITULO_SIN_ETIQUETAS,
      `Hoy van ${count} términos REVISAR que la IA no ha podido etiquetar en ${AGENTE.IA_HORAS_ESPERA} h: no los negativizo a ciegas. Se volverán a proponer; mira si la IA falla o ha llegado al tope del mes.`,
      { motivo: 'ia_sin_etiquetas', caducados: count },
    )
  } catch (e) {
    console.error(`[agente] aviso de REVISAR sin etiqueta de ${perfilId}:`, e instanceof Error ? e.message : e)
  }
}

/**
 * APLICA COMO AGENTE en una cuenta (§6.1). Nunca pasa de `hastaMs − 15 s` ni de 8 aplicaciones; antes de cada una relee la parada general, el estado y lo hecho hoy.
 * Lanza solo si falla lo de antes de empezar (sin la 315, por ejemplo); un fallo en una propuesta se cuenta y se sigue con la siguiente.
 */
export async function aplicarComoAgente(cuenta: CuentaParaSincronizar, config: ConfigDelAgente, hastaMs: number, ahora: number): Promise<ResultadoDeAplicar> {
  const r: ResultadoDeAplicar = { aplicadas: 0, ensayadas: 0, retenidas: 0, descartadas: 0, caducadas: 0, fallidas: 0, erroresQueCuentan: 0 }
  const perfilId = cuenta.id
  const sinTiempo = () => Date.now() > hastaMs - AGENTE.MARGEN_FIN_APLICAR_MS

  // ---- 1. modo, estado y parada general ----
  if (config.estado !== 'ensayo' && config.estado !== 'activo') return r
  const [modo, parada] = await Promise.all([leerModo(perfilId), paradaGeneral()])
  if (modo !== 'agente' || parada.parado) return r
  const enEnsayo = config.estado === 'ensayo'
  // Sin un vigilar que haya TERMINADO bien hace poco, el freno no está evaluado (gasto, ACoS, errores, datos viejos): no se escribe nada en Amazon. En ensayo no escribe y sigue
  if (!enEnsayo && !vigilarReciente(config.vigilarOkAt, ahora)) {
    console.warn(`[agente] ${perfilId}: sin un vigilar bueno en ${AGENTE.VIGILAR_OK_MAX_MIN} min (último: ${config.vigilarOkAt ?? 'nunca'}): no aplico`)
    return r
  }

  // ---- 2. pendientes libres ----
  const pendientes = await pendientesLibres(perfilId, PENDIENTES_A_MIRAR)
  if (pendientes.length === 0) return r

  // ---- datos de la cuenta (solo base de datos) ----
  const l = await leerCuenta(perfilId, config, ahora, 35)
  const zona = l.perfil.zona
  const local = horaLocal(ahora, zona)
  // Un fallo al leer el stock NO es «stock desconocido» (que dejaría pasar subidas en productos sin cobertura): con `ok: false` las subidas esperan (stockSinLeer)
  const [lecturaDeStock, errores7] = await Promise.all([
    leerStockPorAsin(perfilId).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e), porAsin: new Map<string, StockDeAsin>() })),
    erroresRecientes(perfilId, ahora),
  ])
  const stock = lecturaDeStock.porAsin
  if (!lecturaDeStock.ok) console.warn(`[agente] ${perfilId}: no he podido leer el stock (${lecturaDeStock.error}): las subidas esperan`)

  // ---- 3. topes de hoy con la rampa ----
  const rampaLocal = config.rampaDesde ? horaLocal(Date.parse(config.rampaDesde), zona).fecha : null
  const hoyTopes = topesDelDia(config.topes, { enEnsayo, diaRampa: enEnsayo ? null : diaDeRampa(rampaLocal, local.fecha), cuentaPequena: l.cuentaPequena, erroresRecientes: errores7 })

  const ritmoDeEsteMes = config.ritmoFecha && config.ritmoFecha.slice(0, 7) === local.mes ? config.ritmo : 'normal'
  const cuentaDecide: CuentaParaDecidir = {
    ahora,
    rampa: { soloBajadas: hoyTopes.soloBajadas, sinPresupuestoSubir: hoyTopes.sinPresupuestoSubir && !l.cuentaPequena },
    cuentaPequena: l.cuentaPequena,
    ritmoRecorte: ritmoDeEsteMes === 'recorte',
    techoNulo: l.techoMes == null,
    eventoPosterior: l.evento?.fase === 'posterior' ? l.evento.nombre : null,
    topePuja: config.pujaMax ?? AGENTE.PUJA_MAX_ABSOLUTA,
    gastoDesconocido: Boolean(config.usoError),
    inicioDelDiaLocal: Date.parse(inicioDelDiaLocal(local.fecha, zona)),
    stockSinLeer: !lecturaDeStock.ok,
  }

  // Productos: postura, defensivo, marca, fase, gasto 30 d, stock y cobertura
  const desde30 = desplazar(l.hasta, -29)
  const gastoPorAsin = new Map<string, number>()
  for (const f of l.rendimiento) {
    if (f.fecha < desde30 || f.fecha > l.hasta) continue
    const a = asinDeCampana(f.nombre)
    if (a) gastoPorAsin.set(a, (gastoPorAsin.get(a) ?? 0) + f.gasto)
  }
  const productoDe = new Map<string, ProductoParaDecidir & { nombre: string }>()
  for (const prod of l.productos) {
    const st = stock.get(prod.asin)?.stock ?? null
    const stockAt = stock.get(prod.asin)?.actualizadoAt ?? null
    productoDe.set(prod.asin, {
      nombre: prod.nombre,
      postura: prod.postura,
      soloDefensivo: prod.soloDefensivo,
      marca: prod.marca,
      fase: prod.fase,
      gasto30: Math.round((gastoPorAsin.get(prod.asin) ?? 0) * 100) / 100,
      stock: st,
      coberturaDias: coberturaDias(st, l.ventas.v14[prod.asin]?.unidades ?? null),
      acosObjetivoPct: prod.acosObjetivoPct,
      precio: prod.precio,
      stockViejo: st != null && stockEsViejo(stockAt, ahora),
    })
  }
  const productoDeP = (p: Propuesta) => (p.asin ? productoDe.get(p.asin.toUpperCase()) ?? null : null)
  const conUbicacionAlta = [...new Set(pendientes.filter((p) => p.metricas?.ubicacionAlta === true).map((p) => p.campaignId))]

  // ---- 4–7. decidir cada pendiente ----
  let validacion: { ok: boolean } | null = null
  const planes: Array<{ p: Propuesta; d: Extract<DecisionDelAgente, { accion: 'aplicar' }> }> = []
  let rarasEsperando = 0
  let sinEtiqueta = 0
  for (const p of pendientes) {
    if (sinTiempo()) break
    const prod = productoDeP(p)
    let termino: DatosDeTermino | null = null
    let pujaLeida: number | null = null
    try {
      if (esRevisar({ tipo: p.tipo, motivo: p.motivo, metricas: p.metricas as unknown as Record<string, unknown> })) {
        if (!validacion) validacion = await validacionDeLaIa(perfilId)
        const asin = p.asin ? p.asin.toUpperCase() : null
        const [etiquetaLeida, pedidosHistoricos] = await Promise.all([
          // Si falla la lectura, 'error' (no null): decidirPropuesta espera en vez de tomarlo por «la IA no lo ha mirado»
          asin
            ? etiquetaVigente(perfilId, asin, p.termino, prod ? hashDeTitulo(prod.nombre) : null, ahora).catch((e: unknown) => {
                console.error(`[agente] etiqueta de la IA de «${p.termino}» (${perfilId}):`, e instanceof Error ? e.message : e)
                return 'error' as const
              })
            : Promise.resolve(null),
          // Si falla, null: decidirPropuesta no negativiza sin saber si ha vendido
          pedidosHistoricosDeTermino(perfilId, asin, p.termino).catch((e: unknown) => {
            console.error(`[agente] pedidos históricos de «${p.termino}» (${perfilId}):`, e instanceof Error ? e.message : e)
            return null
          }),
        ])
        termino = { etiqueta: etiquetaLeida === 'error' ? null : etiquetaLeida, pedidosHistoricos, validacionOk: validacion.ok, etiquetaError: etiquetaLeida === 'error' }
      } else if (p.tipo === 'pausar' && p.iaDecision === 'aplicar' && p.valorActual == null && p.objetivoId && (p.objetivoTipo === 'keyword' || p.objetivoTipo === 'producto') && !/Forma reducida/.test(p.motivo)) {
        // Pausa rara aprobada por la IA: la forma reducida es bajar la puja un 25 %; la de ahora se lee en Amazon (solo lectura)
        try {
          pujaLeida = (await leerPujaActual(cuenta, p.objetivoTipo, p.objetivoId))?.puja ?? null
        } catch {
          pujaLeida = null
        }
      }
      const d0 = decidirPropuesta(paraDecidir(p), cuentaDecide, prod, { termino, pujaLeida, campanasConUbicacionAlta: conUbicacionAlta })
      const d = decisionDeReintento(p.error, d0)
      if (d.accion === 'aplicar') planes.push({ p, d })
      else if (d.accion === 'retener') {
        await marcarRetenida(perfilId, p.id, d.motivo)
        r.retenidas += 1
      } else if (d.accion === 'descartar') {
        await descartarComoAgente(perfilId, p.id, d.motivo)
        r.descartadas += 1
      } else if (d.accion === 'caducar') {
        await caducarComoAgente(perfilId, p.id, d.motivo)
        r.caducadas += 1
        if (d.motivo.startsWith(MOTIVO_SIN_ETIQUETA)) sinEtiqueta += 1
      } else if (/^Rara/.test(d.motivo)) rarasEsperando += 1
    } catch (e) {
      r.fallidas += 1
      console.error(`[agente] decidir la propuesta ${p.id} de ${perfilId}:`, e instanceof Error ? e.message : e)
    }
  }
  // El contador de raras que esperan a la IA (el cerebro de la tarde lo mira)
  if (rarasEsperando !== config.rarasSinIa) await actualizarAgente(perfilId, { raras_sin_ia: rarasEsperando }).catch(() => undefined)
  if (sinEtiqueta > 0) await avisarSinEtiquetas(perfilId, inicioDelDiaLocal(local.fecha, zona))

  if (planes.length === 0) return r

  // ---- sumas de presupuesto (solo si hay alguna subida de presupuesto que aplicar). Solo con la lectura de HOY: sin ella, las subidas esperan (limitarPresupuestoAhora) ----
  const sumas: SumasDePresupuesto | null = planes.some((x) => x.d.clase === 'presupuesto_subir' || x.d.clase === 'presupuesto_bajar') ? await sumasDeHoy(perfilId, config, l, local.fecha) : null

  // ---- 8–12. aplicar en orden ----
  const inicioDelDia = inicioDelDiaLocal(local.fecha, zona)
  let intentos = 0
  let erroresSeguidos = 0
  for (const { p, d } of ordenarParaAplicar(planes.map((x) => ({ ...x, orden: x.d.orden, gasto: x.d.gasto })))) {
    if (intentos >= AGENTE.MAX_APLICAR_POR_PASADA || sinTiempo()) break
    if (erroresSeguidos >= AGENTE.FRENO_ERRORES_SEGUIDOS) break

    // 9. justo antes: parada general, estado del agente y lo hecho hoy
    const [paradaAhora, configAhora, hechos] = await Promise.all([paradaGeneral(), leerConfigDelAgente(perfilId), hechosDeHoy(perfilId, inicioDelDia)])
    if (paradaAhora.parado || !configAhora || configAhora.estado !== config.estado) break
    if (!quedaTope(d.clase, hechos, hoyTopes.topes)) continue

    // Guardarraíl del presupuesto con la suma de AHORA. Falla cerrado: sin sumas o sin valores, la subida no se aplica
    let valorNuevo = d.valorNuevo
    let nota = d.nota
    if (d.clase === 'presupuesto_subir') {
      if (!sumas || !finito(p.valorActual) || !finito(p.valorNuevo)) continue
      const g = limitarPresupuestoAhora(p.valorActual, valorNuevo ?? p.valorNuevo, sumas, p.campaignId)
      if ('esperar' in g) continue
      if ('retener' in g) {
        try {
          await marcarRetenida(perfilId, p.id, g.retener)
          r.retenidas += 1
        } catch (e) {
          console.error(`[agente] retener ${p.id}:`, e instanceof Error ? e.message : e)
        }
        continue
      }
      if (g.nota) {
        valorNuevo = g.valor
        nota = nota ? `${nota} · ${g.nota}` : g.nota
      }
    }

    intentos += 1
    try {
      // Lo que la decisión cambia se guarda en la propuesta antes de aplicarla (queda en el motivo)
      if (valorNuevo != null && (valorNuevo !== p.valorNuevo || d.tipoNuevo)) await ajustarValorNuevo(perfilId, p.id, valorNuevo, nota ?? 'Ajustada por el agente', d.tipoNuevo ?? undefined, d.valorActualNuevo ?? undefined)
      if (d.concordanciaExacta) await ajustarConcordancia(perfilId, p.id, 'NEGATIVE_EXACT')

      if (enEnsayo) {
        const e = await ensayarComoAgente(cuenta, p.id, { pujaMaxima: d.pujaMaxima })
        if (e.ok) {
          r.ensayadas += 1
          erroresSeguidos = 0
          // El ensayo mueve las sumas como lo haría la escritura real (una subida financiada tras su donante cabe igual que en activo)
          if (sumas && p.tipo === 'presupuesto' && finito(p.valorActual)) {
            const despues = valorNuevo ?? p.valorNuevo
            if (finito(despues)) moverSumas(sumas, p.campaignId, p.valorActual, despues)
          }
        } else {
          r.fallidas += 1
          const tipo = tipoDeFallo(e.error ?? '')
          // En ensayo, lo que no se puede aplicar por los datos (obsoleta, le falta algo) se deja para una persona: si no, volvería en cada pasada
          if (tipo === 'validacion') {
            await marcarRetenida(perfilId, p.id, `Ensayo: ${(e.error ?? 'no se ha podido recorrer').slice(0, 300)}`).catch(() => undefined)
            r.retenidas += 1
          }
        }
        continue
      }

      const hecha = await aplicarPropuesta(cuenta, p.id, {
        userId: null,
        automatica: true,
        origen: 'agente',
        iaAprueba: d.iaAprueba,
        pujaMaxima: d.pujaMaxima,
        contexto: { modo: 'agente', fichaFirmada: Boolean(l.ficha.firmadaAt), aplicadasHoy: 0, topeDiario: Number.MAX_SAFE_INTEGER },
      })
      erroresSeguidos = 0
      if (hecha.estado === 'aplicada') {
        r.aplicadas += 1
        if (sumas && hecha.tipo === 'presupuesto' && finito(hecha.valorActual) && finito(hecha.valorNuevo)) moverSumas(sumas, hecha.campaignId, hecha.valorActual, hecha.valorNuevo)
        // El presupuesto nuevo, a la fila de hoy de `ads_presupuesto_dia`: la pasada siguiente de aplicar suma con él (vigilar solo relee cada 30 min)
        if (hecha.tipo === 'presupuesto' && finito(hecha.valorNuevo)) await anotarPresupuestoDeHoy(perfilId, hecha.campaignId, local.fecha, hecha.valorNuevo)
        const prod = productoDeP(hecha)
        await abrirEfecto(perfilId, hecha, {
          acosObjetivoPct: prod?.acosObjetivoPct ?? null,
          // cvrPct va en % (0,8 = 0,8 %): abrirEfecto lo quiere en fracción (0,008)
          cvr: cvrDeMetricas(hecha.metricas as unknown as Record<string, unknown>),
          fase: prod?.fase ?? 'normal',
          raraAplicada: d.raraAplicada,
          zona,
        })
        if (!config.primeraEscrituraAt) await marcarPrimeraEscritura(perfilId, hecha, Date.now())
      }
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e)
      r.fallidas += 1
      const tipo = tipoDeFallo(mensaje)
      if (tipo === 'transporte') {
        if (queHacerTrasFalloDeTransporte(p.tipo, datosDelError(mensaje).httpStatus) === 'retener') {
          if (await retenerTrasFalloDeRed(perfilId, p.id, mensaje)) r.retenidas += 1
        } else await volverAPendiente(perfilId, p.id, mensaje, p.tipo === 'puja' || p.tipo === 'presupuesto' ? valorNuevo ?? p.valorNuevo : null)
      } else if (tipo === 'autorizacion') {
        r.erroresQueCuentan += 1
        erroresSeguidos += 1
      }
      console.error(`[agente] aplicar ${p.id} de ${perfilId} (${tipo}):`, mensaje)
    }
  }
  return r
}
