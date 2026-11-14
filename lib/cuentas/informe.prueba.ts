import { claseDeLog, claseDePropuesta, correoDelInformeHtml, etiquetaDeVeredicto, lecturaDeRespaldo, pct, periodos, resumirEjecutado, tipoDeSemana, vocabularioInterno, type DatosDelInforme } from './informe'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** EL INFORME AL CLIENTE: periodos, lo ejecutado en lenguaje de cliente, etiquetas y reglas de texto */

console.log('\n=== periodos ===')
const p = periodos('2026-11-08', 14)
ok('14 días hasta el domingo y los 14 de antes', p.desde === '2026-10-26' && p.anterior.desde === '2026-10-12' && p.anterior.hasta === '2026-10-25', JSON.stringify(p))
ok('la semana del ciclo da el tipo de informe', tipoDeSemana(1) === 'semanal' && tipoDeSemana(2) === 'quincenal' && tipoDeSemana(3) === 'semanal' && tipoDeSemana(4) === 'mensual')

console.log('\n=== lo ejecutado ===')
ok('una puja que baja es «puja-baja»', claseDePropuesta({ tipo: 'puja', valorActual: 0.8, valorNuevo: 0.6 }) === 'puja-baja')
ok('un presupuesto que sube es «presupuesto-sube»', claseDePropuesta({ tipo: 'presupuesto', valorActual: 10, valorNuevo: 12 }) === 'presupuesto-sube')
ok('el log con coma decimal también', claseDeLog({ accion: 'cambiar', campo: 'puja de «jamon»', valorAnterior: '0,80', valorNuevo: '0,60' }) === 'puja-baja')
ok('cambiar el modo del motor NO es un cambio en la cuenta', claseDeLog({ accion: 'cambiar', campo: 'modo del motor automático', valorAnterior: null, valorNuevo: 'sugiere' }) === null)
const r = resumirEjecutado([{ clase: 'puja-sube' }, { clase: 'negativizar' }, { clase: 'negativizar' }, { clase: 'raro' }])
ok('agrupa, ordena (exclusiones primero) y cuenta', r[0].accion === 'Búsquedas excluidas' && r[0].cantidad === 2 && r.at(-1)!.accion.startsWith('Otros'), JSON.stringify(r))
ok('ningún texto de lo ejecutado usa vocabulario interno', r.every((x) => vocabularioInterno(`${x.accion} ${x.criterio}`).length === 0))

console.log('\n=== búsquedas ===')
ok('líder → consulta ganada', etiquetaDeVeredicto({ tipo: 'lider' }) === 'Consulta ganada')
ok('se cae en los clics → no nos eligen', etiquetaDeVeredicto({ tipo: 'fuga', etapa: 'clics' }) === 'No nos eligen')
ok('se cae en la compra → entran y no compran', etiquetaDeVeredicto({ tipo: 'fuga', etapa: 'compra' }) === 'Entran y no compran')
ok('ruido u otro precio no se enseñan', etiquetaDeVeredicto({ tipo: 'ruido' }) === null && etiquetaDeVeredicto({ tipo: 'otro-precio' }) === null)

console.log('\n=== reglas de texto ===')
ok('detecta palabras internas', vocabularioInterno('En la S2 hemos negativizado 12 términos según el SOP').length === 3)
ok('un texto normal pasa', vocabularioInterno('Hemos excluido 12 búsquedas que gastaban sin vender.').length === 0)
ok('«login» o «blog» no cuentan como «log»', vocabularioInterno('El blog del cliente y su login').length === 0)
ok('porcentaje diminuto no se pinta como 0,0 %', pct(0.0002) === '<0,1 %' && pct(0) === '0,0 %' && pct(0.353) === '35,3 %', `${pct(0.0002)} ${pct(0)} ${pct(0.353)}`)

const d = { version: 1, cliente: 'X', tipo: 'semanal', desde: '2026-11-02', hasta: '2026-11-08', dias: 7, anterior: { desde: '2026-10-26', hasta: '2026-11-01' }, moneda: 'EUR', total: { gasto: 100, ventas: 400, pedidos: 10, clics: 200, impresiones: 9000 }, totalAnterior: { gasto: 100, ventas: 320, pedidos: 8, clics: 210, impresiones: 9000 }, ventasTotales: 2000, ventasTotalesNota: null, paises: [], productos: [], diario: [], ejecutado: [], visibilidad: null, visibilidadNota: null, salud: null, generadoAt: '2026-11-09T08:00:00Z' } as DatosDelInforme
const l = lecturaDeRespaldo(d)
ok('la lectura de respaldo da cifras y no promete', l.includes('400') && l.includes('suben un 25 %') && vocabularioInterno(l).length === 0, l)
const html = correoDelInformeHtml({ cliente: 'A<b>', tipo: 'semanal', desde: '2026-11-02', hasta: '2026-11-08', saludo: 'Hola, Ana:', lectura: 'uno\n\ndos', url: 'https://x/informe/abc', firma: 'Patricia' })
ok('el correo escapa el HTML y lleva el botón al informe', html.includes('A&lt;b&gt;') && html.includes('href="https://x/informe/abc"') && (html.match(/<p style="margin:0 0 14px;font-size:15px;line-height/g) ?? []).length === 2)

console.log(fallos ? `\n${fallos} FALLOS\n` : '\nTodo bien\n')
if (fallos) process.exit(1)
