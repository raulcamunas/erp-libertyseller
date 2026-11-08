import { canalDeSala, configuracionDeJunta, salaDe } from '@/lib/chat/junta'

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

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `HAY ${fallos} FALLOS`} (${comprobaciones} comprobaciones)`)
process.exit(fallos === 0 ? 0 : 1)
