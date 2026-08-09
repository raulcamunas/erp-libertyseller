/**
 * LO QUE CONTESTAN LAS RUTAS DEL EXPLORADOR.
 *
 * Este fichero es SOLO TIPOS, y es lo que permite que la pantalla los importe
 * con `import type` —que TypeScript borra al compilar— sin arrastrar al
 * navegador ni un byte de los conectores. Los conectores viven en el servidor:
 * el de Drive firma un JWT con la clave privada de la cuenta de servicio y el de
 * SFTP descifra contraseñas de clientes.
 *
 * Es el mismo mecanismo que ya usa lib/amazon/client.ts con PerfilesView, y la
 * ventaja es la de siempre: la pantalla no puede desviarse de lo que la ruta
 * devuelve de verdad, porque es literalmente el mismo tipo.
 */

import type { EstadoCredencial } from './credenciales'
import type { EstadoOrigen, ListadoOrigen } from './tipos'

/** POST /api/stock-sync/perfiles/[id]/explorar con accion: 'comprobar' */
export interface ComprobarResponse {
  estado: EstadoOrigen
}

/** POST /api/stock-sync/perfiles/[id]/explorar con accion: 'explorar' */
export interface ExplorarResponse {
  listado: ListadoOrigen
}

/** GET, POST y DELETE de /api/stock-sync/perfiles/[id]/credencial */
export interface CredencialResponse {
  credencial: EstadoCredencial
}

/**
 * La credencial que se acaba de teclear y todavía no se ha guardado.
 *
 * Viaja del navegador al servidor (que es la única dirección en la que una
 * contraseña puede viajar) para poder probarla antes de decidir guardarla. El
 * servidor NO la guarda al recibirla por aquí: para eso está el PUT de
 * /credencial, que es explícito.
 */
export interface SecretoEnviado {
  tipo: 'password' | 'clave_privada'
  valor: string
  passphrase?: string | null
}
