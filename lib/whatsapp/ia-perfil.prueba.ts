import {
  AJUSTES_DE_SERIE,
  CLAVES_DE_SECCION_DE_WHATSAPP,
  EJEMPLOS_DE_SERIE,
  MAX_MOMENTO,
  MAX_PERFIL,
  MAX_SECCION_DE_WHATSAPP,
  MOMENTOS_DE_SERIE,
  PALABRAS_POR_LONGITUD,
  PERFIL_DE_SERIE,
  SECCIONES_DE_SERIE,
  SECCIONES_DE_WHATSAPP,
  copiaDelPerfil,
  ejemplosDelPerfil,
  esElPerfilDeSerie,
  esfuerzoDelPerfil,
  lineasDeAjustes,
  MANDOS,
  perfilDesdeLaBase,
  palabrasDelPerfil,
  perfilesIguales,
  validarPerfilDeWhatsapp,
} from '@/lib/whatsapp/ia-perfil'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const valido = (entrada: unknown) => {
  const r = validarPerfilDeWhatsapp(entrada)
  return r.ok ? r : null
}
const error = (entrada: unknown) => {
  const r = validarPerfilDeWhatsapp(entrada)
  return r.ok ? null : r.error
}

console.log('\n=== el perfil de serie ===')
{
  ok('tiene todas las secciones, con texto salvo «extra»', CLAVES_DE_SECCION_DE_WHATSAPP.every((c) => (c === 'extra' ? SECCIONES_DE_SERIE.extra === '' : SECCIONES_DE_SERIE[c].length > 100)))
  ok('el editor conoce las seis secciones, cada una con título y ayuda', SECCIONES_DE_WHATSAPP.length === 6 && SECCIONES_DE_WHATSAPP.every((s) => s.titulo.length > 3 && s.ayuda.length > 20 && s.filas >= 3))
  ok('los tres momentos tienen texto', Object.values(MOMENTOS_DE_SERIE).every((m) => m.length > 100))
  ok('los ajustes de serie son cercano, corto, normal, sin emojis y variando', JSON.stringify(AJUSTES_DE_SERIE) === JSON.stringify({ tono: 'cercano', longitud: 'corto', insistencia: 'normal', emojis: 'ninguno', variar: true }))
  ok('sin modelo ni razonamiento propios y con los ejemplos de serie', PERFIL_DE_SERIE.modelo === null && PERFIL_DE_SERIE.esfuerzo === null && PERFIL_DE_SERIE.ejemplosModo === 'serie')
  ok('es válido para su propio validador y no cambia al pasar por él', JSON.stringify(valido(PERFIL_DE_SERIE)?.perfil) === JSON.stringify(PERFIL_DE_SERIE))
  ok('esElPerfilDeSerie lo reconoce, y una copia también', esElPerfilDeSerie(PERFIL_DE_SERIE) && esElPerfilDeSerie(copiaDelPerfil(PERFIL_DE_SERIE)))
  const c = copiaDelPerfil(PERFIL_DE_SERIE)
  c.ajustes.emojis = 'uno'
  ok('cualquier cambio de un mando deja de ser el de serie', !esElPerfilDeSerie(c))
  const c2 = copiaDelPerfil(PERFIL_DE_SERIE)
  c2.modelo = 'gpt-6-sol'
  ok('y el modelo también cuenta', !esElPerfilDeSerie(c2))
  const c3 = copiaDelPerfil(PERFIL_DE_SERIE)
  c3.secciones.extra = '   '
  ok('los espacios al final de un texto no cuentan', esElPerfilDeSerie(c3))
  ok('perfilesIguales: una copia es igual, un mando distinto no, y da igual el orden en que se escribieran las claves', perfilesIguales(PERFIL_DE_SERIE, copiaDelPerfil(PERFIL_DE_SERIE)) && !perfilesIguales(PERFIL_DE_SERIE, c) && perfilesIguales({ ...PERFIL_DE_SERIE, esfuerzo: null, modelo: null }, { modelo: null, esfuerzo: null, momentos: PERFIL_DE_SERIE.momentos, ejemplosModo: 'serie', secciones: PERFIL_DE_SERIE.secciones, ajustes: PERFIL_DE_SERIE.ajustes }))
}

console.log('\n=== los mandos ===')
{
  ok('son cuatro, con título, ayuda y al menos dos opciones con su detalle', MANDOS.length === 4 && MANDOS.every((m) => m.titulo.length > 3 && m.ayuda.length > 10 && m.opciones.length >= 2 && m.opciones.every((o) => o.etiqueta.length > 1 && o.detalle.length > 5)))
  const l = lineasDeAjustes(AJUSTES_DE_SERIE)
  ok('cada mando se convierte en una frase para la IA, y «variar» también', l.map((x) => x.clave).join() === 'tono,longitud,insistencia,emojis,variar' && l.every((x) => x.linea.length > 10))
  ok('sin «variar» no hay frase de variedad', !lineasDeAjustes({ ...AJUSTES_DE_SERIE, variar: false }).some((x) => x.clave === 'variar'))
  ok('cada opción da una frase distinta', new Set(['cercano', 'neutro', 'formal'].map((t) => lineasDeAjustes({ ...AJUSTES_DE_SERIE, tono: t as 'cercano' })[0].linea)).size === 3 && new Set(['muy_corto', 'corto', 'medio'].map((t) => lineasDeAjustes({ ...AJUSTES_DE_SERIE, longitud: t as 'corto' })[1].linea)).size === 3 && new Set(['suave', 'normal', 'directo'].map((t) => lineasDeAjustes({ ...AJUSTES_DE_SERIE, insistencia: t as 'normal' })[2].linea)).size === 3)
  ok('las palabras de cada longitud crecen y el límite de la revisión va por encima del máximo', PALABRAS_POR_LONGITUD.muy_corto.maximo < PALABRAS_POR_LONGITUD.corto.maximo && PALABRAS_POR_LONGITUD.corto.maximo < PALABRAS_POR_LONGITUD.medio.maximo && Object.values(PALABRAS_POR_LONGITUD).every((p) => p.limite > p.maximo && p.minimo < p.maximo))
  ok('las palabras del perfil salen del mando de longitud', palabrasDelPerfil({ ajustes: { ...AJUSTES_DE_SERIE, longitud: 'medio' } }).maximo === 90)
}

console.log('\n=== los ejemplos de tono ===')
{
  ok('«serie»: los del tono elegido', ejemplosDelPerfil(PERFIL_DE_SERIE) === EJEMPLOS_DE_SERIE.cercano && ejemplosDelPerfil({ ...PERFIL_DE_SERIE, ajustes: { ...AJUSTES_DE_SERIE, tono: 'formal' } }) === EJEMPLOS_DE_SERIE.formal)
  ok('«ninguno»: cadena vacía', ejemplosDelPerfil({ ...PERFIL_DE_SERIE, ejemplosModo: 'ninguno' }) === '')
  ok('«propios»: lo que se ha escrito, recortado', ejemplosDelPerfil({ ...PERFIL_DE_SERIE, ejemplosModo: 'propios', secciones: { ...SECCIONES_DE_SERIE, ejemplos: '  [Primer contacto] Hola, soy Raúl.  ' } }) === '[Primer contacto] Hola, soy Raúl.')
  // Sin las etiquetas entre corchetes («[Te he llamado y no contesta]»), que no son del mensaje
  const sinEtiquetas = (t: string) => t.replace(/\[[^\]]+\]/g, '')
  ok('los de serie del trato de usted usan usted y los otros tutean', /\b(le|su|sus)\b/i.test(sinEtiquetas(EJEMPLOS_DE_SERIE.formal)) && !/\b(te|tu|vuestr)/i.test(sinEtiquetas(EJEMPLOS_DE_SERIE.formal)) && /\bte\b/i.test(sinEtiquetas(EJEMPLOS_DE_SERIE.cercano)))
}

console.log('\n=== lo que llega de la pantalla ===')
{
  ok('vacío o sin forma, no', error(null) !== null && error(undefined) !== null && error('hola') !== null && error(5) !== null)
  ok('un objeto vacío vale: se completa con lo de serie', JSON.stringify(valido({})?.perfil) === JSON.stringify(PERFIL_DE_SERIE))
  ok('lo que falta se completa y lo que sobra se ignora', JSON.stringify(valido({ ajustes: { tono: 'formal' }, loQueSobra: 1 })?.perfil.ajustes) === JSON.stringify({ ...AJUSTES_DE_SERIE, tono: 'formal' }))
  ok('un tono, una longitud, una insistencia o unos emojis que no existen, no', error({ ajustes: { tono: 'gritando' } }) !== null && error({ ajustes: { longitud: 'enorme' } }) !== null && error({ ajustes: { insistencia: 'brutal' } }) !== null && error({ ajustes: { emojis: 'muchos' } }) !== null)
  ok('«variar» es un sí o un no', valido({ ajustes: { variar: false } })?.perfil.ajustes.variar === false && valido({ ajustes: { variar: 'sí' } })?.perfil.ajustes.variar === false && valido({ ajustes: {} })?.perfil.ajustes.variar === true)

  ok('un texto que no es texto, no', error({ secciones: { queHacemos: 5 } }) !== null)
  ok('los textos se recortan y se normalizan los saltos de línea', valido({ secciones: { extra: '  hola\r\nadiós  ' } })?.perfil.secciones.extra === 'hola\nadiós')
  ok('un texto demasiado largo, no, y dice cuál', /Qué hacemos/.test(error({ secciones: { queHacemos: 'a'.repeat(MAX_SECCION_DE_WHATSAPP + 1) } }) ?? ''))
  ok('todo junto demasiado largo, no', error({ secciones: Object.fromEntries(CLAVES_DE_SECCION_DE_WHATSAPP.map((c) => [c, 'a'.repeat(MAX_SECCION_DE_WHATSAPP)])) }) !== null && MAX_PERFIL < MAX_SECCION_DE_WHATSAPP * 6)

  ok('un momento se puede cambiar', valido({ momentos: { no_contesta: 'Se le llamó y no cogió el teléfono: dilo y facilita que conteste.' } })?.perfil.momentos.no_contesta.startsWith('Se le llamó') === true)
  ok('un momento vacío o larguísimo, no', error({ momentos: { tras_hablar: '   ' } }) !== null && error({ momentos: { tras_hablar: 'a'.repeat(MAX_MOMENTO + 1) } }) !== null)
  ok('un momento que no es texto, no', error({ momentos: { tras_hablar: 4 } }) !== null)

  ok('los ejemplos propios hay que escribirlos (vacíos, no valen)', error({ ejemplosModo: 'propios', secciones: { ejemplos: '' } }) !== null && valido({ ejemplosModo: 'propios', secciones: { ejemplos: '[Primer contacto] Hola, soy Raúl. ¿Hablamos un momento de Amazon?' } }) !== null)
  ok('una opción de ejemplos que no existe, no', error({ ejemplosModo: 'todos' }) !== null)

  ok('el modelo vacío es el de siempre; uno raro, no; uno bueno, sí', valido({ modelo: '' })?.perfil.modelo === null && valido({ modelo: null })?.perfil.modelo === null && error({ modelo: 'gpt 6' }) !== null && valido({ modelo: 'GPT-6-Sol' })?.perfil.modelo === 'gpt-6-sol')
  ok('el razonamiento: los que existen, sí; «minimal» o uno raro, no; vacío es el de siempre', valido({ esfuerzo: 'none' })?.perfil.esfuerzo === 'none' && valido({ esfuerzo: 'medium' })?.perfil.esfuerzo === 'medium' && valido({ esfuerzo: null })?.perfil.esfuerzo === null && valido({ esfuerzo: '' })?.perfil.esfuerzo === null && error({ esfuerzo: 'minimal' }) !== null && error({ esfuerzo: 'mucho' }) !== null)
}

console.log('\n=== los avisos ===')
{
  ok('pedirle dinero a la IA avisa de que no lo hará', (valido({ secciones: { extra: 'Menciona la facturación de la empresa siempre.' } })?.avisos ?? []).some((a) => /facturación/.test(a)))
  ok('pedirle que invente avisa', (valido({ secciones: { extra: 'Invéntate un caso de éxito.' } })?.avisos ?? []).some((a) => /inventar o fingir/.test(a)))
  ok('también en lo que se espera de un momento', (valido({ momentos: { primer_contacto: 'Habla siempre del dinero que ganan para engancharles de entrada.' } })?.avisos ?? []).some((a) => /facturación/.test(a)))
  ok('tus ejemplos con huecos entre corchetes avisan', (valido({ ejemplosModo: 'propios', secciones: { ejemplos: '[Primer contacto] Hola [Nombre], soy Raúl. ¿Hablamos?' } })?.avisos ?? []).some((a) => /huecos/.test(a)))
  ok('trato de usted con ejemplos que tutean avisa', (valido({ ajustes: { tono: 'formal' }, ejemplosModo: 'propios', secciones: { ejemplos: '[Primer contacto] Hola, soy Raúl. ¿Te cuento cómo vuestra tienda puede crecer?' } })?.avisos ?? []).some((a) => /usted/.test(a)))
  ok('hablar de emojis en lo extra con el mando en «ninguno» avisa de que manda el mando', (valido({ secciones: { extra: 'Usa emojis cuando haya confianza.' } })?.avisos ?? []).some((a) => /manda el ajuste/.test(a)))
  ok('un perfil limpio no avisa de nada', (valido(PERFIL_DE_SERIE)?.avisos ?? []).length === 0)
  ok('los avisos no se repiten', (() => {
    const a = valido({ secciones: { extra: 'Menciona la facturación.', comoPersuades: 'Menciona la facturación.' } })?.avisos ?? []
    return new Set(a).size === a.length
  })())
}

console.log('\n=== lo que sale de la base ===')
{
  ok('un JSON bueno se lee tal cual', JSON.stringify(perfilDesdeLaBase(PERFIL_DE_SERIE)) === JSON.stringify(PERFIL_DE_SERIE))
  ok('uno a medias se completa con lo de serie', perfilDesdeLaBase({ ajustes: { tono: 'neutro' } }).ajustes.tono === 'neutro' && perfilDesdeLaBase({ ajustes: { tono: 'neutro' } }).secciones.queHacemos === SECCIONES_DE_SERIE.queHacemos)
  ok('uno roto da lo de serie, sin lanzar', JSON.stringify(perfilDesdeLaBase({ ajustes: { tono: 'gritando' } })) === JSON.stringify(PERFIL_DE_SERIE) && JSON.stringify(perfilDesdeLaBase(null)) === JSON.stringify(PERFIL_DE_SERIE) && JSON.stringify(perfilDesdeLaBase('basura')) === JSON.stringify(PERFIL_DE_SERIE))
}

console.log('\n=== el razonamiento ===')
{
  ok('el del perfil si lo hay, si no el de siempre', esfuerzoDelPerfil({ esfuerzo: 'low' }, 'none', {}) === 'low' && esfuerzoDelPerfil({ esfuerzo: null }, 'none', {}) === 'none')
  ok('IA_ESFUERZO del servidor manda sobre los dos', esfuerzoDelPerfil({ esfuerzo: 'low' }, 'none', { IA_ESFUERZO: 'high' }) === 'high' && esfuerzoDelPerfil({ esfuerzo: null }, 'none', { IA_ESFUERZO: 'medium' }) === 'medium')
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
