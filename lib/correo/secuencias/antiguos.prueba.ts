import type { AlmacenDeSecuencias } from '@/lib/correo/secuencias/almacen'
import { CORTE_DE_LAS_AUTOMATIZACIONES, CORTE_EN_MS, MENSAJE_LEAD_ANTIGUO, MENSAJE_SIN_LECTURA, esLeadAntiguo, leadAdmiteAutomatizacion } from '@/lib/correo/secuencias/antiguos'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** Un almacén de mentira que solo sabe lo que pregunta la regla. Una lectura puede ser un valor o un fallo, y apunta qué se le ha preguntado */
function almacenDeMentira(o: { ciclo: boolean | Error; antes?: boolean | Error }) {
  const preguntado: string[] = []
  const cortes: number[] = []
  const almacen: Pick<AlmacenDeSecuencias, 'leadEstaEnElCiclo' | 'leadTuvoContactoAntesDe'> = {
    async leadEstaEnElCiclo() {
      preguntado.push('ciclo')
      if (o.ciclo instanceof Error) throw o.ciclo
      return o.ciclo
    },
    async leadTuvoContactoAntesDe(_leadId, antesDe) {
      preguntado.push('historial')
      cortes.push(antesDe)
      const v = o.antes ?? false
      if (v instanceof Error) throw v
      return v
    },
  }
  return { almacen, preguntado, cortes }
}

async function main() {
  console.log('\n=== la regla: antiguo es quien se trabajó antes del corte y no está en el ciclo ===')
  ok('trabajado antes y fuera del ciclo: ANTIGUO', esLeadAntiguo({ enCiclo: false, contactoAnterior: true }))
  ok('sin nada anterior: no es antiguo (es nuevo)', !esLeadAntiguo({ enCiclo: false, contactoAnterior: false }))
  ok('en el ciclo con actividad anterior: no es antiguo (el ciclo gana)', !esLeadAntiguo({ enCiclo: true, contactoAnterior: true }))
  ok('en el ciclo y sin nada anterior: no es antiguo', !esLeadAntiguo({ enCiclo: true, contactoAnterior: false }))

  console.log('\n=== el corte es el del SQL del 30 oct 2026 ===')
  ok('24 oct 2026 a las 00:00 UTC', CORTE_DE_LAS_AUTOMATIZACIONES === '2026-10-24T00:00:00Z' && CORTE_EN_MS === Date.UTC(2026, 9, 24, 0, 0, 0))

  console.log('\n=== lo que se pregunta a la base y lo que se contesta ===')
  {
    const a = almacenDeMentira({ ciclo: false, antes: true })
    const v = await leadAdmiteAutomatizacion(a.almacen, 'lead-1')
    ok('un lead fuera del ciclo con contacto anterior no admite: antiguo', !v.admite && v.porque === 'antiguo')
    ok('se le pregunta por el ciclo y por el historial, con el corte de siempre', a.preguntado.join() === 'ciclo,historial' && a.cortes[0] === CORTE_EN_MS)
  }
  {
    const a = almacenDeMentira({ ciclo: false, antes: false })
    ok('un lead nuevo (nada antes del corte) admite', (await leadAdmiteAutomatizacion(a.almacen, 'lead-2')).admite)
  }
  {
    const a = almacenDeMentira({ ciclo: true, antes: true })
    const v = await leadAdmiteAutomatizacion(a.almacen, 'lead-3')
    ok('un lead del ciclo admite aunque tenga actividad anterior', v.admite)
    ok('y ni se mira su historial', a.preguntado.join() === 'ciclo')
  }

  console.log('\n=== si no se puede comprobar, no se programa (y nada revienta) ===')
  {
    const registro: unknown[][] = []
    const original = console.error
    console.error = (...args: unknown[]) => void registro.push(args)
    try {
      const falloCiclo = await leadAdmiteAutomatizacion(almacenDeMentira({ ciclo: new Error('La base no contesta', { cause: { code: '57014' } }) }).almacen, 'lead-4')
      ok('si falla la lectura del ciclo: no admite, por «sin_lectura»', !falloCiclo.admite && falloCiclo.porque === 'sin_lectura')
      const falloHistorial = await leadAdmiteAutomatizacion(almacenDeMentira({ ciclo: false, antes: new Error('La base no contesta') }).almacen, 'lead-5')
      ok('si falla la lectura del historial: igual', !falloHistorial.admite && falloHistorial.porque === 'sin_lectura')
    } finally {
      console.error = original
    }
    ok('cada fallo deja una línea en el registro', registro.length === 2)
    ok('con el código de la base y sin datos del lead', JSON.stringify(registro[0]).includes('57014') && !JSON.stringify(registro).includes('lead-'))
  }

  console.log('\n=== las frases ===')
  ok('la del antiguo y la de «no se ha podido comprobar» son distintas y no hablan de errores del envío', new Set([MENSAJE_LEAD_ANTIGUO, MENSAJE_SIN_LECTURA]).size === 2 && !/error|fallo/i.test(MENSAJE_LEAD_ANTIGUO))

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
