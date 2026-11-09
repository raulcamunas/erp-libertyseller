import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * LA VERSIÓN DEL ERP QUE ESTÁ FUNCIONANDO — SOLO SERVIDOR. Next escribe en `.next/BUILD_ID` un identificador nuevo en cada construcción, así que cada despliegue tiene el suyo. Se lee una vez por
 * proceso (un despliegue nuevo es un proceso nuevo). En desarrollo (`next dev`) no hay fichero: «desarrollo», que nunca avisa de nada. Lo usa el layout (la versión con la que se pintó cada pantalla)
 * y /api/version (la versión de ahora), y el navegador compara las dos (lib/sistema/version-cliente.ts).
 */

import { VERSION_DE_DESARROLLO } from './version-cliente'

export { VERSION_DE_DESARROLLO }

/** Lee el identificador del fichero; cualquier fallo o contenido raro es «desarrollo». `leer` se inyecta para probarlo */
export function leerIdDeVersion(ruta: string, leer: (r: string) => string = (r) => readFileSync(r, 'utf8')): string {
  try {
    const id = leer(ruta).trim()
    return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : VERSION_DE_DESARROLLO
  } catch {
    return VERSION_DE_DESARROLLO
  }
}

let guardada: string | null = null
export function idDeLaVersion(): string {
  return (guardada ??= leerIdDeVersion(join(process.cwd(), '.next', 'BUILD_ID')))
}
