import { ErrorDeAudio, MENSAJE_DE_AUDIO, descargarAudio, formatoPorBytes, formatoPorTipo } from '@/lib/transcripcion/audio'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const bytes = (...xs: number[]) => Uint8Array.from(xs)
const texto = (s: string) => Uint8Array.from(Array.from(s).map((c) => c.charCodeAt(0)))
const junto = (...partes: Uint8Array[]) => {
  const todo = new Uint8Array(partes.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const p of partes) {
    todo.set(p, i)
    i += p.length
  }
  return todo
}
const relleno = (n: number) => new Uint8Array(n)

const WAV = junto(texto('RIFF'), bytes(0, 0, 0, 0), texto('WAVE'), relleno(40))
const MP3_ID3 = junto(texto('ID3'), bytes(3, 0, 0, 0, 0, 0, 0), relleno(40))
const MP3_SIN_ETIQUETA = junto(bytes(0xff, 0xfb, 0x90, 0x44), relleno(40)) // MPEG 1 capa III
const AAC_ADTS = junto(bytes(0xff, 0xf1, 0x50, 0x80), relleno(40)) // capa 00: AAC, no mp3
const M4A = junto(bytes(0, 0, 0, 0x20), texto('ftyp'), texto('M4A '), relleno(40))
const WEBM = junto(bytes(0x1a, 0x45, 0xdf, 0xa3), relleno(40))
const OGG = junto(texto('OggS'), relleno(40))
const FLAC = junto(texto('fLaC'), relleno(40))

console.log('\n=== el formato por los primeros bytes ===')
{
  ok('wav', formatoPorBytes(WAV) === 'wav')
  ok('mp3 con etiqueta ID3', formatoPorBytes(MP3_ID3) === 'mp3')
  ok('mp3 sin etiqueta (fotograma)', formatoPorBytes(MP3_SIN_ETIQUETA) === 'mp3')
  ok('un AAC ADTS NO es mp3', formatoPorBytes(AAC_ADTS) === null)
  ok('m4a / mp4', formatoPorBytes(M4A) === 'm4a')
  ok('webm', formatoPorBytes(WEBM) === 'webm')
  ok('ogg', formatoPorBytes(OGG) === 'ogg')
  ok('flac', formatoPorBytes(FLAC) === 'flac')
  ok('un texto cualquiera: no se reconoce', formatoPorBytes(texto('<html><body>Error 403 forbidden</body></html>')) === null)
  ok('muy corto: no se reconoce', formatoPorBytes(bytes(1, 2, 3)) === null)
}

console.log('\n=== el formato por la cabecera ===')
{
  ok('audio/mpeg', formatoPorTipo('audio/mpeg') === 'mp3')
  ok('audio/mpeg con parámetros y mayúsculas', formatoPorTipo('Audio/MPEG; charset=binary') === 'mp3')
  ok('audio/x-wav', formatoPorTipo('audio/x-wav') === 'wav')
  ok('audio/mp4', formatoPorTipo('audio/mp4') === 'm4a')
  ok('application/octet-stream: nada', formatoPorTipo('application/octet-stream') === null && formatoPorTipo(null) === null)
}

/* ---------------- un fetch falso que sirve un cuerpo por trozos ---------------- */

function respuesta(trozos: Uint8Array[], cabeceras: Record<string, string> = {}, estado = 200): Response {
  const flujo = new ReadableStream<Uint8Array>({
    start(c) {
      for (const t of trozos) c.enqueue(t)
      c.close()
    },
  })
  return new Response(flujo, { status: estado, headers: cabeceras })
}

const URL_BUENA = 'https://api.rinkel.com/v1/audio/call-recording/abc?token=xyz'

console.log('\n=== descargar ===')
const run = async () => {
  {
    const a = await descargarAudio(URL_BUENA, { fetch: async () => respuesta([MP3_ID3.slice(0, 20), MP3_ID3.slice(20)], { 'content-type': 'audio/mpeg' }) })
    ok('junta los trozos en orden y reconoce el mp3', a.extension === 'mp3' && a.mime === 'audio/mpeg' && a.bytes.length === MP3_ID3.length && a.bytes.every((b, i) => b === MP3_ID3[i]))
  }
  {
    const a = await descargarAudio(URL_BUENA, { fetch: async () => respuesta([WAV], { 'content-type': 'audio/mpeg' }) })
    ok('los bytes mandan sobre la cabecera (wav servido como audio/mpeg)', a.extension === 'wav')
  }
  {
    const a = await descargarAudio(URL_BUENA, { fetch: async () => respuesta([relleno(64)], { 'content-type': 'audio/mpeg' }) })
    ok('si los bytes no dicen nada, vale la cabecera', a.extension === 'mp3')
  }
  {
    let capturada: { url: string; init?: RequestInit } | null = null
    await descargarAudio(URL_BUENA, {
      fetch: async (url, init) => {
        capturada = { url: String(url), init }
        return respuesta([WAV])
      },
    })
    const c = capturada as { url: string; init?: RequestInit } | null
    ok('pide la dirección tal cual, con GET y sin guardar caché', c?.url === URL_BUENA && c?.init?.method === 'GET' && c?.init?.cache === 'no-store')
  }

  const falla = async (n: string, f: () => Promise<unknown>, codigo: string) => {
    try {
      await f()
      ok(n, false, 'no ha fallado')
    } catch (e) {
      ok(n, e instanceof ErrorDeAudio && e.codigo === codigo, e instanceof ErrorDeAudio ? e.codigo : String(e))
      if (e instanceof ErrorDeAudio) ok(`   y la frase es la nuestra`, e.message === MENSAJE_DE_AUDIO[e.codigo as keyof typeof MENSAJE_DE_AUDIO])
    }
  }

  await falla('una dirección de otro sitio no se descarga', () => descargarAudio('https://evil.example.com/a.mp3', { fetch: async () => respuesta([WAV]) }), 'host')
  await falla('http a pelo no se descarga', () => descargarAudio('http://api.rinkel.com/a.mp3', { fetch: async () => respuesta([WAV]) }), 'host')
  await falla('un subdominio parecido tampoco', () => descargarAudio('https://api.rinkel.com.evil.io/a.mp3', { fetch: async () => respuesta([WAV]) }), 'host')
  await falla('una dirección que no es dirección', () => descargarAudio('esto no es una url', { fetch: async () => respuesta([WAV]) }), 'host')

  await falla('Rinkel contesta 404', () => descargarAudio(URL_BUENA, { fetch: async () => respuesta([], {}, 404) }), 'red')
  await falla('la red falla', () => descargarAudio(URL_BUENA, { fetch: async () => { throw new Error('ECONNRESET') } }), 'red')
  await falla('cuerpo vacío', () => descargarAudio(URL_BUENA, { fetch: async () => respuesta([]) }), 'vacio')
  await falla('bytes y cabecera que no dicen nada', () => descargarAudio(URL_BUENA, { fetch: async () => respuesta([texto('<html>Not found</html>')], { 'content-type': 'text/html' }) }), 'formato')

  // El tope de tamaño
  let leidos = 0
  await falla(
    'la cabecera ya dice que pasa del tope: ni se lee el cuerpo',
    () =>
      descargarAudio(URL_BUENA, {
        maxBytes: 1000,
        fetch: async () => {
          const r = respuesta([relleno(2000)], { 'content-length': '2000' })
          leidos++
          return r
        },
      }),
    'demasiado_grande'
  )
  ok('   (se pidió una vez)', leidos === 1)

  let cancelado = false
  await falla(
    'una cabecera que miente no llena la memoria: se corta al pasar el tope',
    () =>
      descargarAudio(URL_BUENA, {
        maxBytes: 1000,
        fetch: async () => {
          const flujo = new ReadableStream<Uint8Array>({
            pull(c) {
              c.enqueue(relleno(400))
            },
            cancel() {
              cancelado = true
            },
          })
          return new Response(flujo, { status: 200, headers: { 'content-length': '10' } })
        },
      }),
    'demasiado_grande'
  )
  ok('   y se cancela la descarga', cancelado)
  {
    const a = await descargarAudio(URL_BUENA, { maxBytes: 1000, fetch: async () => respuesta([WAV.slice(0, 50), WAV.slice(50)]) })
    ok('un audio justo por debajo del tope sí pasa', a.bytes.length === WAV.length)
  }
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
