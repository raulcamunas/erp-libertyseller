import { casarNota, horasEntre, mismoNombre, palabrasDelNombre, type CandidatoDeCita } from './casar'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const c = (clientId: string, o: Partial<CandidatoDeCita> = {}): CandidatoDeCita => ({
  clientId,
  appointmentId: `cita-${clientId}`,
  googleEventId: null,
  email: null,
  nombre: null,
  inicio: null,
  ...o,
})
const nota = (o: { googleEventId?: string | null; invitados?: string[]; titulo?: string; fechaReunion?: string | null } = {}) => ({
  googleEventId: null,
  invitados: [] as string[],
  titulo: 'Consultoría Estratégica Amazon · Liberty Seller · LAURA GOMEZ (Socia única)',
  fechaReunion: '2026-10-20T08:02:00.000Z' as string | null,
  ...o,
})

console.log('\n=== los nombres ===')
{
  ok('sin tildes, sin paréntesis y sin partículas', palabrasDelNombre('María de la Cruz (Socia única)').join() === 'maria,cruz', palabrasDelNombre('María de la Cruz (Socia única)').join())
  ok('el nombre vacío no tiene palabras', palabrasDelNombre(null).length === 0 && palabrasDelNombre('  ').length === 0)
  ok('dos palabras en común bastan aunque el otro tenga más', mismoNombre('LAURA GOMEZ', 'Laura Gómez Pérez') === 'completo')
  ok('el orden da igual', mismoNombre('Mohsen Jalali', 'JALALI MOHSEN (Socio único)') === 'completo')
  ok('una palabra suelta contra un nombre largo, no', mismoNombre('Laura', 'Laura Gomez') === null)
  ok('una sola palabra igual en los dos: se reconoce como débil', mismoNombre('Laura', 'LAURA') === 'solo_una_palabra')
  ok('nombres distintos, no', mismoNombre('Laura Gomez', 'Laura Ruiz') === null && mismoNombre('Ana', null) === null)
  ok('horasEntre: 90 minutos son 1,5 horas; una fecha rota, null', horasEntre('2026-10-20T08:00:00Z', '2026-10-20T09:30:00Z') === 1.5 && horasEntre('x', '2026-10-20T09:30:00Z') === null && horasEntre(null, null) === null)
}

console.log('\n=== 1. por el evento del calendario ===')
{
  const r = casarNota(nota({ googleEventId: 'evt-2' }), [c('A', { googleEventId: 'evt-1' }), c('B', { googleEventId: 'evt-2' }), c('C', { googleEventId: null })])
  ok('el id exacto del evento manda', r.casada && r.clientId === 'B' && r.appointmentId === 'cita-B' && r.metodo === 'evento', JSON.stringify(r))
  const contraElCorreo = casarNota(nota({ googleEventId: 'evt-2', invitados: ['a@x.com'] }), [c('A', { email: 'a@x.com' }), c('B', { googleEventId: 'evt-2', email: 'otro@x.com' })])
  ok('y gana al correo si discrepan (el evento no se equivoca)', contraElCorreo.casada && contraElCorreo.clientId === 'B')
  const sinCoincidencia = casarNota(nota({ googleEventId: 'evt-9', invitados: ['a@x.com'] }), [c('A', { email: 'a@x.com', googleEventId: 'evt-1' })])
  ok('si el evento no está en la base, se sigue con el correo', sinCoincidencia.casada && sinCoincidencia.clientId === 'A' && sinCoincidencia.metodo === 'invitado')
  const nulos = casarNota(nota({ googleEventId: 'evt-2' }), [c('A', { googleEventId: null })])
  ok('un candidato sin evento nunca casa por el evento', !nulos.casada)
  const duplicado = casarNota(nota({ googleEventId: 'evt-2', invitados: ['b@x.com'] }), [c('A', { googleEventId: 'evt-2', email: 'a@x.com' }), c('B', { googleEventId: 'evt-2', email: 'b@x.com' }), c('Z', { email: 'b@x.com' })])
  ok('si el mismo evento está en dos fichas, se afina con el correo SOLO entre ellas', duplicado.casada && duplicado.clientId === 'B' && duplicado.metodo === 'invitado', JSON.stringify(duplicado))
}

console.log('\n=== 2. por el correo del invitado ===')
{
  const r = casarNota(nota({ invitados: ['Laura@Cosmetica.com'] }), [c('A', { email: 'otra@x.com' }), c('B', { email: 'laura@cosmetica.com', inicio: '2026-11-30T09:00:00Z' })])
  ok('sin mirar mayúsculas, y aunque la cita esté a semanas (el correo es una llave fuerte)', r.casada && r.clientId === 'B' && r.metodo === 'invitado', JSON.stringify(r))
  const dos = casarNota(nota({ invitados: ['laura@x.com'] }), [c('vieja', { email: 'laura@x.com', inicio: '2026-10-01T09:00:00Z' }), c('buena', { email: 'laura@x.com', inicio: '2026-10-20T08:00:00Z' }), c('futura', { email: 'laura@x.com', inicio: '2026-11-03T09:00:00Z' })])
  ok('el mismo lead con tres fichas: gana la cita más cercana a la reunión', dos.casada && dos.clientId === 'buena', JSON.stringify(dos))
  const sinFechaDeLaCita = casarNota(nota({ invitados: ['laura@x.com'] }), [c('A', { email: 'laura@x.com', inicio: '2026-10-20T08:00:00Z' }), c('B', { email: 'laura@x.com', inicio: null })])
  ok('si alguna ficha no tiene fecha para comparar, no se adivina', !sinFechaDeLaCita.casada && sinFechaDeLaCita.motivo === 'ambigua', JSON.stringify(sinFechaDeLaCita))
  const sinFechaDeLaNota = casarNota(nota({ invitados: ['laura@x.com'], fechaReunion: null }), [c('A', { email: 'laura@x.com', inicio: '2026-10-20T08:00:00Z' }), c('B', { email: 'laura@x.com', inicio: '2026-10-21T08:00:00Z' })])
  ok('sin fecha de la reunión y dos fichas con ese correo: ambigua', !sinFechaDeLaNota.casada && sinFechaDeLaNota.motivo === 'ambigua')
  const empate = casarNota(nota({ invitados: ['laura@x.com'], fechaReunion: '2026-10-20T12:00:00Z' }), [c('A', { email: 'laura@x.com', inicio: '2026-10-20T10:00:00Z' }), c('B', { email: 'laura@x.com', inicio: '2026-10-20T14:00:00Z' })])
  ok('un empate de distancia no se resuelve a ojo', !empate.casada && empate.motivo === 'ambigua')
  const manual = casarNota(nota({ invitados: ['laura@x.com'] }), [c('M', { appointmentId: null, email: 'laura@x.com' })])
  ok('una ficha dada de alta a mano (sin cita) casa con appointmentId vacío', manual.casada && manual.clientId === 'M' && manual.appointmentId === null)
  const variosInvitados = casarNota(nota({ invitados: ['socio@y.com', 'laura@x.com'] }), [c('A', { email: 'laura@x.com' })])
  ok('con varios invitados vale el que coincida', variosInvitados.casada && variosInvitados.clientId === 'A')
}

console.log('\n=== 3. por el nombre del título ===')
{
  const base = { titulo: 'Consultoría Estratégica Amazon · Liberty Seller · LAURA GOMEZ (Socia única)', fechaReunion: '2026-10-20T08:02:00.000Z' }
  const r = casarNota(nota(base), [c('A', { nombre: 'Laura Gómez Pérez', inicio: '2026-10-20T07:30:00Z' })])
  ok('el nombre del lead se parece y la cita es de ese día', r.casada && r.clientId === 'A' && r.metodo === 'nombre', JSON.stringify(r))
  const lejos = casarNota(nota(base), [c('A', { nombre: 'Laura Gómez', inicio: '2026-10-25T07:30:00Z' })])
  ok('con la cita a cinco días, no', !lejos.casada && lejos.motivo === 'ninguna')
  const sinFecha = casarNota(nota({ ...base, fechaReunion: null }), [c('A', { nombre: 'Laura Gómez', inicio: '2026-10-20T07:30:00Z' })])
  ok('sin fecha de la reunión, el nombre solo no basta', !sinFecha.casada)
  const sinCita = casarNota(nota(base), [c('A', { nombre: 'Laura Gómez', inicio: null })])
  ok('una ficha sin fecha de cita no se casa por el nombre', !sinCita.casada)
  const dosPersonas = casarNota(nota(base), [c('A', { nombre: 'Laura Gómez', inicio: '2026-10-20T07:30:00Z' }), c('B', { nombre: 'Laura Gomez Ruiz', inicio: '2026-10-20T15:00:00Z' })])
  ok('dos Laura Gómez en el mismo día: gana la de la cita más cercana a la reunión', dosPersonas.casada && dosPersonas.clientId === 'A')
  const unaPalabra = { titulo: 'Consultoría Estratégica Amazon · Liberty Seller · LAURA', fechaReunion: '2026-10-20T08:02:00.000Z' }
  const mismoDia = casarNota(nota(unaPalabra), [c('A', { nombre: 'Laura', inicio: '2026-10-20T07:30:00Z' })])
  ok('un solo nombre de pila, igual en los dos y el mismo día: vale', mismoDia.casada && mismoDia.clientId === 'A')
  const diaSiguiente = casarNota(nota(unaPalabra), [c('A', { nombre: 'Laura', inicio: '2026-10-21T07:30:00Z' })])
  ok('un solo nombre de pila y a otro día: no', !diaSiguiente.casada)
  const otraPersona = casarNota(nota(base), [c('A', { nombre: 'Laura Ruiz', inicio: '2026-10-20T07:30:00Z' })])
  ok('otra persona con el mismo nombre de pila, no', !otraPersona.casada)
}

console.log('\n=== lo que no debe casar ===')
{
  ok('sin candidatos, ninguna', JSON.stringify(casarNota(nota(), [])) === JSON.stringify({ casada: false, motivo: 'ninguna' }))
  const interna = casarNota(nota({ titulo: 'Reunión Semanal | Comerciales Liberty Seller', invitados: ['equipo@libertyseller.com'] }), [c('A', { nombre: 'Laura Gómez', email: 'laura@x.com', inicio: '2026-10-20T08:00:00Z' })])
  ok('una reunión interna no casa con nadie', !interna.casada)
  ok('los candidatos sin ningún dato no casan', !casarNota(nota({ invitados: ['a@b.com'], googleEventId: 'e' }), [c('A'), c('B')]).casada)
  ok('un correo en blanco entre los invitados no casa con un candidato sin correo', !casarNota(nota({ invitados: ['  ', ''] }), [c('A', { email: null }), c('B', { email: '' })]).casada)
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
