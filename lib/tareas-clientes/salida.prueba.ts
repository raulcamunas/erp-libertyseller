import { COMPROBACIONES_MANUALES, esClaveManual, evaluar, resumir, type Metricas } from '@/lib/tareas-clientes/salida'

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
const AHORA = Date.parse('2026-11-08T12:00:00Z')
const bueno: Metricas = { notionConfigurado: true, escrituraActiva: true, clientesConNotion: 15, clientesConError: 0, cronUltimoOk: '2026-11-08T11:56:00Z', colaPendiente: 2, colaAtascada: 0, eventosDelWebhook24h: 7, tareasDelErpEnviadas: 12, tareasDelErpConError: 0, conTabla: 2, conImagen: 3, conDesplegable: 1, personasActivas7d: 4, dispositivosPush: 3, reunionesAnalizadas: 2, propuestasAceptadas: 5, tablasQueFaltan: [] }
const estado = (m: Metricas) => Object.fromEntries(evaluar(m, AHORA).map((c) => [c.clave, c.estado]))

igual('todo bien: todas en verde', Object.values(estado(bueno)).every((e) => e === 'ok'), true)
igual('sin clave o con la escritura apagada', [estado({ ...bueno, notionConfigurado: false }).escritura, estado({ ...bueno, escrituraActiva: false }).escritura], ['falta', 'falta'])
igual('sincronización: reciente sí, vieja o sin pasadas no', [estado({ ...bueno, cronUltimoOk: '2026-11-08T11:50:00Z' }).sincroniza_sola, estado({ ...bueno, cronUltimoOk: '2026-11-08T11:00:00Z' }).sincroniza_sola, estado({ ...bueno, cronUltimoOk: null }).sincroniza_sola], ['ok', 'falta', 'falta'])
igual('errores y cola atascada', [estado({ ...bueno, clientesConError: 1 }).sin_errores, estado({ ...bueno, colaAtascada: 1 }).cola_limpia, estado({ ...bueno, colaPendiente: 50 }).cola_limpia], ['falta', 'falta', 'falta'])
igual('webhook sin avisos es solo un aviso, no bloquea', estado({ ...bueno, eventosDelWebhook24h: 0 }).webhook, 'aviso')
igual('tareas enviadas: pocas = aviso, con error = falta', [estado({ ...bueno, tareasDelErpEnviadas: 3 }).tareas_enviadas, estado({ ...bueno, tareasDelErpConError: 2 }).tareas_enviadas], ['aviso', 'falta'])
const sinTabla = evaluar({ ...bueno, conTabla: 0, conDesplegable: 0 }, AHORA).find((c) => c.clave === 'contenido_rico')!
igual('contenido rico: dice qué falta', [sinTabla.estado, sinTabla.detalle.includes('una tabla') && sinTabla.detalle.includes('un desplegable') && !sinTabla.detalle.includes('una imagen')], ['falta', true])
igual('equipo, push y propuestas', [estado({ ...bueno, personasActivas7d: 1 }).equipo_usa, estado({ ...bueno, personasActivas7d: 0 }).equipo_usa, estado({ ...bueno, dispositivosPush: 1 }).push, estado({ ...bueno, reunionesAnalizadas: 1, propuestasAceptadas: 0 }).propuestas, estado({ ...bueno, reunionesAnalizadas: 0 }).propuestas], ['aviso', 'falta', 'aviso', 'aviso', 'falta'])
const mig = evaluar({ ...bueno, tablasQueFaltan: ['tc_briefings'] }, AHORA).find((c) => c.clave === 'migraciones')!
igual('migraciones: nombra lo que falta', [mig.estado, mig.detalle.includes('tc_briefings')], ['falta', true])

const autoBien = evaluar(bueno, AHORA)
const todasManuales = COMPROBACIONES_MANUALES.map((c) => ({ clave: c.clave, hecho: true }))
const sinFinal = COMPROBACIONES_MANUALES.map((c) => ({ clave: c.clave, hecho: !c.final }))
igual('con todo en verde y las manuales hechas salvo la final: listo, no terminada', [resumir(autoBien, sinFinal).listo, resumir(autoBien, sinFinal).terminada], [true, false])
igual('con la final también: terminada', [resumir(autoBien, todasManuales).terminada, resumir(autoBien, todasManuales).hechas === resumir(autoBien, todasManuales).total], [true, true])
igual('una manual sin hacer: no listo', resumir(autoBien, sinFinal.map((m) => (m.clave === 'm_equipo' ? { ...m, hecho: false } : m))).listo, false)
igual('una automática que falta: no listo aunque las manuales estén', resumir(evaluar({ ...bueno, clientesConError: 2 }, AHORA), todasManuales).listo, false)
igual('un aviso no impide salir', resumir(evaluar({ ...bueno, eventosDelWebhook24h: 0 }, AHORA), sinFinal).listo, true)
igual('claves manuales', [esClaveManual('m_equipo'), esClaveManual('otra'), esClaveManual(3)], [true, false, false])

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `HAY ${fallos} FALLOS`} (${comprobaciones} comprobaciones)`)
process.exit(fallos === 0 ? 0 : 1)
