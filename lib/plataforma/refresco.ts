/**
 * LA VENTANA DE UN REFRESCO — DOMINIO PURO
 * ========================================
 * Sin Supabase, sin red y sin reloj del sistema: `ahora` entra siempre por
 * parámetro. Todo lo de aquí se puede comprobar con dos fechas fijas.
 *
 *
 * EL REFRESCO A DOS VELOCIDADES, QUE ES LO QUE PIDE LA ESPECIFICACIÓN
 * ------------------------------------------------------------------
 *   diario    -> solo el subconjunto activo. Tiene que caber en una ventana
 *                nocturna (ver activos.ts para quién entra en ese subconjunto).
 *   semanal   -> barrido del catálogo completo. Trabajo largo, por lotes, con
 *                progreso guardado y reanudable.
 *   a_demanda -> lo que pida una persona, cuando lo pida.
 *
 *
 * LOS DOS DATOS QUE CAMBIAN LAS CUENTAS Y NO SE DEDUCEN DEL CÓDIGO
 * ---------------------------------------------------------------
 * 1. LA CADENCIA DIARIA NO SON 24 HORAS, SON 20. Con 24 clavadas, un barrido que
 *    empieza a las 02:00 y otro que el día siguiente arranca a las 01:58 se
 *    descarta por dos minutos, y ese cliente se salta un día entero sin que nada
 *    falle. Es exactamente el mismo motivo por el que el ciclo de stock compara
 *    su cadencia con un minuto de holgura.
 *
 * 2. EL INFORME DE LISTINGS ESTÁ CACHEADO ENTRE 1 Y 6 HORAS. Amazon documenta un
 *    compromiso de frescura de 3 horas para los datos de inventario y avisa de
 *    que peticiones repetidas del mismo informe dentro de la ventana de caché
 *    devuelven la misma foto. O sea: pedirlo dos veces en dos horas gasta cupo
 *    para recibir exactamente lo mismo. Por eso `informeEsFresco()` existe y por
 *    eso este informe NUNCA es la fuente de un refresco de quince minutos.
 */

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

export type VelocidadRefresco = 'diario' | 'semanal' | 'a_demanda'

export const VELOCIDAD_LABELS: Record<VelocidadRefresco, string> = {
  diario: 'Diario (solo el subconjunto activo)',
  semanal: 'Semanal (catálogo completo)',
  a_demanda: 'A demanda',
}

const HORA_MS = 60 * 60 * 1000

/**
 * Horas mínimas entre dos refrescos de la misma velocidad.
 *
 * Ver la nota 1 de la cabecera: son 20 y 144 y no 24 y 168 para que un arranque
 * unos minutos antes no salte un ciclo entero.
 */
export const CADENCIA_HORAS: Record<VelocidadRefresco, number> = {
  diario: 20,
  semanal: 144,
  a_demanda: 0,
}

/**
 * Cuántas horas tarda Amazon en dar datos nuevos en el informe de listings.
 *
 * Es el compromiso que publica Amazon (3 horas), y la ventana de caché real va
 * de 1 a 6 según el tamaño del catálogo. Pedirlo antes de que pasen no trae nada
 * nuevo: devuelve la misma foto y gasta una ficha de un cupo que es de UNA
 * llamada por minuto.
 */
export const FRESCURA_INFORME_HORAS = 3

/* ------------------------------------------------------------------ */
/* La ventana nocturna                                                 */
/* ------------------------------------------------------------------ */

/**
 * Una franja horaria en hora local. Puede envolver la medianoche (22 -> 6), que
 * es justo el caso de la ventana nocturna.
 */
export interface VentanaHoraria {
  /** 0..23 */
  inicioHora: number
  /** 0..23. Si es menor o igual que el inicio, la franja cruza la medianoche */
  finHora: number
}

/** De 23:00 a 06:00 en hora de España, que es cuando el ERP no lo usa nadie */
export const VENTANA_NOCTURNA: VentanaHoraria = { inicioHora: 23, finHora: 6 }

/** La zona horaria en la que se razona sobre «la noche». La misma que la agenda */
export const ZONA = 'Europe/Madrid'

/**
 * La hora local (0..23) de un instante en una zona.
 *
 * Con Intl y no con getHours(): el contenedor corre en UTC y `getHours()`
 * devolvería la hora de Londres, así que en verano la ventana nocturna
 * española empezaría dos horas tarde. Es determinista —mismos argumentos,
 * mismo resultado—, así que la función sigue siendo pura.
 */
export function horaLocal(instante: Date, zona: string = ZONA): number {
  const texto = new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    hour12: false,
    timeZone: zona,
  }).format(instante)
  const n = Number(texto)
  // '24' es lo que devuelve la medianoche en algunos entornos con hourCycle h24.
  if (!Number.isFinite(n)) return 0
  return n % 24
}

/** ¿Estamos dentro de la franja? Aguanta que cruce la medianoche */
export function dentroDeVentana(
  instante: Date,
  ventana: VentanaHoraria,
  zona: string = ZONA
): boolean {
  const h = horaLocal(instante, zona)
  const { inicioHora, finHora } = ventana
  if (inicioHora === finHora) return true // franja de 24 horas
  if (inicioHora < finHora) return h >= inicioHora && h < finHora
  // Cruza la medianoche: 23 -> 6 es «>= 23 o < 6»
  return h >= inicioHora || h < finHora
}

/**
 * El próximo instante en que se abre la franja.
 *
 * Se calcula avanzando hora a hora como mucho un día y medio en vez de con
 * aritmética de husos: los cambios de hora de marzo y octubre hacen que «mañana
 * a las 23:00» no sea «dentro de 24 horas», y esa noche el barrido se quedaría
 * fuera de su ventana o entraría una hora antes. Treinta y seis comprobaciones
 * de una división no se notan y no hay caso raro.
 */
export function proximaApertura(
  desde: Date,
  ventana: VentanaHoraria,
  zona: string = ZONA
): Date {
  let cursor = new Date(desde.getTime())
  for (let i = 0; i < 36; i++) {
    cursor = new Date(cursor.getTime() + HORA_MS)
    if (dentroDeVentana(cursor, ventana, zona)) return cursor
  }
  // Inalcanzable con una franja válida, pero devolver algo es mejor que lanzar
  // en una función que solo sirve para pintar una fecha.
  return new Date(desde.getTime() + 24 * HORA_MS)
}

/* ------------------------------------------------------------------ */
/* El plan                                                             */
/* ------------------------------------------------------------------ */

export interface PlanRefresco {
  velocidad: VelocidadRefresco
  /** ¿Se puede lanzar ahora? */
  leToca: boolean
  /** Por qué sí o por qué no, en español y ya redactado */
  motivo: string
  /** Desde cuándo se considera que un dato sigue estando fresco */
  frescoDesde: Date
  /** Cuándo será la próxima oportunidad. null si es ahora mismo */
  proxima: Date | null
}

export interface OpcionesRefresco {
  velocidad: VelocidadRefresco
  /** El instante contra el que se decide. SIEMPRE por parámetro */
  ahora: Date
  /** Cuándo se hizo el último refresco de esta velocidad. null = nunca */
  ultimo: Date | null
  /** Para forzar una cadencia distinta de la de fábrica */
  cadenciaHoras?: number
  /**
   * Franja en la que se permite ARRANCAR. null = a cualquier hora.
   *
   * Solo condiciona el arranque: un barrido que empieza a las 05:50 y tarda dos
   * horas no se corta a las 06:00. Cortarlo dejaría el catálogo a medias, que es
   * peor que acabar tarde.
   */
  ventana?: VentanaHoraria | null
  zona?: string
}

/**
 * ¿Le toca a este refresco, y si no, cuándo?
 *
 * Devuelve un plan entero y no un booleano porque quien llama tiene que poder
 * ENSEÑAR el porqué: «no le toca» sin fecha ni motivo es lo que hace que alguien
 * abra la consola para entender una pantalla.
 */
export function ventanaDeRefresco(opciones: OpcionesRefresco): PlanRefresco {
  const { velocidad, ahora, ultimo } = opciones
  const zona = opciones.zona ?? ZONA
  const cadenciaHoras = opciones.cadenciaHoras ?? CADENCIA_HORAS[velocidad]
  const cadenciaMs = cadenciaHoras * HORA_MS
  const frescoDesde = new Date(ahora.getTime() - cadenciaMs)
  const ventana = opciones.ventana ?? null

  const base = { velocidad, frescoDesde }

  // ---------- ¿Ha pasado la cadencia? ----------
  if (ultimo !== null && cadenciaMs > 0) {
    const transcurridoMs = ahora.getTime() - ultimo.getTime()
    if (transcurridoMs < cadenciaMs) {
      const disponible = new Date(ultimo.getTime() + cadenciaMs)
      const proxima = ventana ? conVentana(disponible, ventana, zona) : disponible
      return {
        ...base,
        leToca: false,
        motivo:
          `El último refresco ${VELOCIDAD_LABELS[velocidad].toLowerCase()} fue hace ` +
          `${horasLegibles(transcurridoMs)} y su cadencia es de ${cadenciaHoras} horas.`,
        proxima,
      }
    }
  }

  // ---------- ¿Estamos en la franja? ----------
  if (ventana && !dentroDeVentana(ahora, ventana, zona)) {
    const proxima = proximaApertura(ahora, ventana, zona)
    return {
      ...base,
      leToca: false,
      motivo:
        `Le toca, pero este barrido solo arranca entre las ${dosDigitos(ventana.inicioHora)}:00 y ` +
        `las ${dosDigitos(ventana.finHora)}:00, que es cuando no hay nadie usando el ERP.`,
      proxima,
    }
  }

  return {
    ...base,
    leToca: true,
    motivo:
      ultimo === null
        ? 'No se ha hecho nunca.'
        : `El último fue hace ${horasLegibles(ahora.getTime() - ultimo.getTime())}.`,
    proxima: null,
  }
}

/** Si el instante en que vuelve a tocar cae fuera de la franja, la próxima
    oportunidad de verdad es cuando la franja se abra */
function conVentana(instante: Date, ventana: VentanaHoraria, zona: string): Date {
  return dentroDeVentana(instante, ventana, zona)
    ? instante
    : proximaApertura(instante, ventana, zona)
}

/**
 * ¿El informe de listings que pedimos hace un rato sigue sirviendo?
 *
 * Si la respuesta es sí, volver a pedirlo devuelve LA MISMA FOTO: Amazon lo
 * tiene cacheado. Gastar una llamada de `createReport` —que es una por minuto—
 * para recibir lo mismo es lo que convierte un barrido de dieciséis clientes en
 * una cola.
 */
export function informeEsFresco(
  ultimoInforme: Date | null,
  ahora: Date,
  horas: number = FRESCURA_INFORME_HORAS
): boolean {
  if (ultimoInforme === null) return false
  return ahora.getTime() - ultimoInforme.getTime() < horas * HORA_MS
}

/**
 * La fecha desde la que hay que pedir ventas para una ventana de N días.
 *
 * Devuelve 'YYYY-MM-DD' porque amazon_ventas_externas.fecha es DATE, y la
 * comparación se hace en la base: convertir a texto aquí evita que una zona
 * horaria distinta en el contenedor mueva el corte un día.
 */
export function inicioDeVentana(ahora: Date, dias: number): string {
  const ms = ahora.getTime() - dias * 24 * HORA_MS
  return new Date(ms).toISOString().slice(0, 10)
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

/**
 * Reparte una lista en lotes.
 *
 * Está aquí y no en el motor porque el tamaño de lote es una decisión de
 * dominio: 20 en casi todo, porque es el número mágico de la Selling Partner
 * API (`searchCatalogItems.identifiers`, `searchListingsItems.pageSize` y todas
 * las operaciones por lotes admiten exactamente 20).
 */
export const LOTE_AMAZON = 20

export function repartirEnLotes<T>(items: T[], tamano: number = LOTE_AMAZON): T[][] {
  if (tamano < 1) throw new Error('El tamaño de lote tiene que ser al menos 1')
  const lotes: T[][] = []
  for (let i = 0; i < items.length; i += tamano) {
    lotes.push(items.slice(i, i + tamano))
  }
  return lotes
}

function dosDigitos(n: number): string {
  return String(n).padStart(2, '0')
}

/** «3 horas», «45 minutos», «2 días». Para meter en una frase */
export function horasLegibles(ms: number): string {
  const minutos = Math.max(0, Math.round(ms / 60000))
  if (minutos < 60) return `${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`
  const horas = Math.round(minutos / 60)
  if (horas < 48) return `${horas} ${horas === 1 ? 'hora' : 'horas'}`
  const dias = Math.round(horas / 24)
  return `${dias} ${dias === 1 ? 'día' : 'días'}`
}
