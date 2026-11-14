import type { Actor, EstadoRemesa } from './flujo'
import { puntoDePropuesta } from './propuesta-cliente'
import { diasEntre, turnoDe } from './vista'

/**
 * EL TABLERO DE REMESAS: TODAS LAS PROPUESTAS EN MARCHA, POR FASES.
 * ================================================================
 * PURO (lo de aquí). La lectura de la base está en tablero-datos.ts. Se prueba con tablero.prueba.ts.
 *
 * Una columna por fase —Montando, Con el cliente, Revisar, Etiquetas, Encajando, Lista— y en cada tarjeta lo
 * que hace falta para llevar el control sin abrirla: cliente, unidades, cajas, el plazo con semáforo (la
 * fecha prevista de envío) y quién la tiene ahora.
 */

export type ColumnaDelTablero = 'montando' | 'con_el_cliente' | 'revision' | 'aprobada' | 'encajando' | 'lista'

export const COLUMNAS_DEL_TABLERO: Array<{ id: ColumnaDelTablero; texto: string; pista: string }> = [
  { id: 'montando', texto: 'Montando', pista: 'La agencia prepara qué mandar. Aún no se le ha mandado al cliente.' },
  { id: 'con_el_cliente', texto: 'Con el cliente', pista: 'El cliente la tiene en su enlace: la revisa y acepta.' },
  { id: 'revision', texto: 'Revisar', pista: 'El cliente ha aceptado. Revisa sus cambios y aprueba.' },
  { id: 'aprobada', texto: 'Etiquetas', pista: 'Aprobada: el cliente descarga y pega las etiquetas FNSKU.' },
  { id: 'encajando', texto: 'Encajando', pista: 'El cliente mete la mercancía en cajas, con medidas y pesos.' },
  { id: 'lista', texto: 'Lista', pista: 'Cajas cerradas. Toca crear el envío en Amazon.' },
]

export function columnaDe(r: { estado: EstadoRemesa; propuestaEnviadaAt: string | null; clienteAceptoAt: string | null }): ColumnaDelTablero | null {
  if (r.estado === 'borrador') {
    const p = puntoDePropuesta(r)
    return p === 'pendiente_revision' ? 'revision' : p === 'con_el_cliente' ? 'con_el_cliente' : 'montando'
  }
  if (r.estado === 'aprobada' || r.estado === 'encajando' || r.estado === 'lista') return r.estado
  return null
}

export type Semaforo = 'vencido' | 'cerca' | 'ok' | 'sin_fecha'

/** El plazo: la fecha prevista de envío frente a hoy. Vencido si ya pasó, cerca si quedan 3 días o menos */
export function semaforoDelPlazo(fechaEnvio: string | null, hoy: string): { semaforo: Semaforo; dias: number | null } {
  if (!fechaEnvio) return { semaforo: 'sin_fecha', dias: null }
  const dias = diasEntre(hoy, fechaEnvio)
  return { semaforo: dias < 0 ? 'vencido' : dias <= 3 ? 'cerca' : 'ok', dias }
}

export function textoDelPlazo(dias: number | null): string {
  if (dias === null) return 'Sin fecha'
  if (dias < -1) return `Vencido hace ${-dias} días`
  if (dias === -1) return 'Vencido ayer'
  if (dias === 0) return 'Sale hoy'
  if (dias === 1) return 'Sale mañana'
  return `Sale en ${dias} días`
}

export interface FilaDeTablero {
  id: string
  clienteId: string
  clienteNombre: string
  nombre: string | null
  fechaEnvio: string
  estado: EstadoRemesa
  actualizadaAt: string | null
  propuestaEnviadaAt: string | null
  clienteAceptoAt: string | null
  referencias: number
  unidades: number
  cajas: number
}

export interface TarjetaDeTablero extends FilaDeTablero {
  columna: ColumnaDelTablero
  quien: Actor
  turno: { paraAgencia: string; paraCliente: string }
  semaforo: Semaforo
  diasAlPlazo: number | null
  /** Días desde el último cambio: lo que lleva parada */
  diasParada: number | null
}

export function aTarjeta(f: FilaDeTablero, hoy: string): TarjetaDeTablero | null {
  const columna = columnaDe(f)
  if (!columna) return null
  const t = turnoDe(f.estado, f.referencias, { enviadaAt: f.propuestaEnviadaAt, aceptoAt: f.clienteAceptoAt })
  const plazo = semaforoDelPlazo(f.fechaEnvio, hoy)
  return {
    ...f,
    columna,
    quien: t.quien,
    turno: { paraAgencia: t.paraAgencia, paraCliente: t.paraCliente },
    semaforo: plazo.semaforo,
    diasAlPlazo: plazo.dias,
    diasParada: f.actualizadaAt ? Math.max(0, diasEntre(f.actualizadaAt, hoy)) : null,
  }
}

export interface FiltroDelTablero {
  texto?: string
  clienteId?: string | null
  /** Solo las que le tocan a quien mira */
  soloMias?: Actor | null
  soloVencidas?: boolean
}

/** Filtra y ordena: lo que vence antes, primero */
export function filtrarTablero(tarjetas: TarjetaDeTablero[], f: FiltroDelTablero): TarjetaDeTablero[] {
  const t = (f.texto ?? '').trim().toLowerCase()
  return tarjetas
    .filter((x) => !f.clienteId || x.clienteId === f.clienteId)
    .filter((x) => !f.soloMias || x.quien === f.soloMias)
    .filter((x) => !f.soloVencidas || x.semaforo === 'vencido')
    .filter((x) => !t || [x.nombre, x.clienteNombre].some((v) => v?.toLowerCase().includes(t)))
    .sort((a, b) => (a.diasAlPlazo ?? 9999) - (b.diasAlPlazo ?? 9999) || a.clienteNombre.localeCompare(b.clienteNombre, 'es'))
}

export function agruparPorColumna(tarjetas: TarjetaDeTablero[]): Record<ColumnaDelTablero, TarjetaDeTablero[]> {
  const g = Object.fromEntries(COLUMNAS_DEL_TABLERO.map((c) => [c.id, [] as TarjetaDeTablero[]])) as Record<ColumnaDelTablero, TarjetaDeTablero[]>
  for (const x of tarjetas) g[x.columna].push(x)
  return g
}
