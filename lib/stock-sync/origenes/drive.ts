/**
 * ORIGEN «CARPETA DE GOOGLE DRIVE».
 *
 * El cliente comparte una carpeta con la cuenta de servicio del ERP y deja ahí
 * el volcado que saca su sistema. Cada quince minutos se mira la carpeta, se
 * coge EL MÁS RECIENTE QUE ENCAJE CON EL PATRÓN y, si no es el mismo que la vez
 * anterior, se procesa.
 *
 * SOLO LECTURA. El scope es drive.readonly: aunque alguien comparta la carpeta
 * como editor, desde aquí no se puede borrar ni mover nada. El fichero del
 * cliente es suyo y se queda como está.
 *
 * EL FALLO QUE PASA SIEMPRE, Y ESTÁ TRATADO APARTE: la carpeta no está
 * compartida con la cuenta de servicio. Drive contesta un 404 seco que no dice
 * nada, y quien está dando de alta al cliente se queda mirando un identificador.
 * Por eso el error de este conector dice literalmente qué pasa y CON QUÉ CORREO
 * hay que compartir la carpeta (ver errorDeCompartir en lib/google-drive.ts).
 *
 *
 * ============ LO QUE AÑADIÓ EL EXPLORADOR: DÓNDE ESTÁ LA CARPETA ============
 *
 * Hasta ahora solo había un sitio posible: una carpeta del cliente compartida
 * con la cuenta de servicio, y el único dato que hacía falta era su
 * identificador, copiado a mano de la URL. Ahora hay dos sitios, y el perfil
 * guarda cuál (`identidad` en origen_config):
 *
 *   'servicio' — LO DE SIEMPRE, y sigue siendo lo de fábrica. La cuenta de
 *                servicio actúa como ella misma y ve lo que el cliente le
 *                comparte. Los perfiles que ya funcionan no tienen ese campo
 *                puesto, y sin campo se lee 'servicio': se comportan igual que
 *                antes, byte por byte.
 *
 *   'propia'    — NUESTRO Drive, en nombre de GOOGLE_IMPERSONATE_SUBJECT
 *                (delegación de dominio). Es lo que pidió el encargo: «que en
 *                una interfaz podamos ver nuestro drive y seleccionar la
 *                carpeta que va a mirar cada x momento».
 *
 * LAS DOS NO VEN LO MISMO, y por eso la identidad se guarda con la carpeta y no
 * se decide en cada llamada: una carpeta de NUESTRO Drive no está compartida con
 * la cuenta de servicio, así que leerla con la identidad equivocada da un 404 y
 * un mensaje que pide compartir con nosotros mismos. Está explicado entero en
 * ./drive-navegar.ts.
 */

import {
  DriveError,
  descargar,
  driveServiceAccountEmail,
  isDriveConfigured,
  listarCarpeta,
  type DriveFile,
} from '@/lib/google-drive'
import {
  correoCuentaServicio,
  descargarConIdentidad,
  listarFicheros,
  listarSubcarpetas,
  migaDePan,
  raices,
  usuarioDelegado,
  type IdentidadDrive,
} from './drive-navegar'
import {
  OrigenError,
  booleanoConfig,
  encajaPatron,
  extensionValida,
  textoConfig,
  type CandidatoOrigen,
  type ConectorOrigen,
  type ContextoOrigen,
  type EstadoOrigen,
  type FicheroOrigen,
  type ListadoOrigen,
} from './tipos'

export const conectorDrive: ConectorOrigen = {
  id: 'drive',
  etiqueta: 'Carpeta de Google Drive',
  descripcion:
    'Una carpeta de Drive —del cliente, compartida con el ERP, o nuestra— donde se deja el volcado. Se coge el fichero más reciente que encaje con el patrón.',
  construido: true,
  explorador: 'carpetas',
  campoRuta: 'folder_id',

  campos: [
    {
      clave: 'identidad',
      etiqueta: 'De quién es la carpeta',
      tipo: 'opcion',
      requerido: false,
      // La primera es la de fábrica, y es la de siempre: un perfil que ya
      // funciona no tiene este campo puesto y tiene que seguir leyendo igual.
      opciones: [
        { valor: 'servicio', etiqueta: 'Del cliente, compartida con el ERP' },
        { valor: 'propia', etiqueta: 'Nuestra, en el Drive de la agencia' },
      ],
      ayuda:
        'Cambia CON QUÉ OJOS mira el ERP, y las dos vistas no ven lo mismo. «Del cliente»: la cuenta de servicio ve lo que le hayan compartido a su correo. «Nuestra»: se navega el Drive de la agencia. Elegir mal da un «no existe la carpeta» para una carpeta que se ve perfectamente en el navegador.',
    },
    {
      clave: 'folder_id',
      etiqueta: 'Identificador de la carpeta',
      tipo: 'texto',
      requerido: true,
      ayuda:
        'Se rellena solo al elegir la carpeta en el explorador de aquí abajo. A mano, es el trozo final de la URL: en drive.google.com/drive/folders/1A2B3C… el identificador es 1A2B3C…',
      ejemplo: '1A2B3c4D5e6F7g8H9i0JkLmNoPqRsTuV',
    },
    {
      clave: 'patron',
      etiqueta: 'Patrón del nombre',
      tipo: 'texto',
      requerido: false,
      ayuda:
        'Para cuando en la carpeta hay más de un fichero. Vale * (cualquier cosa) y ? (un carácter); no distingue mayúsculas. Vacío = se coge el más reciente sea cual sea su nombre.',
      ejemplo: 'ARTICULOS_STOCK*.xlsx',
    },
    {
      clave: 'unidad_compartida',
      etiqueta: 'Está en una unidad compartida',
      tipo: 'booleano',
      requerido: false,
      ayuda:
        'Márcalo si la carpeta vive en una unidad compartida de Workspace y no en «Mi unidad». Sin esto, Drive devuelve la carpeta VACÍA sin dar ningún error, que es el fallo más difícil de encontrar de todos.',
    },
  ],

  async comprobar(ctx: ContextoOrigen): Promise<EstadoOrigen> {
    const cfg = leerConfig(ctx)

    if (!isDriveConfigured()) {
      return {
        ok: false,
        mensaje:
          'Falta configurar la cuenta de servicio de Google en el servidor (GOOGLE_SA_CLIENT_EMAIL y GOOGLE_SA_PRIVATE_KEY).',
        candidatos: [],
      }
    }
    if (!cfg.folderId) {
      return {
        ok: false,
        mensaje: 'Este perfil no tiene puesto el identificador de la carpeta de Drive.',
        candidatos: [],
      }
    }

    try {
      const ficheros = await listar(cfg)
      const { elegido, candidatos } = clasificar(ficheros, cfg.patron)

      if (ficheros.length === 0) {
        return {
          ok: false,
          mensaje:
            cfg.identidad === 'propia'
              ? `Se llega a la carpeta con la cuenta ${usuarioDelegado() ?? 'delegada'} y está vacía.`
              : 'Se llega a la carpeta y está vacía. Si el cliente ve ficheros dentro, es que la carpeta está en una unidad compartida: marca esa casilla.',
          candidatos: [],
        }
      }
      if (!elegido) {
        return {
          ok: false,
          mensaje:
            `Hay ${ficheros.length} ${ficheros.length === 1 ? 'fichero' : 'ficheros'} en la carpeta pero ninguno encaja` +
            (cfg.patron ? ` con el patrón «${cfg.patron}»` : ' con las extensiones que se saben leer (.xlsx, .xls, .csv)') +
            '. Abajo está la lista con el motivo de cada uno.',
          candidatos,
        }
      }

      return {
        ok: true,
        mensaje: `Se lee la carpeta sin problemas. Se procesaría «${elegido.name}».`,
        candidatos,
      }
    } catch (error) {
      return { ok: false, mensaje: mensajeDe(error), candidatos: [] }
    }
  },

  async traer(ctx: ContextoOrigen): Promise<FicheroOrigen> {
    const cfg = leerConfig(ctx)

    if (!isDriveConfigured()) {
      throw new OrigenError(
        `El perfil «${ctx.perfil}» lee de Google Drive y el servidor no tiene configurada la cuenta de servicio ` +
          '(GOOGLE_SA_CLIENT_EMAIL y GOOGLE_SA_PRIVATE_KEY).'
      )
    }
    if (!cfg.folderId) {
      throw new OrigenError(
        `El perfil «${ctx.perfil}» lee de Google Drive pero no tiene puesto el identificador de la carpeta.`
      )
    }

    let ficheros: DriveFile[]
    try {
      ficheros = await listar(cfg)
    } catch (error) {
      throw traducir(error)
    }

    const { elegido } = clasificar(ficheros, cfg.patron)

    if (!elegido) {
      const correo = driveServiceAccountEmail() ?? 'la cuenta de servicio del ERP'
      throw new OrigenError(
        ficheros.length === 0
          ? `La carpeta de Drive del perfil «${ctx.perfil}» está vacía. Si el cliente ve ficheros dentro, ` +
            `comprueba que la ha compartido con ${correo} y que, si está en una unidad compartida, ` +
            'esa casilla está marcada en el perfil.'
          : `En la carpeta hay ${ficheros.length} ficheros pero ninguno encaja` +
            (cfg.patron ? ` con el patrón «${cfg.patron}»` : ' con las extensiones .xlsx, .xls o .csv') +
            `. El más reciente se llama «${ficheros[0]?.name ?? '?'}».`
      )
    }

    try {
      const { file, bytes, exportado } = await bajar(cfg, elegido, ctx.maxBytes)

      return {
        // Una hoja nativa de Google no lleva extensión en el nombre y sale
        // exportada a .xlsx: se le añade para que quien mire el historial no
        // crea que se procesó otra cosa.
        nombre: exportado && !extensionValida(file.name) ? `${file.name}.xlsx` : file.name,
        bytes,
        idExterno: file.id,
        // El md5 primero: cambia solo si el CONTENIDO cambia. La fecha de
        // modificación se mueve también cuando el cliente abre el fichero y lo
        // vuelve a guardar sin tocar nada, y eso dispararía un reproceso —y un
        // envío a Amazon— por nada.
        huella: file.md5Checksum ?? file.modifiedTime,
        modificadoAt: file.modifiedTime,
        tamano: bytes.byteLength,
      }
    } catch (error) {
      throw traducir(error)
    }
  },

  /* ---------------- Navegar ---------------- */

  /**
   * QUÉ HAY DENTRO DE ESTA CARPETA.
   *
   * `ruta` es el identificador de la carpeta, y vacío significa «enséñame por
   * dónde se empieza»: en nuestro Drive, «Mi unidad» y las unidades compartidas;
   * en la identidad de servicio, lo que los clientes le han compartido. Esa
   * segunda lista es la que contesta, sin llamar a nadie, la pregunta de si el
   * cliente ya ha compartido su carpeta o todavía no.
   */
  async explorar(ctx: ContextoOrigen, ruta: string): Promise<ListadoOrigen> {
    const cfg = leerConfig(ctx)

    if (!isDriveConfigured()) {
      throw new OrigenError(
        'Falta configurar la cuenta de servicio de Google en el servidor ' +
          '(GOOGLE_SA_CLIENT_EMAIL y GOOGLE_SA_PRIVATE_KEY).'
      )
    }

    const carpeta = ruta.trim()

    try {
      if (!carpeta) {
        const inicio = await raices(cfg.identidad)
        return {
          ruta: '',
          migas: [{ nombre: raizEtiqueta(cfg.identidad), ruta: '' }],
          carpetas: inicio.map((c) => ({
            nombre: c.nombre,
            ruta: c.id,
            detalle: c.esUnidad ? 'unidad compartida' : null,
          })),
          ficheros: [],
          // El nivel raíz NO se puede elegir: «Mi unidad» entera como carpeta de
          // volcado sería leer todo lo que la agencia tenga en Drive.
          seleccionable: false,
          aviso: avisoDeIdentidad(cfg.identidad, inicio.length),
        }
      }

      const [subcarpetas, ficheros, migas] = await Promise.all([
        listarSubcarpetas(cfg.identidad, carpeta, { unidadCompartida: cfg.unidadCompartida }),
        listarFicheros(cfg.identidad, carpeta, { unidadCompartida: cfg.unidadCompartida }),
        migaDePan(cfg.identidad, carpeta, { unidadCompartida: cfg.unidadCompartida }),
      ])

      const { candidatos } = clasificar(ficheros, cfg.patron)

      return {
        ruta: carpeta,
        migas: [
          { nombre: raizEtiqueta(cfg.identidad), ruta: '' },
          ...migas.map((m) => ({ nombre: m.nombre, ruta: m.id })),
        ],
        carpetas: subcarpetas.map((c) => ({ nombre: c.nombre, ruta: c.id, detalle: null })),
        ficheros: candidatos,
        seleccionable: true,
        aviso: null,
      }
    } catch (error) {
      throw traducir(error)
    }
  },
}

/* ------------------------------------------------------------------ */

interface ConfigDrive {
  folderId: string
  patron: string
  unidadCompartida: boolean
  identidad: IdentidadDrive
}

function leerConfig(ctx: ContextoOrigen): ConfigDrive {
  return {
    folderId: textoConfig(ctx.config, 'folder_id'),
    patron: textoConfig(ctx.config, 'patron'),
    unidadCompartida: booleanoConfig(ctx.config, 'unidad_compartida'),
    // Sin campo, 'servicio': es lo que tienen los perfiles que ya funcionan y
    // tienen que seguir comportándose exactamente igual.
    identidad: textoConfig(ctx.config, 'identidad') === 'propia' ? 'propia' : 'servicio',
  }
}

/**
 * Listar y descargar con la identidad que toque.
 *
 * La rama 'servicio' llama a lib/google-drive.ts, EXACTAMENTE lo mismo que hacía
 * antes de que existiera este fichero. Es a propósito: lo único que hoy funciona
 * en producción es esa rama, y una reescritura «para unificar» que la rompa
 * cuesta el volcado de un cliente. La rama nueva va aparte y no la toca.
 */
async function listar(cfg: ConfigDrive): Promise<DriveFile[]> {
  if (cfg.identidad === 'propia') {
    return listarFicheros('propia', cfg.folderId, { unidadCompartida: cfg.unidadCompartida })
  }
  return listarCarpeta(cfg.folderId, { unidadCompartida: cfg.unidadCompartida })
}

async function bajar(
  cfg: ConfigDrive,
  file: DriveFile,
  maxBytes: number
): Promise<{ file: DriveFile; bytes: ArrayBuffer; exportado: boolean }> {
  if (cfg.identidad === 'propia') {
    const { bytes, exportado } = await descargarConIdentidad('propia', file, {
      unidadCompartida: cfg.unidadCompartida,
      maxBytes,
    })
    return { file, bytes, exportado }
  }
  return descargar(file, { unidadCompartida: cfg.unidadCompartida, maxBytes })
}

function raizEtiqueta(identidad: IdentidadDrive): string {
  return identidad === 'propia' ? 'Drive de la agencia' : 'Compartido con el ERP'
}

/**
 * El aviso de arriba del explorador.
 *
 * En la identidad de servicio y con la lista vacía dice LO ÚNICO que hay que
 * hacer para que deje de estar vacía, con el correo delante: es el 100% de los
 * casos en que esto falla dando de alta a un cliente.
 */
function avisoDeIdentidad(identidad: IdentidadDrive, cuantas: number): string | null {
  if (identidad === 'propia') {
    return (
      `Estás mirando el Drive de la agencia con la cuenta ${usuarioDelegado() ?? 'delegada'}. ` +
      'Una carpeta de aquí solo la puede leer esa cuenta: si el fichero lo va a dejar el cliente, ' +
      'lo suyo es que él comparta SU carpeta y usar la otra opción.'
    )
  }
  if (cuantas === 0) {
    return (
      'La cuenta de servicio del ERP todavía no tiene ninguna carpeta compartida.\n' +
      'El cliente tiene que abrir su carpeta en Drive, pulsar «Compartir» y añadir este correo con permiso de Lector:\n\n' +
      `    ${correoCuentaServicio() ?? '(el correo de la cuenta de servicio)'}\n\n` +
      'En cuanto lo haga, aparecerá aquí sin hacer nada más.'
    )
  }
  return null
}

/**
 * Cuál se coge y por qué se descarta cada uno de los demás.
 *
 * Drive ya devuelve la lista de más reciente a más antiguo, así que el primero
 * que pase los dos filtros es el bueno. Se guarda el motivo del descarte de
 * todos porque «no encaja ninguno» sin decir por qué obliga a adivinar entre el
 * patrón y la extensión.
 */
function clasificar(
  ficheros: DriveFile[],
  patron: string
): { elegido: DriveFile | null; candidatos: CandidatoOrigen[] } {
  let elegido: DriveFile | null = null
  const candidatos: CandidatoOrigen[] = []

  for (const f of ficheros) {
    let descarte: string | null = null

    // La hoja nativa de Google no tiene extensión en el nombre y se exporta a
    // .xlsx, así que no se le puede exigir una.
    const esHojaNativa = f.mimeType === 'application/vnd.google-apps.spreadsheet'

    if (!encajaPatron(f.name, patron)) {
      descarte = `No encaja con el patrón «${patron}»`
    } else if (!esHojaNativa && !extensionValida(f.name)) {
      descarte = 'No es un .xlsx, .xls ni .csv'
    }

    const bueno = descarte === null && elegido === null
    if (bueno) elegido = f

    candidatos.push({
      nombre: f.name,
      idExterno: f.id,
      modificadoAt: f.modifiedTime,
      tamano: f.size,
      elegido: bueno,
      descarte: descarte ?? (elegido === f ? null : 'Hay otro más reciente que también encaja'),
    })
  }

  return { elegido, candidatos }
}

/** El DriveError ya trae la frase buena; el resto se envuelve sin perder el motivo */
function traducir(error: unknown): OrigenError {
  if (error instanceof OrigenError) return error
  if (error instanceof DriveError) {
    return new OrigenError(error.message, { esDeAcceso: error.esDeCompartir })
  }
  const detalle = error instanceof Error ? error.message : 'error desconocido'
  return new OrigenError(`No se ha podido leer la carpeta de Google Drive: ${detalle}`)
}

function mensajeDe(error: unknown): string {
  return traducir(error).message
}
