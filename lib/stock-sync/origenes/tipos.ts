/**
 * DE DÓNDE SALE EL FICHERO: LA INTERFAZ COMÚN.
 *
 * El usuario todavía no sabe qué va a poder darle cada cliente —uno dejará el
 * volcado en una carpeta de Drive, otro solo sabrá mandarlo por correo, otro
 * tendrá un SFTP— así que el origen tiene que ser ENCHUFABLE: añadir uno nuevo
 * es escribir un fichero en esta carpeta y meterlo en el registro de index.ts,
 * sin tocar el lector, ni el cruce, ni la pantalla, ni la base de datos.
 *
 * LO QUE HACE QUE ESO SEA VERDAD Y NO UNA BUENA INTENCIÓN:
 *
 *   1. Todos devuelven lo mismo, un FicheroOrigen: un nombre, unos bytes y una
 *      huella. A partir de ahí el proceso es idéntico venga de donde venga.
 *
 *   2. Cada conector DESCRIBE SU PROPIA CONFIGURACIÓN (`campos`). La pantalla
 *      de configuración no sabe qué es una carpeta de Drive ni un host de SFTP:
 *      pinta los campos que el conector declara. Sin esto, cada origen nuevo
 *      obligaría a tocar el formulario, que es justo lo que se quiere evitar.
 *
 *   3. La configuración va en `origen_config`, el único JSONB de la tabla. Un
 *      origen nuevo no necesita migración.
 *
 * LO QUE NINGÚN CONECTOR HACE: guardar contraseñas en `origen_config`. Ese
 * campo se lee y se escribe desde la pantalla y acaba en el navegador. Ese día
 * ya llegó, con el SFTP: la credencial va cifrada en su propia TABLA
 * (stock_origen_credenciales, migración 124) y se lee desde ./credenciales.ts.
 * Aquí, en `campos`, no hay ni un hueco donde quepa una contraseña — a
 * propósito: lo que un conector declara como campo acaba en origen_config.
 *
 * LO QUE SE AÑADIÓ PARA LOS EXPLORADORES (y por qué no rompe nada)
 * ---------------------------------------------------------------
 * Un conector puede declarar ahora dos cosas más, las dos OPCIONALES:
 *
 *   · `explorador` — «yo sé enseñar lo que hay dentro». La pantalla pinta el
 *     explorador si el conector lo declara, en vez de tener escrito a mano un
 *     `if (origen === 'drive')`, que es lo que había. Así el correo, que no
 *     navega carpetas, no arrastra una interfaz que no le sirve.
 *
 *   · `secreto` — «yo necesito una contraseña». La pantalla pinta el cajetín
 *     que la guarda contra la ruta que cifra, y NUNCA contra el PATCH genérico
 *     del formulario. El conector describe qué necesita; no lo guarda él.
 *
 * Un conector que no declare ninguna de las dos sigue funcionando exactamente
 * igual que antes.
 */

import type { StockProfileOrigin } from '@/lib/types/stock-sync'
import type { WorkbookInput } from '../engine'

/**
 * Un fichero traído de donde sea, listo para el lector.
 *
 * `bytes` es un WorkbookInput porque es exactamente lo que consumen leerStock()
 * y leerEan(): un ArrayBuffer de `fetch` o de `File.arrayBuffer()` entra sin
 * conversión.
 */
export interface FicheroOrigen {
  nombre: string
  bytes: WorkbookInput
  /** Identificador en el sistema de origen (el fileId de Drive), para volver a él */
  idExterno: string | null
  /**
   * CON QUÉ SE DECIDE QUE EL FICHERO ES NUEVO.
   *
   * Un md5 si el origen lo da, y si no la fecha de modificación. Es lo que evita
   * releer y reprocesar el mismo volcado cada quince minutos: sin esto el
   * historial se llena de ejecuciones idénticas y la única señal útil —«hoy el
   * fichero ha cambiado»— se pierde entre el ruido.
   */
  huella: string | null
  modificadoAt: string | null
  tamano: number
}

/** Un fichero que se ve en el origen, sin descargar. Para la pantalla y el diagnóstico */
export interface CandidatoOrigen {
  nombre: string
  idExterno: string | null
  modificadoAt: string | null
  tamano: number | null
  /** true si es el que se cogería al procesar */
  elegido: boolean
  /** Si no se coge, por qué: «no encaja con el patrón» */
  descarte: string | null
  /**
   * Si se coge y la elección NO era evidente, por qué se ha elegido este.
   *
   * Hoy solo lo rellena el SFTP cuando dos ficheros empatan en fecha —SFTP da la
   * fecha en segundos— y ha decidido el desempate por nombre. Es la mitad del
   * valor de esta lista: sin la frase, el explorador enseña una elección
   * correcta pero indistinguible de una arbitraria.
   */
  nota?: string | null
}

/** Lo que el conector necesita para trabajar */
export interface ContextoOrigen {
  /** El `origen_config` del perfil, tal cual */
  config: Record<string, unknown>
  /** Nombre del perfil; solo para redactar los mensajes de error */
  perfil: string
  /**
   * EL ID DEL PERFIL, que es la llave de su credencial cifrada.
   *
   * Es opcional en el tipo para no romper a quien ya construía un contexto sin
   * él, pero un conector que necesite contraseña (SFTP) NO PUEDE TRABAJAR SIN
   * ESTO: la credencial vive en stock_origen_credenciales con el id del perfil
   * como clave primaria, y sin el id no hay forma de encontrarla.
   *
   * POR QUÉ NO VIENE LA CONTRASEÑA YA RESUELTA EN EL CONTEXTO: porque el
   * contexto lo arman cuatro sitios distintos —el ciclo, el simulacro, la
   * prueba y las rutas del explorador— y en tres de ellos la contraseña no
   * pinta nada. Un campo con la contraseña dentro es un campo que acaba en un
   * `console.log(ctx)` de depuración tarde o temprano; es el mismo razonamiento
   * que hace que AmazonCredentials lleve el refresh token CIFRADO y lo descifre
   * solo quien lo va a usar, dentro de la llamada.
   */
  perfilId?: string | null
  /** Tope de tamaño, el mismo que el de las subidas a mano */
  maxBytes: number
  /**
   * El fichero que ya venía en la petición. Solo lo usa el conector 'manual':
   * los demás lo ignoran, y por eso es opcional.
   */
  subida?: { nombre: string; bytes: WorkbookInput; tamano: number } | null
  /**
   * La credencial que se acaba de teclear en la pantalla y todavía NO está
   * guardada. Solo la usan las rutas del explorador, para que se pueda probar
   * una contraseña antes de decidir guardarla.
   *
   * Nunca se rellena desde el ciclo automático: allí la credencial sale siempre
   * de la tabla cifrada.
   */
  secretoEnPantalla?: SecretoOrigen | null
}

/**
 * Una credencial en claro, y solo mientras dura la llamada.
 *
 * No se guarda en ningún sitio con esta forma: se cifra al escribir y se
 * descifra al usar. Su `toString` está pisado para que un `${}` accidental o un
 * console.log no la escupan: el sitio donde una contraseña de un cliente NO
 * puede acabar es un log.
 */
export class SecretoOrigen {
  readonly tipo: 'password' | 'clave_privada'
  readonly valor: string
  readonly passphrase: string | null

  constructor(tipo: 'password' | 'clave_privada', valor: string, passphrase?: string | null) {
    this.tipo = tipo
    this.valor = valor
    this.passphrase = passphrase && passphrase !== '' ? passphrase : null
  }

  toString(): string {
    return '«credencial oculta»'
  }

  toJSON(): string {
    return '«credencial oculta»'
  }
}

/** Resultado de comprobar un origen sin procesar nada */
export interface EstadoOrigen {
  ok: boolean
  /** En español y accionable. Si algo falla, dice QUÉ hacer */
  mensaje: string
  /** Lo que se ve ahora mismo en el origen, si el conector sabe mirarlo */
  candidatos: CandidatoOrigen[]
}

/** Cómo se pinta un campo de configuración del conector */
export interface CampoOrigen {
  clave: string
  etiqueta: string
  /**
   * 'opcion' pinta una botonera con `opciones` en vez de un cajetín: lo usa el
   * Drive para elegir DE QUIÉN es la carpeta, que es una decisión de dos
   * valores y escribirla a mano es escribirla mal.
   *
   * No hay tipo 'contraseña' A PROPÓSITO: todo lo que se declara como campo va
   * a parar a `origen_config`, que es texto plano y viaja al navegador. La
   * credencial se declara aparte, en `ConectorOrigen.secreto`.
   */
  tipo: 'texto' | 'booleano' | 'opcion'
  /** Debajo del campo, explicando la consecuencia de dejarlo mal */
  ayuda: string
  requerido: boolean
  ejemplo?: string
  /** Solo para tipo 'opcion'. La primera es la de fábrica */
  opciones?: { valor: string; etiqueta: string }[]
}

/**
 * Lo que el conector necesita que alguien teclee y que NO puede ir en
 * `origen_config`: la contraseña del SFTP del cliente.
 *
 * El conector solo lo DESCRIBE. Guardarlo es cosa de la ruta que cifra
 * (app/api/stock-sync/perfiles/[id]/credencial) y leerlo, de ./credenciales.ts.
 */
export interface SecretoDeclarado {
  etiqueta: string
  ayuda: string
  /** Qué formas admite. Si solo hay una, la pantalla no pregunta */
  tipos: { valor: 'password' | 'clave_privada'; etiqueta: string }[]
  /** true si una clave privada puede venir con frase de paso */
  admitePassphrase: boolean
}

/* ------------------------------------------------------------------ */
/* El explorador                                                       */
/* ------------------------------------------------------------------ */

/**
 * UNA CARPETA, UN BUZÓN O LO QUE HAGA DE CARPETA EN CADA ORIGEN.
 *
 * `ruta` es OPACA para la pantalla: la escribe el conector y la pantalla se
 * limita a devolvérsela para bajar un nivel. Así el explorador de Drive puede
 * meter dentro de qué identidad se está mirando ('propia:1A2B…') sin que la
 * pantalla tenga que saber que eso existe, y el de SFTP puede usar la ruta
 * absoluta de siempre ('/out/stock').
 */
export interface CarpetaOrigen {
  nombre: string
  ruta: string
  /** Cuántas cosas hay dentro, si el origen lo sabe sin entrar. Casi nunca */
  detalle?: string | null
}

/** Lo que se ve al mirar dentro de una carpeta, sin descargar nada */
export interface ListadoOrigen {
  /** Dónde estamos. La pantalla la devuelve tal cual al navegar */
  ruta: string
  /**
   * La miga de pan, del raíz al sitio actual. La construye el CONECTOR y no la
   * pantalla, porque en Drive subir un nivel cuesta una llamada a la API y en
   * SFTP es cortar por la última barra: no es la misma operación y no se puede
   * resolver en un sitio para los dos.
   */
  migas: { nombre: string; ruta: string }[]
  carpetas: CarpetaOrigen[]
  /** Los ficheros de esta carpeta, con el motivo de descarte ya calculado */
  ficheros: CandidatoOrigen[]
  /**
   * true si esta ruta se puede elegir como la carpeta del perfil. En Drive el
   * nivel raíz (la lista de unidades) no vale; dentro de una carpeta, sí.
   */
  seleccionable: boolean
  /**
   * Un aviso que la pantalla enseña arriba: «esta conexión no va cifrada»,
   * «estás mirando nuestro Drive, no lo que comparte el cliente»…
   */
  aviso?: string | null
}

/**
 * Un origen de ficheros.
 *
 * `construido: false` es un conector DECLARADO pero sin implementar: aparece en
 * la pantalla en gris y explica qué falta. Es mejor que esconderlo, porque la
 * pregunta «¿puedo recibirlo por SFTP?» se contesta mirando la pantalla en vez
 * de leyendo el código.
 */
export interface ConectorOrigen {
  id: StockProfileOrigin
  etiqueta: string
  /** Una frase: qué es y cuándo se usa */
  descripcion: string
  construido: boolean
  campos: CampoOrigen[]
  /**
   * «Sé enseñar lo que hay dentro». La pantalla pinta el explorador si esto
   * está, y qué palabra usa para lo que se navega.
   *
   * 'carpetas' — Drive y SFTP: se entra, se ve, se baja, se elige.
   * 'mensajes' — correo: no hay carpetas que bajar, hay una lista de correos
   *              que encajan con el filtro. Misma pantalla, sin migas.
   */
  explorador?: 'carpetas' | 'mensajes'
  /** «Necesito una contraseña». Ver SecretoDeclarado */
  secreto?: SecretoDeclarado
  /**
   * QUÉ CAMPOS DECIDEN A DÓNDE SE CONECTA ESTO. Solo importa si hay `secreto`.
   *
   * El explorador admite configuración tecleada en la pantalla y todavía no
   * guardada, porque el alta de un cliente es teclear y probar. Pero la
   * credencial que sale de la tabla cifrada es de un servidor CONCRETO, y
   * mandarla a otro sería entregar en claro una contraseña que el cliente nos
   * confió y que ni siquiera nosotros podemos volver a leer.
   *
   * Por eso el conector declara aquí sus campos de destino —en SFTP, el
   * servidor, el puerto y el usuario— y la ruta del explorador se niega a usar
   * la credencial guardada si alguno viene cambiado desde la pantalla. La
   * carpeta y el patrón no van en esta lista: no deciden a dónde viaja nada.
   */
  clavesDestino?: string[]
  /**
   * Qué campo de `campos` guarda la carpeta elegida en el explorador. Sin esto
   * la pantalla no sabría dónde escribir lo que el usuario acaba de pinchar.
   */
  campoRuta?: string
  /** Mira el origen sin descargar nada. Es lo que contesta el botón «Comprobar» */
  comprobar(ctx: ContextoOrigen): Promise<EstadoOrigen>
  /** Trae el fichero que toca procesar */
  traer(ctx: ContextoOrigen): Promise<FicheroOrigen>
  /**
   * Qué hay dentro de `ruta`. Solo lo implementan los que declaran `explorador`.
   *
   * SIEMPRE DE SOLO LECTURA: lista y descarga, nunca escribe, mueve ni borra.
   * Es una promesa que hay que sostener conector a conector, porque el fichero
   * que se está mirando es de un cliente que nos ha dado acceso para leerlo.
   */
  explorar?(ctx: ContextoOrigen, ruta: string): Promise<ListadoOrigen>
}

/**
 * Fallo de un origen, con una frase que se pueda leer.
 *
 * Se distingue de StockSyncError porque son problemas de naturaleza distinta:
 * un StockSyncError es «el fichero no encaja con el perfil» y se arregla
 * mirando el Excel; esto es «no llego al fichero» y se arregla en Drive, en el
 * servidor o llamando al cliente.
 */
export class OrigenError extends Error {
  /** El fallo se arregla compartiendo la carpeta o dando permisos, no tocando el ERP */
  readonly esDeAcceso: boolean

  constructor(message: string, options: { esDeAcceso?: boolean } = {}) {
    super(message)
    this.name = 'OrigenError'
    this.esDeAcceso = options.esDeAcceso ?? false
  }
}

/* ------------------------------------------------------------------ */
/* Utilidades que comparten los conectores                             */
/* ------------------------------------------------------------------ */

/** Texto de `origen_config`, recortado; '' si no está o no es texto */
export function textoConfig(config: Record<string, unknown>, clave: string): string {
  const v = config[clave]
  return typeof v === 'string' ? v.trim() : ''
}

/** Booleano de `origen_config`. Acepta el true de JSON y el 'true' de un formulario */
export function booleanoConfig(config: Record<string, unknown>, clave: string): boolean {
  const v = config[clave]
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return ['true', '1', 'si', 'sí', 'on'].includes(v.trim().toLowerCase())
  return false
}

/**
 * ¿Encaja este nombre de fichero con el patrón del perfil?
 *
 * El patrón se escribe como se escribe en cualquier explorador de archivos
 * («ARTICULOS_STOCK*.xlsx»), no como una expresión regular: lo va a teclear
 * quien da de alta al cliente mirando el nombre del fichero, no quien programó
 * esto. Solo `*` (cualquier cosa) y `?` (un carácter).
 *
 * Todo lo demás se ESCAPA antes de construir la expresión. Sin escapar, un
 * punto del nombre —que los hay siempre, por la extensión— valdría por
 * cualquier carácter, y «ARTICULOS.STOCK.xlsx» casaría con
 * «ARTICULOSxSTOCKyxlsx». Peor: un paréntesis suelto en el patrón, que aparece
 * en cuanto alguien pega «fichero (1).xlsx», reventaría el RegExp en tiempo de
 * ejecución.
 *
 * Sin patrón, todo encaja: es lo correcto para una carpeta en la que el cliente
 * solo deja un fichero.
 */
export function encajaPatron(nombre: string, patron: string): boolean {
  const p = patron.trim()
  if (!p) return true

  const regex = new RegExp(
    `^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*').replace(/\\\?/g, '.')}$`,
    // Sin distinguir mayúsculas: los ERP exportan «ARTICULOS_STOCK.XLSX» un día
    // y «Articulos_stock.xlsx» al siguiente, y eso no debería romper nada.
    'i'
  )
  return regex.test(nombre)
}

/**
 * Extensiones que el motor sabe abrir. Se comprueba en el conector para poder
 * descartar el PDF de la factura que alguien dejó en la misma carpeta ANTES de
 * bajarse dos megas y estrellar el lector con un mensaje incomprensible.
 */
export const EXTENSIONES = ['.xlsx', '.xls', '.csv']

export function extensionValida(nombre: string): boolean {
  const lower = nombre.toLowerCase()
  return EXTENSIONES.some((ext) => lower.endsWith(ext))
}
