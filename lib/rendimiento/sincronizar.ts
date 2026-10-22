import { ErrorRinkel, type FilaLlamada, type PaginaDeLlamadas } from './rinkel'
import { claveDeTelefono } from './telefonos'

/**
 * TRAER LAS LLAMADAS DE UNA CUENTA DE RINKEL AL ERP.
 * ==================================================
 * Lo que decide QUÉ páginas se piden y cuándo parar. No toca la base ni la red: recibe lo que necesita
 * (`DepsDeSincronizacion`) y devuelve el estado nuevo. Se comprueba con sincronizar.prueba.ts contra una
 * API falsa con páginas, con un reloj falso y con una «base de datos» en memoria.
 *
 *
 * ============ DOS COSAS EN CADA PASADA ============
 *
 *   1. LO RECIENTE, siempre. Desde la última lectura menos unos días de solape hasta ahora. Es lo que
 *      mantiene el panel al día y cuesta una o dos peticiones. El solape no es manía: una grabación
 *      aparece unos minutos DESPUÉS de colgar, y una llamada se puede corregir, así que leer solo «lo
 *      posterior a la última vez» dejaría para siempre una llamada sin su grabación.
 *   2. EL HISTÓRICO, hasta que esté entero. Rinkel da las llamadas de la más nueva a la más vieja en
 *      páginas de 50, y una cuenta con meses de uso son decenas de páginas: no caben en una petición
 *      del navegador. Se lee por tramos con un presupuesto de tiempo, se apunta por dónde se va
 *      (`siguiente_pagina`) y la siguiente pasada sigue desde ahí.
 *
 *
 * ============ POR QUÉ UN CURSOR POR PÁGINA NO SE SALTA NADA ============
 *
 * Mientras se importa, la cuenta sigue recibiendo llamadas, y cada llamada nueva EMPUJA a las demás a la
 * página siguiente. Seguir por la página N después de que hayan entrado cinco nuevas repite como mucho
 * cinco llamadas ya leídas; no se salta ninguna. Y repetir no cuesta nada: guardar es un upsert por
 * (usuario, id de Rinkel).
 *
 *
 * ============ LO LEÍDO NO SE PIERDE SI ALGO FALLA ============
 *
 * Si Rinkel contesta con un error a la tercera página, las dos primeras ya están guardadas y el cursor
 * apunta a la tercera. Se devuelve el error JUNTO al estado, no en lugar de él.
 */

export interface EstadoDeSincronizacion {
  /** Ya se ha leído el histórico entero */
  historico_completo: boolean
  /** La próxima página (de 50) del histórico que falta por leer, empezando en 1 */
  siguiente_pagina: number
  /** Desde cuándo se está al día con lo reciente. null = todavía no se ha leído nada */
  ultimo_sync_at: string | null
}

export interface FilaParaGuardar extends FilaLlamada {
  user_id: string
  /** El lead de Cold Calling de ESTE comercial al que se llamó, si el número es de uno suyo */
  lead_id: string | null
}

export interface DepsDeSincronizacion {
  leerPagina(op: { pagina: number; desdeSeg?: number }): Promise<PaginaDeLlamadas>
  /** Guarda con upsert por (usuario, id de Rinkel). Debe ser idempotente */
  guardar(filas: FilaParaGuardar[]): Promise<void>
  /** Teléfonos de los leads de este comercial: clave de nueve cifras -> id del lead. Se pide UNA vez por pasada */
  leadsPorTelefono(): Promise<Map<string, string>>
  ahora(): number
}

export interface OpcionesDeSincronizacion {
  usuario: string
  /** Cuánto se puede tardar en total. Pasado esto se para y lo que falte lo hace la siguiente pasada */
  presupuestoMs: number
  /** Días que se releen hacia atrás de lo reciente. Por defecto 3 */
  solapeDias?: number
  /** Tope de páginas por pasada, por si algo hace que no se acabe nunca */
  maxPaginas?: number
}

export interface ResultadoDeSincronizacion {
  estado: EstadoDeSincronizacion
  /** Llamadas leídas de Rinkel en esta pasada (con repetidas: un solape se lee otra vez) */
  leidas: number
  paginas: number
  /** Cuántas llamadas tiene la cuenta en total, si esta pasada leyó el histórico */
  totalEnRinkel: number | null
  /** true = queda histórico por importar: hay que volver a llamar */
  pendiente: boolean
  /** Si se paró por el presupuesto y no por haber terminado */
  paradaPorTiempo: boolean
  /** Lo que ha dicho Rinkel si algo falló. El estado ya recoge lo que sí se pudo hacer */
  error: ErrorRinkel | null
  /**
   * true si lo que falló NO fue Rinkel sino algo de aquí (la base al guardar). `error` lleva entonces una frase
   * genérica y no debe contarse como un problema de la cuenta de Rinkel: la clave y la cuenta están bien.
   */
  falloInterno: boolean
}

const DIA_MS = 86_400_000

export async function sincronizarCuenta(
  estado: EstadoDeSincronizacion,
  deps: DepsDeSincronizacion,
  op: OpcionesDeSincronizacion
): Promise<ResultadoDeSincronizacion> {
  const inicio = deps.ahora()
  const solapeMs = (op.solapeDias ?? 3) * DIA_MS
  const maxPaginas = op.maxPaginas ?? 400

  let leidas = 0
  let paginas = 0
  let totalEnRinkel: number | null = null
  let paradaPorTiempo = false
  let error: ErrorRinkel | null = null
  let falloInterno = false
  const nuevo: EstadoDeSincronizacion = { ...estado }

  const hayTiempo = () => deps.ahora() - inicio < op.presupuestoMs && paginas < maxPaginas

  let leads: Map<string, string> | null = null
  const procesar = async (pagina: PaginaDeLlamadas) => {
    leads ??= await deps.leadsPorTelefono()
    const filas: FilaParaGuardar[] = pagina.filas.map((f) => {
      const clave = f.numero ? claveDeTelefono(f.numero) : null
      return { ...f, user_id: op.usuario, lead_id: clave ? (leads!.get(clave) ?? null) : null }
    })
    if (filas.length > 0) await deps.guardar(filas)
    leidas += filas.length
    paginas += 1
  }

  try {
    /* ---------- 1) lo reciente ---------- */
    if (estado.ultimo_sync_at) {
      const desdeSeg = Math.floor((Date.parse(estado.ultimo_sync_at) - solapeMs) / 1000)
      let completoReciente = false
      for (let pagina = 1; hayTiempo(); pagina += 1) {
        const leida = await deps.leerPagina({ pagina, desdeSeg })
        await procesar(leida)
        if (pagina >= leida.totalPaginas || (leida.filas.length === 0 && leida.descartadas === 0)) {
          completoReciente = true
          break
        }
      }
      if (completoReciente) nuevo.ultimo_sync_at = new Date(inicio).toISOString()
      else paradaPorTiempo = true
    }

    /* ---------- 2) el histórico ---------- */
    if (!estado.historico_completo && !paradaPorTiempo) {
      let pagina = estado.siguiente_pagina
      while (hayTiempo()) {
        const leida = await deps.leerPagina({ pagina })
        totalEnRinkel = leida.total
        await procesar(leida)
        pagina += 1
        nuevo.siguiente_pagina = pagina
        // La primera lectura de la historia deja ya «al día»: lo que entre desde ahora lo cubre el solape
        if (nuevo.ultimo_sync_at === null) nuevo.ultimo_sync_at = new Date(inicio).toISOString()
        // Una página sin llamadas aunque Rinkel diga que hay más: no se insiste, para no dar vueltas en vacío
        if (pagina > leida.totalPaginas || (leida.filas.length === 0 && leida.descartadas === 0)) {
          nuevo.historico_completo = true
          break
        }
      }
      if (!nuevo.historico_completo) paradaPorTiempo = true
    }
  } catch (e) {
    falloInterno = !(e instanceof ErrorRinkel)
    error = e instanceof ErrorRinkel ? e : new ErrorRinkel('respuesta', 'Ha fallado la lectura de las llamadas.')
  }

  return {
    estado: nuevo,
    leidas,
    paginas,
    totalEnRinkel,
    pendiente: !nuevo.historico_completo,
    paradaPorTiempo,
    error,
    falloInterno,
  }
}

/** El estado de una cuenta recién vinculada: nada leído */
export const ESTADO_INICIAL: EstadoDeSincronizacion = { historico_completo: false, siguiente_pagina: 1, ultimo_sync_at: null }
