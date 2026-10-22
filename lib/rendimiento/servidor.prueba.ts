import type { createServiceClient } from '@/lib/supabase/service'
import { decryptToken } from '@/lib/amazon/crypto'
import { pedirTurnoDeLectura } from '@/lib/fba/lectura-en-curso'
import { MENSAJE_DE_ERROR, type DepsRinkel } from '@/lib/rendimiento/rinkel'
import { autorizarObjetivo, contarLlamadas, desvincularClave, esComercial, guardarLlamadas, huellaDeClave, leadsPorTelefonoDe, leerCuentaDe, vincularClave } from '@/lib/rendimiento/servidor'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * LO QUE EL SERVIDOR HACE CON LA CLAVE DE RINKEL.
 *
 * Una base falsa en memoria que imita lo que se usa de supabase-js (select/eq/range/maybeSingle, upsert con
 * onConflict, update, delete y el recuento) y una API de Rinkel falsa con páginas. Lo que se vigila es lo que
 * duele si falla: que la clave no quede en claro ni se reenvíe, que dos personas no compartan una cuenta y que un
 * fallo de la base no se le cuente a nadie como un fallo de su Rinkel.
 */

process.env.AMAZON_TOKEN_KEY = 'ab'.repeat(32)

type Fila = Record<string, unknown>
type Servicio = ReturnType<typeof createServiceClient>

/* ------------------------------ la base falsa ------------------------------ */

class Consulta {
  private filtros: Array<[string, unknown]> = []
  private operacion: 'select' | 'update' | 'delete' | 'upsert' = 'select'
  private parche: Fila = {}
  private filas: Fila[] = []
  private conflicto: string[] = []
  private rango: [number, number] | null = null
  private soloContar = false

  constructor(
    private base: Base,
    private tabla: string
  ) {}

  select(_columnas?: string, opciones?: { count?: string; head?: boolean }) {
    this.operacion = 'select'
    this.soloContar = !!opciones?.head
    return this
  }
  eq(columna: string, valor: unknown) {
    this.filtros.push([columna, valor])
    return this
  }
  order() {
    return this
  }
  range(desde: number, hasta: number) {
    this.rango = [desde, hasta]
    return this
  }
  update(parche: Fila) {
    this.operacion = 'update'
    this.parche = parche
    return this
  }
  delete() {
    this.operacion = 'delete'
    return this
  }
  upsert(filas: Fila | Fila[], opciones?: { onConflict?: string }) {
    this.operacion = 'upsert'
    this.filas = Array.isArray(filas) ? filas : [filas]
    this.conflicto = (opciones?.onConflict ?? 'id').split(',')
    return this
  }
  maybeSingle() {
    return this.ejecutar(true)
  }
  then<T>(res: (v: unknown) => T, rej?: (e: unknown) => T) {
    return this.ejecutar(false).then(res, rej)
  }

  private async ejecutar(unica: boolean): Promise<{ data: unknown; error: { message: string } | null; count?: number }> {
    this.base.consultas.push(`${this.operacion} ${this.tabla}`)
    const fallo = this.base.falla.get(`${this.operacion} ${this.tabla}`)
    if (fallo) return { data: null, error: { message: fallo } }
    const tabla = this.base.tabla(this.tabla)
    const cumple = (f: Fila) => this.filtros.every(([c, v]) => f[c] === v)

    if (this.operacion === 'select') {
      let encontradas = tabla.filter(cumple)
      if (this.soloContar) return { data: null, error: null, count: encontradas.length }
      if (this.rango) encontradas = encontradas.slice(this.rango[0], this.rango[1] + 1)
      return unica ? { data: encontradas[0] ?? null, error: null } : { data: encontradas, error: null }
    }
    if (this.operacion === 'update') {
      for (const f of tabla.filter(cumple)) Object.assign(f, this.parche)
      return { data: null, error: null }
    }
    if (this.operacion === 'delete') {
      const quedan = tabla.filter((f) => !cumple(f))
      tabla.length = 0
      tabla.push(...quedan)
      return { data: null, error: null }
    }
    // upsert: la restricción única se comprueba con el conflicto pedido y con la huella (única de verdad en la base)
    for (const nueva of this.filas) {
      const igual = tabla.find((f) => this.conflicto.every((c) => f[c] === nueva[c]))
      if (this.tabla === 'rinkel_claves') {
        const otraConLaMismaHuella = tabla.find((f) => f.huella === nueva.huella && f.user_id !== nueva.user_id)
        if (otraConLaMismaHuella) return { data: null, error: { message: 'duplicate key value violates unique constraint "rinkel_claves_huella_key"' } }
      }
      if (igual) Object.assign(igual, nueva)
      else tabla.push({ ...nueva })
    }
    return { data: null, error: null }
  }
}

class Base {
  tablas = new Map<string, Fila[]>()
  consultas: string[] = []
  falla = new Map<string, string>()
  tabla(nombre: string): Fila[] {
    if (!this.tablas.has(nombre)) this.tablas.set(nombre, [])
    return this.tablas.get(nombre)!
  }
  from(nombre: string) {
    return new Consulta(this, nombre)
  }
}

const servicio = (b: Base) => b as unknown as Servicio

/* ------------------------------ el Rinkel falso ------------------------------ */

const llamadaCruda = (i: number, numero: string) => ({
  id: `rk-${String(i).padStart(4, '0')}`,
  callId: `call-${i}`,
  date: new Date(Date.parse('2026-10-21T08:00:00Z') + i * 60_000).toISOString(),
  direction: 'outbound',
  externalNumber: { anonymous: false, e164: numero },
  internalNumber: { label: 'Maoli Liberty Seller' },
  duration: 30,
  status: 'ANSWERED',
  missedReason: null,
  callRecording: i % 2 === 0 ? { id: `rec-${i}`, availableUntil: '2027-01-19T00:00:00.000Z' } : null,
})

function rinkelFalso(opciones: { llamadas?: unknown[]; estadoDeLlamadas?: number; usuarios?: unknown } = {}) {
  const llamadas = opciones.llamadas ?? []
  const peticiones: string[] = []
  const fetchFalso = (async (url: RequestInfo | URL) => {
    const u = new URL(String(url))
    peticiones.push(u.pathname + u.search)
    if (u.pathname.endsWith('/call-detail-records')) {
      if (opciones.estadoDeLlamadas && opciones.estadoDeLlamadas !== 200) return new Response('{}', { status: opciones.estadoDeLlamadas })
      const porPagina = Number(u.searchParams.get('perPage') ?? 50)
      const pagina = Number(u.searchParams.get('page') ?? 1)
      const ordenadas = [...llamadas].reverse()
      return Response.json({ data: ordenadas.slice((pagina - 1) * porPagina, pagina * porPagina), meta: { pagination: { totalItems: ordenadas.length, totalPages: Math.max(1, Math.ceil(ordenadas.length / porPagina)), currentPage: pagina, perPage: porPagina } } })
    }
    if (u.pathname.endsWith('/users')) return Response.json(opciones.usuarios ?? { data: [{ fullName: 'Maoli Gómez' }] })
    if (u.pathname.endsWith('/numbers')) return Response.json({ data: [{ label: 'Maoli Liberty Seller', localizedNumber: '+34 931 11 22 33' }] })
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  const deps: Partial<DepsRinkel> = { fetch: fetchFalso, esperaMs: 1000 }
  return { deps, peticiones }
}

const CLAVE_DE_MAOLI = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
const CLAVE_DE_DANIELA = '1111111111111111111111111111111111111111111111111111111111111111'
const MAOLI = 'u-maoli'
const DANIELA = 'u-daniela'

async function main() {
  console.log('\n=== la huella de una clave ===')
  {
    ok('es estable y de 64 cifras', huellaDeClave(CLAVE_DE_MAOLI) === huellaDeClave(CLAVE_DE_MAOLI) && huellaDeClave(CLAVE_DE_MAOLI).length === 64)
    ok('dos claves distintas dan huellas distintas', huellaDeClave(CLAVE_DE_MAOLI) !== huellaDeClave(CLAVE_DE_DANIELA))
    ok('y la huella no contiene la clave', !huellaDeClave(CLAVE_DE_MAOLI).includes(CLAVE_DE_MAOLI.slice(0, 12)))
  }

  console.log('\n=== vincular una clave ===')
  {
    const b = new Base()
    const llamadas = Array.from({ length: 70 }, (_, i) => llamadaCruda(i + 1, `+3462200${String(i + 1).padStart(4, '0')}`))
    const r = rinkelFalso({ llamadas })
    b.tabla('cold_leads').push({ id: 'lead-1', assigned_to: MAOLI, phone: '622 00 00 05', telefonos_extra: null }, { id: 'lead-2', assigned_to: DANIELA, phone: '+34 622000006', telefonos_extra: null })
    const v = await vincularClave(servicio(b), MAOLI, `  ${CLAVE_DE_MAOLI}\n`, { presupuestoMs: 600_000, rinkel: r.deps })

    ok('vincula', v.ok)
    if (!v.ok) throw new Error(v.mensaje)
    ok('con los datos de la cuenta que dio Rinkel', v.cuenta.usuario === 'Maoli Gómez' && v.cuenta.numero === 'Maoli Liberty Seller · +34 931 11 22 33' && v.cuenta.totalLlamadas === 70)
    ok('y el final de la clave para reconocerla', v.finalClave === '8f90')

    const guardada = b.tabla('rinkel_claves')[0] as { clave_cifrada: string; huella: string; final_clave: string }
    ok('la clave se guarda CIFRADA: lo guardado no es la clave ni la contiene', guardada.clave_cifrada !== CLAVE_DE_MAOLI && !guardada.clave_cifrada.includes(CLAVE_DE_MAOLI) && guardada.clave_cifrada.startsWith('v1.'))
    ok('y se descifra con su propósito', decryptToken(guardada.clave_cifrada, 'rinkel.api_key.v1') === CLAVE_DE_MAOLI)
    let seDescifraComoTokenDeAmazon = true
    try {
      decryptToken(guardada.clave_cifrada)
    } catch {
      seDescifraComoTokenDeAmazon = false
    }
    ok('pero NO como si fuera un token de Amazon (pegada en esa columna no vale)', !seDescifraComoTokenDeAmazon)
    ok('la huella es la de la clave y el final son sus cuatro últimas', guardada.huella === huellaDeClave(CLAVE_DE_MAOLI) && guardada.final_clave === '8f90')
    ok('la clave en claro no está en NINGUNA fila de ninguna tabla', ![...b.tablas.values()].flat().some((f) => JSON.stringify(f).includes(CLAVE_DE_MAOLI)))

    ok('empieza a importar en el mismo gesto: las 70 llamadas', v.lectura.tipo === 'hecha' && v.lectura.resumen.importadas === 70 && v.lectura.resumen.ok && !v.lectura.resumen.pendiente, JSON.stringify(v.lectura))
    ok('el vínculo queda al día, con el histórico completo y sin error', (() => { const x = b.tabla('rinkel_vinculos')[0]; return x.historico_completo === true && x.ultimo_error === null && x.rinkel_total === 70 && typeof x.ultimo_sync_at === 'string' })())
    ok('y la llamada a un número de un lead SUYO lleva su lead; la de un lead de otra persona, no', b.tabla('rinkel_llamadas').find((l) => l.rinkel_id === 'rk-0005')?.lead_id === 'lead-1' && b.tabla('rinkel_llamadas').find((l) => l.rinkel_id === 'rk-0006')?.lead_id === null)
    ok('cada llamada con su dueña', b.tabla('rinkel_llamadas').every((l) => l.user_id === MAOLI))
    ok('con la grabación de las que la tenían', b.tabla('rinkel_llamadas').filter((l) => l.grabacion_id).length === 35)

    // La clave no aparece en ninguna URL que se pidió a Rinkel ni en ninguna consulta
    ok('la clave no viaja en la URL de ninguna petición a Rinkel', !r.peticiones.some((p) => p.includes(CLAVE_DE_MAOLI)))
  }

  console.log('\n=== lo que se rechaza al vincular ===')
  {
    const b = new Base()
    const r = rinkelFalso({ llamadas: [llamadaCruda(1, '+34622000001')] })
    const sinFormato = await vincularClave(servicio(b), MAOLI, 'esto no es una clave', { presupuestoMs: 1000, rinkel: r.deps })
    ok('algo que no parece una clave: 400 y no se llama a Rinkel', !sinFormato.ok && sinFormato.estado === 400 && r.peticiones.length === 0)

    const rechazada = await vincularClave(servicio(b), MAOLI, CLAVE_DE_MAOLI, { presupuestoMs: 1000, rinkel: rinkelFalso({ estadoDeLlamadas: 401 }).deps })
    ok('una clave que Rinkel no reconoce: 422 con nuestra frase', !rechazada.ok && rechazada.estado === 422 && rechazada.mensaje === MENSAJE_DE_ERROR.clave_invalida)
    ok('y no se guarda nada', b.tabla('rinkel_claves').length === 0 && b.tabla('rinkel_vinculos').length === 0)

    const sinPlan = await vincularClave(servicio(b), MAOLI, CLAVE_DE_MAOLI, { presupuestoMs: 1000, rinkel: rinkelFalso({ estadoDeLlamadas: 403 }).deps })
    ok('un plan sin API: 422 y se dice', !sinPlan.ok && sinPlan.estado === 422 && sinPlan.mensaje === MENSAJE_DE_ERROR.sin_permiso)
    const caido = await vincularClave(servicio(b), MAOLI, CLAVE_DE_MAOLI, { presupuestoMs: 1000, rinkel: rinkelFalso({ estadoDeLlamadas: 500 }).deps })
    ok('Rinkel caído: 502', !caido.ok && caido.estado === 502)
    const limite = await vincularClave(servicio(b), MAOLI, CLAVE_DE_MAOLI, { presupuestoMs: 1000, rinkel: rinkelFalso({ estadoDeLlamadas: 429 }).deps })
    ok('demasiadas peticiones: 429', !limite.ok && limite.estado === 429)

    const saved = process.env.AMAZON_TOKEN_KEY
    delete process.env.AMAZON_TOKEN_KEY
    const sinCifrado = await vincularClave(servicio(b), MAOLI, CLAVE_DE_MAOLI, { presupuestoMs: 1000, rinkel: rinkelFalso({ llamadas: [llamadaCruda(1, '+34622000001')] }).deps })
    process.env.AMAZON_TOKEN_KEY = saved
    ok('sin la clave de cifrado del servidor NO se guarda en claro: 503', !sinCifrado.ok && sinCifrado.estado === 503 && b.tabla('rinkel_claves').length === 0)
  }

  console.log('\n=== dos personas, una misma cuenta ===')
  {
    const b = new Base()
    const rinkel = () => rinkelFalso({ llamadas: [llamadaCruda(1, '+34622000001')] }).deps
    const primera = await vincularClave(servicio(b), MAOLI, CLAVE_DE_MAOLI, { presupuestoMs: 600_000, rinkel: rinkel() })
    const segunda = await vincularClave(servicio(b), DANIELA, CLAVE_DE_MAOLI, { presupuestoMs: 600_000, rinkel: rinkel() })
    ok('la primera vincula', primera.ok)
    ok('la segunda con la MISMA clave: 409, sin decir quién la tiene', !segunda.ok && segunda.estado === 409 && !segunda.mensaje.includes('Maoli'))
    ok('y no se guarda nada de la segunda', b.tabla('rinkel_claves').length === 1 && b.tabla('rinkel_vinculos').length === 1 && b.tabla('rinkel_llamadas').every((l) => l.user_id === MAOLI))
    const otra = await vincularClave(servicio(b), DANIELA, CLAVE_DE_DANIELA, { presupuestoMs: 600_000, rinkel: rinkel() })
    ok('con su propia clave sí', otra.ok && b.tabla('rinkel_claves').length === 2)
    const mismaDeNuevo = await vincularClave(servicio(b), MAOLI, CLAVE_DE_MAOLI, { presupuestoMs: 600_000, rinkel: rinkel() })
    ok('quien ya la tiene puede volver a vincularla (se reinicia la importación)', mismaDeNuevo.ok && b.tabla('rinkel_claves').filter((c) => c.user_id === MAOLI).length === 1)
  }

  console.log('\n=== un administrador sobre otra persona ===')
  {
    const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const ELLA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const OTRO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const EXTERNA = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    const base = () => {
      const b = new Base()
      b.tabla('profiles').push(
        { id: ADMIN, full_name: 'Raúl', email: 'raul@x', is_comercial: false },
        { id: ELLA, full_name: 'Daniela Soto', email: 'daniela@x', is_comercial: true },
        { id: OTRO, full_name: 'Alejandro Ruiz', email: 'alejandro@x', is_comercial: true },
        { id: EXTERNA, full_name: 'Yamila', email: 'yamila@x', is_comercial: false }
      )
      return b
    }
    const admin = { userId: ADMIN, role: 'admin' }

    let b = base()
    const propia = await autorizarObjetivo(servicio(b), admin, undefined, 'vincular')
    ok('sin pedir a nadie: la propia, y sin tocar la base', propia.ok && propia.userId === ADMIN && !propia.deOtra && b.consultas.length === 0)

    b = base()
    const noAdmin = await autorizarObjetivo(servicio(b), { userId: OTRO, role: 'employee' }, ELLA, 'vincular')
    ok('quien no es administrador sobre otra persona: 403, y ni se mira la base', !noAdmin.ok && noAdmin.estado === 403 && b.consultas.length === 0)
    const socio = await autorizarObjetivo(servicio(b), { userId: OTRO, role: 'partner' }, ELLA, 'desvincular')
    ok('un socio tampoco, ni siquiera para quitar', !socio.ok && socio.estado === 403)

    b = base()
    const sobreElla = await autorizarObjetivo(servicio(b), admin, ELLA, 'vincular')
    ok('el administrador sobre una comercial: puede, y la acción es sobre ELLA', sobreElla.ok && sobreElla.userId === ELLA && sobreElla.deOtra)

    for (const accion of ['vincular', 'sincronizar'] as const) {
      const r = await autorizarObjetivo(servicio(b), admin, EXTERNA, accion)
      ok(`sobre alguien que no es comercial: ${accion} se rechaza (409)`, !r.ok && r.estado === 409)
    }
    const quitar = await autorizarObjetivo(servicio(b), admin, EXTERNA, 'desvincular')
    ok('pero quitarle una clave que se quedó guardada sí se deja', quitar.ok && quitar.userId === EXTERNA)

    for (const accion of ['vincular', 'sincronizar', 'desvincular'] as const) {
      const r = await autorizarObjetivo(servicio(b), admin, 'ffffffff-ffff-4fff-8fff-ffffffffffff', accion)
      ok(`una persona que no existe: ${accion} da 404`, !r.ok && r.estado === 404)
    }
    const malo = await autorizarObjetivo(servicio(b), admin, 'no-soy-un-id', 'vincular')
    ok('un identificador que no lo es: 400', !malo.ok && malo.estado === 400)

    b = base()
    b.falla.set('select profiles', 'la base no contesta')
    let lanza = false
    try {
      await autorizarObjetivo(servicio(b), admin, ELLA, 'vincular')
    } catch {
      lanza = true
    }
    ok('si la base falla al comprobar a la persona NO se da por buena: lanza', lanza)
    ok('esComercial distingue los tres casos', (await esComercial(servicio(base()), ELLA)) === 'si' && (await esComercial(servicio(base()), EXTERNA)) === 'no' && (await esComercial(servicio(base()), 'x')) === 'no_existe')

    // El gesto entero: el administrador pega la clave de ELLA. Todo queda a nombre de ELLA, nada a nombre del administrador
    b = base()
    b.tabla('cold_leads').push({ id: 'lead-ella', assigned_to: ELLA, phone: '622 00 00 05', telefonos_extra: null }, { id: 'lead-admin', assigned_to: ADMIN, phone: '622 00 00 06', telefonos_extra: null })
    const decision = await autorizarObjetivo(servicio(b), admin, ELLA, 'vincular')
    if (!decision.ok) throw new Error(decision.mensaje)
    const llamadas = Array.from({ length: 10 }, (_, i) => llamadaCruda(i + 1, `+3462200${String(i + 1).padStart(4, '0')}`))
    const v = await vincularClave(servicio(b), decision.userId, CLAVE_DE_DANIELA, { presupuestoMs: 600_000, rinkel: rinkelFalso({ llamadas }).deps, revelarQuien: true })
    ok('la vincula', v.ok)
    ok('la clave y el vínculo quedan a nombre de ELLA', b.tabla('rinkel_claves').every((c) => c.user_id === ELLA) && b.tabla('rinkel_vinculos').every((c) => c.user_id === ELLA) && b.tabla('rinkel_claves').length === 1)
    ok('las llamadas, también, y casadas con los leads de ELLA (no con los del administrador)', b.tabla('rinkel_llamadas').length === 10 && b.tabla('rinkel_llamadas').every((l) => l.user_id === ELLA) && b.tabla('rinkel_llamadas').find((l) => l.rinkel_id === 'rk-0005')?.lead_id === 'lead-ella' && b.tabla('rinkel_llamadas').find((l) => l.rinkel_id === 'rk-0006')?.lead_id === null)
    ok('el administrador no queda con ninguna fila', ![...b.tablas.values()].flat().some((f) => f.user_id === ADMIN))

    // Y si pega por error la clave de otra persona, se le dice de quién es
    const ya = await vincularClave(servicio(b), OTRO, CLAVE_DE_DANIELA, { presupuestoMs: 600_000, rinkel: rinkelFalso({ llamadas }).deps, revelarQuien: true })
    ok('la misma cuenta pegada a otra persona: 409 y, al administrador, se le dice quién la tiene', !ya.ok && ya.estado === 409 && ya.mensaje.includes('Daniela Soto'), JSON.stringify(ya))
    const yaSin = await vincularClave(servicio(b), OTRO, CLAVE_DE_DANIELA, { presupuestoMs: 600_000, rinkel: rinkelFalso({ llamadas }).deps })
    ok('sin esa opción (cualquier otro) no se dice', !yaSin.ok && yaSin.estado === 409 && !yaSin.mensaje.includes('Daniela'))
    b.tabla('profiles').length = 0
    const yaSinPerfil = await vincularClave(servicio(b), OTRO, CLAVE_DE_DANIELA, { presupuestoMs: 600_000, rinkel: rinkelFalso({ llamadas }).deps, revelarQuien: true })
    ok('y si de quien la tiene no hay nombre, el aviso sigue siendo claro y sin paréntesis vacíos', !yaSinPerfil.ok && yaSinPerfil.estado === 409 && !yaSinPerfil.mensaje.includes('()') && !yaSinPerfil.mensaje.includes('(null)'))
  }

  console.log('\n=== leer la cuenta de alguien ===')
  {
    const b = new Base()
    ok('sin vínculo, nada que leer', (await leerCuentaDe(servicio(b), MAOLI, { presupuestoMs: 1000 })).tipo === 'sin_vinculo')

    const llamadas = Array.from({ length: 120 }, (_, i) => llamadaCruda(i + 1, `+3462200${String(i + 1).padStart(4, '0')}`))
    const r = rinkelFalso({ llamadas })
    await vincularClave(servicio(b), MAOLI, CLAVE_DE_MAOLI, { presupuestoMs: 25_000, rinkel: r.deps })
    // La API falsa contesta al instante, así que el presupuesto no corta; se comprueba con la siguiente
    const otra = await leerCuentaDe(servicio(b), MAOLI, { presupuestoMs: 600_000, rinkel: r.deps })
    ok('una segunda lectura repasa lo reciente sin duplicar nada', otra.tipo === 'hecha' && otra.resumen.importadas === 120 && otra.resumen.ok)

    const turno = pedirTurnoDeLectura(`rinkel|${MAOLI}`)
    ok('si ya se está leyendo esa cuenta, se dice «ocupada» en vez de pedir lo mismo dos veces', turno.ok && (await leerCuentaDe(servicio(b), MAOLI, { presupuestoMs: 1000, rinkel: r.deps })).tipo === 'ocupada')
    if (turno.ok) turno.soltar()
    ok('y al soltarla se puede leer otra vez', (await leerCuentaDe(servicio(b), MAOLI, { presupuestoMs: 600_000, rinkel: r.deps })).tipo === 'hecha')
  }

  console.log('\n=== cuando Rinkel rechaza la clave más tarde ===')
  {
    const b = new Base()
    await vincularClave(servicio(b), MAOLI, CLAVE_DE_MAOLI, { presupuestoMs: 600_000, rinkel: rinkelFalso({ llamadas: [llamadaCruda(1, '+34622000001')] }).deps })
    const l = await leerCuentaDe(servicio(b), MAOLI, { presupuestoMs: 600_000, rinkel: rinkelFalso({ estadoDeLlamadas: 401 }).deps })
    ok('el resultado dice que la clave ya no vale', l.tipo === 'hecha' && !l.resumen.ok && l.resumen.codigo === 'clave_invalida' && l.resumen.mensaje === MENSAJE_DE_ERROR.clave_invalida)
    ok('queda escrito en el vínculo para que la pantalla lo diga', b.tabla('rinkel_vinculos')[0].ultimo_error === MENSAJE_DE_ERROR.clave_invalida)
    ok('lo ya importado se conserva', b.tabla('rinkel_llamadas').length === 1)
    const bien = await leerCuentaDe(servicio(b), MAOLI, { presupuestoMs: 600_000, rinkel: rinkelFalso({ llamadas: [llamadaCruda(1, '+34622000001')] }).deps })
    ok('y cuando vuelve a ir, el error se limpia', bien.tipo === 'hecha' && bien.resumen.ok && b.tabla('rinkel_vinculos')[0].ultimo_error === null)
  }

  console.log('\n=== cuando falla la base, no es culpa de Rinkel ===')
  {
    const b = new Base()
    await vincularClave(servicio(b), MAOLI, CLAVE_DE_MAOLI, { presupuestoMs: 600_000, rinkel: rinkelFalso({ llamadas: [llamadaCruda(1, '+34622000001')] }).deps })
    b.falla.set('upsert rinkel_llamadas', 'la base no contesta')
    const l = await leerCuentaDe(servicio(b), MAOLI, { presupuestoMs: 600_000, rinkel: rinkelFalso({ llamadas: [llamadaCruda(1, '+34622000001'), llamadaCruda(2, '+34622000002')] }).deps })
    ok('se distingue como fallo de la base, con su propia frase', l.tipo === 'hecha' && !l.resumen.ok && l.resumen.codigo === 'base' && l.resumen.mensaje === 'No se han podido guardar las llamadas. Vuelve a probar en un momento.')
    ok('y la frase NO culpa a la cuenta de Rinkel ni a la clave', !!l.tipo && l.tipo === 'hecha' && !/rinkel|clave/i.test(l.resumen.mensaje ?? ''))
  }

  console.log('\n=== una clave guardada que ya no se puede leer ===')
  {
    const b = new Base()
    await vincularClave(servicio(b), MAOLI, CLAVE_DE_MAOLI, { presupuestoMs: 600_000, rinkel: rinkelFalso({ llamadas: [llamadaCruda(1, '+34622000001')] }).deps })
    ;(b.tabla('rinkel_claves')[0] as { clave_cifrada: string }).clave_cifrada = 'v1.basura.basura.basura'
    const l = await leerCuentaDe(servicio(b), MAOLI, { presupuestoMs: 1000, rinkel: rinkelFalso().deps })
    ok('se pide volver a vincularla, sin soltar el texto del error', l.tipo === 'hecha' && !l.resumen.ok && l.resumen.mensaje === 'No se ha podido leer la clave guardada. Vuelve a vincularla.')
  }

  console.log('\n=== desvincular ===')
  {
    const b = new Base()
    await vincularClave(servicio(b), MAOLI, CLAVE_DE_MAOLI, { presupuestoMs: 600_000, rinkel: rinkelFalso({ llamadas: [llamadaCruda(1, '+34622000001'), llamadaCruda(2, '+34622000002')] }).deps })
    await vincularClave(servicio(b), DANIELA, CLAVE_DE_DANIELA, { presupuestoMs: 600_000, rinkel: rinkelFalso({ llamadas: [llamadaCruda(3, '+34622000003')] }).deps })
    const d = await desvincularClave(servicio(b), MAOLI)
    ok('se va su clave y su vínculo', d.ok && b.tabla('rinkel_claves').every((c) => c.user_id === DANIELA) && b.tabla('rinkel_vinculos').every((c) => c.user_id === DANIELA))
    ok('las llamadas que ya había importado SE QUEDAN (son su historial)', (await contarLlamadas(servicio(b), MAOLI)) === 2)
    ok('y lo de Daniela no se toca', b.tabla('rinkel_claves').length === 1 && (await contarLlamadas(servicio(b), DANIELA)) === 1)
    ok('desvincular a quien no tenía nada no falla', (await desvincularClave(servicio(b), 'nadie')).ok)
  }

  console.log('\n=== los teléfonos de los leads ===')
  {
    const b = new Base()
    const leads = b.tabla('cold_leads')
    for (let i = 0; i < 2300; i++) leads.push({ id: `l${i}`, assigned_to: MAOLI, phone: `+34 622 ${String(i).padStart(2, '0')} ${String(i % 100).padStart(2, '0')} 00`.slice(0, 40), telefonos_extra: null })
    leads.push({ id: 'ajeno', assigned_to: DANIELA, phone: '+34 611 11 11 11', telefonos_extra: null })
    leads.push({ id: 'dos', assigned_to: MAOLI, phone: '931112244 / 699 88 77 66', telefonos_extra: '+34 655 44 33 22' })
    leads.push({ id: 'sin', assigned_to: MAOLI, phone: null, telefonos_extra: null })
    const mapa = await leadsPorTelefonoDe(servicio(b), MAOLI)
    ok('recorre TODOS los leads aunque pasen de 1.000 por página', mapa.get('699887766') === 'dos', String(mapa.get('699887766')))
    ok('un lead con varios teléfonos casa por cualquiera de ellos, también los extra', mapa.get('931112244') === 'dos' && mapa.get('655443322') === 'dos')
    ok('NO incluye los leads de otra persona', !mapa.has('611111111'))
    ok('un lead sin teléfono no rompe nada', mapa.size > 0)
  }

  console.log('\n=== guardar llamadas ===')
  {
    const b = new Base()
    const filas = Array.from({ length: 1200 }, (_, i) => ({ user_id: MAOLI, lead_id: null, rinkel_id: `x${i}`, call_id: null, fecha: '2026-10-21T10:00:00.000Z', direccion: 'outbound', duracion_s: 5, estado: 'ANSWERED', motivo_perdida: null, numero: null, numero_anonimo: true, numero_propio: null, grabacion_id: null, grabacion_hasta: null }))
    await guardarLlamadas(servicio(b), filas)
    ok('guarda en bloques de 500: 3 upserts para 1.200 filas', b.consultas.filter((c) => c === 'upsert rinkel_llamadas').length === 3 && b.tabla('rinkel_llamadas').length === 1200)
    await guardarLlamadas(servicio(b), filas.slice(0, 100))
    ok('repetir no duplica', b.tabla('rinkel_llamadas').length === 1200)
  }
}

main()
  .then(() => {
    console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
    if (fallos > 0) process.exit(1)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
