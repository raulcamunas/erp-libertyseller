/**
 * ENVÍOS PROPUESTOS: AGRUPAR LÍNEAS DEL PLAN Y RECONCILIAR CON LO GUARDADO
 * (spec remesas-pro §2.7 y §2.8, corregidos por §11 D22 y D34).
 *
 * Todo puro: `hoy` llega inyectado, no hay `Date.now()` ni base de datos. El
 * recálculo de una línea con otra fecha de salida lo hace el planificador y
 * llega como función (`recalcular`), así este fichero no importa planificador.ts.
 *
 * - `agruparEnvios`: líneas propuestas → envíos (ventana, adelantar para
 *   aprovechar el viaje, fundir los pequeños, capacidad de Amazon y cifras por envío).
 * - `reconciliarEnvios`: lo calculado hoy frente a lo guardado → qué insertar,
 *   actualizar, caducar o marcar. Sin efectos: lo aplica el servidor (S1).
 *   Nunca toca `version`: eso solo lo suben las acciones humanas (D23).
 */
import type {
  AjustesReposicion, CambiosDesdeAyer, Confianza, EnvioGuardadoMinimo, EnvioPropuestoCalculado,
  EstadoEnvioPropuesto, FnAgruparEnvios, FnReconciliarEnvios, LineaPlan, Moneda, PlazoEtapas, Prioridad,
  RemesaSinSalirDeLinea, ResultadoReconciliacion,
} from './plan-tipos'
import { ESTADOS_ACTIVOS } from './plan-tipos'

/* ------------------------------ Constantes ------------------------------ */

/** Orden de gravedad: cuanto más bajo, más urgente */
export const RANGO_PRIORIDAD: Record<Prioridad, number> = {
  tarde: 0, urgente: 1, esta_semana: 2, proximas_2: 3, este_mes: 4, mas_adelante: 5,
}
const RANGO_CONFIANZA: Record<Confianza, number> = { sin_datos: 0, baja: 1, media: 2, alta: 3 }

/** Hasta cuántos días antes de su fecha se sube una línea (o un envío pequeño) a un envío anterior */
export const DIAS_ADELANTAR = 21
/** Un envío en preparación sin remesa es huérfano solo si lleva así al menos estos minutos (convertir tarda unos segundos) */
export const MINUTOS_HUERFANO = 10
/** Unidades por caja cuando no se sabe la caja («~») */
export const UNIDADES_CAJA_APROX = 40
/** Días que dura la cuarentena de un descarte */
export const DIAS_CUARENTENA = 14
/** Solapamiento de SKU para reutilizar una fila guardada con otra clave */
export const SOLAPAMIENTO_MINIMO = 0.5
/** Cambio de unidades que merece apunte en el historial */
export const CAMBIO_UNIDADES_HISTORIAL = 0.1

const NOMBRE_PRIORIDAD: Record<Prioridad, string> = {
  tarde: 'tarde', urgente: 'urgente', esta_semana: 'esta semana', proximas_2: 'próximas 2 semanas',
  este_mes: 'este mes', mas_adelante: 'más adelante',
}

/* ------------------------------ Fechas y formato ------------------------------ */

function aUtc(fecha: string): number {
  const [a, m, d] = fecha.slice(0, 10).split('-').map(Number)
  return Date.UTC(a, m - 1, d)
}
function deUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
export function sumarDias(fecha: string, dias: number): string {
  return deUtc(aUtc(fecha) + dias * 86_400_000)
}
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((aUtc(hasta) - aUtc(desde)) / 86_400_000)
}
const minFecha = (a: string, b: string) => (a <= b ? a : b)
const maxFecha = (a: string, b: string) => (a >= b ? a : b)

/** Semana ISO 8601 de una fecha YYYY-MM-DD: el año ISO puede no ser el del calendario (29 dic → W01 del siguiente) */
export function semanaIso(fecha: string): { ano: number; semana: number } {
  const ms = aUtc(fecha)
  const diaSemana = (new Date(ms).getUTCDay() + 6) % 7 // lunes 0 … domingo 6
  const jueves = new Date(ms + (3 - diaSemana) * 86_400_000)
  // La semana ISO es la de su jueves: el día del año de ese jueves dice el número de semana
  const ano = jueves.getUTCFullYear()
  const diaDelAno = Math.round((jueves.getTime() - Date.UTC(ano, 0, 1)) / 86_400_000)
  return { ano, semana: Math.floor(diaDelAno / 7) + 1 }
}

/** `env:<cliente>:<conexión>:<año ISO>-W<nn>` (D34). Sin conexión, «sin-conexion». */
export function claveDeEnvio(clienteId: string, connectionId: string | null, salida: string): string {
  const { ano, semana } = semanaIso(salida)
  return `env:${clienteId}:${connectionId ?? 'sin-conexion'}:${ano}-W${String(semana).padStart(2, '0')}`
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
/** «3 dic» */
export function fechaCorta(fecha: string): string {
  const [, m, d] = fecha.slice(0, 10).split('-').map(Number)
  return `${d} ${MESES[m - 1]}`
}
/** 1200 → «1.200» (Intl es-ES no agrupa los de 4 cifras) */
export function numero(n: number): string {
  const entero = Math.round(n)
  const signo = entero < 0 ? '-' : ''
  return signo + String(Math.abs(entero)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}
export function simboloMoneda(moneda: Moneda): string {
  const s: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' }
  return s[moneda] ?? moneda
}

/* ------------------------------ Ayudas de línea ------------------------------ */

function ritmoDe(l: LineaPlan): number {
  return l.ritmo.previsto ?? l.ritmo.base ?? 0
}
/** Mínimo útil (§2.5 paso 3): max(minLinea, una semana de ventas) */
export function minimoUtil(l: LineaPlan, ajustes: Pick<AjustesReposicion, 'minLinea'>): number {
  return Math.max(ajustes.minLinea, Math.ceil(ritmoDe(l) * 7))
}
function esPropuesta(l: LineaPlan): boolean {
  return l.fuera === null && l.cantidad > 0 && l.prioridad !== 'mas_adelante' && !!l.salirAntesDe
}
function esCandidataAdelantar(l: LineaPlan): boolean {
  return !!l.salirAntesDe && !l.avisos.includes('devoluciones_altas')
    && (l.fuera === 'aun_no_toca' || (l.fuera === null && l.prioridad === 'mas_adelante'))
}
function conAviso(l: LineaPlan, aviso: LineaPlan['avisos'][number]): LineaPlan {
  return l.avisos.includes(aviso) ? l : { ...l, avisos: [...l.avisos, aviso] }
}
function pesoOrden(l: LineaPlan): number {
  return l.eurosEnRiesgo ?? l.cantidad * ritmoDe(l)
}
function ordenarLineas(lineas: LineaPlan[]): LineaPlan[] {
  return [...lineas].sort((a, b) =>
    RANGO_PRIORIDAD[a.prioridad] - RANGO_PRIORIDAD[b.prioridad]
    || (b.eurosEnRiesgo ?? -1) - (a.eurosEnRiesgo ?? -1)
    || pesoOrden(b) - pesoOrden(a)
    || a.sku.localeCompare(b.sku))
}

/**
 * Sube una línea a una salida anterior. Si el recálculo a esa salida dice que ya no hace falta nada (cantidad 0 o fuera), la
 * línea NO entra en este envío: ya saldrá en el suyo (devuelve null). Solo se queda si corre prisa (tarde o urgente) y entonces
 * con las fechas de esta salida y la frase rehecha con ellas, para que nunca diga «antes del 7 dic» en el envío del 23 nov.
 */
function recalcularSegura(l: LineaPlan, salida: string, recalcular: (l: LineaPlan, s: string) => LineaPlan, preparacion: number): LineaPlan | null {
  if (!l.salirAntesDe || l.salirAntesDe <= salida) return l
  const r = recalcular(l, salida)
  if (r.cantidad > 0 && (r.fuera === null || r.fuera === 'aun_no_toca')) return { ...r, fuera: null }
  if (l.prioridad !== 'tarde' && l.prioridad !== 'urgente') return null
  const decidir = sumarDias(salida, -Math.max(0, preparacion))
  const porque = l.porque.replace(/(Mandando [\d.,]+ ud antes del )(\d+ \S+?)(?=[ .])/, (_m, a: string) => `${a}${fechaCorta(salida)}`)
  return {
    ...l,
    salirAntesDe: salida,
    decidirAntesDe: l.decidirAntesDe && l.decidirAntesDe < decidir ? l.decidirAntesDe : decidir,
    porque,
  }
}

/* ------------------------------ Agrupar ------------------------------ */

interface Grupo { salida: string; lineas: LineaPlan[]; notas: string[] }

function esUrgente(g: Grupo): boolean {
  return g.lineas.some((l) => l.prioridad === 'tarde' || l.prioridad === 'urgente')
}
const unidadesDe = (lineas: Array<{ cantidad: number }>) => lineas.reduce((s, l) => s + l.cantidad, 0)

/** Lo que el agrupador deja fuera de los envíos: sku → la frase de por qué (la línea pasa a «aún no toca») */
export type Apartadas = Map<string, string>

/**
 * Mete las líneas de `de` en `en` (la salida más temprana manda); las que se adelantan se recalculan. Las que con la salida
 * anterior ya no hacen falta se apartan (saldrán en su envío).
 */
function fundir(en: Grupo, de: Grupo, recalcular: (l: LineaPlan, s: string) => LineaPlan, marcarAdelantada: boolean, preparacion: number, apartadas: Apartadas): Grupo {
  const salida = minFecha(en.salida, de.salida)
  const mover = (g: Grupo, adelantar: boolean) => g.lineas.flatMap((l) => {
    if (!l.salirAntesDe || l.salirAntesDe <= salida) return [l]
    const r = recalcularSegura(l, salida, recalcular, preparacion)
    if (!r) {
      apartadas.set(l.sku, `Con el envío del ${fechaCorta(salida)} aún no hace falta mandar nada: toca más adelante (antes del ${fechaCorta(l.salirAntesDe)}).`)
      return []
    }
    return [adelantar && (diasEntre(salida, l.salirAntesDe) > 0) ? conAviso({ ...r, adelantada: true }, 'adelantada') : r]
  })
  return {
    salida,
    lineas: [...mover(en, marcarAdelantada && en.salida > salida), ...mover(de, marcarAdelantada && de.salida > salida)],
    notas: [...en.notas, ...de.notas],
  }
}

export const agruparEnvios: FnAgruparEnvios = (lineas, clienteId, connectionId, hoy, ajustes, plazo, recalcular, ocupado, ajustarModelo, apartadasFuera) => {
  const ventana = Math.max(0, ajustes.ventanaAgrupacion)
  const apartadas: Apartadas = apartadasFuera ?? new Map()
  const prep = plazo.preparacion
  const propuestas = lineas.filter(esPropuesta)
    .sort((a, b) => a.salirAntesDe!.localeCompare(b.salirAntesDe!) || RANGO_PRIORIDAD[a.prioridad] - RANGO_PRIORIDAD[b.prioridad] || a.sku.localeCompare(b.sku))

  // 1-3 · Ancla y ventana
  let grupos: Grupo[] = []
  let i = 0
  while (i < propuestas.length) {
    const salida = propuestas[i].salirAntesDe!
    const limite = sumarDias(salida, ventana)
    const g: Grupo = { salida, lineas: [], notas: [] }
    while (i < propuestas.length && propuestas[i].salirAntesDe! <= limite) {
      const r = recalcularSegura(propuestas[i], salida, recalcular, prep)
      // Con esta salida no hace falta: abre su propio envío (en su fecha)
      if (!r) break
      g.lineas.push(r)
      i++
    }
    grupos.push(g)
  }

  // 4 · Adelantar lo que aún no toca para aprovechar el viaje
  const yaDentro = new Set(propuestas.map((l) => l.sku))
  const candidatas = lineas.filter((l) => esCandidataAdelantar(l) && !yaDentro.has(l.sku))
    .sort((a, b) => a.salirAntesDe!.localeCompare(b.salirAntesDe!) || a.sku.localeCompare(b.sku))
  for (const c of candidatas) {
    const g = grupos.find((x) => c.salirAntesDe! > x.salida && diasEntre(x.salida, c.salirAntesDe!) <= DIAS_ADELANTAR)
    if (!g) continue
    const r = recalcular(c, g.salida)
    if (r.cantidad <= 0 || r.avisos.includes('devoluciones_altas')) continue
    if (r.fuera !== null && r.fuera !== 'aun_no_toca') continue
    if (r.cantidad < minimoUtil(r, ajustes)) continue
    g.lineas.push(conAviso({ ...r, fuera: null, adelantada: true }, 'adelantada'))
  }

  // 5 · Fundir los envíos pequeños (no urgentes) con el siguiente; el último, con el anterior.
  //     Solo si están a ≤ 21 días (no se adelanta un envío dos meses) y sin líneas con devoluciones altas que adelantar.
  const minEnvio = Math.max(0, ajustes.minEnvio)
  let cambiado = true
  while (cambiado) {
    cambiado = false
    for (let k = 0; k < grupos.length; k++) {
      const g = grupos[k]
      if (unidadesDe(g.lineas) >= minEnvio || esUrgente(g)) continue
      const pareja = k + 1 < grupos.length ? k + 1 : k - 1
      if (pareja < 0) continue
      const [antes, despues] = pareja > k ? [g, grupos[pareja]] : [grupos[pareja], g]
      if (diasEntre(antes.salida, despues.salida) > DIAS_ADELANTAR) continue
      if (despues.lineas.some((l) => l.avisos.includes('devoluciones_altas') && l.salirAntesDe! > antes.salida)) continue
      const fundido = fundir(antes, despues, recalcular, true, prep, apartadas)
      grupos.splice(Math.min(k, pareja), 2, fundido)
      cambiado = true
      break
    }
  }

  // Dos envíos en la misma semana ISO darían la misma clave (ventana < 7): se juntan
  const porClave = new Map<string, Grupo>()
  for (const g of grupos) {
    const clave = claveDeEnvio(clienteId, connectionId, g.salida)
    const previo = porClave.get(clave)
    porClave.set(clave, previo ? fundir(previo, g, recalcular, false, prep, apartadas) : g)
  }
  grupos = [...porClave.values()].sort((a, b) => a.salida.localeCompare(b.salida))

  // Las tallas recalculadas a la salida del envío vuelven sueltas: se cuadra otra vez el modelo dentro de cada envío
  // (caja y mínimo del modelo). Si el modelo ya no llega al mínimo en este envío, se quedan como estaban (no se pierden).
  if (ajustarModelo) {
    for (const g of grupos) {
      const ajustadas = ajustarModelo(g.lineas)
      const vivosPorModelo = new Map<string, number>()
      for (const l of ajustadas) if (l.modelo && l.fuera === null && l.cantidad > 0) vivosPorModelo.set(l.modelo, (vivosPorModelo.get(l.modelo) ?? 0) + 1)
      g.lineas = ajustadas
        // El modelo entero se cae (no llega al mínimo en este envío): sus tallas se quedan como venían
        .map((l, i) => (l.modelo && !vivosPorModelo.has(l.modelo) ? g.lineas[i] : l))
        // Una talla que se quita al redondear el modelo a la caja sale del envío
        .filter((l) => l.fuera === null && l.cantidad > 0)
    }
  }

  // Un envío pequeño que no corre prisa, no se ha podido juntar con otro y no tiene ventas en juego no es un envío: un viaje
  // aparte por 12 unidades que no corren prisa no se propone. Sus líneas pasan a «aún no toca» (salen en la previsión) hasta que
  // se puedan juntar o corran prisa. Si hay euros en juego se propone, con la nota «Envío pequeño».
  grupos = grupos.filter((g) => {
    const u = unidadesDe(g.lineas)
    if (u <= 0 || u >= minEnvio || esUrgente(g)) return true
    const euros = g.lineas.reduce((t, l) => t + Math.max(0, l.eurosEnRiesgo ?? 0), 0)
    if (euros > 0) return true
    for (const l of g.lineas) {
      apartadas.set(l.sku, `Para el ${fechaCorta(g.salida)} solo saldrían ${numero(u)} ud (el mínimo del cliente es ${numero(minEnvio)}) y no corre prisa: no compensa un envío aparte; irá con el siguiente o cuando corra prisa.`)
    }
    return false
  })
  for (const g of grupos) {
    const u = unidadesDe(g.lineas)
    if (u > 0 && u < minEnvio) g.notas.push(`Envío pequeño: ${numero(u)} ud (el mínimo del cliente es ${numero(minEnvio)})`)
  }

  // 6 · Capacidad de Amazon
  if (ajustes.capacidadUnidades !== null && ajustes.capacidadUnidades !== undefined) {
    const hueco = Math.max(0, ajustes.capacidadUnidades - Math.max(0, ocupado))
    const total = grupos.reduce((s, g) => s + unidadesDe(g.lineas), 0)
    if (total > hueco) {
      const todas = grupos.flatMap((g, gi) => g.lineas.map((l, li) => ({ l, gi, li })))
      todas.sort((a, b) => RANGO_PRIORIDAD[a.l.prioridad] - RANGO_PRIORIDAD[b.l.prioridad]
        || (b.l.eurosEnRiesgo ?? -1) - (a.l.eurosEnRiesgo ?? -1) || pesoOrden(b.l) - pesoOrden(a.l) || a.l.sku.localeCompare(b.l.sku))
      let queda = hueco
      const nuevas = grupos.map((g) => [...g.lineas])
      const tocados = new Set<number>()
      for (const { l, gi, li } of todas) {
        let cantidad = Math.min(l.cantidad, queda)
        if (cantidad < l.cantidad) {
          const k = l.caja?.unidades ?? 1
          if (k > 1) cantidad = Math.floor(cantidad / k) * k
          if (cantidad < Math.max(1, ajustes.minLinea)) cantidad = 0
          nuevas[gi][li] = conAviso({ ...l, cantidad, cajas: l.caja ? Math.ceil(cantidad / l.caja.unidades) : l.cajas }, 'recortada_capacidad')
          tocados.add(gi)
        }
        queda -= cantidad
      }
      const frase = `Amazon te deja ${numero(hueco)} ud más; se han priorizado las urgentes`
      grupos = grupos.map((g, gi) => ({
        ...g,
        lineas: nuevas[gi].filter((l) => l.cantidad > 0),
        notas: tocados.has(gi) ? [...g.notas, frase] : g.notas,
      })).filter((g) => g.lineas.length > 0)
    }
  }

  // 7 · Cifras por envío
  return grupos.filter((g) => g.lineas.length > 0).map((g) => resumirEnvio(g, clienteId, connectionId, hoy, plazo))
}

/**
 * El aviso del envío cuando sus referencias ya van en una remesa sin salir. Antes cada línea decía «añádelo ahí en vez de crear
 * otra remesa», pero el botón del envío crea siempre otra remesa y una remesa aprobada, encajando o lista ya no admite líneas
 * (`puedeEditarLineas`): la frase prometía algo que la pantalla no deja hacer. Ahora se dice lo que hay y lo que se puede hacer.
 * Puro.
 */
export function avisoRemesasSinSalir(lineas: readonly Pick<LineaPlan, 'sku' | 'cantidad' | 'remesasSinSalir'>[]): string[] {
  const porRemesa = new Map<string, { r: RemesaSinSalirDeLinea; skus: Set<string>; unidades: number }>()
  for (const l of lineas) {
    if (!(l.cantidad > 0)) continue
    for (const r of l.remesasSinSalir ?? []) {
      const x = porRemesa.get(r.remesaId) ?? { r, skus: new Set<string>(), unidades: 0 }
      x.skus.add(l.sku)
      x.unidades += Math.max(0, Math.round(l.cantidad))
      porRemesa.set(r.remesaId, x)
    }
  }
  const frases: string[] = []
  for (const { r, skus, unidades } of [...porRemesa.values()].sort((a, b) => b.skus.size - a.skus.size || a.r.remesaId.localeCompare(b.r.remesaId))) {
    const nombre = r.nombre ? `«${r.nombre}»` : 'una remesa sin salir'
    const refs = `${numero(skus.size)} de estas referencias`
    const sale = r.fechaEnvio ? `, sale ~${fechaCorta(r.fechaEnvio)}` : ''
    if (r.estado === 'borrador') {
      frases.push(`${nombre} (en borrador${sale}) ya lleva ${refs}: puedes sumar estas ${numero(unidades)} ud editando sus líneas en vez de crear otra remesa.`)
    } else {
      const estado = r.estado === 'aprobada' ? 'aprobada' : r.estado === 'encajando' ? 'encajando' : r.estado === 'lista' ? 'lista' : 'en preparación'
      frases.push(`${nombre} (${estado}${sale}) ya lleva ${refs} y no admite más líneas: estas ${numero(unidades)} ud irían en otra remesa. Lo que lleva ya está contado.`)
    }
  }
  return frases
}

function resumirEnvio(g: Grupo, clienteId: string, connectionId: string | null, hoy: string, plazo: PlazoEtapas): EnvioPropuestoCalculado {
  const lineas = ordenarLineas(g.lineas)
  const unidades = unidadesDe(lineas)
  const prioridad = lineas.reduce<Prioridad>((p, l) => (RANGO_PRIORIDAD[l.prioridad] < RANGO_PRIORIDAD[p] ? l.prioridad : p), 'mas_adelante')

  const porDefecto = sumarDias(g.salida, -plazo.preparacion)
  const decidir = lineas.reduce((d, l) => (l.decidirAntesDe ? minFecha(d, l.decidirAntesDe) : d), porDefecto)

  // Cajas: Σ ceil(cantidad / caja); lo que no tiene caja, a 40 por caja y marcado «~»
  let cajasExactas = 0
  let sinCaja = 0
  for (const l of lineas) {
    if (l.caja && l.caja.unidades > 0) cajasExactas += Math.ceil(l.cantidad / l.caja.unidades)
    else sinCaja += l.cantidad
  }
  const cajasAproximadas = sinCaja > 0
  const cajasEstimadas = unidades > 0 ? cajasExactas + (sinCaja > 0 ? Math.ceil(sinCaja / UNIDADES_CAJA_APROX) : 0) : null

  const conEuros = lineas.filter((l) => l.eurosEnRiesgo !== null)
  const eurosEnRiesgo = conEuros.length ? Math.round(conEuros.reduce((s, l) => s + (l.eurosEnRiesgo ?? 0), 0) * 100) / 100 : null

  // Confianza: la peor que reúne (sumando de peor a mejor) al menos el 20 % de las unidades
  let confianza: Confianza = 'alta'
  if (unidades > 0) {
    let acumulado = 0
    for (const c of ['sin_datos', 'baja', 'media', 'alta'] as Confianza[]) {
      acumulado += unidadesDe(lineas.filter((l) => l.ritmo.confianza === c))
      if (acumulado >= unidades * 0.2) { confianza = c; break }
    }
  } else {
    confianza = lineas.reduce<Confianza>((p, l) => (RANGO_CONFIANZA[l.ritmo.confianza] < RANGO_CONFIANZA[p] ? l.ritmo.confianza : p), 'alta')
  }

  const conPorque = [...lineas].filter((l) => l.porque).sort((a, b) => pesoOrden(b) - pesoOrden(a) || a.sku.localeCompare(b.sku))
  // El aviso de remesas sin salir va primero: es lo que decide si se crea otra remesa o no
  const porque = [...avisoRemesasSinSalir(lineas), ...conPorque.slice(0, 3).map((l) => l.porque)]
  if (lineas.length > 3) porque.push(`y ${lineas.length - 3} referencia${lineas.length - 3 === 1 ? '' : 's'} más`)
  porque.push(...g.notas)

  return {
    clave: claveDeEnvio(clienteId, connectionId, g.salida),
    clienteId, connectionId,
    moneda: lineas.find((l) => l.moneda)?.moneda ?? 'EUR',
    salirAntesDe: g.salida,
    decidirAntesDe: maxFecha(decidir, hoy),
    aLaVenta: sumarDias(g.salida, plazo.transporte + plazo.recepcion),
    prioridad, confianza,
    lineas, unidades, cajasEstimadas, cajasAproximadas,
    eurosEnRiesgo, porque,
    provisional: lineas.some((l) => l.avisos.includes('provisional')),
  }
}

/* ------------------------------ Reconciliar ------------------------------ */

function solapamiento(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const sa = new Set(a)
  const comunes = new Set(b.filter((s) => sa.has(s))).size
  return comunes / Math.min(sa.size, new Set(b).size)
}

function unidadesGuardadas(g: EnvioGuardadoMinimo): number {
  return g.lineas.length ? unidadesDe(g.lineas) : g.unidades
}

/** La diferencia entre lo guardado y el plan de hoy, con frases para el panel; null si no cambia nada */
export function cambiosDesdeAyer(g: EnvioGuardadoMinimo, c: EnvioPropuestoCalculado): CambiosDesdeAyer | null {
  const unidadesAntes = unidadesGuardadas(g)
  const frases: string[] = []
  if (unidadesAntes !== c.unidades) frases.push(`${c.unidades > unidadesAntes ? 'Sube' : 'Baja'} de ${numero(unidadesAntes)} a ${numero(c.unidades)} ud`)
  if (g.salirAntesDe && g.salirAntesDe !== c.salirAntesDe) frases.push(`La salida pasa del ${fechaCorta(g.salirAntesDe)} al ${fechaCorta(c.salirAntesDe)}`)
  if (g.prioridad !== c.prioridad) frases.push(`Prioridad: de «${NOMBRE_PRIORIDAD[g.prioridad]}» a «${NOMBRE_PRIORIDAD[c.prioridad]}»`)

  const antes = new Map<string, number>()
  for (const l of g.lineas) antes.set(l.sku, (antes.get(l.sku) ?? 0) + l.cantidad)
  const ahora = new Map<string, number>()
  for (const l of c.lineas) ahora.set(l.sku, (ahora.get(l.sku) ?? 0) + l.cantidad)
  const porSku: string[] = []
  for (const [sku, n] of ahora) {
    const a = antes.get(sku)
    if (a === undefined) porSku.push(`Entra ${sku} (${numero(n)} ud)`)
    else if (a !== n) porSku.push(`${sku}: de ${numero(a)} a ${numero(n)} ud`)
  }
  for (const [sku, a] of antes) if (!ahora.has(sku)) porSku.push(`Sale ${sku} (tenía ${numero(a)} ud)`)
  if (!frases.length && !porSku.length) return null
  const MAX_SKU = 5
  frases.push(...porSku.slice(0, MAX_SKU))
  if (porSku.length > MAX_SKU) frases.push(`y ${porSku.length - MAX_SKU} cambios más`)

  return {
    unidadesAntes, unidadesAhora: c.unidades,
    salidaAntes: g.salirAntesDe || null, salidaAhora: c.salirAntesDe,
    prioridadAntes: g.prioridad, prioridadAhora: c.prioridad,
    frases,
  }
}

function pideHistorial(g: EnvioGuardadoMinimo, c: EnvioPropuestoCalculado): boolean {
  if (g.prioridad !== c.prioridad) return true
  const antes = unidadesGuardadas(g)
  if (antes === 0) return c.unidades !== 0
  return Math.abs(c.unidades - antes) / antes > CAMBIO_UNIDADES_HISTORIAL
}

/** Solo para comparar: el calculado con las líneas guardadas que el plan ya no trae (las del propio hablado) */
function conLasPropias(c: EnvioPropuestoCalculado, g: EnvioGuardadoMinimo): EnvioPropuestoCalculado {
  const hay = new Set(c.lineas.map((l) => l.sku))
  const extra = g.lineas.filter((l) => !hay.has(l.sku))
  if (extra.length === 0) return c
  return { ...c, lineas: [...c.lineas, ...(extra as unknown as LineaPlan[])], unidades: c.unidades + unidadesDe(extra) }
}

/** La clave del envío aparte con las referencias que no caben en uno ya hablado o en preparación de la misma semana */
export const claveAparte = (clave: string): string => `${clave}:2`

/**
 * Un calculado con solo algunas de sus líneas (las mismas cifras que `resumirEnvio`, sin recalcular fechas): para separar las
 * referencias nuevas de un envío ya hablado. Puro.
 */
export function envioConLineas(c: EnvioPropuestoCalculado, lineas: LineaPlan[], clave: string, nota: string | null = null): EnvioPropuestoCalculado {
  const unidades = unidadesDe(lineas)
  let cajasExactas = 0
  let sinCaja = 0
  for (const l of lineas) {
    if (l.caja && l.caja.unidades > 0) cajasExactas += Math.ceil(l.cantidad / l.caja.unidades)
    else sinCaja += l.cantidad
  }
  const conEuros = lineas.filter((l) => l.eurosEnRiesgo !== null)
  const prioridad = lineas.reduce<Prioridad>((p, l) => (RANGO_PRIORIDAD[l.prioridad] < RANGO_PRIORIDAD[p] ? l.prioridad : p), 'mas_adelante')
  const conPorque = [...lineas].filter((l) => l.porque).sort((a, b) => pesoOrden(b) - pesoOrden(a) || a.sku.localeCompare(b.sku))
  const porque = [...(nota ? [nota] : []), ...avisoRemesasSinSalir(lineas), ...conPorque.slice(0, 3).map((l) => l.porque)]
  if (lineas.length > 3) porque.push(`y ${lineas.length - 3} referencia${lineas.length - 3 === 1 ? '' : 's'} más`)
  return {
    ...c,
    clave,
    lineas: ordenarLineas(lineas),
    unidades,
    cajasEstimadas: unidades > 0 ? cajasExactas + (sinCaja > 0 ? Math.ceil(sinCaja / UNIDADES_CAJA_APROX) : 0) : null,
    cajasAproximadas: sinCaja > 0,
    eurosEnRiesgo: conEuros.length ? Math.round(conEuros.reduce((s, l) => s + (l.eurosEnRiesgo ?? 0), 0) * 100) / 100 : null,
    prioridad: lineas.length ? prioridad : c.prioridad,
    porque,
    provisional: lineas.some((l) => l.avisos.includes('provisional')),
  }
}

export const reconciliarEnvios: FnReconciliarEnvios = (guardados, recientesCerrados, calculados, hoy, opciones) => {
  const resultado: ResultadoReconciliacion = { insertar: [], actualizar: [], caducar: [], marcarPlanYaNoLoPide: [], huerfanosAHablado: [] }
  const activos = guardados.filter((g) => (ESTADOS_ACTIVOS as readonly EstadoEnvioPropuesto[]).includes(g.estado))

  // Huérfanos: en_preparacion sin remesa vuelven a hablado y se tratan como tal (D19). Solo si llevan un rato así: mientras se
  // convierte, la fila está reclamada sin remesa unos segundos y no es huérfana (la pasada la pisaría)
  const estadoEf = new Map<string, EstadoEnvioPropuesto>()
  const ahoraMs = opciones.ahora ? Date.parse(opciones.ahora) : NaN
  const llevaUnRato = (g: EnvioGuardadoMinimo) => {
    if (!Number.isFinite(ahoraMs)) return true
    const desde = Date.parse(g.estadoCambiadoAt)
    return !Number.isFinite(desde) || ahoraMs - desde >= MINUTOS_HUERFANO * 60_000
  }
  for (const g of activos) {
    if (g.estado === 'en_preparacion' && !g.remesaId && llevaUnRato(g)) {
      resultado.huerfanosAHablado.push(g.id)
      estadoEf.set(g.id, 'hablado')
    } else estadoEf.set(g.id, g.estado)
  }

  const ordenados = [...calculados].sort((a, b) => a.salirAntesDe.localeCompare(b.salirAntesDe) || a.clave.localeCompare(b.clave))
  const usados = new Set<string>()
  const pareja = new Map<EnvioPropuestoCalculado, EnvioGuardadoMinimo>()

  // 1 · Por clave
  for (const c of ordenados) {
    const g = activos.find((x) => !usados.has(x.id) && x.clave === c.clave)
    if (g) { usados.add(g.id); pareja.set(c, g) }
  }
  // 2 · Por solapamiento de SKU ≥ 50 % (la salida cambió de semana), en cualquier estado activo
  for (const c of ordenados) {
    if (pareja.has(c)) continue
    const skus = c.lineas.map((l) => l.sku)
    let mejor: EnvioGuardadoMinimo | null = null
    let mejorSol = 0
    for (const g of activos) {
      if (usados.has(g.id)) continue
      // Lo que ya está en preparación (con remesa) solo se empareja por clave: si no, un envío nuevo de otra semana con las
      // mismas referencias desaparecería tras la remesa que se está encajando
      if (estadoEf.get(g.id) === 'en_preparacion') continue
      const s = solapamiento(g.skus.length ? g.skus : g.lineas.map((l) => l.sku), skus)
      if (s < SOLAPAMIENTO_MINIMO) continue
      const masCerca = mejor && Math.abs(diasEntre(g.salirAntesDe, c.salirAntesDe)) < Math.abs(diasEntre(mejor.salirAntesDe, c.salirAntesDe))
      if (s > mejorSol || (s === mejorSol && masCerca)) { mejor = g; mejorSol = s }
    }
    if (mejor) { usados.add(mejor.id); pareja.set(c, mejor) }
  }

  // 3 · Lo que el plan de hoy pide y no está en lo hablado ni en la remesa del envío emparejado: va en un envío aparte con clave
  // derivada. Si no, una referencia nueva de la misma semana que un envío hablado o en preparación se quedaba sin envío (el índice
  // único solo deja un activo por clave, y convertir usa lo hablado): un SKU «urgente» que nadie podía convertir.
  const procesar: EnvioPropuestoCalculado[] = []
  for (const c of ordenados) {
    const g = pareja.get(c)
    const estado = g ? estadoEf.get(g.id) : undefined
    const fijos = g && estado !== 'nuevo' && g.skusFijos ? new Set(g.skusFijos) : null
    const nuevas = fijos ? c.lineas.filter((l) => l.cantidad > 0 && !fijos.has(l.sku)) : []
    if (!g || !fijos || nuevas.length === 0) { procesar.push(c); continue }
    const quedan = c.lineas.filter((l) => !nuevas.includes(l))
    const c1 = envioConLineas(c, quedan, c.clave)
    pareja.delete(c)
    pareja.set(c1, g)
    procesar.push(c1)
    const nota = estado === 'en_preparacion'
      ? 'Referencias que el plan pide y no van en la remesa que ya se está preparando esta semana'
      : 'Referencias que el plan pide y no están en lo hablado con el cliente para esta semana'
    const c2 = envioConLineas(c, nuevas, claveAparte(c.clave), nota)
    const g2 = activos.find((x) => !usados.has(x.id) && x.clave === c2.clave)
    if (g2) { usados.add(g2.id); pareja.set(c2, g2) }
    procesar.push(c2)
  }

  // Cuarentena: descartados de < 14 días con la misma clave
  const descartados = recientesCerrados.filter((r) => r.estado === 'descartado'
    && diasEntre(r.estadoCambiadoAt.slice(0, 10), hoy) < DIAS_CUARENTENA)

  for (const c of procesar) {
    const g = pareja.get(c)
    if (g) {
      const estado = estadoEf.get(g.id)!
      if (estado === 'en_preparacion') continue // ya tiene remesa: no se toca
      const prioridadCambia = g.prioridad !== c.prioridad
      // Pasada incompleta (sin_datos o error): solo se refleja la prioridad (D22)
      if (!opciones.completo && !prioridadCambia) continue
      // Un hablado que cuenta como llegada no sale en el plan de hoy con sus propios SKU: para comparar, se le suman los suyos
      const cuenta = (estado === 'hablado' || estado === 'esperando_cliente') && !!opciones.habladosQueCuentan?.has(g.id)
      const paraComparar = cuenta ? conLasPropias(c, g) : c
      resultado.actualizar.push({
        id: g.id,
        calculado: c,
        soloLineas: estado !== 'nuevo' || !opciones.completo,
        anotarHistorial: pideHistorial(g, paraComparar),
        cambios: cambiosDesdeAyer(g, paraComparar),
      })
      continue
    }
    if (!opciones.completo) continue
    const cuarentena = descartados.find((d) => d.clave === c.clave && RANGO_PRIORIDAD[c.prioridad] >= RANGO_PRIORIDAD[d.prioridad])
    if (cuarentena) continue
    resultado.insertar.push(c)
  }

  // Lo guardado que el plan ya no pide
  if (opciones.completo) {
    for (const g of activos) {
      if (usados.has(g.id)) continue
      const estado = estadoEf.get(g.id)!
      if (estado === 'nuevo') resultado.caducar.push({ id: g.id, motivo: 'el plan ya no lo pide' })
      // Un hablado cuenta como llegada: que el plan ya no pida sus SKU es por él mismo, no porque sobre
      else if ((estado === 'hablado' || estado === 'esperando_cliente') && !opciones.habladosQueCuentan?.has(g.id)) resultado.marcarPlanYaNoLoPide.push(g.id)
    }
  }
  return resultado
}
