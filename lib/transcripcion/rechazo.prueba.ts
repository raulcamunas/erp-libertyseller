import { decidirCierreDeLlamada, fraseRechaza, type EntradaDeRechazo } from '@/lib/transcripcion/rechazo'
import type { LeadParaRellamada } from '@/lib/transcripcion/rellamada'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * «NO ME INTERESA» EN UNA LLAMADA: CUÁNDO SE CIERRA EL LEAD Y CUÁNDO SOLO SE AVISA.
 *
 * La llamada es del viernes 23 de octubre de 2026 (14:00Z = 16:00 en Madrid) y se procesa el lunes 26.
 */
const TRANSCRIPCION =
  'Hola, buenas tardes, soy Maoli de Liberty Seller. ¿Hablo con la tienda? Sí, dime. Te llamo por Amazon. Pues mira, no necesitamos el servicio ni queremos asumir un coste adicional, así que no nos interesa. Vale, gracias. Adiós.'
const FRASE = 'no necesitamos el servicio ni queremos asumir un coste adicional'

const lead = (extra: Partial<LeadParaRellamada> = {}): LeadParaRellamada => ({ status: 'pendiente', assignedTo: 'maoli', nextCallDate: null, ...extra })
const entrada = (extra: Partial<EntradaDeRechazo> = {}): EntradaDeRechazo => ({
  resumen: { tipo: 'conversacion', interes: 'ninguno', rellamada: null, rechazo: { frase: FRASE } },
  transcripcion: TRANSCRIPCION,
  fechaDeLaLlamada: '2026-10-23T14:00:00Z',
  hoy: '2026-10-26',
  lead: lead(),
  comercialId: 'maoli',
  ...extra,
})
const resumen = (extra: Partial<EntradaDeRechazo['resumen']>): EntradaDeRechazo['resumen'] => ({ tipo: 'conversacion', interes: 'ninguno', rellamada: null, rechazo: { frase: FRASE }, ...extra })

console.log('\n=== el caso de siempre: dice que no y nadie lleva el lead ===')
{
  const d = decidirCierreDeLlamada(entrada())
  ok('se cierra', d.cerrar === true, JSON.stringify(d))
  ok('la nota dice qué día fue, qué dijo y que es automático y se puede deshacer', d.cerrar && /llamada del vie 23 oct/.test(d.nota) && d.nota.includes(`«${FRASE}»`) && /automáticamente/.test(d.nota) && /cámbialo/.test(d.nota), d.cerrar ? d.nota : '')
  for (const status of ['pendiente', 'no_contesta', 'email_enviado']) {
    ok(`un lead en «${status}» se cierra`, decidirCierreDeLlamada(entrada({ lead: lead({ status }) })).cerrar === true)
  }
  ok('un lead sin asignar se cierra', decidirCierreDeLlamada(entrada({ lead: lead({ assignedTo: null }) })).cerrar === true)
  ok('una llamada recibida también (lo que cuenta es lo que dijo el cliente)', decidirCierreDeLlamada(entrada()).cerrar === true)
}

console.log('\n=== lo que tiene que decir la IA ===')
{
  const sin = (extra: Partial<EntradaDeRechazo['resumen']>) => decidirCierreDeLlamada(entrada({ resumen: resumen(extra) }))
  for (const interes of ['alto', 'medio', 'bajo', 'no_claro'] as const) {
    const d = sin({ interes })
    ok(`con interés «${interes}» no se toca nada, ni nota`, !d.cerrar && d.motivo === 'sin_rechazo' && d.nota === null)
  }
  ok('un buzón de voz no cierra nada', (() => { const d = sin({ tipo: 'buzon_de_voz' }); return !d.cerrar && d.motivo === 'sin_rechazo' })())
  ok('si pidió que le llamen otro día, manda la rellamada: ni cierra ni avisa', (() => { const d = sin({ rellamada: { fecha: '2026-10-29', hora: null, frase: 'llámame el jueves' } }); return !d.cerrar && d.motivo === 'pidio_rellamada' && d.nota === null })())
  ok('el lead ya no existe: nada', (() => { const d = decidirCierreDeLlamada(entrada({ lead: null })); return !d.cerrar && d.motivo === 'sin_lead' && d.nota === null })())
  ok('el lead ya estaba en «No le interesa»: nada que hacer, ni nota', (() => { const d = decidirCierreDeLlamada(entrada({ lead: lead({ status: 'no_interesa' }) })); return !d.cerrar && d.motivo === 'ya_cerrado' && d.nota === null })())
}

console.log('\n=== sus palabras: tienen que estar en la llamada y decir que no ===')
{
  const d1 = decidirCierreDeLlamada(entrada({ resumen: resumen({ rechazo: { frase: 'no estamos interesados en absoluto, hasta luego' } }) }))
  ok('unas palabras que no están en la llamada no cierran nada, pero dejan una nota (no se calla)', !d1.cerrar && d1.motivo === 'frase_no_esta' && /no se ha podido comprobar/.test(d1.nota ?? '') && /Mira la transcripción/.test(d1.nota ?? ''), JSON.stringify(d1))
  const d2 = decidirCierreDeLlamada(entrada({ resumen: resumen({ rechazo: null }) }))
  ok('«sin interés» sin ninguna palabra tampoco cierra, y también lo dice en una nota', !d2.cerrar && d2.motivo === 'frase_no_esta' && !!d2.nota, JSON.stringify(d2))
  const d3 = decidirCierreDeLlamada(entrada({ transcripcion: `${TRANSCRIPCION} Perfecto, gracias.`, resumen: resumen({ rechazo: { frase: 'Perfecto, gracias.' } }) }))
  ok('unas palabras que sí están pero no dicen que no («perfecto, gracias») no cierran: nota', !d3.cerrar && d3.motivo === 'frase_no_rechaza' && /no dicen que no con claridad/.test(d3.nota ?? ''), JSON.stringify(d3))
  ok('con tildes, mayúsculas y signos distintos sí vale', decidirCierreDeLlamada(entrada({ resumen: resumen({ rechazo: { frase: 'NO NECESITAMOS EL SERVICIO, ni queremos asumir un coste adicional' } }) })).cerrar === true)
  ok('si la IA se salta una muletilla al copiar, sigue valiendo (misma tolerancia que la rellamada)', decidirCierreDeLlamada(entrada({ transcripcion: TRANSCRIPCION.replace('no necesitamos', 'no, eh, necesitamos'), resumen: resumen({ rechazo: { frase: 'no necesitamos el servicio ni queremos asumir un coste adicional' } }) })).cerrar === true)
  ok('una frase de una sola palabra no vale', !decidirCierreDeLlamada(entrada({ resumen: resumen({ rechazo: { frase: 'no' } }) })).cerrar)

  // fraseRechaza: las frases de rechazo de siempre (las de los correos) o, al menos, una negación
  for (const f of ['no nos interesa', 'No necesitamos nada de eso', 'no, gracias', 'ya tenemos una agencia que lleva Amazon', 'no me llaméis más', 'nunca lo hemos necesitado', 'tampoco queremos']) {
    ok(`«${f}» dice que no`, fraseRechaza(f))
  }
  for (const f of ['perfecto, gracias', 'vale, vale', 'sí, dime', 'hablamos el jueves', 'me parece muy bien']) {
    ok(`«${f}» NO dice que no`, !fraseRechaza(f))
  }
  ok('«nota» o «nómina» no cuentan como un «no» (es la palabra entera)', !fraseRechaza('vi la nota de la nómina'))
}

console.log('\n=== a quién no se le pisa el trabajo ===')
{
  const d1 = decidirCierreDeLlamada(entrada({ lead: lead({ status: 'seguimiento' }) }))
  ok('un lead «En seguimiento» lo lleva una persona: no se cambia, y se avisa', !d1.cerrar && d1.motivo === 'estado' && /«En seguimiento»/.test(d1.nota ?? '') && /no se ha cambiado/.test(d1.nota ?? '') && (d1.nota ?? '').includes(`«${FRASE}»`), JSON.stringify(d1))
  const d2 = decidirCierreDeLlamada(entrada({ lead: lead({ status: 'cita_cualificada' }) }))
  ok('uno con cita, igual', !d2.cerrar && d2.motivo === 'estado' && /«Cita cualificada»/.test(d2.nota ?? ''))
  const d3 = decidirCierreDeLlamada(entrada({ lead: lead({ assignedTo: 'jhanna' }) }))
  ok('el lead de otra persona que quien llamó: no se toca, y se avisa', !d3.cerrar && d3.motivo === 'otra_persona' && /de otra persona/.test(d3.nota ?? ''))

  // «Rellamada programada»: depende de si su día ya llegó
  const d4 = decidirCierreDeLlamada(entrada({ lead: lead({ status: 'programado', nextCallDate: '2026-11-02' }) }))
  ok('«Rellamada programada» con el día por llegar: la puso una persona pensando en esta llamada. No se cierra y se avisa', !d4.cerrar && d4.motivo === 'tiene_rellamada' && /rellamada puesta para el/.test(d4.nota ?? '') && /2 nov/.test(d4.nota ?? ''), JSON.stringify(d4))
  ok('«Rellamada programada» con el día de hoy (la rellamada que se acaba de hacer) sí se cierra', decidirCierreDeLlamada(entrada({ lead: lead({ status: 'programado', nextCallDate: '2026-10-26' }) })).cerrar === true)
  ok('con un día ya pasado, también', decidirCierreDeLlamada(entrada({ lead: lead({ status: 'programado', nextCallDate: '2026-10-20' }) })).cerrar === true)
  ok('sin día, también', decidirCierreDeLlamada(entrada({ lead: lead({ status: 'programado', nextCallDate: null }) })).cerrar === true)

  // El caso de la captura: «Sin contactar» con un día de rellamada suelto (se pulsó «+1 sem» pero no se cambió el estado)
  const d5 = decidirCierreDeLlamada(entrada({ lead: lead({ status: 'pendiente', nextCallDate: '2026-11-02' }) }))
  ok('«Sin contactar» con un día suelto SÍ se cierra (el estado lo decide nadie)', d5.cerrar === true, JSON.stringify(d5))
  ok('y la nota dice que el día se queda guardado y vuelve si se reabre (cerrar no borra nada)', d5.cerrar && /Tenía puesto el día lun 2 nov/.test(d5.nota) && /sigue guardado/.test(d5.nota) && /reabres/.test(d5.nota), d5.cerrar ? d5.nota : '')
  ok('sin día suelto, la nota no habla de ninguno', (() => { const d = decidirCierreDeLlamada(entrada()); return d.cerrar && !/guardado/.test(d.nota) })())
}

console.log('\n=== otros detalles ===')
{
  const d = decidirCierreDeLlamada(entrada({ fechaDeLaLlamada: 'no es una fecha' }))
  ok('una fecha de llamada rota no tira nada: la nota habla de «esa llamada»', d.cerrar && /esa llamada/.test(d.nota), JSON.stringify(d))
  ok('lo que se apunta recorta unas palabras larguísimas', (() => { const largo = 'no nos interesa '.repeat(40); const x = decidirCierreDeLlamada(entrada({ transcripcion: largo, resumen: resumen({ rechazo: { frase: largo.trim() } }) })); return x.cerrar && x.nota.length < 600 })())
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
