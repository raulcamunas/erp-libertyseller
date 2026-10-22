/**
 * QUÉ CARPETAS DE UN BUZÓN SE LEEN.
 * =================================
 * PURO: no toca la base ni la red. Se comprueba con carpetas.prueba.ts.
 *
 * De todo el árbol de carpetas de un buzón solo se leen dos: la ENTRADA y los ENVIADOS. Las demás (borradores,
 * papelera, spam, archivo) no aportan al seguimiento comercial y traerlas multiplicaría el almacenamiento.
 *
 *   · Entrada: siempre se llama INBOX.
 *   · Enviados: cada servidor la llama como quiere («Sent», «INBOX.Sent», «Elementos enviados», «Enviados»…).
 *     Se fía primero del atributo estándar \Sent (RFC 6154), que es lo que dicen los servidores bien configurados,
 *     y si no lo hay se busca por el nombre, en los idiomas habituales.
 */

export interface CarpetaDeServidor {
  path: string
  specialUse?: string | null
  flags?: Iterable<string> | null
  listed?: boolean
}

const NOMBRES_DE_ENVIADOS = /^(?:sent|sent items|sent mail|sent messages|enviados|elementos enviados|mensajes enviados|correo enviado|correos enviados|enviadas|gesendet|gesendete elemente|envoy[eé]s|[eé]l[eé]ments envoy[eé]s|posta inviata|itens enviados)$/i

const sinSeleccion = (c: CarpetaDeServidor): boolean => {
  if (!c.flags) return false
  for (const f of c.flags) if (f.toLowerCase() === '\\noselect' || f.toLowerCase() === '\\nonexistent') return true
  return false
}

/** El último trozo del nombre, sea cual sea el separador: «INBOX.Sent» -> «Sent», «Correo/Enviados» -> «Enviados» */
const ultimoTrozo = (ruta: string): string => ruta.split(/[./\\]/).filter(Boolean).pop() ?? ruta

export function elegirCarpetas(lista: CarpetaDeServidor[]): { entrada: string; enviados: string | null } {
  const validas = lista.filter((c) => !sinSeleccion(c))

  const entrada =
    validas.find((c) => c.path.toUpperCase() === 'INBOX')?.path ??
    validas.find((c) => c.specialUse === '\\Inbox')?.path ??
    'INBOX'

  const porAtributo = validas.find((c) => c.specialUse === '\\Sent')
  if (porAtributo) return { entrada, enviados: porAtributo.path }

  // Por el nombre: se prefiere el que cuelga de la entrada («INBOX.Sent») al suelto solo si no hay otro
  const porNombre = validas.filter((c) => NOMBRES_DE_ENVIADOS.test(ultimoTrozo(c.path)))
  const elegida = porNombre.find((c) => !c.path.toUpperCase().startsWith('INBOX')) ?? porNombre[0]
  return { entrada, enviados: elegida?.path ?? null }
}
