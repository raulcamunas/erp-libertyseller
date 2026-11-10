import { canalDeSala, configuracionDeJunta, fusionarMetadatosDeSala, leerMetadatosDeSala, MENSAJE_DE_SALA_CON_CANDADO, puedeEntrarASala, salaDe } from '@/lib/chat/junta'

let fallos = 0
let comprobaciones = 0
function igual(nombre: string, real: unknown, esperado: unknown) {
  comprobaciones += 1
  const a = JSON.stringify(real)
  const b = JSON.stringify(esperado)
  const bien = a === b
  if (!bien) fallos += 1
  console.log(`  ${bien ? 'OK  ' : 'MAL '}  ${nombre}${bien ? '' : ` → ${a}, esperaba ${b}`}`)
}

const C = '8a1f0c3e-0000-4000-8000-000000000001'
igual('la sala de un canal y vuelta', canalDeSala(salaDe(C)), C)
igual('una sala que no es del chat no vale', [canalDeSala('otra-sala'), canalDeSala(`chat-${C}x`), canalDeSala(`chat-no-es-uuid`)], [null, null, null])
const ok = { LIVEKIT_URL: 'wss://liberty-abc123.livekit.cloud', LIVEKIT_API_KEY: 'APIxxx', LIVEKIT_API_SECRET: 'secreto' }
igual('configuración completa', configuracionDeJunta(ok), { url: 'wss://liberty-abc123.livekit.cloud', urlHttp: 'https://liberty-abc123.livekit.cloud', clave: 'APIxxx', secreto: 'secreto' })
igual('se acepta https y barra final', configuracionDeJunta({ ...ok, LIVEKIT_URL: 'https://liberty-abc123.livekit.cloud/' })?.url, 'wss://liberty-abc123.livekit.cloud')
igual('sin alguna de las tres, no hay juntas', [configuracionDeJunta({ ...ok, LIVEKIT_API_SECRET: '' }), configuracionDeJunta({ ...ok, LIVEKIT_API_KEY: undefined }), configuracionDeJunta({}), configuracionDeJunta({ ...ok, LIVEKIT_URL: ' ' })], [null, null, null, null])
igual('una dirección rara no vale', [configuracionDeJunta({ ...ok, LIVEKIT_URL: 'liberty.livekit.cloud' }), configuracionDeJunta({ ...ok, LIVEKIT_URL: 'wss://a b.cloud' }), configuracionDeJunta({ ...ok, LIVEKIT_URL: 'ftp://x.cloud' })], [null, null, null])

// El candado: viaja en los metadatos de la sala de LiveKit
igual('metadatos: con candado y a quién se dejó entrar', leerMetadatosDeSala('{"bloqueada":true,"admitidos":["a","b"]}'), { bloqueada: true, admitidos: ['a', 'b'] })
igual('metadatos vacíos, rotos o raros: sin candado', [leerMetadatosDeSala(''), leerMetadatosDeSala(null), leerMetadatosDeSala('{no'), leerMetadatosDeSala('{"bloqueada":"si"}'), leerMetadatosDeSala('[]')], [{ bloqueada: false, admitidos: [] }, { bloqueada: false, admitidos: [] }, { bloqueada: false, admitidos: [] }, { bloqueada: false, admitidos: [] }, { bloqueada: false, admitidos: [] }])
igual('admitidos: solo textos', leerMetadatosDeSala('{"bloqueada":true,"admitidos":["a",3,null,"b"]}').admitidos, ['a', 'b'])
const sala = (bloqueada: boolean, admitidos: string[], dentro: string[]) => ({ bloqueada, admitidos, dentro })
igual('sin candado entra cualquiera', puedeEntrarASala(sala(false, [], ['ana']), 'luis'), true)
igual('con candado y nadie dentro, entra cualquiera (el candado se va con la sala)', puedeEntrarASala(sala(true, [], []), 'luis'), true)
igual('con candado, quien está dentro puede volver y a quien han dejado entrar', [puedeEntrarASala(sala(true, [], ['ana']), 'ana'), puedeEntrarASala(sala(true, ['luis'], ['ana']), 'luis')], [true, true])
igual('con candado y gente dentro, un desconocido no entra', puedeEntrarASala(sala(true, ['ana'], ['ana']), 'luis'), false)
igual('el mensaje del candado es estable (la pantalla lo reconoce)', MENSAJE_DE_SALA_CON_CANDADO.startsWith('Esta sala tiene candado'), true)

// Los metadatos llevan el candado Y la música: cambiar una cosa no pisa la otra
igual('fusionar: añade sin pisar lo que había', JSON.parse(fusionarMetadatosDeSala('{"musica":{"v":3}}', { bloqueada: true })), { musica: { v: 3 }, bloqueada: true })
igual('fusionar: lo nuevo gana sobre lo viejo de la misma clave', JSON.parse(fusionarMetadatosDeSala('{"bloqueada":false,"admitidos":["a"]}', { bloqueada: true })), { bloqueada: true, admitidos: ['a'] })
igual('fusionar: un valor undefined quita la clave', JSON.parse(fusionarMetadatosDeSala('{"musica":1,"bloqueada":true}', { musica: undefined })), { bloqueada: true })
igual('fusionar: texto vacío, roto o que no es un objeto se trata como vacío', [fusionarMetadatosDeSala('', { a: 1 }), fusionarMetadatosDeSala('{no', { a: 1 }), fusionarMetadatosDeSala('[1]', { a: 1 }), fusionarMetadatosDeSala(null, { a: 1 })], ['{"a":1}', '{"a":1}', '{"a":1}', '{"a":1}'])

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `HAY ${fallos} FALLOS`} (${comprobaciones} comprobaciones)`)
process.exit(fallos === 0 ? 0 : 1)
