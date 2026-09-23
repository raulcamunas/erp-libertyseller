/**
 * EL REGISTRO DE CONECTORES.
 *
 * Es la única lista. Añadir un origen es escribir su fichero en esta carpeta y
 * meterlo aquí: ni el lector, ni el cruce, ni los frenos, ni el simulacro, ni la
 * pantalla de configuración necesitan enterarse, porque todos hablan con la
 * interfaz común de tipos.ts.
 *
 * El tipo Record<StockProfileOrigin, ConectorOrigen> no es decorativo: obliga a
 * que la lista cubra TODOS los orígenes que admite el CHECK de la base. El día
 * que alguien añada 'api' a la migración y a StockProfileOrigin, esto deja de
 * compilar hasta que exista su conector — que es mucho mejor que descubrirlo
 * cuando el cron intente procesar un perfil y no encuentre con qué.
 */

import type { StockProfileOrigin } from '@/lib/types/stock-sync'
import { conectorApi } from './api'
import { conectorCorreo } from './correo'
import { conectorDrive } from './drive'
import { conectorManual } from './manual'
import { conectorFtps } from './ftps'
import { conectorSftp } from './sftp'
import type { ConectorOrigen } from './tipos'
import { conectorImap } from './imap'

const REGISTRO: Record<StockProfileOrigin, ConectorOrigen> = {
  manual: conectorManual,
  drive: conectorDrive,
  sftp: conectorSftp,
  ftps: conectorFtps,
  correo: conectorCorreo,
  imap: conectorImap,
  api: conectorApi,
}

/** El conector de un origen. Nunca devuelve undefined: el Record los cubre todos */
export function conectorDe(origen: StockProfileOrigin): ConectorOrigen {
  return REGISTRO[origen]
}

/**
 * Todos, en el orden en que se enseñan: primero los que funcionan.
 *
 * AQUÍ NO ESTÁ `conectorImap`, Y NO ES UN OLVIDO (aunque lo fue durante un día:
 * se metió en el REGISTRO de arriba y no aquí, así que el conector existía y no
 * había forma de llegar a él desde la pantalla).
 *
 * Desde la migración 198 NO HAY DOS ORÍGENES DE CORREO. Hay uno, 'correo', y el
 * BUZÓN elegido decide por dentro si se lee por la API de Gmail o por IMAP.
 * `conectorCorreo` delega en `conectorImap` cuando toca; el de IMAP sigue en el
 * REGISTRO porque el Record los exige todos y porque es él quien hace el
 * trabajo, pero no es una opción que nadie tenga que elegir.
 *
 * Volver a meterlo aquí sacaría otra vez los dos botones de correo, que es
 * exactamente la decisión que sobra: quien configura no tiene por qué saber si
 * un buzón está en nuestro Workspace o en el hosting del cliente.
 */
export function conectores(): ConectorOrigen[] {
  return [conectorManual, conectorApi, conectorDrive, conectorSftp, conectorFtps, conectorCorreo]
}

/** ¿Es un origen que el usuario puede elegir en la pantalla? */
export function esOrigenElegible(origen: string): origen is StockProfileOrigin {
  return conectores().some((c) => c.id === origen)
}

/**
 * Lo que la pantalla necesita saber de cada conector, sin poder ejecutarlo.
 *
 * Los conectores viven en el servidor —el de Drive firma un JWT con la clave
 * privada de la cuenta de servicio— así que el navegador no los puede importar.
 * Esto es la parte que sí puede viajar: nombres, descripciones y qué campos
 * pintar. La clave privada no está ni cerca de esta estructura.
 */
export interface ConectorPublico {
  id: StockProfileOrigin
  etiqueta: string
  descripcion: string
  construido: boolean
  campos: ConectorOrigen['campos']
  /**
   * Si el conector sabe enseñar lo que hay dentro, y con qué palabra. La
   * pantalla pinta el explorador MIRANDO ESTO, no con un `if` por origen: así,
   * el día que exista un conector nuevo con explorador, el formulario no se
   * entera de nada.
   */
  explorador: ConectorOrigen['explorador']
  /** Si el conector necesita una contraseña, y de qué formas la acepta */
  secreto: ConectorOrigen['secreto']
  /** Si la pantalla tiene que pintar el desplegable de buzones. Ver tipos.ts */
  usaBuzon: boolean
  /** En qué campo escribe el explorador la carpeta elegida */
  campoRuta: string | null
}

export function conectoresPublicos(): ConectorPublico[] {
  return conectores().map((c) => ({
    id: c.id,
    etiqueta: c.etiqueta,
    descripcion: c.descripcion,
    construido: c.construido,
    campos: c.campos,
    explorador: c.explorador,
    secreto: c.secreto,
    usaBuzon: c.usaBuzon ?? false,
    campoRuta: c.campoRuta ?? null,
  }))
}

export * from './tipos'
