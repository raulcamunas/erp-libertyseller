import {
  UMBRAL_LENTO_MS,
  UMBRAL_MUY_LENTO_MS,
  VENTANA_DE_MUESTRAS_MS,
  anotarMuestra,
  decidirPorPresion,
  estadoDeLaPresion,
  nivelDePresion,
  otraPesadaEnMarcha,
  vaciarMuestras,
  type Muestra,
  type NivelDePresion,
  type PrioridadDeTarea,
} from './presion'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * LA PRESIÓN DE LA BASE DE DATOS Y QUÉ SE APLAZA.
 *
 * Lo que se vigila: que un bache suelto no cambie nada, que una base que de verdad va mal pare el trabajo de fondo pesado antes de ahogarla más, que lo esencial NUNCA se aplace, que
 * un proceso aplazado no se quede sin correr para siempre y que, al recuperarse la base, todo vuelva solo.
 */

const AHORA = 1_000_000_000_000
const m = (haceMs: number, ms: number, fallo = false): Muestra => ({ at: AHORA - haceMs, ms, fallo })
const buenas = (n: number): Muestra[] => Array.from({ length: n }, (_, i) => m(i * 10_000, 300))

console.log('\n=== el nivel de presión ===')
{
  ok('sin muestras (el contenedor acaba de arrancar) es normal: ante la duda, todo corre', nivelDePresion([], AHORA) === 'normal')
  ok('con consultas de décimas de segundo es normal', nivelDePresion(buenas(15), AHORA) === 'normal')
  ok('un bache suelto de una consulta NO cambia nada', nivelDePresion([...buenas(12), m(5_000, 4_000)], AHORA) === 'normal')
  ok('dos baches tampoco', nivelDePresion([...buenas(12), m(5_000, 4_000), m(15_000, 3_000)], AHORA) === 'normal')
  ok(`tres lentas (≥ ${UMBRAL_LENTO_MS} ms) en tres minutos entre muchas buenas: alta`, nivelDePresion([...buenas(12), m(5_000, 3_000), m(15_000, 2_600), m(25_000, 4_000)], AHORA) === 'alta')
  ok('una sola consulta que falla o se agota: alta (la base no contestó)', nivelDePresion([...buenas(12), m(5_000, 8_000, true)], AHORA) === 'alta')
  ok('dos que fallan: crítica', nivelDePresion([...buenas(12), m(5_000, 8_000, true), m(20_000, 8_000, true)], AHORA) === 'critica')
  ok(`tres muy lentas (≥ ${UMBRAL_MUY_LENTO_MS} ms): crítica`, nivelDePresion([...buenas(12), m(5_000, 7_000), m(15_000, 9_000), m(25_000, 6_500)], AHORA) === 'critica')
  ok('cuatro muestras y todas lentas (3 s): alta, no crítica', nivelDePresion([m(1_000, 3_000), m(11_000, 3_100), m(21_000, 3_200), m(31_000, 2_900)], AHORA) === 'alta')
  ok('cuatro y todas muy lentas: crítica', nivelDePresion([m(1_000, 7_000), m(11_000, 7_100), m(21_000, 7_200), m(31_000, 6_900)], AHORA) === 'critica')
  ok('con pocas muestras (4), que la mitad sean muy lentas basta: crítica; con muchas (12), dos muy lentas son un bache y no cambian nada', nivelDePresion([m(1_000, 7_000), m(11_000, 7_000), m(21_000, 300), m(31_000, 300)], AHORA) === 'critica' && nivelDePresion([...Array.from({ length: 2 }, (_, i) => m(i * 10_000, 7_000)), ...Array.from({ length: 10 }, (_, i) => m(i * 10_000 + 3_000, 300))], AHORA) === 'normal')
  const mala = [m(1_000, 8_000, true), m(11_000, 8_000, true), m(21_000, 8_000, true)]
  ok('la presión baja SOLA al hacerse viejas las muestras malas: cuatro minutos después, normal', nivelDePresion(mala, AHORA) === 'critica' && nivelDePresion(mala, AHORA + VENTANA_DE_MUESTRAS_MS + 5_000) === 'normal')
  ok('y en cuanto llegan buenas y las malas siguen dentro de la ventana, sigue habiendo presión (no se levanta al primer buen dato)', nivelDePresion([...mala, m(0, 200), m(500, 200)], AHORA) !== 'normal')
}

console.log('\n=== qué corre con cada presión ===')
{
  const niveles: NivelDePresion[] = ['normal', 'alta', 'critica']
  const prioridades: PrioridadDeTarea[] = ['esencial', 'normal', 'baja']
  const tabla = (p: PrioridadDeTarea, n: NivelDePresion, sin = 5) => decidirPorPresion(p, n, sin, 45).corre
  ok('con presión normal corre todo', prioridades.every((p) => tabla(p, 'normal')))
  ok('lo ESENCIAL corre siempre, también con la base casi muerta (es lo que no se puede dejar de hacer)', niveles.every((n) => tabla('esencial', n)))
  ok('lo normal espera solo con presión crítica', tabla('normal', 'alta') && !tabla('normal', 'critica'))
  ok('lo de prioridad baja espera con presión alta o crítica', !tabla('baja', 'alta') && !tabla('baja', 'critica'))
  ok('y dice por qué', decidirPorPresion('baja', 'alta', 5, 45).motivo?.includes('presión alta') === true && decidirPorPresion('normal', 'critica', 5, 45).motivo?.includes('crítica') === true && decidirPorPresion('baja', 'normal', 5, 45).motivo === null)
  ok('un proceso de prioridad baja que lleva más del ayuno sin correr SÍ corre con presión alta (no se queda sin correr horas)', decidirPorPresion('baja', 'alta', 50, 45).corre && !decidirPorPresion('baja', 'alta', 44, 45).corre)
  ok('pero NUNCA con presión crítica, por muy en ayunas que esté: no se ahoga más a una base que no contesta', !decidirPorPresion('baja', 'critica', 24 * 60, 45).corre)
}

console.log('\n=== una pesada a la vez ===')
{
  const pesadas = new Set(['amazon-sync', 'auditor-stock', 'amazon-jobs'])
  const esPesada = (t: string) => pesadas.has(t)
  const TOPE = 25 * 60_000
  ok('sin nada en marcha no hay con quién coincidir', otraPesadaEnMarcha(new Map(), 'auditor-stock', esPesada, AHORA, TOPE) === null)
  ok('con otra pesada en marcha, dice cuál', otraPesadaEnMarcha(new Map([['amazon-sync', AHORA - 120_000]]), 'auditor-stock', esPesada, AHORA, TOPE) === 'amazon-sync')
  ok('ella misma no cuenta (una pasada que sigue en marcha ya la frena el reloj de `tocaAhora`)', otraPesadaEnMarcha(new Map([['auditor-stock', AHORA - 60_000]]), 'auditor-stock', esPesada, AHORA, TOPE) === null)
  ok('un proceso ligero en marcha no frena a las pesadas', otraPesadaEnMarcha(new Map([['correo-sync', AHORA - 5_000]]), 'auditor-stock', esPesada, AHORA, TOPE) === null)
  ok('una pasada que lleva más del tope sin terminar se da por muerta y no bloquea a nadie', otraPesadaEnMarcha(new Map([['amazon-sync', AHORA - 26 * 60_000]]), 'auditor-stock', esPesada, AHORA, TOPE) === null)
  ok('con varias, basta que haya una viva', otraPesadaEnMarcha(new Map([['amazon-sync', AHORA - 30 * 60_000], ['amazon-jobs', AHORA - 20_000]]), 'auditor-stock', esPesada, AHORA, TOPE) === 'amazon-jobs')
}

console.log('\n=== el buzón de muestras ===')
{
  vaciarMuestras()
  ok('vacío: presión normal y sin mediana', estadoDeLaPresion(AHORA).nivel === 'normal' && estadoDeLaPresion(AHORA).medianaMs === null && estadoDeLaPresion(AHORA).muestras === 0)
  for (const ms of [200, 300, 250, 4_000, 280]) anotarMuestra(ms, false, AHORA)
  const e = estadoDeLaPresion(AHORA)
  ok('apunta las muestras, saca la mediana (no la media: un bache no la mueve) y el nivel', e.muestras === 5 && e.medianaMs === 280 && e.fallos === 0 && e.nivel === 'normal', JSON.stringify(e))
  anotarMuestra(8_000, true, AHORA)
  ok('una que falla se cuenta aparte', estadoDeLaPresion(AHORA).fallos === 1 && estadoDeLaPresion(AHORA).nivel === 'alta')
  anotarMuestra(250, false, AHORA + VENTANA_DE_MUESTRAS_MS + 1_000)
  const despues = estadoDeLaPresion(AHORA + VENTANA_DE_MUESTRAS_MS + 1_000)
  ok('pasados tres minutos las viejas se tiran solas y vuelve la normalidad', despues.muestras === 1 && despues.nivel === 'normal' && despues.fallos === 0, JSON.stringify(despues))
  vaciarMuestras()
  for (let i = 0; i < 300; i++) anotarMuestra(100, false, AHORA + i)
  ok('el buzón no crece sin fin: guarda unas pocas decenas', estadoDeLaPresion(AHORA + 300).muestras <= 80)
  vaciarMuestras()
  anotarMuestra(-5, false, AHORA)
  ok('una medida negativa por un reloj raro no rompe nada', estadoDeLaPresion(AHORA).medianaMs === 0)
  vaciarMuestras()
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
