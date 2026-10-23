import { enDolares, familiaDeModelo, identificarClaveDelErp, normalizarCostes, resumirGasto, separarConcepto, usoHabitual, type ClaveDeApi, type FilaDeCoste } from '@/lib/ia-gasto/resumen'

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
          { object: 'organization.costs.result', amount: { value: 0.1234, currency: 'usd' }, line_item: 'gpt-4o-2024-08-06, input', project_id: 'proj_a', api_key_id: 'key_erp', organization_id: 'org-x' },
          { object: 'organization.costs.result', amount: { value: '0.02', currency: 'usd' }, line_item: null, project_id: null },
        ],
      },
    ],
    has_more: true,
    next_page: 'pagina_2',
  }
  const p = normalizarCostes(cuerpo)
  ok('lee las dos filas con su día en UTC, su proyecto y su clave de API', !!p && p.filas.length === 2 && p.filas[0].dia === '2026-10-23' && p.filas[0].concepto === 'gpt-4o-2024-08-06, input' && p.filas[0].proyecto === 'proj_a' && p.filas[0].clave === 'key_erp')
  ok('un importe escrito como texto también se lee', !!p && cerca(p.filas[1].dolares, 0.02) && p.filas[1].concepto === null && p.filas[1].proyecto === null && p.filas[1].clave === null)
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
  ok('«cache writes» de verdad y «cache writes - 12hr»: son del modelo y de tipo «otro»', separarConcepto('gpt-5.6-terra, cache writes').modelo === 'gpt-5.6-terra' && separarConcepto('gpt-6-luna, cache writes - 12hr').modelo === 'gpt-6-luna')
  ok('sin coma: el modelo es todo y el tipo «otro»', separarConcepto('whisper-1').modelo === 'whisper-1' && separarConcepto('whisper-1').tipo === 'otro')
  ok('vacío o nulo: «Sin desglosar»', separarConcepto(null).modelo === 'Sin desglosar' && separarConcepto('  ').modelo === 'Sin desglosar')

  ok('la familia quita la fecha de la versión', familiaDeModelo('gpt-4o-2024-08-06') === 'gpt-4o' && familiaDeModelo('gpt-4o-mini-2024-07-18') === 'gpt-4o-mini' && familiaDeModelo('gpt-5.6-terra-2026-03-01') === 'gpt-5.6-terra')
  ok('«gpt-4o-mini-transcribe-2025-12-15 audio» (así lo llama OpenAI de verdad) es la familia gpt-4o-mini-transcribe', familiaDeModelo('gpt-4o-mini-transcribe-2025-12-15 audio') === 'gpt-4o-mini-transcribe' && familiaDeModelo('gpt-4o-mini-transcribe-2025-12-15 text') === 'gpt-4o-mini-transcribe')
  ok('y la de cuatro cifras de los modelos viejos', familiaDeModelo('gpt-4-0613') === 'gpt-4' && familiaDeModelo('gpt-6-luna') === 'gpt-6-luna' && familiaDeModelo('whisper-1') === 'whisper-1')

  ok('para qué se usa cada modelo (pista)', usoHabitual('gpt-5.6-terra-2026-03-01') === 'Correo con IA' && usoHabitual('gpt-5.5') === 'Remesas: propuesta con IA' && usoHabitual('gpt-transcribe') === 'Transcripción de las llamadas de Rinkel' && usoHabitual('gpt-6-luna') === 'Resumen de las llamadas de Rinkel' && usoHabitual('whisper-1') === 'Transcripción de las citas')
  ok('gpt-4o y gpt-4o-mini no se confunden', usoHabitual('gpt-4o-2024-08-06') === 'Auditor, listing, marketing, tracker y validador' && usoHabitual('gpt-4o-mini-2024-07-18') === 'Resumen de citas y marketing')
  ok('el transcribe de gpt-4o no cae en el de gpt-4o-mini', usoHabitual('gpt-4o-mini-transcribe') === 'Transcripción de audio')
  ok('lo desconocido: «Otros usos»', usoHabitual('modelo-nuevo') === 'Otros usos')
}

console.log('\n=== el resumen ===')
const fila = (dia: string, dolares: number, concepto: string | null = 'gpt-4o-2024-08-06, input', proyecto: string | null = 'proj_a', clave: string | null = null): FilaDeCoste => ({ dia, concepto, proyecto, clave, dolares })
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
  ok('previsión del mes = lo gastado hasta hoy + la media × los 8 días que quedan (nunca menos de lo que ya hay)', cerca(r.previsionDelMes, 7.5 + (7 / 22) * 8, 1e-5) && (r.previsionDelMes ?? 0) >= r.esteMes, String(r.previsionDelMes))

  ok('por modelo: junta las versiones de la misma familia y ordena de más a menos', r.porModelo.length === 2 && r.porModelo[0].modelo === 'gpt-4o' && cerca(r.porModelo[0].dolares, 5.5) && r.porModelo[1].modelo === 'gpt-5.6-terra' && cerca(r.porModelo[1].dolares, 2))
  ok('las partes suman 1 y llevan su uso', cerca(r.porModelo.reduce((s, m) => s + m.parte, 0), 1) && r.porModelo[1].uso === 'Correo con IA')
  ok('con un solo proyecto no hay desglose por proyecto', r.porProyecto.length === 0)
}
{
  const r = resumirGasto([fila('2026-10-02', 1), fila('2026-10-03', 1)], Date.parse('2026-10-03T10:00:00Z'))
  ok('el día 3 todavía no se da media ni previsión (dos días completos no dan para una media)', r.mediaDiaria === null && r.previsionDelMes === null)
  const r4 = resumirGasto([fila('2026-10-02', 1), fila('2026-10-03', 2)], Date.parse('2026-10-04T10:00:00Z'))
  ok('el día 4 sí (tres completos): 3 gastados + 1 al día × los 27 que quedan', cerca(r4.mediaDiaria, 1) && cerca(r4.previsionDelMes, 30))
}
{
  const filas = [fila('2026-10-20', 3, 'gpt-4o, input', 'proj_a'), fila('2026-10-21', 1, 'gpt-4o, input', 'proj_b'), fila('2026-10-21', 0.5, 'gpt-4o, output', 'proj_b')]
  const r = resumirGasto(filas, AHORA, { proyectos: new Map([['proj_a', 'ERP'], ['proj_b', 'Traductor']]) })
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

console.log('\n=== la clave del ERP ===')
{
  const claves: ClaveDeApi[] = [
    { id: 'key_1', nombre: 'libertyupgrowthautomations', terminaEn: 'o2YA', proyecto: 'p' },
    { id: 'key_2', nombre: 'LibertyERP', terminaEn: 'rlkA', proyecto: 'p' },
    { id: 'key_3', nombre: 'n8n', terminaEn: 'AoAA', proyecto: 'p' },
  ]
  ok('se reconoce por cómo termina la OPENAI_API_KEY del servidor', identificarClaveDelErp(claves, 'sk-proj-xxxxxxxxxxxxrlkA') === 'key_2')
  ok('aunque el nombre no diga «erp»', identificarClaveDelErp([{ id: 'k', nombre: 'produccion', terminaEn: 'rlkA', proyecto: null }, { id: 'j', nombre: 'otra', terminaEn: 'zzzz', proyecto: null }], 'sk-xxxxxxxxxxrlkA') === 'k')
  ok('sin clave del servidor, por el nombre (si hay una sola con «erp»)', identificarClaveDelErp(claves, undefined) === 'key_2' && identificarClaveDelErp(claves, '') === 'key_2')
  ok('si el final coincide con dos, desempata el nombre', identificarClaveDelErp([{ id: 'a', nombre: 'n8n', terminaEn: 'rlkA', proyecto: null }, { id: 'b', nombre: 'ERP nuevo', terminaEn: 'rlkA', proyecto: null }], 'sk-xxxxxxxxxxrlkA') === 'b')
  ok('si no hay forma de saberlo: null (no se atribuye al ERP lo de otro)', identificarClaveDelErp([{ id: 'a', nombre: 'n8n', terminaEn: 'AoAA', proyecto: null }, { id: 'b', nombre: 'web', terminaEn: 'o2YA', proyecto: null }], 'sk-xxxxxxxxxxrlkA') === null && identificarClaveDelErp([], 'sk-xxxxxxxxxxrlkA') === null)
  ok('dos que se llaman «erp» y ninguna coincide por el final: null', identificarClaveDelErp([{ id: 'a', nombre: 'erp1', terminaEn: 'aaaa', proyecto: null }, { id: 'b', nombre: 'erp2', terminaEn: 'bbbb', proyecto: null }], undefined) === null)
}

console.log('\n=== una previsión que no se queda por debajo de lo gastado ===')
{
  // Como el 23 oct 2026: 2,82 $ en el mes y 1,18 $ de ellos hoy (pruebas)
  const filas = [fila('2026-10-23', 1.18), fila('2026-10-22', 0.24), fila('2026-10-20', 1.4)]
  const r = resumirGasto(filas, AHORA)
  ok('con casi todo el gasto en el día de hoy, la previsión sigue siendo mayor que lo gastado', (r.previsionDelMes ?? 0) > r.esteMes && cerca(r.esteMes, 2.82), `${r.previsionDelMes} frente a ${r.esteMes}`)
}

console.log('\n=== lo del ERP frente a toda la cuenta ===')
{
  const claves: ClaveDeApi[] = [
    { id: 'key_erp', nombre: 'LibertyERP', terminaEn: 'rlkA', proyecto: 'p' },
    { id: 'key_n8n', nombre: 'n8n', terminaEn: 'AoAA', proyecto: 'p' },
  ]
  const filas: FilaDeCoste[] = [
    fila('2026-10-23', 1, 'gpt-5.5-2026-04-23, output', 'p', 'key_erp'),
    fila('2026-10-22', 2, 'gpt-5.6-terra, input', 'p', 'key_erp'),
    fila('2026-10-22', 10, 'gpt-4.1-2025-04-14, input', 'p', 'key_n8n'),
    fila('2026-09-15', 4, 'gpt-4.1-2025-04-14, output', 'p', 'key_n8n'),
    fila('2026-09-15', 0.5, 'gpt-5.5-2026-04-23, input', 'p', 'key_erp'),
    fila('2026-08-01', 7, 'gpt-4.1-2025-04-14, input', 'p', 'key_borrada'),
    fila('2026-08-02', 1, 'gpt-4o, input', 'p', null),
  ]
  const r = resumirGasto(filas, AHORA, { claves, claveDelErp: 'key_erp' })
  ok('las cifras de arriba son SOLO las de la clave del ERP', r.alcance.tipo === 'erp' && r.alcance.nombre === 'LibertyERP' && cerca(r.hoy, 1) && cerca(r.ayer, 2) && cerca(r.esteMes, 3) && cerca(r.mesAnterior, 0.5) && cerca(r.total, 3.5))
  ok('el desglose por modelo también es solo del ERP', r.porModelo.map((m) => m.modelo).join() === 'gpt-5.6-terra,gpt-5.5' && !r.porModelo.some((m) => m.modelo === 'gpt-4.1'))
  ok('los meses y los días también', cerca(r.meses[11].dolares, 3) && cerca(r.meses[10].dolares, 0.5) && cerca(r.dias[29].dolares, 1))
  ok('toda la cuenta suma todo, de todas las claves', cerca(r.cuenta.esteMes, 13) && cerca(r.cuenta.mesAnterior, 4.5) && cerca(r.cuenta.total, 25.5) && cerca(r.cuenta.ultimos30, 13), JSON.stringify(r.cuenta))
  ok('por clave: ordenadas de más a menos, con su nombre y marcando la del ERP', r.porClave.map((k) => k.nombre).join() === 'n8n,Clave borrada,LibertyERP,Sin clave' && r.porClave[2].esErp && !r.porClave[0].esErp)
  ok('y cada una con lo de este mes y el total', cerca(r.porClave[0].esteMes, 10) && cerca(r.porClave[0].total, 14) && cerca(r.porClave[2].esteMes, 3) && cerca(r.porClave[2].total, 3.5) && cerca(r.porClave[1].total, 7))

  const sinErp = resumirGasto(filas, AHORA, { claves, claveDelErp: null })
  ok('sin clave del ERP identificada: las cifras son las de toda la cuenta y lo dice', sinErp.alcance.tipo === 'cuenta' && sinErp.alcance.nombre === 'Toda la cuenta de OpenAI' && cerca(sinErp.esteMes, 13) && cerca(sinErp.total, 25.5) && sinErp.porClave.every((k) => !k.esErp))
  const sinClaves = resumirGasto([fila('2026-10-23', 2), fila('2026-10-22', 1)], AHORA, { claves, claveDelErp: 'key_erp' })
  ok('si OpenAI no atribuyó ninguna fila a una clave no hay nada que separar: toda la cuenta', sinClaves.alcance.tipo === 'cuenta' && cerca(sinClaves.esteMes, 3))
  const claveSinGasto = resumirGasto([fila('2026-10-23', 2, 'x, input', 'p', 'key_n8n')], AHORA, { claves, claveDelErp: 'key_erp' })
  ok('la clave del ERP sin gasto: todo a cero y la cuenta sigue contando lo de las demás', claveSinGasto.alcance.tipo === 'erp' && claveSinGasto.esteMes === 0 && claveSinGasto.total === 0 && cerca(claveSinGasto.cuenta.esteMes, 2) && claveSinGasto.porModelo.length === 0)
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
