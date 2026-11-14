import { diaDeLaSemana, queHacerHoy, semaforoCiclo, semaforoCumplimiento, semaforoMarketing, semaforoRemesas, semaforoSeo, semaforos, tonoGeneral, urgencia, type EntradaDeSalud } from './salud'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** LA SALUD DE UNA CUENTA: SEMÁFOROS Y «QUÉ HACER HOY» */

const base = (): EntradaDeSalud => ({
  hoy: '2026-11-10', // martes
  ciclo: { total: 3, hechos: 1, siguiente: 'Negativas y cosecha del motor' },
  ppc: { conectado: true, error: false, gasto: 100, ventas: 400, gastoAnt: 100, ventasAnt: 400, pendientes: 0, recuperable: 0, motorApagado: false },
  seo: { error: false, cuentas: 1, productos: 5, graves: 0, atencion: 0, sinBrandAnalytics: false, titulosCambiados: 0, propuestasPendientes: 0 },
  cumplimiento: { atencionConStock: 0, ocultos: 0, normativa: 0 },
  remesas: { acceso: true, error: false, abiertas: 0, criticas: 0, altas: 0, faltaAlertas: false, totalRemesas: 4 },
})
const con = (cambios: (e: EntradaDeSalud) => void) => {
  const e = base()
  cambios(e)
  return e
}

console.log('\n=== día de la semana ===')
ok('el lunes es 0', diaDeLaSemana('2026-11-09') === 0)
ok('el domingo es 6', diaDeLaSemana('2026-11-15') === 6)

console.log('\n=== ciclo ===')
ok('sin ciclo, gris', semaforoCiclo(con((e) => (e.ciclo = null))).tono === 'gris')
ok('un martes a medias, azul (en curso)', semaforoCiclo(base()).tono === 'azul')
ok('el jueves con dos pendientes, rojo', semaforoCiclo(con((e) => (e.hoy = '2026-11-12'))).tono === 'rojo')
ok('el jueves con uno pendiente, ámbar', semaforoCiclo(con((e) => ((e.hoy = '2026-11-12'), (e.ciclo = { total: 3, hechos: 2, siguiente: 'x' })))).tono === 'ambar')
ok('la semana hecha, verde', semaforoCiclo(con((e) => (e.ciclo = { total: 3, hechos: 3, siguiente: null }))).tono === 'verde')

console.log('\n=== marketing ===')
ok('igual que la semana anterior y sin nada pendiente, verde', semaforoMarketing(base()).tono === 'verde')
ok('sin Ads conectado, gris', semaforoMarketing(con((e) => (e.ppc.conectado = false))).tono === 'gris')
ok('si no se pudo leer, rojo', semaforoMarketing(con((e) => (e.ppc.error = true))).tono === 'rojo')
ok('gasta 50 y no vende nada, rojo', semaforoMarketing(con((e) => ((e.ppc.gasto = 50), (e.ppc.ventas = 0)))).tono === 'rojo')
const sube30 = semaforoMarketing(con((e) => (e.ppc.gasto = 130)))
ok('el ACoS sube un 30 %, ámbar con la cifra', sube30.tono === 'ambar' && sube30.texto === 'ACoS +30 %', JSON.stringify(sube30))
ok('el ACoS sube un 60 %, rojo', semaforoMarketing(con((e) => (e.ppc.gasto = 160))).tono === 'rojo')
ok('el ACoS baja, verde', semaforoMarketing(con((e) => (e.ppc.gasto = 70))).tono === 'verde')
ok('propuestas pendientes, ámbar', semaforoMarketing(con((e) => (e.ppc.pendientes = 4))).tono === 'ambar')
ok('el motor apagado, ámbar', semaforoMarketing(con((e) => (e.ppc.motorApagado = true))).tono === 'ambar')
ok('sin gasto en 14 días, gris (no se juzga)', semaforoMarketing(con((e) => ((e.ppc.gasto = 0), (e.ppc.gastoAnt = 0), (e.ppc.ventas = 0)))).tono === 'gris')

console.log('\n=== SEO ===')
ok('sin mirar (en la lista), gris', semaforoSeo(con((e) => (e.seo = null))).tono === 'gris')
ok('sin productos seguidos, gris', semaforoSeo(con((e) => e.seo && (e.seo.productos = 0))).tono === 'gris')
ok('una urgente, rojo', semaforoSeo(con((e) => e.seo && (e.seo.graves = 1))).tono === 'rojo')
ok('un título cambiado (vigía), ámbar', semaforoSeo(con((e) => e.seo && (e.seo.titulosCambiados = 1))).tono === 'ambar')
ok('limpio, verde', semaforoSeo(base()).tono === 'verde')

console.log('\n=== cumplimiento ===')
ok('sin revisar, gris', semaforoCumplimiento(con((e) => (e.cumplimiento = null))).tono === 'gris')
ok('fichas con stock bloqueadas, rojo', semaforoCumplimiento(con((e) => e.cumplimiento && (e.cumplimiento.atencionConStock = 2))).texto === '2 bloquean')
ok('solo ocultas sin stock, ámbar', semaforoCumplimiento(con((e) => e.cumplimiento && (e.cumplimiento.ocultos = 1))).tono === 'ambar')

console.log('\n=== remesas ===')
ok('sin acceso a Remesas de ese cliente, gris', semaforoRemesas(con((e) => e.remesas && (e.remesas.acceso = false))).texto === 'Sin acceso')
ok('una crítica, rojo', semaforoRemesas(con((e) => e.remesas && (e.remesas.criticas = 1))).tono === 'rojo')
ok('envíos en curso sin alertas, azul', semaforoRemesas(con((e) => e.remesas && (e.remesas.abiertas = 2))).tono === 'azul')
ok('sin ningún envío, gris', semaforoRemesas(con((e) => e.remesas && (e.remesas.totalRemesas = 0))).tono === 'gris')

console.log('\n=== la cuenta entera ===')
const todo = semaforos(base())
ok('cinco semáforos, en orden', todo.map((s) => s.area).join(',') === 'ciclo,marketing,seo,cumplimiento,remesas')
ok('sano: tono general verde', tonoGeneral(todo) === 'verde')
const mala = semaforos(con((e) => e.cumplimiento && (e.cumplimiento.atencionConStock = 1)))
ok('un rojo manda', tonoGeneral(mala) === 'rojo')
ok('un rojo pesa más que tres ámbar', urgencia(mala) > urgencia(semaforos(con((e) => ((e.ppc.pendientes = 2), e.seo && (e.seo.atencion = 1), e.cumplimiento && (e.cumplimiento.ocultos = 1))))))
ok('todo gris es gris', tonoGeneral([{ area: 'seo', tono: 'gris', texto: '' }]) === 'gris')

console.log('\n=== qué hacer hoy ===')
const hoy = queHacerHoy(
  con((e) => {
    e.ppc.pendientes = 3
    e.ppc.recuperable = 40
    if (e.cumplimiento) e.cumplimiento.atencionConStock = 2
    if (e.remesas) e.remesas.criticas = 1
  }),
)
ok('lo que bloquea la venta va primero', hoy[0]?.id === 'cumplimiento-stock' || hoy[0]?.id === 'remesas-criticas', hoy.map((x) => x.id).join(','))
ok('el ciclo va al final', hoy.at(-1)?.id === 'ciclo-siguiente', hoy.map((x) => x.id).join(','))
ok('las propuestas con dinero recuperable, prioridad 1', hoy.find((x) => x.id === 'ppc-propuestas')?.prioridad === 1)
ok('una cuenta sana solo tiene el siguiente paso del ciclo', queHacerHoy(base()).map((x) => x.id).join(',') === 'ciclo-siguiente')
ok('sin acceso a Remesas no pide mirar sus alertas', !queHacerHoy(con((e) => e.remesas && ((e.remesas.acceso = false), (e.remesas.criticas = 3)))).some((x) => x.area === 'remesas'))

console.log(fallos ? `\n${fallos} FALLAN\n` : '\nTodo bien\n')
if (fallos) process.exit(1)
