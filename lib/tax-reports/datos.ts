import { randomUUID } from 'crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { TIPO_FICHERO_POR_DEFECTO } from '@/lib/tax-reports/tipos'
import type { ClienteTax, FicheroTax, TipoFichero, VistaTaxReports } from '@/lib/tax-reports/tipos'

/**
 * TAX REPORTS: EL UNICO SITIO QUE TOCA LAS TABLAS Y EL BUCKET.
 * ===========================================================
 * SOLO SERVIDOR. Importar esto desde un componente de navegador arrastraria la
 * clave de servicio al JavaScript que se descarga cualquiera.
 *
 *
 * ============ ESTE MODULO ES EL PRIMERO DEL ERP QUE TOCA STORAGE DESDE EL
 *              SERVIDOR, Y NO ES CASUALIDAD ============
 *
 * Hoy en este repositorio no hay ni un `storage.from(` en app/ ni en lib/: las
 * diecisiete llamadas a Storage salen del NAVEGADOR, con la clave anonima,
 * contra buckets publicos. El patron es siempre el mismo
 * (components/crm/CrmDocuments.tsx, components/finances/AddPaymentModal.tsx,
 * components/agenda/AttachmentsField.tsx):
 *
 *     const supabase = createClient()                    // clave ANONIMA
 *     await supabase.storage.from('<bucket>').upload(path, file)
 *     const { data } = supabase.storage.from('<bucket>').getPublicUrl(path)
 *     await supabase.from('<tabla>').insert({ file_url: data.publicUrl })
 *
 * CUATRO COSAS DE ESAS, Y CADA UNA SOLA YA DESCARTA EL PATRON AQUI:
 *
 *   1. La subida la autoriza una politica `TO authenticated`. O sea: cualquiera
 *      con sesion del ERP —un empleado, un partner, y desde la 193 un CLIENTE,
 *      que es gente de fuera de la agencia— puede escribir en ese bucket.
 *   2. getPublicUrl NO FIRMA NADA: es una concatenacion de cadenas. No caduca,
 *      no comprueba sesion, y con public = true abre para cualquiera en
 *      internet. Es la misma forma de fallo que cerro la 199, por Storage en
 *      vez de por PostgREST.
 *   3. Esa URL se GUARDA en la tabla, asi que un select reparte enlaces
 *      eternos. Por eso aqui se guarda `ruta` —la clave dentro del bucket, que
 *      no sirve de nada sin la clave de servicio— y jamas una URL.
 *   4. El borrado tambien sale del navegador, asi que la retencion de seis
 *      meses se la salta cualquiera con sesion, y al reves: cualquiera con
 *      sesion puede borrar el fichero de un cliente antes de que se mande.
 *
 * Lo que va en su lugar es esto: el navegador manda el fichero a una ruta de
 * servidor, la ruta comprueba sesion y rol, y todo lo demas ocurre aqui con la
 * clave de servicio. Para descargar se firma un enlace de 60 segundos.
 *
 *
 * ============ supabase-js NO LANZA: DEVUELVE { error } ============
 *
 * Es la trampa que ya documenta AddPaymentModal.tsx para finance_attachments, y
 * en Storage duele mas: un upload que falla sin mirar el error deja la pantalla
 * diciendo que el mes esta subido cuando no hay nada. Aqui TODAS las llamadas a
 * storage comprueban `error` y lanzan con una frase en espanol.
 */

/** El bucket privado que crea la migracion 200. public = false */
const BUCKET = 'tax-reports'

/**
 * El mismo tope que el bucket (10 MB), repetido aqui a proposito.
 *
 * El del bucket corta en Storage, cuando el fichero ya ha viajado entero hasta
 * Supabase. Este corta en el contenedor, antes. Y lib/subidas-limite.ts tiene
 * el suyo en 25 MB, que para esto es una talla que no protege de nada: un tax
 * report real son ~170 KB y el xlsx mas gordo de Sellerboard, 2-5 MB.
 */
export const MAX_BYTES_INFORME = 10 * 1024 * 1024

/**
 * LAS EXTENSIONES QUE VALEN, Y EL TIPO QUE SE LE DECLARA A STORAGE.
 *
 * Se valida la EXTENSION y NO el `file.type` que manda el navegador, porque
 * para un .csv ese valor es un cara o cruz: text/csv, application/vnd.ms-excel,
 * text/plain o cadena vacia, segun el sistema y segun si hay Excel instalado.
 * Fiarse de el significa rechazar ficheros buenos en unos ordenadores y no en
 * otros, sin ningun patron que alguien pueda entender.
 *
 * Asi que el tipo lo decide esta tabla, y es el que se le pasa a upload(). La
 * lista `allowed_mime_types` del bucket es el segundo cinturon, para el dia que
 * alguien suba desde otro sitio.
 */
const TIPOS_POR_EXTENSION: Record<string, string> = {
  csv: 'text/csv',
  // El informe de Amazon baja a veces separado por tabuladores, con .txt
  txt: 'text/plain',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

/**
 * Seis meses. Ver el bloque 6 de la migracion 200.
 *
 * Se exporta para que la pantalla de Sistema lo ensene junto a los demas
 * plazos: un plazo que no se ve en ningun sitio es un plazo del que nadie se
 * acuerda hasta que borra algo que hacia falta.
 */
export const DIAS_RETENCION_INFORMES = 183

/* ------------------------------------------------------------------ */
/* ¿FALTA LANZAR LA 200?                                               */
/* ------------------------------------------------------------------ */

/**
 * Las migraciones de este repo se lanzan A MANO en el editor SQL de Supabase,
 * asi que el codigo puede llegar desplegado antes que ellas. Sin esto, abrir
 * Tax Reports daria un 500 generico y nadie relacionaria «no se ha podido
 * completar la operacion» con un fichero .sql sin pegar.
 *
 * Los mismos codigos que mira app/api/stock-sync/buzones/route.ts para la 198.
 */
export function faltaLa200(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'PGRST205' || code === '42P01' || code === 'PGRST204' || code === '42703'
}

export const MENSAJE_FALTA_LA_200 =
  'Falta lanzar la migracion 200_tax_reports.sql en el editor SQL de Supabase: sin ella no existen ' +
  'ni la rejilla de clientes ni el sitio donde se guardan los informes.'

/* ------------------------------------------------------------------ */
/* LA VISTA                                                            */
/* ------------------------------------------------------------------ */

interface FilaCliente {
  id: string
  nombre: string
  tipo_fichero: TipoFichero
  activo: boolean
  notas: string | null
  orden: number
}

interface FilaFichero {
  id: string
  cliente_id: string
  anio: number
  mes: number
  nombre_original: string
  tamano: number
  subido_at: string
  subido_por: string | null
  purgado_at: string | null
}

interface FilaNotaMes {
  cliente_id: string
  anio: number
  mes: number
  texto: string
}

/**
 * TODO lo que necesita la pantalla para pintar un ano, en una sola respuesta.
 *
 * Se devuelve ENTERA en cada escritura —alta de cliente, subida, borrado— y no
 * solo la fila tocada. Es lo mismo que hacen las rutas de buzones y de
 * perfiles, y por el mismo motivo: la pantalla se repinta con esto y no tiene
 * que adivinar donde va la fila nueva ni recalcular los recuentos del mes. Con
 * once clientes y doce meses son unas 130 filas sin ningun contenido dentro:
 * cuesta menos que mantener dos formas de actualizar el estado.
 *
 * LO QUE NO VIAJA: `ruta`. Ver la cabecera de tipos.ts.
 */
export async function leerVista(anio: number): Promise<VistaTaxReports> {
  const service = createServiceClient()

  const { data: clientes, error: errorClientes } = await service
    .from('tax_report_clientes')
    .select('id, nombre, tipo_fichero, activo, notas, orden')
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true })

  if (errorClientes) {
    if (faltaLa200(errorClientes)) {
      return { clientes: [], ficheros: [], notasMes: [], anios: [anio], faltaMigracion: true }
    }
    throw errorClientes
  }

  const { data: ficheros, error: errorFicheros } = await service
    .from('tax_report_ficheros')
    .select('id, cliente_id, anio, mes, nombre_original, tamano, subido_at, subido_por, purgado_at')
    .eq('anio', anio)

  if (errorFicheros) throw errorFicheros

  /**
   * Las notas del ano, en su propia consulta y en su propio array.
   *
   * No se pueden traer con un join desde `tax_report_ficheros` porque las que
   * mas importan son justo las de los meses que NO tienen fichero: un join las
   * dejaria fuera. Son una fila por celda anotada, o sea casi siempre menos que
   * ficheros.
   */
  const { data: notas, error: errorNotas } = await service
    .from('tax_report_notas_mes')
    .select('cliente_id, anio, mes, texto')
    .eq('anio', anio)

  /**
   * AQUI SE VUELVE A MIRAR `faltaLa200`, Y NO ES REDUNDANTE.
   *
   * Hay una base donde las dos tablas de arriba SI existen y esta NO: aquella en
   * la que se pego la 200 antes de que las notas de mes tuvieran tabla propia.
   * Ahi las dos consultas anteriores responden bien y solo revienta esta, asi
   * que sin este caso la pantalla daria un 500 generico —«no se ha podido
   * completar la operacion»— que nadie relacionaria con un .sql sin volver a
   * pegar. Con esto dice exactamente lo que pasa, que es lo mismo que ya hacia
   * cuando no existia ninguna de las tres.
   */
  if (errorNotas) {
    if (faltaLa200(errorNotas)) {
      return { clientes: [], ficheros: [], notasMes: [], anios: [anio], faltaMigracion: true }
    }
    throw errorNotas
  }

  /**
   * LOS ANOS QUE HAY QUE OFRECER EN EL SELECTOR.
   *
   * Se piden solo las columnas del ano y se deduplican aqui: PostgREST no sabe
   * hacer un DISTINCT, y montar una vista en la base para una lista de cuatro
   * numeros seria mas cosas que mantener. Son unas cien filas por ano.
   *
   * El ano en curso entra SIEMPRE aunque no tenga nada subido: si no, el
   * selector nace vacio el 1 de enero y no hay forma de llegar a la rejilla
   * donde hay que subir lo de diciembre.
   */
  const { data: todos, error: errorAnios } = await service
    .from('tax_report_ficheros')
    .select('anio')

  if (errorAnios) throw errorAnios

  const anios = Array.from(
    new Set([
      new Date().getFullYear(),
      anio,
      ...((todos ?? []) as { anio: number }[]).map((f) => f.anio),
    ])
  ).sort((a, b) => b - a)

  return {
    clientes: ((clientes ?? []) as FilaCliente[]).map(aClienteTax),
    ficheros: ((ficheros ?? []) as FilaFichero[]).map(aFicheroTax),
    notasMes: ((notas ?? []) as FilaNotaMes[]).map((n) => ({
      clienteId: n.cliente_id,
      anio: n.anio,
      mes: n.mes,
      texto: n.texto,
    })),
    anios,
    faltaMigracion: false,
  }
}

function aClienteTax(f: FilaCliente): ClienteTax {
  return {
    id: f.id,
    nombre: f.nombre,
    tipoFichero: f.tipo_fichero,
    activo: f.activo,
    notas: f.notas,
    orden: f.orden,
  }
}

function aFicheroTax(f: FilaFichero): FicheroTax {
  return {
    id: f.id,
    clienteId: f.cliente_id,
    anio: f.anio,
    mes: f.mes,
    nombreOriginal: f.nombre_original,
    tamano: f.tamano,
    subidoAt: f.subido_at,
    subidoPor: f.subido_por,
    purgadoAt: f.purgado_at,
  }
}

/* ------------------------------------------------------------------ */
/* CLIENTES                                                            */
/* ------------------------------------------------------------------ */

export interface AltaClienteTax {
  nombre: string
  /**
   * Como se llama el fichero que le toca. Texto libre desde que se quito el
   * CHECK IN de la migracion 200: ver lib/tax-reports/tipos.ts.
   *
   * Opcional porque la inmensa mayoria van con el tax report de Amazon, y
   * obligar a escribirlo en cada alta es teclear lo mismo once veces.
   */
  tipoFichero?: TipoFichero | null
  notas?: string | null
}

export async function crearCliente(datos: AltaClienteTax): Promise<void> {
  const service = createServiceClient()

  const { error } = await service.from('tax_report_clientes').insert({
    nombre: datos.nombre,
    // El mismo valor que el DEFAULT de la columna, puesto aqui a proposito: un
    // insert que mandara `null` NO caeria en el DEFAULT, chocaria con el NOT
    // NULL, y el alta fallaria con un 23502 que no dice nada de un desplegable
    // vacio.
    tipo_fichero: datos.tipoFichero?.trim() || TIPO_FICHERO_POR_DEFECTO,
    notas: datos.notas ?? null,
    // client_id se queda a NULL: este es el alta a mano. El vinculo con el
    // cliente de comisiones solo lo pone la siembra de la migracion.
  })

  if (error) throw error
}

export interface CambiosClienteTax {
  nombre?: string
  tipoFichero?: TipoFichero
  activo?: boolean
  notas?: string | null
  orden?: number
}

/**
 * Los cambios se aplican UNO A UNO, nunca con un spread del cuerpo.
 *
 * Asi un `client_id`, un `created_at` o un `id` colados en el JSON no tienen
 * por donde entrar: no es que se filtren, es que nadie los lee. Y un campo que
 * no venga se queda como estaba, que es lo que la pantalla espera cuando manda
 * solo lo que se ha tocado.
 */
export async function actualizarCliente(id: string, cambios: CambiosClienteTax): Promise<boolean> {
  const service = createServiceClient()

  const fila: Record<string, unknown> = {}
  if (cambios.nombre !== undefined) fila.nombre = cambios.nombre
  if (cambios.tipoFichero !== undefined) fila.tipo_fichero = cambios.tipoFichero
  if (cambios.activo !== undefined) fila.activo = cambios.activo
  if (cambios.notas !== undefined) fila.notas = cambios.notas
  if (cambios.orden !== undefined) fila.orden = cambios.orden

  if (Object.keys(fila).length === 0) return false

  const { data, error } = await service
    .from('tax_report_clientes')
    .update(fila)
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) throw error
  return Boolean(data)
}

export async function leerCliente(id: string): Promise<ClienteTax | null> {
  const service = createServiceClient()

  const { data, error } = await service
    .from('tax_report_clientes')
    .select('id, nombre, tipo_fichero, activo, notas, orden')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return data ? aClienteTax(data as FilaCliente) : null
}

/** Los meses que tiene en la rejilla, separando los que aun guardan fichero */
export interface MesesDeUnCliente {
  /** Filas en total: todos los meses de los que consta que se le mando algo */
  total: number
  /** De esos, los que todavia tienen el fichero en el bucket */
  conFichero: number
}

/**
 * Cuantos meses tiene ya en la rejilla. La ruta de borrado lo usa para el 409.
 *
 * SE DEVUELVEN LAS DOS CIFRAS Y NO UNA, porque a los seis meses dejan de ser lo
 * mismo: la purga retira el fichero del bucket y DEJA LA FILA (`ruta` a NULL),
 * asi que un cliente de hace un ano tiene doce filas y cero ficheros. Con una
 * sola cifra, el 409 le decia al usuario que «tiene 12 informes colgados»
 * cuando no queda ninguno colgado en ningun sitio, y lo que de verdad le
 * estabamos protegiendo —el historial de que esos meses SI se mandaron— no se
 * nombraba.
 *
 * El borrado se sigue impidiendo en los dos casos: la fila purgada es lo unico
 * que queda para poder decir «el de marzo se mando», y borrarla deja la celda
 * vacia, que en esta pantalla significa «falta por subir».
 */
export async function cuantosFicherosTiene(clienteId: string): Promise<MesesDeUnCliente> {
  const service = createServiceClient()

  const { count: total, error } = await service
    .from('tax_report_ficheros')
    .select('id', { count: 'exact', head: true })
    .eq('cliente_id', clienteId)

  if (error) throw error

  const { count: conFichero, error: errorVivos } = await service
    .from('tax_report_ficheros')
    .select('id', { count: 'exact', head: true })
    .eq('cliente_id', clienteId)
    .not('ruta', 'is', null)

  if (errorVivos) throw errorVivos

  return { total: total ?? 0, conFichero: conFichero ?? 0 }
}

/**
 * Borra un cliente de la rejilla.
 *
 * SOLO SE LLAMA CUANDO NO TIENE NI UN FICHERO, y eso lo comprueba la ruta. La
 * clave ajena es ON DELETE CASCADE, asi que si esto se llamara con ficheros
 * dentro se llevaria por delante las filas —y los objetos del bucket se
 * quedarian ahi, sin fila que los nombre, hasta que alguien los encontrara a
 * mano—. Para dejar de ver a un cliente esta `activo`, que es lo que se quiere
 * casi siempre.
 */
export async function borrarCliente(id: string): Promise<void> {
  const service = createServiceClient()
  const { error } = await service.from('tax_report_clientes').delete().eq('id', id)
  if (error) throw error
}

/* ------------------------------------------------------------------ */
/* FICHEROS                                                            */
/* ------------------------------------------------------------------ */

/**
 * La extension, en minusculas y sin el punto. null si no la tiene o no vale.
 */
export function extensionValida(nombre: string): string | null {
  const punto = nombre.lastIndexOf('.')
  if (punto < 0) return null
  const ext = nombre.slice(punto + 1).toLowerCase()
  return ext in TIPOS_POR_EXTENSION ? ext : null
}

export const EXTENSIONES_ACEPTADAS = Object.keys(TIPOS_POR_EXTENSION)

/**
 * El ano y el mes, tal y como llegan de una URL o de un formulario: texto.
 *
 * Los limites son LOS MISMOS que los CHECK de la migracion 200, y estan aqui
 * para poder decirlo con una frase en espanol antes de que la base conteste un
 * 23514 con el nombre de una restriccion. La regla sigue viviendo en los dos
 * sitios a proposito: por el editor SQL tambien se escribe en estas tablas.
 */
export function anioValido(raw: unknown): number | null {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 2020 || n > 2100) return null
  return n
}

export function mesValido(raw: unknown): number | null {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 12) return null
  return n
}

export interface SubidaInforme {
  clienteId: string
  anio: number
  mes: number
  fichero: File
  userId: string
}

/**
 * GUARDA EL INFORME DE UN MES. Si ya habia uno, lo SUSTITUYE.
 *
 *
 * ============ LA RUTA DENTRO DEL BUCKET ============
 *
 *     <cliente_id>/<anio>/<mm>/<uuid>.<ext>
 *     p. ej.  7c3f…e21b/2026/08/1f0a…9d44.csv
 *
 *   · cliente_id y NO el nombre. Los clientes se pueden renombrar desde la
 *     pantalla, y con el nombre en la ruta renombrar «Lenobotics» a
 *     «LENOBOTICS SL» dejaria todos los ficheros viejos colgando de una carpeta
 *     que ya no existe para nadie —y ahi seguirian seis meses, invisibles—. El
 *     UUID no cambia nunca. Ademas el nombre lleva espacios y acentos, que hay
 *     que escapar en una clave de Storage.
 *   · El mes a dos cifras, para que 09 vaya antes que 10 al ordenar.
 *   · El nombre final es un UUID y NO el nombre original. El fichero que baja
 *     el empleado se llama cosas como
 *     «VAT_Transactions_Report_ES_..._<merchant token>.csv»: lleva el token de
 *     la cuenta del cliente DENTRO DEL NOMBRE, y la clave del objeto es lo que
 *     aparece en la URL firmada. El nombre bonito se guarda en
 *     `nombre_original` y se devuelve al firmar la descarga.
 *
 *
 * ============ EL ORDEN DE LOS TRES PASOS, Y POR QUE ESTE ============
 *
 *   1. Se sube el objeto nuevo, con clave nueva.
 *   2. Se escribe la fila (upsert sobre cliente+ano+mes).
 *   3. Y SOLO ENTONCES se borra el objeto viejo, si lo habia.
 *
 * La tentacion es borrar el viejo primero, que suena a «no dejar huerfanos».
 * Pero si el paso 1 o el 2 fallaran despues de haberlo borrado, la celda se
 * quedaria con una fila apuntando a un fichero que ya no existe: el mes
 * parece subido y no hay nada que mandar. Con este orden, cada fallo deja un
 * estado que se entiende:
 *
 *   · falla el 1 -> no ha cambiado nada, el fichero viejo sigue entero.
 *   · falla el 2 -> se borra el objeto que se acababa de subir y se lanza. Si
 *     no se borrara, quedaria un fichero con datos de comprador que ninguna
 *     pantalla volveria a ensenar y que la purga no encontraria nunca, porque
 *     la purga mira la tabla.
 *   · falla el 3 -> queda un objeto huerfano, se registra con su ruta para
 *     poder quitarlo a mano, y lo que ve el usuario es correcto.
 *
 * Y NUNCA `upsert: true` con una clave fija por celda: eso convierte cualquier
 * subida equivocada en un pisoton silencioso del fichero bueno, sin rastro.
 */
export async function guardarInforme(datos: SubidaInforme): Promise<void> {
  const service = createServiceClient()

  const ext = extensionValida(datos.fichero.name)
  if (!ext) {
    throw new Error(
      `«${datos.fichero.name}» no tiene una extension que valga aqui. Se aceptan ` +
        `${EXTENSIONES_ACEPTADAS.map((e) => '.' + e).join(', ')}, que es lo que bajan Amazon y Sellerboard.`
    )
  }

  const mm = String(datos.mes).padStart(2, '0')
  const ruta = `${datos.clienteId}/${datos.anio}/${mm}/${randomUUID()}.${ext}`

  // Lo que hubiera en esa celda, para poder retirarlo al final.
  const { data: anterior, error: errorAnterior } = await service
    .from('tax_report_ficheros')
    .select('id, ruta')
    .eq('cliente_id', datos.clienteId)
    .eq('anio', datos.anio)
    .eq('mes', datos.mes)
    .maybeSingle()

  if (errorAnterior) throw errorAnterior

  const { error: errorSubida } = await service.storage.from(BUCKET).upload(ruta, datos.fichero, {
    // SIEMPRE explicito: no se usa el file.type del navegador. Ver
    // TIPOS_POR_EXTENSION.
    contentType: TIPOS_POR_EXTENSION[ext],
    // Dos subidas a la misma clave tienen que dar error, no pisoton. Con un
    // UUID nuevo por subida esto no deberia ocurrir nunca; si ocurre, es que
    // algo esta muy mal y es mejor enterarse.
    upsert: false,
    // Nada de CDN guardando una copia de un fichero con datos de comprador.
    cacheControl: '0',
  })

  if (errorSubida) {
    throw new Error(
      `No se ha podido guardar el fichero: ${errorSubida.message}. Si dice algo de «mime type», ` +
        'es que el bucket no acepta ese formato; si dice «Bucket not found», falta lanzar la migracion 200.'
    )
  }

  const { error: errorFila } = await service.from('tax_report_ficheros').upsert(
    {
      cliente_id: datos.clienteId,
      anio: datos.anio,
      mes: datos.mes,
      ruta,
      nombre_original: datos.fichero.name,
      tamano: datos.fichero.size,
      tipo_mime: TIPOS_POR_EXTENSION[ext],
      subido_por: datos.userId,
      subido_at: new Date().toISOString(),
      // Se subio de nuevo: si esa celda estaba purgada, ya no lo esta.
      purgado_at: null,
    },
    { onConflict: 'cliente_id,anio,mes' }
  )

  if (errorFila) {
    // El objeto recien subido se retira: ver el orden de los tres pasos.
    await service.storage
      .from(BUCKET)
      .remove([ruta])
      .catch(() => {})
    throw errorFila
  }

  const rutaVieja = (anterior as { ruta: string | null } | null)?.ruta
  if (rutaVieja && rutaVieja !== ruta) {
    const { error: errorBorrado } = await service.storage.from(BUCKET).remove([rutaVieja])
    if (errorBorrado) {
      // No se le cuenta al usuario: su subida ha ido bien y la celda es
      // correcta. Pero queda escrito CON LA RUTA, porque a partir de aqui ese
      // objeto ya no lo nombra ninguna fila y la purga no lo va a encontrar.
      console.error(
        `[tax-reports] ha quedado un fichero huerfano en el bucket: ${rutaVieja} (${errorBorrado.message}). ` +
          'Hay que quitarlo a mano desde Storage: lleva datos de comprador y ya no lo nombra ninguna fila.'
      )
    }
  }
}

/**
 * EL ENLACE DE DESCARGA, FIRMADO Y CADUCADO.
 *
 * Sesenta segundos, y se pide de UNO EN UNO al pulsar «Descargar», nunca al
 * pintar la rejilla. Existe `createSignedUrls(paths[], ...)` para firmar varios
 * de golpe y es la salida comoda; con once clientes y doce meses eso serian 132
 * enlaces validos repartidos de una vez, dentro del HTML, cada vez que alguien
 * abre la pantalla.
 *
 * `download: nombre_original` pone Content-Disposition: attachment con ese
 * nombre. Es lo que permite que la clave del objeto sea un UUID sin nada
 * legible y que el empleado guarde igualmente «Tax Report DIRU 2026-08.csv».
 *
 * Devuelve null si ese fichero ya se purgo: la fila sigue ahi a proposito, pero
 * el fichero no.
 */
export async function enlaceDeDescarga(id: string): Promise<
  { url: string; nombre: string } | null | 'purgado'
> {
  const service = createServiceClient()

  const { data, error } = await service
    .from('tax_report_ficheros')
    .select('ruta, nombre_original, purgado_at')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const fila = data as { ruta: string | null; nombre_original: string; purgado_at: string | null }
  if (!fila.ruta) return 'purgado'

  const { data: firmado, error: errorFirma } = await service.storage
    .from(BUCKET)
    .createSignedUrl(fila.ruta, 60, { download: fila.nombre_original })

  if (errorFirma || !firmado?.signedUrl) {
    throw new Error(
      `No se ha podido preparar la descarga: ${errorFirma?.message ?? 'Supabase no ha devuelto el enlace'}`
    )
  }

  return { url: firmado.signedUrl, nombre: fila.nombre_original }
}

/**
 * GUARDA LO QUE PASA CON UN MES. Vale tenga fichero o no.
 *
 * ESTA ES LA FUNCION QUE ANTES NO PODIA EXISTIR. Las notas vivian en la fila de
 * `tax_report_ficheros`, y esa fila solo aparece cuando hay algo colgado: el
 * unico mes que se queria anotar —«falta la factura de enero», que habla de un
 * mes QUE FALTA— era justo el unico que no se podia. Ahora viven en
 * `tax_report_notas_mes`, que cuelga del CLIENTE y no del fichero.
 *
 * `texto` a null —o en blanco— BORRA la fila en vez de guardar la cadena vacia.
 * Es lo que manda la pantalla cuando alguien vacia el recuadro, y asi «hay
 * fila» tambien aqui significa una sola cosa: que hay algo escrito. La columna
 * lleva CHECK (btrim(texto) <> '') para que no haya otra forma de contarlo.
 *
 * Se escribe SOLO la celda que se dice, campo a campo: por aqui no tiene por
 * donde entrar nada de `tax_report_ficheros`. Es el mismo criterio que
 * actualizarCliente.
 *
 * NO COMPRUEBA QUE EL CLIENTE EXISTA porque no hace falta: `cliente_id` es una
 * clave foranea, asi que un id inventado se queda en un 23503 que la ruta
 * convierte en error. Y el ON DELETE CASCADE se lleva las notas del cliente que
 * se borre, igual que sus ficheros.
 */
export async function guardarNotaDelMes(
  clienteId: string,
  anio: number,
  mes: number,
  texto: string | null,
  escritaPor: string | null = null
): Promise<void> {
  const service = createServiceClient()

  const limpio = (texto ?? '').trim()

  if (limpio === '') {
    const { error } = await service
      .from('tax_report_notas_mes')
      .delete()
      .eq('cliente_id', clienteId)
      .eq('anio', anio)
      .eq('mes', mes)

    if (error) throw error
    return
  }

  /**
   * UPSERT SOBRE (cliente_id, anio, mes), que es el UNIQUE de la tabla.
   *
   * Y no un select-y-luego-insert-o-update: entre las dos consultas cabe otra
   * persona escribiendo la nota del mismo mes, y lo que sale de ahi es un 23505
   * en la cara de quien guardo segundo. Con dos personas trabajando la lista el
   * dia 3 eso pasa.
   */
  const { error } = await service
    .from('tax_report_notas_mes')
    .upsert(
      {
        cliente_id: clienteId,
        anio,
        mes,
        texto: limpio,
        escrita_por: escritaPor,
      },
      { onConflict: 'cliente_id,anio,mes' }
    )

  if (error) throw error
}

/**
 * La misma nota, pero llegando por el id del FICHERO de ese mes.
 *
 * Existe para la pantalla vieja y para cualquiera que ya tenga el fichero en la
 * mano: traduce el id a (cliente, ano, mes) y escribe donde se escribe ahora.
 * Devuelve false si ese fichero ya no esta, que es lo unico que puede fallar
 * aqui y que quien llama tiene que poder contar.
 */
export async function guardarNotaPorFichero(
  ficheroId: string,
  texto: string | null,
  escritaPor: string | null = null
): Promise<boolean> {
  const service = createServiceClient()

  const { data, error } = await service
    .from('tax_report_ficheros')
    .select('cliente_id, anio, mes')
    .eq('id', ficheroId)
    .maybeSingle()

  if (error) throw error
  if (!data) return false

  const celda = data as { cliente_id: string; anio: number; mes: number }
  await guardarNotaDelMes(celda.cliente_id, celda.anio, celda.mes, texto, escritaPor)
  return true
}

/**
 * Quita el informe de una celda: primero el fichero, despues la fila.
 *
 * EN ESE ORDEN Y NO AL REVES. Si se borrara la fila primero y el borrado del
 * objeto fallara, el fichero se quedaria en el bucket para siempre sin que
 * ninguna pantalla ni ninguna purga vuelva a mencionarlo: la purga mira la
 * tabla. Con este orden, un fallo deja la celda como estaba y se puede volver a
 * intentar.
 */
export async function borrarInforme(id: string): Promise<boolean> {
  const service = createServiceClient()

  const { data, error } = await service
    .from('tax_report_ficheros')
    .select('id, ruta')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) return false

  const fila = data as { id: string; ruta: string | null }

  if (fila.ruta) {
    const { error: errorBorrado } = await service.storage.from(BUCKET).remove([fila.ruta])
    if (errorBorrado) {
      throw new Error(
        `No se ha podido quitar el fichero del almacen: ${errorBorrado.message}. No se ha tocado la ` +
          'fila, asi que la celda se queda como estaba y se puede volver a intentar.'
      )
    }
  }

  const { error: errorFila } = await service.from('tax_report_ficheros').delete().eq('id', fila.id)
  if (errorFila) throw errorFila

  return true
}

/* ------------------------------------------------------------------ */
/* LA PURGA DE LOS SEIS MESES                                          */
/* ------------------------------------------------------------------ */

export interface ResultadoPurgaInformes {
  /** Cuantos ficheros pasaban de los seis meses en esta pasada */
  candidatos: number
  /** Cuantos se han retirado del bucket y marcado */
  retirados: number
  error: string | null
}

/**
 * RETIRA DEL BUCKET LOS INFORMES DE MAS DE SEIS MESES.
 *
 * ESTO NO PUEDE SER UNA REGLA MAS DE `REGLAS` EN lib/plataforma/limpieza.ts, y
 * conviene que quede escrito para que nadie lo «simplifique» dentro de medio
 * ano: aquella lista BORRA FILAS y no sabe que Storage existe —lo dice su
 * propia regla de marketing_informes—. Meter esta tabla ahi tal cual seria el
 * peor de los dos mundos: desaparece la fila, que es el unico indice de que ese
 * fichero existe, y el CSV con datos de comprador se queda en el bucket para
 * siempre sin que nada vuelva a nombrarlo.
 *
 * Aqui el orden es: el FICHERO primero, la fila despues. Si el borrado del
 * objeto falla, no se marca nada y se reintenta en la pasada siguiente.
 *
 * Y LA FILA NO SE BORRA, se queda con `ruta` a null y `purgado_at` puesto. Si
 * se borrara, la celda de marzo volveria a verse vacia —que en esta pantalla
 * significa «falta por subir»— y el dia 3 alguien colgaria otra vez el fichero
 * que habiamos decidido no guardar.
 *
 * El reloj es `subido_at` y no el mes del informe: el fichero existe para poder
 * mandarlo, asi que son seis meses desde que existe, no desde el mes al que se
 * refiere.
 */
export async function purgarInformesCaducados(tope = 200): Promise<ResultadoPurgaInformes> {
  const service = createServiceClient()

  try {
    const { data, error } = await service.rpc('tax_report_pendientes_de_purga', {
      p_dias: DIAS_RETENCION_INFORMES,
      p_tope: tope,
    })

    if (error) {
      // Sin la 200 lanzada no hay nada que purgar, y no es un fallo que haya
      // que gritar cada minuto.
      if (faltaLa200(error) || error.code === 'PGRST202') {
        return { candidatos: 0, retirados: 0, error: null }
      }
      return { candidatos: 0, retirados: 0, error: error.message }
    }

    const pendientes = ((data ?? []) as { id: string; ruta: string }[]).filter((f) => f.ruta)
    if (pendientes.length === 0) return { candidatos: 0, retirados: 0, error: null }

    const { error: errorBorrado } = await service.storage
      .from(BUCKET)
      .remove(pendientes.map((f) => f.ruta))

    if (errorBorrado) {
      // No se marca NADA: al reves quedarian huerfanos que nadie volveria a
      // encontrar. Se reintenta dentro de un minuto.
      return { candidatos: pendientes.length, retirados: 0, error: errorBorrado.message }
    }

    const { data: marcados, error: errorMarcar } = await service.rpc('tax_report_marcar_purgados', {
      p_ids: pendientes.map((f) => f.id),
    })

    if (errorMarcar) {
      // Los ficheros ya no estan, pero las filas siguen diciendo que si. La
      // pasada siguiente los vuelve a listar; el remove() de algo que ya no
      // existe no da error, asi que se arregla solo.
      return { candidatos: pendientes.length, retirados: 0, error: errorMarcar.message }
    }

    return {
      candidatos: pendientes.length,
      retirados: Number(marcados ?? pendientes.length),
      error: null,
    }
  } catch (e) {
    return {
      candidatos: 0,
      retirados: 0,
      error: e instanceof Error ? e.message : 'error desconocido',
    }
  }
}
