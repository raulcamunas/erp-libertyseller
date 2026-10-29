import { sumarDiasHabiles } from '@/lib/correo/secuencias/fechas'
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
 * Los correos salen solos a sus días; las FASES avanzan cuando se HACE LA LLAMADA, no cuando pasa el día: un lead al que no se llama se queda donde está, cada día más atrasado (y se limpia
 * llamando), hasta que la secuencia de correos se cierra sin respuesta.
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
const LLAMADO = { llamadaHecha: true }

console.log('\n=== Fase 1 → Fase 2: el comercial manda el primer correo con seguimientos ===')
{
  const c = decidirAvance(lead(), recienEmpezada(), '2026-10-27')
  ok('con la secuencia en marcha pasa a Fase 2 y la rellamada es el día del seguimiento 1', c?.motivo === 'fase_2' && c.campos.ciclo_fase === 'f2' && c.campos.next_call_date === '2026-10-30', JSON.stringify(c))
  ok('no toca el estado ni la vuelta', c !== null && !('status' in c.campos) && !('ciclo_vuelta' in c.campos))
  ok('apunta en el historial qué ha pasado y cuándo hay que llamar', c?.nota === 'Ciclo comercial · Pasa a Fase 2. Rellamada el vie 30 oct, el día del siguiente correo.', c?.nota)
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

console.log('\n=== Fase 2: SE QUEDA hasta que se llama, y cada día está más atrasado ===')
{
  const enF2 = lead({ ciclo_fase: 'f2', next_call_date: '2026-10-30' })
  ok('el día de la rellamada, sin llamar, sigue en Fase 2', decidirAvance(enF2, trasElPrimero(), '2026-10-30') === null)
  ok('y al día siguiente, y a la semana: el correo ya salió pero la llamada no se ha hecho, así que NO salta de fase en silencio', ['2026-10-31', '2026-11-02', '2026-11-03', '2026-11-04'].every((d) => decidirAvance(enF2, trasElPrimero(), d) === null))
  ok('ni siquiera cuando ya ha salido el seguimiento 2 (mientras la secuencia no se cierre)', decidirAvance(enF2, trasElSegundo('completada'), '2026-11-09') === null)
  ok('lo mismo con la secuencia recién empezada y su día por llegar', decidirAvance(enF2, recienEmpezada(), '2026-10-28') === null)
}

console.log('\n=== Fase 2 → Fase 3: se hace la llamada ===')
{
  const enF2 = lead({ ciclo_fase: 'f2', next_call_date: '2026-10-30' })
  const c = decidirAvance(enF2, trasElPrimero(), '2026-10-30', LLAMADO)
  ok('llamado el día de la rellamada pasa a Fase 3, con la rellamada el día del seguimiento 2', c?.motivo === 'fase_3' && c.campos.ciclo_fase === 'f3' && c.campos.next_call_date === '2026-11-05', JSON.stringify(c))
  ok('apunta que se hizo la llamada y cuándo toca la siguiente', c?.nota === 'Ciclo comercial · Hecha la llamada de la Fase 2: pasa a Fase 3. Rellamada el jue 5 nov.', c?.nota)
  ok('vale aunque el seguimiento 1 todavía no haya salido (se llama por la mañana y el correo sale a mediodía)', decidirAvance(enF2, recienEmpezada(), '2026-10-30', LLAMADO)?.campos.next_call_date === '2026-11-05')
  ok('y llamado tarde (el lunes 2) sigue siendo la Fase 3 con el seguimiento 2 todavía por llegar', decidirAvance(enF2, trasElPrimero(), '2026-11-02', LLAMADO)?.campos.next_call_date === '2026-11-05')
  ok('si el día del seguimiento 2 ya es hoy o pasó, no se pone la rellamada ese mismo día (no se llama dos veces el mismo día): el siguiente hábil', decidirAvance(enF2, trasElPrimero(), '2026-11-05', LLAMADO)?.campos.next_call_date === '2026-11-06' && decidirAvance(enF2, trasElPrimero(), '2026-11-07', LLAMADO)?.campos.next_call_date === '2026-11-09')
  ok('el siguiente hábil salta los festivos del lead: el lunes 9 es la Almudena en Madrid capital', decidirAvance(lead({ ...madrid, ciclo_fase: 'f2', next_call_date: '2026-10-30' }), trasElPrimero(), '2026-11-07', LLAMADO)?.campos.next_call_date === '2026-11-10')
  const sinFecha = secuencia('activa', [paso(0, 'enviado', '2026-10-27', '2026-10-27'), paso(1, 'enviado', '2026-10-30', '2026-10-30'), paso(2, 'pendiente', null)])
  ok('si el seguimiento 2 todavía no tiene día, espera (no es el fin de los correos)', decidirAvance(enF2, sinFecha, '2026-10-31', LLAMADO) === null)
  ok('con una secuencia de un solo seguimiento no hay Fase 3: llamado, pasa directo a «No responde»', decidirAvance(enF2, secuencia('activa', [paso(0, 'enviado', '2026-10-27', '2026-10-27'), paso(1, 'enviado', '2026-10-30', '2026-10-30')]), '2026-10-31', LLAMADO)?.motivo === 'sin_respuesta')
  ok('y si se llama cuando ya han salido los dos seguimientos, también: no queda ningún correo', decidirAvance(enF2, trasElSegundo('completada'), '2026-11-09', LLAMADO)?.motivo === 'sin_respuesta')
  ok('una secuencia congelada (respondió, la paró una conversación, se canceló o está pausada) NO avanza ni llamando: un lead que contestó no es un «No responde»', (['respondida', 'parada', 'cancelada', 'pausada'] as const).every((e) => decidirAvance(enF2, trasElPrimero(e), '2026-10-31', LLAMADO) === null))
  ok('sin secuencia (se borró) no avanza', decidirAvance(enF2, null, '2026-10-31', LLAMADO) === null)
}

console.log('\n=== Fase 2 y 3: si la secuencia de correos se cierra sin respuesta, no se quedan atrasados para siempre ===')
{
  const enF2 = lead({ ciclo_fase: 'f2', next_call_date: '2026-10-30' })
  const enF3 = lead({ ciclo_fase: 'f3', next_call_date: '2026-11-05' })
  const cerrada = trasElSegundo('sin_respuesta')
  const c2 = decidirAvance(enF2, cerrada, '2026-11-16')
  ok('un lead de Fase 2 al que nunca se llamó pasa a «No responde» cuando el motor cierra la secuencia (siete días hábiles tras el último correo)', c2?.motivo === 'sin_respuesta' && c2.campos.ciclo_fase === 'sin_respuesta' && c2.campos.next_call_date === '2027-01-15', JSON.stringify(c2))
  ok('con su apunte', c2?.nota.startsWith('Ciclo comercial · Acabó la secuencia de correos sin respuesta: pasa a «No responde». Se vuelve a llamar el vie 15 ene') === true, c2?.nota)
  ok('y uno de Fase 3 igual', decidirAvance(enF3, cerrada, '2026-11-16')?.motivo === 'sin_respuesta')
  ok('mientras la secuencia solo esté «completada» (esperando el cierre), el lead sigue donde estaba', decidirAvance(enF2, trasElSegundo('completada'), '2026-11-10') === null && decidirAvance(enF3, trasElSegundo('completada'), '2026-11-10') === null)
}

console.log('\n=== un seguimiento por salir que todavía no tiene día NO es el fin del ritmo ===')
{
  const sinDia = secuencia('activa', [paso(0, 'enviado', '2026-10-27', '2026-10-27'), paso(1, 'enviado', '2026-10-30', '2026-10-30'), paso(2, 'pendiente', null)])
  ok('en Fase 2, llamado, con el seguimiento 2 pendiente SIN día, no pasa a «No responde» (esperaría 60 días con un correo todavía por salir): espera', decidirAvance(lead({ ciclo_fase: 'f2', next_call_date: '2026-10-30' }), sinDia, '2026-10-31', LLAMADO) === null)
  ok('en cuanto tiene día, pasa a Fase 3 con él', decidirAvance(lead({ ciclo_fase: 'f2', next_call_date: '2026-10-30' }), trasElPrimero(), '2026-10-31', LLAMADO)?.motivo === 'fase_3')
  ok('en Fase 1, con el primer seguimiento todavía sin día, no empieza la Fase 2 (no sabría cuándo rellamar)', decidirAvance(lead(), secuencia('activa', [paso(0, 'enviado', '2026-10-27', '2026-10-27'), paso(1, 'pendiente', null), paso(2, 'pendiente', null)]), '2026-10-27') === null)
}

console.log('\n=== Fase 3 → No responde: se hace la llamada ===')
{
  const enF3 = lead({ ciclo_fase: 'f3', next_call_date: '2026-11-05' })
  ok('sin llamar, sigue en Fase 3 aunque el último correo ya haya salido y pasen los días', ['2026-11-05', '2026-11-06', '2026-11-12'].every((d) => decidirAvance(enF3, trasElSegundo(), d) === null))
  const c = decidirAvance(enF3, trasElSegundo(), '2026-11-05', LLAMADO)
  ok('llamado, pasa a «No responde», con la rellamada a los 60 días', c?.motivo === 'sin_respuesta' && c.campos.ciclo_fase === 'sin_respuesta' && c.campos.next_call_date === '2027-01-04', JSON.stringify(c))
  ok('apunta cuál fue la llamada y cuándo se vuelve a llamar', c?.nota === 'Ciclo comercial · Hecha la llamada de la Fase 3: pasa a «No responde». Se vuelve a llamar el lun 4 ene, a los dos meses.', c?.nota)
  ok('si estaba «No contesta» no se toca el estado', c !== null && !('status' in c.campos))
  ok('si estaba «Sin contactar», pasa a «No contesta»: es lo que de verdad es', decidirAvance(lead({ status: 'pendiente', ciclo_fase: 'f3', next_call_date: '2026-11-05' }), trasElSegundo(), '2026-11-05', LLAMADO)?.campos.status === 'no_contesta')
  ok('vale aunque el último correo todavía no haya salido (se llama por la mañana y el correo sale a mediodía): el correo sale igual', decidirAvance(enF3, trasFalta(), '2026-11-05', LLAMADO)?.motivo === 'sin_respuesta')
  ok('una secuencia congelada no avanza ni llamando: si contestó, no es un «No responde»', (['respondida', 'parada', 'cancelada', 'pausada'] as const).every((e) => decidirAvance(enF3, trasElSegundo(e), '2026-11-05', LLAMADO) === null))
  ok('dos meses son 60 días', DIAS_HASTA_LA_SEGUNDA_VUELTA === 60)
  const salioAntes = secuencia('completada', [paso(0, 'enviado', '2026-10-13', '2026-10-13'), paso(1, 'enviado', '2026-10-16', '2026-10-16'), paso(2, 'enviado', '2026-10-22', '2026-10-22')])
  ok('la fecha de vuelta cae en día hábil: 60 días después del 27 de octubre es sábado 26 de diciembre y se pasa al lunes 28', decidirAvance(lead({ ciclo_fase: 'f3', next_call_date: '2026-10-27' }), salioAntes, '2026-10-27', LLAMADO)?.campos.next_call_date === '2026-12-28')
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
  ok('y lo apunta', c?.nota === 'Ciclo comercial · Han pasado los dos meses: vuelve a «Sin contactar» (vuelta 2).', c?.nota)
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
    ok(`con «${estado}» y la Fase 2 puesta, se le quita la fase y nada más`, c?.motivo === 'sale_del_ritmo' && c.campos.ciclo_fase === null && Object.keys(c.campos).length === 1 && c.nota.startsWith('Ciclo comercial · Sale de las fases'), JSON.stringify(c))
  }
  ok('el apunte dice en qué estado está', decidirAvance(lead({ status: 'seguimiento', ciclo_fase: 'f2' }), null, '2026-10-31')?.nota === 'Ciclo comercial · Sale de las fases: el lead está en «En seguimiento».')
  ok('lo mismo con la Fase 3 y con «No responde»', ['f3', 'sin_respuesta'].every((f) => decidirAvance(lead({ status: 'seguimiento', ciclo_fase: f as FaseDelCiclo }), null, '2026-11-10')?.motivo === 'sale_del_ritmo'))
  ok('un lead que no tiene fase y ya está en seguimiento no necesita nada', decidirAvance(lead({ status: 'seguimiento', ciclo_fase: null }), recienEmpezada(), '2026-10-27') === null)
  ok('y NUNCA se le pasa a «En seguimiento», «Cita agendada» ni «No le interesa» por su cuenta, en ninguna fase ni día, llamado o no', (() => {
    for (const fase of [null, 'f2', 'f3', 'sin_respuesta'] as Array<FaseDelCiclo | null>)
      for (const sec of [null, recienEmpezada(), trasElPrimero(), trasElSegundo(), trasElSegundo('respondida'), trasElSegundo('sin_respuesta')])
        for (const dia of ['2026-10-27', '2026-10-31', '2026-11-06', '2027-01-05', '2027-03-01'])
          for (const llamadaHecha of [false, true]) {
            const c = decidirAvance(lead({ ciclo_fase: fase, next_call_date: '2026-10-30' }), sec, dia, { llamadaHecha })
            if (c?.campos.status && !['no_contesta'].includes(c.campos.status)) return false
          }
    return true
  })())
  ok('un valor de fase que no existe se deja como está: no se inventa', decidirAvance(lead({ ciclo_fase: 'zzz' as FaseDelCiclo }), recienEmpezada(), '2026-10-27') === null)
  ok('NUNCA cambia de fase solo por pasar los días, sea cual sea el día (sin llamada y con la secuencia sin cerrar)', (() => {
    for (const fase of ['f2', 'f3'] as const)
      for (const sec of [recienEmpezada(), trasElPrimero(), trasElSegundo('completada'), trasElSegundo('activa')])
        for (let d = 0; d < 90; d++) {
          const dia = new Date(Date.UTC(2026, 9, 27) + d * 86_400_000).toISOString().slice(0, 10)
          if (decidirAvance(lead({ ciclo_fase: fase, next_call_date: '2026-10-30' }), sec, dia) !== null) return false
        }
    return true
  })())
}

/** Un recorrido día a día. `llama(dia, fase, rellamada)` dice si el comercial llama ese día. Devuelve cómo acaba y lo que fue pasando */
function recorrido(llama: (dia: string, fase: FaseDelCiclo | null, rellamada: string | null) => boolean, hasta = '2027-01-20') {
  let l: LeadParaElCiclo = lead({ ccaa: 'AN', municipio_ine: '41091' })
  const pasos: PasoParaElCiclo[] = [paso(0, 'enviado', '2026-10-27', '2026-10-27'), paso(1, 'pendiente', '2026-10-30'), paso(2, 'pendiente', '2026-11-05')]
  const diario: string[] = []
  const notas: string[] = []
  let viva = false
  const cierre = sumarDiasHabiles('2026-11-05', 7)
  const llamadas: string[] = []
  for (let d = new Date('2026-10-26T12:00:00Z'); d.toISOString().slice(0, 10) <= hasta; d = new Date(d.getTime() + 86_400_000)) {
    const dia = d.toISOString().slice(0, 10)
    if (dia === '2026-10-27') viva = true
    for (const p of pasos) if (viva && p.orden > 0 && p.estado === 'pendiente' && p.programado_at && p.programado_at.slice(0, 10) <= dia) { p.estado = 'enviado'; p.enviado_at = iso(p.programado_at.slice(0, 10), '08:40') }
    const todosFuera = pasos.every((p) => p.estado === 'enviado')
    const estadoSec = !viva ? null : dia >= cierre && todosFuera ? 'sin_respuesta' : todosFuera ? 'completada' : 'activa'
    if (viva && llama(dia, l.ciclo_fase, l.next_call_date)) llamadas.push(dia)
    const llamadaHecha = l.next_call_date !== null && llamadas.some((c) => c >= l.next_call_date!)
    const c = decidirAvance(l, estadoSec ? secuencia(estadoSec, pasos) : null, dia, { llamadaHecha })
    if (c) {
      l = { ...l, ...c.campos } as LeadParaElCiclo
      diario.push(`${dia} ${c.motivo}${c.campos.next_call_date ? ` (llamar ${c.campos.next_call_date})` : ''}`)
      notas.push(c.nota)
    }
  }
  return { l, resumen: diario.join(' | '), notas }
}

console.log('\n=== el recorrido entero, día a día: el comercial llama cada día que toca ===')
{
  const r = recorrido((dia, fase, rellamada) => fase !== null && rellamada !== null && dia === rellamada)
  console.log('    ' + r.resumen.split(' | ').join('\n    '))
  ok('Fase 2 el 27 (llamar el 30); el 30 llama y pasa a Fase 3 (llamar el 5); el 5 llama y pasa a «No responde» (llamar el 4 de enero); y 2.ª vuelta ese día', r.resumen === '2026-10-27 fase_2 (llamar 2026-10-30) | 2026-10-30 fase_3 (llamar 2026-11-05) | 2026-11-05 sin_respuesta (llamar 2027-01-04) | 2027-01-04 otra_vuelta', r.resumen)
  ok('acaba en «Sin contactar» de la vuelta 2, sin fase, con la fecha de la llamada de ese día', r.l.ciclo_vuelta === 2 && r.l.ciclo_fase === null && r.l.next_call_date === '2027-01-04')
  ok('y deja una nota por cada cambio', r.notas.length === 4 && r.notas.every((n) => n.startsWith('Ciclo comercial · ')))
}

console.log('\n=== el comercial se retrasa: la lista se acumula y se limpia llamando ===')
{
  // Llama a la Fase 2 el martes 3 de noviembre (no el viernes 30) y a la Fase 3 el lunes 9 (no el jueves 5)
  const r = recorrido((dia, fase) => (fase === 'f2' && dia === '2026-11-03') || (fase === 'f3' && dia === '2026-11-09'))
  console.log('    ' + r.resumen.split(' | ').join('\n    '))
  ok('se queda en Fase 2 del 30 al 3 (atrasado, sin saltar de fase), pasa a Fase 3 el 3, y a «No responde» el 9 cuando se llama', r.resumen.startsWith('2026-10-27 fase_2 (llamar 2026-10-30) | 2026-11-03 fase_3 (llamar 2026-11-05) | 2026-11-09 sin_respuesta (llamar 2027-01-08)'), r.resumen)
}

console.log('\n=== el comercial NO llama nunca: la secuencia se cierra y no se queda atrasado para siempre ===')
{
  const r = recorrido(() => false, '2027-01-20')
  console.log('    ' + r.resumen.split(' | ').join('\n    '))
  ok('se queda en Fase 2 hasta que el motor cierra la secuencia (16 de noviembre); entonces pasa a «No responde» (llamar el 15 de enero) y vuelve ese día', r.resumen === '2026-10-27 fase_2 (llamar 2026-10-30) | 2026-11-16 sin_respuesta (llamar 2027-01-15) | 2027-01-15 otra_vuelta', r.resumen)
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
