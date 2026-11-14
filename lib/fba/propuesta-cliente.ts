import type { EstadoRemesa } from './flujo'

/**
 * LA PROPUESTA QUE EL CLIENTE VE Y TOCA POR SU ENLACE.
 * ====================================================
 * PURO: sin base de datos ni red. Se prueba con propuesta-cliente.prueba.ts.
 *
 * Decisiones de Raúl (14 nov 2026):
 *
 *   · El cliente recibe la propuesta en un ENLACE abierto, como el de las cajas. Ve lo que hemos propuesto
 *     y puede cambiar cantidades y AÑADIR productos, pero solo de SU catálogo de Amazon (nunca texto
 *     libre). Lo que añade sale marcado como «Nuevo».
 *   · Sus cambios se ven frente a lo propuesto: «Propuesto | Tu cantidad». Lo propuesto es una FOTO que se
 *     toma al mandarle la propuesta (`unidades_propuestas`, migración 309) y que él no puede tocar.
 *   · Para no mandar algo pone 0: la línea se queda, para que la agencia vea qué se proponía. Lo que él
 *     añadió y luego no quiere, sí se quita.
 *   · «Acepto» NO aprueba el envío: lo deja PENDIENTE DE REVISIÓN. La agencia ve las diferencias y aprueba.
 */

/* ------------------------------------------------------------------ */
/* En qué punto está la propuesta                                     */
/* ------------------------------------------------------------------ */

export type PuntoDePropuesta =
  /** En borrador y todavía no se le ha mandado al cliente: la agencia la está montando */
  | 'montando'
  /** Mandada: el cliente la puede mirar y tocar desde su enlace */
  | 'con_el_cliente'
  /** El cliente ha dicho «Acepto»: la agencia revisa las diferencias y aprueba */
  | 'pendiente_revision'
  /** Ya no es una propuesta: aprobada o más allá */
  | 'cerrada'

export function puntoDePropuesta(r: { estado: EstadoRemesa; propuestaEnviadaAt: string | null; clienteAceptoAt: string | null }): PuntoDePropuesta {
  if (r.estado !== 'borrador') return 'cerrada'
  if (r.clienteAceptoAt) return 'pendiente_revision'
  if (r.propuestaEnviadaAt) return 'con_el_cliente'
  return 'montando'
}

export const TEXTO_PUNTO: Record<PuntoDePropuesta, { corto: string; largo: string }> = {
  montando: { corto: 'Montando', largo: 'La agencia está preparando la propuesta. Todavía no se le ha mandado al cliente.' },
  con_el_cliente: { corto: 'Con el cliente', largo: 'El cliente la tiene en su enlace: puede cambiar cantidades y añadir productos de su catálogo.' },
  pendiente_revision: { corto: 'Pendiente de revisión', largo: 'El cliente ha dicho «Acepto». Revisa sus cambios frente a lo propuesto y aprueba.' },
  cerrada: { corto: 'Cerrada', largo: 'La propuesta ya está aprobada.' },
}

/* ------------------------------------------------------------------ */
/* Las fases del portal del cliente (/envio/<token>)                    */
/* ------------------------------------------------------------------ */

export type FaseDelPortal = 'propuesta' | 'etiquetas' | 'cajas' | 'envio'

export const FASES_DEL_PORTAL: Array<{ id: FaseDelPortal; texto: string; pista: string }> = [
  { id: 'propuesta', texto: 'Propuesta', pista: 'Qué te proponemos mandar. Ajusta cantidades, añade productos y acepta.' },
  { id: 'etiquetas', texto: 'Etiquetas', pista: 'Descarga las etiquetas FNSKU y pégalas en cada unidad.' },
  { id: 'cajas', texto: 'Cajas', pista: 'Reparte las unidades en cajas y pon medidas y peso.' },
  { id: 'envio', texto: 'Envío', pista: 'Preparamos el envío a Amazon con tus cajas.' },
]

/** En qué fase está el envío según su estado: la que el portal abre por defecto */
export function faseDelPortal(estado: EstadoRemesa): FaseDelPortal {
  if (estado === 'borrador') return 'propuesta'
  if (estado === 'aprobada') return 'etiquetas'
  if (estado === 'encajando') return 'cajas'
  return 'envio'
}

export const indiceDeFase = (f: FaseDelPortal): number => FASES_DEL_PORTAL.findIndex((x) => x.id === f)

/** ¿Se pueden descargar las etiquetas desde el enlace? Con la propuesta ya aprobada por la agencia */
export const etiquetasDisponibles = (estado: EstadoRemesa): boolean => estado !== 'borrador'

/* ------------------------------------------------------------------ */
/* Las líneas y sus diferencias                                        */
/* ------------------------------------------------------------------ */

export interface LineaDePropuesta {
  sku: string
  nombre: string | null
  variante: string | null
  referencia: string | null
  asin: string | null
  /** Lo que hay ahora: lo que el cliente ha dejado o lo que propuso la agencia si no lo ha tocado */
  unidades: number
  /** La foto de lo propuesto. null = no estaba en la propuesta (la añadió el cliente) */
  propuestas: number | null
  /** La añadió el cliente: marca «Nuevo» */
  nueva: boolean
  comentario: string | null
}

export type TipoDeDiferencia = 'igual' | 'mas' | 'menos' | 'quitada' | 'nueva'

export interface Diferencia {
  sku: string
  tipo: TipoDeDiferencia
  propuestas: number
  cliente: number
  /** cliente − propuestas */
  delta: number
}

export function diferenciaDe(l: Pick<LineaDePropuesta, 'sku' | 'unidades' | 'propuestas' | 'nueva'>): Diferencia {
  const propuestas = l.propuestas ?? 0
  const cliente = l.unidades
  const delta = cliente - propuestas
  let tipo: TipoDeDiferencia
  if (l.nueva || l.propuestas === null) tipo = 'nueva'
  else if (cliente === 0 && propuestas > 0) tipo = 'quitada'
  else if (delta > 0) tipo = 'mas'
  else if (delta < 0) tipo = 'menos'
  else tipo = 'igual'
  return { sku: l.sku, tipo, propuestas, cliente, delta }
}

export interface ResumenDeDiferencias {
  /** Cuántas líneas ha tocado el cliente de alguna forma */
  cambios: number
  mas: number
  menos: number
  quitadas: number
  nuevas: number
  unidadesPropuestas: number
  unidadesCliente: number
  /** Líneas con comentario del cliente */
  comentarios: number
}

export function resumirDiferencias(lineas: Array<Pick<LineaDePropuesta, 'sku' | 'unidades' | 'propuestas' | 'nueva' | 'comentario'>>): ResumenDeDiferencias {
  const r: ResumenDeDiferencias = { cambios: 0, mas: 0, menos: 0, quitadas: 0, nuevas: 0, unidadesPropuestas: 0, unidadesCliente: 0, comentarios: 0 }
  for (const l of lineas) {
    const d = diferenciaDe(l)
    r.unidadesPropuestas += d.propuestas
    r.unidadesCliente += d.cliente
    if (l.comentario && l.comentario.trim()) r.comentarios++
    if (d.tipo === 'igual') continue
    r.cambios++
    if (d.tipo === 'mas') r.mas++
    else if (d.tipo === 'menos') r.menos++
    else if (d.tipo === 'quitada') r.quitadas++
    else r.nuevas++
  }
  return r
}

/** Para pintar la revisión: primero lo nuevo y lo quitado, luego los cambios, al final lo que sigue igual */
export function ordenarParaRevision<T extends Pick<LineaDePropuesta, 'sku' | 'unidades' | 'propuestas' | 'nueva'>>(lineas: T[]): T[] {
  const peso: Record<TipoDeDiferencia, number> = { nueva: 0, quitada: 1, mas: 2, menos: 2, igual: 3 }
  return [...lineas].sort((a, b) => peso[diferenciaDe(a).tipo] - peso[diferenciaDe(b).tipo] || a.sku.localeCompare(b.sku, 'es', { numeric: true }))
}

/* ------------------------------------------------------------------ */
/* Lo que manda el cliente: validarlo y convertirlo en un plan         */
/* ------------------------------------------------------------------ */

export const MAX_UNIDADES_POR_LINEA = 99_999
export const MAX_LINEAS_PROPUESTA = 600
export const MAX_COMENTARIO = 300
export const MAX_BYTES_PROPUESTA = 128 * 1024

export interface LineaDeseada {
  sku: string
  unidades: number
  comentario: string | null
}

export interface ProductoDeCatalogo {
  sku: string
  titulo: string | null
  asin: string | null
  fnsku: string | null
}

export interface PlanDelCliente {
  actualizar: Array<{ sku: string; unidades: number; comentario: string | null }>
  anadir: Array<{ sku: string; unidades: number; comentario: string | null; nombre: string | null; asin: string | null; fnsku: string | null }>
  quitar: string[]
  /** Para el historial */
  cambiadas: number
  nuevas: number
}

export type ResultadoDelPlan = { ok: true; plan: PlanDelCliente } | { ok: false; error: string }

/** Lee lo que llega del navegador, sin fiarse de nada */
export function leerLineasDeseadas(crudas: unknown): { ok: true; lineas: LineaDeseada[] } | { ok: false; error: string } {
  if (!Array.isArray(crudas)) return { ok: false, error: 'Falta la lista de productos' }
  if (crudas.length > MAX_LINEAS_PROPUESTA) return { ok: false, error: `Como mucho ${MAX_LINEAS_PROPUESTA} productos en un envío` }
  const vistas = new Set<string>()
  const lineas: LineaDeseada[] = []
  for (const c of crudas as Array<Record<string, unknown>>) {
    const sku = typeof c?.sku === 'string' ? c.sku.trim() : ''
    if (!sku || sku.length > 80) return { ok: false, error: 'Hay un producto sin referencia' }
    if (vistas.has(sku)) return { ok: false, error: `«${sku}» aparece dos veces` }
    vistas.add(sku)
    const unidades = Number(c.unidades)
    if (!Number.isInteger(unidades) || unidades < 0 || unidades > MAX_UNIDADES_POR_LINEA) {
      return { ok: false, error: `«${sku}»: las unidades tienen que ser un número entero entre 0 y ${MAX_UNIDADES_POR_LINEA.toLocaleString('es-ES')}` }
    }
    let comentario = typeof c.comentario === 'string' ? c.comentario.trim() : ''
    if (comentario.length > MAX_COMENTARIO) comentario = comentario.slice(0, MAX_COMENTARIO)
    lineas.push({ sku, unidades, comentario: comentario || null })
  }
  return { ok: true, lineas }
}

/**
 * Convierte lo que quiere el cliente en qué tocar, comparando con lo que hay.
 *
 *   · Una línea que ya existe → se actualizan unidades y comentario (si cambian).
 *   · Una que no existe → solo si está en SU catálogo (`catalogo`): se añade con la marca «Nuevo» y con el
 *     nombre, ASIN y FNSKU de Amazon, no con lo que diga el navegador. Con 0 unidades no se añade.
 *   · Una que añadió él y ya no viene (o viene a 0) → se quita.
 *   · Una de la agencia que no viene → NO se toca: quitar una línea propuesta es ponerla a 0.
 */
export function planificarCambiosDelCliente(actuales: LineaDePropuesta[], deseadas: LineaDeseada[], catalogo: Map<string, ProductoDeCatalogo>): ResultadoDelPlan {
  const porSku = new Map(actuales.map((l) => [l.sku, l]))
  const plan: PlanDelCliente = { actualizar: [], anadir: [], quitar: [], cambiadas: 0, nuevas: 0 }
  const vienen = new Set<string>()

  for (const d of deseadas) {
    vienen.add(d.sku)
    const actual = porSku.get(d.sku)
    if (actual) {
      if (actual.nueva && d.unidades === 0) {
        plan.quitar.push(d.sku)
        continue
      }
      if (actual.unidades !== d.unidades || (actual.comentario ?? null) !== d.comentario) {
        plan.actualizar.push({ sku: d.sku, unidades: d.unidades, comentario: d.comentario })
        plan.cambiadas++
      }
      continue
    }
    if (d.unidades === 0) continue
    const producto = catalogo.get(d.sku)
    if (!producto) return { ok: false, error: `«${d.sku}» no está en tu catálogo de Amazon: solo se pueden añadir productos tuyos que estén en FBA.` }
    plan.anadir.push({ sku: d.sku, unidades: d.unidades, comentario: d.comentario, nombre: producto.titulo, asin: producto.asin, fnsku: producto.fnsku })
    plan.nuevas++
  }

  for (const l of actuales) if (l.nueva && !vienen.has(l.sku)) plan.quitar.push(l.sku)

  const quedan = actuales.filter((l) => !plan.quitar.includes(l.sku)).length + plan.anadir.length
  if (quedan > MAX_LINEAS_PROPUESTA) return { ok: false, error: `Como mucho ${MAX_LINEAS_PROPUESTA} productos en un envío` }
  return { ok: true, plan }
}

export const planVacio = (p: PlanDelCliente): boolean => p.actualizar.length === 0 && p.anadir.length === 0 && p.quitar.length === 0

/** El nombre de quien acepta: obligatorio, corto y sin saltos de línea */
export function limpiarNombreDeFirma(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const n = v.replace(/\s+/g, ' ').trim()
  return n.length >= 2 && n.length <= 80 ? n : null
}
