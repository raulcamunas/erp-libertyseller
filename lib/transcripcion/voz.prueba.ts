import type { AudioDescargado } from '@/lib/transcripcion/audio'
import { ErrorDeVoz, MENSAJE_DE_VOZ, esFalloGeneralDeLaIa, transcribirAudio } from '@/lib/transcripcion/voz'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const audio: AudioDescargado = { bytes: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), extension: 'mp3', mime: 'audio/mpeg' }
const pistas = { prompt: 'Llamada de teléfono entre Maoli, comercial de Liberty Seller, y la empresa Joe Black Pets.', palabras: 'Liberty Seller, Amazon, Joe Black Pets' }

interface Captura {
  url: string
  init: RequestInit
  campos: Record<string, string>
  archivo: { nombre: string; tipo: string; tamano: number } | null
}

function falso(respuesta: () => Response | Promise<Response>): { fetch: typeof fetch; capturas: Captura[] } {
  const capturas: Captura[] = []
  return {
    capturas,
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      const campos: Record<string, string> = {}
      let archivo: Captura['archivo'] = null
      const cuerpo = init?.body
      if (cuerpo instanceof FormData) {
        for (const [k, v] of cuerpo.entries()) {
          if (typeof v === 'string') campos[k] = v
          else archivo = { nombre: v.name, tipo: v.type, tamano: v.size }
        }
      }
      capturas.push({ url: String(url), init: init ?? {}, campos, archivo })
      return respuesta()
    }) as typeof fetch,
  }
}

const json = (cuerpo: unknown, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } })

const run = async () => {
  console.log('\n=== la petición con gpt-transcribe ===')
  {
    const f = falso(() => json({ text: '  Buenas tardes, hablo con Joe Black Pets.  ', languages: [{ code: 'es' }], usage: { type: 'duration', seconds: 72.6 } }))
    const r = await transcribirAudio({ audio, modelo: 'gpt-transcribe', clave: 'sk-prueba', pistas, fetch: f.fetch })
    const c = f.capturas[0]
    ok('va a la API de transcripciones de OpenAI, por POST', c.url === 'https://api.openai.com/v1/audio/transcriptions' && c.init.method === 'POST')
    ok('con la clave en la cabecera', (c.init.headers as Record<string, string>).Authorization === 'Bearer sk-prueba')
    ok('el audio va como archivo con su nombre, su tipo y todos sus bytes', c.archivo?.nombre === 'llamada.mp3' && c.archivo?.tipo === 'audio/mpeg' && c.archivo?.tamano === 8)
    ok('el modelo y el contexto', c.campos.model === 'gpt-transcribe' && c.campos.prompt === pistas.prompt)
    ok('las palabras clave van en una sola línea', c.campos.keywords === 'Liberty Seller, Amazon, Joe Black Pets')
    ok('NO se fuerza el idioma (lo detecta; así una llamada en catalán o inglés no sufre)', !('language' in c.campos) && !('languages' in c.campos))
    ok('el texto sale sin espacios sobrantes', r.texto === 'Buenas tardes, hablo con Joe Black Pets.')
    ok('los idiomas y los segundos que cobra OpenAI (redondeados)', r.idiomas.join() === 'es' && r.segundos === 73)
  }
  {
    const f = falso(() => json({ text: 'x', languages: [], usage: { type: 'duration', seconds: 45 } }))
    const r = await transcribirAudio({ audio, modelo: 'gpt-transcribe', clave: 'k', pistas: { ...pistas, palabras: '' }, fetch: f.fetch })
    ok('sin palabras clave no manda el campo', !('keywords' in f.capturas[0].campos))
    ok('sin idioma detectado: lista vacía (puro ruido)', r.idiomas.length === 0)
  }

  console.log('\n=== con un modelo viejo ===')
  {
    const f = falso(() => json({ text: 'hola' }))
    const r = await transcribirAudio({ audio, modelo: 'whisper-1', clave: 'k', pistas, fetch: f.fetch })
    const c = f.capturas[0]
    ok('los modelos viejos no conocen `keywords`: no se manda (rechazarían la petición)', !('keywords' in c.campos))
    ok('y llevan el idioma con el campo de siempre', c.campos.language === 'es' && c.campos.model === 'whisper-1')
    ok('sin `usage` los segundos son null', r.segundos === null)
  }

  console.log('\n=== los fallos ===')
  const falla = async (n: string, respuesta: () => Response | Promise<Response>, codigo: string) => {
    const f = falso(respuesta)
    try {
      await transcribirAudio({ audio, modelo: 'gpt-transcribe', clave: 'k', pistas, fetch: f.fetch })
      ok(n, false, 'no ha fallado')
    } catch (e) {
      const bien = e instanceof ErrorDeVoz && e.codigo === codigo && e.message === MENSAJE_DE_VOZ[e.codigo]
      ok(n, bien, e instanceof ErrorDeVoz ? e.codigo : String(e))
    }
  }
  await falla('401: la clave no vale', () => json({ error: { message: 'secreto: sk-abc', code: 'invalid_api_key' } }, 401), 'clave')
  await falla('403: tampoco', () => json({ error: {} }, 403), 'clave')
  await falla('402: sin saldo', () => json({ error: {} }, 402), 'saldo')
  await falla('429 con insufficient_quota es SIN SALDO (OpenAI lo manda como 429)', () => json({ error: { code: 'insufficient_quota' } }, 429), 'saldo')
  await falla('429 normal: límite', () => json({ error: { code: 'rate_limit_exceeded' } }, 429), 'limite')
  await falla('500: servidor', () => json({}, 500), 'servidor')
  await falla('503: servidor', () => json({}, 503), 'servidor')
  await falla('400: el audio no vale', () => json({ error: { message: 'Invalid file format' } }, 400), 'audio')
  await falla('413: demasiado grande para ellos', () => json({}, 413), 'audio')
  await falla('415: formato no admitido', () => json({}, 415), 'audio')
  await falla('200 pero no es JSON', () => new Response('<html>', { status: 200 }), 'respuesta')
  await falla('200 pero sin `text`', () => json({ languages: [] }), 'respuesta')
  await falla('la red falla', () => {
    throw new Error('ECONNRESET')
  }, 'red')

  try {
    await transcribirAudio({ audio, modelo: 'gpt-transcribe', clave: '', pistas })
    ok('sin clave de OpenAI', false, 'no ha fallado')
  } catch (e) {
    ok('sin clave de OpenAI: error claro, sin llamar a nadie', e instanceof ErrorDeVoz && e.codigo === 'sin_clave')
  }

  console.log('\n=== qué fallos son de la cuenta y no de la llamada ===')
  ok('clave, saldo y sin clave paran la pasada', esFalloGeneralDeLaIa('clave') && esFalloGeneralDeLaIa('saldo') && esFalloGeneralDeLaIa('sin_clave'))
  ok('el resto es de esa llamada', !esFalloGeneralDeLaIa('audio') && !esFalloGeneralDeLaIa('limite') && !esFalloGeneralDeLaIa('servidor') && !esFalloGeneralDeLaIa('red') && !esFalloGeneralDeLaIa('respuesta'))
}

run().then(
  () => {
    console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
    if (fallos > 0) process.exit(1)
  },
  (e) => {
    console.error('Explotó la prueba:', e)
    process.exit(1)
  }
)
