/**
 * EL REGISTRO DE LOS PROCESOS AUTOMÁTICOS.
 *
 * Envuelve lo que hace cada ruta de cron y deja una fila en `cron_ejecuciones`
 * (migración 137) con cuándo arrancó, cuánto tardó y cómo acabó.
 *
 *
 * POR QUÉ EXISTE ESTO
 * -------------------
 * Los tres crones llevaban desde el primer día pidiendo a `localhost:3000`
 * cuando el servidor escucha en el 80, y contestaban HTTP 000 en cada pasada. El
 * catálogo se quedó en «refrescado hace 17 horas», los trabajos de plataforma
 * acumularon 0 pasadas y la agenda solo se sincronizaba a mano.
 *
 * Nada de eso dio un error en ninguna pantalla. Se descubrió mirando los
 * registros del contenedor de casualidad.
 *
 *
 * SE REGISTRA AUNQUE FALLE, Y ESO ES EL PUNTO
 * -------------------------------------------
 * La fila se abre ANTES de trabajar y se cierra en un `finally`. Si la tarea
 * revienta, queda con `ok = false` y su error. Si el proceso se muere a medias
 * —el contenedor se reinicia, se acaba el tiempo— la fila se queda con `ok` a
 * NULL, y eso también dice algo: arrancó y no llegó al final.
 *
 * Lo único que NO deja rastro es que la ruta no llegue a ejecutarse. Y ahí la
 * ausencia es la señal: la pantalla enseña cuánto hace de la última pasada, así
 * que un cron muerto se ve como un hueco que crece.
 *
 *
 * EL REGISTRO NO PUEDE TUMBAR EL CRON
 * -----------------------------------
 * Todo lo de aquí va en try/catch propio. Si la tabla no existe todavía —las
 * migraciones se lanzan a mano y el código puede llegar antes— o Supabase no
 * contesta, se sigue trabajando igual. Un sistema de observación que rompe lo
 * que observa es peor que no tenerlo.
 */

import { createServiceClient } from '@/lib/supabase/service'

/** Los procesos que corren solos. El id es el que se guarda en la tabla */
export const TAREAS_CRON = [
  {
    id: 'amazon-sync',
    nombre: 'Catálogo de Amazon',
    ruta: '/api/amazon/cron-sync',
    cadaMinutos: 15,
    que:
      'Relee el catálogo de cada cuenta conectada —precios, stock y estado de los listings— y ' +
      'después ejecuta el ciclo de sincronismo de stock. Las dos cosas van en la misma pasada.',
  },
  {
    id: 'amazon-jobs',
    nombre: 'Trabajos de plataforma',
    ruta: '/api/amazon/cron-jobs',
    cadaMinutos: 5,
    que: 'Coge el siguiente trabajo de la cola —censo, atributos, BSR, inventario— y avanza un tramo.',
  },
  {
    /**
     * CADA SEIS HORAS, Y EL NÚMERO SALE DE UNA MEDIDA.
     *
     * España tiene precios dinámicos: un repricer la mueve sola. Medido sobre el
     * catálogo real, unas nueve referencias españolas cambian cada once horas, y
     * como España es la base de la regla, cada una arrastra hasta tres filas.
     *
     * Seis horas es el reparto entre dos costes: más a menudo es gastar cupo de
     * Amazon para no encontrar casi nada, y más espaciado es dejar a Francia,
     * Italia y Alemania colgando de un precio español que ya no existe durante
     * media jornada de ventas.
     *
     * Se cambia desde la pantalla de Sistema, no aquí.
     */
    id: 'shoplamp-precios',
    nombre: 'Precios de Shoplamp',
    ruta: '/api/precios-shoplamp/cron',
    cadaMinutos: 360,
    que:
      'Vuelve a aplicar la regla de España a Francia, Italia y Alemania y publica lo que haya ' +
      'cambiado. No limita cuánto sube o baja cada precio —eso es la regla del cliente—, solo se ' +
      'planta si de golpe cambian más de 400 referencias, que sería señal de que algo se ha roto.',
  },
  {
    /**
     * CADA 15 MINUTOS, Y SE PUEDE BAJAR A 10 DESDE SISTEMA.
     *
     * Lee en directo el stock de todos los listings de ShoesF (~14.000, unas 700
     * llamadas a Amazon: dos o tres minutos de cada cuarto de hora) y apunta
     * cuántos tienen y cuántos no. A 10 minutos son cuatro de cada diez con la
     * cola de lecturas ocupada, así que conviene mirar cómo va antes de bajarlo.
     */
    id: 'auditor-stock',
    nombre: 'Auditor de stock',
    ruta: '/api/auditor-stock/cron',
    cadaMinutos: 15,
    que:
      'Lee en directo el stock de todos los listings de ShoesF y guarda cuántos tienen y cuántos ' +
      'no, con el SKU, el ASIN y la cantidad de los que sí. No escribe nada en Amazon.',
  },
  {
    /**
     * NO TIENE RELOJ AQUÍ, Y ES A PROPÓSITO.
     *
     * `cadaMinutos: 1` porque la ruta corre cada minuto y no consulta
     * `tocaAhora()`: el intervalo de verdad —cada cuántas horas se recalcula y
     * se publica— vive en `publicar_cada_minutos` de la configuración del
     * motor de precios, que es donde se toca desde la pantalla.
     *
     * Correr cada minuto es lo que garantiza que no se quede ningún precio sin
     * mandar. Cuando una pasada deja pendientes no sella `publicado_at`, y la
     * del minuto siguiente los retoma. Estando dentro de amazon-sync —a quince
     * minutos— cada resto esperaba un cuarto de hora, y con 966 precios que
     * cambian eso era media hora para algo que cabe en una pasada.
     */
    id: 'entrais-precios',
    nombre: 'Precios de Entrais',
    ruta: '/api/entrais/cron-precios',
    cadaMinutos: 1,
    que:
      'Recalcula el precio de todo el catálogo con las reglas del motor y manda a Amazon los que ' +
      'han cambiado. La cadencia se ajusta en el motor de precios, no aquí.',
  },
  {
    /**
     * VA APARTE DEL CICLO DE CATÁLOGO, Y ES EL MOTIVO DE QUE EXISTA.
     *
     * El stock FBA se leía dentro de `amazon-sync`, y solo si el tramo de
     * catálogo que tocaba en esa pasada contenía alguna referencia de FBA. Con
     * ShoesF —42.737 listings, de los que 1.756 son FBA, un 4 %— eso significa
     * que la lectura depende de por dónde vaya el barrido: puede tardar horas en
     * caer en un tramo con FBA, y mientras tanto el panel de remesas no tiene
     * con qué cuadrar.
     *
     * Aquí se pide el inventario de FBA DIRECTAMENTE, que devuelve solo lo que
     * está en los almacenes de Amazon sin recorrer el catálogo entero. Para
     * ShoesF son 1.756 referencias en vez de 42.737.
     *
     * Una vez al día y de madrugada porque el libro mayor es histórico, no stock
     * vivo: pedirlo más a menudo no trae nada nuevo y cada pasada gasta una ficha
     * de createReport, que se repone una vez por minuto.
     */
    id: 'fba-remesas',
    nombre: 'Remesas a FBA',
    ruta: '/api/fba/cron-remesas',
    cadaMinutos: 1440,
    que:
      'Trae el libro mayor de inventario de cada cuenta con remesas —entradas, ventas, ' +
      'devoluciones y mermas— y refresca el stock que Amazon tiene en sus almacenes. Es lo que ' +
      'descuenta las remesas y lo que permite cuadrarlas.',
  },
  {
    id: 'fba-seguimiento',
    nombre: 'Seguimiento de envíos a FBA',
    ruta: '/api/fba/cron-seguimiento',
    cadaMinutos: 60,
    que:
      'Mira cada hora los envíos a FBA que siguen vivos: en qué estado están y cuántas unidades ' +
      'ha recibido Amazon. Apunta en el historial del envío cada vez que algo cambia. No escribe ' +
      'nada en Amazon.',
  },
  {
    id: 'stock-verificacion',
    nombre: 'Verificación del stock subido',
    ruta: '/api/stock-sync/cron-verificacion',
    cadaMinutos: 5,
    que:
      'Media hora después de subir el stock de un cliente con verificación (Lenobotics, Shoplamp), ' +
      'vuelve a leer en Amazon lo que ha quedado de cada SKU enviado, lo compara con lo que se mandó ' +
      'descontando las ventas, guarda el informe y avisa a Slack. No corrige nada: solo lee.',
  },
  {
    /**
     * CADA HORA, Y CADA PASADA REVISA SOLO UNA PARTE.
     *
     * Amazon solo deja leer las incidencias de veinte listings por llamada y comparte
     * el cupo con el catálogo y con el auditor. Una cuenta como ShoesF (43.800
     * listings en cuatro países) no se revisa entera cada hora: cada pasada coge los
     * más urgentes —con stock y sin revisar, o con problemas abiertos— y deja el resto
     * para la siguiente. El reparto vive en lib/cumplimiento/pendientes.ts.
     */
    id: 'cumplimiento',
    nombre: 'Cumplimiento de listings',
    ruta: '/api/cumplimiento/cron',
    cadaMinutos: 60,
    que:
      'Lee en Amazon las incidencias de los listings de cada cuenta —atributos que faltan, ' +
      'seguridad de producto, mercancías peligrosas, productos ocultos— empezando por los que ' +
      'tienen stock, y las guarda por cliente. No escribe nada en Amazon.',
  },
  {
    /**
     * CADA COMERCIAL TIENE SU CUENTA DE RINKEL, Y CADA UNA SE LEE POR SEPARADO.
     *
     * Cada persona vincula su clave de la API en su panel «Mi rendimiento» y esta tarea lee las llamadas nuevas
     * de TODAS las cuentas vinculadas, una detrás de otra, con un presupuesto de tiempo: la que no cabe en esta
     * pasada se retoma en la siguiente, empezando por la que lleva más tiempo sin leerse. Lo reciente cuesta una
     * o dos peticiones por cuenta; el histórico de una cuenta recién vinculada lo va completando por tramos
     * (lib/rendimiento/sincronizar.ts).
     *
     * Cada MINUTO (eran diez hasta el 23 oct 2026 y dos hasta el 28 oct, que Raúl pidió que lo que se habla llegue al ERP lo antes
     * posible): la lista de llamadas del día es lo que mira un supervisor para saber cómo va el equipo, y la transcripción
     * (`rinkel-transcribir`) necesita que la llamada ya esté aquí para empezar a los 45 s de colgar. Cuesta una o dos peticiones por cuenta
     * y unos 6 s por pasada con las cinco cuentas (medido: 0 fallos en 400 pasadas; Rinkel no publica límites y, si se pasara, contesta
     * 429 y la pasada sale en rojo en Sistema). Mientras alguien tiene Cold Calling abierto, su propia pantalla lee su cuenta cada 30 s
     * (components/cold-calling/useSincronizarRinkel.ts) y la llamada llega en unos 20 s. Se cambia desde Sistema sin tocar código.
     */
    id: 'rinkel-llamadas',
    nombre: 'Llamadas de Rinkel',
    ruta: '/api/rendimiento/cron',
    cadaMinutos: 1,
    que:
      'Lee de Rinkel las llamadas nuevas de cada comercial que ha vinculado su clave, con la grabación de ' +
      'las que la tienen, para el panel «Mi rendimiento». No escribe nada en Rinkel.',
  },
  {
    /**
     * DOS VECES POR MINUTO, Y ES EL INTERRUPTOR DEL GASTO.
     *
     * Pasa a texto las llamadas contestadas de Rinkel que ya tienen grabación y están enlazadas con un lead, y deja en la ficha del lead
     * el resumen, la línea de la conversación y el siguiente paso (lib/transcripcion/motor.ts). El gasto es casi todo el audio: unos
     * 0,0045 $ por minuto con `gpt-transcribe`, y con las 35–50 llamadas al día de hoy son unos 4–5 $ al mes. Apagar este proceso desde
     * Sistema detiene el gasto en el acto; el tope de minutos al día de la fila de ajustes (migración 244) lo vigila además por dentro.
     *
     * Empieza a los 45 s de colgar (ajuste `espera_tras_colgar_s`, migración 259; eran 90) y el script de crond (scripts/rinkel-transcribir.sh) la ofrece
     * cada 30 s: crond no baja de un minuto, así que el script llama dos veces por minuto y aquí «1 minuto» significa «cada 30 s». Antes pasaba cada dos
     * minutos y la espera de turno era de 53 s de mediana; con esto es de ~15 s: el resumen sale a ~1 min 15 s de colgar en vez de 2 min 38 s. Si en
     * Sistema se pone más de un minuto, el reloj de `tocaAhora` se queda con los avisos que le tocan (los minutos se redondean al medio minuto).
     * Una pasada vacía cuesta ~1 s y 4 consultas pequeñas; el gasto de IA no cambia: cada llamada se transcribe una vez.
     */
    id: 'rinkel-transcribir',
    nombre: 'Transcripción de llamadas',
    ruta: '/api/rendimiento/transcribir',
    cadaMinutos: 1,
    que:
      'Pasa a texto con IA las llamadas contestadas de Rinkel que tienen grabación y lead, y deja en la ficha el resumen, la ' +
      'línea de la conversación, el siguiente paso y quién habla en la transcripción entera. Empieza a los 45 s de colgar y mira ' +
      'cada 30 s. Cada llamada se transcribe una sola vez (unos 0,005 $ por minuto de audio). Apagarlo aquí detiene el gasto. ' +
      'Solo lee de Rinkel.',
  },
  {
    /**
     * CADA COMERCIAL TIENE SU BUZÓN, Y CADA UNO SE LEE POR SEPARADO.
     *
     * Cada persona conecta su buzón de Hostinger en «Correo» y esta tarea trae los mensajes nuevos de TODOS los
     * buzones conectados (Entrada y Enviados), uno detrás de otro y con un presupuesto de tiempo: el que no cabe en
     * esta pasada se retoma en la siguiente, empezando por el que lleva más tiempo sin leerse. Un buzón al que el
     * servidor rechaza la contraseña se deja de intentar hasta que su dueño la vuelva a escribir (seguir probando
     * acaba bloqueando la cuenta en el proveedor), y uno que falla por otra causa espera cada vez más entre intentos.
     *
     * Cada minuto porque es el correo de gente que habla con clientes (antes, cada tres: un correo tardaba hasta ese tiempo en llegar a
     * quien no tenía la pantalla abierta). Una pasada con 9 buzones dura ~12 s y mientras la anterior siga en marcha la siguiente no empieza.
     * Además, mientras alguien tiene Correo abierto, la propia pantalla pide una lectura al buzón que mira cada 30 s.
     */
    id: 'correo-sync',
    nombre: 'Correo de los comerciales',
    ruta: '/api/correo/cron',
    cadaMinutos: 1,
    que:
      'Trae a Correo los mensajes nuevos de cada buzón conectado, de Entrada y de Enviados, y recoge lo que se ' +
      'haya leído en el webmail. Solo lee: no envía, no borra ni marca nada en el servidor de correo.',
  },
  {
    /**
     * CADA MINUTO, Y EL INTERRUPTOR REAL ESTÁ EN CORREO → SECUENCIAS → AJUSTES.
     *
     * Es el motor de los seguimientos automáticos de correo (lib/correo/secuencias/motor.ts): vigila si algún lead ha contestado, reparte las horas,
     * y manda los seguimientos que ya llegan a su hora, repartidos entre todos los buzones de 9 a 18 (hora de Madrid) de lunes a viernes. NACE
     * APAGADO Y EN ENSAYO: aunque este proceso corra cada minuto, mientras el interruptor de las secuencias esté apagado cada pasada contesta «apagado»
     * y no toca nada. Apagarlo AQUÍ lo detiene del todo (ni vigila ni envía), pero lo normal es pararlo desde la pantalla de Secuencias.
     *
     * Cada minuto porque los envíos se reparten al segundo (nunca dos a la vez) y una respuesta del lead tiene que cortar la secuencia en cuanto entra.
     */
    id: 'correo-secuencias',
    nombre: 'Seguimientos de correo',
    ruta: '/api/correo/secuencias/cron',
    cadaMinutos: 1,
    que:
      'Manda los seguimientos automáticos de correo a su hora, desde el buzón de cada comercial y en el mismo hilo, entre las 9:00 y las 18:00 ' +
      '(hora de Madrid, de lunes a viernes). Antes de cada envío lee el buzón y la ficha del lead: si ha contestado, ha rebotado o se ha hablado con él, ' +
      'no sale. Con el interruptor de Correo → Secuencias apagado (o en ensayo) no envía nada.',
  },
  {
    /**
     * CADA TRES MINUTOS, Y NACE SIN PERMISOS: HASTA QUE SE AUTORICEN EN GOOGLE WORKSPACE NO HACE NADA (Y LO DICE).
     *
     * Lee de Gmail los correos de Gemini (las notas de las reuniones de Meet), abre el documento «Notas de Gemini» de las reuniones con clientes, las casa con su ficha del CRM
     * y pasa por la IA las que ya tienen cliente (lib/crm/gemini/). Hace falta autorizar `gmail.readonly` y `documents.readonly` a la cuenta de servicio de Google en la
     * delegación en todo el dominio, y activar las APIs de Gmail y de Docs en Google Cloud; mientras no estén, cada pasada sale en rojo con la frase de qué falta.
     *
     * El gasto es la IA: unos 0,08 $ por reunión con cliente (gpt-5.6-terra), y solo las reuniones con clientes: las internas del equipo no se abren ni se analizan. Apagar
     * este proceso desde Sistema lo detiene todo (ni lee ni gasta). Cada tres minutos porque una nota llega a los pocos minutos de acabar la reunión.
     */
    id: 'notas-gemini',
    nombre: 'Notas de reunión (Gemini)',
    ruta: '/api/crm/notas-gemini/cron',
    cadaMinutos: 3,
    que:
      'Lee de Gmail las notas que Gemini deja de cada reunión, abre el documento de las reuniones con clientes, las enlaza con su ficha del CRM y las analiza con IA ' +
      '(resumen, dolores, objeciones, respuestas del guion y propuesta sugerida). Las reuniones internas del equipo se ignoran: solo se apunta su título. Solo lee de Google.',
  },
  {
    id: 'calendario',
    nombre: 'Agenda con Google',
    ruta: '/api/appointments/cron-sync',
    /**
     * Cada minuto (eran 3). Una pasada dura ~1 s y solo pregunta a Google por lo que cambió desde la anterior, así que más seguido casi no cuesta nada; y ahora que la
     * agenda no deja agendar encima de un hueco de Google, que un hueco nuevo tarde minutos en llegar es dejar una puerta abierta a agendar encima. La ruta no deja que se
     * solapen dos pasadas (lib/correo/cron-solape.ts). OJO: este valor es el de por defecto; si en `cron_config` hay una fila de `calendario`, manda la de la tabla.
     */
    cadaMinutos: 1,
    que: 'Trae al ERP las citas creadas, movidas o canceladas directamente en Google Calendar.',
  },
] as const

export type TareaCron = (typeof TAREAS_CRON)[number]['id']

export interface ConfigCron {
  tarea: string
  cada_minutos: number
  activo: boolean
  /** true cuando sale del código y no de la tabla: la 138 no está lanzada */
  pordefecto?: boolean
}

/**
 * MARGEN AL COMPARAR EL INTERVALO.
 *
 * Sin él, un proceso «cada 15 minutos» acaba corriendo cada 16. El cron entra en
 * el segundo 0 de cada minuto, pero la pasada anterior arrancó en un segundo
 * cualquiera —pongamos las 10:00:05—: a las 10:15:00 han pasado 14 min 55 s, no
 * llega a 15, se salta, y le toca a las 10:16. Y como cada pasada empieza más
 * tarde que la anterior, el retraso se acumula solo.
 *
 * Con 59 segundos de margen se dispara en el primer minuto en que puede, que es
 * lo que uno espera al escribir «cada 15 minutos».
 */
const MARGEN_MS = 59_000

/**
 * Vive aquí y no en la ruta porque Next NO deja exportar constantes sueltas de
 * un fichero de ruta: solo los métodos HTTP y sus opciones. Compila igual y
 * revienta en `next build` con «is not a valid Route export field».
 */
export const FALTA_MIGRACION_CRON =
  'Falta la tabla del registro de procesos: lanza 137_cron_ejecuciones.sql en el editor SQL de Supabase.'

export function tareaCron(id: string) {
  return TAREAS_CRON.find((t) => t.id === id) ?? null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Quién ha lanzado esta pasada. null = el cron.
 *
 * Lo pone /api/sistema/cron cuando alguien pulsa «Lanzar ahora», y viaja por
 * cabecera porque el botón no llama a la función: llama a la MISMA ruta que
 * llama el cron, a propósito, para probar el camino y no solo el código.
 *
 * Se valida la forma antes de devolverlo: la columna es una clave foránea a
 * auth.users y un texto cualquiera haría fallar la escritura del registro. Como
 * `abrir()` se traga sus errores, ese fallo no se vería en ningún sitio — la
 * pasada quedaría sin registrar y parecería que el proceso no ha corrido.
 */
export function lanzadoPorDe(headers: Headers): string | null {
  const valor = headers.get('x-lanzado-por')
  return valor && UUID.test(valor) ? valor : null
}

/**
 * A partir de cuánto se considera que un proceso está parado.
 *
 * TRES veces su cadencia, no una: una pasada puede tardar, el contenedor puede
 * estar reiniciándose, y avisar al primer minuto de retraso convierte esto en el
 * aviso que salta siempre y que nadie lee. Con tres vueltas, un hueco ya no es
 * mala suerte.
 */
export function estaParada(cadaMinutos: number, ultima: string | null): boolean {
  if (!ultima) return true
  const minutos = (Date.now() - new Date(ultima).getTime()) / 60_000
  return minutos > cadaMinutos * 3
}

/* ------------------------------------------------------------------ */
/* El horario                                                          */
/* ------------------------------------------------------------------ */

/**
 * Cada cuánto corre cada proceso.
 *
 * SI LA TABLA NO ESTÁ, SE DEVUELVEN LOS VALORES DEL CÓDIGO. Las migraciones de
 * este ERP se lanzan a mano en el editor de Supabase, así que el código puede
 * estar desplegado antes que la 138 — y de las tres cosas que podía hacer esta
 * función en ese hueco (fallar, no ejecutar nada, o seguir con los intervalos de
 * siempre) solo la última deja el sistema como estaba.
 */
export async function leerConfigCron(): Promise<ConfigCron[]> {
  const pordefecto: ConfigCron[] = TAREAS_CRON.map((t) => ({
    tarea: t.id,
    cada_minutos: t.cadaMinutos,
    activo: true,
    pordefecto: true,
  }))

  try {
    const service = createServiceClient()
    const { data, error } = await service
      .from('cron_config')
      .select('tarea, cada_minutos, activo')
    if (error) throw error

    const guardado = new Map((data ?? []).map((f) => [f.tarea as string, f as ConfigCron]))
    // Se recorre TAREAS_CRON y no la tabla: un proceso nuevo en el código tiene
    // que aparecer con su valor por defecto sin necesidad de otra migración, y
    // una fila huérfana de un proceso que ya no existe no debe salir en la
    // pantalla como si algo estuviera corriendo.
    return pordefecto.map((d) => {
      const fila = guardado.get(d.tarea)
      return fila ? { ...fila, pordefecto: false } : d
    })
  } catch {
    return pordefecto
  }
}

export interface Veredicto {
  toca: boolean
  /** Para el registro del contenedor. Vacío cuando toca */
  motivo?: string
}

/**
 * ¿LE TOCA CORRER A ESTE PROCESO?
 *
 * La llaman las tres rutas de cron nada más entrar. El crontab del contenedor
 * las despierta CADA MINUTO y es aquí donde se decide, porque así el intervalo
 * es un dato de la base y no una línea del Dockerfile que hay que redesplegar
 * para cambiar.
 *
 *
 * MIRA LA ÚLTIMA PASADA AUTOMÁTICA, NO LA ÚLTIMA DE TODAS
 * -------------------------------------------------------
 * Si contara también las lanzadas a mano, pulsar «Lanzar ahora» para comprobar
 * algo retrasaría el automatismo un intervalo entero. Peor: en un proceso que
 * uno anda depurando a botonazos, el cron podría no volver a entrar en toda la
 * tarde y no se notaría, porque las pasadas manuales llenarían el hueco. Es la
 * misma trampa que ya nos costó meses con la agenda.
 *
 *
 * ESTO TAMBIÉN IMPIDE QUE SE SOLAPEN
 * ----------------------------------
 * `conRegistro` abre la fila ANTES de trabajar, así que una pasada en curso ya
 * cuenta como «última». Un refresco de catálogo que tarde trece minutos no va a
 * ver arrancar otro encima en el minuto siguiente.
 *
 *
 * ANTE LA DUDA, SE EJECUTA
 * ------------------------
 * Si la consulta falla o la migración no está, devuelve `toca: true`. Un
 * guardián del que depende que las cosas corran tiene que fallar hacia el lado
 * de que corran: equivocarse por ejecutar de más cuesta una pasada, y
 * equivocarse por no ejecutar deja el ERP parado en silencio, que es justo el
 * fallo que llevamos toda la semana pagando.
 */
export async function tocaAhora(tarea: TareaCron): Promise<Veredicto> {
  const config = (await leerConfigCron()).find((c) => c.tarea === tarea)
  if (!config) return { toca: true }
  if (!config.activo) return { toca: false, motivo: 'apagado desde la pantalla de Sistema' }

  try {
    const service = createServiceClient()
    const { data, error } = await service
      .from('cron_ejecuciones')
      .select('iniciado_at')
      .eq('tarea', tarea)
      .is('lanzado_por', null)
      .order('iniciado_at', { ascending: false })
      .limit(1)
    if (error) throw error

    const ultima = data?.[0]?.iniciado_at as string | undefined
    if (!ultima) return { toca: true }

    const transcurrido = Date.now() - new Date(ultima).getTime()
    if (transcurrido + MARGEN_MS >= config.cada_minutos * 60_000) return { toca: true }

    return {
      toca: false,
      motivo: `le toca cada ${config.cada_minutos} min y van ${Math.round(transcurrido / 60_000)}`,
    }
  } catch {
    // Ver la cabecera: ante la duda, se ejecuta.
    return { toca: true }
  }
}

/** Cambia el horario de un proceso. Devuelve la lista entera ya actualizada */
export async function guardarConfigCron(
  tarea: string,
  cambios: { cadaMinutos?: number; activo?: boolean },
  userId: string | null
): Promise<ConfigCron[]> {
  if (!tareaCron(tarea)) {
    throw new Error(`No existe el proceso «${tarea}»`)
  }

  /**
   * SE PARTE DE LO QUE YA HAY, no de los valores del código.
   *
   * Es un UPSERT y escribe la fila entera, así que rellenar los huecos con los
   * valores por defecto tenía una consecuencia que no se ve leyendo la línea:
   * pulsar «Apagar» —que solo manda `activo`— le devolvía a `cada_minutos` el
   * número del código. O sea que apagar y encender un proceso te borraba en
   * silencio el intervalo que hubieras puesto.
   */
  const actual = (await leerConfigCron()).find((c) => c.tarea === tarea)
  let cadaMinutos = actual?.cada_minutos ?? tareaCron(tarea)!.cadaMinutos
  let activo = actual?.activo ?? true

  if (cambios.cadaMinutos !== undefined) {
    const n = Math.round(cambios.cadaMinutos)
    // El mismo rango que el CHECK de la migración, comprobado también aquí: el
    // de la base es la garantía, este es el que da un mensaje que se entiende.
    if (!Number.isFinite(n) || n < 1 || n > 43_200) {
      throw new Error('El intervalo tiene que estar entre 1 minuto y 30 días')
    }
    cadaMinutos = n
  }
  if (cambios.activo !== undefined) activo = cambios.activo

  const service = createServiceClient()
  // UPSERT y no UPDATE: si la fila no existe —proceso añadido al código después
  // de la 138— guardar tiene que crearla, no fallar en silencio con 0 filas.
  const { error } = await service.from('cron_config').upsert(
    {
      tarea,
      cada_minutos: cadaMinutos,
      activo,
      actualizado_at: new Date().toISOString(),
      actualizado_por: userId,
    },
    { onConflict: 'tarea' }
  )
  if (error) throw error

  return await leerConfigCron()
}

interface Registro {
  id: string | null
}

/**
 * Envuelve una pasada de cron y la deja registrada.
 *
 * `lanzadoPor` es el usuario cuando se dispara a mano desde la pantalla, y null
 * cuando lo hace el cron. La distinción importa: una pasada lanzada a mano para
 * depurar NO demuestra que el automatismo funcione, que es exactamente lo que
 * nos tuvo semanas creyendo que la agenda se sincronizaba sola.
 */
export async function conRegistro<T>(
  tarea: TareaCron,
  lanzadoPor: string | null,
  faena: () => Promise<T>
): Promise<T> {
  const arranque = Date.now()
  const registro = await abrir(tarea, lanzadoPor)

  try {
    const salida = await faena()
    await cerrar(registro, {
      ok: true,
      resumen: resumirDe(salida),
      duracionMs: Date.now() - arranque,
    })
    return salida
  } catch (error) {
    await cerrar(registro, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      duracionMs: Date.now() - arranque,
    })
    throw error
  }
}

/**
 * Un resumen legible de lo que devolvió la tarea.
 *
 * Cada ruta devuelve una forma distinta, así que se buscan las claves que suelen
 * traer en vez de exigir un contrato común: obligar a las cuatro rutas a
 * devolver lo mismo sería tocarlas todas para poder mirarlas, y este módulo
 * existe justo para no cambiar lo que observa.
 */
function resumirDe(salida: unknown): string | null {
  if (!salida || typeof salida !== 'object') return null
  const o = salida as Record<string, unknown>
  for (const clave of ['resumen', 'mensaje', 'message', 'summary']) {
    const v = o[clave]
    if (typeof v === 'string' && v.trim() !== '') return v.slice(0, 500)
  }
  const numeros = ['procesados', 'creados', 'actualizados', 'sincronizadas', 'perfiles']
    .map((k) => (typeof o[k] === 'number' ? `${k}: ${o[k]}` : null))
    .filter(Boolean)
  return numeros.length > 0 ? numeros.join(' · ') : null
}

async function abrir(tarea: TareaCron, lanzadoPor: string | null): Promise<Registro> {
  try {
    const service = createServiceClient()
    const { data, error } = await service
      .from('cron_ejecuciones')
      .insert({ tarea, lanzado_por: lanzadoPor })
      .select('id')
      .single()
    if (error) throw error
    return { id: data?.id ?? null }
  } catch {
    // Ver la cabecera: el registro nunca puede impedir que el cron trabaje.
    return { id: null }
  }
}

async function cerrar(
  registro: Registro,
  fin: { ok: boolean; resumen?: string | null; error?: string; duracionMs: number }
): Promise<void> {
  if (!registro.id) return
  try {
    const service = createServiceClient()
    await service
      .from('cron_ejecuciones')
      .update({
        terminado_at: new Date().toISOString(),
        ok: fin.ok,
        resumen: fin.resumen ?? null,
        error: fin.error ?? null,
        duracion_ms: fin.duracionMs,
      })
      .eq('id', registro.id)

    /**
     * La limpieza, de vez en cuando y no siempre.
     *
     * El de calendario corre cada 3 minutos: hacer un DELETE con rango de fechas
     * en cada pasada son 480 barridos diarios para borrar nada el 99 % de las
     * veces. Una de cada cien pasadas basta y sobra para que la tabla no crezca.
     */
    if (Math.random() < 0.01) {
      await service.rpc('limpiar_cron_ejecuciones', { p_dias: 30 })
    }
  } catch {
    /* ver arriba */
  }
}
