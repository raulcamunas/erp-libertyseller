/**
 * Pruebas de lo puro de la integración de Correo (useCorreo.ts y useBandeja.ts): aterrizaje, a qué carpeta lleva un hilo, desde qué buzón
 * se redacta, qué se pide para cada página y la dirección del navegador.
 *
 *   cd /Users/raulcamunas/Dev/ERP-correo && npx tsx components/correo/integracion.prueba.ts
 */
import type { BuzonVisible, HiloDeLista } from '@/lib/correo/tipos'
import { anadirPagina, busquedaQueCuenta, claveDeConsulta, cursorDeRespuesta, urlDeLista } from './useBandeja'
import { aterrizaje, buzonesParaEnviarDe, buzonParaRedactar, buzonPropioParaEscribir, carpetaParaHilo, origenDeCarpeta, parametrosDeDireccion } from './useCorreo'

let fallos = 0
let total = 0
function igual(nombre: string, real: unknown, esperado: unknown) {
  total += 1
  const a = JSON.stringify(real)
  const b = JSON.stringify(esperado)
  const bien = a === b
  if (!bien) fallos += 1
  console.log(`  ${bien ? 'OK  ' : 'MAL '}  ${nombre}${bien ? '' : ` → ${a}, esperaba ${b}`}`)
}

const buzon = (id: string, extra: Partial<BuzonVisible> = {}): BuzonVisible => ({
  id,
  direccion: `${id}@libertyseller.es`,
  nombre: null,
  proveedor: 'hostinger',
  propietario: { id: `u-${id}`, nombre: id },
  esMio: false,
  conectado: true,
  credencialesInvalidas: false,
  ultimoSyncAt: null,
  ultimoError: null,
  historicoCompleto: true,
  desdeFecha: '2026-01-01',
  firma: null,
  resumen: { hilos: 0, hilosSinLeer: 0, sinLeer: 0, esperandoRespuesta: 0, ultimoMensajeAt: null } as BuzonVisible['resumen'],
  puedeResponder: false,
  asignado: false,
  enMisCorreos: false,
  orden: null,
  silenciado: false,
  silenciadoHasta: null,
  asignaciones: [],
  hilosSinLeerMios: 0,
  ...extra,
})

const propio = buzon('stock', { esMio: true, puedeResponder: true, enMisCorreos: true })
const propio2 = buzon('soporte', { esMio: true, puedeResponder: true, enMisCorreos: true })
const asignado = buzon('daniela', { asignado: true, puedeResponder: true, enMisCorreos: true })
const asignadoSinRespuesta = buzon('jose', { asignado: true, puedeResponder: false, enMisCorreos: true })
const delEquipo = buzon('maoli')

console.log('Aterrizaje')
igual('la dirección manda (buzón sin hilo → ese buzón)', aterrizaje([propio, propio2, delEquipo], { buzonPedido: 'maoli', bandeja: true }), { tipo: 'buzon', buzonId: 'maoli' })
igual('con hilo y el buzón en Mis correos → Mis correos', aterrizaje([propio, propio2], { buzonPedido: 'soporte', hiloPedido: 'h1', bandeja: true }), { tipo: 'mios' })
igual('con hilo y el buzón fuera de Mis correos → ese buzón', aterrizaje([propio, delEquipo], { buzonPedido: 'maoli', hiloPedido: 'h1', bandeja: true }), { tipo: 'buzon', buzonId: 'maoli' })
igual('un buzón de la dirección que ya no se lee no cuenta', aterrizaje([propio, propio2], { buzonPedido: 'otro', bandeja: true }), { tipo: 'mios' })
igual('2 o más en Mis correos → Mis correos', aterrizaje([propio, asignado, delEquipo], { bandeja: true }), { tipo: 'mios' })
igual('sin la 318 (sin bandeja) → el propio', aterrizaje([propio, asignado], { bandeja: false }), { tipo: 'buzon', buzonId: 'stock' })
igual('solo uno en Mis correos → el propio', aterrizaje([propio, delEquipo], { bandeja: true }), { tipo: 'buzon', buzonId: 'stock' })
igual('sin propio, un asignado → ese', aterrizaje([asignado, delEquipo], { bandeja: true }), { tipo: 'buzon', buzonId: 'daniela' })
igual('solo del equipo (Mario) → el resumen', aterrizaje([delEquipo], { bandeja: true }), { tipo: 'equipo' })
igual('nada → null (conectar)', aterrizaje([], { bandeja: true }), null)

console.log('A qué carpeta lleva una conversación')
igual('ya en ese buzón → se queda', carpetaParaHilo('maoli', [delEquipo], true, { tipo: 'buzon', buzonId: 'maoli' }), { tipo: 'buzon', buzonId: 'maoli' })
igual('buzón en Mis correos → Mis correos', carpetaParaHilo('daniela', [propio, asignado], true, { tipo: 'equipo' }), { tipo: 'mios' })
igual('en otro buzón y el del hilo en Mis correos → Mis correos', carpetaParaHilo('daniela', [propio, asignado], true, { tipo: 'buzon', buzonId: 'stock' }), { tipo: 'mios' })
igual('sin bandeja → el buzón', carpetaParaHilo('daniela', [propio, asignado], false, { tipo: 'mios' }), { tipo: 'buzon', buzonId: 'daniela' })
igual('fuera de Mis correos → el buzón', carpetaParaHilo('maoli', [propio, delEquipo], true, { tipo: 'mios' }), { tipo: 'buzon', buzonId: 'maoli' })

console.log('Redactar')
const roto = buzon('roto', { esMio: true, puedeResponder: true, credencialesInvalidas: true })
igual('«De:» = puedeResponder, conectado y sin contraseña rechazada', buzonesParaEnviarDe([propio, roto, asignado, asignadoSinRespuesta, delEquipo]).map((b) => b.id), ['stock', 'daniela'])
igual('el buzón abierto si se puede enviar desde él (asignado con respuesta)', buzonParaRedactar([propio, asignado], { carpeta: { tipo: 'buzon', buzonId: 'daniela' } })?.id, 'daniela')
igual('abierto sin respuesta → el propio', buzonParaRedactar([propio, asignadoSinRespuesta], { carpeta: { tipo: 'buzon', buzonId: 'jose' } })?.id, 'stock')
igual('en Mis correos con un hilo de un asignado con respuesta → ese', buzonParaRedactar([propio, asignado], { carpeta: { tipo: 'mios' }, buzonDelHilo: 'daniela' })?.id, 'daniela')
igual('supervisor sin buzón propio → nada', buzonParaRedactar([delEquipo, asignadoSinRespuesta], { carpeta: { tipo: 'mios' } }), null)
igual('lo que piden otras apps sale SIEMPRE del propio (nunca del asignado)', buzonPropioParaEscribir([asignado, propio2, propio], 'daniela')?.id, 'soporte')
igual('…el propio abierto si lo es', buzonPropioParaEscribir([propio, propio2], 'stock')?.id, 'stock')
igual('…sin propio conectado, nada', buzonPropioParaEscribir([asignado, roto], null), null)

console.log('La dirección del navegador')
igual('hilo abierto en Mis correos → su buzón y él', parametrosDeDireccion({ tipo: 'mios' }, { id: 'h1', buzonId: 'daniela' }), { buzon: 'daniela', hilo: 'h1' })
igual('un buzón sin hilo', parametrosDeDireccion({ tipo: 'buzon', buzonId: 'stock' }, null), { buzon: 'stock', hilo: null })
igual('Mis correos sin hilo → nada', parametrosDeDireccion({ tipo: 'mios' }, null), { buzon: null, hilo: null })
igual('origen de cada carpeta', [origenDeCarpeta({ tipo: 'mios' }), origenDeCarpeta({ tipo: 'equipo' }), origenDeCarpeta({ tipo: 'buzon', buzonId: 'x' }), origenDeCarpeta(null)], [{ tipo: 'mios' }, null, { tipo: 'buzon', buzonId: 'x' }, null])

console.log('Qué se pide para cada página')
const f = { vista: 'pendientes' as const, soloNoLeidos: true, busqueda: '', ocultarSilenciados: false }
igual('un buzón, primera página', urlDeLista({ tipo: 'buzon', buzonId: 'b1' }, f, null), '/api/correo/hilos?buzon=b1&vista=pendientes&sinLeer=1')
igual('un buzón, página siguiente (sin antesId)', urlDeLista({ tipo: 'buzon', buzonId: 'b1' }, f, { antes: '2026-11-01T10:00:00.000Z', antesId: '' }), '/api/correo/hilos?buzon=b1&vista=pendientes&sinLeer=1&antes=2026-11-01T10%3A00%3A00.000Z')
igual('Mis correos con cursor estable y ocultando silenciados', urlDeLista({ tipo: 'mios' }, { ...f, ocultarSilenciados: true }, { antes: 'A', antesId: 'id9' }), '/api/correo/bandeja?carpeta=mios&vista=pendientes&sinLeer=1&silenciados=0&antes=A&antesId=id9')
igual('con búsqueda: ni vista, ni sin leer, ni cursor (se filtra en el cliente)', urlDeLista({ tipo: 'mios' }, { ...f, busqueda: ' ana ' }, { antes: 'A', antesId: 'x' }), '/api/correo/bandeja?carpeta=mios&vista=todos&q=ana')
igual('con búsqueda, cambiar el filtro no cambia lo que se pide', claveDeConsulta({ tipo: 'mios' }, { ...f, busqueda: 'ana' }) === claveDeConsulta({ tipo: 'mios' }, { ...f, vista: 'todos', soloNoLeidos: false, busqueda: 'ana' }), true)
igual('sin búsqueda, sí', claveDeConsulta({ tipo: 'mios' }, f) === claveDeConsulta({ tipo: 'mios' }, { ...f, vista: 'todos' }), false)
igual('Asignados a mí', urlDeLista({ tipo: 'asignados' }, { vista: 'todos', soloNoLeidos: false, busqueda: '', ocultarSilenciados: true }, null), '/api/correo/bandeja?carpeta=asignados&vista=todos')
igual('una letra no es búsqueda', [busquedaQueCuenta('a'), busquedaQueCuenta('  ab '), busquedaQueCuenta('')], [null, 'ab', null])
igual('cursor de cada ruta', [cursorDeRespuesta('2026-11-01'), cursorDeRespuesta({ antes: 'A', antesId: 'B' }), cursorDeRespuesta(null), cursorDeRespuesta({})], [{ antes: '2026-11-01', antesId: '' }, { antes: 'A', antesId: 'B' }, null, null])
const h = (id: string) => ({ id }) as HiloDeLista
igual('añadir una página no repite filas', anadirPagina([h('a'), h('b')], [h('b'), h('c')]).map((x) => x.id), ['a', 'b', 'c'])

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `HAY ${fallos} FALLOS`} (${total} comprobaciones)`)
process.exit(fallos === 0 ? 0 : 1)
