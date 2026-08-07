/**
 * ORIGEN «SUBIDA A MANO»: el fichero lo trae la persona en la petición.
 *
 * Es el conector más simple y a la vez el que no se puede quitar nunca. Sirve
 * para tres cosas distintas y las tres importan:
 *
 *   1. Dar de alta a un cliente: se prueba el perfil con el fichero delante,
 *      sin haber configurado todavía ningún acceso a nada.
 *   2. El cliente que no sabe dar más que un adjunto por correo.
 *   3. LA SALIDA DE EMERGENCIA: el día que Drive se cae o el cliente cambia la
 *      carpeta de sitio, se sube el fichero a mano y el envío sale igual. Un
 *      proceso automático sin camino manual se convierte en un proceso parado.
 *
 * Existe como conector, y no como un `if` en la ruta, para que el resto del
 * proceso no tenga que saber de dónde vino el fichero: sea Drive o sea una
 * subida, a partir de aquí es un FicheroOrigen y nada más.
 */

import { OrigenError, type ConectorOrigen, type ContextoOrigen, type FicheroOrigen } from './tipos'

export const conectorManual: ConectorOrigen = {
  id: 'manual',
  etiqueta: 'Subida a mano',
  descripcion:
    'El fichero se arrastra a la pantalla cada vez. Es lo que se usa para dar de alta a un cliente y para salir del paso si su origen automático falla.',
  construido: true,
  // Sin configuración: no hay nada que apuntar de una subida a mano.
  campos: [],

  async comprobar(): Promise<{ ok: boolean; mensaje: string; candidatos: [] }> {
    return {
      ok: true,
      mensaje:
        'Este perfil se procesa subiendo el fichero a mano. No hay nada que comprobar hasta que se suba uno.',
      candidatos: [],
    }
  },

  async traer(ctx: ContextoOrigen): Promise<FicheroOrigen> {
    const subida = ctx.subida
    if (!subida) {
      throw new OrigenError(
        `El perfil «${ctx.perfil}» es de subida a mano y no ha llegado ningún fichero con la petición. ` +
          'Arrastra el fichero del cliente a la pantalla, o cambia el origen del perfil a una carpeta de Drive para que se lea solo.'
      )
    }

    if (subida.tamano > ctx.maxBytes) {
      throw new OrigenError(
        `«${subida.nombre}» ocupa ${mb(subida.tamano)} MB y el máximo son ${mb(ctx.maxBytes)} MB.`
      )
    }

    return {
      nombre: subida.nombre,
      bytes: subida.bytes,
      idExterno: null,
      // SIN HUELLA, y es deliberado: quien sube un fichero a mano quiere que se
      // procese, aunque sea idéntico al de hace cinco minutos. Poner aquí un
      // hash haría que el segundo intento contestara «sin cambios», que es
      // exactamente lo contrario de lo que se está pidiendo al volver a subirlo.
      huella: null,
      modificadoAt: null,
      tamano: subida.tamano,
    }
  },
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}
