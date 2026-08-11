/**
 * ORIGEN «SFTP DEL CLIENTE».
 *
 * El cliente nos da un usuario en su servidor y deja ahí el volcado que saca su
 * ERP. Cada cierto tiempo se entra, se mira la carpeta, se coge EL MÁS RECIENTE
 * QUE ENCAJE CON EL PATRÓN y, si no es el mismo que la vez anterior, se procesa.
 *
 * SOLO LECTURA, Y ESO ESTÁ ATADO EN LOS TIPOS. El cliente declarado en
 * ./ssh2-sftp-client.d.ts solo tiene `list`, `get`, `realPath` y `end`: `put`,
 * `delete` y `rename` no existen para este módulo, así que borrar el fichero del
 * cliente por accidente no es un descuido que se pueda cometer, es un error de
 * compilación.
 *
 *
 * POR QUÉ SFTP Y NO FTP
 * ---------------------
 * El FTP clásico manda el usuario y la contraseña EN CLARO por la red, y encima
 * la contraseña de un servidor que no es nuestro. SFTP va dentro de SSH, o sea
 * cifrado de punta a punta. Si algún cliente solo puede dar FTP, esto no le
 * sirve —y la pantalla lo dice, con el motivo, en vez de fallar con un tiempo de
 * espera agotado que parece un problema de red.
 *
 *
 * EL PATRÓN ES LA MITAD DEL TRABAJO
 * ---------------------------------
 * En Drive el cliente suele dejar siempre el mismo fichero. En un SFTP casi
 * nunca: el ERP escupe STOCK_2026-08-09.csv y mañana STOCK_2026-08-10.csv. Por
 * eso el explorador enseña DOS cosas a la vez: lo que hay hoy en la carpeta, y
 * cuál de todos se cogería con el patrón que está escrito ahora mismo. Sin esa
 * segunda mitad, el patrón se configura a ciegas y el fallo aparece mañana.
 *
 *
 * LA CONTRASEÑA
 * -------------
 * No está en `origen_config` —ese campo viaja al navegador— sino cifrada en
 * stock_origen_credenciales (migración 124). Aquí solo se pide con
 * leerCredencial() y se usa dentro de la llamada; y TODO error que salga de este
 * fichero pasa antes por tacharSecreto(), porque ssh2 mete el contenido de la
 * clave privada dentro del mensaje de algunos errores de autenticación.
 */

import SftpClient, { type FileInfo } from 'ssh2-sftp-client'
import { leerCredencial, tacharSecreto } from './credenciales'
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
 * Cuánto se espera a que el servidor del cliente conteste.
 *
 * 15 segundos y no los 20 que trae ssh2 por omisión: esto corre dentro del
 * ciclo de quince minutos, que tiene un presupuesto de 9 (PRESUPUESTO_MS en
 * ciclo.ts) para TODOS los perfiles. Un servidor caído que se coma veinte
 * segundos por intento deja sin pasada a los clientes que van detrás.
 */
const ESPERA_MS = 15_000

/**
 * Cuánto se espera a que termine la DESCARGA, que es harina de otro costal.
 *
 * Listar una carpeta es una respuesta corta; traerse el volcado de stock de un
 * cliente son megas por una línea que puede ser mala. 60 segundos deja pasar una
 * descarga lenta de verdad y sigue cabiendo en el presupuesto de 9 minutos del
 * ciclo.
 */
const ESPERA_DESCARGA_MS = 60_000

/**
 * Un tope para CADA operación, no solo para el saludo.
 *
 * `readyTimeout` de ssh2 cubre únicamente el handshake. Ni `list()` ni `get()`
 * ni `realPath()` tienen tiempo máximo propio, así que un servidor que autentica
 * bien y luego se calla —un cortafuegos con estado que se come los paquetes, un
 * servidor saturado— deja la promesa sin resolver PARA SIEMPRE.
 *
 * Y el daño no se queda en ese perfil. El candado `enMarcha` de ciclo.ts solo
 * vuelve a false en un `finally` que con una promesa que nunca resuelve no se
 * ejecuta nunca: el contenedor se queda creyendo que hay un ciclo en marcha y
 * DEJA DE PROCESARSE EL STOCK DE TODOS LOS CLIENTES hasta que alguien reinicie.
 * Sin un solo error, además, porque las pasadas siguientes contestan «ya había
 * un ciclo en marcha», que es un mensaje informativo.
 *
 * Por eso el tope va aquí, en la operación, y no solo en quien la llama.
 */
async function conTope<T>(faena: Promise<T>, ms: number, queHacia: string): Promise<T> {
  let reloj: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      faena,
      new Promise<never>((_, rechazar) => {
        reloj = setTimeout(
          () =>
            rechazar(
              new OrigenError(
                `El servidor ha aceptado la conexión pero no contesta al ${queHacia} ` +
                  `(${Math.round(ms / 1000)} segundos esperando). Suele ser un cortafuegos que corta la ` +
                  'sesión a medias o el servidor saturado. Vuelve a intentarlo y, si sigue, díselo al cliente.'
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

/** Puerto de SFTP. El 21 es el del FTP viejo y es la confusión de siempre */
const PUERTO_POR_OMISION = 22

export const conectorSftp: ConectorOrigen = {
  id: 'sftp',
  etiqueta: 'SFTP',
  descripcion:
    'El cliente deja el volcado en un servidor SFTP suyo y el ERP entra a leerlo cada cierto tiempo. Se coge el más reciente que encaje con el patrón.',
  construido: true,
  explorador: 'carpetas',
  campoRuta: 'ruta',

  /**
   * A dónde se conecta esto. Ver ConectorOrigen.clavesDestino: la contraseña
   * guardada de este perfil solo se usa contra ESTE servidor, ESTE puerto y
   * ESTE usuario. Cambiar cualquiera de los tres en la pantalla obliga a
   * teclear la contraseña del servidor nuevo.
   */
  clavesDestino: ['host', 'puerto', 'usuario'],

  secreto: {
    etiqueta: 'Contraseña o clave privada',
    ayuda:
      'Se guarda cifrada (AES-256, la misma protección que los tokens de Amazon) y no vuelve a salir de ahí: ni a esta pantalla, ni a un registro, ni a un mensaje de error. Va atada a ESTE servidor, puerto y usuario: si cambias alguno de los tres se borra y hay que escribir la del servidor nuevo.',
    tipos: [
      { valor: 'password', etiqueta: 'Contraseña' },
      { valor: 'clave_privada', etiqueta: 'Clave privada' },
    ],
    admitePassphrase: true,
  },

  campos: [
    {
      clave: 'host',
      etiqueta: 'Servidor',
      tipo: 'texto',
      requerido: true,
      ayuda: 'El nombre o la IP del servidor SFTP del cliente. Sin «sftp://» delante.',
      ejemplo: 'sftp.cliente.com',
    },
    {
      clave: 'puerto',
      etiqueta: 'Puerto',
      tipo: 'texto',
      requerido: false,
      ayuda:
        'Vacío = 22, que es el de SFTP. Si el cliente dice 21, eso es FTP a secas y no vale: manda la contraseña sin cifrar.',
      ejemplo: '22',
    },
    {
      clave: 'usuario',
      etiqueta: 'Usuario',
      tipo: 'texto',
      requerido: true,
      ayuda:
        'Solo el usuario. La contraseña va en el cajetín de abajo, que la guarda cifrada; aquí no cabe.',
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
        'Lo importante en un SFTP: el fichero cambia de nombre cada día. «STOCK_*.csv» coge el más reciente que empiece por STOCK_. Vale * y ?; no distingue mayúsculas. Vacío = el más reciente de la carpeta, se llame como se llame.',
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
      return { ok: false, mensaje: mensajeDe(error, null), candidatos: [] }
    }
    if (!secreto) {
      return {
        ok: false,
        mensaje:
          'Falta la contraseña (o la clave privada) de este servidor. Escríbela en el cajetín de arriba: se guarda cifrada.',
        candidatos: [],
      }
    }

    const cliente = new SftpClient(`ls-${cfg.host}`)
    try {
      await conectar(cliente, cfg, secreto)
      const entradas = await conTope(cliente.list(cfg.ruta), ESPERA_MS, 'listar la carpeta')
      const { elegido, candidatos } = clasificar(entradas, cfg.patron)

      const ficheros = entradas.filter(esFichero)

      if (ficheros.length === 0) {
        return {
          ok: false,
          mensaje:
            `Se entra en el servidor y se lee «${cfg.ruta}», pero ahí dentro no hay ningún fichero` +
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
          `Se entra en el servidor y se lee «${cfg.ruta}». Ahora mismo se procesaría «${elegido.name}»` +
          (cfg.patron
            ? `, que es el más reciente de los que encajan con «${cfg.patron}».`
            : ', que es el más reciente de la carpeta.'),
        candidatos,
      }
    } catch (error) {
      return { ok: false, mensaje: mensajeDe(error, secreto, cfg), candidatos: [] }
    } finally {
      await cerrar(cliente)
    }
  },

  /* ---------------- Traer el fichero ---------------- */

  async traer(ctx: ContextoOrigen): Promise<FicheroOrigen> {
    const cfg = leerConfig(ctx)
    const falta = queFalta(cfg)
    if (falta) throw new OrigenError(`El perfil «${ctx.perfil}» lee por SFTP y ${minuscula(falta)}`)

    const secreto = await resolverSecreto(ctx)
    if (!secreto) {
      throw new OrigenError(
        `El perfil «${ctx.perfil}» lee por SFTP y no tiene guardada la contraseña del servidor. ` +
          'Escríbela en la configuración del perfil: se guarda cifrada.'
      )
    }

    const cliente = new SftpClient(`ls-${cfg.host}`)
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
              (cfg.patron ? ` con el patrón «${cfg.patron}»` : ' con las extensiones .xlsx, .xls o .csv') +
              `. El más reciente se llama «${ficheros[0]?.name ?? '?'}».`
        )
      }

      // El tamaño se mira ANTES de descargar: traerse 300 MB para descartarlos
      // después se come la memoria del contenedor, que es la misma que usa el
      // resto del ERP. Es la misma cautela que el conector de Drive.
      if (elegido.size > ctx.maxBytes) {
        throw new OrigenError(
          `El fichero «${elegido.name}» ocupa ${mb(elegido.size)} MB y el máximo son ${mb(ctx.maxBytes)} MB.`
        )
      }

      const buffer = await conTope(
        cliente.get(unir(cfg.ruta, elegido.name)),
        ESPERA_DESCARGA_MS,
        'descargar el fichero'
      )

      if (buffer.byteLength === 0) {
        throw new OrigenError(
          `El fichero «${elegido.name}» está vacío en el servidor (0 bytes). ` +
            'Suele ser que el ERP del cliente lo estaba escribiendo justo cuando hemos entrado: ' +
            'se volverá a intentar en el siguiente ciclo.'
        )
      }
      if (buffer.byteLength > ctx.maxBytes) {
        throw new OrigenError(
          `El fichero «${elegido.name}» ocupa ${mb(buffer.byteLength)} MB y el máximo son ${mb(ctx.maxBytes)} MB.`
        )
      }

      return {
        nombre: elegido.name,
        // Un Buffer ES un Uint8Array, que es lo que el lector consume. Se pasa
        // tal cual y no `buffer.buffer`: un Buffer de Node puede ser una VENTANA
        // sobre un bloque más grande, y quedarse con `.buffer` traería basura de
        // alrededor.
        bytes: new Uint8Array(buffer),
        idExterno: unir(cfg.ruta, elegido.name),
        /**
         * SFTP no da checksum, así que la huella es nombre + fecha + tamaño.
         *
         * El NOMBRE va dentro a propósito y es lo que hace que esto funcione con
         * el caso real: el fichero se llama STOCK_2026-08-09.csv y mañana
         * STOCK_2026-08-10.csv, así que aunque el ERP del cliente conservara la
         * fecha de modificación, el nombre cambia y el volcado nuevo se procesa.
         *
         * Y de todas formas esta huella es solo el primer filtro: proceso.ts
         * calcula además el sha256 del CONTENIDO, que es el que de verdad decide
         * si hay algo nuevo que mandar.
         */
        huella: `${elegido.name}|${elegido.modifyTime}|${elegido.size}`,
        modificadoAt: fechaIso(elegido.modifyTime),
        tamano: buffer.byteLength,
      }
    } catch (error) {
      throw traducir(error, secreto, cfg)
    } finally {
      await cerrar(cliente)
    }
  },

  /* ---------------- Navegar ---------------- */

  async explorar(ctx: ContextoOrigen, ruta: string): Promise<ListadoOrigen> {
    const cfg = leerConfig(ctx)

    if (!cfg.host) throw new OrigenError('Falta el servidor. Escríbelo arriba y vuelve a probar.')
    if (!cfg.usuario) throw new OrigenError('Falta el usuario. Escríbelo arriba y vuelve a probar.')

    // Antes de mandar la contraseña de un cliente a ninguna parte.
    const ftp = avisoFtpSinCifrar(cfg)
    if (ftp) throw new OrigenError(ftp, { esDeAcceso: true })

    const secreto = await resolverSecreto(ctx)
    if (!secreto) {
      throw new OrigenError(
        'Falta la contraseña (o la clave privada) de este servidor. Escríbela arriba: se guarda cifrada ' +
          'y no vuelve a salir. También puedes escribirla y pulsar «Conectar» sin guardarla todavía.'
      )
    }

    const cliente = new SftpClient(`ls-${cfg.host}`)
    try {
      await conectar(cliente, cfg, secreto)

      /**
       * Sin ruta, se empieza donde el servidor deje a este usuario.
       *
       * `realPath('.')` es lo que contesta esa pregunta, y no se puede sustituir
       * por '/': muchos SFTP de cliente son cuentas enjauladas (chroot) donde
       * '/' es la raíz de la jaula, pero otros dejan al usuario en /home/loquesea
       * y '/' es la raíz del servidor entero, con cientos de carpetas que no
       * pintan nada. Empezar donde te deja el servidor es empezar donde está lo
       * tuyo.
       */
      const actual = await canonica(cliente, ruta)
      const entradas = await conTope(cliente.list(actual), ESPERA_MS, 'listar la carpeta')
      const { candidatos } = clasificar(entradas, cfg.patron)

      const carpetas = entradas
        .filter((e) => e.type === 'd' || e.type === 'l')
        .filter((e) => e.name !== '.' && e.name !== '..')
        .sort((a, b) => a.name.localeCompare(b.name, 'es'))
        .map((e) => ({
          nombre: e.name,
          ruta: unir(actual, e.name),
          detalle: e.type === 'l' ? 'enlace' : null,
        }))

      return {
        ruta: actual,
        migas: migasDe(actual),
        carpetas,
        ficheros: candidatos,
        // Cualquier carpeta del servidor vale como carpeta del perfil.
        seleccionable: true,
        aviso: avisoDePuerto(cfg),
      }
    } catch (error) {
      throw traducir(error, secreto, cfg)
    } finally {
      await cerrar(cliente)
    }
  },
}

/* ------------------------------------------------------------------ */
/* Configuración                                                       */
/* ------------------------------------------------------------------ */

interface ConfigSftp {
  host: string
  puerto: number
  puertoEscrito: string
  usuario: string
  ruta: string
  patron: string
}

function leerConfig(ctx: ContextoOrigen): ConfigSftp {
  const puertoEscrito = textoConfig(ctx.config, 'puerto')
  const puerto = Number.parseInt(puertoEscrito, 10)

  return {
    // Se le quita el esquema si alguien pega «sftp://servidor/» entero, que es
    // lo que sale de copiar la línea que manda el cliente por correo. Fallar por
    // eso con «getaddrinfo ENOTFOUND sftp://servidor» es hacerle perder media
    // hora a quien está dando de alta al cliente.
    host: textoConfig(ctx.config, 'host')
      .replace(/^s?ftps?:\/\//i, '')
      .replace(/\/+$/, '')
      .trim(),
    puerto: Number.isFinite(puerto) && puerto > 0 && puerto < 65536 ? puerto : PUERTO_POR_OMISION,
    puertoEscrito,
    usuario: textoConfig(ctx.config, 'usuario'),
    ruta: textoConfig(ctx.config, 'ruta'),
    patron: textoConfig(ctx.config, 'patron'),
  }
}

/** La frase de lo que falta por rellenar, o null si está todo */
function queFalta(cfg: ConfigSftp): string | null {
  if (!cfg.host) return 'Falta el servidor.'
  if (!cfg.usuario) return 'Falta el usuario.'
  const ftp = avisoFtpSinCifrar(cfg)
  if (ftp) return ftp
  if (!cfg.ruta) {
    return 'Falta la carpeta del servidor. Búscala con el explorador de aquí abajo y elígela.'
  }
  return null
}

/**
 * EL AVISO DE FTP SIN CIFRAR, Y POR QUÉ CORTA EN VEZ DE AVISAR AL FINAL.
 *
 * No se puede saber desde aquí si el servidor del cliente es FTP o SFTP hasta
 * intentarlo, pero el puerto 21 lo canta: es el del FTP de toda la vida, que
 * manda el usuario y la contraseña EN CLARO por la red — y la contraseña no es
 * nuestra, es de un cliente que nos la ha confiado.
 *
 * Por eso ni se intenta conectar: intentarlo con el 21 acaba en un tiempo de
 * espera agotado, que parece un problema de red y hace perder media hora
 * mirando cortafuegos. Aquí se dice qué pasa y qué pedirle al cliente.
 */
function avisoFtpSinCifrar(cfg: ConfigSftp): string | null {
  if (cfg.puerto !== 21) return null
  /**
   * Desde que existe el conector de FTPS, este aviso tiene que decir A DÓNDE ir.
   *
   * Antes terminaba en «pídele SFTP o FTPS», y eso mandaba a pedirle algo al
   * cliente cuando lo que solía pasar era que el cliente YA daba FTPS y el ERP
   * no sabía hablarlo. Un aviso correcto que manda a hacer la gestión
   * equivocada cuesta más que uno que no dice nada.
   */
  return (
    'El puerto 21 es el de FTP, y este conector habla SFTP (SSH), que normalmente es el 22.\n' +
    'Si el cliente te ha dado el 21, casi seguro es FTPS: cámbiate al conector «FTPS» de arriba, que ' +
    'sí lo habla y exige el cifrado antes de mandar nada.\n' +
    'Solo si su servidor no admite FTPS habría que pedirle SFTP: el FTP a secas manda el usuario y la ' +
    'contraseña en claro por la red, y esa contraseña es suya, no nuestra.'
  )
}

/** Un aviso menor para la cabecera del explorador */
function avisoDePuerto(cfg: ConfigSftp): string | null {
  if (cfg.puertoEscrito && cfg.puerto !== Number.parseInt(cfg.puertoEscrito, 10)) {
    return `El puerto «${cfg.puertoEscrito}» no es un número válido, así que se está usando el 22.`
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Conexión                                                            */
/* ------------------------------------------------------------------ */

/** La credencial: la de la pantalla si la hay, y si no la guardada cifrada */
async function resolverSecreto(ctx: ContextoOrigen): Promise<SecretoOrigen | null> {
  // La que se acaba de teclear manda sobre la guardada: es lo que permite
  // corregir una contraseña equivocada y probarla antes de guardarla.
  if (ctx.secretoEnPantalla) return ctx.secretoEnPantalla
  if (!ctx.perfilId) return null
  return leerCredencial(ctx.perfilId)
}

async function conectar(
  cliente: SftpClient,
  cfg: ConfigSftp,
  secreto: SecretoOrigen
): Promise<void> {
  await cliente.connect({
    host: cfg.host,
    port: cfg.puerto,
    username: cfg.usuario,
    ...(secreto.tipo === 'clave_privada'
      ? { privateKey: secreto.valor, ...(secreto.passphrase ? { passphrase: secreto.passphrase } : {}) }
      : { password: secreto.valor }),
    readyTimeout: ESPERA_MS,
    // El latido: ssh2 pregunta cada 5 segundos y, si el otro extremo no
    // contesta tres veces seguidas, tira la sesión él solo. Es la segunda mitad
    // de lo que explica conTope(): el tope de arriba corta la ESPERA, y esto
    // corta la CONEXIÓN, que si no se queda abierta consumiendo un socket del
    // contenedor hasta que el servidor se canse.
    keepaliveInterval: 5_000,
    keepaliveCountMax: 3,
    // Sin `debug`: ssh2 escribiría la negociación entera —y trozos de la
    // sesión— en la consola del contenedor.
  })
}

/**
 * Cerrar NUNCA lanza.
 *
 * Va en el `finally` de las tres operaciones, así que un fallo al cerrar
 * taparía el error de verdad —el que explica por qué no se ha podido leer el
 * fichero— con un «connection closed unexpectedly» que no le dice nada a nadie.
 * Y una conexión que no se cierra bien la acaba cerrando el servidor.
 */
async function cerrar(cliente: SftpClient): Promise<void> {
  try {
    await cliente.end()
  } catch {
    /* da igual */
  }
}

/* ------------------------------------------------------------------ */
/* Qué fichero se coge                                                 */
/* ------------------------------------------------------------------ */

function esFichero(e: FileInfo): boolean {
  return e.type === '-'
}

/**
 * Cuál se cogería AHORA MISMO, y por qué se descarta cada uno de los demás.
 *
 * A diferencia de Drive, aquí la lista NO viene ordenada: `readdir` de SFTP
 * devuelve lo que el servidor tenga a mano, que suele ser por orden de creación
 * en el sistema de ficheros o alfabético. Ordenarla por fecha descendente es lo
 * que hace que «el más reciente» signifique el más reciente y no «el primero que
 * ha listado el servidor», que es un fallo que no se ve hasta el día que el
 * cliente deja dos ficheros en la carpeta.
 *
 * Y EL EMPATE DE FECHA NO ES UN CASO RARO: hay que desempatar por nombre.
 * SFTP transmite la fecha de modificación EN SEGUNDOS, así que dos ficheros
 * escritos en el mismo segundo empatan — y eso pasa siempre que el ERP del
 * cliente regenera la carpeta entera de golpe, cuando se restaura una copia o
 * cuando se sincroniza con `rsync -t`. Con el empate sin resolver gana el que el
 * servidor haya listado primero, que en el orden más común —el alfabético— es
 * STOCK_2026-08-08.csv frente a STOCK_2026-08-09.csv: MANDAR A AMAZON EL STOCK
 * DE AYER, sin que se note ni mirando el explorador, porque enseñaría el mismo
 * fichero equivocado.
 *
 * Desempatar por nombre descendente no es una moneda al aire: en el caso real
 * —STOCK_<fecha>.csv— el nombre descendente ES la fecha descendente. Cuando el
 * desempate decide, se dice en la lista de candidatos, que para eso está.
 *
 * El motivo del descarte se guarda de todos porque «no encaja ninguno» sin decir
 * por qué obliga a adivinar entre el patrón y la extensión.
 */
function clasificar(
  entradas: FileInfo[],
  patron: string
): { elegido: FileInfo | null; candidatos: CandidatoOrigen[] } {
  const ficheros = entradas
    .filter(esFichero)
    .sort((a, b) => b.modifyTime - a.modifyTime || b.name.localeCompare(a.name, 'es'))

  let elegido: FileInfo | null = null
  const candidatos: CandidatoOrigen[] = []

  for (const f of ficheros) {
    let descarte: string | null = null

    if (!encajaPatron(f.name, patron)) {
      descarte = `No encaja con el patrón «${patron}»`
    } else if (!extensionValida(f.name)) {
      descarte = 'No es un .xlsx, .xls ni .csv'
    }

    const bueno = descarte === null && elegido === null
    if (bueno) elegido = f

    // ¿Ha decidido el desempate? Solo cuenta si el otro también servía: dos
    // ficheros de la misma fecha de los que uno no encaja con el patrón no son
    // un empate, son un fichero.
    const empatado =
      bueno &&
      ficheros.some(
        (o) =>
          o !== f &&
          o.modifyTime === f.modifyTime &&
          encajaPatron(o.name, patron) &&
          extensionValida(o.name)
      )

    candidatos.push({
      nombre: f.name,
      idExterno: null,
      modificadoAt: fechaIso(f.modifyTime),
      tamano: f.size,
      elegido: bueno,
      descarte: descarte ?? (bueno ? null : 'Hay otro más reciente que también encaja'),
      nota: empatado
        ? 'Otro fichero tiene exactamente la misma fecha (SFTP solo da segundos): se desempata por nombre, y este es el último por orden alfabético.'
        : null,
    })
  }

  return { elegido, candidatos }
}

/* ------------------------------------------------------------------ */
/* Rutas                                                               */
/* ------------------------------------------------------------------ */

/**
 * LA RUTA, TAL Y COMO LA VE EL SERVIDOR.
 *
 * Sin ruta, se empieza donde el servidor deje a este usuario: `realPath('.')` es
 * lo que contesta esa pregunta, y no se puede sustituir por '/'. Muchos SFTP de
 * cliente son cuentas enjauladas (chroot) donde '/' es la raíz de la jaula, pero
 * otros dejan al usuario en /home/loquesea y '/' es la raíz del servidor entero,
 * con cientos de carpetas que no pintan nada. Empezar donde te deja el servidor
 * es empezar donde está lo tuyo.
 *
 * Y CON RUTA, TAMBIÉN SE PASA POR realPath. Es fácil acabar con «..» dentro sin
 * querer: basta con pegar en el campo «Carpeta» la ruta relativa que el cliente
 * ha mandado por correo. El servidor la resuelve igual y lista lo correcto —eso
 * no es un agujero: el conector es de solo lectura por tipos y quién ve qué lo
 * decide el servidor del cliente— pero lo que viene después sale mal: la miga de
 * pan se pinta «/ › home › cliente › out › .. › .. › etc», con botones que
 * llevan a rutas sin sentido, y «Usar esta carpeta» guardaría esa cadena en el
 * perfil. Eso es lo que va a leer el ciclo cada quince minutos y lo que va a
 * leer una persona dentro de seis meses intentando entender a qué carpeta
 * apunta esto.
 *
 * realPath resuelve además los enlaces simbólicos COMO LOS VE EL SERVIDOR, que
 * es algo que una normalización propia no puede hacer. Si falla —hay servidores
 * que no implementan la extensión— se cae a normalizar por nuestra cuenta, que
 * es peor pero no deja la ruta cruda.
 */
async function canonica(cliente: SftpClient, ruta: string): Promise<string> {
  const pedida = ruta.trim()
  try {
    const resuelta = await conTope(cliente.realPath(pedida || '.'), ESPERA_MS, 'resolver la ruta')
    if (resuelta) return resuelta
  } catch {
    /* Se sigue con la normalización de andar por casa */
  }
  return pedida ? normalizar(pedida) : '/'
}

/** «/a/b/../c//d/» → «/a/c/d». Solo para cuando el servidor no resuelve rutas */
function normalizar(ruta: string): string {
  const absoluta = ruta.startsWith('/')
  const partes: string[] = []
  for (const parte of ruta.split('/')) {
    if (parte === '' || parte === '.') continue
    if (parte === '..') {
      if (partes.length > 0 && partes[partes.length - 1] !== '..') partes.pop()
      else if (!absoluta) partes.push('..')
      continue
    }
    partes.push(parte)
  }
  const unida = partes.join('/')
  return absoluta ? `/${unida}` : unida || '.'
}

/** Une carpeta y nombre sin duplicar la barra ni perderla */
function unir(carpeta: string, nombre: string): string {
  const base = carpeta.replace(/\/+$/, '')
  return `${base}/${nombre}`
}

/** «/out/stock/2026» → raíz · out · stock · 2026, cada una con su ruta */
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

/* ------------------------------------------------------------------ */
/* Errores                                                             */
/* ------------------------------------------------------------------ */

/**
 * TRADUCE EL FALLO A LA FRASE QUE LO ARREGLA, Y TACHA LA CREDENCIAL.
 *
 * Los mensajes de ssh2 están en inglés y son de nivel de red («All configured
 * authentication methods failed»), que en el alta de un cliente no dice si hay
 * que llamarle a él, mirar el usuario o abrir el cortafuegos. Aquí se convierte
 * cada caso en qué hacer.
 *
 * Y todo pasa por tacharSecreto(): ssh2 mete el contenido de la clave privada
 * dentro del mensaje de algunos errores, y ese mensaje acaba en la fila del
 * historial de ejecuciones, que no se borra nunca.
 */
function traducir(error: unknown, secreto: SecretoOrigen | null, cfg?: ConfigSftp): OrigenError {
  if (error instanceof OrigenError) {
    return new OrigenError(tacharSecreto(error.message, secreto), {
      esDeAcceso: error.esDeAcceso,
    })
  }

  const bruto = error instanceof Error ? error.message : 'error desconocido'
  const limpio = tacharSecreto(bruto, secreto)
  const codigo = (error as { code?: string | number } | null)?.code
  const donde = cfg ? `${cfg.host}:${cfg.puerto}` : 'el servidor'
  const texto = limpio.toLowerCase()

  // ---- No se llega a la máquina ----
  if (codigo === 'ENOTFOUND' || texto.includes('getaddrinfo')) {
    return new OrigenError(
      `No existe el servidor «${cfg?.host ?? ''}»: el nombre no resuelve. Comprueba que está bien escrito ` +
        '(sin «sftp://» delante y sin la carpeta detrás).',
      { esDeAcceso: true }
    )
  }
  if (codigo === 'ECONNREFUSED') {
    return new OrigenError(
      `El servidor ${donde} rechaza la conexión. O el puerto no es ese —SFTP suele ser el 22— o el ` +
        'cliente tiene que abrir su cortafuegos a la IP de nuestro servidor.',
      { esDeAcceso: true }
    )
  }
  if (codigo === 'ETIMEDOUT' || texto.includes('timed out') || texto.includes('timeout')) {
    return new OrigenError(
      `El servidor ${donde} no contesta en ${Math.round(ESPERA_MS / 1000)} segundos. Suele ser el cortafuegos del ` +
        'cliente, que solo deja entrar a IP conocidas: hay que pedirle que autorice la de nuestro servidor.',
      { esDeAcceso: true }
    )
  }

  // ---- Se llega y no nos dejan entrar ----
  if (
    texto.includes('all configured authentication methods failed') ||
    texto.includes('authentication') ||
    codigo === 'ERR_GENERIC_CLIENT'
  ) {
    return new OrigenError(
      `El servidor ${donde} no acepta las credenciales del usuario «${cfg?.usuario ?? ''}». ` +
        'Repasa el usuario y vuelve a escribir la contraseña (una contraseña guardada mal no se puede ver, ' +
        'así que la forma de descartarla es escribirla otra vez). Si el cliente usa clave privada, ' +
        'comprueba que le has dado a él la PÚBLICA y que aquí está pegada la privada entera.',
      { esDeAcceso: true }
    )
  }
  if (texto.includes('cannot parse privatekey') || texto.includes('unsupported key format')) {
    return new OrigenError(
      'La clave privada guardada no se puede leer. Pégala entera, con sus líneas «-----BEGIN…» y ' +
        '«-----END…», tal y como está en el fichero. Si tiene frase de paso, ponla también.',
      { esDeAcceso: true }
    )
  }

  // ---- Entramos y la carpeta no está ----
  if (codigo === 2 || texto.includes('no such file')) {
    return new OrigenError(
      `Se entra en ${donde} pero la carpeta «${cfg?.ruta ?? ''}» no existe. ` +
        'Búscala con el explorador: en muchos servidores la ruta que da el cliente es relativa a su ' +
        'carpeta de usuario y no empieza en la raíz.',
      { esDeAcceso: true }
    )
  }
  if (codigo === 3 || texto.includes('permission denied')) {
    return new OrigenError(
      `Se entra en ${donde} pero este usuario no puede leer «${cfg?.ruta ?? ''}». ` +
        'El cliente tiene que darle permiso de lectura sobre esa carpeta.',
      { esDeAcceso: true }
    )
  }

  return new OrigenError(`No se ha podido leer del servidor ${donde}: ${limpio}`)
}

function mensajeDe(error: unknown, secreto: SecretoOrigen | null, cfg?: ConfigSftp): string {
  return traducir(error, secreto, cfg).message
}

/* ------------------------------------------------------------------ */

function fechaIso(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}

/** «Falta el servidor.» → «falta el servidor.», para poder encadenar frases */
function minuscula(frase: string): string {
  return frase.charAt(0).toLowerCase() + frase.slice(1)
}
