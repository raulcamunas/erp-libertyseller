/**
 * ENTRAIS · LA API DEL PROVEEDOR
 * ==============================
 * SOLO SERVIDOR: aquí se lee la contraseña del cliente.
 *
 * API REST propia de un proveedor (aseuropa.com), documentada con Swagger. De
 * aquí salen sus productos, sus precios, su stock y sus pedidos.
 *
 *
 * ============ DOS ENTORNOS Y DOS CONTRASEÑAS DISTINTAS ============
 *
 *   pruebas    puerto 5003
 *   producción puerto 5002
 *
 * Cada uno con SU contraseña, y ese es el detalle que hay que tener presente:
 * usar la de pruebas contra producción no da un error de «entorno equivocado»,
 * da un 401 pelado que parece una credencial caducada. Por eso el entorno viaja
 * siempre junto y de él salen la URL y la credencial a la vez.
 *
 * DE MOMENTO SOLO SE LEE. Este módulo no manda nada: `CreatePreOrder` está en su
 * API y aquí no se llama. Crear una reserva en el proveedor de un cliente es una
 * decisión aparte, con su registro y su confirmación, y no algo que aparezca de
 * paso mientras se explora qué datos hay.
 *
 *
 * ============ LAS CREDENCIALES NO ESTÁN AQUÍ ============
 *
 * Salen del entorno del servidor. Son de un CLIENTE —nos las ha dado para
 * trabajar con su proveedor— y no tienen por qué estar en el repositorio ni en
 * la base de datos.
 *
 *   ENTRAIS_LOGIN            el mismo en los dos entornos
 *   ENTRAIS_PASSWORD_PRUEBAS
 *   ENTRAIS_PASSWORD_REAL
 */

export type EntornoEntrais = 'pruebas' | 'real'

/**
 * UN PRODUCTO TAL CUAL LO DEVUELVE ELLOS.
 *
 * `code` es la pieza importante: es el código interno del proveedor Y es el SKU
 * con el que el cliente tiene creados sus listings en Amazon. Comprobado contra
 * Seller Central — el cliente montó las ofertas usando el código del proveedor,
 * así que no hace falta ninguna tabla de equivalencias entre los dos sistemas.
 *
 * Dos avisos sobre los campos:
 *
 *   `stock` PUEDE SER NEGATIVO (se han visto -1, -8, -100). Es lo que pasa
 *   cuando han vendido por encima de lo que tenían. Cualquier cuenta que lo
 *   trate como «unidades disponibles» sin más se lleva un número por debajo de
 *   cero a Amazon.
 *
 *   `ean` viene vacío en un 8% del catálogo (refurbished, baterías, equipos a
 *   medida) y `entries` es null casi siempre; cuando trae algo son las entradas
 *   FUTURAS con fecha y unidades, que es lo que dice si merece la pena esperar
 *   en vez de despublicar.
 */
export interface ProductoEntrais {
  code: number
  description: string
  family: { familyCode: string; description: string } | null
  brand: { brandCode: string; description: string } | null
  subfamily: { subfamilyCode: string; description: string } | null
  ean: string | null
  partNumber: string | null
  /** true en licencias y ESD: no tienen stock físico */
  digital: boolean
  /** El coste, SIN IVA */
  price: number
  /** Canon digital por unidad. Va aparte del precio */
  digitalCanon: number
  stock: number
  entries: { date: string; units: number }[] | null
  pricesPerQuantity: unknown
}

/** Si la respuesta trae productos, para saber si se puede pintar la tabla */
export function esProducto(x: unknown): x is ProductoEntrais {
  if (typeof x !== 'object' || x === null) return false
  const p = x as Record<string, unknown>
  return typeof p.code === 'number' && typeof p.description === 'string'
}

const BASES: Record<EntornoEntrais, string> = {
  pruebas: 'https://www.aseuropa.com:5003',
  real: 'https://www.aseuropa.com:5002',
}

export class EntraisError extends Error {
  readonly estado?: number
  constructor(mensaje: string, estado?: number) {
    super(mensaje)
    this.name = 'EntraisError'
    this.estado = estado
  }
}

function credenciales(entorno: EntornoEntrais): { login: string; password: string } | null {
  const login = process.env.ENTRAIS_LOGIN?.trim()
  const password = (
    entorno === 'real' ? process.env.ENTRAIS_PASSWORD_REAL : process.env.ENTRAIS_PASSWORD_PRUEBAS
  )?.trim()
  if (!login || !password) return null
  return { login, password }
}

export function faltaConfigurar(entorno: EntornoEntrais): string | null {
  if (credenciales(entorno)) return null
  return (
    `El servidor no tiene las credenciales de Entrais para el entorno «${entorno}». ` +
    'Hacen falta ENTRAIS_LOGIN y ' +
    (entorno === 'real' ? 'ENTRAIS_PASSWORD_REAL' : 'ENTRAIS_PASSWORD_PRUEBAS') +
    '.'
  )
}

/* ------------------------------------------------------------------ */
/* El token                                                            */
/* ------------------------------------------------------------------ */

/**
 * EL TOKEN DURA UNA HORA Y SE GUARDA EN MEMORIA, no en la base.
 *
 * En la base habría que cifrarlo, tener su tabla y limpiarlo; y a cambio no
 * ganaría nada, porque caduca en sesenta minutos y sacar otro cuesta UNA
 * llamada. Vive en el proceso: si el servidor se reinicia, la siguiente petición
 * pide uno nuevo y ya está.
 *
 * El margen de un minuto evita el caso de mandar una petición con un token que
 * caduca mientras viaja — un 401 que parece una credencial mala.
 */
const tokens = new Map<EntornoEntrais, { valor: string; expira: number }>()
const MARGEN_MS = 60_000

async function token(entorno: EntornoEntrais): Promise<string> {
  const guardado = tokens.get(entorno)
  if (guardado && guardado.expira - MARGEN_MS > Date.now()) return guardado.valor

  const cred = credenciales(entorno)
  if (!cred) throw new EntraisError(faltaConfigurar(entorno) ?? 'Faltan las credenciales.')

  const res = await fetch(`${BASES[entorno]}/api/v1/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain' },
    body: JSON.stringify({ login: cred.login, password: cred.password }),
  })

  const texto = (await res.text()).trim()

  if (!res.ok) {
    throw new EntraisError(
      res.status === 401
        ? `Entrais rechaza el usuario o la contraseña del entorno «${entorno}» (401). Cada entorno ` +
          'tiene la suya: comprueba que no se ha puesto la de pruebas en el real o al revés.'
        : `Entrais ha contestado ${res.status} al identificarse: ${texto.slice(0, 200)}`,
      res.status
    )
  }

  /**
   * El token llega como TEXTO PLANO, no como JSON.
   *
   * El Swagger lo declara con `text/plain`, así que un `res.json()` aquí falla
   * con un error de sintaxis que no menciona el token por ningún lado. Se
   * intenta leer como JSON por si algún día cambian —hay APIs que devuelven
   * `{"token":"..."}`— y si no, se usa el texto tal cual, quitándole las
   * comillas que algunas envuelven.
   */
  let valor = texto
  try {
    const json = JSON.parse(texto) as { token?: string } | string
    valor = typeof json === 'string' ? json : (json.token ?? texto)
  } catch {
    valor = texto.replace(/^"|"$/g, '')
  }

  if (!valor) throw new EntraisError('Entrais ha contestado al login sin dar ningún token.')

  // Una hora, según su documentación. Se guarda el momento y no la duración
  // para no tener que volver a calcularlo en cada comprobación.
  tokens.set(entorno, { valor, expira: Date.now() + 3600_000 })
  return valor
}

/* ------------------------------------------------------------------ */
/* La cuota                                                            */
/* ------------------------------------------------------------------ */

/**
 * CUATRO LLAMADAS POR HORA AL CATÁLOGO. NO ES NEGOCIABLE Y NO LO PONE EN SU
 * DOCUMENTACIÓN.
 * ====================================================================
 *
 * Se descubrió en producción, con un 429 en la cara:
 *
 *     API calls quota exceeded! maximum admitted 4 per 1h
 *
 * Cuatro. Y `/api/v1/Products` es la llamada que hace absolutamente todo en
 * este ERP: el banco de pruebas, el botón de Comprobar, el de Probar, el
 * simulacro y cada pasada del ciclo de stock. Con la cadencia en quince minutos
 * el ciclo solo ya se las gasta las cuatro, y entonces nadie puede probar nada
 * en toda la hora — ni el ciclo reintentar si una falla.
 *
 * De ahí las dos piezas de aquí abajo, y ninguna es una optimización:
 *
 *   LA CACHÉ evita que probar sea caro. Configurar un perfil es darle a Probar,
 *   mirar, cambiar una columna y volver a darle. Sin caché eso son cuatro
 *   llamadas y se acabó la hora. Con ella es UNA, y las tres siguientes salen
 *   instantáneas de memoria.
 *
 *   EL CONTADOR convierte un 429 en una frase que se entiende. «Quedan 0 de 4
 *   llamadas; la siguiente se libera a las 15:42» se lee y se sabe qué hacer;
 *   un 429 en mitad de un simulacro manda a mirar el código del ERP, que es
 *   donde no está el problema.
 *
 * El contador vive en memoria, así que un reinicio del contenedor lo pone a
 * cero y podría colarse una llamada de más. No pasa nada: el 429 sigue estando
 * manejado y sigue diciendo lo que pasa. Lo que evita el contador es el caso
 * normal, que es el que ocurre todos los días.
 */
interface Cuota {
  patron: RegExp
  porHora: number
  /** Cuánto vale una respuesta antes de volver a pedirla */
  cacheMs: number
  nombre: string
}

const CUOTAS: Cuota[] = [
  {
    patron: /^\/api\/v1\/Products\b/i,
    porHora: 4,
    // VEINTE MINUTOS, Y ESTÁ ELEGIDO CONTRA LA CADENCIA DEL CICLO, no al azar.
    // El perfil tiene que ir a 30 minutos (dos llamadas por hora, la mitad de
    // la cuota). Con la caché a 20, el ciclo SIEMPRE encuentra la caché vencida
    // y trae datos frescos —que es su trabajo—, y todo lo que haga una persona
    // en los veinte minutos siguientes sale gratis.
    cacheMs: 20 * 60_000,
    nombre: 'el catálogo entero',
  },
]

function cuotaDe(ruta: string): Cuota | null {
  return CUOTAS.find((c) => c.patron.test(ruta)) ?? null
}

/** Cuándo se llamó, por entorno y ruta con cuota. Solo se guardan las de la última hora */
const llamadas = new Map<string, number[]>()

function registro(entorno: EntornoEntrais, cuota: Cuota, ahora: number): number[] {
  const clave = `${entorno}|${cuota.nombre}`
  const previas = (llamadas.get(clave) ?? []).filter((t) => ahora - t < 3600_000)
  llamadas.set(clave, previas)
  return previas
}

/** Cuántas llamadas quedan de la hora en curso, y cuándo se libera la siguiente */
export function cuotaRestante(
  entorno: EntornoEntrais,
  ruta: string
): { limite: number; usadas: number; quedan: number; seLiberaEn: Date | null } | null {
  const cuota = cuotaDe(ruta)
  if (!cuota) return null
  const ahora = Date.now()
  const previas = registro(entorno, cuota, ahora)
  return {
    limite: cuota.porHora,
    usadas: previas.length,
    quedan: Math.max(0, cuota.porHora - previas.length),
    // La más antigua de la ventana es la que caduca primero y libera un hueco.
    seLiberaEn: previas.length > 0 ? new Date(Math.min(...previas) + 3600_000) : null,
  }
}

function hora(d: Date): string {
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

/* ------------------------------------------------------------------ */
/* La caché                                                            */
/* ------------------------------------------------------------------ */

const cache = new Map<string, { valor: unknown; guardadoEn: number }>()

/** Tira la caché de una ruta. Para el botón de «traer esto ahora sí o sí» */
export function olvidarCache(entorno: EntornoEntrais, ruta: string): void {
  cache.delete(`${entorno}|${ruta}`)
}

/* ------------------------------------------------------------------ */
/* Llamar                                                              */
/* ------------------------------------------------------------------ */

export interface LecturaEntrais<T> {
  datos: T
  /** true si no se ha llamado a nadie: esto salía de memoria */
  deCache: boolean
  /** Antigüedad del dato en milisegundos. 0 si se acaba de traer */
  edadMs: number
  /** Cómo va la cuota DESPUÉS de esta llamada. null si esta ruta no tiene */
  cuota: ReturnType<typeof cuotaRestante>
}

/**
 * Una llamada a la API de Entrais, con el token puesto, la caché delante y el
 * contador de cuota detrás.
 *
 * `frescura` es el margen que acepta quien llama: 0 obliga a ir a la API. Por
 * omisión se usa el de la cuota, o nada si la ruta no tiene.
 */
export async function llamarEntraisDetalle<T>(
  entorno: EntornoEntrais,
  ruta: string,
  opciones: { frescuraMs?: number; soloCache?: boolean } = {}
): Promise<LecturaEntrais<T>> {
  const cuota = cuotaDe(ruta)
  const clave = `${entorno}|${ruta}`
  const frescuraMs = opciones.frescuraMs ?? cuota?.cacheMs ?? 0

  const guardado = cache.get(clave)
  if (guardado && frescuraMs > 0 && Date.now() - guardado.guardadoEn < frescuraMs) {
    return {
      datos: guardado.valor as T,
      deCache: true,
      edadMs: Date.now() - guardado.guardadoEn,
      cuota: cuotaRestante(entorno, ruta),
    }
  }

  /**
   * SOLO CACHÉ: USAR LO QUE YA SE TRAJO, O NO HACER NADA.
   *
   * Entrais deja cuatro llamadas por hora al catálogo, y hasta ahora había DOS
   * sitios que lo pedían: el ciclo de stock y el motor de precios. Se salvaban
   * porque la caché de veinte minutos hacía que el segundo reutilizara lo del
   * primero — hasta el día en que el primero falló por cuota, no guardó nada, y
   * el segundo volvió a llamar y se comió también el límite por minuto. Dos
   * errores distintos por lo mismo.
   *
   * Con esto el motor de precios deja de ser un consumidor de cuota: trabaja con
   * el catálogo que trajo la pasada de stock y punto. Si no hay ninguno todavía
   * —recién desplegado, o la pasada falló— no publica y lo dice, que es mejor
   * que gastar la llamada que le hace falta al stock.
   */
  if (opciones.soloCache) {
    /**
     * PERO NO A COSTA DE NO PUBLICAR NUNCA.
     *
     * La caché vive en la memoria del proceso, así que CADA DESPLIEGUE la borra.
     * Con un «solo caché» estricto, la publicación de precios se quedaba
     * esperando indefinidamente a una pasada de stock que ya había ocurrido
     * antes del reinicio — y desde fuera se veía como «el interruptor está
     * encendido y no manda nada», otra vez.
     *
     * Así que si no hay nada guardado se llama, PERO solo si sobra cuota: se
     * reservan dos llamadas para el ciclo de stock, que es quien no puede
     * quedarse sin ellas. En marcha normal esto no ocurre nunca —la pasada de
     * stock acaba de guardar el catálogo dos líneas antes— y solo entra en juego
     * justo después de un despliegue.
     */
    const restante = cuotaRestante(entorno, ruta)
    const RESERVA_PARA_EL_STOCK = 2
    if (restante && restante.quedan <= RESERVA_PARA_EL_STOCK) {
      throw new EntraisError(
        `No hay catálogo del proveedor en memoria —se borra en cada despliegue— y solo quedan ` +
          `${restante.quedan} de ${restante.limite} llamadas esta hora, que se reservan para el ` +
          'stock. La siguiente pasada de stock lo dejará en memoria y entonces se publica sin gastar nada.',
        0
      )
    }
  }

  if (cuota) {
    const ahora = Date.now()
    const previas = registro(entorno, cuota, ahora)
    if (previas.length >= cuota.porHora) {
      const libre = new Date(Math.min(...previas) + 3600_000)
      /**
       * SE PARA ANTES DE LLAMAR, y con el dato viejo a mano si lo hay.
       *
       * Gastar la llamada para recibir un 429 no informa de nada que no se
       * supiera ya, y encima no deja constancia útil: el mensaje de ellos dice
       * el límite pero no cuándo se libera, que es lo único que quien está
       * delante necesita saber.
       */
      throw new EntraisError(
        `Entrais solo deja ${cuota.porHora} llamadas por hora a ${cuota.nombre} y ya se han hecho las ${cuota.porHora}. ` +
          `La siguiente se libera a las ${hora(libre)}.` +
          (guardado
            ? ` Hay una lectura de hace ${Math.round((Date.now() - guardado.guardadoEn) / 60_000)} minutos guardada, ` +
              'pero se ha pedido una fresca expresamente.'
            : ''),
        429
      )
    }
    previas.push(ahora)
    llamadas.set(`${entorno}|${cuota.nombre}`, previas)
  }

  const datos = await pedir<T>(entorno, ruta)
  cache.set(clave, { valor: datos, guardadoEn: Date.now() })

  return { datos, deCache: false, edadMs: 0, cuota: cuotaRestante(entorno, ruta) }
}

/** Lo de siempre, cuando solo se quieren los datos */
export async function llamarEntrais<T>(
  entorno: EntornoEntrais,
  ruta: string,
  opciones: { frescuraMs?: number; soloCache?: boolean } = {}
): Promise<T> {
  return (await llamarEntraisDetalle<T>(entorno, ruta, opciones)).datos
}

/**
 * La petición pelada.
 *
 * Si contesta 401 se tira el token guardado y se reintenta UNA vez: es lo que
 * pasa cuando caduca entre dos peticiones, y hacer que el usuario vea un error
 * de sesión por algo que se arregla solo con una llamada más sería absurdo. Una
 * sola vez, para que un 401 de verdad —credencial cambiada— no se convierta en
 * un bucle.
 *
 * EL REINTENTO DEL 401 NO CUENTA COMO LLAMADA NUEVA en el contador de cuota, y
 * es correcto: la primera no llegó a hacer nada porque el token estaba muerto.
 * Si su servidor la contara igual, el 429 del contador llegaría un poco tarde y
 * lo cazaría el 429 de ellos, que también está manejado.
 */
async function pedir<T>(entorno: EntornoEntrais, ruta: string, reintento = false): Promise<T> {
  const res = await fetch(`${BASES[entorno]}${ruta}`, {
    headers: {
      Authorization: `Bearer ${await token(entorno)}`,
      Accept: 'application/json',
    },
  })

  if (res.status === 401 && !reintento) {
    tokens.delete(entorno)
    return await pedir<T>(entorno, ruta, true)
  }

  const texto = await res.text()

  if (!res.ok) {
    // Su 429 dice el límite pero no cuándo se libera. Se completa con lo que
    // sabemos, que es la ventana de una hora.
    if (res.status === 429) {
      throw new EntraisError(
        `Entrais ha cortado por cuota: ${texto.slice(0, 200) || 'demasiadas llamadas'}. ` +
          'La ventana es de una hora desde la primera llamada, así que hay que esperar.',
        429
      )
    }
    throw new EntraisError(
      `Entrais ha contestado ${res.status} a ${ruta}: ${texto.slice(0, 300) || 'sin cuerpo'}`,
      res.status
    )
  }

  return (texto ? JSON.parse(texto) : null) as T
}

export function baseDe(entorno: EntornoEntrais): string {
  return BASES[entorno]
}
