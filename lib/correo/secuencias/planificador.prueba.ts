import { diaDeMadrid, instanteDeMadrid, partesDeMadrid } from '@/lib/correo/secuencias/fechas'
import { HUECO_POR_EMPRESA_MS, planificar, type EntradaDelPlanificador, type HorarioDelBuzon, type Ocupacion, type PasoPorPlanificar } from '@/lib/correo/secuencias/planificador'
import { AJUSTES_POR_DEFECTO } from '@/lib/correo/secuencias/reglas'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const BUZONES = ['b1', 'b2', 'b3', 'b4', 'b5']
const fuera: HorarioDelBuzon = { llamadasDesdeMin: 1000, llamadasHastaMin: 1001 }
const llamadas: HorarioDelBuzon = { llamadasDesdeMin: 600, llamadasHastaMin: 840 }
const mapaDeBuzones = (h: HorarioDelBuzon) => new Map(BUZONES.map((b) => [b, h]))

// Viernes 23 de octubre de 2026, 8:00 en Madrid: antes de abrir la ventana
const AHORA = instanteDeMadrid('2026-10-23', 480)

function pasos(n: number, opciones: { desde?: string; dominio?: (i: number) => string; buzon?: (i: number) => string } = {}): PasoPorPlanificar[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `paso-${String(i).padStart(4, '0')}`,
    buzonId: (opciones.buzon ?? ((k) => BUZONES[k % BUZONES.length]))(i),
    desde: opciones.desde ?? '2026-10-26',
    dominio: (opciones.dominio ?? ((k) => `empresa${k}.es`))(i),
  }))
}

function entrada(p: Partial<EntradaDelPlanificador> & { pasos: readonly PasoPorPlanificar[] }): EntradaDelPlanificador {
  return {
    buzones: mapaDeBuzones(fuera),
    ocupados: [],
    capacidad: () => 100,
    ahora: AHORA,
    ajustes: { ...AJUSTES_POR_DEFECTO, festivos: [] },
    semilla: 7,
    ...p,
  }
}

const minDiferencia = (instantes: number[]): number => {
  const o = [...instantes].sort((a, b) => a - b)
  let m = Number.POSITIVE_INFINITY
  for (let i = 1; i < o.length; i++) m = Math.min(m, o[i] - o[i - 1])
  return m
}

function porBuzon(resultado: { asignaciones: Array<{ pasoId: string; programadoAt: number; dia: string }> }, lista: readonly PasoPorPlanificar[]): Map<string, number[]> {
  const buzonDe = new Map(lista.map((p) => [p.id, p.buzonId]))
  const m = new Map<string, number[]>()
  for (const a of resultado.asignaciones) {
    const b = buzonDe.get(a.pasoId)!
    m.set(b, [...(m.get(b) ?? []), a.programadoAt])
  }
  return m
}

console.log('\n=== un día entero con los cinco buzones ===')
{
  const lista = pasos(300)
  const r = planificar(entrada({ pasos: lista }))
  ok('todos tienen hora', r.asignaciones.length === 300 && r.sinHueco.length === 0)
  const todos = r.asignaciones.map((a) => a.programadoAt)
  ok('todos caen el lunes 26 (el primer día que podían)', r.asignaciones.every((a) => a.dia === '2026-10-26' && diaDeMadrid(a.programadoAt) === '2026-10-26'))
  // El 26 de octubre ya es hora de invierno: las 9:00 de Madrid son las 8:00 UTC
  ok('todos entre las 9:00 y las 18:00 de Madrid', todos.every((t) => t >= instanteDeMadrid('2026-10-26', 540) && t < instanteDeMadrid('2026-10-26', 1080)))
  ok('nunca dos envíos del sistema a menos de 45 segundos', minDiferencia(todos) >= 45_000, String(minDiferencia(todos)))
  const buzones = porBuzon(r, lista)
  ok('ni dos del mismo buzón a menos de 3 minutos', [...buzones.values()].every((l) => minDiferencia(l) >= 180_000))
  ok('60 por buzón', [...buzones.values()].every((l) => l.length === 60))
  ok('con minutos y segundos al azar, no a las horas en punto', new Set(todos.map((t) => partesDeMadrid(t).segundo)).size > 20 && new Set(todos.map((t) => partesDeMadrid(t).minuto)).size > 40)
}

console.log('\n=== la capacidad de cada día ===')
{
  const lista = pasos(25, { buzon: () => 'b1' })
  const r = planificar(entrada({ pasos: lista, capacidad: () => 10 }))
  const porDia = new Map<string, number>()
  for (const a of r.asignaciones) porDia.set(a.dia, (porDia.get(a.dia) ?? 0) + 1)
  ok('10 el lunes, 10 el martes y 5 el miércoles', porDia.get('2026-10-26') === 10 && porDia.get('2026-10-27') === 10 && porDia.get('2026-10-28') === 5, JSON.stringify([...porDia]))
  const r2 = planificar(entrada({ pasos: pasos(3, { buzon: () => 'b1' }), capacidad: (b, d) => (d === '2026-10-26' ? 0 : 5) }))
  ok('un día con capacidad 0 se salta entero', r2.asignaciones.every((a) => a.dia === '2026-10-27'))
  const r3 = planificar(entrada({ pasos: pasos(3), capacidad: () => 0 }))
  ok('sin capacidad en ningún día, nadie tiene hora (y se dice cuáles)', r3.asignaciones.length === 0 && r3.sinHueco.length === 3)
  const r4 = planificar(entrada({ pasos: pasos(2), capacidad: () => 0, horizonteDias: 3 }))
  ok('el horizonte acota la búsqueda', r4.sinHueco.length === 2)
}

console.log('\n=== fines de semana y festivos ===')
{
  const sabado = planificar(entrada({ pasos: pasos(5, { desde: '2026-10-24' }) }))
  ok('lo que podía salir un sábado sale el lunes', sabado.asignaciones.every((a) => a.dia === '2026-10-26'))
  const festivo = planificar(entrada({ pasos: pasos(5, { desde: '2026-10-26' }), ajustes: { ...AJUSTES_POR_DEFECTO, festivos: ['2026-10-26'] } }))
  ok('con el lunes festivo, sale el martes', festivo.asignaciones.every((a) => a.dia === '2026-10-27'))
  const pasado = planificar(entrada({ pasos: pasos(5, { desde: '2026-10-01' }) }))
  ok('un día pasado se trata como hoy (viernes 23, antes de abrir la ventana: sale hoy a partir de las 9:00)', pasado.asignaciones.every((a) => a.dia === '2026-10-23' && a.programadoAt >= instanteDeMadrid('2026-10-23', 540)))
}

console.log('\n=== el día de hoy, a medias ===')
{
  const mediodia = instanteDeMadrid('2026-10-26', 870) // lunes 14:30
  const r = planificar(entrada({ pasos: pasos(20, { desde: '2026-10-26' }), ahora: mediodia }))
  ok('lo de hoy sale más tarde de ahora (con margen) y antes de las 18:00', r.asignaciones.filter((a) => a.dia === '2026-10-26').every((a) => a.programadoAt >= mediodia + 90_000 && a.programadoAt < instanteDeMadrid('2026-10-26', 1080)))
  ok('y se aprovecha el resto del día', r.asignaciones.filter((a) => a.dia === '2026-10-26').length === 20)
  const casiCerrado = planificar(entrada({ pasos: pasos(5, { desde: '2026-10-26' }), ahora: instanteDeMadrid('2026-10-26', 1079) }))
  ok('a las 17:59 ya no queda día: todo al siguiente hábil', casiCerrado.asignaciones.length === 5 && casiCerrado.asignaciones.every((a) => a.dia === '2026-10-27'))
  const sabadoAhora = planificar(entrada({ pasos: pasos(3, { desde: '2026-10-24' }), ahora: instanteDeMadrid('2026-10-24', 700) }))
  ok('si «ahora» es sábado, el lunes', sabadoAhora.asignaciones.every((a) => a.dia === '2026-10-26'))
}

console.log('\n=== el reparto entre la mañana y la tarde ===')
{
  const antesDeLas14 = (instante: number) => partesDeMadrid(instante).minutos < 840
  const lista = pasos(300, { buzon: (i) => BUZONES[i % 5] })
  const sinLlamadas = planificar(entrada({ pasos: lista, capacidad: () => 20, semilla: 3 }))
  const parteSin = sinLlamadas.asignaciones.filter((a) => antesDeLas14(a.programadoAt)).length / sinLlamadas.asignaciones.length
  ok('con un 60 % de peso a la mañana, cae casi un 60 % antes de las 14:00', Math.abs(parteSin - 0.6) < 0.07, parteSin.toFixed(3))
  const conLlamadas = planificar(entrada({ pasos: lista, capacidad: () => 20, semilla: 3, buzones: mapaDeBuzones(llamadas) }))
  const parteCon = conLlamadas.asignaciones.filter((a) => antesDeLas14(a.programadoAt)).length / conLlamadas.asignaciones.length
  ok('si el dueño llama de 10 a 14, hay menos envíos automáticos justo entonces (~50 %)', parteCon < parteSin - 0.04 && Math.abs(parteCon - 0.5) < 0.07, `${parteCon.toFixed(3)} frente a ${parteSin.toFixed(3)}`)
  const enLlamadas = conLlamadas.asignaciones.filter((a) => {
    const m = partesDeMadrid(a.programadoAt).minutos
    return m >= 600 && m < 840
  }).length
  const enLlamadasSin = sinLlamadas.asignaciones.filter((a) => {
    const m = partesDeMadrid(a.programadoAt).minutos
    return m >= 600 && m < 840
  }).length
  ok('en concreto, dentro de 10 a 14 salen menos que sin esa preferencia', enLlamadas < enLlamadasSin * 0.85, `${enLlamadas} frente a ${enLlamadasSin}`)
  const soloMañana = planificar(entrada({ pasos: pasos(60), ajustes: { ...AJUSTES_POR_DEFECTO, festivos: [], pesoMananaPct: 100 }, capacidad: () => 20 }))
  ok('con peso 100 a la mañana, todo antes de las 14:00', soloMañana.asignaciones.every((a) => antesDeLas14(a.programadoAt)))
}

console.log('\n=== la misma empresa ===')
{
  const mismaEmpresa = planificar(entrada({ pasos: pasos(8, { dominio: () => 'tienda.es' }) }))
  ok('dos correos a la misma empresa, aunque vayan de buzones distintos, a 30 minutos o más', mismaEmpresa.asignaciones.length === 8 && minDiferencia(mismaEmpresa.asignaciones.map((a) => a.programadoAt)) >= HUECO_POR_EMPRESA_MS)
  const libres = planificar(entrada({ pasos: pasos(40, { dominio: () => 'gmail.com' }) }))
  ok('con un proveedor libre (gmail) no se aplica: no dice nada de la empresa', minDiferencia(libres.asignaciones.map((a) => a.programadoAt)) < HUECO_POR_EMPRESA_MS)
  const sinDominio = planificar(entrada({ pasos: pasos(40, { dominio: () => '' }) }))
  ok('y tampoco sin dominio', sinDominio.asignaciones.length === 40)
}

console.log('\n=== lo que ya estaba ocupado no se pisa ===')
{
  const lunes9 = instanteDeMadrid('2026-10-26', 540)
  // Un bloque de envíos cada minuto durante las dos primeras horas del lunes en b1
  const ocupados: Ocupacion[] = Array.from({ length: 120 }, (_, i) => ({ en: lunes9 + i * 60_000, buzonId: 'b1', dominio: `x${i}.es` }))
  const lista = pasos(20, { buzon: () => 'b1' })
  const r = planificar(entrada({ pasos: lista, ocupados }))
  const todos = [...r.asignaciones.map((a) => a.programadoAt), ...ocupados.map((o) => o.en)]
  ok('nada a menos de 45 s de nada, ni de lo ya ocupado', minDiferencia(todos) >= 45_000, String(minDiferencia(todos)))
  const delBuzon = [...r.asignaciones.map((a) => a.programadoAt), ...ocupados.map((o) => o.en)]
  ok('ni a menos de 3 minutos de otro de su buzón', minDiferencia(delBuzon) >= 60_000 && r.asignaciones.every((a) => ocupados.every((o) => Math.abs(o.en - a.programadoAt) >= 180_000)))
}

console.log('\n=== repetible ===')
{
  const lista = pasos(120)
  const a = planificar(entrada({ pasos: lista, semilla: 11 }))
  const b = planificar(entrada({ pasos: [...lista].reverse(), semilla: 11 }))
  ok('el mismo encargo da el mismo reparto, llegue en el orden que llegue', JSON.stringify(a.asignaciones.map((x) => [x.pasoId, x.programadoAt]).sort()) === JSON.stringify(b.asignaciones.map((x) => [x.pasoId, x.programadoAt]).sort()))
  const c = planificar(entrada({ pasos: lista, semilla: 12 }))
  ok('otra semilla, otro reparto', JSON.stringify(a.asignaciones) !== JSON.stringify(c.asignaciones))
  // Lo ya programado entra como ocupado: planificar de nuevo solo lo nuevo no mueve nada de lo anterior y respeta los huecos
  const nuevos = pasos(20).map((p, i) => ({ ...p, id: `nuevo-${i}` }))
  const ocupadas: Ocupacion[] = a.asignaciones.map((x) => ({ en: x.programadoAt, buzonId: lista.find((p) => p.id === x.pasoId)!.buzonId, dominio: '' }))
  const d = planificar(entrada({ pasos: nuevos, ocupados: ocupadas, semilla: 11 }))
  ok('lo nuevo respeta lo ya programado', minDiferencia([...a.asignaciones.map((x) => x.programadoAt), ...d.asignaciones.map((x) => x.programadoAt)]) >= 45_000)
}

console.log('\n=== apretado: el día casi lleno ===')
{
  const lista = pasos(700)
  const r = planificar(entrada({ pasos: lista, capacidad: () => 150, semilla: 5 }))
  ok('los 700 tienen hora', r.asignaciones.length === 700 && r.sinHueco.length === 0)
  const todos = r.asignaciones.map((a) => a.programadoAt)
  ok('y siguen sin salir dos a menos de 45 s', minDiferencia(todos) >= 45_000, String(minDiferencia(todos)))
  const buzones = porBuzon(r, lista)
  ok('ni dos de un buzón a menos de 3 min', [...buzones.values()].every((l) => minDiferencia(l) >= 180_000))
  const porDia = new Map<string, number>()
  for (const a of r.asignaciones) porDia.set(a.dia, (porDia.get(a.dia) ?? 0) + 1)
  ok('el lunes no pasa de lo que cabe (720 huecos de 45 s en 9 horas) y el resto va al martes', (porDia.get('2026-10-26') ?? 0) <= 720 && (porDia.get('2026-10-27') ?? 0) > 0, JSON.stringify([...porDia]))
  const ventanaCorta = planificar(entrada({ pasos: pasos(20), ajustes: { ...AJUSTES_POR_DEFECTO, festivos: [], ventanaDesdeMin: 540, ventanaHastaMin: 545 }, capacidad: () => 100 }))
  const dias = new Set(ventanaCorta.asignaciones.map((a) => a.dia))
  ok('con una ventana de 5 minutos caben 6 o 7 por día y lo demás pasa de día', ventanaCorta.asignaciones.length === 20 && dias.size >= 3, [...dias].join(','))
}

console.log('\n=== nada se programa en los últimos minutos de la ventana ===')
{
  // Un día muy cargado: se llena hasta el final de la ventana. El motor pasa una vez por minuto, así que lo programado a las 17:59 se perdería
  const lista = pasos(400, { desde: '2026-10-26', buzon: (i) => BUZONES[i % 5] })
  const r = planificar(entrada({ pasos: lista, ajustes: { ...AJUSTES_POR_DEFECTO, festivos: [], huecoGlobalS: 10, huecoBuzonS: 30 } }))
  const lunes = r.asignaciones.filter((a) => a.dia === '2026-10-26').map((a) => partesDeMadrid(a.programadoAt).minutos)
  ok('hay mucho ese día', lunes.length > 200, String(lunes.length))
  ok('pero ninguno más tarde de las 17:56 (la ventana acaba a las 18:00)', Math.max(...lunes) < 1076, String(Math.max(...lunes)))
  const hoy = instanteDeMadrid('2026-10-26', 1075)
  const tarde = planificar(entrada({ pasos: pasos(2, { desde: '2026-10-26' }), ahora: hoy }))
  ok('si ya es casi la hora de cerrar, hoy no se programa nada y se pasa al día siguiente', tarde.asignaciones.every((a) => a.dia === '2026-10-27'), JSON.stringify(tarde.asignaciones.map((a) => a.dia)))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
