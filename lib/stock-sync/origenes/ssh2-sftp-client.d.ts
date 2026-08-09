/**
 * LOS TIPOS DE `ssh2-sftp-client`, ESCRITOS A MANO.
 *
 * El paquete no trae tipos (su `package.json` no declara `types`) y sus tipos de
 * DefinitelyTyped son OTRA dependencia. El encargo decía: añadir la librería de
 * SFTP y nada más. Así que aquí está lo único que este módulo usa de ella —
 * cuatro métodos— en vez de un segundo paquete en el contenedor.
 *
 * NO ES UN `any`. Está escrito a la contra: si mañana alguien llama a `put()` o
 * a `delete()`, TypeScript se niega, y eso es exactamente lo que se quiere. Este
 * conector es DE SOLO LECTURA sobre el servidor de un cliente, y la mejor forma
 * de que siga siéndolo dentro de seis meses es que escribir no compile.
 *
 * Lo comprobado contra node_modules/ssh2-sftp-client/src/index.js (v12.1.1):
 *   · list()  devuelve `type` ('-' fichero, 'd' carpeta, 'l' enlace), `name`,
 *     `size` en bytes y `modifyTime` en MILISEGUNDOS (el módulo multiplica el
 *     mtime de SFTP, que va en segundos, por 1000).
 *   · get(ruta) sin destino devuelve un Buffer con el contenido.
 */

declare module 'ssh2-sftp-client' {
  /** Una entrada de un directorio remoto */
  export interface FileInfo {
    /** '-' fichero · 'd' carpeta · 'l' enlace simbólico */
    type: string
    name: string
    size: number
    /** Milisegundos desde epoch */
    modifyTime: number
    accessTime: number
    longname: string
  }

  export interface ConnectOptions {
    host: string
    port?: number
    username?: string
    password?: string
    privateKey?: string | Buffer
    passphrase?: string
    /** Milisegundos de espera al establecer la conexión */
    readyTimeout?: number
    /** Cierra la conexión si el servidor no contesta al keepalive */
    keepaliveInterval?: number
    keepaliveCountMax?: number
    /** Lo admite ssh2 y aquí NO se usa: escribiría la sesión en los logs */
    debug?: (mensaje: string) => void
  }

  export default class SftpClient {
    constructor(nombre?: string)
    connect(config: ConnectOptions): Promise<unknown>
    list(remotePath: string): Promise<FileInfo[]>
    /** Sin destino, devuelve el contenido en un Buffer */
    get(remotePath: string): Promise<Buffer>
    /** Ruta absoluta real, resolviendo '.' y '..'. '' si no existe */
    realPath(remotePath: string): Promise<string>
    end(): Promise<void>
  }
}
