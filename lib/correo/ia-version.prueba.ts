import type { EjemploGanador } from '@/lib/correo/ia-ejemplos'
import {
  MODELOS_DEL_EDITOR,
  PRECIOS_POR_MILLON,
  cambiosEnPorcentaje,
  costeAproximado,
  ejemploPropioParaIa,
  elegirVersion,
  enSorteo,
  montarEjemplos,
  repartoEnPorcentaje,
  similitud,
  validarEjemplo,
  validarModelo,
  validarNombreDeVersion,
  validarPeso,
  versionParaBorrador,
  type EjemploPropio,
} from '@/lib/correo/ia-version'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const cerca = (a: number | null, b: number, tol = 0.00001) => a !== null && Math.abs(a - b) <= tol
const v = (id: string, peso: number, extra: Partial<{ activa: boolean; archivada: boolean }> = {}) => ({ id, peso, activa: true, archivada: false, ...extra })

console.log('\n=== el sorteo ===')
{
  const a = v('a', 50)
  const b = v('b', 50)
  ok('azar 0 -> la primera', elegirVersion([a, b], 0)?.id === 'a')
  ok('azar 0,49 -> la primera', elegirVersion([a, b], 0.49)?.id === 'a')
  ok('azar 0,5 -> la segunda (el límite pasa a la siguiente)', elegirVersion([a, b], 0.5)?.id === 'b')
  ok('azar 0,999 -> la segunda', elegirVersion([a, b], 0.999)?.id === 'b')
  ok('azar fuera de rango no revienta', elegirVersion([a, b], 7)?.id === 'b' && elegirVersion([a, b], -3)?.id === 'a')
  ok('una sola en marcha: siempre esa', elegirVersion([a], 0.3)?.id === 'a' && elegirVersion([a], 0.99)?.id === 'a')
  ok('los pesos mandan: 90/10', elegirVersion([v('x', 90), v('y', 10)], 0.89)?.id === 'x' && elegirVersion([v('x', 90), v('y', 10)], 0.91)?.id === 'y')
  ok('una pausada no entra', elegirVersion([v('x', 50, { activa: false }), v('y', 10)], 0.1)?.id === 'y')
  ok('una archivada no entra', elegirVersion([v('x', 50, { archivada: true }), v('y', 10)], 0.1)?.id === 'y')
  ok('con peso 0 no entra', elegirVersion([v('x', 0), v('y', 10)], 0.1)?.id === 'y')
  ok('si no entra ninguna: null (se usa la original de siempre)', elegirVersion([v('x', 0), v('y', 10, { activa: false })], 0.5) === null && elegirVersion([], 0.5) === null)
  ok('enSorteo', enSorteo(v('x', 1)) && !enSorteo(v('x', 0)) && !enSorteo(v('x', 1, { activa: false })))

  // Reparto real: 10.000 sorteos con 70/30 salen cerca de 70/30
  let cuenta = 0
  for (let i = 0; i < 10000; i++) if (elegirVersion([v('x', 70), v('y', 30)], i / 10000)?.id === 'x') cuenta++
  ok('el reparto sale como el peso (70/30)', cuenta === 7000, String(cuenta))
}

console.log('\n=== versionParaBorrador ===')
{
  const a = v('a', 50)
  const b = v('b', 50)
  ok('sin versión pedida se sortea', versionParaBorrador([a, b], null, 0)?.id === 'a' && versionParaBorrador([a, b], undefined, 0.9)?.id === 'b')
  ok('con la versión del primer borrador se mantiene aunque el sorteo diga otra', versionParaBorrador([a, b], 'a', 0.9)?.id === 'a')
  ok('se mantiene aunque la hayan pausado entre medias', versionParaBorrador([v('a', 50, { activa: false }), b], 'a', 0.9)?.id === 'a')
  ok('pero no si la han archivado: se sortea', versionParaBorrador([v('a', 50, { archivada: true }), b], 'a', 0)?.id === 'b')
  ok('una versión que no existe: se sortea', versionParaBorrador([a, b], 'zzz', 0)?.id === 'a')
}

console.log('\n=== repartoEnPorcentaje ===')
{
  const r = repartoEnPorcentaje([v('a', 50), v('b', 30), v('c', 20), v('d', 99, { activa: false })])
  ok('50/30/20 en porcentajes', r.get('a') === 50 && r.get('b') === 30 && r.get('c') === 20 && !r.has('d'))
  const t = repartoEnPorcentaje([v('a', 1), v('b', 2)])
  ok('1 y 2 -> 33 y 67', t.get('a') === 33 && t.get('b') === 67)
  ok('sin ninguna en marcha, vacío', repartoEnPorcentaje([v('a', 0)]).size === 0)
}

console.log('\n=== los ejemplos que se enseñan ===')
{
  const ej = (id: string, extra: Partial<EjemploPropio> = {}): EjemploPropio => ({
    id,
    titulo: id,
    asunto: `Asunto ${id}`,
    texto: `Hola,\n\nHemos revisado vuestra tienda y vemos una oportunidad clara de ordenar fichas, variantes y publicidad en Amazon sin cargar a vuestro equipo. Ejemplo ${id}.\n\nUn saludo,`,
    tipo: 'ambos',
    nota: null,
    activo: true,
    ...extra,
  })
  const ganador = (id: string, tipo: EjemploGanador['tipo']): EjemploGanador => ({ hiloId: id, buzonId: 'b', asunto: `Auto ${id}`, texto: `Texto automático ${id} con bastante contenido para que sirva de ejemplo en una prueba.`, respondioEn: '2026-10-01T00:00:00Z', tipo })

  const solo = montarEjemplos({ elegidos: [ej('p1'), ej('p2')], ganadores: [ganador('g1', 'entrar')], tipo: 'entrar', usarGanadores: false })
  ok('solo los propios si la versión no pide los automáticos', solo.length === 2 && solo[0].asunto === 'Asunto p1')

  const mezcla = montarEjemplos({ elegidos: [ej('p1')], ganadores: [ganador('g1', 'entrar'), ganador('g2', 'entrar')], tipo: 'entrar', usarGanadores: true })
  ok('los propios van delante y se completa con los automáticos', mezcla.map((m) => m.asunto).join('|') === 'Asunto p1|Auto g1|Auto g2', mezcla.map((m) => m.asunto).join('|'))

  const llenos = montarEjemplos({ elegidos: [ej('p1'), ej('p2'), ej('p3'), ej('p4'), ej('p5')], ganadores: [ganador('g1', 'entrar')], tipo: 'entrar', usarGanadores: true })
  ok('con los propios llenando los 4 huecos no entra ninguno automático', llenos.length === 4 && llenos.every((m) => m.asunto.startsWith('Asunto')))

  const tipos = montarEjemplos({ elegidos: [ej('o', { tipo: 'optimizar' }), ej('e', { tipo: 'entrar' }), ej('a', { tipo: 'ambos' })], ganadores: [], tipo: 'entrar', usarGanadores: false })
  ok('los del mismo tipo de lead delante (entrar y ambos antes que optimizar)', tipos.map((m) => m.asunto).join('|') === 'Asunto e|Asunto a|Asunto o', tipos.map((m) => m.asunto).join('|'))

  const apagado = montarEjemplos({ elegidos: [ej('p1', { activo: false }), ej('p2')], ganadores: [], tipo: 'entrar', usarGanadores: false })
  ok('un ejemplo desactivado no entra', apagado.length === 1 && apagado[0].asunto === 'Asunto p2')

  const dinero = ej('d', { texto: `Hola,\n\nTe escribo por una cosa interesante sobre vuestra tienda de bonsáis en Amazon y la publicidad que podéis ordenar.\n\nVuestra facturación actual ronda los 20.000 € al mes.\n\nUn saludo,` })
  const limpio = ejemploPropioParaIa(dinero)
  ok('las frases de dinero se quitan del ejemplo propio', !!limpio && !/factur|€/.test(limpio.texto) && limpio.texto.includes('bonsáis'), JSON.stringify(limpio))
  ok('un asunto con dinero lo deja fuera', ejemploPropioParaIa({ asunto: 'De 14.000 € a 30.000 €/mes', texto: ej('x').texto }) === null)
  ok('un ejemplo que se queda en nada tras limpiarlo no sirve', ejemploPropioParaIa({ asunto: 'X', texto: 'Tu facturación es de 20.000 € al mes. Y ya.' }) === null)
  const contacto = ejemploPropioParaIa(ej('c', { texto: ej('c').texto + ' Escríbeme a ana@x.es o llama al 600 11 22 33.' }))
  ok('los correos y teléfonos se tapan', !!contacto && !contacto.texto.includes('ana@x.es') && contacto.texto.includes('<correo>'))
}

console.log('\n=== cuánto cuesta un borrador ===')
{
  ok('terra: 3.100 de entrada y 210 de salida son unos 0,9 céntimos', cerca(costeAproximado('gpt-5.6-terra', { entrada: 3100, salida: 210 }), 0.00872))
  ok('luna es unas 10 veces más barata que terra', (costeAproximado('gpt-5.6-terra', { entrada: 3000, salida: 200 }) as number) / (costeAproximado('gpt-5.6-luna', { entrada: 3000, salida: 200 }) as number) > 8)
  ok('un modelo que no se conoce o sin tokens: null', costeAproximado('gpt-9', { entrada: 1, salida: 1 }) === null && costeAproximado('gpt-5.5', null) === null)
  ok('todos los modelos del editor tienen precio (salvo «el de siempre», que es terra)', MODELOS_DEL_EDITOR.every((m) => m.id === null || PRECIOS_POR_MILLON[m.id] !== undefined) && MODELOS_DEL_EDITOR[0].id === null)
}

console.log('\n=== similitud y cambios ===')
{
  ok('un texto contra sí mismo: 1', similitud('Hola, esto es una prueba', 'Hola, esto es una prueba') === 1)
  ok('no distingue mayúsculas ni signos', similitud('Hola, Ana. ¿Qué tal?', 'hola ana qué tal') === 1)
  ok('dos textos sin nada en común: 0', similitud('uno dos tres', 'cuatro cinco seis') === 0)
  ok('vacíos: 1; uno vacío: 0', similitud('', '') === 1 && similitud('hola', '') === 0)
  const base = 'te escribo porque hemos revisado vuestra tienda y vemos una oportunidad'
  const cambiado = 'te escribo porque hemos revisado vuestra web y vemos una gran oportunidad'
  const s = similitud(base, cambiado)
  ok('un par de palabras cambiadas: parecido alto', s > 0.8 && s < 1, String(s))
  ok('cambios en porcentaje', cambiosEnPorcentaje('a b c d e f g h i j', 'a b c d e f g h i j') === 0 && cambiosEnPorcentaje('a b c d', 'x y z w') === 100)
  ok('añadir una frase se nota', cambiosEnPorcentaje(base, `${base} y además os propongo una llamada de diez minutos esta semana`) > 25)
}

console.log('\n=== lo que llega del editor ===')
{
  ok('nombre bueno', validarNombreDeVersion('  Versión   más directa ').ok === true && (validarNombreDeVersion('  Versión   más directa ') as { nombre: string }).nombre === 'Versión más directa')
  ok('nombre vacío / largo / no texto', !validarNombreDeVersion('  ').ok && !validarNombreDeVersion('x'.repeat(81)).ok && !validarNombreDeVersion(5).ok)
  ok('modelo vacío o null = el de siempre', (validarModelo('') as { modelo: null }).modelo === null && (validarModelo(null) as { modelo: null }).modelo === null)
  ok('un modelo válido va en minúsculas', (validarModelo(' GPT-5.6-Luna ') as { modelo: string }).modelo === 'gpt-5.6-luna')
  ok('un modelo con cosas raras se rechaza', !validarModelo('gpt 5; drop').ok && !validarModelo('../x').ok && !validarModelo(7).ok)
  ok('peso válido', validarPeso(0).ok && validarPeso(100).ok && validarPeso('35').ok)
  ok('peso inválido', !validarPeso(-1).ok && !validarPeso(101).ok && !validarPeso(2.5).ok && !validarPeso('mucho').ok && !validarPeso('').ok)

  const bueno = validarEjemplo({ titulo: 'Mi favorito', asunto: 'Una idea para Acme', texto: 'Hola,\n\n' + 'Hemos revisado vuestra tienda y vemos una oportunidad clara para trabajar mejor las fichas. '.repeat(2), tipo: 'entrar' })
  ok('un ejemplo bueno se guarda sin avisos', bueno.ok && bueno.avisos.length === 0 && bueno.ejemplo.tipo === 'entrar')
  ok('sin título usa el asunto', validarEjemplo({ asunto: 'Una idea para Acme', texto: 'x'.repeat(130) }).ok && (validarEjemplo({ asunto: 'Una idea para Acme', texto: 'x'.repeat(130) }) as { ejemplo: { titulo: string } }).ejemplo.titulo === 'Una idea para Acme')
  ok('tipo raro pasa a «ambos»', (validarEjemplo({ asunto: 'A', texto: 'x'.repeat(130), tipo: 'otro' }) as { ejemplo: { tipo: string } }).ejemplo.tipo === 'ambos')
  ok('sin asunto, texto corto o largo: error', !validarEjemplo({ texto: 'x'.repeat(130) }).ok && !validarEjemplo({ asunto: 'A', texto: 'corto' }).ok && !validarEjemplo({ asunto: 'A', texto: 'x'.repeat(4001) }).ok && !validarEjemplo(null).ok)
  const dinero = validarEjemplo({ asunto: 'A', texto: `${'Hola, hemos revisado vuestra tienda. '.repeat(4)} Facturáis 20.000 € al mes.` })
  ok('avisa si habla de dinero (y lo guarda)', dinero.ok && dinero.avisos.some((a) => /facturación|dinero/i.test(a)))
  const huecos = validarEjemplo({ asunto: 'A', texto: `${'Hola [Nombre], hemos revisado vuestra tienda. '.repeat(4)}` })
  ok('avisa si tiene huecos', huecos.ok && huecos.avisos.some((a) => /huecos/i.test(a)))
  const contacto = validarEjemplo({ asunto: 'A', texto: `${'Hola, hemos revisado vuestra tienda online. '.repeat(4)} Escríbeme a ana@x.es.` })
  ok('avisa si lleva un correo', contacto.ok && contacto.avisos.some((a) => /correo o un teléfono/i.test(a)))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
