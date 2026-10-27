import { createHash } from 'node:crypto'
import { BRIEFING_DE_EJEMPLO } from '@/lib/briefing/ejemplo'
import { normalizarBriefing } from '@/lib/briefing/esquema'
import {
  FALTA_MIGRACION_BRIEFING,
  FaltaMigracionDelBriefing,
  anularEnlaceDelConector,
  claveExisteEn,
  comprobarEnlaceDelConector,
  crearEnlaceDelConector,
  diasConBriefing,
  enlaceNuevo,
  esClaveDePunto,
  estadoDelConector,
  huellaDelEnlace,
  leerBriefing,
  marcarPunto,
  migracionLanzada,
  marcasDelDia,
  publicarBriefing,
} from '@/lib/briefing/servidor'
import type { Briefing } from '@/lib/briefing/tipos'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const j = (x: unknown) => JSON.stringify(x)

/** Una base de mentira en memoria con lo justo de la API de Supabase que usa servidor.ts: select, eq, in, order, limit, maybeSingle, upsert, update y delete */
type Fila = Record<string, unknown>
function baseFalsa() {
  const tablas: Record<string, Fila[]> = { briefings: [], briefing_marcas: [], briefing_conector: [], profiles: [] }
  const errores: Record<string, { code: string } | undefined> = {}
  const llamadas: string[] = []
  const claves: Record<string, string[]> = { briefings: ['tipo', 'dia'], briefing_marcas: ['tipo', 'dia', 'clave'], briefing_conector: ['id'] }
  const porDefecto: Record<string, () => Fila> = { briefings: () => ({ tipo: 'diario', publicado_at: '2026-10-27T05:40:00.000Z' }), briefing_marcas: () => ({ tipo: 'diario' }), briefing_conector: () => ({ id: true }) }

  function constructor(tabla: string) {
    let filtros: Array<(f: Fila) => boolean> = []
    let operacion: 'select' | 'upsert' | 'update' | 'delete' = 'select'
    let cuerpo: Fila = {}
    let opciones: { onConflict?: string } = {}
    let orden: { col: string; asc: boolean } | null = null
    let tope: number | null = null
    let unica = false
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => {
        filtros.push((f) => f[c] === v)
        return q
      },
      in: (c: string, vs: unknown[]) => {
        filtros.push((f) => vs.includes(f[c]))
        return q
      },
      order: (c: string, o: { ascending: boolean }) => {
        orden = { col: c, asc: o.ascending }
        return q
      },
      limit: (n: number) => {
        tope = n
        return q
      },
      maybeSingle: () => {
        unica = true
        return q
      },
      upsert: (fila: Fila, o: { onConflict?: string }) => {
        operacion = 'upsert'
        cuerpo = fila
        opciones = o
        return q
      },
      update: (fila: Fila) => {
        operacion = 'update'
        cuerpo = fila
        return q
      },
      delete: () => {
        operacion = 'delete'
        return q
      },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
        llamadas.push(`${tabla}.${operacion}`)
        const resultado = () => {
          const error = errores[tabla]
          if (error) return { data: null, error }
          const filas = tablas[tabla]
          if (operacion === 'upsert') {
            const llave = (opciones.onConflict ?? claves[tabla].join(',')).split(',')
            const previa = filas.find((f) => llave.every((k) => f[k] === cuerpo[k] || (cuerpo[k] === undefined && f[k] === porDefecto[tabla]()[k])))
            if (previa) Object.assign(previa, cuerpo)
            else filas.push({ ...porDefecto[tabla](), ...cuerpo })
            return { data: null, error: null }
          }
          const elegidas = filas.filter((f) => filtros.every((p) => p(f)))
          if (operacion === 'update') {
            for (const f of elegidas) Object.assign(f, cuerpo)
            return { data: null, error: null }
          }
          if (operacion === 'delete') {
            tablas[tabla] = filas.filter((f) => !elegidas.includes(f))
            // En cascada, como la base: las marcas de un día borrado
            if (tabla === 'briefings') tablas.briefing_marcas = tablas.briefing_marcas.filter((m) => !elegidas.some((e) => e.dia === m.dia))
            return { data: null, error: null }
          }
          let salida = [...elegidas]
          if (orden) {
            const { col, asc } = orden
            salida.sort((a, b) => ((a[col] as string) < (b[col] as string) ? -1 : (a[col] as string) > (b[col] as string) ? 1 : 0) * (asc ? 1 : -1))
          }
          if (tope !== null) salida = salida.slice(0, tope)
          return { data: unica ? (salida[0] ?? null) : salida, error: null }
        }
        return Promise.resolve(resultado()).then(res, rej)
      },
    }
    return q
  }
  return { servicio: { from: (t: string) => constructor(t) } as never, tablas, errores, llamadas }
}

const bueno = (): Briefing => {
  const r = normalizarBriefing(JSON.parse(JSON.stringify(BRIEFING_DE_EJEMPLO)))
  if (!r.ok) throw new Error('el ejemplo no vale')
  return r.briefing
}

async function falla(n: string, f: () => Promise<unknown>, quien: (e: unknown) => boolean) {
  try {
    await f()
    ok(n, false, 'no ha lanzado')
  } catch (e) {
    ok(n, quien(e), e instanceof Error ? e.message : String(e))
  }
}

async function run() {
  console.log('\n=== publicar y leer un briefing ===')
  {
    const b = baseFalsa()
    const r1 = await publicarBriefing(b.servicio, { dia: '2026-10-27', briefing: bueno() })
    ok('la primera vez es nuevo', r1.nuevo === true && b.tablas.briefings.length === 1)
    const fila = b.tablas.briefings[0]
    ok('guarda el día, el titular y cuántos puntos hay en «Revisa hoy»', fila.dia === '2026-10-27' && fila.titular === BRIEFING_DE_EJEMPLO.titular && fila.puntos_revisar === 4 && fila.tipo === 'diario')
    ok('y el JSON limpio', (fila.contenido as Briefing).revisar.length === 4)

    const otro = bueno()
    otro.titular = 'El titular de la segunda publicación'
    const r2 = await publicarBriefing(b.servicio, { dia: '2026-10-27', briefing: otro })
    ok('publicar otra vez el mismo día lo SUSTITUYE (no hay dos) y dice que no es nuevo', r2.nuevo === false && b.tablas.briefings.length === 1 && b.tablas.briefings[0].titular === 'El titular de la segunda publicación')
    ok('conserva la fecha de la primera publicación y apunta la de la última', b.tablas.briefings[0].publicado_at === '2026-10-27T05:40:00.000Z' && typeof b.tablas.briefings[0].actualizado_at === 'string')

    await publicarBriefing(b.servicio, { dia: '2026-10-26', briefing: bueno() })
    const uno = await leerBriefing(b.servicio, '2026-10-27')
    ok('leer un día devuelve su briefing, ya limpio, con sus fechas', uno?.dia === '2026-10-27' && uno.briefing.titular === 'El titular de la segunda publicación' && uno.publicadoAt === '2026-10-27T05:40:00.000Z' && uno.briefing.revisar[0].clave.startsWith('r-'))
    const ultimo = await leerBriefing(b.servicio, null)
    ok('sin día, el último que haya', ultimo?.dia === '2026-10-27')
    ok('un día sin briefing es null', (await leerBriefing(b.servicio, '2026-10-20')) === null)

    const lista = await diasConBriefing(b.servicio, 60)
    ok('los días con briefing, del más nuevo al más viejo, con su titular y sus puntos', lista.map((d) => d.dia).join() === '2026-10-27,2026-10-26' && lista[0].puntosARevisar === 4 && lista[1].titular === BRIEFING_DE_EJEMPLO.titular, j(lista))
    ok('con tope', (await diasConBriefing(b.servicio, 1)).length === 1)

    b.tablas.briefings.push({ tipo: 'diario', dia: '2026-10-25', contenido: [1, 2, 3], titular: 'roto', puntos_revisar: 0, publicado_at: 'x', actualizado_at: 'x' })
    const original = console.error
    const apuntes: string[] = []
    console.error = (...a: unknown[]) => apuntes.push(j(a))
    const roto = await leerBriefing(b.servicio, '2026-10-25')
    console.error = original
    ok('un contenido guardado que ya no se lee se trata como si no hubiera briefing (y se apunta)', roto === null && apuntes.length === 1)
  }

  console.log('\n=== las marcas de «resuelto» ===')
  {
    const b = baseFalsa()
    b.tablas.profiles.push({ id: 'u-raul', full_name: 'Raúl Camuñas' }, { id: 'u-marius', full_name: null })
    await publicarBriefing(b.servicio, { dia: '2026-10-27', briefing: bueno() })
    const claves = bueno().revisar.map((x) => x.clave)
    await marcarPunto(b.servicio, { dia: '2026-10-27', clave: claves[0], hecho: true, userId: 'u-raul' })
    await marcarPunto(b.servicio, { dia: '2026-10-27', clave: claves[1], hecho: true, userId: 'u-marius' })
    const m = await marcasDelDia(b.servicio, '2026-10-27')
    ok('marcar guarda quién y cuándo; lee el nombre de quien lo marcó', m[claves[0]]?.por === 'Raúl Camuñas' && typeof m[claves[0]].cuando === 'string' && Object.keys(m).length === 2, j(m))
    ok('quien no tiene nombre sale sin él (la marca se conserva)', m[claves[1]]?.por === null)
    await marcarPunto(b.servicio, { dia: '2026-10-27', clave: claves[0], hecho: true, userId: 'u-marius' })
    ok('marcar dos veces el mismo punto no lo duplica: queda con quien lo marcó el último', b.tablas.briefing_marcas.filter((x) => x.clave === claves[0]).length === 1 && b.tablas.briefing_marcas.find((x) => x.clave === claves[0])?.hecho_por === 'u-marius')
    await marcarPunto(b.servicio, { dia: '2026-10-27', clave: claves[0], hecho: false, userId: 'u-raul' })
    ok('desmarcar lo quita', !(claves[0] in (await marcasDelDia(b.servicio, '2026-10-27'))) && claves[1] in (await marcasDelDia(b.servicio, '2026-10-27')))
    ok('un día sin marcas devuelve {}', Object.keys(await marcasDelDia(b.servicio, '2026-10-20')).length === 0)
  }

  console.log('\n=== qué claves valen ===')
  {
    const bri = bueno()
    ok('la forma de una clave', esClaveDePunto('r-1a2b3c4d') && esClaveDePunto('c-0000ffff-2') && !esClaveDePunto('x-1a2b3c4d') && !esClaveDePunto('r-1A2B3C4D') && !esClaveDePunto('r-1a2b3c4') && !esClaveDePunto("r-1a2b3c4d'; drop table") && !esClaveDePunto(7) && !esClaveDePunto(null))
    ok('una clave vale si está en ese briefing, sea de «Revisa hoy» o de correo', claveExisteEn(bri, bri.revisar[0].clave) && claveExisteEn(bri, bri.correo[0].clave) && !claveExisteEn(bri, 'r-00000000'))
  }

  console.log('\n=== el enlace secreto del conector ===')
  {
    const b = baseFalsa()
    ok('al principio no hay enlace', j(await estadoDelConector(b.servicio)) === j({ hayEnlace: false, creadoAt: null, ultimoUsoAt: null }))
    const { token } = await crearEnlaceDelConector(b.servicio, 'u-raul')
    ok('el enlace son 43 caracteres de base64url (32 bytes al azar)', /^[A-Za-z0-9_-]{43}$/.test(token), token)
    ok('en la base solo hay su huella SHA-256: el enlace NO se guarda en ningún sitio', b.tablas.briefing_conector.length === 1 && b.tablas.briefing_conector[0].token_hash === createHash('sha256').update(token).digest('hex') && !JSON.stringify(b.tablas).includes(token))
    ok('apunta quién lo creó y cuándo', b.tablas.briefing_conector[0].creado_por === 'u-raul' && typeof b.tablas.briefing_conector[0].creado_at === 'string' && b.tablas.briefing_conector[0].ultimo_uso_at === null)
    const est = await estadoDelConector(b.servicio)
    ok('el estado dice que hay enlace, desde cuándo y que no se ha usado', est.hayEnlace && est.creadoAt !== null && est.ultimoUsoAt === null)

    ok('el enlace bueno vale', (await comprobarEnlaceDelConector(b.servicio, token)) === 'ok')
    ok('apunta que se ha usado (para que la pantalla diga «usado hace…»)', await (async () => { await new Promise((r) => setTimeout(r, 5)); return typeof b.tablas.briefing_conector[0].ultimo_uso_at === 'string' })())
    const antes = b.tablas.briefing_conector[0].ultimo_uso_at
    await comprobarEnlaceDelConector(b.servicio, token, Date.now() + 60_000)
    await new Promise((r) => setTimeout(r, 5))
    ok('pero no escribe en la base con cada mensaje: como mucho cada 5 minutos', b.tablas.briefing_conector[0].ultimo_uso_at === antes)
    await comprobarEnlaceDelConector(b.servicio, token, Date.now() + 10 * 60_000)
    await new Promise((r) => setTimeout(r, 5))
    ok('y pasados los 5 minutos, sí', b.tablas.briefing_conector[0].ultimo_uso_at !== antes)

    ok('otro enlace no vale', (await comprobarEnlaceDelConector(b.servicio, enlaceNuevo())) === 'invalido')
    ok('uno con una forma imposible no vale ni mira la base', await (async () => { const n = b.llamadas.length; const r = await comprobarEnlaceDelConector(b.servicio, 'corto'); const r2 = await comprobarEnlaceDelConector(b.servicio, `${token}x`.padEnd(80, 'x')); const r3 = await comprobarEnlaceDelConector(b.servicio, "../../etc/passwd'--"); return r === 'invalido' && r2 === 'invalido' && r3 === 'invalido' && b.llamadas.length === n })())
    ok('la huella de dos enlaces distintos es distinta y de 64 cifras', huellaDelEnlace('a') !== huellaDelEnlace('b') && /^[0-9a-f]{64}$/.test(huellaDelEnlace('a')))

    const { token: nuevo } = await crearEnlaceDelConector(b.servicio, 'u-marius')
    ok('crear otro enlace invalida el anterior (una sola fila)', b.tablas.briefing_conector.length === 1 && (await comprobarEnlaceDelConector(b.servicio, token)) === 'invalido' && (await comprobarEnlaceDelConector(b.servicio, nuevo)) === 'ok')
    await anularEnlaceDelConector(b.servicio)
    ok('anularlo deja a la rutina sin poder publicar', (await comprobarEnlaceDelConector(b.servicio, nuevo)) === 'invalido' && !(await estadoDelConector(b.servicio)).hayEnlace)

    const caida = baseFalsa()
    const { token: t2 } = await crearEnlaceDelConector(caida.servicio, 'u')
    caida.errores.briefing_conector = { code: '57P01' }
    ok('si la base no contesta NO se dice «no vale» (Claude daría por muerto un enlace bueno): se dice «error»', (await comprobarEnlaceDelConector(caida.servicio, t2)) === 'error')
  }

  console.log('\n=== ¿está lanzada la migración? ===')
  {
    const b = baseFalsa()
    ok('con las tablas, sí', (await migracionLanzada(b.servicio)) === true)
    b.errores.briefings = { code: '42P01' }
    ok('sin ellas, no (la pantalla dice qué fichero lanzar)', (await migracionLanzada(b.servicio)) === false)
    b.errores.briefings = { code: 'PGRST205' }
    ok('PostgREST sin la tabla en su caché también es «no lanzada»', (await migracionLanzada(b.servicio)) === false)
    b.errores.briefings = { code: '57P01' }
    await falla('una caída de la base no se confunde con «falta la migración»', () => migracionLanzada(b.servicio), (e) => !(e instanceof FaltaMigracionDelBriefing) && /No se ha podido comprobar/.test((e as Error).message))
  }

  console.log('\n=== sin la migración 254 ===')
  {
    const b = baseFalsa()
    for (const t of ['briefings', 'briefing_marcas', 'briefing_conector']) b.errores[t] = { code: '42P01' }
    await falla('publicar lanza FaltaMigracionDelBriefing con la frase de qué fichero lanzar', () => publicarBriefing(b.servicio, { dia: '2026-10-27', briefing: bueno() }), (e) => e instanceof FaltaMigracionDelBriefing && /254_briefing/.test((e as Error).message) && (e as Error).message === FALTA_MIGRACION_BRIEFING)
    await falla('marcar también', () => marcarPunto(b.servicio, { dia: '2026-10-27', clave: 'r-1a2b3c4d', hecho: true, userId: 'u' }), (e) => e instanceof FaltaMigracionDelBriefing)
    await falla('crear el enlace también', () => crearEnlaceDelConector(b.servicio, 'u'), (e) => e instanceof FaltaMigracionDelBriefing)
    ok('leer no revienta: no hay nada', (await leerBriefing(b.servicio, null)) === null && (await diasConBriefing(b.servicio)).length === 0 && Object.keys(await marcasDelDia(b.servicio, '2026-10-27')).length === 0)
    ok('el estado del conector dice que no hay enlace, y un enlace no vale', !(await estadoDelConector(b.servicio)).hayEnlace && (await comprobarEnlaceDelConector(b.servicio, enlaceNuevo())) === 'invalido')

    const raro = baseFalsa()
    raro.errores.briefings = { code: '23505' }
    await falla('un error cualquiera sale como una frase nuestra, sin el cuerpo del error', () => publicarBriefing(raro.servicio, { dia: '2026-10-27', briefing: bueno() }), (e) => !(e instanceof FaltaMigracionDelBriefing) && /No se ha podido/.test((e as Error).message))
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
