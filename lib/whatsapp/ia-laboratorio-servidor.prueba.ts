import {
  actualizarVersion,
  aVersion,
  crearVersion,
  leerVersion,
  listarVersiones,
  olvidarPerfil,
  perfilEnProduccion,
  publicarVersion,
  sembrarBase,
} from '@/lib/whatsapp/ia-laboratorio-servidor'
import { PERFIL_DE_SERIE, copiaDelPerfil, esElPerfilDeSerie } from '@/lib/whatsapp/ia-perfil'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/* ------------------------------------------------------------------ */
/* Una base de datos de mentira, en memoria, con lo justo que usa el módulo */
/* ------------------------------------------------------------------ */

type Fila = Record<string, unknown>
interface Almacen {
  filas: Fila[]
  /** Si es un código, la siguiente consulta falla con él (por ejemplo 42P01: la tabla no existe) */
  rota: string | null
  /** Si es un número, ese número de escrituras más tarde, la siguiente falla */
  fallaLaEscrituraNumero: number | null
  escrituras: number
  contador: number
  lecturas: number
}

class Consulta implements PromiseLike<{ data: unknown; error: unknown }> {
  private op: 'select' | 'insert' | 'update' = 'select'
  private filtros: Array<(f: Fila) => boolean> = []
  private fila: Fila | null = null
  private parche: Fila | null = null
  private orden: { col: string; asc: boolean } | null = null
  private tope: number | null = null
  private unico: 'single' | 'maybe' | null = null
  private devolver = false
  constructor(private a: Almacen) {}
  select(_cols?: string) {
    if (this.op === 'insert' || this.op === 'update') this.devolver = true
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
  eq(c: string, v: unknown) {
    this.filtros.push((f) => f[c] === v)
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
  then<T1, T2>(res?: ((v: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>) | null, rej?: ((r: unknown) => T2 | PromiseLike<T2>) | null) {
    return Promise.resolve(this.ejecutar()).then(res, rej)
  }
  private ejecutar(): { data: unknown; error: unknown } {
    if (this.a.rota) return { data: null, error: { code: this.a.rota, message: 'falla' } }
    const { filas } = this.a
    let resultado: Fila[] = []
    if (this.op === 'select') this.a.lecturas++
    if (this.op === 'insert' || this.op === 'update') {
      this.a.escrituras++
      if (this.a.fallaLaEscrituraNumero === this.a.escrituras) return { data: null, error: { code: 'XX000', message: 'falla a mitad' } }
    }
    if (this.op === 'insert') {
      const nueva: Fila = { notas: null, en_produccion: false, es_base: false, archivada: false, publicada_at: null, publicada_por: null, creada_por: null, creada_at: '2026-10-26T10:00:00Z', actualizada_at: '2026-10-26T10:00:00Z', id: `id-${++this.a.contador}`, ...this.fila }
      // Los dos índices únicos de la tabla
      if (nueva.es_base === true && filas.some((f) => f.es_base === true)) return { data: null, error: { code: '23505', message: 'duplicada' } }
      if (nueva.en_produccion === true && filas.some((f) => f.en_produccion === true)) return { data: null, error: { code: '23505', message: 'duplicada' } }
      filas.push(nueva)
      resultado = [nueva]
      if (!this.devolver) return { data: null, error: null }
    } else {
      const coinciden = filas.filter((f) => this.filtros.every((fn) => fn(f)))
      if (this.op === 'update') {
        if (this.parche?.en_produccion === true && filas.some((f) => f.en_produccion === true && !coinciden.includes(f))) return { data: null, error: { code: '23505', message: 'duplicada' } }
        for (const f of coinciden) Object.assign(f, this.parche)
        resultado = coinciden
        if (!this.devolver) return { data: null, error: null }
      } else {
        resultado = coinciden
        if (this.orden) {
          const { col, asc } = this.orden
          resultado = [...resultado].sort((x, y) => (String(x[col]) < String(y[col]) ? -1 : String(x[col]) > String(y[col]) ? 1 : 0) * (asc ? 1 : -1))
        }
        if (this.tope !== null) resultado = resultado.slice(0, this.tope)
      }
    }
    if (this.unico === 'single') return resultado.length === 1 ? { data: resultado[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no hay una fila' } }
    if (this.unico === 'maybe') return { data: resultado[0] ?? null, error: null }
    return { data: resultado, error: null }
  }
}

function crear() {
  const almacen: Almacen = { filas: [], rota: null, fallaLaEscrituraNumero: null, escrituras: 0, contador: 0, lecturas: 0 }
  return { almacen, servicio: { from: (_t: string) => new Consulta(almacen) } as never }
}

const perfilFormal = (() => {
  const p = copiaDelPerfil(PERFIL_DE_SERIE)
  p.ajustes.tono = 'formal'
  return p
})()

async function main() {
  console.log('\n=== la versión original ===')
  {
    const { almacen, servicio } = crear()
    await sembrarBase(servicio, 'u1')
    await sembrarBase(servicio, 'u1')
    ok('se crea una sola vez', almacen.filas.length === 1 && almacen.filas[0].es_base === true)
    ok('es la de serie, y es la que está en producción', esElPerfilDeSerie(aVersion(almacen.filas[0] as never).perfil) && almacen.filas[0].en_produccion === true)
    const v = aVersion(almacen.filas[0] as never)
    ok('está bloqueada desde el principio (no se edita, se duplica)', v.bloqueada && v.esBase && v.publicadaAt !== null)
    const doble = crear()
    await Promise.all([sembrarBase(doble.servicio, null), sembrarBase(doble.servicio, null)])
    ok('dos peticiones a la vez no la duplican ni dan error', doble.almacen.filas.length === 1)
    const ocupada = crear()
    ocupada.almacen.filas.push({ id: 'otra', nombre: 'Otra', perfil: perfilFormal, en_produccion: true, es_base: false, archivada: false, publicada_at: '2026-10-25T10:00:00Z' })
    await sembrarBase(ocupada.servicio, 'u1')
    ok('si ya hay otra en producción, la original no le quita el sitio', ocupada.almacen.filas.find((f) => f.es_base === true)?.en_produccion === false && ocupada.almacen.filas.find((f) => f.id === 'otra')?.en_produccion === true)
  }

  console.log('\n=== crear un borrador ===')
  {
    const { almacen, servicio } = crear()
    await sembrarBase(servicio, 'u1')
    const r = await crearVersion(servicio, { nombre: '  Tono de usted  ', notas: 'Probar el trato formal', perfil: perfilFormal }, 'u1')
    ok('nace como borrador: sin publicar, fuera de producción y sin bloquear', r.ok && !r.valor.enProduccion && r.valor.publicadaAt === null && !r.valor.bloqueada && !r.valor.esBase)
    ok('con su nombre limpio y sus notas', r.ok && r.valor.nombre === 'Tono de usted' && r.valor.notas === 'Probar el trato formal')
    ok('el perfil se guarda tal cual', r.ok && r.valor.perfil.ajustes.tono === 'formal' && almacen.filas.length === 2)
    ok('quién la creó queda apuntado', almacen.filas[1].creada_por === 'u1')

    const sinNombre = await crearVersion(servicio, { nombre: '   ', perfil: perfilFormal }, 'u1')
    ok('sin nombre, no', !sinNombre.ok && sinNombre.estado === 400)
    const nombreLargo = await crearVersion(servicio, { nombre: 'x'.repeat(81), perfil: perfilFormal }, 'u1')
    ok('con un nombre larguísimo, no', !nombreLargo.ok && nombreLargo.estado === 400)
    const rota = await crearVersion(servicio, { nombre: 'Rota', perfil: { ajustes: { tono: 'gritando' } } }, 'u1')
    ok('con un perfil que no vale, no, y dice por qué', !rota.ok && rota.estado === 400 && /tono/i.test(rota.error))
    const avisa = await crearVersion(servicio, { nombre: 'Con aviso', perfil: { secciones: { extra: 'Menciona la facturación de la empresa.' } } }, 'u1')
    ok('un perfil que pide algo prohibido se guarda pero avisa', avisa.ok && avisa.avisos.some((a) => /facturación/.test(a)))
    ok('lo que no valió no se guardó', almacen.filas.length === 3)
  }

  console.log('\n=== editar ===')
  {
    const { almacen, servicio } = crear()
    await sembrarBase(servicio, 'u1')
    const c = await crearVersion(servicio, { nombre: 'Borrador', perfil: perfilFormal }, 'u1')
    if (!c.ok) throw new Error('no se pudo crear')
    const id = c.valor.id

    const cambio = await actualizarVersion(servicio, id, { nombre: 'Borrador 2', notas: 'nueva nota', perfil: { ...perfilFormal, ajustes: { ...perfilFormal.ajustes, longitud: 'muy_corto' } } })
    ok('un borrador se edita entero', cambio.ok && cambio.valor.nombre === 'Borrador 2' && cambio.valor.notas === 'nueva nota' && cambio.valor.perfil.ajustes.longitud === 'muy_corto')
    const sinPerfil = await actualizarVersion(servicio, id, { nombre: 'Solo el nombre' })
    ok('se puede cambiar solo el nombre y el perfil queda como estaba', sinPerfil.ok && sinPerfil.valor.nombre === 'Solo el nombre' && sinPerfil.valor.perfil.ajustes.longitud === 'muy_corto')
    const malo = await actualizarVersion(servicio, id, { perfil: { ajustes: { emojis: 'muchos' } } })
    ok('un perfil malo no pisa el bueno', !malo.ok && malo.estado === 400 && (await leerVersion(servicio, id))?.perfil.ajustes.emojis === 'ninguno')
    const nombreMalo = await actualizarVersion(servicio, id, { nombre: '' })
    ok('un nombre vacío, no', !nombreMalo.ok && nombreMalo.estado === 400)
    const inexistente = await actualizarVersion(servicio, 'no-existe', { nombre: 'x' })
    ok('una que no existe, 404', !inexistente.ok && inexistente.estado === 404)

    const base = almacen.filas.find((f) => f.es_base === true)!
    const sobreLaBase = await actualizarVersion(servicio, base.id as string, { perfil: perfilFormal })
    ok('la original no se edita: 409 y dice que se duplique', !sobreLaBase.ok && sobreLaBase.estado === 409 && /duplícala/.test(sobreLaBase.error))
    const nombreDeLaBase = await actualizarVersion(servicio, base.id as string, { nombre: 'Cambiado', notas: 'x' })
    ok('y conserva su nombre y sus notas', nombreDeLaBase.ok && nombreDeLaBase.valor.nombre === 'Versión original' && nombreDeLaBase.valor.notas !== 'x')

    await publicarVersion(servicio, id, 'u2')
    const publicada = await actualizarVersion(servicio, id, { perfil: perfilFormal })
    ok('una que ya ha estado en producción tampoco: 409', !publicada.ok && publicada.estado === 409 && /producción/.test(publicada.error))
    const peroElNombre = await actualizarVersion(servicio, id, { nombre: 'Con otro nombre', notas: 'ahora con notas' })
    ok('pero su nombre y sus notas sí se pueden tocar', peroElNombre.ok && peroElNombre.valor.nombre === 'Con otro nombre' && peroElNombre.valor.notas === 'ahora con notas')
  }

  console.log('\n=== publicar ===')
  {
    const { almacen, servicio } = crear()
    await sembrarBase(servicio, 'u1')
    const a = await crearVersion(servicio, { nombre: 'A', perfil: perfilFormal }, 'u1')
    const b = await crearVersion(servicio, { nombre: 'B', perfil: { ...perfilFormal, ajustes: { ...perfilFormal.ajustes, tono: 'neutro' } } }, 'u1')
    if (!a.ok || !b.ok) throw new Error('no se pudo crear')
    const baseId = almacen.filas.find((f) => f.es_base === true)!.id as string

    const p = await publicarVersion(servicio, a.valor.id, 'u2')
    ok('al publicar una, la usa el equipo y la original deja de estar en producción', p.ok && p.valor.find((v) => v.id === a.valor.id)?.enProduccion === true && p.valor.find((v) => v.id === baseId)?.enProduccion === false)
    ok('queda apuntado cuándo y quién, y se bloquea', almacen.filas.find((f) => f.id === a.valor.id)?.publicada_por === 'u2' && almacen.filas.find((f) => f.id === a.valor.id)?.publicada_at !== null)
    ok('solo hay una en producción', almacen.filas.filter((f) => f.en_produccion === true).length === 1)
    ok('publicar la que ya está es un no-hacer-nada', (await publicarVersion(servicio, a.valor.id, 'u3')).ok && almacen.filas.find((f) => f.id === a.valor.id)?.publicada_por === 'u2')

    const q = await publicarVersion(servicio, b.valor.id, 'u2')
    ok('publicar otra quita la anterior de producción (sin borrarla)', q.ok && almacen.filas.filter((f) => f.en_produccion === true).map((f) => f.id).join() === b.valor.id && almacen.filas.length === 3)
    const vuelta = await publicarVersion(servicio, baseId, 'u2')
    ok('se puede volver a la original publicándola de nuevo (vuelta atrás)', vuelta.ok && almacen.filas.find((f) => f.id === baseId)?.en_produccion === true && almacen.filas.filter((f) => f.en_produccion === true).length === 1)

    const nadie = await publicarVersion(servicio, 'no-existe', 'u2')
    ok('una que no existe, 404', !nadie.ok && nadie.estado === 404)
    await actualizarVersion(servicio, a.valor.id, { archivada: true })
    const archivada = await publicarVersion(servicio, a.valor.id, 'u2')
    ok('una archivada no se publica, y se dice por qué', !archivada.ok && archivada.estado === 409 && /archivada/.test(archivada.ok ? '' : archivada.error))
  }

  console.log('\n=== publicar y que falle a mitad ===')
  {
    const { almacen, servicio } = crear()
    await sembrarBase(servicio, 'u1')
    const a = await crearVersion(servicio, { nombre: 'A', perfil: perfilFormal }, 'u1')
    if (!a.ok) throw new Error('no se pudo crear')
    const baseId = almacen.filas.find((f) => f.es_base === true)!.id as string
    // Escrituras de ahora en adelante: 1) quitar la anterior, 2) poner la nueva (falla), 3) restaurar la anterior
    almacen.fallaLaEscrituraNumero = almacen.escrituras + 2
    let lanzo = false
    try {
      await publicarVersion(servicio, a.valor.id, 'u2')
    } catch {
      lanzo = true
    }
    ok('lanza, para que la ruta diga que no ha podido', lanzo)
    ok('y la que estaba en producción se queda en producción', almacen.filas.find((f) => f.id === baseId)?.en_produccion === true && almacen.filas.filter((f) => f.en_produccion === true).length === 1)
    ok('la que no se pudo publicar sigue siendo un borrador', almacen.filas.find((f) => f.id === a.valor.id)?.publicada_at === null)
  }

  console.log('\n=== archivar ===')
  {
    const { almacen, servicio } = crear()
    await sembrarBase(servicio, 'u1')
    const a = await crearVersion(servicio, { nombre: 'A', perfil: perfilFormal }, 'u1')
    if (!a.ok) throw new Error('no se pudo crear')
    const baseId = almacen.filas.find((f) => f.es_base === true)!.id as string
    const arch = await actualizarVersion(servicio, a.valor.id, { archivada: true })
    ok('un borrador se archiva y se restaura', arch.ok && arch.valor.archivada && (await actualizarVersion(servicio, a.valor.id, { archivada: false })).ok)
    const sobreBase = await actualizarVersion(servicio, baseId, { archivada: true })
    ok('la original no', !sobreBase.ok && sobreBase.estado === 409)
    await publicarVersion(servicio, a.valor.id, 'u2')
    const enProduccion = await actualizarVersion(servicio, a.valor.id, { archivada: true })
    ok('la que usa el equipo ahora no: hay que publicar otra antes', !enProduccion.ok && enProduccion.estado === 409 && /publica otra/.test(enProduccion.error))
  }

  console.log('\n=== listar ===')
  {
    const { servicio } = crear()
    await sembrarBase(servicio, 'u1')
    await crearVersion(servicio, { nombre: 'A', perfil: perfilFormal }, 'u1')
    const l = await listarVersiones(servicio)
    ok('salen en el orden en que se crearon, con la original primero', l.length === 2 && l[0].esBase && l[1].nombre === 'A')
    ok('un perfil roto en la base se lee como el de serie, sin romper la lista', (() => {
      const v = aVersion({ id: 'x', nombre: 'Rota', notas: null, perfil: { ajustes: { tono: 'gritando' } }, en_produccion: false, es_base: false, archivada: false, publicada_at: null, publicada_por: null, creada_por: null, creada_at: 'a', actualizada_at: 'b' })
      return esElPerfilDeSerie(v.perfil)
    })())
  }

  console.log('\n=== el perfil con el que se escribe ===')
  {
    olvidarPerfil()
    const { almacen, servicio } = crear()
    const r0 = await perfilEnProduccion(servicio, 1_000)
    ok('sin ninguna publicada (o sin sembrar), lo de serie', esElPerfilDeSerie(r0.perfil) && r0.version === null)

    olvidarPerfil()
    await sembrarBase(servicio, 'u1')
    const r1 = await perfilEnProduccion(servicio, 1_000)
    ok('con la original en producción, es la de serie y dice cuál es', esElPerfilDeSerie(r1.perfil) && r1.version?.nombre === 'Versión original')

    const a = await crearVersion(servicio, { nombre: 'Tono de usted', perfil: perfilFormal }, 'u1')
    if (!a.ok) throw new Error('no se pudo crear')
    await publicarVersion(servicio, a.valor.id, 'u2')
    const r2 = await perfilEnProduccion(servicio, 2_000)
    ok('al publicar otra se usa ésa (publicar olvida lo guardado)', r2.perfil.ajustes.tono === 'formal' && r2.version?.nombre === 'Tono de usted')

    const lecturas = almacen.lecturas
    await perfilEnProduccion(servicio, 2_500)
    await perfilEnProduccion(servicio, 20_000)
    ok('durante 30 segundos no se vuelve a leer la base', almacen.lecturas === lecturas)
    await perfilEnProduccion(servicio, 40_000)
    ok('pasado ese rato, sí', almacen.lecturas === lecturas + 1)

    olvidarPerfil()
    almacen.rota = '42P01'
    const sinTabla = await perfilEnProduccion(servicio, 50_000)
    ok('sin la tabla (migración sin lanzar), lo de serie y sin lanzar', esElPerfilDeSerie(sinTabla.perfil) && sinTabla.version === null)
    olvidarPerfil()
    almacen.rota = 'XX000'
    const rota = await perfilEnProduccion(servicio, 60_000)
    ok('con la base caída, también lo de serie', esElPerfilDeSerie(rota.perfil))
    almacen.rota = null
    const antes = almacen.lecturas
    await perfilEnProduccion(servicio, 65_000)
    ok('un fallo se recuerda 10 segundos: dentro de ese rato no se vuelve a leer', almacen.lecturas === antes)
    const recuperada = await perfilEnProduccion(servicio, 71_000)
    ok('pasados los 10 segundos (y no 30) vuelve a leer, y encuentra lo bueno', almacen.lecturas === antes + 1 && recuperada.version?.nombre === 'Tono de usted')

    olvidarPerfil()
    const copiaA = (await perfilEnProduccion(servicio, 100_000)).perfil
    copiaA.ajustes.tono = 'cercano'
    copiaA.secciones.extra = 'estropeado'
    const copiaB = (await perfilEnProduccion(servicio, 100_500)).perfil
    ok('cada quien recibe su copia: tocar la que se devuelve no estropea la guardada', copiaB.ajustes.tono === 'formal' && copiaB.secciones.extra === '')
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
