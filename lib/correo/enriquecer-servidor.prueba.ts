import { enriquecerHiloAbierto, enriquecerHilos, enviadoPorDe, leerAutoresDeEnvio, nombresDePersonas, type FilaDeLista } from '@/lib/correo/enriquecer-servidor'

/**
 * PRUEBA DE enriquecer-servidor.ts: sin la 318 (tablas y columnas que no existen) nada falla y todo sale con su valor por defecto; con ella,
 * silencios, encargada y autores salen bien.
 * Uso: npx tsx lib/correo/enriquecer-servidor.prueba.ts
 */

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

type Fila = Record<string, unknown>
type ErrorFalso = { code: string; message: string }

const SIN_TABLA: ErrorFalso = { code: '42P01', message: 'relation does not exist' }
const SIN_TABLA_PGRST: ErrorFalso = { code: 'PGRST205', message: 'Could not find the table' }
const SIN_COLUMNA: ErrorFalso = { code: '42703', message: 'column correo_mensajes.enviado_por does not exist' }
const SIN_COLUMNA_PGRST: ErrorFalso = { code: 'PGRST204', message: "Could not find the 'enviado_por' column" }
const OTRO: ErrorFalso = { code: '57014', message: 'canceling statement due to statement timeout' }

/** Un cliente falso mínimo: select con eq/in/is, que se resuelve como promesa. Errores por tabla */
function clienteFalso(tablas: Record<string, Fila[]>, errores: Record<string, ErrorFalso> = {}) {
  const consultadas: string[] = []
  const from = (tabla: string) => {
    consultadas.push(tabla)
    const filtros: Array<(f: Fila) => boolean> = []
    const resultado = () => {
      const e = errores[tabla]
      if (e) return { data: null, error: e }
      return { data: (tablas[tabla] ?? []).filter((f) => filtros.every((p) => p(f))), error: null }
    }
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filtros.push((f) => f[c] === v), q),
      in: (c: string, vs: unknown[]) => (filtros.push((f) => vs.includes(f[c])), q),
      is: (c: string, v: unknown) => (filtros.push((f) => (f[c] ?? null) === v), q),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(resultado()).then(res, rej),
    }
    return q
  }
  return { cliente: { from } as never, consultadas }
}

const YO = '00000000-0000-4000-8000-000000000001'
const PATRICIA = '00000000-0000-4000-8000-000000000002'
const DANIELA = '00000000-0000-4000-8000-000000000003'
const BUZON = '00000000-0000-4000-8000-0000000000b1'
const H1 = '00000000-0000-4000-8000-0000000000a1'
const H2 = '00000000-0000-4000-8000-0000000000a2'
const H3 = '00000000-0000-4000-8000-0000000000a3'

const fila = (id: string, contraparte: string): FilaDeLista => ({
  id,
  buzon_id: BUZON,
  asunto: `Asunto ${id.slice(-2)}`,
  contraparte: 'Ana',
  contraparte_direccion: contraparte,
  vista_previa: 'hola',
  ultimo_mensaje_at: '2026-11-15T10:00:00.000Z',
  mensajes: 2,
  no_leidos: 1,
  entrantes: 1,
  salientes: 1,
  tiene_adjuntos: false,
  destacado: false,
  ultimo_es_entrante: true,
  automatico: false,
})

const AHORA = Date.parse('2026-11-16T09:00:00.000Z')
const FILAS = [fila(H1, 'ana@cliente.es'), fila(H2, 'Juan@Otro.es'), fila(H3, 'luis@x.es')]

const errores318: Record<string, ErrorFalso> = {
  correo_hilo_silencios: SIN_TABLA,
  correo_remitente_silencios: SIN_TABLA_PGRST,
  correo_hilo_asignaciones: SIN_TABLA,
}

async function main() {
  console.log('Sin la 318: la lista sale igual')
  {
    const { cliente } = clienteFalso({ profiles: [] }, errores318)
    const hilos = await enriquecerHilos(cliente, YO, FILAS, AHORA)
    ok('no lanza y devuelve todas las filas, en el mismo orden', hilos.length === 3 && hilos.map((h) => h.id).join() === [H1, H2, H3].join())
    ok('cada fila lleva su buzón', hilos.every((h) => h.buzonId === BUZON))
    ok('nada silenciado', hilos.every((h) => h.silenciado === false))
    ok('nadie encargado', hilos.every((h) => h.asignadoA === null))
    ok('lo de siempre se conserva (esperandoRespuesta, noLeidos)', hilos[0].esperandoRespuesta === true && hilos[0].noLeidos === 1)
  }

  console.log('Sin la 318: el hilo se abre igual')
  {
    const { cliente } = clienteFalso({}, errores318)
    const r = await enriquecerHiloAbierto(cliente, YO, { id: H1, contraparteDireccion: 'ana@cliente.es' }, AHORA)
    ok('sin silencio de hilo ni de remitente', r.silenciado.hilo === false && r.silenciado.remitente === false)
    ok('sin encargada', r.asignacion === null)
  }

  console.log('Sin la 318: autores de envío')
  {
    for (const [nombre, e] of [['42703', SIN_COLUMNA], ['PGRST204', SIN_COLUMNA_PGRST], ['tabla', SIN_TABLA]] as const) {
      const { cliente } = clienteFalso({}, { correo_mensajes: e })
      const m = await leerAutoresDeEnvio(cliente, ['m1', 'm2'])
      ok(`sin la columna (${nombre}) → mapa vacío, sin lanzar`, m.size === 0)
    }
    const { cliente, consultadas } = clienteFalso({})
    const vacio = await leerAutoresDeEnvio(cliente, [])
    ok('sin ids no consulta nada', vacio.size === 0 && consultadas.length === 0)
  }

  console.log('Un fallo que no es de migración tampoco rompe la pantalla')
  {
    const { cliente } = clienteFalso({ profiles: [] }, { correo_hilo_silencios: OTRO, correo_remitente_silencios: OTRO, correo_hilo_asignaciones: OTRO, correo_mensajes: OTRO })
    const original = console.error
    let avisos = 0
    console.error = () => void avisos++
    try {
      const hilos = await enriquecerHilos(cliente, YO, FILAS, AHORA)
      ok('valores por defecto', hilos.every((h) => !h.silenciado && h.asignadoA === null))
      const m = await leerAutoresDeEnvio(cliente, ['m1'])
      ok('autores: mapa vacío', m.size === 0)
      ok('queda en el registro (no es una migración)', avisos >= 4, String(avisos))
    } finally {
      console.error = original
    }
  }

  console.log('Con la 318')
  {
    const { cliente } = clienteFalso({
      correo_hilo_silencios: [
        { user_id: YO, hilo_id: H1, hasta: null },
        { user_id: PATRICIA, hilo_id: H3, hasta: null },
        // vencido: ya no cuenta
        { user_id: YO, hilo_id: H3, hasta: '2026-11-16T08:00:00.000Z' },
      ],
      correo_remitente_silencios: [{ user_id: YO, direccion: 'juan@otro.es', hasta: '2026-11-20T00:00:00.000Z' }],
      correo_hilo_asignaciones: [
        { hilo_id: H2, persona_id: PATRICIA, asignado_por: DANIELA, nota: 'Llámale', asignado_at: '2026-11-15T09:00:00.000Z', hecho_at: null },
        { hilo_id: H3, persona_id: DANIELA, asignado_por: YO, nota: null, asignado_at: '2026-11-14T09:00:00.000Z', hecho_at: '2026-11-15T09:00:00.000Z' },
      ],
      profiles: [
        { id: PATRICIA, full_name: 'Patricia', email: 'p@x.es' },
        { id: DANIELA, full_name: null, email: 'daniela@x.es' },
      ],
    })
    const hilos = await enriquecerHilos(cliente, YO, FILAS, AHORA)
    const [h1, h2, h3] = hilos
    ok('silenciado por el hilo', h1.silenciado === true)
    ok('silenciado por el remitente (sin distinguir mayúsculas)', h2.silenciado === true)
    ok('un silencio vencido o de otra persona no cuenta', h3.silenciado === false)
    ok('encargada con su nombre', h2.asignadoA?.id === PATRICIA && h2.asignadoA.nombre === 'Patricia')
    ok('un hilo «hecho» ya no tiene encargada', h3.asignadoA === null && h1.asignadoA === null)

    const abierto = await enriquecerHiloAbierto(cliente, YO, { id: H2, contraparteDireccion: 'JUAN@otro.es' }, AHORA)
    ok('hilo abierto: remitente silenciado, hilo no', abierto.silenciado.remitente === true && abierto.silenciado.hilo === false)
    ok(
      'hilo abierto: asignación con nombre, quién la hizo y nota',
      abierto.asignacion?.personaId === PATRICIA && abierto.asignacion.nombre === 'Patricia' && abierto.asignacion.asignadoPor === 'daniela@x.es' && abierto.asignacion.nota === 'Llámale'
    )
  }

  console.log('Lo que ya trae la bandeja (RPC) no se vuelve a pedir')
  {
    const { cliente, consultadas } = clienteFalso({ profiles: [{ id: PATRICIA, full_name: 'Patricia', email: null }] })
    const hilos = await enriquecerHilos(
      cliente,
      YO,
      FILAS.map((f, i) => ({ ...f, silenciado: i === 0, asignado_a: i === 1 ? PATRICIA : null })),
      AHORA
    )
    ok('silencio y encargada de la RPC', hilos[0].silenciado && !hilos[1].silenciado && hilos[1].asignadoA?.nombre === 'Patricia')
    ok('solo se piden los nombres', consultadas.join() === 'profiles', consultadas.join())
  }

  console.log('Autores de envío')
  {
    const { cliente } = clienteFalso({
      correo_mensajes: [
        { id: 'm1', enviado_por: PATRICIA, enviado_por_nombre: 'Patricia' },
        { id: 'm2', enviado_por: null, enviado_por_nombre: null },
        { id: 'm3', enviado_por: YO, enviado_por_nombre: 'Yo' },
      ],
    })
    const m = await leerAutoresDeEnvio(cliente, ['m1', 'm2', 'm3', 'm1'])
    ok('solo salen los que tienen autor', m.size === 2 && m.has('m1') && m.has('m3') && !m.has('m2'))
    ok('«Enviado por» para quien no es el dueño', enviadoPorDe(m.get('m1'), YO)?.nombre === 'Patricia')
    ok('nada si lo envió el dueño', enviadoPorDe(m.get('m3'), YO) === null)
    ok('nada si no hay autor', enviadoPorDe(undefined, YO) === null)
    ok('persona borrada: id null y su nombre', JSON.stringify(enviadoPorDe({ enviado_por: null, enviado_por_nombre: 'Jhanna' }, YO)) === JSON.stringify({ id: null, nombre: 'Jhanna' }))
  }

  console.log('Nombres')
  {
    const { cliente } = clienteFalso({}, { profiles: SIN_TABLA })
    ok('si no se pueden leer, mapa vacío', (await nombresDePersonas(cliente, [YO])).size === 0)
  }

  console.log(`\n${comprobaciones - fallos}/${comprobaciones} comprobaciones correctas`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
