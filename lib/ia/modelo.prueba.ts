import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ESFUERZOS_DE_IA, MODELO_DE_IA_POR_DEFECTO, esfuerzoDeIa, modeloDeIa, parametrosDeIa, razona } from '@/lib/ia/modelo'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== el modelo ===')
{
  ok('por defecto: gpt-6-luna', MODELO_DE_IA_POR_DEFECTO === 'gpt-6-luna' && modeloDeIa({}) === 'gpt-6-luna')
  ok('IA_MODELO lo cambia, sin los espacios', modeloDeIa({ IA_MODELO: '  gpt-5.6-terra ' }) === 'gpt-5.6-terra')
  ok('una variable vacía no vale', modeloDeIa({ IA_MODELO: '   ' }) === 'gpt-6-luna' && modeloDeIa({ IA_MODELO: undefined }) === 'gpt-6-luna')
}

console.log('\n=== qué modelos razonan ===')
{
  ok('gpt-6-luna, gpt-5.6-terra, gpt-5.5, gpt-5-mini y o3 razonan', ['gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.5', 'gpt-5-mini', 'o3'].every(razona))
  ok('gpt-4o, gpt-4o-mini y gpt-4.1 no', !razona('gpt-4o') && !razona('gpt-4o-mini') && !razona('gpt-4.1'))
}

console.log('\n=== el esfuerzo ===')
{
  ok('sin variable, el que pide la pantalla', esfuerzoDeIa('low', {}) === 'low' && esfuerzoDeIa('none', {}) === 'none')
  ok('IA_ESFUERZO manda sobre la pantalla, en mayúsculas o con espacios también', esfuerzoDeIa('low', { IA_ESFUERZO: ' HIGH ' }) === 'high' && esfuerzoDeIa('none', { IA_ESFUERZO: 'medium' }) === 'medium')
  ok('un valor que no existe se ignora; «minimal» también, porque gpt-6-luna lo rechaza', esfuerzoDeIa('low', { IA_ESFUERZO: 'mucho' }) === 'low' && esfuerzoDeIa('low', { IA_ESFUERZO: 'minimal' }) === 'low' && !(ESFUERZOS_DE_IA as readonly string[]).includes('minimal'))
}

console.log('\n=== lo que se manda a OpenAI ===')
{
  const p = parametrosDeIa({ maxSalida: 3000 }, {})
  ok('gpt-6-luna, tope de salida con su nombre nuevo y esfuerzo «low»', p.model === 'gpt-6-luna' && p.max_completion_tokens === 3000 && p.reasoning_effort === 'low')
  ok('SIN temperature ni max_tokens (con gpt-6-luna son un error 400)', !('temperature' in p) && !('max_tokens' in p))
  ok('el esfuerzo de la pantalla se respeta', parametrosDeIa({ maxSalida: 1000, esfuerzo: 'none' }, {}).reasoning_effort === 'none')
  ok('IA_ESFUERZO manda en todas', parametrosDeIa({ maxSalida: 1000, esfuerzo: 'none' }, { IA_ESFUERZO: 'medium' }).reasoning_effort === 'medium')
  ok('la temperatura que pida la pantalla no se manda a un modelo que razona', !('temperature' in parametrosDeIa({ maxSalida: 1000, temperatura: 0.4 }, {})))

  const viejo = parametrosDeIa({ maxSalida: 2000, temperatura: 0.4 }, { IA_MODELO: 'gpt-4.1' })
  ok('con un modelo de los de siempre: temperatura y NO esfuerzo', viejo.model === 'gpt-4.1' && viejo.temperature === 0.4 && !('reasoning_effort' in viejo) && viejo.max_completion_tokens === 2000)
  ok('y si la pantalla no la pidió, 0,5', parametrosDeIa({ maxSalida: 2000 }, { IA_MODELO: 'gpt-4.1' }).temperature === 0.5)
}

console.log('\n=== ninguna ruta de la API pide un modelo que OpenAI apaga ===')
{
  // Los que OpenAI retira entre el 11 dic 2026 y el 26 feb 2027 (página de retiradas, mirada el 23 oct 2026). Se buscan entre comillas: en un
  // comentario se pueden nombrar. Si hay que pedir uno nuevo, se pide por lib/ia/modelo.ts
  const APAGADOS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'whisper-1', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe-diarize']
  const pedidos = new RegExp(`(?:model|modelo)\\s*:\\s*['"\`](?:${APAGADOS.map((m) => m.replace(/[.]/g, '\\.')).join('|')})['"\`]`)
  const rutas: string[] = []
  const recorrer = (dir: string) => {
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre)
      if (statSync(ruta).isDirectory()) recorrer(ruta)
      else if (nombre === 'route.ts') rutas.push(ruta)
    }
  }
  recorrer(join(process.cwd(), 'app', 'api'))
  const malas = rutas.filter((r) => pedidos.test(readFileSync(r, 'utf8')))
  ok(`se han mirado ${rutas.length} rutas`, rutas.length > 50)
  ok('ninguna pide uno de ellos', malas.length === 0, malas.join(', '))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
