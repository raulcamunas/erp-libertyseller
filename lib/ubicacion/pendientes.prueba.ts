import { crearCliente, type Consulta, type Resultado } from '@/lib/correo/secuencias/cliente-falso'
import { ubicarPendientes, COLUMNAS_PARA_UBICAR, type ClienteDeUbicacion } from './pendientes'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

interface Lead {
  id: string
  ciudad: string | null
  province: string | null
  business_address: string | null
  mercantile_registry: string | null
  phone: string | null
  web: string | null
  ccaa?: string | null
  municipio_ine?: string | null
  ubicacion_origen?: string | null
  ubicacion_confianza?: string | null
  ubicacion_calculada_at?: string | null
}

const lead = (n: number, resto: Partial<Lead> = {}): Lead => ({
  id: `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
  ciudad: null, province: null, business_address: null, mercantile_registry: null, phone: null, web: null,
  ubicacion_calculada_at: null,
  ...resto,
})

/** Una base de mentira con la migración 263 (o sin ella) que habla como PostgREST: lee los pendientes y guarda por lotes con la función */
function base(leads: Lead[], opciones: { sinMigracion?: boolean; guardaCero?: boolean } = {}) {
  const lecturas: Consulta[] = []
  const lotes: number[] = []
  const cliente = crearCliente(async (c: Consulta): Promise<Resultado> => {
    if (opciones.sinMigracion) return { data: null, error: { code: c.op === 'rpc' ? 'PGRST202' : '42703', message: 'no existe' }, count: null }
    if (c.op === 'select') {
      lecturas.push(c)
      let filas = leads.filter((l) => c.filtros.every((f) => f.op !== 'is' || (l as unknown as Record<string, unknown>)[f.col] === f.valor))
      filas = [...filas].sort((a, b) => (a.id < b.id ? -1 : 1))
      if (c.limite != null) filas = filas.slice(0, c.limite)
      return { data: filas.map(({ id, ciudad, province, business_address, mercantile_registry, phone, web }) => ({ id, ciudad, province, business_address, mercantile_registry, phone, web })), error: null, count: null }
    }
    if (c.op === 'rpc' && c.rpc!.nombre === 'poner_ubicaciones_de_leads') {
      const filas = c.rpc!.args.filas as Array<{ id: string; ccaa: string | null; municipio_ine: string | null; origen: string | null; confianza: string | null }>
      lotes.push(filas.length)
      if (opciones.guardaCero) return { data: 0, error: null, count: null }
      let n = 0
      for (const f of filas) {
        const l = leads.find((x) => x.id === f.id)
        if (!l) continue
        l.ccaa = f.ccaa
        l.municipio_ine = f.municipio_ine
        l.ubicacion_origen = f.origen
        l.ubicacion_confianza = f.confianza
        l.ubicacion_calculada_at = '2026-10-29T12:00:00Z'
        n++
      }
      return { data: n, error: null, count: null }
    }
    return { data: null, error: { code: 'PGRST202', message: 'no existe' }, count: null }
  })
  return { cliente: cliente as unknown as ClienteDeUbicacion, lecturas, lotes }
}

const rapido = { pausaMs: 0 }

async function main() {
  console.log('\n=== ubicar los leads pendientes ===')
  {
    const leads = [
      lead(1, { ciudad: 'Madrid' }),
      lead(2, { ciudad: 'Barcelona', phone: '+34 931234567' }),
      lead(3, { province: 'SEVILLA ESPAÑA', business_address: 'Calle X 1, 41001, ES' }),
      lead(4, { mercantile_registry: 'Registro Mercantil de Asturias, Tomo 3550' }),
      lead(5, { phone: '+34 976 12 34 56' }),
      lead(6), // sin ninguna pista
      lead(7, { ciudad: 'Springfield' }), // una pista que no se entiende
    ]
    const { cliente, lecturas, lotes } = base(leads)
    const r = await ubicarPendientes(cliente, rapido)
    const por = (n: number) => leads.find((l) => l.id.endsWith(String(n).padStart(12, '0')))!
    ok('lee los siete y los procesa', r.leidos === 7 && r.tandas === 1, JSON.stringify(r))
    ok('cinco quedan con comunidad y dos sin ninguna', r.ubicados === 5 && r.sinUbicar === 2)
    ok('Madrid -> MD con su municipio', por(1).ccaa === 'MD' && por(1).municipio_ine === '28079' && por(1).ubicacion_origen === 'ciudad' && por(1).ubicacion_confianza === 'alta')
    ok('la ciudad gana al teléfono', por(2).ccaa === 'CT' && por(2).ubicacion_origen === 'ciudad')
    ok('sin ciudad, la dirección con su código postal', por(3).ccaa === 'AN' && por(3).ubicacion_origen === 'direccion')
    ok('el registro queda con confianza media', por(4).ccaa === 'AS' && por(4).ubicacion_confianza === 'media')
    ok('el teléfono fijo queda con confianza baja', por(5).ccaa === 'AR' && por(5).ubicacion_confianza === 'baja')
    ok('un lead sin pistas se sella igual (comunidad vacía)', por(6).ccaa === null && por(6).ubicacion_calculada_at !== null && por(6).ubicacion_origen === null)
    ok('una ciudad que no se entiende tampoco bloquea ni inventa', por(7).ccaa === null && por(7).ubicacion_calculada_at !== null)
    ok('el resumen cuenta los orígenes', r.porOrigen['ciudad/alta'] === 2 && r.porOrigen['direccion/alta'] === 1 && r.porOrigen['registro/media'] === 1 && r.porOrigen['telefono/baja'] === 1, JSON.stringify(r.porOrigen))
    ok('las lecturas piden solo los pendientes y solo las columnas que hacen falta', lecturas.length === 1 && lecturas[0].filtros.some((f) => f.op === 'is' && f.col === 'ubicacion_calculada_at' && f.valor === null) && lecturas[0].columnas === COLUMNAS_PARA_UBICAR)
    ok('se guarda en una sola llamada con los siete', lotes.join() === '7')
    const otraVez = await ubicarPendientes(cliente, rapido)
    ok('una segunda pasada no encuentra nada', otraVez.leidos === 0 && otraVez.resumen === 'Nada por ubicar' && !otraVez.quedan)
  }

  console.log('\n=== por tandas, con tope y sin repetir ===')
  {
    const leads = Array.from({ length: 23 }, (_, i) => lead(i + 1, { ciudad: i % 2 ? 'Valencia' : 'Bilbao' }))
    const { cliente, lotes } = base(leads)
    const esperas: number[] = []
    const r = await ubicarPendientes(cliente, { tanda: 10, pausaMs: 500, esperar: async (ms) => void esperas.push(ms) })
    ok('23 leads en tandas de 10: 10, 10 y 3', lotes.join() === '10,10,3' && r.tandas === 3 && r.leidos === 23)
    ok('hay pausa entre tandas (dos veces: no después de la última)', esperas.join() === '500,500')
    ok('todos quedan ubicados y ninguno se procesa dos veces', leads.every((l) => l.ccaa === 'VC' || l.ccaa === 'PV') && !r.quedan)

    const otros = Array.from({ length: 23 }, (_, i) => lead(i + 1, { ciudad: 'Madrid' }))
    const b2 = base(otros)
    const r2 = await ubicarPendientes(b2.cliente, { tanda: 10, limite: 15, pausaMs: 0 })
    ok('con tope de 15: lee 10 y luego solo 5, y avisa de que quedan', b2.lotes.join() === '10,5' && r2.leidos === 15 && r2.quedan, JSON.stringify(r2))
    ok('lo que queda lo hace la pasada siguiente', (await ubicarPendientes(b2.cliente, { tanda: 10, limite: 15, pausaMs: 0 })).leidos === 8)

    let t = 0
    const b3 = base(Array.from({ length: 50 }, (_, i) => lead(i + 1, { ciudad: 'Madrid' })))
    const r3 = await ubicarPendientes(b3.cliente, { tanda: 10, pausaMs: 0, tiempoMaxMs: 25, ahora: () => (t += 10) })
    ok('con poco tiempo se para entre tandas y dice que quedan', r3.quedan && r3.leidos < 50 && r3.leidos > 0, JSON.stringify(r3))
  }

  console.log('\n=== lo que cambia vuelve a pendiente y se reubica ===')
  {
    const leads = [lead(1, { ciudad: 'Madrid' })]
    const { cliente } = base(leads)
    await ubicarPendientes(cliente, rapido)
    ok('al principio, Madrid', leads[0].ccaa === 'MD')
    leads[0].ciudad = 'Barcelona'
    leads[0].ubicacion_calculada_at = null // lo hace el disparador de la migración 263 al cambiar la ciudad
    await ubicarPendientes(cliente, rapido)
    ok('tras cambiar la ciudad y volver a pendiente, Cataluña', leads[0].ccaa === 'CT' && leads[0].municipio_ine === '08019')
  }

  console.log('\n=== sin la migración 263 no se rompe nada ===')
  {
    const leads = [lead(1, { ciudad: 'Madrid' })]
    const { cliente } = base(leads, { sinMigracion: true })
    const r = await ubicarPendientes(cliente, rapido)
    ok('lo dice y no hace nada', r.faltaLaMigracion && r.leidos === 0 && r.resumen.includes('263'), JSON.stringify(r))
    ok('no se ha tocado ningún lead', leads[0].ccaa === undefined)
  }

  console.log('\n=== los fallos de verdad sí se ven ===')
  {
    const { cliente } = base([lead(1, { ciudad: 'Madrid' })], { guardaCero: true })
    let error = ''
    try {
      await ubicarPendientes(cliente, rapido)
    } catch (e) {
      error = (e as Error).message
    }
    ok('si la base dice que no guardó ninguno, la pasada falla en vez de dar vueltas', error.includes('no ha guardado'), error)

    const falla = crearCliente(async (c) => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' }, count: null }))
    let error2 = ''
    try {
      await ubicarPendientes(falla as unknown as ClienteDeUbicacion, rapido)
    } catch (e) {
      error2 = (e as Error).message
    }
    ok('un error de la base (tiempo agotado) sube como error y se ve en Sistema', error2.includes('statement timeout'), error2)
  }


}

main()
  .then(() => {
    console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
    if (fallos > 0) process.exit(1)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
