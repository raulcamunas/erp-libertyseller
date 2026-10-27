import { inicioDelDia } from '@/lib/rendimiento/dia'
import { ErrorDeHerramienta } from '../protocolo'
import { ajustarAlTamano, aMinutos, datosDePagina, diaArg, elegirPersona, fallo, fechaHora, instantesDe, normalizar, paginaArg, patronDeBusqueda, rangoArg, rangoOUltimosDias, recortar, recortarLargo, type Persona } from './comun'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
/** Lo que dice el error que lanza `f`, o null si no lanza */
const mensajeDe = (f: () => unknown): string | null => {
  try {
    f()
    return null
  } catch (e) {
    return e instanceof ErrorDeHerramienta ? e.message : `OTRO ERROR: ${String(e)}`
  }
}

const HOY = '2026-10-27'

console.log('\n=== los días de los argumentos ===')
{
  ok('«hoy» y «ayer»', diaArg({ d: 'hoy' }, 'd', { hoy: HOY }) === HOY && diaArg({ d: 'AYER' }, 'd', { hoy: HOY }) === '2026-10-26')
  ok('un día con formato', diaArg({ d: '2026-10-01' }, 'd', { hoy: HOY }) === '2026-10-01')
  ok('sin argumento, nada', diaArg({}, 'd', { hoy: HOY }) === undefined)
  ok('un día que no existe es un error que dice el formato', /AAAA-MM-DD/.test(mensajeDe(() => diaArg({ d: '2026-02-31' }, 'd', { hoy: HOY })) ?? ''))
  ok('«mañana» no vale', mensajeDe(() => diaArg({ d: 'mañana' }, 'd', { hoy: HOY })) !== null)
  ok('requerido y ausente, error', /Falta/.test(mensajeDe(() => diaArg({}, 'd', { requerido: true, hoy: HOY })) ?? ''))
}

console.log('\n=== los rangos ===')
{
  ok('sin nada, solo hoy', JSON.stringify(rangoArg({}, { hoy: HOY })) === JSON.stringify({ desde: HOY, hasta: HOY }))
  ok('solo desde (pasado): hasta hoy', JSON.stringify(rangoArg({ desde: '2026-10-20' }, { hoy: HOY })) === JSON.stringify({ desde: '2026-10-20', hasta: HOY }))
  ok('solo desde (futuro): ese día', JSON.stringify(rangoArg({ desde: '2026-11-03' }, { hoy: HOY })) === JSON.stringify({ desde: '2026-11-03', hasta: '2026-11-03' }))
  ok('solo hasta: ese día', JSON.stringify(rangoArg({ hasta: '2026-10-20' }, { hoy: HOY })) === JSON.stringify({ desde: '2026-10-20', hasta: '2026-10-20' }))
  ok('los dos', JSON.stringify(rangoArg({ desde: '2026-10-01', hasta: '2026-10-10' }, { hoy: HOY })) === JSON.stringify({ desde: '2026-10-01', hasta: '2026-10-10' }))
  ok('al revés, error con los dos días', /2026-10-10.*2026-10-01/.test(mensajeDe(() => rangoArg({ desde: '2026-10-10', hasta: '2026-10-01' }, { hoy: HOY })) ?? ''))
  const largo = mensajeDe(() => rangoArg({ desde: '2026-01-01', hasta: '2026-10-01' }, { hoy: HOY, maxDias: 31 }))
  ok('más de lo permitido, error que dice el máximo y qué hacer', /31/.test(largo ?? '') && /Acótalo/.test(largo ?? ''))
  ok('justo el máximo, vale', mensajeDe(() => rangoArg({ desde: '2026-09-01', hasta: '2026-10-01' }, { hoy: HOY, maxDias: 31 })) === null)

  ok('rangoOUltimosDias sin fechas: los últimos 7 con hoy', JSON.stringify(rangoOUltimosDias({}, { porDefecto: 7, hoy: HOY })) === JSON.stringify({ desde: '2026-10-21', hasta: HOY }))
  ok('rangoOUltimosDias con fechas: manda lo pedido', JSON.stringify(rangoOUltimosDias({ desde: '2026-10-01', hasta: '2026-10-03' }, { porDefecto: 7, hoy: HOY })) === JSON.stringify({ desde: '2026-10-01', hasta: '2026-10-03' }))
  ok('rangoOUltimosDias con un día de más de lo permitido, error', mensajeDe(() => rangoOUltimosDias({ desde: '2026-01-01' }, { porDefecto: 7, maxDias: 31, hoy: HOY })) !== null)

  const dia = instantesDe({ desde: '2026-10-27', hasta: '2026-10-27' })
  ok('un día son [00:00 de Madrid, 00:00 del siguiente)', dia.desde === inicioDelDia('2026-10-27').toISOString() && dia.hasta === inicioDelDia('2026-10-28').toISOString())
  const verano = instantesDe({ desde: '2026-07-01', hasta: '2026-07-01' })
  ok('en verano la medianoche de Madrid es la de UTC menos dos horas', verano.desde === '2026-06-30T22:00:00.000Z')
  const cambio = instantesDe({ desde: '2026-10-25', hasta: '2026-10-25' })
  ok('el día del cambio de hora dura 25 horas', Date.parse(cambio.hasta) - Date.parse(cambio.desde) === 25 * 3_600_000)
}

console.log('\n=== las páginas ===')
{
  const p = paginaArg({}, { limite: 25, max: 100 })
  ok('por defecto, página 0 y 25', p.pagina === 0 && p.limite === 25 && p.desde === 0 && p.hasta === 24)
  const q = paginaArg({ pagina: '2', limite: 10 }, { max: 50 })
  ok('un número escrito como texto vale', q.pagina === 2 && q.desde === 20 && q.hasta === 29)
  ok('un límite por encima del máximo, error', mensajeDe(() => paginaArg({ limite: 500 }, { max: 50 })) !== null)
  ok('una página negativa, error', mensajeDe(() => paginaArg({ pagina: -1 }, {})) !== null)
  const d = datosDePagina(p, 60, 25)
  ok('con 60 y 25 por página hay más y la siguiente es la 1', d.hay_mas && d.siguiente_pagina === 1 && d.total === 60 && d.devueltas === 25)
  const u = datosDePagina(paginaArg({ pagina: 2, limite: 25 }, {}), 60, 10)
  ok('la última página no tiene siguiente', !u.hay_mas && u.siguiente_pagina === null)
  const v = datosDePagina(p, 0, 0)
  ok('vacío: sin más', !v.hay_mas && v.total === 0)
}

console.log('\n=== elegir a una persona por lo que se escribe ===')
{
  const equipo: Persona[] = [
    { id: '00000000-0000-4000-8000-00000000000a', nombre: 'Ana López', email: 'ana@libertyseller.com' },
    { id: '00000000-0000-4000-8000-00000000000b', nombre: 'Mariana Gómez', email: 'mariana@libertyseller.com' },
    { id: '00000000-0000-4000-8000-00000000000c', nombre: 'María Fernanda Ruiz', email: 'mariafernanda@libertyseller.com' },
    { id: '00000000-0000-4000-8000-00000000000d', nombre: 'Maoli Pérez', email: 'maoli@libertyseller.com' },
  ]
  ok('por nombre entero', elegirPersona(equipo, 'Maoli Pérez').nombre === 'Maoli Pérez')
  ok('por parte del nombre, sin acentos ni mayúsculas', elegirPersona(equipo, 'MAOLI').nombre === 'Maoli Pérez' && elegirPersona(equipo, 'maria fernanda').nombre === 'María Fernanda Ruiz')
  ok('por correo', elegirPersona(equipo, 'mariana@libertyseller.com').nombre === 'Mariana Gómez')
  ok('por id', elegirPersona(equipo, '00000000-0000-4000-8000-00000000000A').nombre === 'Ana López')
  ok('«ana» es Ana (su primer nombre), aunque «Mariana» lo contenga', elegirPersona(equipo, 'ana').nombre === 'Ana López')
  const varios = mensajeDe(() => elegirPersona(equipo, 'mari'))
  ok('«mari» es ambiguo: el error dice cuáles', /varios/.test(varios ?? '') && /Mariana Gómez/.test(varios ?? '') && /María Fernanda Ruiz/.test(varios ?? ''))
  const ninguno = mensajeDe(() => elegirPersona(equipo, 'zzz'))
  ok('nadie: el error lista a todos', /Ana López/.test(ninguno ?? '') && /Maoli Pérez/.test(ninguno ?? ''))
  ok('una lista vacía no rompe el mensaje', /ninguno/.test(mensajeDe(() => elegirPersona([], 'x')) ?? ''))
}

console.log('\n=== textos ===')
{
  ok('normalizar quita acentos y espacios de más', normalizar('  María   Fernanda ') === 'maria fernanda')
  ok('recortar: colapsa espacios y saltos', recortar('hola\n\n  mundo', 50) === 'hola mundo')
  ok('recortar: corta con puntos suspensivos', recortar('a'.repeat(50), 10) === `${'a'.repeat(9)}…`)
  ok('recortar: nada y vacío son null', recortar(null, 10) === null && recortar('   ', 10) === null && recortar(undefined, 10) === null)
  const largo = recortarLargo('x'.repeat(100), 30)
  ok('recortarLargo dice que cortó y cuánto había', largo.recortado && largo.caracteres === 100 && (largo.texto ?? '').length === 30)
  const corto = recortarLargo('hola\r\n\r\n\r\n\r\nadiós', 100)
  ok('recortarLargo conserva los párrafos y limpia lo repetido', !corto.recortado && corto.texto === 'hola\n\nadiós')
  ok('patronDeBusqueda quita lo que rompería el filtro', patronDeBusqueda('a,b%c(d)*"e\'') === '%a b c d e%')
  ok('patronDeBusqueda corta lo larguísimo', patronDeBusqueda('x'.repeat(500)).length === 82)
  ok('fechaHora: hora de Madrid', fechaHora('2026-07-01T08:30:00.000Z') === '2026-07-01 10:30' && fechaHora('2026-01-15T08:30:00.000Z') === '2026-01-15 09:30')
  ok('fechaHora: sin dato o con basura, null', fechaHora(null) === null && fechaHora('no es una fecha') === null)
  ok('aMinutos', aMinutos(90) === 1.5 && aMinutos(0) === 0 && aMinutos(null) === 0)
}

console.log('\n=== una lista que no cabe ===')
{
  const lista = Array.from({ length: 50 }, (_, i) => ({ n: i, texto: 'x'.repeat(200) }))
  const entera = { total: 50, lista }
  ok('si cabe, no se toca', ajustarAlTamano(entera, 'lista', 100_000) === entera)
  const cortada = ajustarAlTamano(entera, 'lista', 5_000) as { total: number; lista: unknown[]; aviso_de_tamano?: string }
  ok('si no cabe, quita del final hasta que quepa y lo dice con cifras', cortada.lista.length < 50 && cortada.lista.length >= 1 && JSON.stringify(cortada, null, 1).length <= 5_000 && /de los 50/.test(cortada.aviso_de_tamano ?? '') && new RegExp(`se enseñan ${cortada.lista.length} de`).test(cortada.aviso_de_tamano ?? ''))
  ok('conserva el principio de la lista y los totales', (cortada.lista[0] as { n: number }).n === 0 && cortada.total === 50)
  ok('no modifica la entrada', lista.length === 50 && !('aviso_de_tamano' in entera))
  const una = ajustarAlTamano({ lista: [{ texto: 'x'.repeat(10_000) }] }, 'lista', 1_000) as { lista: unknown[] }
  ok('aunque un solo elemento no quepa, deja ese (nunca una lista vacía)', una.lista.length === 1)
  ok('una clave que no es una lista, igual', ajustarAlTamano({ lista: 'no' }, 'lista', 10).lista === 'no')
}

console.log('\n=== los errores de la base ===')
{
  ok('una tabla que no existe dice que falta la migración y qué', /migración/.test(mensajeDe(() => fallo({ code: '42P01' }, 'cold_leads')) ?? '') && /cold_leads/.test(mensajeDe(() => fallo({ code: 'PGRST205' }, 'cold_leads')) ?? ''))
  let otro: unknown = null
  try {
    fallo({ code: '57014', message: 'timeout con datos de tablas' }, 'x')
  } catch (e) {
    otro = e
  }
  ok('cualquier otro error se relanza tal cual (no se le cuenta al modelo)', !(otro instanceof ErrorDeHerramienta) && (otro as { code?: string }).code === '57014')
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
