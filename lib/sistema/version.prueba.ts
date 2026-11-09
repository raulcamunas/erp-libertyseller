import { VERSION_DE_DESARROLLO, leerIdDeVersion } from '@/lib/sistema/version'
import { decidirAviso, idDeRespuesta } from '@/lib/sistema/version-cliente'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * EL AVISO DE VERSIÓN NUEVA. Lo que duele si falla: que avise sin haber versión nueva (cada minuto, a todo el equipo), que no avise de la siguiente tras descartar una, o que avise en pleno reinicio
 * del servidor porque la pregunta falló.
 */
function main() {
  console.log('\n=== leer la versión del servidor ===')
  {
    ok('un identificador normal', leerIdDeVersion('x', () => 'apLhLU7v46vPOtYKbRwSs\n') === 'apLhLU7v46vPOtYKbRwSs')
    ok('sin fichero (desarrollo): «desarrollo»', leerIdDeVersion('x', () => { throw new Error('ENOENT') }) === VERSION_DE_DESARROLLO)
    ok('un contenido raro o vacío o larguísimo: «desarrollo»', ['', '   ', 'a b', '<script>', 'x'.repeat(200)].every((t) => leerIdDeVersion('x', () => t) === VERSION_DE_DESARROLLO))
  }

  console.log('\n=== la respuesta de /api/version ===')
  {
    ok('un id válido', idDeRespuesta({ id: 'abc_DEF-123' }) === 'abc_DEF-123')
    ok('basura: null, sin id, número, texto con espacios', [null, {}, { id: 3 }, { id: 'a b' }, { id: '' }, 'abc', undefined].every((c) => idDeRespuesta(c) === null))
  }

  console.log('\n=== cuándo se avisa ===')
  {
    ok('la misma versión: nada', decidirAviso({ inicial: 'A', actual: 'A', descartada: null }) === 'ninguno')
    ok('otra versión: se avisa', decidirAviso({ inicial: 'A', actual: 'B', descartada: null }) === 'mostrar')
    ok('no se sabe la de ahora (la pregunta falló o el servidor reinicia): nada', decidirAviso({ inicial: 'A', actual: null, descartada: null }) === 'ninguno')
    ok('descartada esa versión: nada', decidirAviso({ inicial: 'A', actual: 'B', descartada: 'B' }) === 'ninguno')
    ok('descartó la B y sale la C: se avisa otra vez', decidirAviso({ inicial: 'A', actual: 'C', descartada: 'B' }) === 'mostrar')
    ok('en desarrollo nunca avisa, de un lado ni del otro', decidirAviso({ inicial: VERSION_DE_DESARROLLO, actual: 'B', descartada: null }) === 'ninguno' && decidirAviso({ inicial: 'A', actual: VERSION_DE_DESARROLLO, descartada: null }) === 'ninguno')
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS de ${comprobaciones} comprobaciones\n`)
  if (fallos > 0) process.exit(1)
}

main()
