/**
 * ORIGEN · FTPS EXPLÍCITO
 * =======================
 * SOLO SERVIDOR.
 *
 * El cliente deja el volcado en un FTP suyo y el ERP entra a leerlo. Igual que
 * el conector de SFTP, pero por el otro protocolo.
 *
 *
 * ============ FTPS NO ES FTP, Y ESA CONFUSIÓN ES TODO EL FICHERO ============
 *
 * Tres cosas con nombres parecidos y dos puertos:
 *
 *   SFTP · 22 · va dentro de SSH.        CIFRADO.
 *   FTPS · 21 · FTP que sube a TLS.      CIFRADO.  ← esto
 *   FTP  · 21 · a pelo.                  SIN CIFRAR.
 *
 * FTPS y FTP COMPARTEN PUERTO. El 21 por sí solo no dice cuál de los dos es: la
 * diferencia está en si el servidor acepta `AUTH TLS` nada más conectar. En el
 * modo explícito —el que usa todo el mundo— la sesión empieza en claro y lo
 * primero que se manda es esa orden; solo después viajan usuario y contraseña.
 *
 * AQUÍ ESO NO ES UNA PREFERENCIA, ES UN REQUISITO. `secure: true` hace que la
 * biblioteca corte si el servidor no acepta subir a TLS, ANTES de mandar
 * credenciales. Y no hay opción para desactivarlo: la contraseña que viaja no es
 * nuestra, es de un cliente que nos la ha confiado, y mandarla en claro por
 * internet no es una decisión que le corresponda tomar a esta pantalla.
 *
 * Por eso tampoco se acepta `secure: 'implicit'` (FTPS implícito, puerto 990):
 * está en desuso y ningún cliente lo ha pedido. El día que haga falta, es una
 * línea — pero con su propio campo, no adivinándolo por el puerto.
 *
 *
 * ============ POR QUÉ NO SE REUTILIZA EL FICHERO DE SFTP ============
 *
 * Porque solo se parecen por fuera. `ssh2-sftp-client` y `basic-ftp` no
 * comparten ni el objeto de conexión, ni la forma de listar, ni los códigos de
 * error, ni el modelo de sesión —FTP abre una conexión de datos aparte por cada
 * transferencia, y de ahí sale la mitad de los fallos raros de este protocolo—.
 * Un fichero con `if (esFtp)` por medio acabaría siendo dos conectores mal
 * pegados y ninguno de los dos se podría tocar sin miedo.
 *
 * Lo que SÍ se comparte es todo lo que no depende del protocolo: elegir el
 * fichero por patrón, clasificar candidatos, los mensajes. Eso vive en tipos.ts
 * y se importa igual que hace el de SFTP.
 */

import { Client as FtpClient, type FileInfo } from 'basic-ftp'
import { Writable } from 'node:stream'
import { leerCredencial } from './credenciales'
import {
  OrigenError,
  encajaPatron,
  extensionValida,
  textoConfig,
  type CandidatoOrigen,
  type ConectorOrigen,
  type ContextoOrigen,
  type EstadoOrigen,
  type FicheroOrigen,
  type ListadoOrigen,
  type SecretoOrigen,
} from './tipos'

/**
 * Cuánto se espera a que conteste el servidor del cliente.
 *
 * El mismo criterio que en SFTP: esto corre dentro del ciclo de quince minutos,
 * que reparte nueve entre TODOS los perfiles. Un servidor caído que se coma
 * medio minuto por intento deja sin pasada a los clientes que van detrás.
 */
const ESPERA_MS = 15_000
const ESPERA_DESCARGA_MS = 60_000

/** El de FTP y FTPS explícito. El 22 es de SFTP, que es otro conector */
const PUERTO_POR_OMISION = 21

interface ConfigFtps {
  host: string
  puerto: number
  usuario: string
  ruta: string
  patron: string
}

function leerConfig(ctx: ContextoOrigen): ConfigFtps {
  const puertoTexto = textoConfig(ctx.config, 'puerto')
  const puerto = Number(puertoTexto)
  return {
    host: textoConfig(ctx.config, 'host'),
    puerto: Number.isFinite(puerto) && puerto > 0 ? puerto : PUERTO_POR_OMISION,
    usuario: textoConfig(ctx.config, 'usuario'),
    ruta: textoConfig(ctx.config, 'ruta'),
    patron: textoConfig(ctx.config, 'patron'),
  }
}

function queFalta(cfg: ConfigFtps): string | null {
  if (!cfg.host) return 'Falta el servidor.'
  if (!cfg.usuario) return 'Falta el usuario.'
  if (!cfg.ruta) return 'Falta la carpeta del servidor.'
  return null
}

async function resolverSecreto(ctx: ContextoOrigen): Promise<SecretoOrigen | null> {
  // La que se acaba de teclear manda sobre la guardada: es lo que permite
  // corregir una contraseña equivocada y probarla antes de guardarla.
  if (ctx.secretoEnPantalla) return ctx.secretoEnPantalla
  if (!ctx.perfilId) return null
  return await leerCredencial(ctx.perfilId)
}

/* ------------------------------------------------------------------ */
/* Conexión                                                            */
/* ------------------------------------------------------------------ */

/**
 * Abre la sesión, EXIGIENDO TLS.
 *
 * `secure: true` es el modo explícito: conecta en claro y manda `AUTH TLS` antes
 * que nada. Si el servidor no lo acepta, la biblioteca lanza y NO llega a mandar
 * la contraseña — que es justo la garantía que se quiere.
 */
async function conectar(
  cliente: FtpClient,
  cfg: ConfigFtps,
  secreto: SecretoOrigen
): Promise<void> {
  if (secreto.tipo !== 'password') {
    throw new OrigenError(
      'Este servidor está configurado con una clave privada, y FTPS no usa claves privadas: ' +
        'se entra con usuario y contraseña. Si el cliente te ha dado una clave privada, lo que ' +
        'tiene es SFTP y hay que configurarlo como tal.'
    )
  }

  cliente.ftp.verbose = false
  // El tope propio del cliente, además del nuestro: sin él, un servidor que
  // acepta el TCP y se queda callado deja la promesa colgada para siempre.
  cliente.ftp.socket.setTimeout(ESPERA_MS)

  await cliente.access({
    host: cfg.host,
    port: cfg.puerto,
    user: cfg.usuario,
    password: secreto.valor,
    // Ver la cabecera: no es opcional y no hay interruptor para quitarlo.
    secure: true,
    secureOptions: {
      /**
       * SE VALIDA EL CERTIFICADO, y esto merece una nota porque es donde casi
       * todo el mundo pone `rejectUnauthorized: false` y se queda tan ancho.
       *
       * Aceptar cualquier certificado convierte el cifrado en decoración: quien
       * se pueda poner en medio presenta el suyo, la contraseña del cliente pasa
       * por sus manos y nadie se entera. Si un servidor de un cliente tiene el
       * certificado caducado o autofirmado, el error se ve en pantalla y se le
       * dice —que es lo que hay que hacer— en vez de taparlo aquí para siempre.
       */
      rejectUnauthorized: true,
      servername: cfg.host,
    },
  })
}

/** Un tope propio, porque `basic-ftp` no lo aplica a todas las operaciones */
async function conTope<T>(tarea: Promise<T>, ms: number, queHacia: string): Promise<T> {
  let reloj: NodeJS.Timeout | null = null
  try {
    return await Promise.race([
      tarea,
      new Promise<never>((_, rechazar) => {
        reloj = setTimeout(
          () =>
            rechazar(
              new OrigenError(
                `El servidor ha aceptado la conexión pero no contesta al ${queHacia} ` +
                  `(${Math.round(ms / 1000)} segundos esperando). En FTP esto suele ser el modo pasivo: ` +
                  'el servidor abre un puerto de datos aparte y un cortafuegos lo bloquea. ' +
                  'Díselo al cliente con esas palabras.'
              )
            ),
          ms
        )
      }),
    ])
  } finally {
    if (reloj) clearTimeout(reloj)
  }
}

function cerrar(cliente: FtpClient): void {
  try {
    cliente.close()
  } catch {
    // Cerrar es cortesía: si la sesión ya estaba rota, no hay nada que hacer y
    // desde luego no se puede tapar el error de verdad con el del cierre.
  }
}

/* ------------------------------------------------------------------ */
/* Elegir fichero                                                      */
/* ------------------------------------------------------------------ */

function esFichero(e: FileInfo): boolean {
  return e.isFile
}

function fechaDe(e: FileInfo): number {
  return e.modifiedAt ? e.modifiedAt.getTime() : 0
}

/**
 * Cuál se cogería y por qué se descartan los demás.
 *
 * Mismo criterio que el de SFTP, incluido el desempate: FTP da la fecha con
 * granularidad de minuto —a veces solo día y hora— así que dos volcados del
 * mismo rato empatan, y sin desempate estable la elección cambiaría entre
 * pasadas sin que nada hubiera cambiado en el servidor.
 */
function clasificar(
  entradas: FileInfo[],
  patron: string
): { elegido: FileInfo | null; candidatos: CandidatoOrigen[] } {
  const ficheros = entradas.filter(esFichero).sort((a, b) => {
    const d = fechaDe(b) - fechaDe(a)
    return d !== 0 ? d : b.name.localeCompare(a.name, 'es')
  })

  const validos = ficheros.filter((f) =>
    patron ? encajaPatron(f.name, patron) : extensionValida(f.name)
  )
  const elegido = validos[0] ?? null
  const empata =
    elegido && validos.length > 1 && fechaDe(validos[1]) === fechaDe(elegido) ? validos[1] : null

  const candidatos: CandidatoOrigen[] = ficheros.map((f) => ({
    nombre: f.name,
    idExterno: null,
    modificadoAt: f.modifiedAt ? f.modifiedAt.toISOString() : null,
    tamano: f.size,
    elegido: elegido !== null && f.name === elegido.name,
    descarte:
      elegido !== null && f.name === elegido.name
        ? null
        : patron
          ? encajaPatron(f.name, patron)
            ? 'Encaja con el patrón, pero hay otro más reciente.'
            : `No encaja con el patrón «${patron}».`
          : extensionValida(f.name)
            ? 'Se sabe leer, pero hay otro más reciente.'
            : 'No es .xlsx, .xls ni .csv.',
    nota:
      empata && elegido && f.name === elegido.name
        ? `Empata en fecha con «${empata.name}»: FTP no da los segundos, así que se ha desempatado por nombre.`
        : null,
  }))

  return { elegido, candidatos }
}

function unir(carpeta: string, nombre: string): string {
  if (!carpeta || carpeta === '/') return `/${nombre}`
  return `${carpeta.replace(/\/+$/, '')}/${nombre}`
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}

/* ------------------------------------------------------------------ */
/* Errores                                                             */
/* ------------------------------------------------------------------ */

/**
 * Traduce lo que sale de `basic-ftp` a algo que diga qué hacer.
 *
 * Los códigos son los del propio protocolo FTP, que llevan ahí desde 1985 y no
 * han cambiado: 530 es «no te dejo entrar», 550 «no existe o no tienes permiso».
 */
function traducir(error: unknown, cfg: ConfigFtps): OrigenError {
  if (error instanceof OrigenError) return error

  const codigo = (error as { code?: unknown })?.code
  const bruto = error instanceof Error ? error.message : String(error)

  if (codigo === 530 || /530/.test(bruto)) {
    return new OrigenError(
      `El servidor ${cfg.host} rechaza el usuario «${cfg.usuario}» o su contraseña (530). ` +
        'Comprueba las dos cosas con el cliente: en FTP el usuario suele llevar el dominio entero.',
      { esDeAcceso: true }
    )
  }
  if (codigo === 550 || /550/.test(bruto)) {
    return new OrigenError(
      `El servidor contesta que «${cfg.ruta}» no existe o que este usuario no puede entrar ahí (550). ` +
        'Usa el explorador de abajo para ver a qué carpetas llega de verdad.'
    )
  }
  if (/AUTH TLS|SSL|TLS|secure/i.test(bruto)) {
    return new OrigenError(
      `El servidor ${cfg.host} no acepta cifrar la conexión (FTPS explícito), o su certificado no es ` +
        'válido. El ERP no manda la contraseña de un cliente por una conexión sin cifrar, así que hay ' +
        'que pedirle al cliente que habilite FTPS —o que dé un SFTP, que también vale—.',
      { esDeAcceso: true }
    )
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(bruto)) {
    return new OrigenError(
      `No existe ningún servidor llamado «${cfg.host}». Revisa que esté bien escrito y sin «ftp://» delante.`
    )
  }
  if (/ECONNREFUSED/i.test(bruto)) {
    return new OrigenError(
      `El servidor ${cfg.host} rechaza la conexión en el puerto ${cfg.puerto}. ` +
        'Pregúntale al cliente qué puerto usa su FTP: el habitual es el 21.'
    )
  }
  if (/ETIMEDOUT|timeout/i.test(bruto)) {
    return new OrigenError(
      `El servidor ${cfg.host}:${cfg.puerto} no contesta. En FTP suele ser el modo pasivo bloqueado ` +
        'por un cortafuegos, o que el servidor solo admite conexiones desde ciertas IP — en ese caso ' +
        'hay que darle al cliente la del servidor del ERP.'
    )
  }
  return new OrigenError(`El servidor de ${cfg.host} ha fallado: ${bruto}`)
}

/* ------------------------------------------------------------------ */
/* El conector                                                         */
/* ------------------------------------------------------------------ */

export const conectorFtps: ConectorOrigen = {
  id: 'ftps',
  etiqueta: 'FTPS',
  descripcion:
    'El cliente deja el volcado en un FTP suyo con cifrado (FTPS explícito, normalmente el puerto 21) y el ERP entra a leerlo. Se coge el más reciente que encaje con el patrón.',
  construido: true,
  explorador: 'carpetas',
  campoRuta: 'ruta',

  /** La contraseña guardada vale solo contra ESTE servidor, puerto y usuario */
  clavesDestino: ['host', 'puerto', 'usuario'],

  secreto: {
    etiqueta: 'Contraseña',
    ayuda:
      'Se guarda cifrada (AES-256, la misma protección que los tokens de Amazon) y no vuelve a salir de ahí: ni a esta pantalla, ni a un registro, ni a un mensaje de error. Va atada a ESTE servidor, puerto y usuario: si cambias alguno de los tres se borra y hay que escribir la del servidor nuevo.',
    tipos: [{ valor: 'password', etiqueta: 'Contraseña' }],
    admitePassphrase: false,
  },

  campos: [
    {
      clave: 'host',
      etiqueta: 'Servidor',
      tipo: 'texto',
      requerido: true,
      ayuda: 'El nombre o la IP del servidor FTP del cliente. Sin «ftp://» delante.',
      ejemplo: 'ftp.cliente.com',
    },
    {
      clave: 'puerto',
      etiqueta: 'Puerto',
      tipo: 'texto',
      requerido: false,
      ayuda:
        'Vacío = 21, que es el de FTPS explícito y el que da casi todo el mundo. Si el cliente dice 22, eso es SFTP y va en el otro conector.',
      ejemplo: '21',
    },
    {
      clave: 'usuario',
      etiqueta: 'Usuario',
      tipo: 'texto',
      requerido: true,
      ayuda:
        'Solo el usuario; en FTP suele llevar el dominio entero. La contraseña va en el cajetín de abajo, que la guarda cifrada.',
      ejemplo: 'cliente@sudominio.com',
    },
    {
      clave: 'ruta',
      etiqueta: 'Carpeta',
      tipo: 'texto',
      requerido: true,
      ayuda:
        'Carpeta del servidor donde el cliente deja el fichero. Se rellena sola al elegirla en el explorador de aquí abajo.',
      ejemplo: '/out/stock',
    },
    {
      clave: 'patron',
      etiqueta: 'Patrón del nombre',
      tipo: 'texto',
      requerido: false,
      ayuda:
        'El fichero suele cambiar de nombre cada día. «STOCK_*.csv» coge el más reciente que empiece por STOCK_. Vale * y ?; no distingue mayúsculas. Vacío = el más reciente de la carpeta, se llame como se llame.',
      ejemplo: 'STOCK_*.csv',
    },
  ],

  /* ---------------- ¿Llegamos? ---------------- */

  async comprobar(ctx: ContextoOrigen): Promise<EstadoOrigen> {
    const cfg = leerConfig(ctx)
    const falta = queFalta(cfg)
    if (falta) return { ok: false, mensaje: falta, candidatos: [] }

    let secreto: SecretoOrigen | null = null
    try {
      secreto = await resolverSecreto(ctx)
    } catch (error) {
      return { ok: false, mensaje: traducir(error, cfg).message, candidatos: [] }
    }
    if (!secreto) {
      return {
        ok: false,
        mensaje:
          'Falta la contraseña de este servidor. Escríbela en el cajetín de arriba: se guarda cifrada.',
        candidatos: [],
      }
    }

    const cliente = new FtpClient(ESPERA_MS)
    try {
      await conectar(cliente, cfg, secreto)
      const entradas = await conTope(cliente.list(cfg.ruta), ESPERA_MS, 'listar la carpeta')
      const { elegido, candidatos } = clasificar(entradas, cfg.patron)
      const ficheros = entradas.filter(esFichero)

      if (ficheros.length === 0) {
        return {
          ok: false,
          mensaje:
            `Se entra en el servidor con cifrado y se lee «${cfg.ruta}», pero ahí dentro no hay ningún fichero` +
            (entradas.length > 0 ? ', solo carpetas.' : ' (la carpeta está vacía).') +
            ' Usa el explorador de abajo para buscar la carpeta correcta.',
          candidatos,
        }
      }
      if (!elegido) {
        return {
          ok: false,
          mensaje:
            `Se entra sin problemas y hay ${ficheros.length} ${ficheros.length === 1 ? 'fichero' : 'ficheros'} en «${cfg.ruta}», pero ninguno encaja` +
            (cfg.patron
              ? ` con el patrón «${cfg.patron}»`
              : ' con las extensiones que se saben leer (.xlsx, .xls, .csv)') +
            '. Abajo está la lista con el motivo de cada uno.',
          candidatos,
        }
      }

      return {
        ok: true,
        mensaje:
          `Se entra en el servidor con cifrado (FTPS) y se lee «${cfg.ruta}». Ahora mismo se procesaría «${elegido.name}»` +
          (cfg.patron
            ? `, que es el más reciente de los que encajan con «${cfg.patron}».`
            : ', que es el más reciente de la carpeta.'),
        candidatos,
      }
    } catch (error) {
      return { ok: false, mensaje: traducir(error, cfg).message, candidatos: [] }
    } finally {
      cerrar(cliente)
    }
  },

  /* ---------------- Traer el fichero ---------------- */

  async traer(ctx: ContextoOrigen): Promise<FicheroOrigen> {
    const cfg = leerConfig(ctx)
    const falta = queFalta(cfg)
    if (falta) {
      throw new OrigenError(
        `El perfil «${ctx.perfil}» lee por FTPS y ${falta.charAt(0).toLowerCase()}${falta.slice(1)}`
      )
    }

    const secreto = await resolverSecreto(ctx)
    if (!secreto) {
      throw new OrigenError(
        `El perfil «${ctx.perfil}» lee por FTPS y no tiene guardada la contraseña del servidor. ` +
          'Escríbela en la configuración del perfil: se guarda cifrada.'
      )
    }

    const cliente = new FtpClient(ESPERA_MS)
    try {
      await conectar(cliente, cfg, secreto)

      const entradas = await conTope(cliente.list(cfg.ruta), ESPERA_MS, 'listar la carpeta')
      const { elegido } = clasificar(entradas, cfg.patron)

      if (!elegido) {
        const ficheros = entradas.filter(esFichero)
        throw new OrigenError(
          ficheros.length === 0
            ? `En «${cfg.ruta}» del servidor ${cfg.host} no hay ningún fichero. ` +
              'O el cliente todavía no ha dejado el volcado de hoy, o la carpeta configurada no es la suya.'
            : `En «${cfg.ruta}» hay ${ficheros.length} ficheros pero ninguno encaja` +
              (cfg.patron
                ? ` con el patrón «${cfg.patron}»`
                : ' con las extensiones .xlsx, .xls o .csv') +
              `. El más reciente se llama «${ficheros[0]?.name ?? '?'}».`
        )
      }

      // El tamaño se mira ANTES de descargar. Traerse 300 MB para descartarlos
      // después se come la memoria del contenedor, que es la del ERP entero.
      if (elegido.size > ctx.maxBytes) {
        throw new OrigenError(
          `El fichero «${elegido.name}» ocupa ${mb(elegido.size)} MB y el máximo son ${mb(ctx.maxBytes)} MB.`
        )
      }

      /**
       * Se descarga a MEMORIA con un stream de escritura propio.
       *
       * `basic-ftp` solo sabe escribir a un stream o a un fichero, y en este
       * contenedor no hay disco donde dejar nada. El tope se comprueba mientras
       * llega: un servidor que anuncia 2 MB y manda 400 no puede llenar la
       * memoria del proceso solo porque el listado mintiera.
       */
      const trozos: Buffer[] = []
      let recibidos = 0
      let excedido = false

      const destino = new Writable({
        write(trozo: Buffer, _codificacion, siguiente) {
          recibidos += trozo.byteLength
          if (recibidos > ctx.maxBytes) {
            excedido = true
            siguiente(new Error('tope de tamaño superado'))
            return
          }
          trozos.push(trozo)
          siguiente()
        },
      })

      try {
        await conTope(
          cliente.downloadTo(destino, unir(cfg.ruta, elegido.name)),
          ESPERA_DESCARGA_MS,
          'descargar el fichero'
        )
      } catch (error) {
        if (excedido) {
          throw new OrigenError(
            `El fichero «${elegido.name}» pasa de ${mb(ctx.maxBytes)} MB mientras se descargaba, ` +
              'así que se ha cortado. El listado del servidor decía otro tamaño.'
          )
        }
        throw error
      }

      const bytes = Buffer.concat(trozos)

      if (bytes.byteLength === 0) {
        throw new OrigenError(
          `El fichero «${elegido.name}» está vacío en el servidor (0 bytes). ` +
            'Suele ser que el ERP del cliente lo estaba escribiendo justo cuando hemos entrado: ' +
            'se volverá a intentar en el siguiente ciclo.'
        )
      }

      return {
        nombre: elegido.name,
        // Un Buffer ES un Uint8Array. Se envuelve y no se pasa `.buffer`: un
        // Buffer puede ser una ventana sobre un bloque mayor y `.buffer` traería
        // basura de alrededor.
        bytes: new Uint8Array(bytes),
        idExterno: unir(cfg.ruta, elegido.name),
        /**
         * FTP no da checksum, así que la huella es nombre + fecha + tamaño.
         *
         * El NOMBRE dentro es lo que hace que funcione con el caso real: el
         * fichero se llama STOCK_2026-08-11.csv y mañana STOCK_2026-08-12.csv,
         * así que aunque el servidor conservara la fecha, el nombre cambia y el
         * volcado nuevo se procesa.
         *
         * Y es solo el primer filtro: proceso.ts calcula además el sha256 del
         * CONTENIDO, que es el que decide de verdad si hay algo que mandar.
         */
        huella: `${elegido.name}|${elegido.modifiedAt?.toISOString() ?? '?'}|${elegido.size}`,
        modificadoAt: elegido.modifiedAt ? elegido.modifiedAt.toISOString() : null,
        tamano: bytes.byteLength,
      }
    } catch (error) {
      throw traducir(error, cfg)
    } finally {
      cerrar(cliente)
    }
  },

  /* ---------------- Navegar ---------------- */

  async explorar(ctx: ContextoOrigen, ruta: string): Promise<ListadoOrigen> {
    const cfg = leerConfig(ctx)

    if (!cfg.host) throw new OrigenError('Falta el servidor. Escríbelo arriba y vuelve a probar.')
    if (!cfg.usuario) throw new OrigenError('Falta el usuario. Escríbelo arriba y vuelve a probar.')

    const secreto = await resolverSecreto(ctx)
    if (!secreto) {
      throw new OrigenError(
        'Falta la contraseña de este servidor. Escríbela arriba: se guarda cifrada y no vuelve a ' +
          'salir. También puedes escribirla y pulsar «Conectar» sin guardarla todavía.'
      )
    }

    const cliente = new FtpClient(ESPERA_MS)
    try {
      await conectar(cliente, cfg, secreto)

      /**
       * Sin ruta, donde el servidor deje a este usuario.
       *
       * `pwd()` y no '/': muchas cuentas de FTP están enjauladas y su '/' es la
       * raíz de la jaula, pero otras dejan al usuario en /home/loquesea y '/' es
       * la raíz del servidor entero, con cien carpetas que no pintan nada.
       */
      const actual = ruta && ruta !== '' ? ruta : await conTope(cliente.pwd(), ESPERA_MS, 'entrar')
      const entradas = await conTope(cliente.list(actual), ESPERA_MS, 'listar la carpeta')
      const { candidatos } = clasificar(entradas, cfg.patron)

      const carpetas = entradas
        .filter((e) => e.isDirectory || e.isSymbolicLink)
        .filter((e) => e.name !== '.' && e.name !== '..')
        .sort((a, b) => a.name.localeCompare(b.name, 'es'))
        .map((e) => ({ nombre: e.name, ruta: unir(actual, e.name) }))

      return {
        ruta: actual,
        migas: migasDe(actual),
        carpetas,
        ficheros: candidatos,
        seleccionable: true,
        aviso: null,
      }
    } catch (error) {
      throw traducir(error, cfg)
    } finally {
      cerrar(cliente)
    }
  },
}

/** La miga de pan. En FTP es cortar por las barras, igual que en SFTP */
function migasDe(ruta: string): { nombre: string; ruta: string }[] {
  const partes = ruta.split('/').filter((p) => p !== '')
  const migas = [{ nombre: '/', ruta: '/' }]
  let acumulado = ''
  for (const parte of partes) {
    acumulado += `/${parte}`
    migas.push({ nombre: parte, ruta: acumulado })
  }
  return migas
}
