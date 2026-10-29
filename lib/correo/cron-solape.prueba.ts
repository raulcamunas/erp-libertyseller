import { crearBaseFalsa } from '@/lib/mcp/comercial/base-falsa'
import { PASADA_DEL_CALENDARIO_MUERTA_TRAS_MS, PASADA_MUERTA_TRAS_MS, hayPasadaEnMarcha, hayPasadaEnMarchaDe } from '@/lib/correo/cron-solape'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const AHORA = Date.parse('2026-10-29T10:00:00.000Z')
const hace = (ms: number) => new Date(AHORA - ms).toISOString()
const fila = (extra: Record<string, unknown>) => ({ tarea: 'correo-sync', iniciado_at: hace(20_000), terminado_at: null, lanzado_por: null, ...extra })
const con = (filas: Array<Record<string, unknown>> | null) => crearBaseFalsa({ cron_ejecuciones: filas } as never)

async function main() {
  console.log('\n=== una pasada anterior en marcha impide empezar otra ===')
  ok('una pasada automática que empezó hace 20 s y no ha terminado: en marcha', await hayPasadaEnMarcha(con([fila({})]).servicio, AHORA))
  ok('sin ninguna fila: no hay nada en marcha', !(await hayPasadaEnMarcha(con([]).servicio, AHORA)))
  ok('una que ya terminó no cuenta', !(await hayPasadaEnMarcha(con([fila({ terminado_at: hace(8_000) })]).servicio, AHORA)))
  ok('una sin terminar de hace 10 minutos se da por muerta', !(await hayPasadaEnMarcha(con([fila({ iniciado_at: hace(600_000) })]).servicio, AHORA)))
  ok('el límite es lo que dura la ruta más un margen', PASADA_MUERTA_TRAS_MS > 300_000 && PASADA_MUERTA_TRAS_MS <= 400_000 && (await hayPasadaEnMarcha(con([fila({ iniciado_at: hace(PASADA_MUERTA_TRAS_MS - 1_000) })]).servicio, AHORA)) && !(await hayPasadaEnMarcha(con([fila({ iniciado_at: hace(PASADA_MUERTA_TRAS_MS + 1_000) })]).servicio, AHORA)))
  ok('una pasada lanzada a mano desde Sistema no bloquea a la automática', !(await hayPasadaEnMarcha(con([fila({ lanzado_por: '00000000-0000-4000-8000-000000000001' })]).servicio, AHORA)))
  ok('ni cuenta la de otra tarea', !(await hayPasadaEnMarcha(con([fila({ tarea: 'rinkel-llamadas' })]).servicio, AHORA)))
  ok('entre varias, basta con que una siga en marcha', await hayPasadaEnMarcha(con([fila({ terminado_at: hace(1_000), iniciado_at: hace(70_000) }), fila({})]).servicio, AHORA))

  console.log('\n=== lo mismo para la sincronización de la agenda con Google (cada minuto) ===')
  const cal = (extra: Record<string, unknown> = {}) => fila({ tarea: 'calendario', iniciado_at: hace(70_000), ...extra })
  const dePasadaDelCalendario = (filas: Array<Record<string, unknown>>) => hayPasadaEnMarchaDe(con(filas).servicio, 'calendario', PASADA_DEL_CALENDARIO_MUERTA_TRAS_MS, AHORA)
  ok('una pasada que lleva 70 s sin terminar (Google lento) impide que empiece otra encima', await dePasadaDelCalendario([cal()]))
  ok('una que ya terminó no', !(await dePasadaDelCalendario([cal({ terminado_at: hace(60_000) })])))
  ok('una de hace 5 minutos sin terminar se da por muerta (el contenedor se reinició)', !(await dePasadaDelCalendario([cal({ iniciado_at: hace(300_000) })])))
  ok('el límite es 180 s: 120 del cron más un margen', PASADA_DEL_CALENDARIO_MUERTA_TRAS_MS === 180_000 && (await dePasadaDelCalendario([cal({ iniciado_at: hace(179_000) })])) && !(await dePasadaDelCalendario([cal({ iniciado_at: hace(181_000) })])))
  ok('una lanzada a mano desde Sistema («Lanzar ahora») no bloquea a la automática', !(await dePasadaDelCalendario([cal({ lanzado_por: '00000000-0000-4000-8000-000000000001' })])))
  ok('una pasada del correo en marcha no bloquea la del calendario, ni al revés', !(await dePasadaDelCalendario([fila({})])) && !(await hayPasadaEnMarcha(con([cal()]).servicio, AHORA)))

  console.log('\n=== si el registro no se puede leer, el correo se lee ===')
  ok('sin la tabla: se deja correr', !(await hayPasadaEnMarcha(con(null).servicio, AHORA)))
  const rota = con([fila({})])
  rota.errores.set('cron_ejecuciones', { code: 'XX000', message: 'rota' })
  ok('con la base rota: se deja correr', !(await hayPasadaEnMarcha(rota.servicio, AHORA)))

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}
void main()
