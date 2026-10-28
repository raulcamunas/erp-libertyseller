import type { LlamadaParaIa } from './ia-contexto'
import { AVISO_TRANSCRIPCION_PENDIENTE, esperarLaTranscripcion, hayTranscripcionPendiente, MINUTOS_QUE_MERECE_LA_PENA_ESPERAR, SEGUNDOS_HASTA_QUE_SE_OFRECE, sePuedeAdelantar, type DependenciasDeLaEspera } from './ia-espera'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const T0 = Date.parse('2026-10-28T09:00:00Z')
const llamada = (finHaceMs: number, duracion_s: number, extra: Partial<LlamadaParaIa> = {}): LlamadaParaIa => ({
  fecha: new Date(T0 - finHaceMs - duracion_s * 1000).toISOString(),
  direccion: 'outbound',
  duracion_s,
  estado: 'ANSWERED',
  ...extra,
})

/** Un reloj de mentira: `dormir` lo avanza, y las lecturas cuentan cuántas veces se han hecho */
function mundo(transcritaEnLaLectura: number | null, opciones: { falloAlAdelantar?: boolean; falloAlCargar?: boolean; finHaceMs?: number } = {}) {
  const finHaceMs = opciones.finHaceMs ?? 120_000
  let reloj = T0
  const m = { lecturas: 0, adelantos: 0, durmio: [] as number[], restantes: [] as number[], relojEnCadaAdelanto: [] as number[] }
  const deps: DependenciasDeLaEspera = {
    ahora: () => reloj,
    dormir: async (ms) => {
      m.durmio.push(ms)
      reloj += ms
    },
    adelantar: async (restanteMs) => {
      m.adelantos++
      m.restantes.push(restanteMs)
      m.relojEnCadaAdelanto.push(reloj - T0)
      if (opciones.falloAlAdelantar) throw new Error('Rinkel no contesta')
    },
    cargar: async () => {
      m.lecturas++
      if (opciones.falloAlCargar) throw new Error('la base no contesta')
      // La llamada acabó `finHaceMs` antes de T0 y va cumpliendo tiempo sola a medida que avanza el reloj de mentira
      return transcritaEnLaLectura !== null && m.lecturas >= transcritaEnLaLectura ? [llamada(finHaceMs, 100, { tipo: 'conversacion', resumen: 'Habló con Javier.' })] : [llamada(finHaceMs, 100)]
    },
  }
  return { deps, m, reloj: () => reloj }
}

console.log('\n=== ¿hay algo que esperar? ===')
{
  ok('una contestada y larga que acaba de terminar, sin transcripción: sí', hayTranscripcionPendiente([llamada(60_000, 90)], T0))
  ok('hace 7 minutos todavía vale la pena; hace 9, ya no', hayTranscripcionPendiente([llamada(7 * 60_000, 90)], T0) && !hayTranscripcionPendiente([llamada(9 * 60_000, 90)], T0) && MINUTOS_QUE_MERECE_LA_PENA_ESPERAR === 8)
  ok('si ya está transcrita (conversación, buzón o sin contenido), no', !hayTranscripcionPendiente([llamada(60_000, 90, { tipo: 'conversacion' })], T0) && !hayTranscripcionPendiente([llamada(60_000, 90, { tipo: 'buzon_de_voz' })], T0) && !hayTranscripcionPendiente([llamada(60_000, 90, { tipo: 'sin_contenido' })], T0))
  ok('una llamada de menos de 20 s no se transcribe nunca: no se espera', !hayTranscripcionPendiente([llamada(30_000, 6)], T0))
  ok('una que no cogieron, tampoco', !hayTranscripcionPendiente([llamada(30_000, 0, { estado: 'MISSED' })], T0))
  ok('sin llamadas, nada', !hayTranscripcionPendiente([], T0))
  ok('el aviso para el comercial dice que espere un par de minutos y que puede contárselo a la IA', /par de minutos/.test(AVISO_TRANSCRIPCION_PENDIENTE) && /indicaciones/.test(AVISO_TRANSCRIPCION_PENDIENTE))
}

console.log('\n=== ¿se puede adelantar ya? (el SQL la ofrece a los 45 s) ===')
{
  ok('colgada hace 30 s: todavía no (no hay nada que adelantar), pero sí se espera', !sePuedeAdelantar([llamada(30_000, 90)], T0) && hayTranscripcionPendiente([llamada(30_000, 90)], T0) && SEGUNDOS_HASTA_QUE_SE_OFRECE === 45)
  ok('a los 45 s justos, sí', sePuedeAdelantar([llamada(45_000, 90)], T0) && !sePuedeAdelantar([llamada(44_000, 90)], T0))
  ok('y hasta los 8 minutos; pasados, no', sePuedeAdelantar([llamada(7 * 60_000, 90)], T0) && !sePuedeAdelantar([llamada(9 * 60_000, 90)], T0))
  ok('si ya está transcrita o no es una conversación contestada, no', !sePuedeAdelantar([llamada(120_000, 90, { tipo: 'conversacion' })], T0) && !sePuedeAdelantar([llamada(120_000, 0, { estado: 'MISSED' })], T0) && !sePuedeAdelantar([], T0))
  ok('con dos llamadas basta con que una se pueda adelantar', sePuedeAdelantar([llamada(30_000, 90), llamada(200_000, 90)], T0))
}

async function main() {
  console.log('\n=== esperar ===')
  {
    const { deps, m, reloj } = mundo(null)
    const r = await esperarLaTranscripcion(deps, [llamada(120_000, 100, { tipo: 'conversacion' })])
    ok('si no hay nada pendiente, no espera ni lee ni adelanta nada', r.vueltas === 0 && m.lecturas === 0 && m.adelantos === 0 && m.durmio.length === 0 && !r.pendiente && reloj() === T0)
  }
  {
    const { deps, m } = mundo(2)
    const r = await esperarLaTranscripcion(deps, [llamada(120_000, 100)])
    ok('adelanta el trabajo y vuelve a mirar: a la segunda lectura ya está y deja de esperar', !r.pendiente && r.vueltas === 2 && m.adelantos === 2 && m.lecturas === 2, JSON.stringify({ r: { ...r, llamadas: undefined }, m }))
    ok('esperó UNA pausa de 5 s, no más', m.durmio.length === 1 && m.durmio[0] === 5_000 && r.esperadoMs === 5_000)
    ok('y la llamada devuelta ya trae lo que se habló', r.llamadas[0].tipo === 'conversacion' && r.llamadas[0].resumen === 'Habló con Javier.')
  }
  {
    const { deps, m } = mundo(null)
    const r = await esperarLaTranscripcion(deps, [llamada(120_000, 100)])
    ok('si nunca llega, se rinde a los 45 s y lo dice (pendiente)', r.pendiente && r.esperadoMs <= 45_000 && r.esperadoMs >= 35_000, String(r.esperadoMs))
    ok('sin pasarse de vueltas: como mucho nueve lecturas', m.lecturas <= 9 && m.lecturas >= 7, String(m.lecturas))
    ok('a adelantar se le dice cuánto queda (45 s al empezar y cada vez menos) para no empezar nada que no quepa', m.restantes[0] === 45_000 && m.restantes.every((x, i) => i === 0 || x < m.restantes[i - 1]) && m.restantes.at(-1)! > 0, JSON.stringify(m.restantes))
  }
  {
    // Colgada hace 20 s: hasta los 45 s solo se mira (una lectura), y desde entonces se adelanta. A los 25 s de espera cumple los 45 y se transcribe
    const { deps, m } = mundo(8, { finHaceMs: 20_000 })
    const r = await esperarLaTranscripcion(deps, [llamada(20_000, 100)])
    ok('antes de los 45 s no se adelanta nada: el primer adelanto llega cuando la llamada los cumple (25 s después)', m.relojEnCadaAdelanto.length > 0 && m.relojEnCadaAdelanto[0] >= 25_000, JSON.stringify(m.relojEnCadaAdelanto))
    ok('y se leyó mucho más de lo que se adelantó', m.lecturas > m.adelantos, JSON.stringify({ lecturas: m.lecturas, adelantos: m.adelantos }))
    ok('al final llega la transcripción y no queda pendiente', !r.pendiente && r.llamadas[0].tipo === 'conversacion')
  }
  {
    const { deps } = mundo(null)
    const r = await esperarLaTranscripcion(deps, [llamada(120_000, 100)], { maxMs: 10_000, cadaMs: 5_000 })
    ok('el tiempo máximo se puede cambiar', r.esperadoMs <= 10_000 && r.pendiente)
  }
  {
    const { deps, m } = mundo(2, { falloAlAdelantar: true })
    const r = await esperarLaTranscripcion(deps, [llamada(120_000, 100)])
    ok('si adelantar falla (Rinkel o la IA caídos), se ignora y se sigue esperando', !r.pendiente && m.adelantos === 2)
  }
  {
    const { deps, m } = mundo(2, { falloAlCargar: true })
    const previo = [llamada(120_000, 100)]
    const r = await esperarLaTranscripcion(deps, previo)
    ok('si no se pueden leer las llamadas, no se lanza nada: se deja lo que había y se sigue sin esperar más', r.pendiente && r.llamadas === previo && m.lecturas === 1 && m.durmio.length === 0)
  }
  {
    // Un reloj que no avanza (dormir no hace nada) no puede dejar el bucle colgado: lo cortan las lecturas
    let lecturas = 0
    const deps: DependenciasDeLaEspera = { ahora: () => T0, dormir: async () => {}, adelantar: async () => {}, cargar: async () => (++lecturas > 50 ? [] : [llamada(120_000, 100)]) }
    const r = await Promise.race([esperarLaTranscripcion(deps, [llamada(120_000, 100)], { maxMs: 35_000, cadaMs: 5_000 }), new Promise<'colgado'>((res) => setTimeout(() => res('colgado'), 2_000))])
    ok('el bucle termina aunque el reloj no avance', r !== 'colgado' || lecturas > 0)
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
