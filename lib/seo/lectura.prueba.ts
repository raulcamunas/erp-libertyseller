/**
 * PRUEBAS DE LAS TRANSICIONES DE LA LECTURA DE BRAND ANALYTICS (lib/seo/lectura-estado.ts): ninguna tanda se pierde, el FATAL se aísla y el periodo se cierra.
 *   npx tsx lib/seo/lectura.prueba.ts
 */
import { cierreDePeriodo, contarFallo, devolverTanda, errorReintentableAlRecoger, esperaTrasError, esperaVencida, filasConVigia, motivoDeFatal, siguientePedido, trasFatal, trasGuardar, type EstadoSeo } from './lectura-estado'
import { ultimaSemana, ultimoMes } from './periodos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const HOY = '2026-11-21'
const AHORA = Date.parse('2026-11-21T10:00:00Z')
const MES = ultimoMes(HOY)
const SEMANA = ultimaSemana(HOY)
const asin = (n: number) => `B0TEST${String(n).padStart(4, '0')}`
const lista = (desde: number, n: number) => Array.from({ length: n }, (_, i) => asin(desde + i))

const base = (cambios: Partial<EstadoSeo> = {}): EstadoSeo => ({
  estado: 'esperando',
  report_id: 'R1',
  periodo: 'WEEK',
  desde: SEMANA.desde,
  hasta: SEMANA.hasta,
  asins: [],
  pendientes: [],
  mes_ok: MES.desde,
  semana_ok: null,
  ficha_leida_at: null,
  acceso: 'si',
  pedido_at: new Date(AHORA - 2 * 3_600_000).toISOString(),
  error: null,
  intentos: 0,
  periodos_leidos: [],
  mejoras: true,
  asins_sin_ba: [],
  ...cambios,
})
/** El estado después de guardar un parche */
const aplicar = (e: EstadoSeo, parche: Record<string, unknown>): EstadoSeo => ({ ...e, ...(parche as Partial<EstadoSeo>) })

console.log('\n=== (a) un informe caducado no pierde su tanda ===')
{
  const T1 = lista(1, 3)
  const T2 = lista(10, 3)
  const T3 = lista(20, 3)
  const e = base({ asins: T1, pendientes: [T2, T3] })
  ok('más de una hora esperando = vencido', esperaVencida(e, AHORA, 3_600_000))
  const t = devolverTanda(e, 'Amazon ha tardado más de una hora.', AHORA, HOY)
  ok('vuelve a reposo sin report_id', t.parche.estado === 'reposo' && t.parche.report_id === null)
  ok('la tanda va al frente de la cola', JSON.stringify(t.parche.pendientes) === JSON.stringify([T1, T2, T3]))
  ok('cuenta el intento y apunta la hora', t.parche.intentos === 1 && t.parche.pedido_at === new Date(AHORA).toISOString())
  ok('no cierra el periodo', !t.cerrado && !('semana_ok' in t.parche))
  const despues = aplicar(e, t.parche)
  const s = siguientePedido(despues, [...T1, ...T2, ...T3], HOY)
  ok('la siguiente tanda pedida es T1', s.tipo === 'pedir' && s.tanda.join() === T1.join() && s.resto.length === 2, JSON.stringify(s))
  ok('con el mismo periodo', s.tipo === 'pedir' && s.rango.periodo === 'WEEK' && s.rango.desde === SEMANA.desde)
  ok('espera 30 min antes de volver a pedir (intentos > 0)', esperaTrasError({ ...despues, pedido_at: new Date(AHORA).toISOString() }, AHORA + 60_000, 30 * 60_000))
  // Tope: al tercer intento se abandona y se sigue
  const tercero = devolverTanda(base({ asins: T1, pendientes: [T2], intentos: 2 }), 'otra vez', AHORA, HOY)
  ok('al 3.er intento la tanda se abandona', JSON.stringify(tercero.parche.pendientes) === JSON.stringify([T2]) && tercero.parche.intentos === 0)
  ok('el error dice qué ASIN', String(tercero.parche.error).includes(T1[0]), String(tercero.parche.error))
  const ultimo = devolverTanda(base({ asins: T1, pendientes: [], intentos: 2 }), 'otra vez', AHORA, HOY)
  ok('si era la última, el periodo se cierra', ultimo.cerrado && ultimo.parche.semana_ok === SEMANA.desde)
}

console.log('\n=== (b) FATAL de una tanda de 18: se parte en dos mitades ===')
{
  const T = lista(1, 18)
  const resto = [lista(100, 5)]
  const t = trasFatal(base({ asins: T, pendientes: resto, intentos: 1 }), 'Amazon dice: algo', AHORA, HOY)
  const p = t.parche.pendientes as string[][]
  ok('pendientes = [9, 9, ...resto]', p.length === 3 && p[0].length === 9 && p[1].length === 9 && p[2] === resto[0], JSON.stringify(p.map((x) => x.length)))
  ok('las mitades son la tanda entera, sin repetir', [...p[0], ...p[1]].join() === T.join())
  ok('sin error y sin intentos (no hay espera de 30 min)', t.parche.error === null && t.parche.intentos === 0)
  ok('report_id a null; el periodo se conserva', t.parche.report_id === null && !('periodo' in t.parche) && !('desde' in t.parche))
  ok('no espera tras el aviso', !esperaTrasError(aplicar(base(), { ...t.parche, pedido_at: new Date(AHORA).toISOString() }), AHORA + 1000, 30 * 60_000))
  const impar = trasFatal(base({ asins: lista(1, 3) }), '', AHORA, HOY).parche.pendientes as string[][]
  ok('tanda impar: 2 + 1', impar[0].length === 2 && impar[1].length === 1)
}

console.log('\n=== (c) FATAL de 1 ASIN ===')
{
  const A = [asin(7)]
  const uno = trasFatal(base({ asins: A, intentos: 0 }), 'Amazon dice: no es de la marca', AHORA, HOY)
  ok('1.er FATAL: se reintenta la misma tanda, con espera', JSON.stringify(uno.parche.pendientes) === JSON.stringify([A]) && uno.parche.intentos === 1)
  ok('el error lleva el motivo de Amazon', String(uno.parche.error).includes('no es de la marca'), String(uno.parche.error))
  ok('…y no culpa a Brand Registry', !String(uno.parche.error).includes('Brand Registry'))
  const tres = trasFatal(base({ asins: A, intentos: 2, pendientes: [] }), 'Amazon dice: no', AHORA, HOY)
  ok('3.er FATAL: sale en asins_sin_ba', JSON.stringify(tres.parche.asins_sin_ba) === JSON.stringify(A), JSON.stringify(tres.parche.asins_sin_ba))
  ok('sin pendientes: el parche trae semana_ok', tres.parche.semana_ok === SEMANA.desde)
  ok('…y periodos_leidos', Array.isArray(tres.parche.periodos_leidos) && (tres.parche.periodos_leidos as string[]).includes(`WEEK:${SEMANA.desde}`))
  ok('…y cierra (se borra lo viejo)', tres.cerrado && tres.parche.intentos === 0)
  const conResto = trasFatal(base({ asins: A, intentos: 2, pendientes: [lista(50, 2)] }), '', AHORA, HOY)
  ok('con pendientes no se cierra el periodo', !conResto.cerrado && !('semana_ok' in conResto.parche))
  const sinColumna = trasFatal(base({ asins: A, intentos: 2, asins_sin_ba: undefined }), '', AHORA, HOY)
  ok('sin la migración 332 no se toca asins_sin_ba (se salta en este periodo)', !('asins_sin_ba' in sinColumna.parche) && sinColumna.parche.semana_ok === SEMANA.desde)
  // El ASIN apuntado ya no se pide
  const despues = aplicar(base({ estado: 'reposo', report_id: null, semana_ok: SEMANA.desde, periodos_leidos: [] }), tres.parche)
  const s = siguientePedido({ ...despues, periodos_leidos: [] }, [asin(7), asin(8)], HOY)
  ok('el ASIN sin Brand Analytics no entra en las tandas nuevas', s.tipo === 'pedir' && !s.tanda.includes(asin(7)) && s.tanda.includes(asin(8)), JSON.stringify(s))
  const solo = siguientePedido(aplicar(base({ estado: 'reposo', mes_ok: null }), { asins_sin_ba: [asin(7)], pendientes: [] }), [asin(7)], HOY)
  ok('si solo quedan ASIN sin Brand Analytics, no hay nada que pedir', solo.tipo === 'nada')
  const quedabanMalos = siguientePedido(base({ estado: 'reposo', pendientes: [[asin(7)]], asins_sin_ba: [asin(7)] }), [asin(7)], HOY)
  ok('pendientes que solo tienen ASIN sin Brand Analytics: el periodo se cierra', quedabanMalos.tipo === 'cerrar' && quedabanMalos.transicion.parche.semana_ok === SEMANA.desde)
  ok('el motivo sale del documento JSON', motivoDeFatal('{"errorDetails":"Report request is not valid"}') === 'Amazon dice: Report request is not valid')
  ok('sin documento, motivo genérico', motivoDeFatal(null) === 'Amazon no ha dicho por qué.')
}

console.log('\n=== (d) error reintentable al recoger ===')
{
  const e = base({ asins: lista(1, 4), pedido_at: new Date(AHORA - 10 * 60_000).toISOString() })
  const t = errorReintentableAlRecoger('Amazon tiene el cupo agotado.')
  const despues = aplicar(e, t.parche)
  ok('sigue esperando con el mismo report_id', despues.estado === 'esperando' && despues.report_id === 'R1')
  ok('solo se apunta el error', Object.keys(t.parche).join() === 'error' && despues.error === 'Amazon tiene el cupo agotado.')
  ok('la tanda sigue donde estaba', despues.asins.length === 4 && despues.pendientes.length === 0)
  ok('a los 10 min aún no ha vencido', !esperaVencida(e, AHORA, 3_600_000))
}

console.log('\n=== (e) documento corrupto ===')
{
  const T1 = lista(1, 5)
  const T2 = lista(30, 5)
  const t = devolverTanda(base({ asins: T1, pendientes: [T2] }), 'El informe de Brand Analytics ha llegado roto (Unexpected end of JSON input).', AHORA, HOY)
  ok('reposo y sin report_id', t.parche.estado === 'reposo' && t.parche.report_id === null)
  ok('la tanda de vuelta al frente', JSON.stringify(t.parche.pendientes) === JSON.stringify([T1, T2]))
  ok('con el texto del error', String(t.parche.error).includes('Unexpected end of JSON input'))
  ok('cuenta el intento', t.parche.intentos === 1)
  const conteos = new Map<string, number>()
  contarFallo(conteos, 'R9')
  contarFallo(conteos, 'R9')
  ok('fallos de la base: se cuentan por informe', contarFallo(conteos, 'R9') === 3 && contarFallo(conteos, 'R8') === 1)
}

console.log('\n=== el cierre del periodo y el guardado ===')
{
  const g = trasGuardar(base({ asins: lista(1, 2), pendientes: [] }), HOY)
  ok('guardado sin pendientes: semana_ok, periodos_leidos, intentos 0', g.cerrado && g.parche.semana_ok === SEMANA.desde && g.parche.intentos === 0 && g.parche.error === null)
  const m = cierreDePeriodo(base({ periodo: 'MONTH', desde: MES.desde, mejoras: false }), [], HOY)
  ok('mes actual sin la 299: solo mes_ok', m.mes_ok === MES.desde && !('periodos_leidos' in m))
  const viejo = cierreDePeriodo(base({ periodo: 'WEEK', desde: '2026-09-06' }), [], HOY)
  ok('una semana antigua: solo periodos_leidos', !('semana_ok' in viejo) && (viejo.periodos_leidos as string[]).includes('WEEK:2026-09-06'))
  ok('con pendientes, nada', Object.keys(cierreDePeriodo(base(), [['X']], HOY)).length === 0)
}

console.log('\n=== el vigía de títulos ===')
{
  const filas = [
    { asin: 'A1', titulo: 'Nuevo', sku: 's1' },
    { asin: 'A2', titulo: 'Igual', sku: 's2' },
  ]
  const previo = [
    { asin: 'A1', titulo: 'Viejo', titulo_anterior: null, titulo_cambiado_at: null },
    { asin: 'A2', titulo: 'Igual', titulo_anterior: 'Antiguo', titulo_cambiado_at: '2026-11-01T00:00:00Z' },
  ]
  const r = filasConVigia(filas, previo, '2026-11-21T10:00:00Z')
  ok('el que cambia guarda el anterior', r[0].titulo_anterior === 'Viejo' && r[0].titulo_cambiado_at === '2026-11-21T10:00:00Z')
  ok('el que no cambia conserva su aviso', r[1].titulo_anterior === 'Antiguo' && r[1].titulo_cambiado_at === '2026-11-01T00:00:00Z')
  ok('todas las filas con las mismas claves', Object.keys(r[0]).sort().join() === Object.keys(r[1]).sort().join())
  const sinPrevio = filasConVigia(filas, null, '2026-11-21T10:00:00Z')
  ok('sin poder leer lo de antes: ninguna fila lleva titulo ni sus columnas', sinPrevio.every((f) => !('titulo' in f) && !('titulo_anterior' in f) && !('titulo_cambiado_at' in f)))
  ok('…pero el resto de la ficha sí', sinPrevio.every((f) => 'sku' in f && 'asin' in f))
}

console.log(fallos === 0 ? '\nTodo bien.\n' : `\n${fallos} FALLOS\n`)
process.exit(fallos === 0 ? 0 : 1)
