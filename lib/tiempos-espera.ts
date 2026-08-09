/**
 * TOPES DE TIEMPO PARA LAS PETICIONES QUE SALEN DEL ERP.
 *
 * QUÉ IMPIDE: que una llamada a un servicio de fuera (Amazon, Wise, Google) se
 * quede colgada ocupando un trabajador del servidor durante cinco minutos por
 * intento. Con reintentos encima, una sola operación de la SP-API se comía unos
 * 20 minutos. Bastaba con que el otro extremo aceptara la conexión TCP y no
 * contestara nunca: ni siquiera hace falta que se caiga.
 *
 * LO QUE COLABA ANTES (medido con un servidor TCP que acepta y no responde,
 * en el Node v20.10.0 de este proyecto):
 *
 *     SIN signal, tras 30016 ms -> SIGUE COLGADO
 *     CON AbortSignal.timeout(3000), tras 3008 ms -> TimeoutError
 *
 * El único tope que existía era el `headersTimeout` de undici, 300 s por
 * defecto, y solo cubre las CABECERAS: una respuesta que empieza a llegar y
 * luego gotea no la corta nadie. La excepción buena del repo era el SFTP, que
 * ya tenía su propio reloj en lib/stock-sync/origenes/sftp.ts:96.
 *
 * POR QUÉ NO CORTA NADA QUE HOY FUNCIONE: todos los valores están MUY por
 * encima de lo que tardan estas llamadas cuando van bien (una respuesta de la
 * SP-API o de Wise son segundos) y por debajo de los ~300 s que era el techo
 * real. Solo se rinden antes las llamadas que ya iban a fallar.
 */

/**
 * Llamadas de control que devuelven un JSON pequeño: canje de token, perfiles y
 * saldos de Wise, metadatos de Gmail. Cuando van bien tardan segundos.
 */
export const ESPERA_JSON_MS = 60_000

/**
 * Operaciones de la SP-API de Amazon. Mismo tipo de respuesta pero contra un
 * servicio con más cola y con reintentos por encima, así que va más holgado.
 */
export const ESPERA_SP_API_MS = 120_000

/**
 * Descargas de fichero: informes de Amazon (el tope de bytes son 100 MB, ver
 * lib/plataforma/amazon/informes.ts) y adjuntos de Drive/Gmail (20 MB, ver
 * lib/stock-sync/proceso.ts).
 *
 * Va aparte y muy holgado A PROPÓSITO: `AbortSignal.timeout` mide la petición
 * ENTERA, cuerpo incluido, no la inactividad. Un valor corto aquí cortaría una
 * descarga grande que está avanzando bien, y eso sí sería un cambio de
 * comportamiento. 240 s para 100 MB son 420 kB/s, muy por debajo de lo que da
 * el VPS.
 */
export const ESPERA_DESCARGA_MS = 240_000
