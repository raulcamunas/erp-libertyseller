import {
  CAJAS_DEL_CICLO,
  ESTADOS_DE_RITMO,
  ESTADOS_SOLO_DEL_CICLO,
  FASES_DEL_CICLO,
  cajaDelCiclo,
  camposDeCicloAlCambiarEstado,
  enCiclo,
  esCajaDeFase,
  esListaDeCiclo,
  estadoAlElegirCaja,
  estadoVisible,
  etiquetaDeEstadoVisible,
  faseValida,
  pistaDeEstadoVisible,
  type CajaDelCiclo,
  type FaseDelCiclo,
} from './ciclo'
import { COLD_STATUSES, COLD_STATUS_LABELS, type ColdLeadStatus } from '@/lib/types/cold-leads'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * LAS CAJAS DEL CICLO: EN CUÁL CAE CADA LEAD Y CÓMO SE LLAMA.
 *
 * Lo que hay que vigilar no da ningún error si falla: un lead que no cae en ninguna caja desaparece de su panel (cuenta en «Todos» y en ningún chip), y una caja que no tiene nombre pinta «undefined».
 */

console.log('\n=== las cajas ===')
{
  ok('son siete, como los siete estados de siempre: la fila de chips mide lo mismo', CAJAS_DEL_CICLO.length === COLD_STATUSES.length)
  ok('Sin contactar, Fase 2, Fase 3, No responde, En seguimiento, Cita agendada y No le interesa, en ese orden', CAJAS_DEL_CICLO.join(',') === 'pendiente,fase_2,fase_3,no_responde,seguimiento,cita_cualificada,no_interesa')
  ok('no hay «No contesta», «Rellamada programada» ni «Info enviada» (la fase y «En seguimiento» las sustituyen)', !CAJAS_DEL_CICLO.includes('no_contesta' as CajaDelCiclo) && !CAJAS_DEL_CICLO.includes('programado' as CajaDelCiclo) && !CAJAS_DEL_CICLO.includes('email_enviado' as CajaDelCiclo))
  ok('las tres nuevas son Fase 2, Fase 3 y No responde', ESTADOS_SOLO_DEL_CICLO.join(',') === 'fase_2,fase_3,no_responde')
  ok('las fases son tres: f2, f3 y sin_respuesta (la Fase 1 es «Sin contactar»: no tiene fase propia)', FASES_DEL_CICLO.join(',') === 'f2,f3,sin_respuesta' && faseValida('f2') && faseValida('f3') && faseValida('sin_respuesta') && !faseValida('f1') && !faseValida(null) && !faseValida(2))
}

console.log('\n=== en qué caja cae cada lead: todas las combinaciones ===')
{
  const fases: Array<FaseDelCiclo | null> = [null, 'f2', 'f3', 'sin_respuesta']
  const esperada = (estado: ColdLeadStatus, fase: FaseDelCiclo | null): CajaDelCiclo => {
    if (estado === 'seguimiento' || estado === 'cita_cualificada' || estado === 'no_interesa') return estado
    if (estado === 'programado' || estado === 'email_enviado') return 'seguimiento'
    return fase === 'f2' ? 'fase_2' : fase === 'f3' ? 'fase_3' : fase === 'sin_respuesta' ? 'no_responde' : 'pendiente'
  }
  let mal = ''
  for (const s of COLD_STATUSES) for (const f of fases) if (cajaDelCiclo({ status: s, ciclo_fase: f }) !== esperada(s, f)) mal += ` ${s}/${f}`
  ok('las 28 combinaciones (7 estados × 4 fases) caen donde toca', mal === '', mal)
  const todas = new Set<CajaDelCiclo>()
  for (const s of COLD_STATUSES) for (const f of fases) todas.add(cajaDelCiclo({ status: s, ciclo_fase: f }))
  ok('y no queda ninguna caja sin lead posible, ni un lead fuera de las siete', todas.size === 7 && [...todas].every((c) => CAJAS_DEL_CICLO.includes(c)))

  ok('un estado del ritmo con fase manda la fase: «No contesta» en Fase 2 es Fase 2', cajaDelCiclo({ status: 'no_contesta', ciclo_fase: 'f2' }) === 'fase_2' && cajaDelCiclo({ status: 'pendiente', ciclo_fase: 'f3' }) === 'fase_3')
  ok('pero un estado que no es del ritmo manda sobre la fase: si alguien ya habló, no es «Fase 2» aunque la fase siga puesta', cajaDelCiclo({ status: 'seguimiento', ciclo_fase: 'f2' }) === 'seguimiento' && cajaDelCiclo({ status: 'no_interesa', ciclo_fase: 'sin_respuesta' }) === 'no_interesa')
  ok('«llámame el jueves» (Rellamada programada) cuenta como En seguimiento: alguien ha hablado con el lead', cajaDelCiclo({ status: 'programado', ciclo_fase: null }) === 'seguimiento' && cajaDelCiclo({ status: 'programado', ciclo_fase: 'f3' }) === 'seguimiento')
  ok('«Info enviada» también (el panel del ciclo no la tiene)', cajaDelCiclo({ status: 'email_enviado', ciclo_fase: null }) === 'seguimiento')
  ok('sin fase, «No contesta» (lo pone Rinkel al primer toque) sigue siendo Sin contactar: es la Fase 1', cajaDelCiclo({ status: 'no_contesta', ciclo_fase: null }) === 'pendiente' && cajaDelCiclo({ status: 'no_contesta' }) === 'pendiente')
  ok('una fase que no existe (un dato corrupto) no hace desaparecer al lead: cae en Sin contactar', cajaDelCiclo({ status: 'no_contesta', ciclo_fase: 'zzz' as FaseDelCiclo }) === 'pendiente')
  ok('los estados del ritmo son Sin contactar y No contesta, y nada más', ESTADOS_DE_RITMO.join(',') === 'pendiente,no_contesta')
}

console.log('\n=== lo que se pinta: la caja si está en el ciclo y el estado de siempre si no ===')
{
  ok('un lead sin ciclo_vuelta NO está en el ciclo, y se pinta con su estado', !enCiclo({ ciclo_vuelta: null }) && !enCiclo({}) && estadoVisible({ status: 'no_contesta', ciclo_fase: null }) === 'no_contesta' && estadoVisible({ status: 'programado' }) === 'programado')
  ok('uno con ciclo_vuelta sí, y se pinta con su caja', enCiclo({ ciclo_vuelta: 1 }) && estadoVisible({ status: 'no_contesta', ciclo_fase: 'f2', ciclo_vuelta: 1 }) === 'fase_2' && estadoVisible({ status: 'pendiente', ciclo_fase: null, ciclo_vuelta: 1 }) === 'pendiente')
  ok('un lead ajeno al ciclo con una fase suelta (un resto) NO se pinta como Fase 2: sin ciclo_vuelta no entra', estadoVisible({ status: 'no_contesta', ciclo_fase: 'f2', ciclo_vuelta: null }) === 'no_contesta')
}

console.log('\n=== qué lista es «de ciclo» ===')
{
  ok('una lista en la que todos están en el ciclo, sí', esListaDeCiclo(400, 400))
  ok('con la mitad justa, no (hace falta MÁS de la mitad)', !esListaDeCiclo(400, 200) && esListaDeCiclo(400, 201))
  ok('un lead suelto con la marca en una lista de 800 NO la convierte en lista de ciclo', !esListaDeCiclo(800, 1))
  ok('una lista vacía, o sin ninguno, no', !esListaDeCiclo(0, 0) && !esListaDeCiclo(500, 0))
  ok('una lista de ciclo a la que se le añaden unos cuantos sueltos sigue siéndolo', esListaDeCiclo(420, 400))
}

console.log('\n=== nombres y pistas ===')
{
  ok('las tres nuevas se llaman Fase 2, Fase 3 y No responde', etiquetaDeEstadoVisible('fase_2') === 'Fase 2' && etiquetaDeEstadoVisible('fase_3') === 'Fase 3' && etiquetaDeEstadoVisible('no_responde') === 'No responde')
  ok('las demás conservan su nombre de siempre', COLD_STATUSES.every((s) => etiquetaDeEstadoVisible(s) === COLD_STATUS_LABELS[s]))
  ok('todas tienen pista, y ninguna dice «undefined»', [...COLD_STATUSES, ...ESTADOS_SOLO_DEL_CICLO].every((e) => pistaDeEstadoVisible(e).length > 10 && !pistaDeEstadoVisible(e).includes('undefined')))
  ok('las pistas de las fases avisan de que se pulsan a mano (desde el 30 oct 2026 no las pone el sistema)', ESTADOS_SOLO_DEL_CICLO.every((e) => pistaDeEstadoVisible(e).includes('Se pulsa a mano') && !pistaDeEstadoVisible(e).includes('La pone el sistema')))
  ok('las pistas de Fase 2 y Fase 3 dicen cuántos días laborables pasan hasta la rellamada', pistaDeEstadoVisible('fase_2').includes('2 días laborables') && pistaDeEstadoVisible('fase_3').includes('3 días laborables'))
}

console.log('\n=== las tres cajas de fase se pulsan; las otras son el estado de siempre ===')
{
  ok('Fase 2, Fase 3 y No responde son cajas de fase, y ninguno de los siete estados de siempre lo es', ESTADOS_SOLO_DEL_CICLO.every(esCajaDeFase) && COLD_STATUSES.every((s) => !esCajaDeFase(s)))
  ok('elegir una caja de fase NO es elegir un estado: no hay estado que guardar (guarda una fase y una fecha)', ESTADOS_SOLO_DEL_CICLO.every((c) => estadoAlElegirCaja(c) === null))
  ok('elegir cualquier otra caja es elegir ese estado, tal cual', COLD_STATUSES.every((s) => estadoAlElegirCaja(s) === s))
}

console.log('\n=== cuando una persona cambia el estado ===')
{
  const enFase = { ciclo_vuelta: 1, ciclo_fase: 'f2' as FaseDelCiclo }
  ok('a «En seguimiento», «Cita agendada», «No le interesa» o «Rellamada programada» el lead sale de la fase', (['seguimiento', 'cita_cualificada', 'no_interesa', 'programado'] as const).every((s) => camposDeCicloAlCambiarEstado(enFase, s).ciclo_fase === null))
  ok('a «Sin contactar» también: vuelve a empezar', camposDeCicloAlCambiarEstado(enFase, 'pendiente').ciclo_fase === null)
  ok('a «No contesta» NO: sigue en su fase (es el estado que le pone Rinkel)', Object.keys(camposDeCicloAlCambiarEstado(enFase, 'no_contesta')).length === 0)
  ok('un lead sin fase, o que no es del ciclo, no guarda nada de más', Object.keys(camposDeCicloAlCambiarEstado({ ciclo_vuelta: 1, ciclo_fase: null }, 'seguimiento')).length === 0 && Object.keys(camposDeCicloAlCambiarEstado({}, 'seguimiento')).length === 0 && Object.keys(camposDeCicloAlCambiarEstado({ ciclo_vuelta: null, ciclo_fase: 'f2' }, 'seguimiento')).length === 0)
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
