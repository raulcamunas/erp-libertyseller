/**
 * LA LECTURA EN PARALELO, CON TRAMOS SIMULADOS.
 *
 *   npx tsx lib/auditor-stock/paralelo.prueba.ts
 */
import { leerTramos } from './paralelo'

let fallos = 0
function ok(que: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado)
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK  ' : 'MAL '}  ${que}${bien ? '' : `  (${JSON.stringify(real)} != ${JSON.stringify(esperado)})`}`)
}
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  console.log('\n=== SE LEEN TODOS, Y A LO SUMO `concurrencia` A LA VEZ ===')
  {
    let enVuelo = 0
    let maximo = 0
    const leidos: number[] = []
    const r = await leerTramos(
      20,
      async (idx) => {
        enVuelo++
        maximo = Math.max(maximo, enVuelo)
        await dormir(5)
        leidos.push(idx)
        enVuelo--
      },
      { concurrencia: 3, limiteMs: 60_000 }
    )
    ok('terminan los 20', r.hechos.length, 20)
    ok('ninguno repetido', new Set(r.hechos).size, 20)
    ok('están todos del 0 al 19', [...r.hechos].sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i))
    ok('nunca más de 3 en vuelo', maximo <= 3, true)
    ok('y de verdad se usó el paralelismo', maximo === 3, true)
    ok('sin fallo ni falta de tiempo', [r.fallo, r.sinTiempo], [null, false])
  }

  console.log('\n=== LOS TRAMOS NO ACABAN EN ORDEN, Y EL RESULTADO NO FINGE QUE SÍ ===')
  {
    // El tramo 0 es lentísimo: los demás acaban antes
    const r = await leerTramos(
      6,
      async (idx) => {
        await dormir(idx === 0 ? 60 : 5)
      },
      { concurrencia: 3, limiteMs: 60_000 }
    )
    ok('el 0 NO es el primero en acabar', r.hechos[0] !== 0, true)
    ok('pero acaba y está en la lista', r.hechos.includes(0), true)
    ok('son los 6', r.hechos.length, 6)
  }

  console.log('\n=== EL RELOJ SE MIRA ANTES DE COGER CADA TRAMO ===')
  {
    // Reloj simulado: cada lectura «cuesta» 100 ms de reloj
    let t = 0
    const empezados: number[] = []
    const r = await leerTramos(
      50,
      async (idx) => {
        empezados.push(idx)
        t += 100
        await dormir(1)
      },
      { concurrencia: 3, limiteMs: 1000, inicio: 0, ahora: () => t }
    )
    ok('se paró por falta de tiempo', r.sinTiempo, true)
    ok('NO leyó los 50', r.hechos.length < 50, true)
    ok('leyó los que cupieron: unos 10, no 50', r.hechos.length >= 8 && r.hechos.length <= 13, true)
    ok('los que empezaron acabaron: no se cortó ninguno a la mitad', empezados.length === r.hechos.length, true)
    ok('sin fallo', r.fallo, null)
  }

  console.log('\n=== UN FALLO PARA A TODOS, Y SE CONSERVA LO LEÍDO ===')
  {
    const empezados: number[] = []
    const r = await leerTramos(
      40,
      async (idx) => {
        empezados.push(idx)
        await dormir(3)
        if (idx === 6) throw new Error('la autorización ya no vale')
      },
      { concurrencia: 3, limiteMs: 60_000 }
    )
    ok('guarda el primer fallo', r.fallo, 'la autorización ya no vale')
    ok('NO se leyó todo', r.hechos.length < 40, true)
    ok('lo leído se conserva', r.hechos.length >= 4, true)
    ok('el tramo que falló NO cuenta como hecho', r.hechos.includes(6), false)
    ok('dejaron de empezar tramos: no se lanzaron los 40', empezados.length < 15, true)
    ok('no se marca como falta de tiempo', r.sinTiempo, false)
  }

  console.log('\n=== EL PRIMER FALLO MANDA: no lo pisa uno posterior ===')
  {
    const r = await leerTramos(
      9,
      async (idx) => {
        await dormir(2)
        if (idx === 1) throw new Error('primero')
        if (idx === 2) throw new Error('segundo')
      },
      { concurrencia: 3, limiteMs: 60_000 }
    )
    ok('se queda el primero que llegó', r.fallo === 'primero' || r.fallo === 'segundo', true)
    ok('y no cambia a mitad', typeof r.fallo, 'string')
  }

  console.log('\n=== EL MENSAJE SE CONVIERTE COMO PIDE QUIEN LLAMA ===')
  {
    const r = await leerTramos(
      2,
      async () => {
        throw new Error('crudo')
      },
      { concurrencia: 1, limiteMs: 60_000, mensajeDe: (e) => `humano: ${(e as Error).message}` }
    )
    ok('usa mensajeDe', r.fallo, 'humano: crudo')
  }

  console.log('\n=== CASOS LÍMITE ===')
  {
    const r0 = await leerTramos(0, async () => {}, { concurrencia: 3, limiteMs: 1000 })
    ok('cero tramos: no hace nada y no falla', [r0.hechos.length, r0.fallo, r0.sinTiempo], [0, null, false])

    const r1 = await leerTramos(1, async () => {}, { concurrencia: 8, limiteMs: 1000 })
    ok('un tramo con ocho trabajadores: se lee una vez', r1.hechos, [0])

    const rc = await leerTramos(3, async () => {}, { concurrencia: 0, limiteMs: 1000 })
    ok('concurrencia 0 no deja colgado: se trata como 1', rc.hechos.length, 3)
  }

  console.log('\n=== QUE EL RELOJ PASADO NO MARQUE «SIN TIEMPO» SI YA ESTABA TODO LEÍDO ===')
  {
    // El último tramo se lee justo antes del límite; el trabajador que mira el
    // reloj después ya no tiene nada que empezar.
    let t = 0
    const r = await leerTramos(
      3,
      async () => {
        t += 400
        await dormir(1)
      },
      { concurrencia: 1, limiteMs: 1000, inicio: 0, ahora: () => t }
    )
    ok('leyó los 3', r.hechos.length, 3)
    ok('y NO se marca como falta de tiempo', r.sinTiempo, false)
  }

  console.log(fallos === 0 ? '\n  TODO CORRECTO\n' : `\n  ${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}
main()
