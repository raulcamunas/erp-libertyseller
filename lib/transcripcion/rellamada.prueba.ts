import { decidirRellamadaDeLlamada, type DecisionDeRellamada, type EntradaDeRellamada, type LeadParaRellamada } from '@/lib/transcripcion/rellamada'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * «LLÁMAME EL JUEVES», DECIDIDO: qué pasa en la ficha del lead cuando un cliente lo pide en una llamada.
 * Hoy de las pruebas: lunes 26 de octubre de 2026 (el jueves es el 29, el viernes el 30, el sábado el 31).
 */

const TRANSCRIPCION = 'Buenas tardes, soy Maoli de Liberty Seller. Sí, mira, ahora estoy con el cierre de mes. Llámame el jueves a las diez y lo vemos con calma, ¿vale? Perfecto, hasta el jueves.'
const LLAMADA = '2026-10-26T09:30:00Z' // lunes 10:30 en Madrid
const HOY = '2026-10-26'

const lead = (extra: Partial<LeadParaRellamada> = {}): LeadParaRellamada => ({ status: 'pendiente', assignedTo: 'maoli', nextCallDate: null, ...extra })
const entrada = (extra: Omit<Partial<EntradaDeRellamada>, 'peticion'> & { peticion?: Partial<EntradaDeRellamada['peticion']> } = {}): EntradaDeRellamada => {
  const { peticion, ...resto } = extra
  return {
    peticion: { fecha: '2026-10-29', hora: '10:00', frase: 'llámame el jueves a las diez', ...peticion },
    transcripcion: TRANSCRIPCION,
    fechaDeLaLlamada: LLAMADA,
    hoy: HOY,
    festivos: [],
    lead: lead(),
    comercialId: 'maoli',
    ...resto,
  }
}
const pone = (d: DecisionDeRellamada): d is Extract<DecisionDeRellamada, { poner: true }> => d.poner
const noPone = (d: DecisionDeRellamada, motivo: string): boolean => !d.poner && d.motivo === motivo

function main() {
  console.log('\n=== lo normal: lo pidió y se pone ===')
  {
    const d = decidirRellamadaDeLlamada(entrada())
    ok('se pone el jueves 29', pone(d) && d.fecha === '2026-10-29' && !d.soloFecha, JSON.stringify(d))
    ok('y la nota cuenta qué día, con qué palabras, a qué hora y que lo hizo el ERP solo', pone(d) && /jue 29 oct/.test(d.nota) && /llámame el jueves a las diez/.test(d.nota) && /a las 10:00/.test(d.nota) && /vie 23 oct|lun 26 oct/.test(d.nota) && /solo/.test(d.nota), pone(d) ? d.nota : '')
    ok('sin hora, la nota no inventa ninguna', (() => { const x = decidirRellamadaDeLlamada(entrada({ peticion: { hora: null } })); return pone(x) && !/a las 10:00/.test(x.nota) })())
    ok('un lead sin comercial asignado también se programa', pone(decidirRellamadaDeLlamada(entrada({ lead: lead({ assignedTo: null }) }))))
  }

  console.log('\n=== no se pisa a nadie ===')
  {
    const otra = decidirRellamadaDeLlamada(entrada({ lead: lead({ assignedTo: 'jose' }) }))
    ok('un lead de otra persona no se toca, y se deja nota', noPone(otra, 'otra_persona') && !otra.poner && /otra persona/.test(otra.nota ?? ''), JSON.stringify(otra))
    for (const status of ['cita_cualificada', 'no_interesa']) {
      const d = decidirRellamadaDeLlamada(entrada({ lead: lead({ status }) }))
      ok(`en «${status}» no se toca, y se deja nota`, noPone(d, 'estado') && !d.poner && (d.nota ?? '').length > 20, JSON.stringify(d))
    }
    for (const status of ['pendiente', 'no_contesta', 'programado', 'email_enviado']) {
      ok(`en «${status}» sí se programa entera`, (() => { const d = decidirRellamadaDeLlamada(entrada({ lead: lead({ status }) })); return pone(d) && !d.soloFecha })())
    }
    const seg = decidirRellamadaDeLlamada(entrada({ lead: lead({ status: 'seguimiento' }) }))
    ok('«En seguimiento» solo recibe la fecha: el estado es de quien lo lleva', pone(seg) && seg.soloFecha && /solo se ha puesto la fecha/.test(seg.nota), pone(seg) ? seg.nota : '')

    const futura = decidirRellamadaDeLlamada(entrada({ lead: lead({ status: 'programado', nextCallDate: '2026-11-05' }) }))
    ok('si ya tenía otra rellamada para más adelante (la habrá puesto el comercial al colgar), gana ella', noPone(futura, 'ya_tiene') && !futura.poner && /5 nov/.test(futura.nota ?? ''), JSON.stringify(futura))
    ok('si ya estaba puesta ese mismo día, no hay nada que hacer ni que contar', (() => { const d = decidirRellamadaDeLlamada(entrada({ lead: lead({ status: 'programado', nextCallDate: '2026-10-29' }) })); return noPone(d, 'ya_estaba') && !d.poner && d.nota === null })())
    ok('el mismo día pero en otro estado sí se pone (hay que pasarlo a programado)', pone(decidirRellamadaDeLlamada(entrada({ lead: lead({ status: 'pendiente', nextCallDate: '2026-10-29' }) }))))
    ok('una rellamada vieja o de hoy es la que se acaba de hacer: se pisa', pone(decidirRellamadaDeLlamada(entrada({ lead: lead({ status: 'programado', nextCallDate: '2026-10-20' }) }))) && pone(decidirRellamadaDeLlamada(entrada({ lead: lead({ status: 'programado', nextCallDate: '2026-10-26' }) }))))
    ok('el lead ya no existe: nada', noPone(decidirRellamadaDeLlamada(entrada({ lead: null })), 'sin_lead'))
  }

  console.log('\n=== lo que la IA dice se comprueba ===')
  {
    const inventada = decidirRellamadaDeLlamada(entrada({ peticion: { frase: 'llámame el viernes por la tarde' } }))
    ok('si sus palabras no están en la llamada, no se programa nada ni se deja nota', noPone(inventada, 'frase_no_esta') && !inventada.poner && inventada.nota === null)
    const sinCuando = decidirRellamadaDeLlamada(entrada({ peticion: { frase: 'Perfecto. Gracias.' }, transcripcion: `${TRANSCRIPCION} Perfecto. Gracias.` }))
    ok('unas palabras que sí están en la llamada pero no dicen cuándo («perfecto, gracias») no apoyan ninguna fecha: nada y sin nota', noPone(sinCuando, 'frase_sin_fecha') && !sinCuando.poner && sinCuando.nota === null, JSON.stringify(sinCuando))
    ok('las palabras valen aunque cambien tildes, mayúsculas o signos', pone(decidirRellamadaDeLlamada(entrada({ peticion: { frase: 'LLAMAME el jueves, a las diez' } }))))

    ok('un día anterior a la llamada no vale', noPone(decidirRellamadaDeLlamada(entrada({ peticion: { fecha: '2026-10-25', frase: 'llámame el jueves a las diez' } })), 'fecha_no_valida'))
    ok('un día a más de 400 días tampoco', noPone(decidirRellamadaDeLlamada(entrada({ peticion: { fecha: '2028-01-13', frase: 'llámame el jueves a las diez' } })), 'fecha_no_valida'))
    ok('ni algo que no es un día', noPone(decidirRellamadaDeLlamada(entrada({ peticion: { fecha: '2026-02-31' } })), 'fecha_no_valida') && noPone(decidirRellamadaDeLlamada(entrada({ fechaDeLaLlamada: 'ayer' })), 'fecha_no_valida'))

    const malDia = decidirRellamadaDeLlamada(entrada({ peticion: { fecha: '2026-10-30' } }))
    ok('dijo «el jueves» y la fecha cae en viernes: no se programa a ciegas, se deja nota para que lo mire una persona', noPone(malDia, 'dia_no_cuadra') && !malDia.poner && /No se ha puesto ninguna rellamada/.test(malDia.nota ?? ''), JSON.stringify(malDia))
    ok('si no nombró un día de la semana, no hay nada que comprobar', pone(decidirRellamadaDeLlamada(entrada({ peticion: { fecha: '2026-10-30', frase: 'llámame mañana' } , transcripcion: 'Perfecto, llámame mañana por favor.' }))))
  }

  console.log('\n=== siempre un día hábil, y nunca uno que ya pasó ===')
  {
    const sab = decidirRellamadaDeLlamada(entrada({ peticion: { fecha: '2026-10-31', frase: 'llámame el sábado' }, transcripcion: 'Vale, llámame el sábado si puedes.' }))
    ok('un sábado pasa al lunes', pone(sab) && sab.fecha === '2026-11-02', JSON.stringify(sab))
    const fiesta = decidirRellamadaDeLlamada(entrada({ peticion: { fecha: '2026-12-08', frase: 'el 8 de diciembre' }, transcripcion: 'Pues el 8 de diciembre, que es fiesta.', festivos: ['2026-12-08'] }))
    ok('un festivo pasa al día hábil siguiente', pone(fiesta) && fiesta.fecha === '2026-12-09', JSON.stringify(fiesta))
    const tarde = decidirRellamadaDeLlamada(entrada({ fechaDeLaLlamada: '2026-10-16T10:00:00Z', peticion: { fecha: '2026-10-19', frase: 'llámame el lunes' }, transcripcion: 'Vale, llámame el lunes.' }))
    ok('si se transcribe tarde y el día ya pasó, se pone hoy', pone(tarde) && tarde.fecha === HOY, JSON.stringify(tarde))
    const reyes = decidirRellamadaDeLlamada(entrada({ peticion: { fecha: '2027-01-07', hora: null, frase: 'llámame después de Reyes' }, transcripcion: 'Ahora no, llámame después de Reyes, por favor.' }))
    ok('«después de Reyes» (7 de enero de 2027) se pone y la nota dice el año', pone(reyes) && reyes.fecha === '2027-01-07' && /jue 7 ene 2027/.test(reyes.nota), pone(reyes) ? reyes.nota : '')
    ok('un festivo de por medio (6 de enero) no mueve el 7', pone(decidirRellamadaDeLlamada(entrada({ peticion: { fecha: '2027-01-07', hora: null, frase: 'llámame después de Reyes' }, transcripcion: 'Ahora no, llámame después de Reyes, por favor.', festivos: ['2027-01-06'] }))))
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main()
