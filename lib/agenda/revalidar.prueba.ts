import { releerSemanas, type LeerRango } from './revalidar'
import { fusionarRangos } from './memoria'
import { limitesDeSemanas, lunesDeLaClave } from './semanas'
import type { AppointmentWithPeople } from '@/lib/types/appointments'
import type { ResultadoDeCitas } from './consulta'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const lunes = (clave: string) => lunesDeLaClave(clave)!
const cita = (id: string, dia: number, status = 'scheduled'): AppointmentWithPeople =>
  ({ id, lead_name: id, start_time: new Date(Date.UTC(2026, 9, 26 + dia, 9, 0)).toISOString(), end_time: new Date(Date.UTC(2026, 9, 26 + dia, 10, 0)).toISOString(), status, is_external: false }) as unknown as AppointmentWithPeople
const bien = (citas: AppointmentWithPeople[]): ResultadoDeCitas => ({ citas, error: null })
const mal: ResultadoDeCitas = { citas: [], error: { code: '08006', message: 'sin red' } }

/** Una base que contesta lo que se le diga y apunta qué rangos le pidieron */
function base(contesta: (desde: string, hasta: string) => ResultadoDeCitas | Promise<ResultadoDeCitas>) {
  const pedidos: Array<[string, string]> = []
  const leer: LeerRango = async (desde, hasta) => {
    pedidos.push([desde, hasta])
    return contesta(desde, hasta)
  }
  return { leer, pedidos }
}

async function main() {
  console.log('\n=== qué se pide a la base ===')
  {
    const b = base(() => bien([]))
    const r = await releerSemanas({ lunes: [lunes('2026-10-19'), lunes('2026-10-26'), lunes('2026-11-02')], leer: b.leer, version: () => 0 })
    const esperado = { desde: limitesDeSemanas(lunes('2026-10-19')).desde, hasta: limitesDeSemanas(lunes('2026-11-02')).hasta }
    ok('tres semanas seguidas son UNA consulta', b.pedidos.length === 1)
    ok('que va del lunes de la primera al lunes siguiente a la última', b.pedidos[0][0] === esperado.desde && b.pedidos[0][1] === esperado.hasta)
    ok('y dice qué semanas cubre, para anotarlas como confirmadas', r.tipo === 'leido' && r.semanas.join() === '2026-10-19,2026-10-26,2026-11-02', JSON.stringify(r))
  }
  {
    const b = base(() => bien([]))
    await releerSemanas({ lunes: [lunes('2026-10-19'), lunes('2026-11-02')], leer: b.leer, version: () => 0 })
    ok('dos semanas con un hueco en medio son dos consultas', b.pedidos.length === 2)
  }
  {
    const b = base(() => bien([]))
    const r = await releerSemanas({ lunes: [], leer: b.leer, version: () => 0 })
    ok('sin semanas que releer no pregunta nada', r.tipo === 'nada' && b.pedidos.length === 0)
  }

  console.log('\n=== lo que devuelve ===')
  {
    const b = base((desde) => bien(desde === limitesDeSemanas(lunes('2026-10-19')).desde ? [cita('a', -7)] : [cita('b', 14)]))
    const r = await releerSemanas({ lunes: [lunes('2026-10-19'), lunes('2026-11-09')], leer: b.leer, version: () => 0 })
    ok('junta las citas de todos los tramos', r.tipo === 'leido' && r.citas.map((c) => c.id).sort().join() === 'a,b')
    ok('con un rango por tramo', r.tipo === 'leido' && r.rangos.length === 2)
  }

  console.log('\n=== si la base falla ===')
  {
    const b = base(() => mal)
    const r = await releerSemanas({ lunes: [lunes('2026-10-26')], leer: b.leer, version: () => 0 })
    ok('es un error y no trae citas', r.tipo === 'error')
  }
  {
    const b = base((desde) => (desde === limitesDeSemanas(lunes('2026-10-19')).desde ? bien([cita('a', -7)]) : mal))
    const r = await releerSemanas({ lunes: [lunes('2026-10-19'), lunes('2026-11-09')], leer: b.leer, version: () => 0 })
    ok('si un tramo falla no devuelve media lectura', r.tipo === 'error')
  }
  {
    const leer: LeerRango = async () => {
      throw new Error('Failed to fetch')
    }
    const r = await releerSemanas({ lunes: [lunes('2026-10-26')], leer, version: () => 0 })
    ok('y si la red tira una excepción, también es un error y no revienta a quien llama', r.tipo === 'error')
  }

  console.log('\n=== la trampa: un cambio mientras se leía ===')
  {
    let version = 0
    const b = base(async () => {
      version += 1 // alguien guarda una cita mientras la base contesta
      return bien([cita('a', 0, 'scheduled')])
    })
    const r = await releerSemanas({ lunes: [lunes('2026-10-26')], leer: b.leer, version: () => version })
    ok('si la memoria cambió mientras se leía, esa lectura se descarta', r.tipo === 'cambio-en-medio')
  }
  {
    let version = 0
    const b = base(() => bien([cita('a', 0)]))
    const r = await releerSemanas({ lunes: [lunes('2026-10-26')], leer: b.leer, version: () => version })
    ok('y si no cambió nada, vale', r.tipo === 'leido')
    version += 1
    const r2 = await releerSemanas({ lunes: [lunes('2026-10-26')], leer: b.leer, version: () => version })
    ok('(un cambio ANTES de empezar no cuenta: la versión se anota al empezar)', r2.tipo === 'leido')
  }

  console.log('\n=== la historia entera: una pestaña que se quedó atrás ===')
  {
    // Lo que tenía la pestaña dormida: a (Ana), b (a las 10:00 del martes) y c (del jueves)
    const memoria = new Map([cita('a', 0), cita('b', 1), cita('c', 3)].map((x) => [x.id, x]))
    // Mientras dormía, en la otra pestaña: se canceló la a, se borró la c y se agendó la d
    const enLaBase = [cita('a', 0, 'cancelled'), cita('b', 1), cita('d', 2)]
    const b = base(() => bien(enLaBase))
    const r = await releerSemanas({ lunes: [lunes('2026-10-26')], leer: b.leer, version: () => 0 })
    ok('se lee', r.tipo === 'leido')
    if (r.tipo === 'leido') {
      const despues = fusionarRangos(memoria, r.rangos, r.citas)
      ok('y la pestaña acaba mostrando lo mismo que la otra: a cancelada, b igual, c fuera y d nueva', [...despues.keys()].sort().join() === 'a,b,d' && (despues.get('a') as unknown as { status: string }).status === 'cancelled')
      ok('la que no cambió conserva su objeto', despues.get('b') === memoria.get('b'))
    }
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}
void main()
