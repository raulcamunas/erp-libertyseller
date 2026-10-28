import { INTENTOS_MAXIMOS, MINUTOS_DE_LLAMADA_RECIENTE, PALABRAS_MINIMAS, SEGUNDOS_DE_MARGEN_DEL_AUDIO, audioAMedias, esLlamadaReciente, esperaTrasFallo, palabrasDe, pistasDeLaLlamada, primerNombre, sinContenido } from '@/lib/transcripcion/reglas'
import { costeDeTexto, costeDeVoz, enDolares } from '@/lib/transcripcion/precios'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const cerca = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol

console.log('\n=== cuándo reintentar ===')
{
  ok('tras el primer fallo se espera 3 minutos', esperaTrasFallo(1) === 3 * 60_000)
  ok('tras el segundo, 20 minutos', esperaTrasFallo(2) === 20 * 60_000)
  ok('tras el tercero ya no se reintenta', esperaTrasFallo(INTENTOS_MAXIMOS) === null && esperaTrasFallo(7) === null)
  ok('con 0 intentos (no debería pasar) no revienta', esperaTrasFallo(0) === 3 * 60_000)
}

console.log('\n=== ¿hay algo que resumir? ===')
{
  ok('contar palabras', palabrasDe('  hola   buenas tardes ') === 3 && palabrasDe('') === 0 && palabrasDe('   ') === 0)
  ok('vacío = sin contenido', sinContenido('') && sinContenido('   '))
  ok('un «¿diga? no, perdone» = sin contenido', sinContenido('¿Diga? No, perdone, me he equivocado.'))
  ok(`justo en el mínimo (${PALABRAS_MINIMAS}) ya es contenido`, !sinContenido(Array(PALABRAS_MINIMAS).fill('palabra').join(' ')))
  ok(`uno menos que el mínimo no`, sinContenido(Array(PALABRAS_MINIMAS - 1).fill('palabra').join(' ')))
}

console.log('\n=== nombre de pila ===')
{
  ok('solo la primera palabra', primerNombre('Maoli García Pérez') === 'Maoli')
  ok('limpia saltos y espacios', primerNombre('  Ana\n María ') === 'Ana')
  ok('vacío o nulo -> null', primerNombre('') === null && primerNombre(null) === null && primerNombre(undefined) === null && primerNombre('   ') === null)
}

console.log('\n=== las pistas para el oído de la IA ===')
{
  const p = pistasDeLaLlamada({ empresa: 'Joe Black Pets', comercial: 'Maoli García' })
  ok('palabras: la marca, Amazon y la tienda', p.palabras === 'Liberty Seller, Amazon, Joe Black Pets', p.palabras)
  ok('el contexto nombra al comercial y a la tienda', p.prompt.includes('Maoli, comercial') && p.prompt.includes('Joe Black Pets') && p.prompt.includes('Liberty Seller'))
  ok('el contexto no lleva el apellido', !p.prompt.includes('García'))

  const rara = pistasDeLaLlamada({ empresa: 'Casa <Paco>\ny Hijos, S.L.', comercial: null })
  ok('sin < > ni saltos de línea ni comas en las palabras (la API rechaza la petición entera)', !/[<>\r\n]/.test(rara.palabras) && rara.palabras.split(', ').length === 3, rara.palabras)
  ok('sin comercial: «un comercial»', rara.prompt.includes('un comercial de Liberty Seller'))

  const sin = pistasDeLaLlamada({ empresa: null, comercial: null })
  ok('sin tienda no se inventa una palabra', sin.palabras === 'Liberty Seller, Amazon' && sin.prompt.includes('una empresa'))

  const larga = pistasDeLaLlamada({ empresa: 'X'.repeat(500), comercial: 'Y'.repeat(500) })
  ok('con nombres larguísimos el contexto cabe y la palabra se recorta', larga.prompt.length <= 300 && larga.palabras.length <= 'Liberty Seller, Amazon, '.length + 60, `${larga.prompt.length}/${larga.palabras.length}`)

  const repetida = pistasDeLaLlamada({ empresa: 'Amazon', comercial: null })
  ok('una palabra repetida no sale dos veces', repetida.palabras === 'Liberty Seller, Amazon', repetida.palabras)
}

console.log('\n=== llamadas que acaban de colgar ===')
{
  const ahora = Date.parse('2026-10-28T10:00:00Z')
  // Empezó a las 09:58:00 y duró 60 s: colgó a las 09:59:00, hace un minuto
  ok('colgó hace 1 minuto: es reciente', esLlamadaReciente('2026-10-28T09:58:00Z', 60, ahora))
  ok('se cuenta desde que CUELGA, no desde que empezó (una de 30 min que empezó hace 31 acaba de colgar)', esLlamadaReciente('2026-10-28T09:29:00Z', 30 * 60, ahora) && !esLlamadaReciente('2026-10-28T09:29:00Z', 20 * 60, ahora))
  ok('colgó hace 5 minutos: todavía', esLlamadaReciente('2026-10-28T09:54:00Z', 60, ahora))
  ok('colgó hace 7 minutos: ya no', !esLlamadaReciente('2026-10-28T09:52:00Z', 60, ahora) && MINUTOS_DE_LLAMADA_RECIENTE === 6)
  ok('justo en el límite (6 minutos) ya no es reciente', !esLlamadaReciente('2026-10-28T09:53:00Z', 60, ahora))
  ok('una fecha que no se entiende NO es reciente (se trata como siempre)', !esLlamadaReciente('ayer', 60, ahora) && !esLlamadaReciente('', 60, ahora))
  ok('una duración negativa no rompe nada', esLlamadaReciente('2026-10-28T09:59:00Z', -5, ahora))
  ok('una llamada que según el reloj acaba en el futuro (reloj desajustado) cuenta como reciente', esLlamadaReciente('2026-10-28T10:05:00Z', 60, ahora))

  ok('audio de 60 s en una llamada de 60: entero', !audioAMedias(60, 60))
  ok('el audio mide entre 1 s menos y 2 s más que la llamada (medido en 104 llamadas): entero', !audioAMedias(59, 60) && !audioAMedias(62, 60))
  ok('4 s menos: se acepta; 5 s menos: a medias', !audioAMedias(56, 60) && audioAMedias(55, 60) && SEGUNDOS_DE_MARGEN_DEL_AUDIO === 4)
  ok('20 s de una llamada de 60: a medias', audioAMedias(20, 60))
  ok('sin saber cuánto audio había, no se puede decir que esté a medias', !audioAMedias(null, 60))
  ok('una llamada corta (22 s) con 18 s de audio se acepta, con 17 no', !audioAMedias(18, 22) && audioAMedias(17, 22))
}

console.log('\n=== precios ===')
{
  ok('73 s con gpt-transcribe = 0,005475 $ (lo que cobró la prueba)', cerca(costeDeVoz('gpt-transcribe', 73), (73 / 60) * 0.0045))
  ok('un minuto del mini cuesta 0,003', cerca(costeDeVoz('gpt-4o-mini-transcribe', 60), 0.003))
  ok('un modelo desconocido se cuenta al precio MÁS ALTO (el tope salta antes, no después)', cerca(costeDeVoz('modelo-nuevo', 60), 0.006))
  ok('segundos negativos no restan', costeDeVoz('gpt-transcribe', -50) === 0)

  // La prueba real: 981 tokens de entrada y 489 de salida con gpt-6-luna = 0,00034 $
  ok('texto: gpt-6-luna con 981/489 tokens ≈ 0,00034 $', cerca(costeDeTexto('gpt-6-luna', 981, 489), (981 * 0.1 + 489 * 0.5) / 1e6) && Math.round(costeDeTexto('gpt-6-luna', 981, 489) * 100000) === 34)
  ok('texto: un modelo desconocido va al precio más alto', cerca(costeDeTexto('gpt-x', 1_000_000, 0), 5))

  ok('formato de dinero', enDolares(0.0345) === '0,034 $' || enDolares(0.0345) === '0,035 $', enDolares(0.0345))
  ok('formato: grande con dos decimales', enDolares(1.8) === '1,80 $')
  ok('formato: pequeño con cuatro decimales', enDolares(0.00034) === '0,0003 $', enDolares(0.00034))
  ok('formato: cero', enDolares(0) === '0,0000 $')
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
