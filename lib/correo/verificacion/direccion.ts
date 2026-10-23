/**
 * ¿ES UNA BUENA DIRECCIÓN DE CORREO? — LA PARTE QUE NO NECESITA RED.
 * ===================================================================
 * PURO: no toca la base ni la red. Se comprueba con direccion.prueba.ts. Sirve igual en el servidor y en el navegador.
 *
 * Mira lo que se puede saber de una dirección solo leyéndola: que esté bien escrita, que no sea una errata de un proveedor conocido
 * («gmial.com»), que no sea de un servicio de correo desechable, que no sea una dirección que no lee nadie («noreply@»), y si el dominio es
 * de un proveedor libre (gmail…), que importa porque ahí «misma empresa» no se puede deducir. Lo que necesita red —si el dominio existe y recibe
 * correo, y si esa dirección ya rebotó antes— lo hace verificar.ts, que usa esto primero.
 *
 * CADA PROBLEMA TIENE UNA GRAVEDAD:
 *   · mala:   enviar ahí es tirar el correo (y sumar un rebote al buzón). No se envía sin que una persona lo confirme.
 *   · dudosa: probablemente un error, pero no se puede asegurar (una errata de gmail.com). Se avisa y se sugiere la corrección.
 *   · info:   no es un problema; es algo que conviene saber («es una dirección genérica: puede leerla otra persona»).
 */

export type GravedadDeDireccion = 'mala' | 'dudosa' | 'info'

export type CodigoDeProblemaDeDireccion =
  | 'vacia'
  | 'sintaxis'
  | 'sin_dominio'
  | 'dominio_sin_punto'
  | 'dominio_no_valido'
  | 'extension_no_valida'
  | 'local_largo'
  | 'dominio_largo'
  | 'dominio_de_ejemplo'
  | 'desechable'
  | 'no_responde'
  | 'errata_de_dominio'
  | 'caracteres_no_ascii'
  | 'parece_inventada'
  | 'generica'

export interface ProblemaDeDireccion {
  codigo: CodigoDeProblemaDeDireccion
  gravedad: GravedadDeDireccion
  texto: string
}

export interface AnalisisDeDireccion {
  /** La dirección limpia (minúsculas, sin espacios, sin «mailto:» ni «< >»). Vacía si no había nada */
  direccion: string
  local: string
  dominio: string
  problemas: ProblemaDeDireccion[]
  /** La dirección corregida, si el problema es una errata clara */
  sugerencia: string | null
  /** El dominio es de un proveedor que usa cualquiera (gmail, hotmail…) */
  esProveedorLibre: boolean
}

/* ------------------------------------------------------------------ */
/* Listas                                                              */
/* ------------------------------------------------------------------ */

/** Los proveedores de correo más usados en España. Una errata de uno de ellos es lo más frecuente que se ve en una lista de contactos */
export const PROVEEDORES_CONOCIDOS: readonly string[] = [
  'gmail.com',
  'hotmail.com',
  'hotmail.es',
  'outlook.com',
  'outlook.es',
  'yahoo.com',
  'yahoo.es',
  'icloud.com',
  'live.com',
  'msn.com',
  'protonmail.com',
  'telefonica.net',
  'movistar.es',
  'orange.es',
  'terra.es',
  'ono.com',
  'wanadoo.es',
  'vodafone.es',
  'gmx.es',
  'gmx.com',
  'aol.com',
]

/** Erratas que se ven de verdad, con su corrección. Además se prueba a distancia 1 de los proveedores conocidos */
const ERRATAS: Readonly<Record<string, string>> = {
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmil.com': 'gmail.com',
  'gmaill.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmali.com': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.comm': 'gmail.com',
  'gmail.es': 'gmail.com',
  'gmail.om': 'gmail.com',
  'gmail.vom': 'gmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmal.com': 'hotmail.com',
  'hotnail.com': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'hotmail.co': 'hotmail.com',
  'hotmail.ez': 'hotmail.es',
  'hotmai.es': 'hotmail.es',
  'hotmial.es': 'hotmail.es',
  'outlok.com': 'outlook.com',
  'outloook.com': 'outlook.com',
  'outlook.con': 'outlook.com',
  'outlook.co': 'outlook.com',
  'outlok.es': 'outlook.es',
  'yaho.es': 'yahoo.es',
  'yahoo.ez': 'yahoo.es',
  'yahooo.es': 'yahoo.es',
  'yaho.com': 'yahoo.com',
  'yahoo.con': 'yahoo.com',
  'yahooo.com': 'yahoo.com',
  'icloud.con': 'icloud.com',
  'iclod.com': 'icloud.com',
  'icloud.co': 'icloud.com',
}

/** Servicios de correo de usar y tirar: nadie lee lo que llega ahí */
export const DOMINIOS_DESECHABLES: ReadonlySet<string> = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  '10minutemail.com',
  '10minutemail.net',
  'yopmail.com',
  'yopmail.fr',
  'trashmail.com',
  'trashmail.net',
  'tempmail.com',
  'temp-mail.org',
  'tempmail.net',
  'throwawaymail.com',
  'getnada.com',
  'sharklasers.com',
  'maildrop.cc',
  'dispostable.com',
  'fakeinbox.com',
  'mintemail.com',
  'mohmal.com',
  'emailondeck.com',
  'spamgourmet.com',
  'mailnesia.com',
  'tempinbox.com',
  'discard.email',
  'grr.la',
  'burnermail.io',
  'mailcatch.com',
  'moakt.com',
  'tmpmail.org',
  'minuteinbox.com',
])

/** Dominios y extensiones reservados para ejemplos y pruebas: no existen de verdad */
const DOMINIOS_DE_EJEMPLO: ReadonlySet<string> = new Set(['example.com', 'example.org', 'example.net', 'test.com', 'tempuri.org', 'domain.com', 'dominio.com', 'email.com', 'correo.com', 'ejemplo.com', 'ejemplo.es', 'ejemplo.org'])
const EXTENSIONES_DE_EJEMPLO: ReadonlySet<string> = new Set(['test', 'example', 'invalid', 'localhost', 'local', 'internal', 'lan', 'home'])

/** Direcciones que no leen personas (o que nunca se deben escribir a ciegas) */
const LOCALES_QUE_NO_RESPONDEN: ReadonlySet<string> = new Set([
  'noreply',
  'no-reply',
  'no_reply',
  'donotreply',
  'do-not-reply',
  'do_not_reply',
  'nonreply',
  'no-responder',
  'noresponder',
  'no-contestar',
  'mailer-daemon',
  'postmaster',
  'bounce',
  'bounces',
  'abuse',
  'spam',
  'unsubscribe',
  'root',
  'daemon',
])

/** Direcciones de contacto genérico: están bien y llegan a alguien, pero puede que no sea quien decide */
const LOCALES_GENERICOS: ReadonlySet<string> = new Set([
  'info',
  'informacion',
  'contacto',
  'contact',
  'hola',
  'hello',
  'ventas',
  'sales',
  'comercial',
  'tienda',
  'shop',
  'pedidos',
  'administracion',
  'admin',
  'soporte',
  'support',
  'atencion',
  'atencioncliente',
  'atencionalcliente',
  'clientes',
  'web',
  'webmaster',
  'oficina',
  'recepcion',
  'direccion',
  'gerencia',
  'marketing',
  'compras',
  'rrhh',
  'facturacion',
  'contabilidad',
])

/** Lo que se pone en una lista cuando no se tiene la dirección de verdad */
const LOCALES_INVENTADOS: ReadonlySet<string> = new Set(['test', 'prueba', 'asdf', 'asd', 'xxx', 'xx', 'nombre', 'tuemail', 'tucorreo', 'email', 'correo', 'usuario', 'user', 'yourname', 'name', 'nombreapellido', 'ejemplo', 'example', 'sample', 'fake', 'falso', 'na', 'n-a', 'none', 'ninguno', 'sinemail', 'nomail', 'noemail', 'nada'])

/* ------------------------------------------------------------------ */
/* Pequeñas ayudas                                                     */
/* ------------------------------------------------------------------ */

const LOCAL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/
const ETIQUETA = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/** Distancia de edición entre dos textos cortos (inserciones, borrados y cambios de una letra, y trasposición de dos contiguas) */
export function distancia(a: string, b: string): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > 2) return 3
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

/** Si el dominio es una errata de un proveedor conocido, cuál sería el bueno */
export function corregirDominio(dominio: string): string | null {
  if (PROVEEDORES_CONOCIDOS.includes(dominio)) return null
  if (ERRATAS[dominio]) return ERRATAS[dominio]
  // A una letra de distancia de un proveedor conocido (solo los de 8 o más letras: con menos, casi cualquier dominio corto se parecería a uno)
  for (const p of PROVEEDORES_CONOCIDOS) {
    if (p.length >= 8 && dominio.length >= 8 && distancia(dominio, p) === 1) return p
  }
  return null
}

/** Pasa un dominio con letras de otros alfabetos o acentos a su forma de red (punycode). Si no se puede, devuelve null */
function dominioAscii(dominio: string): string | null {
  if (/^[\x00-\x7f]*$/.test(dominio)) return dominio
  try {
    const h = new URL(`http://${dominio}`).hostname
    return h === '' ? null : h
  } catch {
    return null
  }
}

/** Quita lo que se cuela al copiar una dirección (espacios de los lados, «< >», «mailto:») y la pone en minúsculas. Los espacios de en medio NO se quitan: son un error */
export function limpiarDireccion(texto: string): string {
  return texto
    .trim()
    .replace(/^<\s*/, '')
    .replace(/\s*>$/, '')
    .replace(/^mailto:\s*/i, '')
    .trim()
    .toLowerCase()
}

/* ------------------------------------------------------------------ */
/* El análisis                                                         */
/* ------------------------------------------------------------------ */

export function analizarDireccion(texto: string): AnalisisDeDireccion {
  const problemas: ProblemaDeDireccion[] = []
  const aviso = (codigo: CodigoDeProblemaDeDireccion, gravedad: GravedadDeDireccion, t: string) => problemas.push({ codigo, gravedad, texto: t })
  const direccion = limpiarDireccion(typeof texto === 'string' ? texto : '')
  const vacio = (): AnalisisDeDireccion => ({ direccion, local: '', dominio: '', problemas, sugerencia: null, esProveedorLibre: false })

  if (direccion === '') {
    aviso('vacia', 'mala', 'No hay ninguna dirección.')
    return vacio()
  }
  const arrobas = direccion.split('@').length - 1
  if (/\s/.test(direccion)) {
    aviso('sintaxis', 'mala', 'Tiene espacios en medio.')
    return vacio()
  }
  if (arrobas === 0) {
    aviso('sintaxis', 'mala', 'Falta la @.')
    return vacio()
  }
  if (arrobas > 1) {
    aviso('sintaxis', 'mala', 'Tiene más de una @.')
    return vacio()
  }
  const [local, dominioCrudo] = direccion.split('@')
  if (local === '') {
    aviso('sintaxis', 'mala', 'Falta lo que va antes de la @.')
    return { ...vacio(), dominio: dominioCrudo }
  }
  if (dominioCrudo === '') {
    aviso('sin_dominio', 'mala', 'Falta el dominio después de la @.')
    return { ...vacio(), local }
  }

  // --- lo de antes de la @ ---
  if (local.length > 64) aviso('local_largo', 'mala', 'Lo que va antes de la @ es demasiado largo.')
  const noAscii = /[^\x00-\x7f]/.test(local)
  if (noAscii) aviso('caracteres_no_ascii', 'dudosa', 'La dirección lleva letras con acento o de otro alfabeto: muchos servidores de correo no las admiten.')
  else if (!LOCAL.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..')) aviso('sintaxis', 'mala', 'Hay caracteres o puntos mal puestos antes de la @.')

  // --- el dominio ---
  const ascii = dominioAscii(dominioCrudo)
  const dominio = ascii ?? dominioCrudo
  if (ascii === null) aviso('dominio_no_valido', 'mala', 'El dominio no es válido.')
  else {
    if (dominio.length > 253) aviso('dominio_largo', 'mala', 'El dominio es demasiado largo.')
    const etiquetas = dominio.split('.')
    if (etiquetas.length < 2) aviso('dominio_sin_punto', 'mala', 'Al dominio le falta la extensión (.com, .es…).')
    else if (etiquetas.some((e) => !ETIQUETA.test(e))) aviso('dominio_no_valido', 'mala', 'El dominio tiene caracteres o puntos mal puestos.')
    else {
      const extension = etiquetas[etiquetas.length - 1]
      if (!/^[a-z]{2,24}$/.test(extension) && !/^xn--[a-z0-9-]{2,}$/.test(extension)) aviso('extension_no_valida', 'mala', `La extensión «.${extension}» no es válida.`)
      if (EXTENSIONES_DE_EJEMPLO.has(extension) || DOMINIOS_DE_EJEMPLO.has(dominio)) aviso('dominio_de_ejemplo', 'mala', 'Es un dominio de ejemplo o de pruebas: no existe de verdad.')
    }
  }

  const esProveedorLibre = PROVEEDORES_CONOCIDOS.includes(dominio) || ['googlemail.com', 'yahoo.com.mx', 'yahoo.com.ar', 'hotmail.fr', 'live.es', 'me.com', 'mac.com', 'proton.me', 'ymail.com'].includes(dominio)

  // --- lo que se sabe de ella ---
  let sugerencia: string | null = null
  if (!problemas.some((p) => p.gravedad === 'mala')) {
    if (DOMINIOS_DESECHABLES.has(dominio)) aviso('desechable', 'mala', 'Es un correo desechable: nadie lee lo que llega ahí.')
    if (LOCALES_QUE_NO_RESPONDEN.has(local)) aviso('no_responde', 'mala', `«${local}@» es una dirección que no lee nadie.`)
    const buena = corregirDominio(dominio)
    if (buena) {
      sugerencia = `${local}@${buena}`
      aviso('errata_de_dominio', 'dudosa', `¿Quisiste decir «${buena}»? «${dominio}» parece una errata.`)
    }
    if (LOCALES_INVENTADOS.has(local)) aviso('parece_inventada', 'dudosa', `«${local}@» parece una dirección de relleno y no una de verdad.`)
    if (LOCALES_GENERICOS.has(local)) aviso('generica', 'info', 'Es una dirección genérica de la empresa: puede que la lea otra persona.')
  }

  return { direccion, local, dominio, problemas, sugerencia, esProveedorLibre }
}
