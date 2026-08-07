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
} from './tipos'

export const conectorDrive: ConectorOrigen = {
  id: 'drive',
  etiqueta: 'Carpeta de Google Drive',
  descripcion:
    'El cliente comparte una carpeta con la cuenta de servicio del ERP y deja ahí su volcado. Se coge el fichero más reciente que encaje con el patrón.',
  construido: true,

  campos: [
    {
      clave: 'folder_id',
      etiqueta: 'Identificador de la carpeta',
      tipo: 'texto',
      requerido: true,
      ayuda:
        'Es el trozo final de la URL de la carpeta en Drive: en drive.google.com/drive/folders/1A2B3C… el identificador es 1A2B3C…',
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
      const ficheros = await listarCarpeta(cfg.folderId, {
        unidadCompartida: cfg.unidadCompartida,
      })
      const { elegido, candidatos } = clasificar(ficheros, cfg.patron)

      if (ficheros.length === 0) {
        return {
          ok: false,
          mensaje:
            'Se llega a la carpeta y está vacía. Si el cliente ve ficheros dentro, es que la carpeta está en una unidad compartida: marca esa casilla.',
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
      ficheros = await listarCarpeta(cfg.folderId, { unidadCompartida: cfg.unidadCompartida })
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
      const { file, bytes, exportado } = await descargar(elegido, {
        unidadCompartida: cfg.unidadCompartida,
        maxBytes: ctx.maxBytes,
      })

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
}

/* ------------------------------------------------------------------ */

interface ConfigDrive {
  folderId: string
  patron: string
  unidadCompartida: boolean
}

function leerConfig(ctx: ContextoOrigen): ConfigDrive {
  return {
    folderId: textoConfig(ctx.config, 'folder_id'),
    patron: textoConfig(ctx.config, 'patron'),
    unidadCompartida: booleanoConfig(ctx.config, 'unidad_compartida'),
  }
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
