import { ID_TEMPORAL_DESDE, claveDeMensaje, conMensaje, esMensajeTemporal, filasDeMensajes, reemplazarTemporal, sinTemporal, sinTemporalParecido } from '@/lib/chat/agrupar'
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

// El de verdad ocupa el sitio del provisional y hereda su clave: no se vuelve a montar (ni repite la animación ni se apaga y enciende)
{
  const T = ID_TEMPORAL_DESDE + 1
  const lista = [m(10, 'a'), m(T, 'hola')]
  const porId = reemplazarTemporal(lista, m(60, 'hola'), T)
  igual('por id: el provisional desaparece y el de verdad ocupa su sitio', porId.map((x) => x.id), [10, 60])
  igual('y hereda la clave del provisional', porId.map(claveDeMensaje), ['m-10', `m-${T}`])
  igual('un mensaje normal conserva su clave', claveDeMensaje(m(10, 'a')), 'm-10')
  const parecido = reemplazarTemporal(lista, m(60, 'hola'))
  igual('sin id: el provisional igual (más antiguo) cede su clave', parecido.map(claveDeMensaje), ['m-10', `m-${T}`])
  igual('si el servidor cambió el texto (lo recorta) por id sigue funcionando', reemplazarTemporal(lista, m(60, 'hola'.trim() + ' '), T).map(claveDeMensaje), ['m-10', `m-${T}`])
  igual('si ya se sustituyó, llega otra vez y se fusiona sin duplicar y sin perder la clave', reemplazarTemporal(porId, m(60, 'hola'), T).map((x) => [x.id, claveDeMensaje(x)]), [[10, 'm-10'], [60, `m-${T}`]])
  igual('un mensaje ajeno sin provisional se mete sin más', reemplazarTemporal([m(10, 'a')], m(61, 'otro', 'ella')).map(claveDeMensaje), ['m-10', 'm-61'])
  igual('uno con otro autor no se lleva el provisional', reemplazarTemporal([m(T, 'hola')], m(62, 'hola', 'ella')).map((x) => x.id), [62, T])
  igual('un provisional que llega como «de verdad» no se toca', reemplazarTemporal([m(T, 'hola')], m(T + 8, 'hola')).length, 1)
  // Y las filas del canal usan esa clave
  const filas = filasDeMensajes(porId, { yo: 'yo', ultimoLeidoEn: null, ahora: Date.parse('2026-11-09T12:00:00Z') })
  igual('las filas se pintan con la clave heredada', filas.filter((f) => f.tipo === 'mensaje').map((f) => f.clave), ['m-10', `m-${T}`])
}

console.log(`\n${comprobaciones - fallos}/${comprobaciones} comprobaciones bien`)
if (fallos > 0) process.exit(1)
