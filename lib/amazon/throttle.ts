/**
 * EL CUPO DE PETICIONES DE AMAZON
 * ===============================
 * Amazon reparte las llamadas con un cubo de fichas: se reponen a un ritmo fijo
 * hasta un máximo (la ráfaga), cada petición gasta una, y cuando el cubo está
 * vacío la respuesta es un 429.
 *
 * EL DATO QUE CAMBIA EL DISEÑO: EL CUPO ES POR VENDEDOR, POR APLICACIÓN Y POR
 * OPERACIÓN. No se reparte entre clientes. Dos clientes distintos tienen cada
 * uno sus 5 peticiones por segundo con nuestra aplicación, y el mismo cliente
 * en Europa y en Estados Unidos también tiene dos cubos separados, porque son
 * credenciales de regiones distintas.
 *
 * Por eso el cubo se indexa por (conexión, operación) y no hay un limitador
 * global: uno global convertiría diez clientes pequeños en una cola lenta sin
 * que Amazon lo pidiera.
 *
 * LA CUENTA QUE JUSTIFICA LOS 15 MINUTOS DE REFRESCO
 * --------------------------------------------------
 * searchListingsItems devuelve como mucho 20 líneas por página (no 100: 20).
 * Un cliente de unos 400 SKU son 20 páginas. A 5 peticiones por segundo, unos
 * 4 segundos por cliente y marketplace. En una ventana de 15 minutos cabe eso
 * doscientas veces. El cuarto de hora no va justo, va sobradísimo.
 *
 * DÓNDE VIVE ESTO
 * ---------------
 * En memoria del proceso de Next. Si mañana hubiera dos contenedores sirviendo
 * el ERP, cada uno tendría sus cubos y entre los dos podrían pasarse del cupo:
 * el efecto sería algún 429, que ya se reintenta con espera creciente. No es un
 * problema hoy —hay un solo contenedor— pero conviene saberlo antes de escalar,
 * porque el arreglo (un limitador compartido) no es trivial.
 */

/** Las operaciones que usa este módulo. Cada una tiene su propio cubo */
export type AmazonOperation =
  | 'searchListingsItems'
  | 'getListingsItem'
  | 'patchListingsItem'
  | 'getInventorySummaries'
  | 'getMarketplaceParticipations'

export interface RateLimitSpec {
  /** Fichas por segundo */
  rate: number
  /** Cuántas se pueden acumular, o sea cuántas seguidas se pueden lanzar */
  burst: number
}

/**
 * Los límites publicados por Amazon para cada operación.
 *
 * Están escritos aquí y no leídos de la cabecera de respuesta porque la
 * documentación avisa expresamente: la cabecera x-amzn-RateLimit-Limit no
 * aparece en todas las respuestas (nunca en un 401) y «no debes depender de que
 * esté». Es un ajuste oportunista, no la fuente de verdad. La fuente de verdad
 * es esta tabla.
 *
 * Ojo con getInventorySummaries: 2 por segundo, la mitad que las demás. Es la
 * más lenta y la que hay que tener en cuenta al planificar el refresco de un
 * cliente con FBA.
 */
export const AMAZON_RATE_LIMITS: Record<AmazonOperation, RateLimitSpec> = {
  searchListingsItems: { rate: 5, burst: 5 },
  getListingsItem: { rate: 5, burst: 5 },
  patchListingsItem: { rate: 5, burst: 5 },
  getInventorySummaries: { rate: 2, burst: 2 },
  // Una cada minuto largo, con ráfaga de 15. Por eso se llama al autorizar y se
  // guarda el resultado en la conexión, nunca en cada refresco.
  getMarketplaceParticipations: { rate: 0.016, burst: 15 },
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Un cubo de fichas.
 *
 * `take()` no devuelve un booleano ni lanza: ESPERA. Quien llama no tiene que
 * saber nada del cupo, solo hacer `await`. Y las esperas se sirven EN ORDEN
 * (cada llamada se encadena a la anterior), porque si veinte peticiones se
 * despertaran a la vez a mirar el cubo, la última podría quedarse esperando
 * indefinidamente mientras las demás se cuelan.
 */
export class TokenBucket {
  private tokens: number
  private lastRefill: number
  private rate: number
  private burst: number
  /** Los valores publicados de esta operación. NO se tocan nunca: son el suelo
      y el techo contra los que se contrasta lo que diga la cabecera */
  private readonly spec: RateLimitSpec
  /** La cola: cada take() se encadena al anterior para que se sirvan en orden */
  private chain: Promise<void> = Promise.resolve()

  constructor(spec: RateLimitSpec) {
    this.spec = spec
    this.rate = spec.rate
    this.burst = spec.burst
    this.tokens = spec.burst
    this.lastRefill = Date.now()
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = (now - this.lastRefill) / 1000
    if (elapsed <= 0) return
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.rate)
    this.lastRefill = now
  }

  /** Espera hasta que haya ficha, y la gasta */
  take(): Promise<void> {
    const turno = this.chain.then(() => this.acquire())
    // El .catch vacío es para que un fallo de una espera no rompa la cadena y
    // deje colgadas a todas las peticiones que vengan detrás.
    this.chain = turno.catch(() => undefined)
    return turno
  }

  private async acquire(): Promise<void> {
    for (;;) {
      this.refill()
      if (this.tokens >= 1) {
        this.tokens -= 1
        return
      }
      const faltan = 1 - this.tokens
      // Mínimo 20 ms: con ritmos altos el cálculo puede dar 1 ms y girar en
      // vacío quemando CPU sin que el reloj avance lo suficiente.
      const esperaMs = Math.max(20, Math.ceil((faltan / this.rate) * 1000))
      await sleep(esperaMs)
    }
  }

  /**
   * Ajusta el ritmo con lo que diga la cabecera x-amzn-RateLimit-Limit de una
   * respuesta.
   *
   * Es oportunista: Amazon puede tener un cupo distinto del publicado para una
   * cuenta concreta. Si no viene la cabecera —que es lo normal en muchas
   * respuestas— no se toca nada.
   *
   * TRES CAUTELAS, Y LAS TRES SALIERON DE UN CASO MEDIDO:
   *
   *   1. EN UN 429 NO SE HACE CASO. Ahí es justo cuando Amazon devuelve el
   *      valor más castigado, y creérselo convierte un pico de un segundo en un
   *      cupo estrangulado para el resto de la vida del proceso.
   *
   *   2. HAY SUELO. Se aceptaba cualquier número: una sola cabecera con «0.5»
   *      dejaba los PATCH de esa conexión a dos segundos cada uno, y un lote de
   *      300 cambios pasaba de un minuto a más de diez —con la petición del
   *      navegador cortada por el proxy a mitad—. Por debajo de la mitad del
   *      ritmo publicado se ignora: eso ya no es «tu cupo es otro», es un dato
   *      raro.
   *
   *   3. LA RÁFAGA PUEDE VOLVER A SUBIR. Antes era `Math.min(this.burst, …)`,
   *      o sea un trinquete de una sola dirección: tras recibir «1.0» el cubo
   *      se quedaba midiendo una ficha aunque después llegara «5.0». Ahora se
   *      recalcula SIEMPRE contra el valor publicado de la tabla, que es lo que
   *      permite recuperarse.
   */
  observeLimitHeader(value: string | null, httpStatus?: number): void {
    if (!value) return
    if (httpStatus === 429) return

    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0) return
    if (n < this.spec.rate / 2) return

    this.rate = n
    // Contra la tabla, no contra el valor actual: así se puede bajar y volver a
    // subir. Y nunca por debajo de una ficha, o el cubo no serviría de nada.
    this.burst = Math.max(1, Math.min(this.spec.burst, Math.ceil(n)))
    this.tokens = Math.min(this.tokens, this.burst)
  }

  /** Solo para poder comprobarlo desde fuera */
  get availableTokens(): number {
    this.refill()
    return this.tokens
  }
}

/**
 * Los cubos vivos, indexados por «conexión + operación».
 *
 * Un Map que crece con cada conexión nueva y no se vacía nunca: son unas pocas
 * decenas de objetos diminutos, y limpiarlos por tiempo solo conseguiría que
 * una conexión que vuelve tras un rato arranque con el cubo lleno y se lleve un
 * 429 de bienvenida.
 */
const buckets = new Map<string, TokenBucket>()

export function bucketFor(connectionId: string, operation: AmazonOperation): TokenBucket {
  const key = `${connectionId}|${operation}`
  let bucket = buckets.get(key)
  if (!bucket) {
    bucket = new TokenBucket(AMAZON_RATE_LIMITS[operation])
    buckets.set(key, bucket)
  }
  return bucket
}

/** Vacía los cubos. Existe para las pruebas, no para producción */
export function resetBuckets(): void {
  buckets.clear()
}

/* ------------------------------------------------------------------ */
/* Espera creciente entre reintentos                                   */
/* ------------------------------------------------------------------ */

/** Espera base del primer reintento */
const BACKOFF_BASE_MS = 500
/** Techo, para que un fallo largo de Amazon no deje una petición esperando un minuto */
const BACKOFF_MAX_MS = 8_000

/**
 * Cuánto esperar antes del intento número `attempt` (empezando en 1).
 *
 * Exponencial y CON RUIDO. El ruido no es adorno: si veinte peticiones se
 * llevan un 429 a la vez y todas esperan exactamente 500 ms, vuelven las veinte
 * a la vez y se llevan otro 429. El desorden es lo que rompe esa sincronía.
 *
 * La documentación de Amazon lo dice con otras palabras: ante un 429, espera
 * creciente y repartir la carga, no cronometrar a pelo.
 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1))
  // Entre el 50 % y el 100 % de la espera calculada.
  return Math.round(base * (0.5 + random() * 0.5))
}
