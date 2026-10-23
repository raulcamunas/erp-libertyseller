import { enDolares, familiaDeModelo, normalizarCostes, resumirGasto, separarConcepto, usoHabitual, type FilaDeCoste } from '@/lib/ia-gasto/resumen'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const cerca = (a: number | null, b: number, tol = 1e-6) => a !== null && Math.abs(a - b) <= tol

const seg = (dia: string) => Date.parse(`${dia}T00:00:00Z`) / 1000

console.log('\n=== leer la respuesta de OpenAI ===')
{
  const cuerpo = {
    object: 'page',
    data: [
      {
        object: 'bucket',
        start_time: seg('2026-10-23'),
        end_time: seg('2026-10-24'),
        results: [
          { object: 'organization.costs.result', amount: { value: 0.1234, currency: 'usd' }, line_item: 'gpt-4o-2024-08-06, input', project_id: 'proj_a', organization_id: 'org-x' },
          { object: 'organization.costs.result', amount: { value: '0.02', currency: 'usd' }, line_item: null, project_id: null },
        ],
      },
    ],
    has_more: true,
    next_page: 'pagina_2',
  }
  const p = normalizarCostes(cuerpo)
  ok('lee las dos filas con su día en UTC', !!p && p.filas.length === 2 && p.filas[0].dia === '2026-10-23' && p.filas[0].concepto === 'gpt-4o-2024-08-06, input' && p.filas[0].proyecto === 'proj_a')
  ok('un importe escrito como texto también se lee', !!p && cerca(p.filas[1].dolares, 0.02) && p.filas[1].concepto === null && p.filas[1].proyecto === null)
  ok('y dice si hay más páginas y cuál es la siguiente', !!p && p.hayMas && p.siguiente === 'pagina_2')
  ok('sin más páginas', normalizarCostes({ data: [], has_more: false, next_page: null })?.hayMas === false)

  ok('algo que no es un objeto -> null', normalizarCostes(null) === null && normalizarCostes('hola') === null && normalizarCostes(7) === null)
  ok('sin `data` o con `data` que no es una lista -> null (no se inventa un gasto cero)', normalizarCostes({}) === null && normalizarCostes({ data: 'x' }) === null && normalizarCostes({ error: { message: 'x' } }) === null)

  const roto = normalizarCostes({
    data: [
      null,
      { start_time: 'no', results: [] },
      { start_time: seg('2026-10-22'), results: 'no' },
      { start_time: seg('2026-10-22'), results: [null, { amount: null }, { amount: { value: 'nada' } }, { amount: { value: 1, currency: 'eur' } }, { amount: { value: 0.5, currency: 'USD' }, line_item: 'x, input' }] },
    ],
  })
  ok('un cubo o una fila rotos se saltan sin tumbar el resto', !!roto && roto.filas.length === 1 && cerca(roto.filas[0].dolares, 0.5))
  ok('una moneda que no son dólares no se suma', !!roto && !roto.filas.some((f) => f.dolares === 1))
  ok('un ajuste en negativo se conserva', cerca(normalizarCostes({ data: [{ start_time: seg('2026-10-22'), results: [{ amount: { value: -0.3, currency: 'usd' } }] }] })?.filas[0].dolares ?? null, -0.3))
}

console.log('\n=== qué es cada concepto ===')
{
  ok('entrada', separarConcepto('gpt-4o-2024-08-06, input').tipo === 'entrada' && separarConcepto('gpt-4o-2024-08-06, input').modelo === 'gpt-4o-2024-08-06')
  ok('salida', separarConcepto('gpt-4o-mini-2024-07-18, output').tipo === 'salida')
  ok('«cached input» es caché y no entrada', separarConcepto('gpt-6-luna, cached input').tipo === 'cache')
  ok('audio', separarConcepto('gpt-4o-transcribe, audio input').tipo === 'audio')
  ok('sin coma: el modelo es todo y el tipo «otro»', separarConcepto('whisper-1').modelo === 'whisper-1' && separarConcepto('whisper-1').tipo === 'otro')
  ok('vacío o nulo: «Sin desglosar»', separarConcepto(null).modelo === 'Sin desglosar' && separarConcepto('  ').modelo === 'Sin desglosar')

  ok('la familia quita la fecha de la versión', familiaDeModelo('gpt-4o-2024-08-06') === 'gpt-4o' && familiaDeModelo('gpt-4o-mini-2024-07-18') === 'gpt-4o-mini' && familiaDeModelo('gpt-5.6-terra-2026-03-01') === 'gpt-5.6-terra')
  ok('y la de cuatro cifras de los modelos viejos', familiaDeModelo('gpt-4-0613') === 'gpt-4' && familiaDeModelo('gpt-6-luna') === 'gpt-6-luna' && familiaDeModelo('whisper-1') === 'whisper-1')

  ok('para qué se usa cada modelo (pista)', usoHabitual('gpt-5.6-terra-2026-03-01') === 'Correo con IA' && usoHabitual('gpt-5.5') === 'Remesas: propuesta con IA' && usoHabitual('gpt-transcribe') === 'Transcripción de las llamadas de Rinkel' && usoHabitual('gpt-6-luna') === 'Resumen de las llamadas de Rinkel' && usoHabitual('whisper-1') === 'Transcripción de las citas')
  ok('gpt-4o y gpt-4o-mini no se confunden', usoHabitual('gpt-4o-2024-08-06') === 'Auditor, listing, marketing, tracker y validador' && usoHabitual('gpt-4o-mini-2024-07-18') === 'Resumen de citas y marketing')
  ok('el transcribe de gpt-4o no cae en el de gpt-4o-mini', usoHabitual('gpt-4o-mini-transcribe') === 'Transcripción de audio')
  ok('lo desconocido: «Otros usos»', usoHabitual('modelo-nuevo') === 'Otros usos')
}

console.log('\n=== el resumen ===')
const fila = (dia: string, dolares: number, concepto: string | null = 'gpt-4o-2024-08-06, input', proyecto: string | null = 'proj_a'): FilaDeCoste => ({ dia, concepto, proyecto, dolares })
const AHORA = Date.parse('2026-10-23T15:00:00Z')
{
  const filas: FilaDeCoste[] = [
    fila('2026-10-23', 0.5), // hoy (a medias)
    fila('2026-10-22', 1.0, 'gpt-4o-2024-08-06, output'),
    fila('2026-10-10', 2.0, 'gpt-5.6-terra, input'),
    fila('2026-10-01', 4.0, 'gpt-4o-2024-11-20, input'),
    fila('2026-09-30', 10),
    fila('2026-09-24', 20), // justo el primer día de los últimos 30
    fila('2026-09-23', 40), // el día anterior: fuera de los 30
    fila('2025-11-05', 100),
    fila('2025-10-31', 1000), // más de doce meses: cuenta en el total pero no sale en la lista de meses
  ]
  const r = resumirGasto(filas, AHORA)
  ok('hoy y ayer', cerca(r.hoy, 0.5) && cerca(r.ayer, 1))
  ok('este mes = octubre entero hasta hoy', cerca(r.esteMes, 7.5))
  ok('mes anterior = septiembre', cerca(r.mesAnterior, 70))
  ok('últimos 30 días: del 24 sep al 23 oct, ambos incluidos', cerca(r.ultimos30, 37.5), String(r.ultimos30))
  ok('total: todo lo leído', cerca(r.total, 1177.5))
  ok('primer y último día', r.primerDia === '2025-10-31' && r.ultimoDia === '2026-10-23')

  ok('30 días de lista, del 24 sep al 23 oct, con ceros', r.dias.length === 30 && r.dias[0].dia === '2026-09-24' && r.dias[29].dia === '2026-10-23' && r.dias[1].dolares === 0 && cerca(r.dias[0].dolares, 20))
  ok('12 meses de lista, de nov 2025 a oct 2026', r.meses.length === 12 && r.meses[0].mes === '2025-11' && r.meses[11].mes === '2026-10' && cerca(r.meses[0].dolares, 100) && cerca(r.meses[10].dolares, 70) && r.meses[5].dolares === 0)

  // Media: 22 días completos de octubre, con 7,0 gastados sin contar hoy
  ok('media diaria = lo gastado sin hoy entre los días completos', cerca(r.mediaDiaria, 7 / 22), String(r.mediaDiaria))
  ok('previsión del mes = media × 31', cerca(r.previsionDelMes, (7 / 22) * 31, 1e-5), String(r.previsionDelMes))

  ok('por modelo: junta las versiones de la misma familia y ordena de más a menos', r.porModelo.length === 2 && r.porModelo[0].modelo === 'gpt-4o' && cerca(r.porModelo[0].dolares, 5.5) && r.porModelo[1].modelo === 'gpt-5.6-terra' && cerca(r.porModelo[1].dolares, 2))
  ok('las partes suman 1 y llevan su uso', cerca(r.porModelo.reduce((s, m) => s + m.parte, 0), 1) && r.porModelo[1].uso === 'Correo con IA')
  ok('con un solo proyecto no hay desglose por proyecto', r.porProyecto.length === 0)
}
{
  const r = resumirGasto([fila('2026-10-02', 1), fila('2026-10-03', 1)], Date.parse('2026-10-03T10:00:00Z'))
  ok('el día 3 todavía no se da media ni previsión (dos días completos no dan para una media)', r.mediaDiaria === null && r.previsionDelMes === null)
  const r4 = resumirGasto([fila('2026-10-02', 1), fila('2026-10-03', 2)], Date.parse('2026-10-04T10:00:00Z'))
  ok('el día 4 sí (tres completos)', cerca(r4.mediaDiaria, 1) && cerca(r4.previsionDelMes, 31))
}
{
  const filas = [fila('2026-10-20', 3, 'gpt-4o, input', 'proj_a'), fila('2026-10-21', 1, 'gpt-4o, input', 'proj_b'), fila('2026-10-21', 0.5, 'gpt-4o, output', 'proj_b')]
  const r = resumirGasto(filas, AHORA, new Map([['proj_a', 'ERP'], ['proj_b', 'Traductor']]))
  ok('con dos proyectos sí se desglosa, con su nombre', r.porProyecto.length === 2 && r.porProyecto[0].id === 'proj_a' && r.porProyecto[0].nombre === 'ERP' && cerca(r.porProyecto[1].dolares, 1.5) && r.porProyecto[1].nombre === 'Traductor')
  const sinNombres = resumirGasto(filas, AHORA)
  ok('y sin nombres se queda el identificador', sinNombres.porProyecto[0].nombre === null)
}
{
  const r = resumirGasto([], AHORA)
  ok('sin datos: todo a cero y sin fechas', r.total === 0 && r.esteMes === 0 && r.primerDia === null && r.ultimoDia === null && r.dias.length === 30 && r.meses.length === 12 && r.porModelo.length === 0)
  const sinConcepto = resumirGasto([fila('2026-10-23', 2, null, null)], AHORA)
  ok('un gasto sin desglosar sale como «Sin desglosar»', sinConcepto.porModelo.length === 1 && sinConcepto.porModelo[0].modelo === 'Sin desglosar' && sinConcepto.porModelo[0].uso === 'Otros usos')
  const enero = resumirGasto([fila('2026-12-31', 1), fila('2027-01-01', 2)], Date.parse('2027-01-01T08:00:00Z'))
  ok('al cambiar de año el mes anterior es diciembre', cerca(enero.mesAnterior, 1) && cerca(enero.esteMes, 2) && enero.meses[11].mes === '2027-01' && enero.meses[10].mes === '2026-12')
}

console.log('\n=== el dinero en pantalla ===')
{
  ok('con céntimos', enDolares(12.345) === '12,35 $' || enDolares(12.345) === '12,34 $', enDolares(12.345))
  ok('cero', enDolares(0) === '0,00 $')
  ok('pequeño: más decimales', enDolares(0.0345) === '0,035 $' || enDolares(0.0345) === '0,034 $', enDolares(0.0345))
  ok('minúsculo', enDolares(0.00034) === '0,0003 $')
  ok('negativo con el signo bien puesto', enDolares(-1.5) === '−1,50 $')
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
