import { ID_TEMPORAL_DESDE, conMensaje, esMensajeTemporal, sinTemporal, sinTemporalParecido } from '@/lib/chat/agrupar'
import type { MensajeChat } from '@/lib/chat/tipos'

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
const m = (id: number, cuerpo: string, autor = 'yo', hilo: number | null = null): MensajeChat => ({ id, canal_id: 'c', autor_id: autor, cuerpo, hilo_de: hilo, cita: null, menciones: [], adjuntos: [], editado_en: null, fijado_en: null, encuesta: null, votos: {}, autor_externo: null, borrado_en: null, creado_en: '2026-11-08T10:00:00Z', reacciones: {}, respuestas: 0 })

igual('un provisional se reconoce, uno de verdad no', [esMensajeTemporal(ID_TEMPORAL_DESDE + 1), esMensajeTemporal(48213)], [true, false])
igual('los provisionales se ordenan detrás de los de verdad', conMensaje([m(10, 'a'), m(11, 'b')], m(ID_TEMPORAL_DESDE + 1, 'c')).map((x) => x.id), [10, 11, ID_TEMPORAL_DESDE + 1])
igual('dos provisionales seguidos mantienen su orden', conMensaje(conMensaje([m(10, 'a')], m(ID_TEMPORAL_DESDE + 1, 'x')), m(ID_TEMPORAL_DESDE + 2, 'y')).map((x) => x.cuerpo), ['a', 'x', 'y'])
igual('quitar un provisional', sinTemporal([m(10, 'a'), m(ID_TEMPORAL_DESDE + 1, 'x')], ID_TEMPORAL_DESDE + 1).map((x) => x.id), [10])
igual('llega el de verdad: se va el provisional igual (el más antiguo)', sinTemporalParecido([m(ID_TEMPORAL_DESDE + 1, 'hola'), m(ID_TEMPORAL_DESDE + 2, 'hola')], m(50, 'hola')).map((x) => x.id), [ID_TEMPORAL_DESDE + 2])
igual('con otro texto, otro autor u otro hilo no se quita nada', [sinTemporalParecido([m(ID_TEMPORAL_DESDE + 1, 'hola')], m(50, 'adiós')).length, sinTemporalParecido([m(ID_TEMPORAL_DESDE + 1, 'hola')], m(50, 'hola', 'otra')).length, sinTemporalParecido([m(ID_TEMPORAL_DESDE + 1, 'hola')], m(50, 'hola', 'yo', 7)).length], [1, 1, 1])
igual('un provisional que se repite como «de verdad» no se confunde', sinTemporalParecido([m(ID_TEMPORAL_DESDE + 1, 'hola')], m(ID_TEMPORAL_DESDE + 9, 'hola')).length, 1)

console.log(`\n${comprobaciones - fallos}/${comprobaciones} comprobaciones bien`)
if (fallos > 0) process.exit(1)
