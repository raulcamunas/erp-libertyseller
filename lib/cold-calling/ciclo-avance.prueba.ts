import { decidirAvance, DIAS_HASTA_LA_SEGUNDA_VUELTA, MAX_DE_VUELTAS, type LeadParaElCiclo, type PasoParaElCiclo, type SecuenciaParaElCiclo } from './ciclo-avance'
import type { FaseDelCiclo } from './ciclo'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * LA REGLA DE LAS FASES: CUÁNDO PASA UN LEAD DE UNA A OTRA.
 *
 * El calendario de los ejemplos es el de verdad: el primer correo sale el martes 27 de octubre de 2026, el seguimiento 1 el viernes 30 (3 días hábiles) y el seguimiento 2 el jueves 5 de
 * noviembre (7). El lunes 2 de noviembre es festivo en Madrid, y no en Cataluña.
 */

const iso = (dia: string, hora = '08:30') => `${dia}T${hora}:00Z`
const paso = (orden: number, estado: string, programado: string | null, enviado: string | null = null): PasoParaElCiclo => ({ orden, estado, programado_at: programado ? iso(programado) : null, enviado_at: enviado ? iso(enviado, '08:35') : null })
const secuencia = (estado: string, pasos: PasoParaElCiclo[]): SecuenciaParaElCiclo => ({ estado, pasos })

/** La secuencia recién empezada: salió el primer correo y los dos seguimientos esperan */
const recienEmpezada = (estado = 'activa') => secuencia(estado, [paso(0, 'enviado', '2026-10-27', '2026-10-27'), paso(1, 'pendiente', '2026-10-30'), paso(2, 'pendiente', '2026-11-05')])
/** Salió el seguimiento 1 */
const trasElPrimero = (estado = 'activa') => secuencia(estado, [paso(0, 'enviado', '2026-10-27', '2026-10-27'), paso(1, 'enviado', '2026-10-30', '2026-10-30'), paso(2, 'pendiente', '2026-11-05')])
/** Salió el seguimiento 2: ya no queda ningún correo */
const trasElSegundo = (estado = 'completada') => secuencia(estado, [paso(0, 'enviado', '2026-10-27', '2026-10-27'), paso(1, 'enviado', '2026-10-30', '2026-10-30'), paso(2, 'enviado', '2026-11-05', '2026-11-05')])

const lead = (extra: Partial<LeadParaElCiclo> = {}): LeadParaElCiclo => ({ status: 'no_contesta', ciclo_fase: null, ciclo_vuelta: 1, next_call_date: null, ccaa: null, municipio_ine: null, ...extra })
const madrid = { ccaa: 'MD' as const, municipio_ine: '28079' }
const barcelona = { ccaa: 'CT' as const, municipio_ine: '08019' }

console.log('\n=== Fase 1 → Fase 2: el comercial manda el primer correo con seguimientos ===')
{
  const c = decidirAvance(lead(), recienEmpezada(), '2026-10-27')
  ok('con la secuencia en marcha pasa a Fase 2 y la rellamada es el día del seguimiento 1', c?.motivo === 'fase_2' && c.campos.ciclo_fase === 'f2' && c.campos.next_call_date === '2026-10-30', JSON.stringify(c))
  ok('no toca el estado ni la vuelta', c !== null && !('status' in c.campos) && !('ciclo_vuelta' in c.campos))
  ok('y vale también si el lead estaba «Sin contactar» (el comercial mandó el correo sin llamar antes)', decidirAvance(lead({ status: 'pendiente' }), recienEmpezada(), '2026-10-27')?.motivo === 'fase_2')
  ok('sin secuencia no pasa nada: sigue en la Fase 1', decidirAvance(lead(), null, '2026-10-27') === null)
  ok('con una secuencia que ya no está en marcha (respondió, la paró una conversación, la canceló alguien) tampoco', (['respondida', 'parada', 'cancelada', 'pausada', 'completada', 'sin_respuesta'] as const).every((e) => decidirAvance(lead(), recienEmpezada(e), '2026-10-27') === null))
  ok('ni con una secuencia a la que no le queda ningún seguimiento por salir', decidirAvance(lead(), trasElSegundo('activa'), '2026-11-06') === null)

  const lunesFestivo = secuencia('activa', [paso(0, 'enviado', '2026-10-28', '2026-10-28'), paso(1, 'pendiente', '2026-11-02'), paso(2, 'pendiente', '2026-11-06')])
  ok('si el seguimiento sale un día festivo para el lead (lunes 2 de noviembre en Madrid) la LLAMADA pasa al martes: el correo no se mueve', decidirAvance(lead(madrid), lunesFestivo, '2026-10-28')?.campos.next_call_date === '2026-11-03')
  ok('en Barcelona ese lunes no es festivo: se llama el mismo día que el correo', decidirAvance(lead(barcelona), lunesFestivo, '2026-10-28')?.campos.next_call_date === '2026-11-02')
  ok('un lead sin ubicar nunca se retrasa: no se inventa', decidirAvance(lead(), lunesFestivo, '2026-10-28')?.campos.next_call_date === '2026-11-02')
  ok('el día se cuenta en hora de Madrid: un correo a las 23:30 UTC ya es del día siguiente', decidirAvance(lead(), secuencia('activa', [paso(0, 'enviado', '2026-10-27', '2026-10-27'), { orden: 1, estado: 'pendiente', programado_at: '2026-10-29T23:30:00Z', enviado_at: null }]), '2026-10-27')?.campos.next_call_date === '2026-10-30')
  ok('si el primer seguimiento ya salió, el siguiente por salir manda (no se pone la rellamada en el pasado)', decidirAvance(lead(), trasElPrimero(), '2026-10-31')?.campos.next_call_date === '2026-11-05')
}

console.log('\n=== Fase 2 → Fase 3: salió el seguimiento 1 y su día ya pasó ===')
{
  const enF2 = lead({ ciclo_fase: 'f2', next_call_date: '2026-10-30' })
  ok('el mismo día del seguimiento 1 NO pasa de fase: es el día de llamar', decidirAvance(enF2, trasElPrimero(), '2026-10-30') === null)
  const c = decidirAvance(enF2, trasElPrimero(), '2026-10-31')
  ok('al día siguiente pasa a Fase 3 con la rellamada el día del seguimiento 2', c?.motivo === 'fase_3' && c.campos.ciclo_fase === 'f3' && c.campos.next_call_date === '2026-11-05', JSON.stringify(c))
  ok('si el seguimiento 1 todavía no ha salido (pendiente) se queda en Fase 2, aunque su día haya pasado', decidirAvance(enF2, recienEmpezada(), '2026-11-02') === null)
  ok('si el motor lo saltó o falló, el ritmo sigue igual (las llamadas no esperan al correo)', ['saltado', 'fallido'].every((e) => decidirAvance(enF2, secuencia('activa', [paso(0, 'enviado', '2026-10-27', '2026-10-27'), paso(1, e, '2026-10-30'), paso(2, 'pendiente', '2026-11-05')]), '2026-10-31')?.motivo === 'fase_3'))
  ok('si lo canceló una persona, no se avanza', decidirAvance(enF2, secuencia('activa', [paso(0, 'enviado', '2026-10-27', '2026-10-27'), paso(1, 'cancelado', '2026-10-30'), paso(2, 'pendiente', '2026-11-05')]), '2026-10-31') === null)
  ok('una secuencia congelada (respondió, la paró una conversación, se canceló o está pausada) NO avanza: un lead que contestó no es un «No responde»', (['respondida', 'parada', 'cancelada', 'pausada'] as const).every((e) => decidirAvance(enF2, trasElPrimero(e), '2026-10-31') === null))
  ok('sin secuencia (se borró) no avanza', decidirAvance(enF2, null, '2026-10-31') === null)
  const unSoloSeguimiento = secuencia('activa', [paso(0, 'enviado', '2026-10-27', '2026-10-27'), paso(1, 'enviado', '2026-10-30', '2026-10-30')])
  ok('con una secuencia de un solo seguimiento no hay Fase 3: pasa directo a «No responde»', decidirAvance(enF2, unSoloSeguimiento, '2026-10-31')?.motivo === 'sin_respuesta')
  const rellamadaMadrid = decidirAvance(lead({ ...madrid, ciclo_fase: 'f2' }), secuencia('activa', [paso(0, 'enviado', '2026-10-27', '2026-10-27'), paso(1, 'enviado', '2026-10-30', '2026-10-30'), paso(2, 'pendiente', '2026-11-09')]), '2026-10-31')
  ok('la Fase 3 también salta los festivos del lead: el lunes 9 de noviembre es la Almudena (festivo en Madrid capital), se llama el martes 10', rellamadaMadrid?.campos.next_call_date === '2026-11-10', JSON.stringify(rellamadaMadrid))
}

console.log('\n=== un seguimiento por salir que todavía no tiene día NO es el fin del ritmo ===')
{
  const sinDia = secuencia('activa', [paso(0, 'enviado', '2026-10-27', '2026-10-27'), paso(1, 'enviado', '2026-10-30', '2026-10-30'), paso(2, 'pendiente', null)])
  ok('en Fase 2, con el seguimiento 1 ya fuera y el 2 pendiente SIN día, no pasa a «No responde» (esperaría 60 días con un correo todavía por salir): espera', decidirAvance(lead({ ciclo_fase: 'f2' }), sinDia, '2026-10-31') === null)
  ok('en cuanto el seguimiento 2 tiene día, pasa a Fase 3 con él', decidirAvance(lead({ ciclo_fase: 'f2' }), secuencia('activa', [paso(0, 'enviado', '2026-10-27', '2026-10-27'), paso(1, 'enviado', '2026-10-30', '2026-10-30'), paso(2, 'pendiente', '2026-11-05')]), '2026-10-31')?.motivo === 'fase_3')
  ok('y si de verdad no queda ninguno, sí es el fin', decidirAvance(lead({ ciclo_fase: 'f2' }), secuencia('activa', [paso(0, 'enviado', '2026-10-27', '2026-10-27'), paso(1, 'enviado', '2026-10-30', '2026-10-30')]), '2026-10-31')?.motivo === 'sin_respuesta')
  ok('en Fase 1, con el primer seguimiento todavía sin día, no empieza la Fase 2 (no sabría cuándo rellamar)', decidirAvance(lead(), secuencia('activa', [paso(0, 'enviado', '2026-10-27', '2026-10-27'), paso(1, 'pendiente', null), paso(2, 'pendiente', null)]), '2026-10-27') === null)
}

console.log('\n=== Fase 3 → No responde: salió el último seguimiento y su día ya pasó ===')
{
  const enF3 = lead({ ciclo_fase: 'f3', next_call_date: '2026-11-05' })
  ok('el día del último seguimiento todavía no: es el día de llamar', decidirAvance(enF3, trasElSegundo(), '2026-11-05') === null)
  const c = decidirAvance(enF3, trasElSegundo(), '2026-11-06')
  ok('al día siguiente pasa a «No responde», con la rellamada a los 60 días', c?.motivo === 'sin_respuesta' && c.campos.ciclo_fase === 'sin_respuesta' && c.campos.next_call_date === '2027-01-05', JSON.stringify(c))
  ok('si estaba «No contesta» no se toca el estado', c !== null && !('status' in c.campos))
  ok('si estaba «Sin contactar», pasa a «No contesta»: es lo que de verdad es', decidirAvance(lead({ status: 'pendiente', ciclo_fase: 'f3' }), trasElSegundo(), '2026-11-06')?.campos.status === 'no_contesta')
  ok('vale con la secuencia «completada» (el motor la da por cerrada en cuanto sale el último correo) y con «sin_respuesta»', ['activa', 'completada', 'sin_respuesta'].every((e) => decidirAvance(enF3, trasElSegundo(e), '2026-11-06')?.motivo === 'sin_respuesta'))
  ok('pero no con una congelada: si contestó, no es un «No responde»', (['respondida', 'parada', 'cancelada', 'pausada'] as const).every((e) => decidirAvance(enF3, trasElSegundo(e), '2026-11-06') === null))
  ok('si el último seguimiento todavía no ha salido, se queda en Fase 3', decidirAvance(enF3, trasFalta(), '2026-11-10') === null)
  ok('dos meses son 60 días', DIAS_HASTA_LA_SEGUNDA_VUELTA === 60)
  const salioAntes = secuencia('completada', [paso(0, 'enviado', '2026-10-13', '2026-10-13'), paso(1, 'enviado', '2026-10-16', '2026-10-16'), paso(2, 'enviado', '2026-10-22', '2026-10-22')])
  ok('la fecha de vuelta cae en día hábil: 60 días después del 27 de octubre es sábado 26 de diciembre y se pasa al lunes 28', decidirAvance(enF3, salioAntes, '2026-10-27')?.campos.next_call_date === '2026-12-28')
}
function trasFalta(): SecuenciaParaElCiclo {
  return secuencia('activa', [paso(0, 'enviado', '2026-10-27', '2026-10-27'), paso(1, 'enviado', '2026-10-30', '2026-10-30'), paso(2, 'pendiente', '2026-11-05')])
}

console.log('\n=== No responde → 2.ª vuelta ===')
{
  const parado = lead({ ciclo_fase: 'sin_respuesta', next_call_date: '2027-01-05' })
  ok('antes de su día no pasa nada', decidirAvance(parado, trasElSegundo('sin_respuesta'), '2027-01-04') === null)
  const c = decidirAvance(parado, trasElSegundo('sin_respuesta'), '2027-01-05')
  ok('el día que toca vuelve a Sin contactar (sin fase) y empieza la 2.ª vuelta; la fecha se queda: es la llamada de hoy', c?.motivo === 'otra_vuelta' && c.campos.ciclo_fase === null && c.campos.ciclo_vuelta === 2 && !('next_call_date' in c.campos), JSON.stringify(c))
  ok('si se olvidó un día, también vuelve', decidirAvance(parado, null, '2027-01-12')?.campos.ciclo_vuelta === 2)
  ok('la tercera vuelta es la 3', decidirAvance(lead({ ciclo_vuelta: 2, ciclo_fase: 'sin_respuesta', next_call_date: '2027-03-09' }), null, '2027-03-09')?.campos.ciclo_vuelta === 3)
  ok('sin fecha de rellamada (alguien la borró) no vuelve solo: no se sabe cuándo tocaba', decidirAvance(lead({ ciclo_fase: 'sin_respuesta', next_call_date: null }), null, '2027-01-12') === null)
  ok('vuelve con la secuencia vieja cerrada sin respuesta («completada» o «sin_respuesta») y con ninguna', ['completada', 'sin_respuesta'].every((e) => decidirAvance(parado, trasElSegundo(e), '2027-01-05')?.motivo === 'otra_vuelta') && decidirAvance(parado, null, '2027-01-05')?.motivo === 'otra_vuelta')
  ok('pero NO si en estos dos meses contestó o lo paró alguien (respondida, parada, pausada, cancelada): lo decide quien lo lleva, y no entra solo en otra vuelta', (['respondida', 'parada', 'pausada', 'cancelada'] as const).every((e) => decidirAvance(parado, trasElSegundo(e), '2027-01-05') === null))
  ok('con una secuencia nueva en marcha vuelve (la Fase 1 la recogerá en la pasada siguiente)', decidirAvance(parado, recienEmpezada('activa'), '2027-01-05')?.motivo === 'otra_vuelta')
  ok(`hay un tope de ${MAX_DE_VUELTAS} vueltas (el CHECK de la migración): la última se hace y la siguiente no`, decidirAvance(lead({ ciclo_vuelta: MAX_DE_VUELTAS - 1, ciclo_fase: 'sin_respuesta', next_call_date: '2027-01-05' }), null, '2027-01-05')?.campos.ciclo_vuelta === MAX_DE_VUELTAS && decidirAvance(lead({ ciclo_vuelta: MAX_DE_VUELTAS, ciclo_fase: 'sin_respuesta', next_call_date: '2027-01-05' }), null, '2027-01-05') === null)
  const segundaVuelta = decidirAvance(lead({ ciclo_vuelta: 2 }), trasElSegundo('completada'), '2027-01-06')
  ok('en la 2.ª vuelta, con la secuencia vieja ya cerrada, no pasa a Fase 2 hasta que haya una nueva en marcha', segundaVuelta === null)
}

console.log('\n=== alguien ha hablado con el lead: sale de las fases ===')
{
  for (const estado of ['seguimiento', 'cita_cualificada', 'no_interesa', 'programado', 'email_enviado'] as const) {
    const c = decidirAvance(lead({ status: estado, ciclo_fase: 'f2' }), trasElPrimero(), '2026-10-31')
    ok(`con «${estado}» y la Fase 2 puesta, se le quita la fase y nada más`, c?.motivo === 'sale_del_ritmo' && c.campos.ciclo_fase === null && Object.keys(c.campos).length === 1, JSON.stringify(c))
  }
  ok('lo mismo con la Fase 3 y con «No responde»', ['f3', 'sin_respuesta'].every((f) => decidirAvance(lead({ status: 'seguimiento', ciclo_fase: f as FaseDelCiclo }), null, '2026-11-10')?.motivo === 'sale_del_ritmo'))
  ok('un lead que no tiene fase y ya está en seguimiento no necesita nada', decidirAvance(lead({ status: 'seguimiento', ciclo_fase: null }), recienEmpezada(), '2026-10-27') === null)
  ok('y NUNCA se le pasa a «En seguimiento», «Cita agendada» ni «No le interesa» por su cuenta, en ninguna fase ni día', (() => {
    for (const fase of [null, 'f2', 'f3', 'sin_respuesta'] as Array<FaseDelCiclo | null>)
      for (const sec of [null, recienEmpezada(), trasElPrimero(), trasElSegundo(), trasElSegundo('respondida')])
        for (const dia of ['2026-10-27', '2026-10-31', '2026-11-06', '2027-01-05', '2027-03-01']) {
          const c = decidirAvance(lead({ ciclo_fase: fase, next_call_date: '2027-01-05' }), sec, dia)
          if (c?.campos.status && !['no_contesta'].includes(c.campos.status)) return false
        }
    return true
  })())
  ok('un valor de fase que no existe se deja como está: no se inventa', decidirAvance(lead({ ciclo_fase: 'zzz' as FaseDelCiclo }), recienEmpezada(), '2026-10-27') === null)
}

console.log('\n=== el recorrido entero, día a día, como lo vería la pantalla ===')
{
  // El lead entra en Fase 1 el 26 de octubre; el 27 el comercial manda el primer correo; el motor manda los dos seguimientos sus días; nadie contesta; a los dos meses vuelve
  let l: LeadParaElCiclo = lead({ ccaa: 'AN', municipio_ine: '41091' })
  const pasos: PasoParaElCiclo[] = [paso(0, 'enviado', '2026-10-27', '2026-10-27'), paso(1, 'pendiente', '2026-10-30'), paso(2, 'pendiente', '2026-11-05')]
  const diario: string[] = []
  const ya = (dia: string) => pasos.forEach((p) => { if (p.orden > 0 && p.estado === 'pendiente' && p.programado_at && p.programado_at.slice(0, 10) <= dia) { p.estado = 'enviado'; p.enviado_at = iso(p.programado_at.slice(0, 10), '08:40') } })
  let secuenciaViva = false
  for (let d = new Date('2026-10-26T12:00:00Z'); d <= new Date('2027-01-07T12:00:00Z'); d = new Date(d.getTime() + 86_400_000)) {
    const dia = d.toISOString().slice(0, 10)
    if (dia === '2026-10-27') secuenciaViva = true
    if (secuenciaViva) ya(dia)
    const c = decidirAvance(l, secuenciaViva ? secuencia(pasos.every((p) => p.estado === 'enviado') ? 'completada' : 'activa', pasos) : null, dia)
    if (c) {
      l = { ...l, ...c.campos } as LeadParaElCiclo
      diario.push(`${dia} ${c.motivo}${c.campos.next_call_date ? ` (llamar ${c.campos.next_call_date})` : ''}`)
    }
  }
  console.log('    ' + diario.join('\n    '))
  ok('Fase 2 el 27 (llamar el 30), Fase 3 el 31 (llamar el 5), No responde el 6 de noviembre (llamar el 5 de enero) y 2.ª vuelta ese día', diario.join(' | ') === '2026-10-27 fase_2 (llamar 2026-10-30) | 2026-10-31 fase_3 (llamar 2026-11-05) | 2026-11-06 sin_respuesta (llamar 2027-01-05) | 2027-01-05 otra_vuelta', diario.join(' | '))
  ok('y acaba en «Sin contactar» de la vuelta 2, sin fase, con la fecha de la llamada de ese día', l.ciclo_vuelta === 2 && l.ciclo_fase === null && l.next_call_date === '2027-01-05')
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
