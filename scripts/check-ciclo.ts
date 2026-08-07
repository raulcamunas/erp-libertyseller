/**
 * COMPROBACIÓN DEL CICLO AUTOMÁTICO.
 *
 * El ciclo es lo único de todo el módulo que corre SIN NADIE DELANTE, así que
 * sus decisiones no las revisa nadie antes de que ocurran. Aquí se comprueban
 * las cuatro que pueden hacer daño de verdad, y ninguna de ellas da error
 * cuando se equivoca:
 *
 *   1. LA HUELLA DEL FICHERO. Si dijera «es el mismo» cuando no lo es, el stock
 *      de un cliente se congela para siempre en silencio. Si dijera «es otro»
 *      cuando es igual, se reprocesa y se reenvía cada cuarto de hora.
 *
 *   2. LA CADENCIA. Un margen mal puesto hace que un perfil de 15 minutos
 *      disparado por un cron de 15 minutos se procese la mitad de las veces. No
 *      falla, solo va a medio gas, y eso tarda semanas en notarse.
 *
 *   3. EL ESTADO CON EL QUE QUEDA CADA EJECUCIÓN. Es lo que decide si suena la
 *      campana y lo que se lee seis meses después. Un envío que Amazon rechazó
 *      entero guardado como «enviado» es la clase de verde que hace que nadie
 *      mire.
 *
 *   4. QUE NO HAYA NINGÚN CAMINO DE ENVÍO ESCONDIDO. La garantía de que el
 *      envío nace apagado no vale nada si mañana alguien añade un sendChanges()
 *      en otro sitio, así que se comprueba dónde está escrito.
 *
 * No toca la base de datos ni la red: todo lo que se comprueba aquí son
 * funciones puras y el propio código fuente.
 *
 *   npx tsx scripts/check-ciclo.ts
 *
 * Sale con código 1 si algo no cuadra.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { leToca } from '../lib/stock-sync/ciclo'
import { estadoDe, huellaDeContenido, type EnvioRealizado } from '../lib/stock-sync/proceso'
import type { Simulacro } from '../lib/stock-sync/simulacro'
import type { StockReadProfile } from '../lib/types/stock-sync'

let fallos = 0

function comprobar(titulo: string, ok: boolean, detalle = ''): void {
  console.log(`${ok ? '  OK  ' : ' FALLA'}  ${titulo}${detalle ? ` — ${detalle}` : ''}`)
  if (!ok) fallos++
}

const RAIZ = join(__dirname, '..')

/* =====================================================
   1) La huella del contenido
   ===================================================== */

console.log('\n— La huella del fichero —\n')

const A = new TextEncoder().encode('articulo;stock\nAB-001;12\nAB-002;0\n')
const B = new TextEncoder().encode('articulo;stock\nAB-001;12\nAB-002;1\n')

comprobar(
  'el mismo contenido da la misma huella',
  huellaDeContenido(A) === huellaDeContenido(A.slice())
)

comprobar(
  'una sola unidad distinta da otra huella',
  huellaDeContenido(A) !== huellaDeContenido(B),
  'AB-002 con 0 vs con 1'
)

comprobar(
  'el mismo contenido llegue como ArrayBuffer o como Uint8Array da la misma huella',
  huellaDeContenido(A) === huellaDeContenido(A.buffer.slice(0) as ArrayBuffer),
  'un conector devuelve uno y otro devuelve el otro'
)

/**
 * EL CASO QUE MUERDE. Un Uint8Array puede ser una VENTANA sobre un buffer más
 * grande: el fichero de verdad son unos bytes de en medio. Si la huella se
 * calculara sobre `bytes.buffer` en vez de sobre la ventana, dos ficheros
 * distintos que viajaran dentro del mismo buffer darían la MISMA huella, y el
 * segundo no se procesaría nunca.
 */
const grande = new Uint8Array(64)
grande.set(A.slice(0, 10), 8)
const ventanaA = grande.subarray(8, 18)

const grande2 = new Uint8Array(64)
grande2.set(B.slice(0, 10), 8)
grande2[40] = 99 // basura fuera de la ventana: no puede cambiar nada
const ventanaB = grande2.subarray(8, 18)

comprobar(
  'la huella es la de la VENTANA, no la del buffer que la contiene',
  huellaDeContenido(ventanaA) === huellaDeContenido(A.slice(0, 10)),
  'los mismos 10 bytes en medio de un buffer de 64'
)

comprobar(
  'y la basura de fuera de la ventana no la cambia',
  huellaDeContenido(ventanaB) === huellaDeContenido(B.slice(0, 10))
)

comprobar(
  'la huella dice de dónde salió',
  huellaDeContenido(A).startsWith('sha256:'),
  huellaDeContenido(A).slice(0, 20) + '…'
)

/* =====================================================
   2) La cadencia
   ===================================================== */

console.log('\n— Cuándo le toca a un perfil —\n')

const AHORA = new Date('2026-08-07T12:00:00.000Z')

function perfil(patch: Partial<StockReadProfile>): StockReadProfile {
  return { cadencia_minutos: 15, last_run_at: null, ...patch } as StockReadProfile
}

function haceMinutos(m: number): string {
  return new Date(AHORA.getTime() - m * 60 * 1000).toISOString()
}

comprobar(
  'un perfil que nunca se ha ejecutado va siempre',
  leToca(perfil({ last_run_at: null }), AHORA)
)

comprobar(
  'a los 3 minutos de una cadencia de 15 todavía no le toca',
  !leToca(perfil({ last_run_at: haceMinutos(3) }), AHORA)
)

/**
 * EL CASO DEL MARGEN, y es el que justifica que exista.
 *
 * El cron entra cada 15 minutos pero no entra al segundo exacto. Basta con que
 * la pasada de hoy empiece unos segundos antes que la de hace un cuarto de hora
 * para que hayan pasado 14 minutos y 55 segundos. Sin margen, ese perfil se
 * descarta por cinco segundos y no se vuelve a mirar hasta media hora después:
 * se actualiza la MITAD de veces de las que debería, sin dar ningún error.
 */
comprobar(
  'a los 14 min 55 s de una cadencia de 15 SÍ le toca',
  leToca(perfil({ last_run_at: haceMinutos(14.92) }), AHORA),
  'el cron no entra al segundo exacto'
)

comprobar(
  'a los 20 minutos de una cadencia de 15 le toca',
  leToca(perfil({ last_run_at: haceMinutos(20) }), AHORA)
)

comprobar(
  'una cadencia de 60 no se dispara a los 30 minutos',
  !leToca(perfil({ cadencia_minutos: 60, last_run_at: haceMinutos(30) }), AHORA),
  'el margen es de un minuto, no proporcional'
)

/* =====================================================
   3) El estado con el que queda la ejecución
   ===================================================== */

console.log('\n— Cómo queda registrada cada ejecución —\n')

function simulacro(params: { puedeEnviar: boolean; cambios: number }): Simulacro {
  return {
    cambios: Array.from({ length: params.cambios }, () => ({})),
    frenos: { puedeEnviar: params.puedeEnviar },
  } as unknown as Simulacro
}

function envio(aceptados: number, fallidos: number): EnvioRealizado {
  return { batchId: 'lote-1', aceptados, fallidos, abortado: null }
}

comprobar(
  'sin cambios que mandar queda como «sin cambios»',
  estadoDe(simulacro({ puedeEnviar: true, cambios: 0 }), null) === 'sin_cambios'
)

comprobar(
  'con cambios y sin enviar queda como «simulacro»',
  estadoDe(simulacro({ puedeEnviar: true, cambios: 18 }), null) === 'simulacro',
  'es el estado en el que nace todo cliente'
)

comprobar(
  'un freno queda como «frenado» aunque hubiera cambios',
  estadoDe(simulacro({ puedeEnviar: false, cambios: 300 }), null) === 'frenado'
)

/**
 * Un freno tiene que ganar a TODO. Si esta llamada llegara con un envío hecho,
 * significaría que alguien mandó algo a pesar del freno, y el estado no puede
 * disimularlo poniendo «enviado».
 */
comprobar(
  'y sigue siendo «frenado» aunque le llegue un envío hecho',
  estadoDe(simulacro({ puedeEnviar: false, cambios: 300 }), envio(300, 0)) === 'frenado',
  'el freno gana a todo lo demás'
)

comprobar(
  'un envío que entra queda como «enviado»',
  estadoDe(simulacro({ puedeEnviar: true, cambios: 20 }), envio(20, 0)) === 'enviado'
)

comprobar(
  'un envío a medias sigue siendo «enviado», con su desglose',
  estadoDe(simulacro({ puedeEnviar: true, cambios: 20 }), envio(18, 2)) === 'enviado'
)

/**
 * EL QUE MÁS IMPORTA de los cinco: Amazon no aceptó ni uno. Guardarlo como
 * «enviado» lo pintaría de verde, no sonaría la campana y no saldría en el
 * índice de incidencias. El stock del cliente seguiría viejo y en el historial
 * pondría que se mandó.
 */
comprobar(
  'un envío que Amazon rechaza ENTERO queda como «error», no como «enviado»',
  estadoDe(simulacro({ puedeEnviar: true, cambios: 20 }), envio(0, 20)) === 'error',
  '0 aceptados de 20'
)

/* =====================================================
   4) Que no haya caminos de envío escondidos
   ===================================================== */

console.log('\n— De dónde puede salir un envío —\n')

function fuente(ruta: string): string {
  return readFileSync(join(RAIZ, ruta), 'utf8')
}

const ciclo = fuente('lib/stock-sync/ciclo.ts')
const proceso = fuente('lib/stock-sync/proceso.ts')
const rutaSimulacro = fuente('app/api/amazon/perfiles/[id]/simulacro/route.ts')

// Se busca la LLAMADA y el IMPORT, no el nombre suelto: los dos ficheros
// mencionan sendChanges en sus comentarios, y un comentario no manda nada.
comprobar(
  'el único sendChanges() de la automatización está en el ciclo',
  ciclo.includes('await sendChanges(') &&
    !proceso.includes('sendChanges(\n') &&
    !proceso.includes('await sendChanges') &&
    !/import\s*\{[^}]*\bsendChanges\b/.test(proceso),
  'proceso.ts prepara el envío pero no lo hace ni lo importa'
)

comprobar(
  'la ruta del simulacro no le pasa la puerta de envío a procesarPerfil',
  !/\benviar\s*:/.test(rutaSimulacro),
  'por ahí no se puede escribir en la tienda de un cliente'
)

comprobar(
  'el ciclo solo pasa la puerta de envío si el perfil lo tiene encendido',
  ciclo.includes('perfil.envio_automatico ?'),
  'con el interruptor apagado la función ni se pasa'
)

comprobar(
  'procesarPerfil no llama a enviar si saltó un freno o no hay cambios',
  proceso.includes(
    'opciones.enviar && simulacro.frenos.puedeEnviar && simulacro.cambios.length > 0'
  )
)

comprobar(
  'lo que se manda sale de la MISMA lista que han visto los frenos',
  ciclo.includes('simulacro.cambios.map('),
  'no se recorre nada por segunda vez para construirla'
)

/* ===================================================== */

console.log(
  fallos === 0
    ? '\nTodo cuadra: el ciclo decide lo que dice decidir.\n'
    : `\n${fallos} comprobaciones han fallado.\n`
)
process.exit(fallos === 0 ? 0 : 1)
