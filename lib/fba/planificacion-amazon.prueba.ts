import { AVISO_PLANIFICACION_TARDA, anotarPlanificacion, esperarPlanificacion, guardarPlanificacion, type LecturaPlanificacion, type ResultadoPlanificacion } from '@/lib/fba/planificacion-amazon'
import { edadVacia, type FilaPlanificacion } from '@/lib/fba/planificacion'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * GUARDAR LA ANTIGÜEDAD DE AMAZON, Y NO ROMPER NADA SI NO PUEDE.
 *
 * Un cliente falso de la base que apunta lo que se le pide y contesta lo que se le diga. Lo que
 * importa aquí: que la falta de la migración 231 no sea un error, que cualquier otro fallo sí lo
 * sea, y que una lectura lenta no deje colgada a la pasada nocturna.
 */

interface Llamada {
  tabla: string
  operacion: 'upsert' | 'delete'
  filas?: Array<Record<string, unknown>>
  opciones?: unknown
  filtros: Array<[string, string, unknown]>
}

/** `errores`: tabla.operación → error que devuelve */
function baseFalsa(errores: Record<string, { code: string; message: string }> = {}) {
  const llamadas: Llamada[] = []
  const cliente = {
    from: (tabla: string) => ({
      upsert: (filas: Array<Record<string, unknown>> | Record<string, unknown>, opciones?: unknown) => {
        llamadas.push({ tabla, operacion: 'upsert', filas: Array.isArray(filas) ? filas : [filas], opciones, filtros: [] })
        return Promise.resolve({ error: errores[`${tabla}.upsert`] ?? null })
      },
      delete: () => {
        const llamada: Llamada = { tabla, operacion: 'delete', filtros: [] }
        llamadas.push(llamada)
        const cadena = {
          eq: (c: string, v: unknown) => (llamada.filtros.push([c, 'eq', v]), cadena),
          lt: (c: string, v: unknown) => {
            llamada.filtros.push([c, 'lt', v])
            return Promise.resolve({ error: errores[`${tabla}.delete`] ?? null })
          },
        }
        return cadena
      },
    }),
  }
  return { cliente: cliente as unknown as Parameters<typeof guardarPlanificacion>[0], llamadas }
}

const fila = (sku: string, sobre: Partial<FilaPlanificacion> = {}): FilaPlanificacion => ({
  sku,
  fnsku: null,
  asin: null,
  disponible: 3,
  noVendible: 0,
  edad: { ...edadVacia(), a0: 2, a91: 1 },
  costeMes: 0.09,
  recargo: edadVacia(),
  moneda: 'EUR',
  diasSuministro: 152,
  accion: null,
  ...sobre,
})

const lectura = (filas: FilaPlanificacion[], sobre: Partial<LecturaPlanificacion> = {}): LecturaPlanificacion => ({
  reportId: '123456',
  vacia: false,
  filas,
  fecha: '2026-10-18',
  columnasEdad: [],
  aproximada: false,
  descartadas: 0,
  columnas: [],
  ...sobre,
})

const SIN_TABLA = { code: '42P01', message: 'relation "public.fba_planificacion" does not exist' }

async function main() {
  console.log('\n=== guardar la antigüedad ===')
  {
    const { cliente, llamadas } = baseFalsa()
    const r = await guardarPlanificacion(cliente, { conexion: 'c1', mercado: 'ES', lectura: lectura([fila('A'), fila('B')]) })
    ok('guarda las dos referencias', r.guardado && r.guardadas === 2 && r.aviso === null)
    const sube = llamadas.find((l) => l.tabla === 'fba_planificacion' && l.operacion === 'upsert')!
    ok('con su clave: conexión, mercado y SKU', JSON.stringify(sube.opciones) === JSON.stringify({ onConflict: 'connection_id,marketplace_id,sku' }))
    const f = sube.filas![0]
    ok('cada fila lleva lo que se lee: unidades por tramo, coste, moneda y el informe', f.connection_id === 'c1' && f.marketplace_id === 'ES' && f.sku === 'A' && JSON.stringify(f.edad) === JSON.stringify({ ...edadVacia(), a0: 2, a91: 1 }) && f.coste_mes === 0.09 && f.moneda === 'EUR' && f.informe === '123456' && f.fecha_foto === '2026-10-18')
    const limpia = llamadas.find((l) => l.tabla === 'fba_planificacion' && l.operacion === 'delete')!
    ok('después quita lo que ya no sale en el informe: lo anterior a esta lectura, de esa cuenta y ese mercado', limpia.filtros.some(([c, o, v]) => c === 'connection_id' && o === 'eq' && v === 'c1') && limpia.filtros.some(([c, o, v]) => c === 'marketplace_id' && o === 'eq' && v === 'ES') && limpia.filtros.some(([c, o, v]) => c === 'updated_at' && o === 'lt' && v === f.updated_at))
    const anota = llamadas.find((l) => l.tabla === 'fba_lecturas')!
    ok('y deja dicho en fba_lecturas que se leyó bien, sin error', anota.filas![0].planificacion_error === null && anota.filas![0].planificacion_informe === '123456' && typeof anota.filas![0].planificacion_at === 'string')
  }

  {
    const filas = Array.from({ length: 1201 }, (_, i) => fila(`S${i}`))
    const { cliente, llamadas } = baseFalsa()
    const r = await guardarPlanificacion(cliente, { conexion: 'c1', mercado: 'ES', lectura: lectura(filas) })
    const subidas = llamadas.filter((l) => l.tabla === 'fba_planificacion' && l.operacion === 'upsert')
    ok('sube de 500 en 500: un insert enorme se pasa de lo que aguanta la base y falla sin decir por qué', subidas.map((s) => s.filas!.length).join() === '500,500,201' && r.guardadas === 1201)
  }

  console.log('\n=== sin la migración 231 ===')
  {
    const { cliente } = baseFalsa({ 'fba_planificacion.upsert': SIN_TABLA })
    const r = await guardarPlanificacion(cliente, { conexion: 'c1', mercado: 'ES', lectura: lectura([fila('A')]) })
    ok('que falte la tabla no es un error: no se guarda y se dice por qué', !r.guardado && r.guardadas === 0 && /migración 231/.test(r.aviso ?? ''))
  }
  {
    const { cliente } = baseFalsa({ 'fba_planificacion.upsert': { code: 'PGRST205', message: 'not found in schema cache' } })
    const r = await guardarPlanificacion(cliente, { conexion: 'c1', mercado: 'ES', lectura: lectura([fila('A')]) })
    ok('PostgREST lo dice con otro código y es lo mismo', !r.guardado && /migración 231/.test(r.aviso ?? ''))
  }
  {
    const { cliente } = baseFalsa({ 'fba_planificacion.delete': SIN_TABLA })
    const r = await guardarPlanificacion(cliente, { conexion: 'c1', mercado: 'ES', lectura: lectura([], { vacia: true }) })
    ok('un informe vacío también descubre que falta la tabla, y no se cuenta como guardado', !r.guardado && /migración 231/.test(r.aviso ?? ''))
  }
  {
    const { cliente } = baseFalsa({ 'fba_planificacion.upsert': { code: '42501', message: 'permission denied' } })
    let lanzo = ''
    try {
      await guardarPlanificacion(cliente, { conexion: 'c1', mercado: 'ES', lectura: lectura([fila('A')]) })
    } catch (e) {
      lanzo = (e as { message?: string }).message ?? 'sí'
    }
    ok('cualquier otro fallo —un permiso, por ejemplo— NO se tapa: se lanza', lanzo === 'permission denied', lanzo)
  }

  console.log('\n=== un informe vacío ===')
  {
    const { cliente, llamadas } = baseFalsa()
    const r = await guardarPlanificacion(cliente, { conexion: 'c1', mercado: 'ES', lectura: lectura([], { vacia: true }) })
    ok('Amazon cancela el informe cuando no hay inventario: se limpia lo anterior y no se sube nada', r.guardado && r.guardadas === 0 && !llamadas.some((l) => l.tabla === 'fba_planificacion' && l.operacion === 'upsert') && llamadas.some((l) => l.tabla === 'fba_planificacion' && l.operacion === 'delete'))
  }
  {
    const { cliente } = baseFalsa()
    const r = await guardarPlanificacion(cliente, { conexion: 'c1', mercado: 'ES', lectura: lectura([fila('A')], { aproximada: true }) })
    ok('un informe con tramos de otro mercado se guarda y avisa de que es aproximado', r.guardado && /aproximado/.test(r.aviso ?? ''))
  }

  console.log('\n=== dejar dicho por qué falló ===')
  {
    const { cliente, llamadas } = baseFalsa()
    await anotarPlanificacion(cliente, { conexion: 'c1', mercado: 'ES', error: 'El informe no trae las columnas esperadas' })
    const f = llamadas[0].filas![0]
    ok('el error queda en fba_lecturas, sin tocar lo del libro mayor', llamadas[0].tabla === 'fba_lecturas' && f.planificacion_error === 'El informe no trae las columnas esperadas' && !('leido_hasta' in f) && !('ultimo_error' in f))
  }
  {
    const { cliente } = baseFalsa({ 'fba_lecturas.upsert': { code: '42703', message: 'column "planificacion_at" does not exist' } })
    let lanzo = false
    try {
      await anotarPlanificacion(cliente, { conexion: 'c1', mercado: 'ES', error: 'x' })
    } catch {
      lanzo = true
    }
    ok('si las columnas no existen todavía (la misma migración), no lanza', !lanzo)
  }

  console.log('\n=== no esperar a una lectura lenta ===')
  {
    const resultado: ResultadoPlanificacion = { guardadas: 4, guardado: true, aviso: null, error: null }
    const rapida = await esperarPlanificacion(Promise.resolve(resultado), 50)
    ok('si llega a tiempo, se devuelve tal cual', rapida === resultado)

    let terminada = false
    const lenta = new Promise<ResultadoPlanificacion>((resolver) =>
      setTimeout(() => {
        terminada = true
        resolver(resultado)
      }, 120)
    )
    const t0 = Date.now()
    const r = await esperarPlanificacion(lenta, 20)
    ok('si tarda más del plazo, se sigue adelante con un aviso y sin error', !r.guardado && r.error === null && r.aviso === AVISO_PLANIFICACION_TARDA && Date.now() - t0 < 100, `${Date.now() - t0} ms`)
    ok('y la lectura NO se pierde: sigue por su cuenta hasta terminar', !terminada && (await lenta) === resultado && terminada)
  }

  console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
