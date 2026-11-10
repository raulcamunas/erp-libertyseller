import { textoDeError } from './error-texto'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== el texto de un error ===')
ok('Error normal: su mensaje', textoDeError(new Error('se acabó el tiempo')) === 'se acabó el tiempo')
ok('error de PostgREST (objeto plano): mensaje y código, no «[object Object]»', textoDeError({ message: 'canceling statement due to statement timeout', code: '57014', details: null, hint: null }) === 'canceling statement due to statement timeout (57014)')
ok('con detalle y pista', textoDeError({ message: 'duplicate key', code: '23505', details: 'Key (a)=(1) exists', hint: 'usa otro' }) === 'duplicate key (23505 · Key (a)=(1) exists · usa otro)')
ok('un texto suelto', textoDeError('falló') === 'falló')
ok('un objeto sin mensaje se serializa', textoDeError({ a: 1 }) === '{"a":1}')
ok('objeto vacío → «{}», null y undefined como texto; nunca «[object Object]»', textoDeError({}) === '{}' && textoDeError(null) === 'null' && textoDeError(undefined) === 'undefined')
ok('se recorta a 500', textoDeError('x'.repeat(900)).length === 500)
ok('referencia circular no lanza', (() => { const o: Record<string, unknown> = {}; o.o = o; return typeof textoDeError(o) === 'string' })())
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
