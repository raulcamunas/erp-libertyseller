import { LIMITES_DE_LOS_COMERCIALES, LIMITES_DEL_LABORATORIO, LIMITE_POR_DIA, LIMITE_POR_HORA, pedirPermiso, type Peticiones } from '@/lib/whatsapp/ia-limite'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const HORA = 3_600_000
const AHORA = Date.UTC(2026, 9, 25, 10, 0)

console.log('\n=== el tope por hora ===')
{
  const p: Peticiones = new Map()
  let t = AHORA
  let rechazada = 0
  for (let i = 0; i < LIMITE_POR_HORA; i++) {
    if (!pedirPermiso('ana', (t += 1000), p).permitido) rechazada++
  }
  ok('hasta el tope se le deja', rechazada === 0)
  const r = pedirPermiso('ana', (t += 1000), p)
  ok('la siguiente, no, y se le dice por qué', !r.permitido && /última hora/.test(r.permitido ? '' : r.motivo), JSON.stringify(r))
  ok('lo rechazado no se apunta: sigue en el tope, no más allá', (p.get('ana') ?? []).length === LIMITE_POR_HORA)
  ok('otra persona no se ve afectada', pedirPermiso('luis', t, p).permitido)
  ok('pasada una hora, vuelve a poder', pedirPermiso('ana', t + HORA + 1000, p).permitido)
}

console.log('\n=== el tope por día ===')
{
  const p: Peticiones = new Map()
  // 60 cada hora durante 5 horas son 300: a la sexta hora (con la primera ya fuera de la hora pero dentro del día) se llega al tope diario
  let permitidas = 0
  let ultimo: ReturnType<typeof pedirPermiso> = { permitido: true }
  for (let h = 0; h < 6; h++) {
    for (let i = 0; i < LIMITE_POR_HORA; i++) {
      ultimo = pedirPermiso('ana', AHORA + h * HORA + i * 1000, p)
      if (ultimo.permitido) permitidas++
    }
  }
  ok('se le dejan exactamente los del día', permitidas === LIMITE_POR_DIA, String(permitidas))
  ok('el que pasa del día lo dice con otras palabras', !ultimo.permitido && /de hoy/.test(ultimo.permitido ? '' : ultimo.motivo), JSON.stringify(ultimo))
  ok('pasadas 24 horas del primero, vuelve a poder', pedirPermiso('ana', AHORA + 24 * HORA + 10_000, p).permitido)
}

console.log('\n=== un lote entero o nada ===')
{
  const p: Peticiones = new Map()
  const limites = { porHora: 10, porDia: 25 }
  ok('un lote de seis cabe', pedirPermiso('ana', AHORA, p, limites, 6).permitido && (p.get('ana') ?? []).length === 6)
  const r = pedirPermiso('ana', AHORA + 1000, p, limites, 6)
  ok('otro de seis ya no cabe en la hora, y no entra ni a medias', !r.permitido && (p.get('ana') ?? []).length === 6, JSON.stringify(r))
  ok('uno de cuatro sí, y llena la hora', pedirPermiso('ana', AHORA + 2000, p, limites, 4).permitido && !pedirPermiso('ana', AHORA + 3000, p, limites, 1).permitido)
  ok('al pasar la hora, otro lote', pedirPermiso('ana', AHORA + HORA + 5000, p, limites, 10).permitido)
  const dia = pedirPermiso('ana', AHORA + HORA * 2 + 10_000, p, limites, 10)
  ok('el tope del día cuenta los lotes: con 20 hechos, uno de diez ya no cabe en las 25 del día', !dia.permitido && /de hoy/.test(dia.permitido ? '' : dia.motivo), JSON.stringify(dia))
  ok('pero uno de cinco sí, y con eso el día está lleno', pedirPermiso('ana', AHORA + HORA * 2 + 20_000, p, limites, 5).permitido && !pedirPermiso('ana', AHORA + HORA * 4, p, limites, 1).permitido)
  ok('el laboratorio tiene más hueco que un comercial y lleva su propia cuenta', LIMITES_DEL_LABORATORIO.porHora > LIMITES_DE_LOS_COMERCIALES.porHora && LIMITES_DEL_LABORATORIO.porDia > LIMITES_DE_LOS_COMERCIALES.porDia)
  ok('un lote de diez casos cabe en una hora normal del laboratorio, muchas veces', Array.from({ length: 20 }, (_, i) => pedirPermiso('luis', AHORA + i * 1000, new Map(), LIMITES_DEL_LABORATORIO, 10).permitido).every(Boolean))
}

console.log('\n=== la memoria no crece sin fin ===')
{
  const p: Peticiones = new Map()
  for (let i = 0; i < 250; i++) pedirPermiso(`persona-${i}`, AHORA, p)
  ok('con muchas personas antiguas, al pedir de nuevo un día después se limpia el mapa', (() => {
    pedirPermiso('nueva', AHORA + 25 * HORA, p)
    return p.size < 50
  })(), String(p.size))
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
