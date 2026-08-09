import { NextResponse } from 'next/server'

/**
 * TOPE DE BYTES PARA LAS SUBIDAS DE FICHERO.
 *
 * QUÉ IMPIDE, HOY Y CON PRECISIÓN
 * -------------------------------
 * Que una CUENTA DEL ERP tumbe el contenedor por falta de memoria subiendo un
 * fichero enorme por una de las ocho rutas de subida. No frena a un anónimo:
 * en esas ocho, `requireSession()` va DELANTE de esta comprobación y contesta
 * 401 primero. Medido, sin cookie, con un multipart de 60 MB:
 *
 *     /api/validator/calculate          -> 401 en 0.067 s
 *     /api/commissions/process          -> 401 en 0.041 s
 *     /api/visualizador-productos/merge -> 401 en 0.035 s
 *     /api/marketing/analyze-data       -> 401 en 0.042 s
 *     /api/marketing/calculate-acos     -> 401 en 0.030 s
 *     /api/marketing/dual-process       -> 401 en 0.038 s
 *     /api/marketing/generate-excel     -> 401
 *     /api/auditor/upload               -> 401 en 0.034 s
 *
 * Está escrito así de explícito a propósito. Este comentario decía «que
 * cualquiera de Internet, SIN sesión, tumbe el contenedor», y eso ya lo impide
 * la guarda de sesión, no esto. Un endurecimiento cuyo motivo escrito no
 * corresponde con lo que hace es el que alguien borra dentro de seis meses por
 * parecerle de más.
 *
 * LO ÚNICO QUE HOY SIGUE LLEGANDO SIN SESIÓN son los dos webhooks de leads y
 * /api/tracker/ingest. Ahí no vale mirar la cabecera: ver
 * `leerCuerpoConTope()` más abajo, que es lo que sí corta de verdad.
 *
 * LO QUE COLABA ANTES (medido contra este mismo servidor, sin cookie ni
 * cabecera de ningún tipo, cuando estas rutas tampoco pedían sesión):
 *
 *     $ curl -F "xray_file=@grande.csv" http://SERVIDOR/api/validator/calculate
 *     HTTP 400  subido=60000219 bytes  en 0.377s
 *
 *   - El cuerpo entero (60 MB) SE SUBE Y SE BUFFERIZA. El 400 que contesta es
 *     su propia validación ("Faltan archivos CSV requeridos"), que llega
 *     demasiado tarde: `await request.formData()` ya se ha comido el cuerpo.
 *   - CUATRO subidas simultáneas de 60 MB dejaron el proceso next-server en
 *     894.896 KB de RSS (874 MB), arrancando de ~90 MB. En un contenedor de
 *     Easypanel de 1-2 GB eso es un OOM-kill.
 *   - Alcanzable por cualquiera: middleware.ts mete `/api/` entero en
 *     publicRoutes y estas rutas no comprueban sesión por dentro.
 *
 * POR QUÉ NO ROMPE NINGUNA SUBIDA REAL: el tope no está puesto a ojo. El
 * fichero más grande que se sube de verdad en este repo son 365 KB
 * (uploads/taxreport.csv); el mayor .xlsx de Amazon Ads son 132 KB
 * (excels/bulk-a1sttj23j6rnwo-...xlsx) y el mayor de tarifas 107 KB
 * (uploads/TARIFA URIAGE 2026.xlsx). El tope de 25 MB deja 68 veces de margen
 * sobre el mayor de todos, y es EXACTAMENTE el mismo número que ya usa
 * app/api/plataforma/costes/importar/route.ts:33 para este mismo tipo de datos
 * (hojas de cálculo y CSV de catálogo). lib/stock-sync/proceso.ts:61 usa 20 MB.
 *
 * Si algún día un cliente sube un bulk de Amazon Ads más gordo, esto es UNA
 * constante en UN sitio.
 */
export const MAX_BYTES_FICHERO = 25 * 1024 * 1024

/**
 * Tope del CUERPO ENTERO de la petición, sumando todos los ficheros.
 *
 * Es un tope ÚNICO a propósito, no "25 MB por cada fichero que acepte la ruta".
 * Multiplicarlo por el número de ficheros dejaba a las rutas de 3 ficheros
 * (commissions/process, visualizador-productos/merge) con 76 MB de margen, y
 * MEDIDO: con ese margen una sola petición de 60 MB seguía entrando y el tope
 * no servía de nada. Con las subidas de verdad sobra igual: los tres ficheros
 * juntos del visualizador suman ~250 KB (Keepa 39 KB + filtrado 102 KB +
 * tarifa 107 KB), así que 26 MB son más de 100 veces el uso real.
 */
export const MAX_BYTES_PETICION = MAX_BYTES_FICHERO + 1024 * 1024

/**
 * Tope para los cuerpos que NO llevan ficheros: los webhooks de leads.
 *
 * Es mucho más bajo que el de las subidas porque lo que entra por ahí es un
 * formulario de contacto de la web —nombre, email, teléfono, empresa, mensaje e
 * ingresos—, del orden de un kilobyte. Un megabyte es mil veces el uso real y
 * sigue cortando el cuerpo de cientos de MB que se come la memoria del
 * contenedor.
 */
export const MAX_BYTES_WEBHOOK = 1024 * 1024

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}

/**
 * Comprueba el tamaño ANTES de `await request.formData()`.
 *
 * Es el orden lo que importa: formData() bufferiza el cuerpo entero en memoria
 * antes de que la ruta pueda mirar nada, así que una comprobación posterior no
 * evita el pico de RSS. Aquí se mira la cabecera Content-Length, que es lo
 * único que se conoce sin haber leído el cuerpo.
 *
 * Devuelve una respuesta 413 si se pasa, o null si puede seguir.
 *
 * El segundo parámetro es opcional y solo lo usan los webhooks de leads, que no
 * reciben ficheros y por eso van con un tope mucho más bajo
 * (MAX_BYTES_WEBHOOK). Sin pasarlo se comporta exactamente igual que antes.
 *
 * LO QUE ESTO NO PUEDE HACER, Y HAY QUE SABERLO
 * ---------------------------------------------
 * Un cuerpo con `Transfer-Encoding: chunked` NO trae Content-Length, y aquí
 * `if (!cabecera) return null` lo deja pasar. Reproducido contra el servidor
 * compilado local, sin cookie:
 *
 *     curl -H 'Transfer-Encoding: chunked' -H 'Content-Length:' \
 *          --data-binary @60MB  /api/webhooks/leads
 *     -> HTTP 400 en 0.157 s, subidos 62.922.768 bytes
 *        RSS de next-server: 203.440 kB antes -> 490.736 kB después
 *        Con cuatro a la vez: 417.392 kB -> 869.328 kB
 *
 * O sea que mirando solo la cabecera, el 413 únicamente frena al atacante que
 * se moleste en mandarla. Por eso las rutas SIN sesión no se conforman con
 * esto: usan `leerCuerpoConTope()`, que lee el flujo a trozos y corta de
 * verdad. Esta función se queda porque es gratis, corta antes de tocar el
 * cuerpo y cubre el caso normal.
 *
 * Y ojo, que la medición de arriba engaña: el RSS también sube en una ruta que
 * contesta 401 sin leer el cuerpo. Los bytes los acumula Node por debajo de la
 * aplicación. Está explicado entero en `leerCuerpoConTope()`.
 */
export function comprobarTamañoPeticion(
  request: Request,
  maximo: number = MAX_BYTES_PETICION
): NextResponse | null {
  const cabecera = request.headers.get('content-length')
  if (!cabecera) return null

  const bytes = Number(cabecera)
  if (!Number.isFinite(bytes) || bytes <= maximo) return null

  return NextResponse.json(
    {
      error: `La petición ocupa ${mb(bytes)} MB y el máximo son ${mb(maximo)} MB`,
    },
    { status: 413 }
  )
}

/**
 * LEE EL CUERPO A TROZOS Y ABORTA EN CUANTO SE PASA.
 *
 * QUÉ IMPIDE, EXACTAMENTE
 * -----------------------
 * Que un cuerpo enorme SIN Content-Length lo procese la ruta. Es el único
 * caso que `comprobarTamañoPeticion()` no puede ver —con
 * `Transfer-Encoding: chunked` esa cabecera no existe— y hasta ahora
 * `request.json()` se comía el cuerpo entero y seguía adelante. MEDIDO contra
 * el servidor compilado local (nunca producción), sin una sola cookie:
 *
 *     curl -H 'Transfer-Encoding: chunked' --data-binary @2MB /api/webhooks/leads
 *       -> HTTP 413 {"error":"La petición ocupa más de 1.0 MB…"} en 0,007 s
 *     curl -H 'Transfer-Encoding: chunked' --data-binary @40MB /api/tracker/ingest
 *       -> HTTP 413 {"error":"El cuerpo pasa de 32 MB…"}          en 0,057 s
 *
 * Antes de esto, esas dos peticiones entraban enteras y se parseaban.
 *
 * QUÉ **NO** IMPIDE, Y HAY QUE SABERLO PORQUE ES LO CONTRARIO DE LO INTUITIVO
 * --------------------------------------------------------------------------
 * NO evita el pico de memoria del proceso. Comprobado con un control: cuatro
 * peticiones troceadas de 40 MB contra `/api/validator/calculate`, que contesta
 * 401 al instante y NO LEE EL CUERPO EN NINGÚN MOMENTO, subieron el RSS de
 * next-server de 197.168 kB a 506.752 kB igual. O sea que los bytes los
 * acumula Node por debajo de la aplicación, según entran por el socket, y
 * ninguna comprobación escrita en una ruta puede evitarlo: cuando el código de
 * la ruta puede mirar algo, la memoria ya está pedida.
 *
 * EL FRENO DE VERDAD PARA ESO ESTÁ EN EL PROXY DE DELANTE (client_max_body_size
 * de nginx, o su equivalente en Traefik/Easypanel), que sí ve el flujo troceado
 * y corta la conexión antes de que los bytes lleguen al contenedor. Eso es
 * configuración de infraestructura y NO se puede hacer desde este repositorio.
 * Está anotado en el informe.
 *
 * Aun así esto se queda, porque lo que sí hace es real: la petición se rechaza
 * en milisegundos con un 413 en vez de parsearse, insertarse o mandarse a un
 * modelo, y lo que la ruta llega a construir en memoria queda acotado al tope.
 *
 * POR QUÉ NO CAMBIA NADA PARA QUIEN LO USA: devuelve el mismo texto que habría
 * devuelto `request.text()`, así que el `JSON.parse` de después ve exactamente
 * lo mismo. Comprobado en vivo que los tres caminos de los webhooks contestan
 * igual que antes (JSON con Content-Length, JSON troceado y urlencoded: los
 * tres devuelven el mismo 400 de «faltan nombre y email»). Un cuerpo legítimo
 * —un formulario de contacto de ~1 kB, o el informe diario de la extensión—
 * nunca se acerca al tope.
 *
 * Devuelve el texto, o una respuesta 413 si el cuerpo se pasa.
 */
export async function leerCuerpoConTope(
  request: Request,
  maximo: number
): Promise<{ texto: string } | NextResponse> {
  const flujo = request.body
  // Sin cuerpo no hay nada que contar. Devolver '' deja que el parseo de la
  // ruta falle igual que fallaba antes con `request.json()` sobre un cuerpo
  // vacío, que es el comportamiento que había.
  if (!flujo) return { texto: '' }

  const lector = flujo.getReader()
  const trozos: Uint8Array[] = []
  let bytes = 0

  try {
    for (;;) {
      const { done, value } = await lector.read()
      if (done) break
      if (!value) continue
      bytes += value.byteLength
      if (bytes > maximo) {
        // Se suelta el flujo sin terminar de leerlo: eso corta la subida en vez
        // de esperar a que el atacante acabe de mandar sus 200 MB.
        await lector.cancel().catch(() => {})
        return NextResponse.json(
          {
            error: `La petición ocupa más de ${mb(maximo)} MB, que es el máximo`,
          },
          { status: 413 }
        )
      }
      trozos.push(value)
    }
  } finally {
    lector.releaseLock()
  }

  const todo = new Uint8Array(bytes)
  let pos = 0
  for (const trozo of trozos) {
    todo.set(trozo, pos)
    pos += trozo.byteLength
  }

  return { texto: new TextDecoder().decode(todo) }
}

/**
 * Segunda comprobación, ya con el fichero en la mano.
 *
 * Hace falta además de la anterior porque un cuerpo con
 * `Transfer-Encoding: chunked` no lleva Content-Length y se salta el primer
 * filtro. Mismo patrón que app/api/plataforma/costes/importar/route.ts:52.
 *
 * Devuelve una respuesta 413 si se pasa, o null si puede seguir.
 */
export function comprobarTamañoFichero(
  fichero: { size: number } | null | undefined,
  etiqueta: string
): NextResponse | null {
  if (!fichero || fichero.size <= MAX_BYTES_FICHERO) return null

  return NextResponse.json(
    {
      error: `${etiqueta} ocupa ${mb(fichero.size)} MB y el máximo son ${mb(MAX_BYTES_FICHERO)} MB`,
    },
    { status: 413 }
  )
}
