import { citasEntre, citasPorId } from './consulta'
import { COLUMNAS_AGENDA, COLUMNAS_AGENDA_CON_TIENDA } from '@/lib/types/appointments'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

type Respuesta = { data?: unknown[]; error?: { code: string; message?: string } | null }
interface Llamada {
  tabla: string
  select?: string
  filtros: Array<[string, ...unknown[]]>
  orden: string[]
  rango?: [number, number]
}

/** Un Supabase de mentira: contesta lo que se le diga, en orden, y apunta cómo se le ha preguntado */
function falso(respuestas: Respuesta[]) {
  const llamadas: Llamada[] = []
  const cliente = {
    from(tabla: string) {
      const llamada: Llamada = { tabla, filtros: [], orden: [] }
      llamadas.push(llamada)
      const b: any = {
        select(c: string) { llamada.select = c; return b },
        gte(...a: unknown[]) { llamada.filtros.push(['gte', ...a]); return b },
        lt(...a: unknown[]) { llamada.filtros.push(['lt', ...a]); return b },
        in(...a: unknown[]) { llamada.filtros.push(['in', ...a]); return b },
        order(c: string) { llamada.orden.push(c); return b },
        range(a: number, z: number) { llamada.rango = [a, z]; return b },
        then(ok2: (v: unknown) => unknown, ko: (e: unknown) => unknown) {
          const r = respuestas.shift() ?? { data: [] }
          return Promise.resolve({ data: r.data ?? null, error: r.error ?? null }).then(ok2, ko)
        },
      }
      return b
    },
  }
  return { cliente: cliente as any, llamadas }
}

const filas = (n: number, desde = 0) => Array.from({ length: n }, (_, i) => ({ id: `c${desde + i}`, start_time: '2026-10-28T09:00:00Z' }))

async function main() {
  console.log('\n=== una semana, una consulta ===')
  {
    const { cliente, llamadas } = falso([{ data: filas(3) }])
    const r = await citasEntre(cliente, '2026-10-25T23:00:00.000Z', '2026-11-01T23:00:00.000Z')
    ok('devuelve las tres citas', r.error === null && r.citas.length === 3)
    ok('una sola petición', llamadas.length === 1)
    const l = llamadas[0]
    ok('a la tabla de citas', l.tabla === 'appointments')
    ok('desde entra (>=) y hasta no (<), sobre el inicio de la cita', JSON.stringify(l.filtros) === JSON.stringify([['gte', 'start_time', '2026-10-25T23:00:00.000Z'], ['lt', 'start_time', '2026-11-01T23:00:00.000Z']]), JSON.stringify(l.filtros))
    ok('ordena por inicio y desempata por id', l.orden.join() === 'start_time,id')
    ok('pide el primer tramo de mil', l.rango?.join() === '0,999')
    ok('con las columnas de la agenda de siempre (más las de la 214)', l.select === COLUMNAS_AGENDA_CON_TIENDA)
  }

  console.log('\n=== más de mil: se pide por tramos y no se pierde ninguna ===')
  {
    const { cliente, llamadas } = falso([{ data: filas(1000, 0) }, { data: filas(5, 1000) }])
    const r = await citasEntre(cliente, 'a', 'b')
    ok('1.005 citas', r.error === null && r.citas.length === 1005, String(r.citas.length))
    ok('dos peticiones', llamadas.length === 2)
    ok('el segundo tramo empieza donde acabó el primero', llamadas[1].rango?.join() === '1000,1999')
    ok('sin repetir ni saltar ninguna', new Set(r.citas.map((c) => c.id)).size === 1005)
  }
  {
    const { cliente, llamadas } = falso([{ data: filas(1000) }, { data: [] }])
    const r = await citasEntre(cliente, 'a', 'b')
    ok('justo mil: pregunta una vez más y para al ver que no hay más', r.citas.length === 1000 && llamadas.length === 2)
  }
  {
    const { cliente } = falso([{ data: [] }])
    const r = await citasEntre(cliente, 'a', 'b')
    ok('una semana sin citas es una lista vacía y no un error', r.error === null && r.citas.length === 0)
  }

  console.log('\n=== la migración 214 aún no está lanzada ===')
  {
    const { cliente, llamadas } = falso([{ error: { code: '42703' } }, { data: filas(2) }])
    const r = await citasEntre(cliente, 'a', 'b')
    ok('repite sin las columnas nuevas y devuelve las citas (la agenda no se queda en blanco)', r.error === null && r.citas.length === 2)
    ok('la primera pedía las de la 214 y la repetición no', llamadas[0].select === COLUMNAS_AGENDA_CON_TIENDA && llamadas[1].select === COLUMNAS_AGENDA)
    ok('la repetición es el MISMO tramo, no el siguiente', llamadas[1].rango?.join() === '0,999')
  }
  {
    const { cliente } = falso([{ error: { code: 'PGRST204' } }, { data: filas(1) }])
    ok('PGRST204 (la caché de PostgREST) cuenta igual', (await citasEntre(cliente, 'a', 'b')).citas.length === 1)
  }
  {
    const { cliente, llamadas } = falso([{ error: { code: 'PGRST204' } }, { data: filas(1000) }, { data: filas(1, 1000) }])
    const r = await citasEntre(cliente, 'a', 'b')
    ok('lo aprendido vale para los demás tramos: no vuelve a probar con la 214', r.citas.length === 1001 && llamadas[2].select === COLUMNAS_AGENDA, llamadas.map((l) => l.select === COLUMNAS_AGENDA ? 'sin' : 'con').join())
  }

  console.log('\n=== un error de verdad no se disfraza ===')
  {
    const { cliente, llamadas } = falso([{ error: { code: '57014', message: 'timeout' } }])
    const r = await citasEntre(cliente, 'a', 'b')
    ok('devuelve el error y NINGUNA cita', r.error !== null && r.citas.length === 0)
    ok('un timeout no se confunde con «faltan columnas»: no repite', llamadas.length === 1)
  }
  {
    const { cliente } = falso([{ data: filas(1000) }, { error: { code: '57014' } }])
    const r = await citasEntre(cliente, 'a', 'b')
    ok('si falla el segundo tramo no se entrega el primero a medias', r.error !== null && r.citas.length === 0)
  }
  {
    const { cliente } = falso([{ error: { code: '42703' } }, { error: { code: '57014' } }])
    const r = await citasEntre(cliente, 'a', 'b')
    ok('si la repetición sin la 214 también falla, ese error sale', r.error !== null && (r.error as { code: string }).code === '57014')
  }

  console.log('\n=== citas por id (lo que avisa el tiempo real) ===')
  {
    const { cliente, llamadas } = falso([{ data: filas(2) }])
    const r = await citasPorId(cliente, ['c0', 'c1', 'c0'])
    ok('una consulta para todas', llamadas.length === 1 && r.citas.length === 2)
    ok('con los ids sin repetir', JSON.stringify(llamadas[0].filtros) === JSON.stringify([['in', 'id', ['c0', 'c1']]]), JSON.stringify(llamadas[0].filtros))
  }
  {
    const { cliente, llamadas } = falso([])
    const r = await citasPorId(cliente, [])
    ok('sin ids no hay consulta', llamadas.length === 0 && r.error === null && r.citas.length === 0)
  }
  {
    const ids = Array.from({ length: 450 }, (_, i) => `x${i}`)
    const { cliente, llamadas } = falso([{ data: filas(1) }, { data: filas(1, 1) }, { data: filas(1, 2) }])
    const r = await citasPorId(cliente, ids)
    ok('450 ids se piden en tandas de 200 (tres consultas) y se juntan', llamadas.length === 3 && r.citas.length === 3)
  }
  {
    const { cliente } = falso([{ error: { code: '57014' } }])
    const r = await citasPorId(cliente, ['a'])
    ok('un fallo devuelve el error y ninguna cita', r.error !== null && r.citas.length === 0)
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main()
