/**
 * LOS ORÍGENES DECLARADOS Y TODAVÍA NO CONSTRUIDOS: SFTP y correo.
 *
 * Están escritos —con sus campos de configuración y sus mensajes— pero no
 * implementados, y eso es a propósito. Todavía no se sabe qué va a poder dar
 * cada cliente, así que descubrirlo no puede costar una migración ni un rediseño:
 * el CHECK de la base ya los admite, la pantalla ya los sabe pintar y el
 * registro ya los conoce.
 *
 * QUÉ HACE FALTA PARA TERMINAR CUALQUIERA DE LOS DOS: escribir su `traer()` en
 * un fichero de esta carpeta y cambiar `construido` a true. Nada más. Ni el
 * lector, ni las reglas, ni los frenos, ni el simulacro, ni la pantalla se
 * enteran, porque todos hablan con FicheroOrigen y no con Drive ni con un
 * servidor SFTP.
 *
 * POR QUÉ APARECEN EN LA PANTALLA EN VEZ DE ESTAR ESCONDIDOS: para que la
 * pregunta «¿podemos recibirlo por SFTP?» se conteste mirando la pantalla, que
 * dice que sí y qué falta, en vez de leyendo el código o probando a ver.
 */

import { OrigenError, type ConectorOrigen, type EstadoOrigen } from './tipos'

/** Lo mismo para los dos: se ve, se puede elegir, y al procesar dice qué falta */
function sinConstruir(
  base: Pick<ConectorOrigen, 'id' | 'etiqueta' | 'descripcion' | 'campos'>,
  queFaltaria: string
): ConectorOrigen {
  const aviso =
    `El origen «${base.etiqueta}» está previsto pero todavía no está construido. ${queFaltaria} ` +
    'Mientras tanto, este perfil se puede usar subiendo el fichero a mano: el resto del proceso ' +
    '—lectura, reglas, cruce, frenos y simulacro— es exactamente el mismo.'

  return {
    ...base,
    construido: false,
    // Sin declarar el contexto: no se usa, y una función puede implementar un
    // tipo que reciba más parámetros de los que ella declara.
    async comprobar(): Promise<EstadoOrigen> {
      return { ok: false, mensaje: aviso, candidatos: [] }
    },
    async traer(): Promise<never> {
      throw new OrigenError(aviso)
    },
  }
}

export const conectorSftp = sinConstruir(
  {
    id: 'sftp',
    etiqueta: 'SFTP',
    descripcion:
      'El cliente deja el volcado en un servidor SFTP suyo y el ERP se conecta a leerlo cada cierto tiempo.',
    campos: [
      {
        clave: 'host',
        etiqueta: 'Servidor',
        tipo: 'texto',
        requerido: true,
        ayuda: 'El nombre o la IP del servidor SFTP del cliente.',
        ejemplo: 'sftp.cliente.com',
      },
      {
        clave: 'puerto',
        etiqueta: 'Puerto',
        tipo: 'texto',
        requerido: false,
        ayuda: 'Vacío = 22, que es el habitual.',
        ejemplo: '22',
      },
      {
        clave: 'usuario',
        etiqueta: 'Usuario',
        tipo: 'texto',
        requerido: true,
        ayuda:
          'Solo el usuario. La contraseña o la clave NO se guardan aquí: irán cifradas en su propia columna, como el token de Amazon.',
      },
      {
        clave: 'ruta',
        etiqueta: 'Carpeta',
        tipo: 'texto',
        requerido: true,
        ayuda: 'Carpeta del servidor donde el cliente deja el fichero.',
        ejemplo: '/out/stock',
      },
      {
        clave: 'patron',
        etiqueta: 'Patrón del nombre',
        tipo: 'texto',
        requerido: false,
        ayuda: 'Igual que en Drive: vale * y ?. Vacío = el más reciente de la carpeta.',
        ejemplo: 'STOCK_*.csv',
      },
    ],
  },
  'Falta añadir un cliente de SFTP al proyecto y guardar la credencial cifrada (el patrón está en lib/amazon/crypto.ts, con su propio AAD).'
)

export const conectorCorreo = sinConstruir(
  {
    id: 'correo',
    etiqueta: 'Correo',
    descripcion:
      'El cliente manda el volcado como adjunto a un buzón y el ERP se queda con el último que llegue.',
    campos: [
      {
        clave: 'buzon',
        etiqueta: 'Buzón',
        tipo: 'texto',
        requerido: true,
        ayuda: 'La dirección a la que el cliente manda el fichero.',
        ejemplo: 'stock-cliente@libertyseller.com',
      },
      {
        clave: 'remitente',
        etiqueta: 'Remitente esperado',
        tipo: 'texto',
        requerido: false,
        ayuda:
          'Solo se aceptan adjuntos de esta dirección. Dejarlo vacío significa procesar el adjunto de cualquiera que escriba a ese buzón, que es exactamente como se cuela un fichero que no es del cliente.',
        ejemplo: 'erp@cliente.com',
      },
      {
        clave: 'asunto',
        etiqueta: 'Patrón del asunto',
        tipo: 'texto',
        requerido: false,
        ayuda: 'Para distinguir el correo del volcado del resto. Vale * y ?.',
        ejemplo: 'Stock diario*',
      },
    ],
  },
  'Falta decidir el buzón y cómo se lee (IMAP con credencial cifrada, o un webhook del proveedor de correo).'
)
