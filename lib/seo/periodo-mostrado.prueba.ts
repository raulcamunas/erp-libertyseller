import { agruparGastoSemanal, domingoDeLaSemana, elegirPeriodo, sinDuplicados } from './periodo-mostrado'
import { enTrozos, leerTodo } from './paginar'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

async function main() {
  console.log('\n=== periodo mostrado ===')
  {
    // Tanda a medias: la semana del 15 ya tiene filas de unos productos, pero la lectura solo dio por buena la del 8
    const r = elegirPeriodo({ periodo: 'WEEK', ok: '2026-11-08', leidos: ['WEEK:2026-11-01', 'MONTH:2026-10-01'], maxDesde: '2026-11-15' })
    ok('semana_ok anterior al máximo (tanda a medias) → se enseña semana_ok', r === '2026-11-08', String(r))
  }
  {
    const r = elegirPeriodo({ periodo: 'WEEK', ok: null, leidos: ['WEEK:2026-10-18', 'MONTH:2026-11-01', 'WEEK:2026-11-01', 'WEEK:2026-10-25'], maxDesde: '2026-11-15' })
    ok('ok null → el último de periodos_leidos de ese periodo (no el del mes)', r === '2026-11-01', String(r))
  }
  {
    const r = elegirPeriodo({ periodo: 'MONTH', ok: null, leidos: undefined, maxDesde: '2026-10-01' })
    ok('sin 299 ni ok → el máximo de la tabla', r === '2026-10-01', String(r))
  }
  {
    const r = elegirPeriodo({ periodo: 'MONTH', ok: null, leidos: ['WEEK:2026-11-01'], maxDesde: '2026-10-01' })
    ok('periodos_leidos sin ninguno de ese periodo → el máximo', r === '2026-10-01', String(r))
  }
  ok('sin filas → null', elegirPeriodo({ periodo: 'WEEK', ok: '2026-11-08', leidos: [], maxDesde: null }) === null)
  ok('ok con formato raro se ignora', elegirPeriodo({ periodo: 'WEEK', ok: 'basura', leidos: [], maxDesde: '2026-11-15' }) === '2026-11-15')

  console.log('\n=== sin duplicados ===')
  {
    const filas = [
      { asin: 'A', consulta: 'x', v: 1 },
      { asin: 'A', consulta: 'y', v: 2 },
      { asin: 'A', consulta: 'x', v: 3 },
      { asin: 'B', consulta: 'x', v: 4 },
    ]
    const r = sinDuplicados(filas, (f) => `${f.asin}|${f.consulta}`)
    ok('quita asin|consulta repetidos y conserva el primero', r.length === 3 && r[0].v === 1 && r[2].v === 4)
  }

  console.log('\n=== semanas de Amazon y gasto ===')
  ok('un sábado es de la semana del domingo anterior', domingoDeLaSemana('2026-11-14') === '2026-11-08')
  ok('un domingo abre su semana', domingoDeLaSemana('2026-11-08') === '2026-11-08')
  ok('un miércoles', domingoDeLaSemana('2026-11-11') === '2026-11-08')
  {
    const r = agruparGastoSemanal(
      [
        { nombre: 'B0GV4FLP99 | SKU1 | Juego | EXACTA', fecha: '2026-11-09', gasto: 10.5 },
        { nombre: 'b0gv4flp99 | SKU1 | Juego | AUTO', fecha: '2026-11-14', gasto: '4.5' },
        { nombre: 'B0GV4FLP99 | SKU1 | Juego | AUTO', fecha: '2026-11-15', gasto: 3 },
        { nombre: 'B0FK5X28D6 | SKU2', fecha: '2026-11-10', gasto: 7 },
        { nombre: 'Campaña sin ASIN', fecha: '2026-11-10', gasto: 99 },
      ],
      ['B0GV4FLP99', 'B0FK5X28D6']
    )
    const de = (a: string, d: string) => r.find((x) => x.asin === a && x.desde === d)?.gasto
    ok('suma por ASIN y semana de domingo a sábado', de('B0GV4FLP99', '2026-11-08') === 15 && de('B0GV4FLP99', '2026-11-15') === 3 && de('B0FK5X28D6', '2026-11-08') === 7, JSON.stringify(r))
    ok('lo que no lleva el ASIN no cuenta', r.length === 3)
  }

  console.log('\n=== leerTodo ===')
  {
    const tabla = Array.from({ length: 2010 }, (_, i) => i)
    let llamadas = 0
    const r = await leerTodo<number>(async (desde, hasta) => {
      llamadas++
      return { data: tabla.slice(desde, hasta + 1), error: null }
    })
    ok('trae las 2.010 filas, no 1.000', r.length === 2010 && r[2009] === 2009 && llamadas === 3, `${r.length} en ${llamadas}`)
  }
  {
    const tabla = Array.from({ length: 2000 }, (_, i) => i)
    let llamadas = 0
    const r = await leerTodo<number>(async (desde, hasta) => {
      llamadas++
      return { data: tabla.slice(desde, hasta + 1), error: null }
    })
    ok('múltiplo exacto de 1000: una página vacía de cierre', r.length === 2000 && llamadas === 3)
  }
  {
    const avisar = console.warn
    let avisado = false
    console.warn = () => {
      avisado = true
    }
    const r = await leerTodo<number>(async () => ({ data: new Array(10).fill(0), error: null }), { tamano: 10, maxPaginas: 3 })
    console.warn = avisar
    ok('con el tope se para y avisa', r.length === 30 && avisado)
  }
  {
    let lanzado = false
    await leerTodo(async () => ({ data: null, error: { code: '42P01' } })).catch(() => (lanzado = true))
    ok('el error de la base se lanza', lanzado)
  }
  ok('enTrozos de 30', enTrozos(Array.from({ length: 61 }, (_, i) => i), 30).map((t) => t.length).join(',') === '30,30,1')

  console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
  process.exit(fallos === 0 ? 0 : 1)
}

void main()
