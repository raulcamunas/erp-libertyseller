/**
 * LOS CORREOS DEL EQUIPO QUE FUNCIONARON, PARA QUE LA IA APRENDA DE ELLOS.
 * =========================================================================
 * PURO: no toca la base ni la red. Se comprueba con ia-ejemplos.prueba.ts.
 *
 * «Aprender» aquí NO es entrenar un modelo: es enseñarle a la IA, cada vez que redacta, los correos fríos reales del equipo a los que un
 * cliente DE FUERA contestó algo que no era un «no». Como esos ejemplos se vuelven a elegir en cada redacción, cuantos más correos
 * obtengan respuesta, mejores son los que ve; y un correo que la IA redactó, el comercial editó y el cliente contestó entra solo en el
 * montón, con las ediciones hechas (lo que se guarda en el buzón es lo que salió de verdad).
 *
 *
 * ============ QUÉ ES UNA «RESPUESTA» (y qué no) ============
 *
 * Con los datos reales de oct 2026, de 25 hilos fríos que parecían tener respuesta, 12 eran del PROPIO equipo (los comerciales
 * probándose los correos a sí mismos: remitente del dominio de los buzones) y varios más eran un «no estamos interesados». Contarlos
 * habría enseñado a la IA a copiar pruebas y rechazos. Por eso un ejemplo exige:
 *
 *   1. que el hilo EMPIECE con un correo nuestro (un frío, no una conversación que nos escribió a nosotros);
 *   2. una respuesta de una PERSONA de fuera: no automática, no de un dominio de los buzones del equipo, no de un «no-reply»;
 *   3. que esa respuesta no sea un rechazo (`esRechazo`).
 *
 * LA APERTURA NO SE MIDE. Sin un píxel de seguimiento en el correo no hay forma de saber si se abrió, y el píxel es lo que menos
 * se debe poner en un correo de venta (los filtros lo penalizan y Apple y Gmail lo falsean). Lo que mide esto es la respuesta.
 *
 *
 * ============ LO QUE NUNCA ENTRA EN UN EJEMPLO ============
 *
 * Raúl pidió que la IA no diga NADA de facturación. Muchos correos reales del equipo la mencionan («estimamos una facturación cercana a
 * los 20.200 €/mes»), y si se enseñaran como ejemplos la IA los imitaría. Un correo con cifras de dinero o con la palabra se descarta
 * entero (`mencionaFacturacion`), y la misma comprobación se aplica a lo que la IA escribe antes de enseñárselo a nadie.
 * Tampoco entra el texto de las respuestas de los clientes (solo se sabe que contestaron), ni sus correos ni teléfonos.
 */

export interface MensajeDeHilo {
  hiloId: string
  buzonId: string
  direccion: 'entrante' | 'saliente'
  deDireccion: string
  fecha: string
  automatico: boolean
  asunto: string
  texto: string
}

export interface EjemploGanador {
  hiloId: string
  buzonId: string
  asunto: string
  /** El cuerpo ya limpio: sin citas, sin firma, sin correos ni teléfonos */
  texto: string
  /** Cuándo llegó la primera respuesta que no era un rechazo */
  respondioEn: string
  /** A quién iba: una empresa que ya vende en Amazon o una que todavía no. Lo dice el texto, no el lead */
  tipo: 'entrar' | 'optimizar'
}

/* ------------------------------------------------------------------ */
/* Comprobaciones de texto                                             */
/* ------------------------------------------------------------------ */

/**
 * ¿Habla de dinero de la empresa? La palabra «facturación», lo que «factura» al mes, «ingresos», «ventas mensuales» y CUALQUIER cifra
 * con euros, dólares o «€/mes». «Ingresa a Amazon» (entrar en Amazon) NO cuenta: es «ingresos» lo que se busca, no «ingreso».
 */
export function mencionaFacturacion(texto: string): boolean {
  const t = texto
  return (
    /facturaci[oó]n/i.test(t) ||
    /\bfactur(a|an|as|amos|ar|ando|ado)\b[^.\n]{0,60}(€|euros?|\bmes\b|\ba[ñn]o\b|millon|\bk\b|\d)/i.test(t) ||
    /\bingresos\b|\bventas\s+(mensuales|anuales|estimadas|totales)\b|\bvolumen\s+de\s+(ventas|negocio)\b|\bcifra\s+de\s+(negocio|ventas)\b|\brevenue\b|\bturnover\b/i.test(t) ||
    // Una cantidad pegada a una moneda, en cualquier orden: «20.200 €», «16.8k €/mes», «€20k», «$5,000», «30 mil euros»
    /\d[\d.,]*\s*(k|m|mil|millones?)?\s*(€|\beur\b|\beuros?\b|\busd\b|\bd[oó]lares\b|\$)/i.test(t) ||
    /[€$]\s*\d/.test(t)
  )
}

/**
 * ¿Es un «no»? Mira el principio de la respuesta (lo que escribió, no lo que citó debajo). Se prefiere dejar pasar un «no» educado que
 * tirar un «sí»: un falso rechazo solo quita un ejemplo; un falso positivo enseñaría a copiar un correo que no funcionó.
 */
export function esRechazo(textoDeLaRespuesta: string): boolean {
  const t = limpiarCuerpo(textoDeLaRespuesta).slice(0, 700).toLowerCase()
  return (
    /\bno\s+(estamos|estoy|nos|me|es|era)\s+(interesad|el\s+momento)/.test(t) ||
    /\bno\s+(nos|me)\s+(interesa|hace\s+falta|hacen\s+falta|encaja|conviene)/.test(t) ||
    /\bno\s+(necesitamos|necesito|queremos|quiero|contratamos)\b/.test(t) ||
    /\bno,?\s+gracias\b/.test(t) ||
    /\bseguiremos\s+(como|igual|con)\b/.test(t) ||
    /\b(ya\s+)?(tenemos|tengo|contamos\s+con|trabajamos\s+con)\s+(una\s+|un\s+|nuestra\s+|nuestro\s+)?(empresa|agencia|persona|equipo|proveedor|gestor|responsable)\b[^.]{0,60}\b(amazon|externa|externo|se\s+ocupa|se\s+encarga|lleva|gestiona)/.test(t) ||
    /\b(lo|la)\s+(lleva|gestiona|gestionamos|llevamos)\s+(una\s+|un\s+|nuestra\s+|nuestro\s+|otra\s+|otro\s+)?(empresa|agencia|persona|equipo|externa|externo)/.test(t) ||
    /\bdar(me|nos)?\s+de\s+baja\b|\bno\s+(me\s+|nos\s+)?(vuelvan?|volv[aá]is|escriban?|escrib[aá]is|contacten?|contact[eé]is)\b|\bunsubscribe\b|\bremove\s+me\b/.test(t)
  )
}

/** Remitentes que nunca son una persona contestando: avisos, colas de soporte, rebotes */
const NO_ES_UNA_PERSONA = /no-?reply|noreply|donotreply|do-not-reply|mailer-daemon|postmaster|zendesk|notificaci|notification|bounce|autoreply|auto-reply/i

/** El dominio de una dirección, en minúsculas */
export const dominioDe = (direccion: string): string => direccion.trim().toLowerCase().split('@').pop() ?? ''

/** Quita correos y teléfonos de un texto: lo que sale hacia la IA no lleva datos de contacto de nadie */
export function sinDatosDeContacto(texto: string): string {
  return texto
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<correo>')
    .replace(/(\+\s?\d{1,3}[\s.-]?)?(\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}(?!\d)/g, (m) => (m.replace(/\D/g, '').length >= 8 ? '<teléfono>' : m))
}

/**
 * El cuerpo de un correo SIN lo que lo rodea: sin las líneas citadas («> …»), sin el «El lunes, X escribió:» y todo lo que va detrás,
 * sin la firma («--») ni los pies que añaden los programas («Sent with Hostinger Mail»).
 */
export function limpiarCuerpo(texto: string): string {
  // Hay clientes de correo que aplanan todo en una línea: «Hola. El jue, 22 oct, X escribió: > …». Se corta ahí también
  const plano = texto
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+(El|On)\s+(lun|mar|mi[eé]|jue|vie|s[aá]b|dom|mon|tue|wed|thu|fri|sat|sun)[^\n]{3,200}?(escribi[oó]|wrote)\s*:[\s\S]*$/i, '')
  const lineas = plano.split('\n')
  const salida: string[] = []
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i].trimEnd()
    const t = l.trim()
    // Aquí empieza lo citado o la firma: de aquí en adelante no es lo que escribió esta persona
    if (/^(El|On)\s.{3,200}(escribi[oó]|wrote)\s*:?\s*$/i.test(t)) break
    // El mismo encabezado partido en dos líneas: «El jue, 22 oct 2026, Ana López» / «<ana@x.es> escribió:»
    if (/^(El|On)\s.{3,200}$/i.test(t) && /(escribi[oó]|wrote)\s*:\s*$/i.test((lineas[i + 1] ?? '').trim())) break
    if (/^-{2,}\s*(Original Message|Mensaje original|Forwarded message|Mensaje reenviado)/i.test(t)) break
    if (/^(De|From|Enviado el|Sent)\s*:\s/i.test(t) && salida.length > 0) break
    if (/^--\s*$/.test(l)) break
    if (/^\s*>/.test(l)) continue
    if (/^(sent with|enviado desde|get outlook|obt[eé]n outlook)/i.test(t)) continue
    salida.push(l)
  }
  return salida.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Une las líneas que un programa de correo partió a mano a unas 80 columnas, para que un párrafo sea un párrafo. Una línea corta
 * (un saludo, una viñeta) y las que empiezan por un marcador de lista se dejan como están.
 */
export function unirLineasPartidas(texto: string): string {
  const lineas = texto.split('\n')
  const salida: string[] = []
  for (const linea of lineas) {
    const anterior = salida[salida.length - 1]
    const empiezaItem = /^\s*([*\-•·▪●]|\d{1,2}[.)])\s/.test(linea)
    if (anterior !== undefined && anterior.trim() !== '' && linea.trim() !== '' && anterior.length >= 60 && !empiezaItem && !/[:]\s*$/.test(anterior)) {
      salida[salida.length - 1] = `${anterior.trimEnd()} ${linea.trim()}`
    } else {
      salida.push(linea)
    }
  }
  return salida.join('\n')
}

/**
 * Quita de un texto las FRASES que hablan de dinero y deja el resto. Es lo que permite aprender de los mejores correos del equipo, que
 * casi todos traen una frase con la facturación estimada de la empresa: sin ella siguen enseñando cómo se abre, qué se propone y cómo se
 * cierra, que es para lo que sirven. Devuelve cuántas frases ha quitado: quien lo usa descarta el ejemplo si fueron demasiadas.
 */
export function quitarFrasesConDinero(texto: string): { texto: string; quitadas: number } {
  let quitadas = 0
  const bloques: string[] = []
  for (const parrafo of texto.split(/\n{2,}/)) {
    const lineas: string[] = []
    for (const linea of parrafo.split('\n')) {
      if (!mencionaFacturacion(linea)) {
        lineas.push(linea)
        continue
      }
      // Una viñeta con dinero se va entera: partida por la frase quedaría «* Segunda:» colgando
      if (/^\s*([*\-•·▪●]|\d{1,2}[.)])\s/.test(linea)) {
        quitadas++
        continue
      }
      // Se parte por las frases (un punto seguido de un espacio), no por los puntos de «20.200»
      const frases = linea.replace(/([.!?:;])\s+/g, '$1\u0000').split('\u0000')
      const buenas = frases.filter((f) => !mencionaFacturacion(f))
      quitadas += frases.length - buenas.length
      if (buenas.length > 0) lineas.push(buenas.join(' '))
    }
    const bloque = lineas.join('\n').trim()
    if (bloque !== '') bloques.push(bloque)
  }
  return { texto: bloques.join('\n\n'), quitadas }
}

/**
 * Los nombres de las personas del equipo («Soy María Fernanda, de Liberty Seller») y el nombre al que se saluda («Estimada Aitiana») se
 * quitan de un ejemplo: la IA los copiaría en el correo de otro comercial a otra persona. El saludo se deja en un «Hola,» y los nombres
 * del equipo en «<comercial>». Lo demás (la empresa de la que se habla) lo sigue marcando el aviso de no copiar datos de los ejemplos.
 */
export function neutralizarNombres(texto: string, nombresDelEquipo: readonly string[]): string {
  let t = texto
  // Cada palabra de cada nombre («Maoli Carolina Arias» -> Maoli, Carolina, Arias), de más larga a más corta, sin tocar las de 1-2 letras.
  // Sin mirar tildes: el buzón dice «Maria Fernanda» y el correo firma «María Fernanda»
  const palabras = [
    ...new Set(
      nombresDelEquipo
        .flatMap((n) => n.split(/\s+/))
        .map((w) => w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z]/g, '').toLowerCase())
        .filter((w) => w.length >= 3)
    ),
  ].sort((a, b) => b.length - a.length)
  const conTildes = (w: string) => w.replace(/a/g, '[aáàäâ]').replace(/e/g, '[eéèëê]').replace(/i/g, '[iíìïî]').replace(/o/g, '[oóòöô]').replace(/u/g, '[uúùüû]').replace(/n/g, '[nñ]')
  for (const w of palabras) t = t.replace(new RegExp(`(?<![\\p{L}])${conTildes(w)}(?![\\p{L}])`, 'giu'), '<comercial>')
  t = t.replace(/(?:<comercial>\s+)+<comercial>/g, '<comercial>')
  // La primera línea, si es un saludo con un nombre o una empresa («Estimada Aitiana», «Hola, equipo de Ecopet»), queda en un «Hola,»
  const lineas = t.split('\n')
  const i = lineas.findIndex((l) => l.trim() !== '')
  if (i >= 0 && lineas[i].trim().length <= 80 && /^(hola|estimad[oa]s?|buen[oa]s\s+\p{L}+|querid[oa]s?|apreciad[oa]s?)\b/iu.test(lineas[i].trim())) lineas[i] = 'Hola,'
  return lineas.join('\n')
}

/* ------------------------------------------------------------------ */
/* Elegir los ejemplos                                                 */
/* ------------------------------------------------------------------ */

const ENTRAR = /\b(a[uú]n|todav[ií]a)\s+no\s+(est[aá]is|est[aá]n|cuent|vend|ten[eé]is|tienen)\w*[^.]{0,80}amazon|no\s+(est[aá]is|est[aá]n)\s+(presentes|vendiendo)\s+en\s+amazon|\bingres(o|a|ar|ando)\b[^.]{0,30}amazon|expansi[oó]n\s+(a|en)\s+amazon|llevar\w*\s[^.]{0,60}\sa\s+amazon|vender\s[^.]{0,60}\sen\s+(toda\s+)?(espa[nñ]a|amazon)|no\s+cuent(a|an)\s+con\s+(una\s+)?(tienda|presencia)|no\s+(encontramos|vemos|hemos\s+(encontrado|visto|localizado))[^.]{0,50}presencia|\bcomo\s+vendedor\s+directo\b/i

/** ¿El correo es para una empresa que todavía no vende en Amazon o para una que ya vende? Lo dice el propio texto */
export function tipoDeEjemplo(texto: string, asunto = ''): EjemploGanador['tipo'] {
  return ENTRAR.test(`${asunto}\n${texto}`) ? 'entrar' : 'optimizar'
}

const MIN_CARACTERES = 250
const MAX_CARACTERES = 3500
const MAX_ASUNTO = 140
/** Un ejemplo al que hubo que quitar más frases que esto se descarta: sin ellas ya no se entiende */
const MAX_FRASES_QUITADAS = 3

/**
 * Los mejores correos fríos del equipo, los más recientes primero.
 *
 * `dominiosPropios` son los de las direcciones de los buzones: lo que escriba alguien desde ahí es del equipo, no un cliente. Como mucho
 * `porBuzon` ejemplos de cada comercial, para que la IA no aprenda la manía de uno solo.
 */
export function elegirGanadores(
  mensajes: readonly MensajeDeHilo[],
  opciones: { dominiosPropios: ReadonlySet<string>; nombresDelEquipo?: readonly string[]; max?: number; porBuzon?: number }
): EjemploGanador[] {
  const max = opciones.max ?? 8
  const porBuzon = opciones.porBuzon ?? 3
  const hilos = new Map<string, MensajeDeHilo[]>()
  for (const m of mensajes) {
    const l = hilos.get(m.hiloId)
    if (l) l.push(m)
    else hilos.set(m.hiloId, [m])
  }

  const candidatos: EjemploGanador[] = []
  for (const [hiloId, lista] of hilos) {
    lista.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0))
    const primero = lista[0]
    // Un frío: el hilo empieza con un correo escrito por una persona del equipo
    if (primero.direccion !== 'saliente' || primero.automatico || !opciones.dominiosPropios.has(dominioDe(primero.deDireccion))) continue

    const buenas = lista.slice(1).filter((m) => {
      if (m.direccion !== 'entrante' || m.automatico) return false
      if (opciones.dominiosPropios.has(dominioDe(m.deDireccion))) return false
      if (NO_ES_UNA_PERSONA.test(m.deDireccion)) return false
      return !esRechazo(m.texto)
    })
    if (buenas.length === 0) continue

    const asunto = primero.asunto.replace(/\s+/g, ' ').trim()
    if (asunto === '' || asunto.length > MAX_ASUNTO || /\b(prueba|test)\b/i.test(asunto) || mencionaFacturacion(asunto)) continue
    // Sin las frases de dinero: el ejemplo enseña la forma, no las cifras. Si hubo que quitar muchas, ya no es el mismo correo
    const { texto: sinDinero, quitadas } = quitarFrasesConDinero(unirLineasPartidas(sinDatosDeContacto(limpiarCuerpo(primero.texto))))
    // Un corchete suelto o un campo sin rellenar se mira ANTES de neutralizar: el saludo «Hola [Nombre],» desaparece al dejarlo en «Hola,»
    if (/\{\{|[\[\]]/.test(sinDinero)) continue
    const texto = neutralizarNombres(sinDinero, opciones.nombresDelEquipo ?? [])
    if (quitadas > MAX_FRASES_QUITADAS || mencionaFacturacion(texto)) continue
    if (texto.length < MIN_CARACTERES || texto.length > MAX_CARACTERES) continue

    candidatos.push({ hiloId, buzonId: primero.buzonId, asunto, texto, respondioEn: buenas[0].fecha, tipo: tipoDeEjemplo(texto, asunto) })
  }

  candidatos.sort((a, b) => (a.respondioEn < b.respondioEn ? 1 : a.respondioEn > b.respondioEn ? -1 : 0))
  const cuenta = new Map<string, number>()
  const salida: EjemploGanador[] = []
  for (const c of candidatos) {
    const n = cuenta.get(c.buzonId) ?? 0
    if (n >= porBuzon) continue
    cuenta.set(c.buzonId, n + 1)
    salida.push(c)
    if (salida.length >= max) break
  }
  return salida
}

/**
 * Cuáles se le enseñan a la IA para ESTE lead: primero los de su mismo tipo (un correo para entrar en Amazon enseña poco a quien ya
 * vende ahí), y se rellena con los demás hasta `cuantos`.
 */
export function ejemplosParaLead(ganadores: readonly EjemploGanador[], tipo: EjemploGanador['tipo'], cuantos = 4): EjemploGanador[] {
  const mismos = ganadores.filter((g) => g.tipo === tipo)
  const otros = ganadores.filter((g) => g.tipo !== tipo)
  return [...mismos, ...otros].slice(0, cuantos)
}
