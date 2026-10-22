import {
  clavesDelLead,
  diagnosticar,
  elegirLead,
  indiceDeTelefonos,
  leadDeLaLlamada,
  mapaDeLeadsDe,
  planearVinculos,
  type LeadParaVincular,
  type LlamadaParaVincular,
} from '@/lib/cold-calling/vinculos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * CASAR LLAMADAS CON LEADS.
 *
 * Lo que se vigila: que el teléfono de Rinkel y el del lead se casen sea cual sea el formato en que lo tecleó una persona,
 * que una llamada NUNCA se enlace con el lead de otro comercial, que con varios candidatos gane siempre el mismo, y que el
 * diagnóstico cuente lo que de verdad pasa (en particular, los leads cuyo teléfono no se reconoce).
 */

const MAOLI = 'maoli'
const DANIELA = 'daniela'

let n = 0
const lead = (extra: Partial<LeadParaVincular> & { phone: string | null }): LeadParaVincular => ({
  id: `l${String(++n).padStart(3, '0')}`,
  assigned_to: MAOLI,
  telefonos_extra: null,
  status: 'pendiente',
  last_contacted_at: null,
  store_name: `Tienda ${n}`,
  ...extra,
})
const llamada = (numero: string | null, extra: Partial<LlamadaParaVincular> = {}): LlamadaParaVincular => ({
  id: `c${String(++n).padStart(3, '0')}`,
  user_id: MAOLI,
  fecha: '2026-10-21T10:00:00.000Z',
  direccion: 'outbound',
  numero,
  lead_id: null,
  ...extra,
})

console.log('\n=== el mismo teléfono, escrito como lo escribió una persona ===')
{
  const formatos = ['+34910210465', '+34 910 21 04 65', '910.21.04.65', '910 21 04 65', '910210465', '0034910210465', '(+34) 910 21 04 65']
  for (const f of formatos) {
    const l = lead({ phone: f })
    const indice = indiceDeTelefonos([l])
    ok(`«${f}» recibe la llamada de «+34910210465»`, leadDeLaLlamada('+34910210465', MAOLI, indice)?.id === l.id)
  }
  const dos = lead({ phone: '931112244 / 600112233' })
  const extra = lead({ phone: '977000111', telefonos_extra: '+34 655 44 33 22; 699 88 77 66' })
  const indice = indiceDeTelefonos([dos, extra])
  ok('un lead con dos teléfonos recibe la llamada de cualquiera de los dos', leadDeLaLlamada('+34931112244', MAOLI, indice)?.id === dos.id && leadDeLaLlamada('+34600112233', MAOLI, indice)?.id === dos.id)
  ok('y los teléfonos extra también cuentan', leadDeLaLlamada('+34655443322', MAOLI, indice)?.id === extra.id && leadDeLaLlamada('+34699887766', MAOLI, indice)?.id === extra.id)
  ok('las claves de un lead no repiten ninguna', clavesDelLead({ phone: '600112233', telefonos_extra: '+34 600 11 22 33 / 931112244' }).join() === '600112233,931112244')
  const foraneo = lead({ phone: '+44 20 7946 0958' })
  ok('un número de otro país se casa con su prefijo entero', leadDeLaLlamada('+442079460958', MAOLI, indiceDeTelefonos([foraneo]))?.id === foraneo.id)
  ok('y no con otro país que acaba igual', leadDeLaLlamada('+492079460958', MAOLI, indiceDeTelefonos([foraneo])) === null)
}

console.log('\n=== lo que NO se enlaza ===')
{
  const mio = lead({ phone: '600112233' })
  const deDaniela = lead({ phone: '611223344', assigned_to: DANIELA })
  const indice = indiceDeTelefonos([mio, deDaniela])
  ok('un número oculto no se casa con nadie', leadDeLaLlamada(null, MAOLI, indice) === null && leadDeLaLlamada('', MAOLI, indice) === null)
  ok('un número que no es de ningún lead, tampoco', leadDeLaLlamada('+34999999999', MAOLI, indice) === null)
  ok('una llamada de Maoli al lead de Daniela NO se enlaza con él', leadDeLaLlamada('+34611223344', MAOLI, indice) === null)
  ok('y la de Daniela a su lead sí', leadDeLaLlamada('+34611223344', DANIELA, indice)?.id === deDaniela.id)
  ok('un lead sin teléfono no estorba', leadDeLaLlamada('+34600112233', MAOLI, indiceDeTelefonos([lead({ phone: null }), mio]))?.id === mio.id)
}

console.log('\n=== varios leads con el mismo teléfono: gana siempre el mismo ===')
{
  const cerrado = lead({ phone: '931112244', status: 'no_interesa', last_contacted_at: '2026-10-20T10:00:00.000Z' })
  const abiertoViejo = lead({ phone: '931112244', status: 'seguimiento', last_contacted_at: '2026-09-01T10:00:00.000Z' })
  const abiertoReciente = lead({ phone: '931112244', status: 'no_contesta', last_contacted_at: '2026-10-10T10:00:00.000Z' })
  const nuncaTocado = lead({ phone: '931112244', status: 'pendiente', last_contacted_at: null })
  ok('el abierto gana al descartado aunque el descartado sea más reciente', elegirLead([cerrado, abiertoViejo]).id === abiertoViejo.id)
  ok('entre dos abiertos, el tocado más recientemente', elegirLead([abiertoViejo, abiertoReciente]).id === abiertoReciente.id)
  ok('uno que nunca se tocó pierde contra uno tocado', elegirLead([nuncaTocado, abiertoViejo]).id === abiertoViejo.id)
  const a = lead({ phone: '977000111', status: 'pendiente' })
  const b = lead({ phone: '977000111', status: 'pendiente' })
  ok('a igualdad total, el de id menor, y el orden de entrada no cambia nada', elegirLead([a, b]).id === a.id && elegirLead([b, a]).id === a.id)
  const mapa = mapaDeLeadsDe(indiceDeTelefonos([cerrado, abiertoViejo, abiertoReciente, nuncaTocado]), MAOLI)
  ok('el mapa de la importación aplica la misma regla', mapa.get('931112244') === abiertoReciente.id, String(mapa.get('931112244')))
}

console.log('\n=== qué llamadas se enlazan en un repaso ===')
{
  const a = lead({ phone: '600112233' })
  const b = lead({ phone: '611223344', assigned_to: DANIELA })
  const indice = indiceDeTelefonos([a, b])
  const nueva = llamada('+34600112233')
  const yaEnlazada = llamada('+34600112233', { lead_id: 'otro-lead' })
  const oculta = llamada(null)
  const ajena = llamada('+34611223344') // Maoli llama a un lead de Daniela
  const sinDueno = llamada('+34999999999')
  const entrante = llamada('+34600112233', { direccion: 'inbound' })
  const pares = planearVinculos([nueva, yaEnlazada, oculta, ajena, sinDueno, entrante], indice)
  ok('enlaza la nueva y la entrante del mismo número', pares.length === 2 && pares.every((p) => p.lead === a.id) && pares.some((p) => p.llamada === nueva.id) && pares.some((p) => p.llamada === entrante.id))
  ok('NO toca la que ya tiene lead (aunque ese lead sea otro)', !pares.some((p) => p.llamada === yaEnlazada.id))
  ok('ni la oculta, ni la del lead de otra persona, ni la de un número desconocido', !pares.some((p) => [oculta.id, ajena.id, sinDueno.id].includes(p.llamada)))
  ok('cada par lleva la fecha de la llamada, para decidir si se cuenta', pares.every((p) => p.fecha === '2026-10-21T10:00:00.000Z'))
}

console.log('\n=== el diagnóstico ===')
{
  const buena = lead({ phone: '+34 600 11 22 33' })
  const sinTelefono = lead({ phone: null })
  const letras = lead({ phone: 'sin teléfono' })
  const raro = lead({ phone: '6001122', store_name: 'La Tienda Rara' })
  const compartidaA = lead({ phone: '931112244', store_name: 'Duplicada A' })
  const compartidaB = lead({ phone: '+34 931 11 22 44', store_name: 'Duplicada B' })
  const deDaniela = lead({ phone: '611223344', assigned_to: DANIELA })
  const leads = [buena, sinTelefono, letras, raro, compartidaA, compartidaB, deDaniela]

  const llamadas: LlamadaParaVincular[] = [
    llamada('+34600112233', { lead_id: buena.id }), // saliente ya enlazada
    llamada('+34931112244'), // saliente casable, pendiente de enlazar
    llamada('+34611223344'), // saliente de Maoli a un lead de Daniela
    llamada('+34999000111'), // saliente a un número que no es de nadie
    llamada('+34999000111'), // ...la misma otra vez
    llamada('+34888000222'), // ...otro
    llamada(null), // saliente oculta
    llamada('+34600112233', { direccion: 'inbound' }), // entrante: no cuenta como saliente
  ]
  const d = diagnosticar(llamadas, leads, (id) => (id === MAOLI ? 'Maoli' : id))

  ok('cuenta las llamadas, las salientes y las ocultas', d.llamadas.total === 8 && d.llamadas.salientes === 7 && d.llamadas.sinNumero === 1, JSON.stringify(d.llamadas))
  ok('de las salientes con número, cuántas están enlazadas', d.llamadas.salientesConNumero === 6 && d.llamadas.salientesEnlazadas === 1 && Math.abs(d.llamadas.proporcionEnlazadas - 1 / 6) < 1e-9)
  ok('una casable aparece como pendiente de enlazar', d.llamadas.pendientesDeEnlazar === 1)
  ok('la que va a un lead de otra persona se cuenta aparte', d.llamadas.aLeadDeOtro === 1)
  ok('y las que no están en ningún lead', d.llamadas.sinLead === 3)
  ok('los números sin lead salen por orden de repeticiones y con el nombre del comercial', d.numerosSinLead[0].numero === '+34999000111' && d.numerosSinLead[0].llamadas === 2 && d.numerosSinLead[0].comercial === 'Maoli' && d.numerosSinLead.length === 2)
  ok('leads: total, con teléfono y reconocidos', d.leads.total === 7 && d.leads.conTelefono === 5 && d.leads.reconocidos === 4, JSON.stringify(d.leads))
  ok('un campo de teléfono sin ninguna cifra no cuenta como teléfono', d.leads.conTelefono === 5)
  ok('el teléfono que no se reconoce se enseña con su nombre', d.leads.sinReconocer === 1 && d.sinReconocer.length === 1 && d.sinReconocer[0].nombre === 'La Tienda Rara' && d.sinReconocer[0].telefono === '6001122')
  ok('dos leads de la misma persona con el mismo teléfono son un teléfono compartido', d.leads.compartidos === 1 && d.compartidos[0].leads.includes('Duplicada A') && d.compartidos[0].leads.includes('Duplicada B') && d.compartidos[0].telefono === '+34 931112244')

  const vacio = diagnosticar([], [])
  ok('sin datos no divide por cero', vacio.llamadas.proporcionEnlazadas === 0 && vacio.llamadas.total === 0 && vacio.leads.total === 0 && vacio.numerosSinLead.length === 0)
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
