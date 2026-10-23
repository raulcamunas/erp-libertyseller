import {
  actualizarEjemplo,
  actualizarVersion,
  aVersion,
  borrarEjemplo,
  configuracionPorDefecto,
  crearEjemplo,
  crearVersion,
  declararGanadora,
  ejemplosBloqueados,
  listarVersiones,
  resolverConfiguracion,
  sembrarBase,
  usoDeVersiones,
  versionUsada,
} from '@/lib/correo/ia-laboratorio-servidor'
import { INSTRUCCIONES, SECCIONES_BASE, compilarInstrucciones } from '@/lib/correo/ia-prompt'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/* ------------------------------------------------------------------ */
/* Una base de datos de mentira, en memoria, con lo justo que usa el módulo */
/* ------------------------------------------------------------------ */

type Fila = Record<string, unknown>
interface Almacen {
  tablas: Record<string, Fila[]>
  /** Si es un código, la siguiente consulta a esa tabla falla con él (por ejemplo 42P01: la tabla no existe) */
  rotas: Record<string, string>
  contador: number
}

const POR_DEFECTO: Record<string, () => Fila> = {
  correo_ia_versiones: () => ({ notas: null, ejemplos_ids: [], usar_ganadores: true, modelo: null, peso: 0, activa: false, es_base: false, archivada: false, creada_por: null, creada_at: '2026-10-23T10:00:00Z', actualizada_at: '2026-10-23T10:00:00Z' }),
  correo_ia_ejemplos: () => ({ titulo: 't', tipo: 'ambos', nota: null, activo: true, creado_por: null, creado_at: '2026-10-23T10:00:00Z', actualizado_at: '2026-10-23T10:00:00Z' }),
  correo_ia_borradores: () => ({ version_id: null, enviado_at: null }),
}

class Consulta implements PromiseLike<{ data: unknown; error: unknown; count?: number | null }> {
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private filtros: Array<(f: Fila) => boolean> = []
  private fila: Fila | null = null
  private parche: Fila | null = null
  private cabeza = false
  private orden: { col: string; asc: boolean } | null = null
  private tope: number | null = null
  private unico: 'single' | 'maybe' | null = null
  private devolver = false
  constructor(
    private tabla: string,
    private a: Almacen
  ) {}
  select(_cols?: string, o?: { count?: string; head?: boolean }) {
    if (this.op === 'insert' || this.op === 'update') this.devolver = true
    else this.op = 'select'
    this.cabeza = o?.head === true
    return this
  }
  insert(f: Fila) {
    this.op = 'insert'
    this.fila = f
    return this
  }
  update(p: Fila) {
    this.op = 'update'
    this.parche = p
    return this
  }
  delete() {
    this.op = 'delete'
    return this
  }
  eq(c: string, v: unknown) {
    this.filtros.push((f) => f[c] === v)
    return this
  }
  in(c: string, vs: unknown[]) {
    this.filtros.push((f) => vs.includes(f[c]))
    return this
  }
  not(c: string, _is: string, v: unknown) {
    this.filtros.push((f) => f[c] !== v)
    return this
  }
  or(expr: string) {
    const partes = expr.split(',').map((p) => p.split('.'))
    this.filtros.push((f) => partes.some(([c, op, v]) => (op === 'eq' ? f[c] === v : op === 'is' && v === 'null' ? f[c] === null || f[c] === undefined : false)))
    return this
  }
  order(col: string, o?: { ascending?: boolean }) {
    this.orden = { col, asc: o?.ascending !== false }
    return this
  }
  limit(n: number) {
    this.tope = n
    return this
  }
  single() {
    this.unico = 'single'
    return this
  }
  maybeSingle() {
    this.unico = 'maybe'
    return this
  }
  then<T1, T2>(res?: ((v: { data: unknown; error: unknown; count?: number | null }) => T1 | PromiseLike<T1>) | null, rej?: ((r: unknown) => T2 | PromiseLike<T2>) | null) {
    return Promise.resolve(this.ejecutar()).then(res, rej)
  }
  private ejecutar(): { data: unknown; error: unknown; count?: number | null } {
    const codigo = this.a.rotas[this.tabla]
    if (codigo) return { data: null, error: { code: codigo, message: 'falla' } }
    const filas = (this.a.tablas[this.tabla] ??= [])
    let resultado: Fila[] = []
    if (this.op === 'insert') {
      const nueva: Fila = { ...POR_DEFECTO[this.tabla]?.(), id: `id-${++this.a.contador}`, ...this.fila }
      if (this.tabla === 'correo_ia_versiones' && nueva.es_base === true && filas.some((f) => f.es_base === true)) return { data: null, error: { code: '23505', message: 'duplicada' } }
      filas.push(nueva)
      resultado = [nueva]
      if (!this.devolver) return { data: null, error: null }
    } else {
      const coinciden = filas.filter((f) => this.filtros.every((fn) => fn(f)))
      if (this.op === 'update') {
        for (const f of coinciden) Object.assign(f, this.parche)
        resultado = coinciden
        if (!this.devolver) return { data: null, error: null }
      } else if (this.op === 'delete') {
        this.a.tablas[this.tabla] = filas.filter((f) => !coinciden.includes(f))
        return { data: null, error: null }
      } else {
        resultado = coinciden
        if (this.orden) {
          const { col, asc } = this.orden
          resultado = [...resultado].sort((x, y) => (String(x[col]) < String(y[col]) ? -1 : String(x[col]) > String(y[col]) ? 1 : 0) * (asc ? 1 : -1))
        }
        if (this.tope !== null) resultado = resultado.slice(0, this.tope)
        if (this.cabeza) return { data: null, error: null, count: coinciden.length }
      }
    }
    if (this.unico === 'single') return resultado.length === 1 ? { data: resultado[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no hay una fila' } }
    if (this.unico === 'maybe') return { data: resultado[0] ?? null, error: null }
    return { data: resultado, error: null }
  }
}

function crear(tablas: Record<string, Fila[]> = {}) {
  const almacen: Almacen = { tablas: { correo_ia_versiones: [], correo_ia_ejemplos: [], correo_ia_borradores: [], ...tablas }, rotas: {}, contador: 0 }
  return { almacen, servicio: { from: (t: string) => new Consulta(t, almacen) } as never }
}

const texto120 = 'Hola,\n\nHemos revisado vuestra tienda y vemos una oportunidad clara para trabajar mejor las fichas, las variantes y la publicidad en Amazon, sin cargar a vuestro equipo.\n\nUn saludo,'
const UUID1 = '11111111-1111-4111-8111-111111111111'

async function main() {
  console.log('\n=== la versión original ===')
  {
    const { almacen, servicio } = crear()
    await sembrarBase(servicio, 'u1')
    await sembrarBase(servicio, 'u1')
    const v = almacen.tablas.correo_ia_versiones
    ok('se crea una sola vez', v.length === 1 && v[0].es_base === true)
    ok('con las instrucciones de siempre y todo el reparto', JSON.stringify(v[0].secciones) === JSON.stringify(SECCIONES_BASE) && v[0].peso === 100 && v[0].activa === true)
    ok('compila al texto de siempre', compilarInstrucciones(aVersion(v[0] as never).secciones) === INSTRUCCIONES)
    // dos peticiones a la vez: la segunda choca con el índice único y no es un error
    const doble = crear()
    await Promise.all([sembrarBase(doble.servicio, null), sembrarBase(doble.servicio, null)])
    ok('dos peticiones a la vez no rompen y dejan una', doble.almacen.tablas.correo_ia_versiones.length === 1)
    const rota = crear()
    rota.almacen.rotas.correo_ia_versiones = '42P01'
    let lanza = false
    try {
      await sembrarBase(rota.servicio, null)
    } catch {
      lanza = true
    }
    ok('sin la tabla lanza (la ruta lo traduce a «lanza la migración 243»)', lanza)
  }

  console.log('\n=== crear una versión ===')
  {
    const { almacen, servicio } = crear({ correo_ia_ejemplos: [{ id: UUID1, titulo: 'e', asunto: 'A', texto: texto120 }] })
    const r = await crearVersion(servicio, { nombre: ' Más directa ', secciones: SECCIONES_BASE, ejemplosIds: [UUID1, '22222222-2222-4222-8222-222222222222', 'no-es-un-id'], usarGanadores: false, modelo: 'GPT-5.6-Luna', peso: 30, activa: true }, 'jhanna')
    ok('se crea', r.ok === true && r.valor.nombre === 'Más directa' && r.valor.modelo === 'gpt-5.6-luna')
    ok('solo se guardan los ejemplos que existen', r.ok && JSON.stringify(r.valor.ejemplosIds) === JSON.stringify([UUID1]))
    ok('queda a nombre de quien la creó, no es la original', almacen.tablas.correo_ia_versiones[0].creada_por === 'jhanna' && almacen.tablas.correo_ia_versiones[0].es_base === false)
    ok('«sin ganadores automáticos» se respeta', r.ok && r.valor.usarGanadores === false)
    const pausada = await crearVersion(servicio, { nombre: 'Nueva', secciones: SECCIONES_BASE }, 'jhanna')
    ok('por defecto nace PAUSADA y sin peso: no llega a los comerciales hasta que se ponga en marcha', pausada.ok && pausada.valor.activa === false && pausada.valor.peso === 0 && pausada.valor.usarGanadores === true)
    const sinPeso = await crearVersion(servicio, { nombre: 'Marcha sin peso', secciones: SECCIONES_BASE, activa: true, peso: 0 }, 'jhanna')
    ok('«en marcha» con peso 0 no se queda en marcha', sinPeso.ok && sinPeso.valor.activa === false)
    ok('sin nombre: error', (await crearVersion(servicio, { nombre: ' ', secciones: SECCIONES_BASE }, 'j')).ok === false)
    ok('instrucciones inválidas: error', (await crearVersion(servicio, { nombre: 'x', secciones: { queHacemos: 'poco' } }, 'j')).ok === false)
    ok('modelo raro: error', (await crearVersion(servicio, { nombre: 'x', secciones: SECCIONES_BASE, modelo: 'gpt 5; drop' }, 'j')).ok === false)
    ok('peso fuera de rango: error', (await crearVersion(servicio, { nombre: 'x', secciones: SECCIONES_BASE, peso: 101 }, 'j')).ok === false)
    const aviso = await crearVersion(servicio, { nombre: 'Dinero', secciones: { ...SECCIONES_BASE, extra: 'Menciona la facturación estimada de la empresa.' } }, 'j')
    ok('pedir dinero se guarda pero devuelve el aviso', aviso.ok && aviso.avisos.length === 1)
  }

  console.log('\n=== editar una versión ===')
  {
    const { almacen, servicio } = crear()
    await sembrarBase(servicio, null)
    const nueva = await crearVersion(servicio, { nombre: 'B', secciones: SECCIONES_BASE }, 'j')
    if (!nueva.ok) throw new Error('no se creó')
    const id = nueva.valor.id
    const base = almacen.tablas.correo_ia_versiones.find((v) => v.es_base)!

    ok('una versión sin usar admite cambiar las instrucciones', (await actualizarVersion(servicio, id, { secciones: { ...SECCIONES_BASE, extra: 'Prueba' } })).ok === true)
    ok('y el modelo y los ejemplos', (await actualizarVersion(servicio, id, { modelo: 'gpt-5.5', ejemplosIds: [], usarGanadores: false })).ok === true)
    ok('el reparto se cambia', (await actualizarVersion(servicio, id, { peso: 40, activa: true })).ok === true && almacen.tablas.correo_ia_versiones.find((v) => v.id === id)!.peso === 40)
    ok('peso inválido: 400', (await actualizarVersion(servicio, id, { peso: 500 })).ok === false)
    ok('una versión que no existe: 404', (await actualizarVersion(servicio, 'zzz', { peso: 1 })) .ok === false)

    // Ahora escribe un borrador: queda USADA
    almacen.tablas.correo_ia_borradores.push({ id: 'b1', version_id: id, enviado_at: null })
    ok('con un borrador apuntado está usada', await versionUsada(servicio, { id, esBase: false }))
    const bloqueada = await actualizarVersion(servicio, id, { secciones: { ...SECCIONES_BASE, extra: 'Otra' } })
    ok('ya NO admite cambiar las instrucciones (409: duplícala)', !bloqueada.ok && bloqueada.estado === 409 && /Duplícala/.test(bloqueada.error))
    ok('ni el modelo', !(await actualizarVersion(servicio, id, { modelo: 'gpt-5.6-luna' })).ok)
    ok('ni los ejemplos', !(await actualizarVersion(servicio, id, { ejemplosIds: [] })).ok)
    ok('pero sí el nombre, las notas y el reparto', (await actualizarVersion(servicio, id, { nombre: 'B renombrada', notas: 'Probando usted', peso: 10 })).ok === true && almacen.tablas.correo_ia_versiones.find((v) => v.id === id)!.nombre === 'B renombrada')
    const archivada = await actualizarVersion(servicio, id, { archivada: true })
    ok('archivarla la saca del reparto', archivada.ok && almacen.tablas.correo_ia_versiones.find((v) => v.id === id)!.activa === false && almacen.tablas.correo_ia_versiones.find((v) => v.id === id)!.archivada === true)

    ok('la original nunca se edita', !(await actualizarVersion(servicio, base.id as string, { secciones: SECCIONES_BASE })).ok)
    ok('ni se archiva', !(await actualizarVersion(servicio, base.id as string, { archivada: true })).ok)
    ok('pero su reparto sí se toca (es el trabajo)', (await actualizarVersion(servicio, base.id as string, { peso: 20, activa: true })).ok === true)
    ok('y no se le cambia el nombre', (await actualizarVersion(servicio, base.id as string, { nombre: 'Otra cosa' })).ok === true && base.nombre === 'Versión original')

    // Un borrador SIN versión es de la original (de antes de las versiones)
    almacen.tablas.correo_ia_borradores.push({ id: 'b2', version_id: null, enviado_at: '2026-10-23T11:00:00Z' })
    const versiones = await listarVersiones(servicio)
    const uso = await usoDeVersiones(servicio, versiones)
    ok('los borradores sin versión cuentan como de la original', (uso.get(base.id as string)?.generados ?? 0) === 1 && (uso.get(base.id as string)?.enviados ?? 0) === 1)
    ok('y los de cada versión, en la suya', (uso.get(id)?.generados ?? 0) === 1 && (uso.get(id)?.enviados ?? 0) === 0)
  }

  console.log('\n=== declarar una ganadora ===')
  {
    const { almacen, servicio } = crear()
    await sembrarBase(servicio, null)
    const b = await crearVersion(servicio, { nombre: 'B', secciones: SECCIONES_BASE, peso: 50, activa: true }, 'j')
    const c = await crearVersion(servicio, { nombre: 'C', secciones: SECCIONES_BASE, peso: 30, activa: true }, 'j')
    if (!b.ok || !c.ok) throw new Error('no se crearon')
    const r = await declararGanadora(servicio, b.valor.id)
    const estado = (n: string) => almacen.tablas.correo_ia_versiones.find((v) => v.nombre === n)!
    ok('la elegida se queda con todo el reparto', r.ok && estado('B').peso === 100 && estado('B').activa === true)
    ok('las demás se pausan, sin borrarse', estado('Versión original').activa === false && estado('C').activa === false && almacen.tablas.correo_ia_versiones.length === 3)
    ok('una versión que no existe: 404', !(await declararGanadora(servicio, 'zzz')).ok)
  }

  console.log('\n=== con qué se escribe un borrador ===')
  {
    const vacio = crear()
    const sinVersiones = await resolverConfiguracion(vacio.servicio, { tipo: 'entrar', ganadores: [] })
    ok('sin versiones: la configuración de siempre', sinVersiones.version === null && sinVersiones.instrucciones === INSTRUCCIONES && sinVersiones.modelo === null)
    ok('la de siempre es la de siempre', JSON.stringify(sinVersiones) === JSON.stringify(configuracionPorDefecto([], 'entrar')))

    const rota = crear()
    rota.almacen.rotas.correo_ia_versiones = '42P01'
    const sinTabla = await resolverConfiguracion(rota.servicio, { tipo: 'entrar', ganadores: [] })
    ok('sin la tabla (migración sin lanzar): la de siempre, sin lanzar', sinTabla.version === null && sinTabla.instrucciones === INSTRUCCIONES)

    const { almacen, servicio } = crear({ correo_ia_ejemplos: [{ id: UUID1, titulo: 'mi ejemplo', asunto: 'Mi asunto', texto: texto120, tipo: 'ambos', activo: true }] })
    await sembrarBase(servicio, null)
    const b = await crearVersion(servicio, { nombre: 'Usted', secciones: { ...SECCIONES_BASE, comoEscribes: 'CÓMO ESCRIBES:\n- Trata de usted y sé formal.\n- Entre 90 y 150 palabras en texto plano.' }, ejemplosIds: [UUID1], usarGanadores: false, modelo: 'gpt-5.6-luna', peso: 100, activa: true }, 'j')
    if (!b.ok) throw new Error('no se creó')
    // La original sale del reparto: solo juega B
    await actualizarVersion(servicio, almacen.tablas.correo_ia_versiones[0].id as string, { activa: false })
    const c = await resolverConfiguracion(servicio, { tipo: 'entrar', ganadores: [{ hiloId: 'h', buzonId: 'b', asunto: 'Auto', texto: 'x'.repeat(300), respondioEn: '2026-10-01T00:00:00Z', tipo: 'entrar' }], azar: 0.5 })
    ok('usa la versión que toca', c.version?.id === b.valor.id && c.version.nombre === 'Usted')
    ok('con SUS instrucciones y las reglas fijas', c.instrucciones.includes('Trata de usted') && c.instrucciones.includes('LO QUE NUNCA HACES') && !c.instrucciones.includes('Tuteas a la persona'))
    ok('con SUS ejemplos y sin los automáticos (la versión no los quiere)', c.ejemplos.length === 1 && c.ejemplos[0].asunto === 'Mi asunto')
    ok('y con su modelo', c.modelo === 'gpt-5.6-luna')

    const original = almacen.tablas.correo_ia_versiones.find((v) => v.es_base)!
    const mantiene = await resolverConfiguracion(servicio, { versionPedida: original.id as string, tipo: 'entrar', ganadores: [], azar: 0.5 })
    ok('al redactar de nuevo se mantiene la versión del primer borrador, aunque esté pausada', mantiene.version?.nombre === 'Versión original' && mantiene.instrucciones === INSTRUCCIONES)

    await actualizarVersion(servicio, b.valor.id, { archivada: true })
    await actualizarVersion(servicio, original.id as string, { activa: true, peso: 100 })
    const trasArchivar = await resolverConfiguracion(servicio, { versionPedida: b.valor.id, tipo: 'entrar', ganadores: [], azar: 0.1 })
    ok('una versión archivada ya no se mantiene: se sortea', trasArchivar.version?.nombre === 'Versión original')

    // Un ejemplo desactivado no se enseña
    almacen.tablas.correo_ia_ejemplos[0].activo = false
    const nueva = await crearVersion(servicio, { nombre: 'Con ejemplo apagado', secciones: SECCIONES_BASE, ejemplosIds: [UUID1], usarGanadores: false, peso: 100, activa: true }, 'j')
    await actualizarVersion(servicio, original.id as string, { activa: false })
    const sinEjemplo = await resolverConfiguracion(servicio, { versionPedida: nueva.ok ? nueva.valor.id : null, tipo: 'entrar', ganadores: [] })
    ok('un ejemplo desactivado no se enseña', sinEjemplo.ejemplos.length === 0)
  }

  console.log('\n=== los ejemplos propios ===')
  {
    const { almacen, servicio } = crear()
    const nuevo = await crearEjemplo(servicio, { asunto: 'Una idea', texto: texto120, tipo: 'entrar' }, 'jhanna')
    ok('se crea', nuevo.ok && nuevo.valor.titulo === 'Una idea' && nuevo.valor.tipo === 'entrar' && almacen.tablas.correo_ia_ejemplos[0].creado_por === 'jhanna')
    ok('uno inválido da error y no se guarda', !(await crearEjemplo(servicio, { asunto: '', texto: 'x' }, 'j')).ok && almacen.tablas.correo_ia_ejemplos.length === 1)
    if (!nuevo.ok) throw new Error('no se creó')
    const id = nuevo.valor.id

    ok('se edita si ninguna versión usada lo lee', (await actualizarEjemplo(servicio, id, { asunto: 'Otra idea', texto: texto120, tipo: 'ambos' }, false)).ok === true && almacen.tablas.correo_ia_ejemplos[0].asunto === 'Otra idea')
    const bloqueado = await actualizarEjemplo(servicio, id, { asunto: 'Cambiado', texto: texto120, tipo: 'ambos' }, true)
    ok('bloqueado: no se cambia el contenido (409)', !bloqueado.ok && bloqueado.estado === 409)
    ok('bloqueado: pero sí el título y la nota', (await actualizarEjemplo(servicio, id, { titulo: 'Mejor título', asunto: 'Otra idea', texto: texto120, tipo: 'ambos', nota: 'funciona con tiendas de moda' }, true)).ok === true && almacen.tablas.correo_ia_ejemplos[0].titulo === 'Mejor título')
    ok('bloqueado: no se puede desactivar', !(await actualizarEjemplo(servicio, id, { asunto: 'Otra idea', texto: texto120, tipo: 'ambos', activo: false }, true)).ok)
    ok('uno que no existe: 404', !(await actualizarEjemplo(servicio, 'zzz', { asunto: 'A', texto: texto120 }, false)).ok)
    ok('bloqueado no se borra', !(await borrarEjemplo(servicio, id, true)).ok && almacen.tablas.correo_ia_ejemplos.length === 1)
    ok('libre se borra', (await borrarEjemplo(servicio, id, false)).ok && almacen.tablas.correo_ia_ejemplos.length === 0)
  }

  console.log('\n=== qué ejemplos quedan bloqueados ===')
  {
    const v = (id: string, ejemplosIds: string[]) => ({ id, ejemplosIds }) as never
    const uso = new Map([
      ['usada', { generados: 3, enviados: 1 }],
      ['nueva', { generados: 0, enviados: 0 }],
    ])
    const b = ejemplosBloqueados([v('usada', ['e1', 'e2']), v('nueva', ['e3'])], uso)
    ok('los de una versión que ya escribió borradores, sí', b.has('e1') && b.has('e2'))
    ok('los de una versión sin estrenar, no', !b.has('e3'))
  }

  console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
