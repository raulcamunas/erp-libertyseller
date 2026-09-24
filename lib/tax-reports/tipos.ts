/**
 * LO QUE VIAJA AL NAVEGADOR EN TAX REPORTS.
 * =========================================
 *
 * Este fichero es TIPOS Y DOS CADENAS. Nada mas, y eso es lo que importa: no
 * toca la base, no importa nada de `lib/supabase`, y por eso la pantalla lo
 * puede importar como valor sin arrastrar la clave de servicio al JavaScript
 * que se descarga cualquiera. Lo que NO puede pasar nunca es que aqui entre un
 * `import` de datos.ts.
 *
 * Las dos cadenas viven aqui —y no en datos.ts, que es solo-servidor— porque
 * las necesita la pantalla: el nombre con el que nace un cliente nuevo y lo que
 * se le ofrece escrito para no tener que teclearlo cada vez.
 *
 *
 * ============ LO QUE NO ESTA AQUI, Y ES LO QUE IMPORTA ============
 *
 * `FicheroTax` NO tiene ninguna URL, ni la clave del objeto dentro del bucket
 * (`ruta`). Es a proposito, y es la diferencia con crm_documents y
 * finance_attachments, que guardan y devuelven el `publicUrl` de getPublicUrl:
 * una URL publica no caduca, no comprueba sesion y quien la tenga la reparte.
 *
 * Aqui el enlace se pide de uno en uno al pulsar «Descargar»
 * (GET /api/tax-reports/ficheros/[id]) y caduca en 60 segundos. Si `ruta`
 * estuviera en este tipo, se colaria en la respuesta de la rejilla y acabaria
 * en el HTML de la pantalla, que es exactamente lo que se quiere evitar.
 *
 * Tampoco hay NADA del contenido del fichero: ni total, ni numero de pedidos,
 * ni una fila. Ahi dentro van ciudad, codigo postal y Order ID de compradores.
 */

/**
 * COMO SE LLAMA EL FICHERO QUE LE TOCA A UN CLIENTE.
 *
 * Es `string` y no una union, y el alias se queda por dos motivos: porque dice
 * en la firma de que estamos hablando, y porque el dia que esto vuelva a ser
 * una lista cerrada se cambia aqui y el compilador enseña todos los sitios.
 *
 * ERA `'tax_report' | 'sellerboard'`. Raul ha pedido poder denominarlo el
 * —«Tax report», «Sellerboard», «Informe del proveedor»—, asi que ya no hay dos
 * valores fijos ni en la base (se quito el CHECK IN de la 200) ni aqui.
 *
 * Y NO SE VALIDA CONTRA NINGUNA LISTA EN NINGUN SITIO. Lo unico que se le exige
 * es no venir en blanco, que es lo que comprueban las rutas y el CHECK de la
 * columna: una fila que no dice que fichero toca deja al que la mira el dia 3
 * sin saber que tiene que ir a descargar.
 */
export type TipoFichero = string

/**
 * Con que nombre nace un cliente si quien lo da de alta no escribe otro.
 *
 * Es el caso de la mayoria —el tax report de Amazon—, y es la misma cadena que
 * el DEFAULT de la columna en la migracion 200. Si se cambia una, se cambia la
 * otra: aqui no pasa nada malo si bailan, simplemente los clientes nacidos
 * desde la pantalla y los nacidos desde el editor SQL se llamarian distinto y
 * la lista se veria desordenada sin que nadie entienda por que.
 */
export const TIPO_FICHERO_POR_DEFECTO = 'Tax report'

/**
 * Lo que se le ofrece escrito a quien da de alta un cliente.
 *
 * NO ES UNA VALIDACION NI UNA LISTA CERRADA: es lo que se pone en un datalist
 * para no teclear «Sellerboard» once veces y para que no acaben conviviendo
 * «Sellerboard», «sellerboard» y «Seller board», que es lo unico que se pierde
 * al dejar esto en texto libre. Quien quiera escribir otra cosa la escribe.
 */
export const TIPOS_FICHERO_HABITUALES = ['Tax report', 'Sellerboard'] as const

/** Una fila de la rejilla */
export interface ClienteTax {
  id: string
  nombre: string
  tipoFichero: TipoFichero
  /** Un cliente inactivo sigue ensenando sus meses viejos y no sale en los nuevos */
  activo: boolean
  notas: string | null
  orden: number
}

/** Una celda con fichero. Si no hay celda, es que ese mes falta por subir */
export interface FicheroTax {
  id: string
  clienteId: string
  anio: number
  mes: number
  nombreOriginal: string
  tamano: number
  subidoAt: string
  /** El id del perfil que lo subio, o null si esa cuenta ya no existe */
  subidoPor: string | null
  /**
   * Cuando se retiro el fichero del bucket a los seis meses, o null si sigue
   * ahi. La celda tiene que distinguirlo de «falta por subir»: si las dos se
   * pintan igual, el dia 3 alguien vuelve a colgar lo que decidimos no guardar.
   */
  purgadoAt: string | null
}

/**
 * LO QUE PASA CON UN MES, TENGA FICHERO O NO.
 *
 * «Este mes lo mando tarde», «falta la factura de enero».
 *
 * NO ESTA DENTRO DE `FicheroTax`, y esa es toda la diferencia: estuvo, y
 * entonces solo se podia anotar un mes que ya estaba puesto, o sea el unico que
 * no hacia falta explicar. Viaja en su propio array de la vista y se busca por
 * cliente + mes, que es como la pantalla piensa la celda antes de saber si esa
 * celda tiene algo colgado.
 *
 * Las notas del cliente entero son `ClienteTax.notas` y son otra cosa: aquellas
 * valen para los doce meses y estas solo para uno.
 */
export interface NotaMes {
  clienteId: string
  anio: number
  mes: number
  /** Nunca vacio: vaciar la nota borra la fila */
  texto: string
}

export interface VistaTaxReports {
  clientes: ClienteTax[]
  /** Solo los del ano pedido */
  ficheros: FicheroTax[]
  /**
   * Las notas de mes del ano pedido, de TODOS los clientes.
   *
   * Van en su propio array y no dentro de `ficheros` porque hay notas en meses
   * que no tienen fichero —que son la mayoria de las que se escriben— y ahi no
   * habria donde colgarlas.
   */
  notasMes: NotaMes[]
  /** Los anos que tienen algo subido, mas el actual. Para el selector de ano */
  anios: number[]
  /**
   * true = las tablas no existen todavia porque falta lanzar la migracion 200
   * en el editor SQL de Supabase.
   *
   * Se devuelve como un dato y no como un error 500 porque la migracion se
   * lanza A MANO: el codigo puede llegar desplegado antes que ella, y un 500
   * generico no le dice a nadie que lo que falta es pegar un .sql.
   */
  faltaMigracion: boolean
}
