import type { ClienteDeBase } from '@/lib/fba/cajas'
import {
  DIAS_DE_VIDA_DEL_ENLACE,
  FORMA_DE_TOKEN,
  FaltaLaMigracion,
  MAX_CAJAS_PUBLICAS,
  anotarApertura,
  crearEnlace,
  datosParaEncajar,
  enlaceActivoDe,
  enlaceParaCopiar,
  guardarEncaje,
  porQueNoSePuedeEncajar,
  resolverEnlace,
  revocarEnlace,
  terminarEncaje,
  type ResolucionDeEnlace,
} from '@/lib/fba/encaje-enlace'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * EL ENLACE PÚBLICO DEL ENCAJE, DE PUNTA A PUNTA CONTRA UNA BASE DE MENTIRA.
 *
 * No se puede escribir en la base de producción para probar esto, y probar solo funciones sueltas
 * dejaría sin mirar lo que importa: que el token de un envío NO abra otro, que lo que se guarda
 * sustituya lo de antes sin dejar restos, que «terminar» use las mismas reglas que el ERP y que un
 * enlace caducado, desactivado o inventado no deje pasar. La base falsa imita lo justo de Supabase
 * —consultas encadenadas, índices únicos, borrado en cascada— y nada más.
 */

type Fila = Record<string, any>

class BaseFalsa {
  tablas: Record<string, Fila[]> = {}
  /** Un error que contestar siempre en esa tabla: para imitar «la migración no está lanzada» */
  falla: Record<string, { code: string; message: string }> = {}
  n = 0
  tabla(nombre: string): Fila[] {
    return (this.tablas[nombre] ??= [])
  }
  from(nombre: string) {
    return new Consulta(this, nombre)
  }
  /** Los índices únicos de verdad: devuelven el error de Postgres si el alta los rompe */
  restriccion(nombre: string, nueva: Fila, filas: Fila[]): { code: string; message: string } | null {
    const choca = (cond: (f: Fila) => boolean) => filas.some(cond)
    if (nombre === 'fba_enlaces_encaje') {
      if (choca((f) => f.token === nueva.token)) return { code: '23505', message: 'duplicate key value violates unique constraint "fba_enlaces_encaje_token_key"' }
      if ((nueva.revocado_at ?? null) === null && choca((f) => f.remesa_id === nueva.remesa_id && (f.revocado_at ?? null) === null)) return { code: '23505', message: 'duplicate key value violates unique constraint "fba_enlaces_encaje_uno_vivo_idx"' }
    }
    if (nombre === 'fba_cajas' && choca((f) => f.remesa_id === nueva.remesa_id && f.numero === nueva.numero)) return { code: '23505', message: 'duplicate key (remesa_id, numero)' }
    if (nombre === 'fba_caja_contenido' && choca((f) => f.caja_id === nueva.caja_id && f.sku === nueva.sku)) return { code: '23505', message: 'duplicate key (caja_id, sku)' }
    return null
  }
}

class Consulta {
  private filtros: Array<(f: Fila) => boolean> = []
  private accion: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private datos: any = null
  private ordenes: Array<{ col: string; asc: boolean }> = []
  private tope: number | null = null
  private devuelve = false
  private modo: 'lista' | 'single' | 'maybe' = 'lista'
  constructor(private base: BaseFalsa, private nombre: string) {}

  select(_columnas?: string) {
    if (this.accion !== 'select') this.devuelve = true
    return this
  }
  insert(d: any) {
    this.accion = 'insert'
    this.datos = d
    return this
  }
  update(d: any) {
    this.accion = 'update'
    this.datos = d
    return this
  }
  delete() {
    this.accion = 'delete'
    return this
  }
  eq(c: string, v: unknown) {
    this.filtros.push((f) => f[c] === v)
    return this
  }
  in(c: string, v: unknown[]) {
    this.filtros.push((f) => v.includes(f[c]))
    return this
  }
  is(c: string, v: null) {
    this.filtros.push((f) => (f[c] ?? null) === v)
    return this
  }
  order(c: string, o?: { ascending?: boolean }) {
    this.ordenes.push({ col: c, asc: o?.ascending !== false })
    return this
  }
  limit(n: number) {
    this.tope = n
    return this
  }
  single() {
    this.modo = 'single'
    return this
  }
  maybeSingle() {
    this.modo = 'maybe'
    return this
  }
  then(ok: (v: any) => unknown, ko?: (e: unknown) => unknown) {
    return Promise.resolve(this.ejecutar()).then(ok, ko)
  }

  private ejecutar(): { data: any; error: any } {
    const falla = this.base.falla[this.nombre]
    if (falla) return { data: null, error: falla }
    const filas = this.base.tabla(this.nombre)
    const coincide = (x: Fila) => this.filtros.every((fn) => fn(x))
    let resultado: Fila[] = []

    if (this.accion === 'select') {
      resultado = filas.filter(coincide)
      for (const o of [...this.ordenes].reverse()) resultado.sort((a, b) => (a[o.col] < b[o.col] ? -1 : a[o.col] > b[o.col] ? 1 : 0) * (o.asc ? 1 : -1))
      if (this.tope !== null) resultado = resultado.slice(0, this.tope)
    } else if (this.accion === 'insert') {
      // Como Postgres: lo que no se da se rellena con el valor por defecto de la columna (NULL, o el número que toque)
      const porDefecto: Fila = this.nombre === 'fba_enlaces_encaje' ? { revocado_at: null, abierto_veces: 0, ultimo_uso_at: null, ultima_edicion_at: null, terminado_at: null, creado_por: null } : {}
      const nuevas = (Array.isArray(this.datos) ? this.datos : [this.datos]).map((d: Fila) => ({ id: `id-${++this.base.n}`, ...porDefecto, ...d }))
      for (const nueva of nuevas) {
        const e = this.base.restriccion(this.nombre, nueva, filas)
        if (e) return { data: null, error: e }
        filas.push(nueva)
      }
      resultado = nuevas
    } else if (this.accion === 'update') {
      resultado = filas.filter(coincide)
      for (const x of resultado) Object.assign(x, this.datos)
    } else {
      resultado = filas.filter(coincide)
      this.base.tablas[this.nombre] = filas.filter((x) => !coincide(x))
      // ON DELETE CASCADE: el contenido cae con sus cajas
      if (this.nombre === 'fba_cajas') {
        const ids = new Set(resultado.map((x) => x.id))
        this.base.tablas['fba_caja_contenido'] = this.base.tabla('fba_caja_contenido').filter((x) => !ids.has(x.caja_id))
      }
    }

    const copia = resultado.map((x) => ({ ...x }))
    if (this.modo === 'single') return copia.length === 1 ? { data: copia[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no se ha devuelto exactamente una fila' } }
    if (this.modo === 'maybe') return { data: copia[0] ?? null, error: null }
    return { data: this.accion === 'select' || this.devuelve ? copia : null, error: null }
  }
}

const T0 = new Date('2026-10-20T08:00:00Z')
const DIA = 86_400_000

function sembrar(): { base: BaseFalsa; service: ClienteDeBase } {
  const base = new BaseFalsa()
  base.tablas.amazon_clients = [{ id: 'c1', name: 'Cobo Family' }, { id: 'c2', name: 'Otro Cliente' }]
  base.tablas.fba_remesas = [
    { id: 'r1', nombre: 'Reposición de octubre', fecha_envio: '2026-10-23', estado: 'encajando', client_id: 'c1', lista_at: null, updated_at: 'antes' },
    { id: 'r2', nombre: null, fecha_envio: '2026-10-01', estado: 'encajando', client_id: 'c2', lista_at: null, updated_at: 'antes' },
  ]
  base.tablas.fba_remesa_lineas = [
    { id: 'l1', remesa_id: 'r1', sku: 'A-10', unidades: 5, nombre: 'Zapatilla A', variante: 'Talla 39', referencia: 'A' },
    { id: 'l2', remesa_id: 'r1', sku: 'A-2', unidades: 3, nombre: 'Zapatilla A', variante: 'Talla 38', referencia: 'A' },
    { id: 'l3', remesa_id: 'r1', sku: 'B-1', unidades: 4, nombre: 'Sandalia B', variante: null, referencia: 'B' },
    { id: 'l4', remesa_id: 'r2', sku: 'Z-1', unidades: 9, nombre: 'Otra cosa', variante: null, referencia: null },
  ]
  return { base, service: base as unknown as ClienteDeBase }
}

const completa = (numero: number, contenido: Array<[string, number]>) => ({
  numero,
  largoCm: 40,
  anchoCm: 30,
  altoCm: 20,
  pesoKg: 8,
  contenido: contenido.map(([sku, unidades]) => ({ sku, unidades })),
})

async function resolver(token: string, service: ClienteDeBase, ahora = T0): Promise<Extract<ResolucionDeEnlace, { ok: true }>> {
  const r = await resolverEnlace(token, service, ahora)
  if (!r.ok) throw new Error(`el enlace no resuelve: ${r.motivo}`)
  return r
}

async function main() {
  console.log('\n=== crear, copiar y desactivar el enlace (lo que hace la agencia) ===')
  {
    const { base, service } = sembrar()
    ok('al principio no hay ninguno vivo', (await enlaceActivoDe('r1', service, T0)) === null)
    const e1 = await crearEnlace('r1', 'u1', service, T0)
    ok('token de 43 caracteres base64url (256 bits)', FORMA_DE_TOKEN.test(e1.token), e1.token)
    ok(`caduca a los ${DIAS_DE_VIDA_DEL_ENLACE} días`, Date.parse(e1.caducaAt) - T0.getTime() === DIAS_DE_VIDA_DEL_ENLACE * DIA)
    ok('queda guardado quién lo creó y a qué envío da paso', base.tabla('fba_enlaces_encaje')[0].creado_por === 'u1' && base.tabla('fba_enlaces_encaje')[0].remesa_id === 'r1')

    const e2 = await crearEnlace('r1', 'u1', service, new Date(T0.getTime() + 1000))
    ok('crear otro desactiva el anterior: solo uno vivo y tokens distintos', e1.token !== e2.token && base.tabla('fba_enlaces_encaje').filter((f) => f.revocado_at === null).length === 1 && base.tabla('fba_enlaces_encaje').find((f) => f.token === e1.token)!.revocado_at !== null)
    ok('el enlace vivo es el nuevo', (await enlaceActivoDe('r1', service, T0))?.token === e2.token)

    const igual = await enlaceParaCopiar('r1', 'u1', service, T0)
    ok('copiar de nuevo devuelve EL MISMO enlace (el cliente ya lo tiene)', igual.token === e2.token && base.tabla('fba_enlaces_encaje').length === 2)

    // Quedan 3 días: se alarga la fecha, sin tocar el token
    const casi = new Date(Date.parse(e2.caducaAt) - 3 * DIA)
    const renovado = await enlaceParaCopiar('r1', 'u1', service, casi)
    ok('con pocos días por delante se ALARGA la fecha y el token sigue siendo el mismo', renovado.token === e2.token && Date.parse(renovado.caducaAt) - casi.getTime() === DIAS_DE_VIDA_DEL_ENLACE * DIA)
    ok('y se guarda en la base', Date.parse(base.tabla('fba_enlaces_encaje').find((f) => f.token === e2.token)!.caduca_at) === Date.parse(renovado.caducaAt))

    // Caducado de verdad: ya no vale y copiar crea uno nuevo
    const despues = new Date(Date.parse(renovado.caducaAt) + DIA)
    ok('uno caducado no cuenta como vivo', (await enlaceActivoDe('r1', service, despues)) === null)
    const nuevo = await enlaceParaCopiar('r1', 'u1', service, despues)
    ok('copiar uno caducado crea otro distinto', nuevo.token !== e2.token && base.tabla('fba_enlaces_encaje').filter((f) => f.revocado_at === null).length === 1)

    ok('desactivar dice que había uno', (await revocarEnlace('r1', service, T0)) === true)
    ok('y después no queda ninguno vivo', (await enlaceActivoDe('r1', service, T0)) === null)
    ok('desactivar sin ninguno vivo dice que no había', (await revocarEnlace('r1', service, T0)) === false)
  }

  console.log('\n=== quién entra y quién no ===')
  {
    const { base, service } = sembrar()
    const e = await crearEnlace('r1', null, service, T0)
    const ok1 = await resolverEnlace(e.token, service, T0)
    ok('un enlace bueno resuelve al envío y al cliente', ok1.ok && ok1.remesa.id === 'r1' && ok1.remesa.clienteNombre === 'Cobo Family' && ok1.remesa.estado === 'encajando')

    for (const [nombre, token] of [['vacío', ''], ['demasiado corto', 'abc'], ['con signos raros', `${e.token.slice(0, 40)}!!!`], ['con la forma bien pero inventado', 'A'.repeat(43)], ['un intento de inyección', `${'x'.repeat(30)}' OR '1'='1`]] as const) {
      const r = await resolverEnlace(token, service, T0)
      ok(`${nombre}: «no es válido»`, !r.ok && r.motivo === 'invalido')
    }

    await revocarEnlace('r1', service, T0)
    const rev = await resolverEnlace(e.token, service, T0)
    ok('uno desactivado dice «revocado»', !rev.ok && rev.motivo === 'revocado')

    const e2 = await crearEnlace('r1', null, service, T0)
    const cad = await resolverEnlace(e2.token, service, new Date(T0.getTime() + 31 * DIA))
    ok('uno caducado dice «caducado»', !cad.ok && cad.motivo === 'caducado')
    ok('justo en el instante de caducar ya no vale', !(await resolverEnlace(e2.token, service, new Date(e2.caducaAt))).ok)

    // Sin la migración: desde fuera es un enlace que no vale; para la agencia, un aviso que dice qué falta
    base.falla.fba_enlaces_encaje = { code: 'PGRST205', message: "Could not find the table 'public.fba_enlaces_encaje' in the schema cache" }
    ok('sin la migración, el enlace «no es válido» (no un error)', (await resolverEnlace(e2.token, service, T0)).ok === false)
    let aviso = ''
    try {
      await enlaceActivoDe('r1', service, T0)
    } catch (e) {
      aviso = e instanceof FaltaLaMigracion ? e.message : `otro error: ${String(e)}`
    }
    ok('y para la agencia, «falta lanzar la migración 232»', /migración 232_fba_enlaces_encaje\.sql/.test(aviso), aviso)
    let aviso2 = ''
    try {
      await crearEnlace('r1', null, service, T0)
    } catch (e) {
      aviso2 = e instanceof FaltaLaMigracion ? 'falta' : String(e)
    }
    ok('crear sin la migración da el mismo aviso', aviso2 === 'falta')
    base.falla = { fba_enlaces_encaje: { code: '57014', message: 'timeout' } }
    let otro = false
    try {
      await resolverEnlace(e2.token, service, T0)
    } catch {
      otro = true
    }
    ok('un fallo de verdad (timeout) NO se disfraza de «enlace inválido»: se propaga', otro)
  }

  console.log('\n=== lo que ve el cliente ===')
  {
    const { service } = sembrar()
    const e = await crearEnlace('r1', null, service, T0)
    const r = await resolver(e.token, service)
    const d = await datosParaEncajar(r, service)
    ok('título, cliente y fecha del envío', d.titulo === 'Reposición de octubre' && d.cliente === 'Cobo Family' && d.fechaEnvio === '2026-10-23')
    ok('las referencias en orden natural (A-2 antes que A-10) y solo las de ESTE envío', d.lineas.map((l) => l.sku).join() === 'A-2,A-10,B-1', d.lineas.map((l) => l.sku).join())
    ok('con nombre, variante y unidades; sin precios ni nada más', d.lineas[0].nombre === 'Zapatilla A' && d.lineas[0].variante === 'Talla 38' && d.lineas[0].unidades === 3 && Object.keys(d.lineas[0]).sort().join() === 'nombre,referencia,sku,unidades,variante')
    ok('en «Encajando» se puede editar', d.editable && d.estado === 'encajando')
    const e2 = await crearEnlace('r2', null, service, T0)
    const d2 = await datosParaEncajar(await resolver(e2.token, service), service)
    ok('un envío sin nombre se titula con su fecha', d2.titulo === 'Envío del 01/10/2026', d2.titulo)
    ok('y el token del otro envío NO enseña las referencias de este', d2.lineas.map((l) => l.sku).join() === 'Z-1')
  }

  console.log('\n=== guardar las cajas ===')
  {
    const { base, service } = sembrar()
    const e = await crearEnlace('r1', null, service, T0)
    const eOtro = await crearEnlace('r2', null, service, T0)
    // El otro envío ya tiene su caja: no se puede tocar desde el primer enlace
    base.tablas.fba_cajas = [{ id: 'cajaR2', remesa_id: 'r2', numero: 1, largo_cm: 10, ancho_cm: 10, alto_cm: 10, peso_kg: 1 }]
    base.tablas.fba_caja_contenido = [{ id: 'cc9', caja_id: 'cajaR2', sku: 'Z-1', unidades: 9 }]

    const r = await resolver(e.token, service)
    const g = await guardarEncaje(r, [completa(1, [['A-10', 5], ['A-2', 1]]), completa(2, [['A-2', 2], ['B-1', 4]])], service, T0)
    ok('guarda dos cajas y dice que ya se puede terminar (cuadra y están completas)', g.ok && g.cajas === 2 && g.listo, JSON.stringify(g))
    ok('en la base hay 2 cajas de r1 y 3 líneas de contenido', base.tabla('fba_cajas').filter((c) => c.remesa_id === 'r1').length === 2 && base.tabla('fba_caja_contenido').filter((c) => base.tabla('fba_cajas').find((x) => x.id === c.caja_id)?.remesa_id === 'r1').length === 4)
    ok('la caja de OTRO envío no se ha tocado', base.tabla('fba_cajas').some((c) => c.id === 'cajaR2') && base.tabla('fba_caja_contenido').some((c) => c.id === 'cc9'))
    ok('queda anotada la última edición del enlace', base.tabla('fba_enlaces_encaje').find((f) => f.token === e.token)!.ultima_edicion_at === T0.toISOString())

    const g2 = await guardarEncaje(r, [completa(1, [['A-10', 5]])], service, T0)
    ok('guardar de nuevo SUSTITUYE lo de antes (una caja, sin restos), y no cuadra todavía', g2.ok && g2.cajas === 1 && !g2.listo && base.tabla('fba_cajas').filter((c) => c.remesa_id === 'r1').length === 1)
    ok('el contenido de las cajas borradas cayó con ellas', base.tabla('fba_caja_contenido').filter((c) => c.caja_id !== 'cajaR2').length === 1)

    const rOtro = await resolver(eOtro.token, service)
    const intento = await guardarEncaje(rOtro, [completa(1, [['A-10', 1]])], service, T0)
    ok('con el token de OTRO envío no se puede meter un SKU de este', !intento.ok && intento.estado === 400 && /A-10 no es de este envío/.test(intento.error), JSON.stringify(intento))

    const sobra = await guardarEncaje(r, [completa(1, [['A-2', 4]])], service, T0)
    ok('más unidades de las declaradas, rechazado', !sobra.ok && sobra.estado === 400 && /A-2: hay 4 unidades en las cajas y en el envío son 3/.test(sobra.error), JSON.stringify(sobra))
    ok('y lo rechazado no toca lo guardado', base.tabla('fba_cajas').filter((c) => c.remesa_id === 'r1').length === 1)

    const muchas = await guardarEncaje(r, Array.from({ length: MAX_CAJAS_PUBLICAS + 1 }, (_, i) => completa(i + 1, [])), service, T0)
    ok(`más de ${MAX_CAJAS_PUBLICAS} cajas, rechazado`, !muchas.ok && /demasiadas cajas/.test(muchas.error))
    const basura = await guardarEncaje(r, 'esto no es una lista', service, T0)
    ok('un cuerpo que no es una lista, rechazado con una frase', !basura.ok && basura.error === 'Falta la lista de cajas')

    // En otro paso, no se puede
    for (const estado of ['aprobada', 'lista', 'enviada'] as const) {
      const fuera = await guardarEncaje({ ...r, remesa: { ...r.remesa, estado } }, [completa(1, [['A-10', 1]])], service, T0)
      ok(`en «${estado}» no se pueden tocar las cajas, y se explica`, !fuera.ok && fuera.estado === 409 && fuera.error === porQueNoSePuedeEncajar(estado), JSON.stringify(fuera))
    }
  }

  console.log('\n=== terminar de encajar ===')
  {
    const { base, service } = sembrar()
    const e = await crearEnlace('r1', null, service, T0)
    const r = await resolver(e.token, service)

    const sinCajas = await terminarEncaje(r, service, T0)
    ok('sin cajas no se puede: UN motivo con las 12 unidades, no una pared', !sinCajas.ok && sinCajas.motivos?.length === 1 && sinCajas.motivos[0] === 'No hay ninguna caja: añade una y reparte las 12 unidades', JSON.stringify(sinCajas))
    ok('y el envío sigue en «encajando»', base.tabla('fba_remesas')[0].estado === 'encajando')

    await guardarEncaje(r, [completa(1, [['A-10', 5], ['A-2', 3]])], service, T0)
    const faltaB = await terminarEncaje(r, service, T0)
    ok('si falta una referencia lo dice con su SKU', !faltaB.ok && faltaB.motivos?.some((m) => /B-1: faltan 4 unidades por encajar de las 4 declaradas/.test(m)) === true, JSON.stringify(faltaB))

    await guardarEncaje(r, [completa(1, [['A-10', 5], ['A-2', 3]]), { ...completa(2, [['B-1', 4]]), pesoKg: null }], service, T0)
    const sinPeso = await terminarEncaje(r, service, T0)
    ok('cuadra pero a una caja le falta el peso: tampoco', !sinPeso.ok && sinPeso.motivos?.some((m) => /le faltan las medidas o el peso/.test(m)) === true, JSON.stringify(sinPeso))

    await guardarEncaje(r, [completa(1, [['A-10', 5], ['A-2', 3]]), completa(2, [['B-1', 4]])], service, T0)
    const fin = await terminarEncaje(r, service, T0)
    ok('con todo en orden termina', fin.ok)
    const remesa = base.tabla('fba_remesas')[0]
    ok('el envío pasa a «lista» con su fecha, como si lo hubiera hecho el cliente en el ERP', remesa.estado === 'lista' && remesa.lista_at === T0.toISOString() && remesa.updated_at === T0.toISOString())
    ok('queda anotado en el enlace cuándo terminó', base.tabla('fba_enlaces_encaje').find((f) => f.token === e.token)!.terminado_at === T0.toISOString())
    ok('el otro envío ni se entera', base.tabla('fba_remesas')[1].estado === 'encajando')

    const rDespues = await resolver(e.token, service)
    ok('con el enlace otra vez: ahora ve el envío en «lista» y ya no es editable', rDespues.remesa.estado === 'lista' && !(await datosParaEncajar(rDespues, service)).editable)
    const otraVez = await terminarEncaje(rDespues, service, T0)
    ok('terminar dos veces no hace nada y se explica', !otraVez.ok && otraVez.estado === 409 && /Ya has terminado/.test(otraVez.error))
    const guardarTarde = await guardarEncaje(rDespues, [completa(1, [['A-10', 1]])], service, T0)
    ok('y guardar cajas después de terminar, tampoco', !guardarTarde.ok && guardarTarde.estado === 409)
  }

  console.log('\n=== la agencia se adelanta mientras el cliente termina ===')
  {
    const { base, service } = sembrar()
    const e = await crearEnlace('r1', null, service, T0)
    const r = await resolver(e.token, service)
    await guardarEncaje(r, [completa(1, [['A-10', 5], ['A-2', 3], ['B-1', 4]])], service, T0)
    // Entre que la página resuelve el token y se aplica el cambio, la agencia vuelve el envío un paso atrás
    base.tabla('fba_remesas')[0].estado = 'aprobada'
    const choque = await terminarEncaje(r, service, T0)
    ok('el cambio de estado NO se aplica si el envío ya no está en «encajando»', !choque.ok && choque.estado === 409 && /acaba de cambiar de paso/.test(choque.error), JSON.stringify(choque))
    ok('y el estado de la agencia se respeta', base.tabla('fba_remesas')[0].estado === 'aprobada')
  }

  console.log('\n=== el contador de aperturas ===')
  {
    const { base, service } = sembrar()
    const e = await crearEnlace('r1', null, service, T0)
    await anotarApertura(e, service, T0)
    await anotarApertura({ ...e, abiertoVeces: 1 }, service, new Date(T0.getTime() + 5000))
    const f = base.tabla('fba_enlaces_encaje').find((x) => x.token === e.token)!
    ok('cuenta las aperturas y recuerda la última', f.abierto_veces === 2 && f.ultimo_uso_at === new Date(T0.getTime() + 5000).toISOString())
    base.falla.fba_enlaces_encaje = { code: '57014', message: 'timeout' }
    let reventó = false
    try {
      await anotarApertura(e, service, T0)
    } catch {
      reventó = true
    }
    ok('si el contador falla, la página NO se cae', !reventó)
  }

  console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error('ERR', e)
  process.exit(1)
})
