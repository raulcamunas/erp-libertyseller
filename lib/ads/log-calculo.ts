/**
 * AMAZON ADS · EL LOG DE CAMBIOS: CURSOR, FILTROS Y CSV. PURO (lo usan la ruta y la pantalla; tiene sus pruebas en log-calculo.prueba.ts).
 */

export const ORIGENES_DE_LOG = ['estructura', 'automatico', 'manual', 'ensayo'] as const
export type OrigenDeLog = (typeof ORIGENES_DE_LOG)[number]

/** El cursor de la paginación: la última fila vista (creado_at, id). Va en la URL como texto opaco */
export interface CursorDeLog {
  creadoAt: string
  id: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function cursorATexto(c: CursorDeLog): string {
  return Buffer.from(`${c.creadoAt}|${c.id}`, 'utf8').toString('base64url')
}

/** Del texto de la URL al cursor; null si no tiene forma de cursor (nunca lanza) */
export function cursorDeTexto(t: string | null | undefined): CursorDeLog | null {
  if (!t) return null
  try {
    const [creadoAt, id] = Buffer.from(t, 'base64url').toString('utf8').split('|')
    if (!creadoAt || !id || !UUID.test(id) || Number.isNaN(Date.parse(creadoAt))) return null
    return { creadoAt, id }
  } catch {
    return null
  }
}

/**
 * La condición de PostgREST para «lo que va después del cursor» en orden (creado_at DESC, id DESC): o es más antiguo, o tiene la misma fecha y un id menor.
 * Las fechas van entre comillas dobles: llevan «:» y «+», que en un .or() se leerían como sintaxis.
 */
export function condicionDeCursor(c: CursorDeLog): string {
  return `creado_at.lt."${c.creadoAt}",and(creado_at.eq."${c.creadoAt}",id.lt.${c.id})`
}

export interface FiltrosDeLog {
  desde: string | null
  hasta: string | null
  campaignId: string | null
  productoId: string | null
  usuarioId: string | null
  propuestaId: string | null
  origen: OrigenDeLog | null
  soloFallos: boolean
  busqueda: string | null
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/

/** De los parámetros de la URL a filtros validados. Lo que no tiene forma se ignora */
export function filtrosDeParametros(p: { get(nombre: string): string | null }): FiltrosDeLog {
  const uuid = (v: string | null) => (v && UUID.test(v) ? v : null)
  const fecha = (v: string | null) => (v && FECHA.test(v) ? v : null)
  const origen = p.get('origen')
  const campana = p.get('campaignId')
  const busqueda = (p.get('q') ?? '').trim().slice(0, 80)
  return {
    desde: fecha(p.get('desde')),
    hasta: fecha(p.get('hasta')),
    campaignId: campana && /^[0-9A-Za-z_-]{1,40}$/.test(campana) ? campana : null,
    productoId: uuid(p.get('productoId')),
    usuarioId: uuid(p.get('usuarioId')),
    propuestaId: uuid(p.get('propuestaId')),
    origen: (ORIGENES_DE_LOG as readonly string[]).includes(origen ?? '') ? (origen as OrigenDeLog) : null,
    soloFallos: p.get('fallos') === '1',
    busqueda: busqueda || null,
  }
}

/** Para un ilike de PostgREST dentro de un .or(): fuera comodines, comas, paréntesis y comillas, que romperían la sintaxis */
export function textoDeBusqueda(t: string): string {
  return t.replace(/[%_*,()"\\]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** «hasta» es un día entero: el límite es el comienzo del día siguiente (en UTC; el log lo enseña en hora de España) */
export function finDeDia(fecha: string): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + 86_400_000).toISOString()
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/** Una celda de CSV: entre comillas si hace falta, y protegida contra fórmulas al abrirla en Excel o Sheets */
export function celdaCsv(v: unknown): string {
  if (v == null) return ''
  let t = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v)
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`
  return /[";\n\r,]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

export function filaCsv(celdas: readonly unknown[], separador = ';'): string {
  return celdas.map(celdaCsv).join(separador)
}

/** La fecha de una entrada en hora de España, «DD/MM/AAAA HH:MM» */
export function fechaEspana(iso: string): string {
  const d = new Date(iso)
  const f = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
  const v = (t: string) => f.find((x) => x.type === t)?.value ?? ''
  return `${v('day')}/${v('month')}/${v('year')} ${v('hour')}:${v('minute')}`
}

export const CABECERA_CSV = ['Fecha', 'Origen', 'Persona', 'Campaña', 'ID de campaña', 'Entidad', 'ID en Amazon', 'Acción', 'Campo', 'Valor anterior', 'Valor nuevo', 'Motivo', 'Resultado', 'Error', 'HTTP', 'Request ID', 'Propuesta'] as const

export interface FilaParaCsv {
  creadoAt: string
  origen: string
  usuario: string | null
  nombreCampana: string | null
  campaignId: string | null
  entidad: string
  entidadId: string | null
  accion: string
  campo: string | null
  valorAnterior: string | null
  valorNuevo: string | null
  motivo: string | null
  ok: boolean
  error: string | null
  httpStatus: number | null
  requestId: string | null
  propuestaId: string | null
}

/** El CSV entero (con BOM para que Excel lea bien los acentos y «;» como separador, el de la configuración española) */
export function logACsv(filas: readonly FilaParaCsv[]): string {
  const lineas = [filaCsv(CABECERA_CSV)]
  for (const f of filas) {
    lineas.push(
      filaCsv([
        fechaEspana(f.creadoAt),
        ETIQUETA_ORIGEN[f.origen as OrigenDeLog] ?? f.origen,
        f.usuario ?? (f.origen === 'automatico' ? 'Motor' : ''),
        f.nombreCampana,
        f.campaignId,
        f.entidad,
        f.entidadId,
        f.accion,
        f.campo,
        f.valorAnterior,
        f.valorNuevo,
        f.motivo,
        f.ok ? 'Aceptado' : 'Fallido',
        f.error,
        f.httpStatus,
        f.requestId,
        f.propuestaId,
      ])
    )
  }
  return '\uFEFF' + lineas.join('\r\n')
}

export const ETIQUETA_ORIGEN: Record<OrigenDeLog, string> = {
  estructura: 'Crear campañas',
  automatico: 'Motor (autopiloto)',
  manual: 'Persona',
  ensayo: 'Ensayo',
}
