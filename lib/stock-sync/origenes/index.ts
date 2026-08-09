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
import { conectorCorreo } from './correo'
import { conectorDrive } from './drive'
import { conectorManual } from './manual'
import { conectorSftp } from './sftp'
import type { ConectorOrigen } from './tipos'

const REGISTRO: Record<StockProfileOrigin, ConectorOrigen> = {
  manual: conectorManual,
  drive: conectorDrive,
  sftp: conectorSftp,
  correo: conectorCorreo,
}

/** El conector de un origen. Nunca devuelve undefined: el Record los cubre todos */
export function conectorDe(origen: StockProfileOrigin): ConectorOrigen {
  return REGISTRO[origen]
}

/** Todos, en el orden en que se enseñan: primero los que funcionan */
export function conectores(): ConectorOrigen[] {
  return [conectorManual, conectorDrive, conectorSftp, conectorCorreo]
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
    campoRuta: c.campoRuta ?? null,
  }))
}

export * from './tipos'
