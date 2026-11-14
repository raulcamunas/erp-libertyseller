/**
 * Pruebas del log auditable (cursor, filtros, CSV) y del rastro (qué escribe, la respuesta simulada del ensayo). npx tsx lib/ads/log-calculo.prueba.ts
 */
import { celdaCsv, condicionDeCursor, cursorATexto, cursorDeTexto, filtrosDeParametros, finDeDia, logACsv, textoDeBusqueda } from './log-calculo'
import { conRastro, enEnsayo, esEscritura, recortarParaLog, respuestaSimulada, tomarLlamadasNuevas, apuntarLlamada, propuestaDelRastro } from './rastro'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const ID = '3f2b8c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f'

console.log('\n=== cursor ===')
{
  const c = { creadoAt: '2026-11-14T10:11:12.345678+00:00', id: ID }
  const t = cursorATexto(c)
  ok('ida y vuelta', JSON.stringify(cursorDeTexto(t)) === JSON.stringify(c))
  ok('basura → null (nunca lanza)', cursorDeTexto('%%%') === null && cursorDeTexto('') === null && cursorDeTexto(null) === null)
  ok('id que no es uuid → null', cursorDeTexto(Buffer.from('2026-11-14T10:00:00Z|1; drop', 'utf8').toString('base64url')) === null)
  const cond = condicionDeCursor(c)
  ok('la condición entrecomilla la fecha (lleva «:» y «+»)', cond.includes('creado_at.lt."2026-11-14T10:11:12.345678+00:00"') && cond.includes(`id.lt.${ID}`), cond)
}

console.log('\n=== filtros ===')
{
  const p = new URLSearchParams({ desde: '2026-11-01', hasta: 'mañana', origen: 'ensayo', fallos: '1', campaignId: '123456789', usuarioId: 'no-uuid', q: '  negativa  ' })
  const f = filtrosDeParametros(p)
  ok('fecha válida pasa, la inválida no', f.desde === '2026-11-01' && f.hasta === null)
  ok('origen «ensayo» admitido', f.origen === 'ensayo')
  ok('solo fallos', f.soloFallos)
  ok('campaña numérica sí; persona sin forma de uuid no', f.campaignId === '123456789' && f.usuarioId === null)
  ok('la búsqueda se recorta', f.busqueda === 'negativa')
  ok('origen inventado → null', filtrosDeParametros(new URLSearchParams({ origen: 'hacker' })).origen === null)
  ok('la búsqueda pierde comodines, comas y paréntesis', textoDeBusqueda('a%b,c(d)*"e') === 'a b c d e', textoDeBusqueda('a%b,c(d)*"e'))
  ok('«hasta» incluye el día entero', finDeDia('2026-11-14') === '2026-11-15T00:00:00.000Z')
}

console.log('\n=== CSV ===')
{
  ok('celda con «;» va entre comillas', celdaCsv('a;b') === '"a;b"')
  ok('comillas dobladas', celdaCsv('di "hola"') === 'di "hola"' || celdaCsv('di "hola";') === '"di ""hola"";"')
  ok('una fórmula se neutraliza', celdaCsv('=HYPERLINK("x")').startsWith(`"'=`) || celdaCsv('=1+1') === "'=1+1", celdaCsv('=1+1'))
  ok('null → vacío', celdaCsv(null) === '')
  const csv = logACsv([{ creadoAt: '2026-11-14T09:30:00Z', origen: 'manual', usuario: 'Ana', nombreCampana: 'B0X | SKU | JAMON | AUTO RADAR', campaignId: '1', entidad: 'negativa', entidadId: '99', accion: 'negativizar', campo: 'palabra clave negativa exacta', valorAnterior: null, valorNuevo: 'fedora', motivo: 'gasta sin vender', ok: true, error: null, httpStatus: 207, requestId: 'abc', propuestaId: ID }])
  const lineas = csv.replace('﻿', '').split('\r\n')
  ok('BOM para Excel y cabecera + una fila', csv.startsWith('﻿') && lineas.length === 2)
  ok('la fecha va en hora de España', lineas[1].startsWith('14/11/2026 10:30'), lineas[1])
  ok('resultado legible', lineas[1].includes('Aceptado') && lineas[1].includes('Persona'))
}

console.log('\n=== rastro: qué escribe y qué no ===')
{
  ok('PUT de keywords escribe', esEscritura('PUT', '/sp/keywords'))
  ok('POST …/delete escribe', esEscritura('POST', '/sp/targets/delete'))
  ok('POST …/list NO escribe', !esEscritura('POST', '/sp/keywords/list'))
  ok('GET no escribe; pedir un informe tampoco', !esEscritura('GET', '/v2/profiles') && !esEscritura('POST', '/reporting/reports'))
  const sim = respuestaSimulada({ keywords: [{}, {}] }) as Record<string, { success: Array<Record<string, unknown>> }>
  ok('la respuesta simulada tiene un éxito por elemento, con id ENSAYO', sim.keywords.success.length === 2 && sim.keywords.success[1].keywordId === 'ENSAYO-2')
  ok('y sirve para cualquier lista (negativas de campaña)', (sim.campaignNegativeKeywords as { success: Array<Record<string, unknown>> }).success[0].campaignNegativeKeywordId === 'ENSAYO-1')
  ok('recortar: un JSON en texto se guarda como JSON', JSON.stringify(recortarParaLog('{"a":1}')) === '{"a":1}')
  ok('recortar: lo largo se corta', (recortarParaLog('x'.repeat(5000)) as { recortado?: boolean }).recortado === true)
}

async function asincronas() {
  console.log('\n=== rastro: ensayo y llamadas por entrada ===')
  ok('fuera de un rastro no hay ensayo', !enEnsayo())
  const { salida, llamadas } = await conRastro({ ensayo: true, propuestaId: ID }, async () => {
    apuntarLlamada({ metodo: 'PUT', ruta: '/sp/keywords', cuerpo: {}, status: null, requestId: null, respuesta: null, simulada: true, ms: 0 })
    const primera = tomarLlamadasNuevas().length
    apuntarLlamada({ metodo: 'PUT', ruta: '/sp/campaigns', cuerpo: {}, status: null, requestId: null, respuesta: null, simulada: true, ms: 0 })
    apuntarLlamada({ metodo: 'PUT', ruta: '/sp/targets', cuerpo: {}, status: null, requestId: null, respuesta: null, simulada: true, ms: 0 })
    return { ensayo: enEnsayo(), primera, segunda: tomarLlamadasNuevas().length, tercera: tomarLlamadasNuevas().length, propuesta: propuestaDelRastro() }
  })
  ok('dentro, ensayo', salida.ensayo)
  ok('cada entrada del log se lleva solo SUS llamadas', salida.primera === 1 && salida.segunda === 2 && salida.tercera === 0, JSON.stringify(salida))
  ok('la propuesta viaja con el rastro', salida.propuesta === ID)
  ok('al final están todas', llamadas.length === 3)
  ok('al salir ya no hay ensayo', !enEnsayo())
}

asincronas().then(() => {
  console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
  process.exit(fallos === 0 ? 0 : 1)
})
