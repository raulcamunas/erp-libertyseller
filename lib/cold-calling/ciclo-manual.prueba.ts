import { esFestivo, esFinDeSemana } from '@/lib/festivos/festivos'
import { COLD_STATUSES, COLD_STATUS_LABELS } from '@/lib/types/cold-leads'
import { decidirAvance, type LeadParaElCiclo } from './ciclo-avance'
import {
  DIAS_LABORABLES_DE_FASE_2,
  DIAS_LABORABLES_DE_FASE_3,
  ESTADOS_QUE_NO_ADMITEN_FASE,
  FASE_DE_LA_CAJA,
  cambioAlPulsarFase,
  diaDeVueltaDeNoResponde,
  motivoQueBloqueaLaFase,
  rellamadaAlPulsar,
  sumarDiasLaborables,
  type LeadParaPulsarFase,
} from './ciclo-manual'
import { ESTADOS_DE_RITMO, ESTADOS_SOLO_DEL_CICLO, type EstadoSoloDelCiclo } from './ciclo'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * PULSAR «FASE 2», «FASE 3» O «NO RESPONDE»: QUÉ SE GUARDA Y CUÁNDO VUELVE A SALIR EL LEAD.
 *
 * El calendario de los ejemplos es el de verdad: el lunes 2 de noviembre de 2026 es festivo en la Comunidad de Madrid (el día siguiente a Todos los Santos) y no en Cataluña; el lunes 9 es la
 * Almudena en Madrid capital; el 1 de enero de 2027 es fiesta en toda España.
 */

const madrid = { ccaa: 'MD' as const, municipio_ine: '28079' }
const madridPueblo = { ccaa: 'MD' as const, municipio_ine: null }
const barcelona = { ccaa: 'CT' as const, municipio_ine: '08019' }
const lead = (extra: Partial<LeadParaPulsarFase> = {}): LeadParaPulsarFase => ({ status: 'no_contesta', ciclo_vuelta: 1, ciclo_fase: null, ccaa: null, municipio_ine: null, ...extra })

console.log('\n=== contar días laborables ===')
{
  ok('el lunes 2 de nov + 2 laborables es el MIÉRCOLES 4: el ejemplo de Raúl («cuando llegue ese +2 días, en este caso el miércoles»)', sumarDiasLaborables('2026-11-02', 2, null) === '2026-11-04')
  ok('un viernes salta el fin de semana: viernes 30 de oct + 2 = martes 3 de nov', sumarDiasLaborables('2026-10-30', 2, null) === '2026-11-03')
  ok('pulsar en fin de semana cuenta desde el siguiente día laborable (como si fuera viernes por la noche): sábado 31 y domingo 1 + 2 = martes 3', sumarDiasLaborables('2026-10-31', 2, null) === '2026-11-03' && sumarDiasLaborables('2026-11-01', 2, null) === '2026-11-03')
  ok('cero días es el mismo día', sumarDiasLaborables('2026-11-02', 0, null) === '2026-11-02')
  ok('el jueves 5 + 3 es el martes 10 (viernes, lunes, martes); el viernes 6 + 3, el miércoles 11', sumarDiasLaborables('2026-11-05', 3, null) === '2026-11-10' && sumarDiasLaborables('2026-11-06', 3, null) === '2026-11-11')
  ok('un lead sin ubicar solo salta los fines de semana: no se inventa ningún festivo (el lunes 2 cuenta como laborable)', sumarDiasLaborables('2026-10-30', 1, null) === '2026-11-02')
  ok('en Madrid el lunes 2 de nov es festivo: el viernes 30 + 2 pasa del martes 3 al MIÉRCOLES 4', sumarDiasLaborables('2026-10-30', 2, { ccaa: 'MD', ine: '28079' }) === '2026-11-04')
  ok('en Cataluña no: martes 3', sumarDiasLaborables('2026-10-30', 2, { ccaa: 'CT', ine: '08019' }) === '2026-11-03')
  ok('el lunes 9 de nov (la Almudena) solo es festivo en Madrid capital: el jueves 5 + 2 es el martes 10 allí y el lunes 9 en Cataluña o en un pueblo de Madrid', sumarDiasLaborables('2026-11-05', 2, { ccaa: 'MD', ine: '28079' }) === '2026-11-10' && sumarDiasLaborables('2026-11-05', 2, { ccaa: 'CT', ine: '08019' }) === '2026-11-09' && sumarDiasLaborables('2026-11-05', 2, { ccaa: 'MD', ine: null }) === '2026-11-09')
  ok('los días son 2 para Fase 2 y 3 para Fase 3', DIAS_LABORABLES_DE_FASE_2 === 2 && DIAS_LABORABLES_DE_FASE_3 === 3)
}

console.log('\n=== la rellamada de cada caja ===')
{
  ok('Fase 2: a los 2 laborables (lunes 2 → miércoles 4)', rellamadaAlPulsar('fase_2', '2026-11-02', null) === '2026-11-04')
  ok('Fase 3: a los 3 laborables (lunes 2 → jueves 5): 5 desde la primera llamada si la Fase 2 se pulsó el mismo día', rellamadaAlPulsar('fase_3', '2026-11-02', null) === '2026-11-05')
  ok('No responde: a los 60 días, en día laborable (2 de nov + 60 = viernes 1 de ene de 2027)', rellamadaAlPulsar('no_responde', '2026-11-02', null) === '2027-01-01')
  ok('y si cae en festivo para el lead, al siguiente laborable: el 1 de enero es fiesta en toda España y el lunes 4 es el primero', rellamadaAlPulsar('no_responde', '2026-11-02', { ccaa: 'MD', ine: '28079' }) === '2027-01-04')
  ok('es lo mismo que pone el avance automático al acabar el ritmo (60 días, día laborable): 5 de nov → lunes 4 de enero; 27 de oct → lunes 28 de dic', diaDeVueltaDeNoResponde('2026-11-05', null) === '2027-01-04' && diaDeVueltaDeNoResponde('2026-10-27', null) === '2026-12-28')
}

console.log('\n=== pulsar «Fase 2» ===')
{
  const c = cambioAlPulsarFase(lead(), 'fase_2', '2026-11-02', 'Maoli')
  ok('guarda la fase 2 y la rellamada a +2 laborables, y NADA más (el estado «No contesta» se queda)', c !== null && c.campos.ciclo_fase === 'f2' && c.campos.next_call_date === '2026-11-04' && Object.keys(c.campos).length === 2 && c.rellamada === '2026-11-04', JSON.stringify(c))
  ok('apunta quién lo pasó y cuándo vuelve a salir', c?.nota === 'Ciclo comercial · Maoli pasa el lead a Fase 2. Rellamada el mié 4 nov (+2 días laborables).', c?.nota)
  ok('un lead «Sin contactar» (el comercial escribió sin llamar por Rinkel) también: se queda como está', JSON.stringify(cambioAlPulsarFase(lead({ status: 'pendiente' }), 'fase_2', '2026-11-02', 'Maoli')?.campos) === JSON.stringify({ ciclo_fase: 'f2', next_call_date: '2026-11-04' }))
  const festivo = cambioAlPulsarFase(lead(madrid), 'fase_2', '2026-10-30', 'Maoli')
  ok('el festivo del lead cuenta: un lead de Madrid pulsado el viernes 30 vuelve el miércoles 4, y el de Cataluña el martes 3', festivo?.campos.next_call_date === '2026-11-04' && cambioAlPulsarFase(lead(barcelona), 'fase_2', '2026-10-30', 'Maoli')?.campos.next_call_date === '2026-11-03')
  const otra = cambioAlPulsarFase(lead({ ciclo_fase: 'f2', next_call_date: '2026-11-04' }), 'fase_2', '2026-11-04', 'Maoli')
  ok('volver a pulsar Fase 2 es válido y reinicia la cuenta: el miércoles 4 + 2 = el viernes 6', otra?.campos.ciclo_fase === 'f2' && otra.campos.next_call_date === '2026-11-06')
  ok('sin nombre, el apunte dice «Un comercial»', cambioAlPulsarFase(lead(), 'fase_2', '2026-11-02', '  ')?.nota.startsWith('Ciclo comercial · Un comercial pasa el lead a Fase 2.') === true)
}

console.log('\n=== pulsar «Fase 3» ===')
{
  const c = cambioAlPulsarFase(lead({ ciclo_fase: 'f2', next_call_date: '2026-11-04' }), 'fase_3', '2026-11-04', 'Daniela')
  ok('el día de la rellamada de Fase 2 (miércoles 4) pasa a Fase 3 con la rellamada a +3 laborables: el lunes 9', c?.campos.ciclo_fase === 'f3' && c.campos.next_call_date === '2026-11-09' && Object.keys(c.campos).length === 2, JSON.stringify(c))
  ok('con su apunte', c?.nota === 'Ciclo comercial · Daniela pasa el lead a Fase 3. Rellamada el lun 9 nov (+3 días laborables).', c?.nota)
  ok('el lunes 9 es la Almudena en Madrid capital: allí, el martes 10', cambioAlPulsarFase(lead({ ...madrid, ciclo_fase: 'f2' }), 'fase_3', '2026-11-04', 'Daniela')?.campos.next_call_date === '2026-11-10')
  ok('la Fase 3 se puede pulsar desde la Fase 1 (si la persona se salta una)', cambioAlPulsarFase(lead(), 'fase_3', '2026-11-02', 'Daniela')?.campos.ciclo_fase === 'f3')
}

console.log('\n=== pulsar «No responde» ===')
{
  const c = cambioAlPulsarFase(lead({ ciclo_fase: 'f3', next_call_date: '2026-11-09' }), 'no_responde', '2026-11-09', 'Alejandro')
  ok('guarda «No responde» y la rellamada a los 60 días, en día laborable (9 de nov + 60 = 8 de enero de 2027)', c?.campos.ciclo_fase === 'sin_respuesta' && c.campos.next_call_date === '2027-01-08' && !('status' in c.campos), JSON.stringify(c))
  ok('con su apunte', c?.nota === 'Ciclo comercial · Alejandro pasa el lead a «No responde». Se vuelve a llamar el vie 8 ene, a los dos meses.', c?.nota)
  ok('un lead «Sin contactar» pasa a «No contesta»: es lo que de verdad es (igual que cuando lo hacía el avance automático)', cambioAlPulsarFase(lead({ status: 'pendiente', ciclo_fase: 'f3' }), 'no_responde', '2026-11-09', 'Alejandro')?.campos.status === 'no_contesta')
  ok('uno que ya estaba «No contesta» no cambia de estado', !('status' in (cambioAlPulsarFase(lead({ status: 'no_contesta' }), 'no_responde', '2026-11-09', 'Alejandro')?.campos ?? {})))
}

console.log('\n=== un lead que estaba fuera del ritmo vuelve a él al pulsar una fase ===')
{
  let malas = ''
  for (const estado of ['seguimiento', 'programado', 'email_enviado'] as const) {
    for (const caja of ESTADOS_SOLO_DEL_CICLO) {
      const c = cambioAlPulsarFase(lead({ status: estado }), caja, '2026-11-02', 'Maoli')
      if (!(c?.campos.status === 'no_contesta' && c.nota.endsWith(`Estaba en «${COLD_STATUS_LABELS[estado]}»: vuelve al ritmo como «No contesta».`))) malas += ` ${estado}/${caja}`
    }
  }
  ok('con «En seguimiento», «Rellamada programada» o «Info enviada», cualquiera de las tres cajas deja al lead en «No contesta» y el apunte dice en qué estado estaba', malas === '', malas)
  ok('«En seguimiento» + Fase 2: «No contesta», rellamada a +2, y el apunte lo explica', (() => {
    const c = cambioAlPulsarFase(lead({ status: 'seguimiento' }), 'fase_2', '2026-11-02', 'Maoli')
    return c?.campos.status === 'no_contesta' && c.campos.next_call_date === '2026-11-04' && c.nota === 'Ciclo comercial · Maoli pasa el lead a Fase 2. Rellamada el mié 4 nov (+2 días laborables). Estaba en «En seguimiento»: vuelve al ritmo como «No contesta».'
  })())
  ok('un lead del ritmo (Sin contactar o No contesta) no cambia de estado al pasar a Fase 2 ni a Fase 3', ESTADOS_DE_RITMO.every((e) => !('status' in (cambioAlPulsarFase(lead({ status: e }), 'fase_2', '2026-11-02', 'Maoli')?.campos ?? { status: 1 })) && !('status' in (cambioAlPulsarFase(lead({ status: e }), 'fase_3', '2026-11-02', 'Maoli')?.campos ?? { status: 1 }))))
}

console.log('\n=== lo que NO se puede pasar de fase ===')
{
  ok('un lead con una cita agendada o descartado no se pasa de fase, en ninguna de las tres cajas', (['cita_cualificada', 'no_interesa'] as const).every((e) => ESTADOS_SOLO_DEL_CICLO.every((caja) => cambioAlPulsarFase(lead({ status: e }), caja, '2026-11-02', 'Maoli') === null)))
  ok('y la ficha dice por qué', motivoQueBloqueaLaFase(lead({ status: 'cita_cualificada' })) === 'Este lead ya tiene una cita agendada: no se pasa de fase.' && motivoQueBloqueaLaFase(lead({ status: 'no_interesa' })) === 'Este lead está marcado «No le interesa»: no se pasa de fase.')
  ok('con cualquier otro estado, no hay motivo que lo impida', COLD_STATUSES.filter((s) => !ESTADOS_QUE_NO_ADMITEN_FASE.includes(s)).every((s) => motivoQueBloqueaLaFase(lead({ status: s })) === null))
  ok('un lead que NO es de una lista de ciclo no tiene fases: no se le pasa y no hay motivo que enseñar', ESTADOS_SOLO_DEL_CICLO.every((caja) => cambioAlPulsarFase(lead({ ciclo_vuelta: null }), caja, '2026-11-02', 'Maoli') === null && cambioAlPulsarFase({ status: 'no_contesta' }, caja, '2026-11-02', 'Maoli') === null) && motivoQueBloqueaLaFase({ status: 'cita_cualificada', ciclo_vuelta: null }) === null)
  ok('si «hoy» no es un día de verdad (la pantalla todavía no sabe en qué calendario está), no se hace nada: mejor que inventar una fecha', ['', 'hoy', '2026-13-45', '02/11/2026'].every((hoy) => cambioAlPulsarFase(lead(), 'fase_2', hoy, 'Maoli') === null))
  ok('cada caja guarda su fase: Fase 2 → f2, Fase 3 → f3, No responde → sin_respuesta', FASE_DE_LA_CAJA.fase_2 === 'f2' && FASE_DE_LA_CAJA.fase_3 === 'f3' && FASE_DE_LA_CAJA.no_responde === 'sin_respuesta')
}

console.log('\n=== lo que se guarda es estable: el proceso automático no lo deshace ===')
{
  // Se aplica el cambio al lead y se pasa por el proceso en modo a mano: no debe decidir nada (salvo la vuelta de «No responde» cuando le llegue su día)
  const aplicar = (l: LeadParaPulsarFase, caja: EstadoSoloDelCiclo, hoy: string): LeadParaElCiclo => ({ ...l, ...cambioAlPulsarFase(l, caja, hoy, 'Maoli')!.campos }) as LeadParaElCiclo
  const MANUAL = { avanceAutomatico: false }
  let inestable = ''
  for (const estado of COLD_STATUSES.filter((s) => !ESTADOS_QUE_NO_ADMITEN_FASE.includes(s))) {
    for (const caja of ['fase_2', 'fase_3'] as const) {
      const l = aplicar(lead({ status: estado }), caja, '2026-11-02')
      for (const dia of ['2026-11-02', '2026-11-03', '2026-11-05', '2026-12-01', '2027-03-01']) if (decidirAvance(l, null, dia, MANUAL) !== null) inestable += ` ${estado}/${caja}/${dia}`
    }
  }
  ok('un lead que se acaba de pasar a Fase 2 o a Fase 3, sea cual fuera su estado, no lo toca el proceso en ningún día posterior', inestable === '', inestable)
  const parado = aplicar(lead({ ciclo_fase: 'f3' }), 'no_responde', '2026-11-09')
  ok('uno que se acaba de pasar a «No responde» tampoco, hasta su día (8 de enero) y ese día vuelve a Fase 1', decidirAvance(parado, null, '2026-11-09', MANUAL) === null && decidirAvance(parado, null, '2027-01-07', MANUAL) === null && decidirAvance(parado, null, '2027-01-08', MANUAL)?.motivo === 'otra_vuelta')
}

console.log('\n=== todos los días del año, en cuatro sitios ===')
{
  const sitios: Array<[string, LeadParaPulsarFase]> = [['sin ubicar', lead()], ['Madrid capital', lead(madrid)], ['Madrid pueblo', lead(madridPueblo)], ['Cataluña', lead(barcelona)]]
  let mal = ''
  let probados = 0
  for (const [nombre, l] of sitios) {
    for (let d = new Date(Date.UTC(2026, 9, 26)); d.getTime() <= Date.UTC(2027, 9, 26); d = new Date(d.getTime() + 86_400_000)) {
      const hoy = d.toISOString().slice(0, 10)
      for (const [caja, n] of [['fase_2', 2], ['fase_3', 3]] as const) {
        const c = cambioAlPulsarFase(l, caja, hoy, 'Maoli')
        probados++
        if (!c) {
          mal += ` ${nombre}/${hoy}/${caja}: null`
          continue
        }
        const lugar = l.ccaa ? { ccaa: l.ccaa as 'MD' | 'CT', ine: l.municipio_ine ?? null } : null
        const rell = c.campos.next_call_date
        // La rellamada es un día laborable, posterior a hoy, y entre hoy (sin contar) y ella hay exactamente n laborables
        let laborables = 0
        for (let x = new Date(Date.parse(`${hoy}T00:00:00Z`) + 86_400_000); x.toISOString().slice(0, 10) <= rell; x = new Date(x.getTime() + 86_400_000)) {
          const dia = x.toISOString().slice(0, 10)
          if (!esFinDeSemana(dia) && !esFestivo(dia, lugar)) laborables++
        }
        if (!(rell > hoy && !esFinDeSemana(rell) && !esFestivo(rell, lugar) && laborables === n)) mal += ` ${nombre}/${hoy}/${caja}->${rell}(${laborables})`
      }
      const v = cambioAlPulsarFase(l, 'no_responde', hoy, 'Maoli')
      probados++
      const lugar2 = l.ccaa ? { ccaa: l.ccaa as 'MD' | 'CT', ine: l.municipio_ine ?? null } : null
      if (!v || !(v.campos.next_call_date >= new Date(Date.parse(`${hoy}T00:00:00Z`) + 60 * 86_400_000).toISOString().slice(0, 10) && !esFinDeSemana(v.campos.next_call_date) && !esFestivo(v.campos.next_call_date, lugar2))) mal += ` ${nombre}/${hoy}/no_responde->${v?.campos.next_call_date}`
    }
  }
  ok(`en ${probados} combinaciones (365 días × 4 sitios × 3 cajas): Fase 2 y Fase 3 caen siempre en día laborable posterior, con exactamente 2 o 3 laborables en medio, y «No responde» al menos a los 60 días y en día laborable`, mal === '', mal.slice(0, 400))
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
