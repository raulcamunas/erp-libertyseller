import { etiquetaLimpia, rutaLimpia, textoCorto } from './limpieza'

/**
 * DE LO QUE MANDA EL NAVEGADOR A LAS FILAS QUE SE GUARDAN.
 * PURO. Se prueba en ingesta.prueba.ts.
 *
 * El navegador manda un lote de eventos («abrí esta pantalla», «pulsé este botón», «sigo aquí»). Esto decide qué se
 * acepta y con qué forma, y NO se fía de nada:
 *
 *   · quién es lo decide el servidor con la sesión, nunca el cuerpo;
 *   · la HORA la fija el servidor: el navegador solo dice «hace cuántos milisegundos» y se acota a diez minutos, así que
 *     un reloj adelantado o retrasado no puede escribir en otro día;
 *   · el tipo tiene que ser uno de la lista, la ruta se limpia de identificadores y la etiqueta de datos personales;
 *   · un lote tiene un tope de eventos y lo que sobra se descarta.
 */

export const TIPOS_DE_EVENTO = ['sesion', 'login', 'pagina', 'clic', 'latido', 'oculta', 'visible'] as const
export type TipoDeEvento = (typeof TIPOS_DE_EVENTO)[number]

const TIPOS = new Set<string>(TIPOS_DE_EVENTO)

export const MAX_EVENTOS_POR_PETICION = 60
/** Un lote puede llegar tarde (se guarda en el navegador y se manda cada 30 s), pero no una hora después */
export const MAX_ANTIGUEDAD_MS = 10 * 60_000

const SESION = /^[A-Za-z0-9_-]{8,40}$/

export interface FilaDeActividad {
  user_id: string
  ocurrio_at: string
  tipo: TipoDeEvento
  ruta: string | null
  detalle: string | null
  sesion: string | null
  ip: string | null
  agente: string | null
}

export interface ContextoDeLote {
  userId: string
  ahoraMs: number
  /** De dónde llega la petición, para guardarlo SOLO al abrir sesión */
  ip: string | null
  agente: string | null
}

export function prepararLote(cuerpo: unknown, ctx: ContextoDeLote): { filas: FilaDeActividad[]; descartados: number } {
  if (typeof cuerpo !== 'object' || cuerpo === null) return { filas: [], descartados: 0 }
  const { sesion, eventos } = cuerpo as { sesion?: unknown; eventos?: unknown }
  if (!Array.isArray(eventos)) return { filas: [], descartados: 0 }

  const sesionId = typeof sesion === 'string' && SESION.test(sesion) ? sesion : null
  const filas: FilaDeActividad[] = []
  let descartados = Math.max(0, eventos.length - MAX_EVENTOS_POR_PETICION)

  for (const bruto of eventos.slice(0, MAX_EVENTOS_POR_PETICION)) {
    if (typeof bruto !== 'object' || bruto === null) {
      descartados++
      continue
    }
    const e = bruto as { t?: unknown; ruta?: unknown; detalle?: unknown; hace?: unknown }
    if (typeof e.t !== 'string' || !TIPOS.has(e.t)) {
      descartados++
      continue
    }
    const tipo = e.t as TipoDeEvento

    // Un clic sin nombre no dice nada que merezca una fila
    const detalle = tipo === 'clic' ? etiquetaLimpia(e.detalle) : null
    if (tipo === 'clic' && detalle === null) {
      descartados++
      continue
    }

    const haceBruto = typeof e.hace === 'number' && Number.isFinite(e.hace) ? e.hace : 0
    const hace = Math.min(MAX_ANTIGUEDAD_MS, Math.max(0, Math.round(haceBruto)))
    const alAbrir = tipo === 'sesion' || tipo === 'login'

    filas.push({
      user_id: ctx.userId,
      ocurrio_at: new Date(ctx.ahoraMs - hace).toISOString(),
      tipo,
      ruta: rutaLimpia(e.ruta),
      detalle,
      sesion: sesionId,
      ip: alAbrir ? textoCorto(ctx.ip, 64) : null,
      agente: alAbrir ? textoCorto(ctx.agente, 200) : null,
    })
  }
  return { filas, descartados }
}
