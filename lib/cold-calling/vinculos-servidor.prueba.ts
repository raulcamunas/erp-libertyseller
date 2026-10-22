import type { createServiceClient } from '@/lib/supabase/service'
import { DIAS_RECIENTE, diagnosticoDeVinculos, leerLeadsParaVincular, olvidarRepasos, repasarTrasLeer, repasarVinculos } from '@/lib/cold-calling/vinculos-servidor'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * ENLAZAR LLAMADAS CON LEADS, CONTRA UNA BASE FALSA.
 *
 * Lo que se vigila: que el repaso solo toque llamadas SIN lead, que reparta recientes (se cuentan) e históricas (solo se
 * enlazan), que no lea los leads si no hay nada que casar, que respete los trozos de 1.000 filas de PostgREST, que sin la
 * migración 237 diga que falta en vez de fallar, y que el repaso tras cada lectura de Rinkel no estorbe ni se repita sin parar.
 */

type Fila = Record<string, unknown>
type Servicio = ReturnType<typeof createServiceClient>

class Consulta {
  private filtros: Array<(f: Fila) => boolean> = []
  private rango: [number, number] | null = null
  private tope: number | null = null
  private columnas = '*'
  constructor(
    private base: Base,
    private tabla: string
  ) {}
  select(columnas = '*') {
    this.columnas = columnas
    return this
  }
  eq(c: string, v: unknown) {
    this.filtros.push((f) => f[c] === v)
    return this
  }
  is(c: string, v: unknown) {
    this.filtros.push((f) => (v === null ? (f[c] ?? null) === null : f[c] === v))
    return this
  }
  not(c: string, op: string, v: unknown) {
    if (op === 'is' && v === null) this.filtros.push((f) => (f[c] ?? null) !== null)
    return this
  }
  gte(c: string, v: string) {
    this.filtros.push((f) => String(f[c]) >= v)
    return this
  }
  in(c: string, vs: unknown[]) {
    this.filtros.push((f) => vs.includes(f[c]))
    return this
  }
  order() {
    return this
  }
  range(d: number, h: number) {
    this.rango = [d, h]
    return this
  }
  limit(n: number) {
    this.tope = n
    return this
  }
  then<T>(res: (v: unknown) => T, rej?: (e: unknown) => T) {
    this.base.consultas.push(`select ${this.tabla}`)
    const fallo = this.base.falla.get(`select ${this.tabla}:${this.columnas}`) ?? this.base.falla.get(`select ${this.tabla}`)
    if (fallo) return Promise.resolve({ data: null, error: { message: fallo, code: fallo.split(' ')[0] } }).then(res, rej)
    let filas = this.base.tabla(this.tabla).filter((f) => this.filtros.every((p) => p(f)))
    if (this.rango) {
      this.base.paginas.push(this.rango)
      filas = filas.slice(this.rango[0], this.rango[1] + 1)
    }
    if (this.tope !== null) filas = filas.slice(0, this.tope)
    return Promise.resolve({ data: filas, error: null }).then(res, rej)
  }
}

class Base {
  tablas = new Map<string, Fila[]>()
  consultas: string[] = []
  paginas: Array<[number, number]> = []
  falla = new Map<string, string>()
  rpcs: Array<{ historico: boolean; pares: Array<{ llamada: string; lead: string }> }> = []
  tabla(n: string): Fila[] {
    if (!this.tablas.has(n)) this.tablas.set(n, [])
    return this.tablas.get(n)!
  }
  from(n: string) {
    return new Consulta(this, n)
  }
  async rpc(nombre: string, args: { p_pares: Array<{ llamada: string; lead: string }>; p_historico: boolean }) {
    this.consultas.push(`rpc ${nombre}`)
    const fallo = this.falla.get(`rpc ${nombre}`)
    if (fallo) return { data: null, error: { message: fallo, code: fallo.split(' ')[0] } }
    this.rpcs.push({ historico: args.p_historico, pares: args.p_pares })
    let n = 0
    for (const par of args.p_pares) {
      const fila = this.tabla('rinkel_llamadas').find((l) => l.id === par.llamada)
      if (!fila || (fila.lead_id ?? null) !== null) continue
      fila.lead_id = par.lead
      n += 1
    }
    return { data: n, error: null }
  }
}
const servicio = (b: Base) => b as unknown as Servicio

const MAOLI = 'u-maoli'
const DANIELA = 'u-daniela'
const AHORA = Date.parse('2026-10-22T12:00:00Z')
const haceDias = (d: number) => new Date(AHORA - d * 86_400_000).toISOString()

let n = 0
const llamada = (numero: string | null, extra: Fila = {}): Fila => ({ id: `c${String(++n).padStart(4, '0')}`, user_id: MAOLI, fecha: haceDias(1), direccion: 'outbound', numero, lead_id: null, ...extra })
const lead = (id: string, phone: string | null, extra: Fila = {}): Fila => ({ id, assigned_to: MAOLI, phone, telefonos_extra: null, status: 'pendiente', last_contacted_at: null, store_name: `Tienda ${id}`, ...extra })

async function main() {
  console.log('\n=== el repaso enlaza lo que se puede ===')
  {
    olvidarRepasos()
    const b = new Base()
    b.tabla('cold_leads').push(lead('lead-1', '+34 600 11 22 33'), lead('lead-2', '931112244'), lead('lead-d', '611223344', { assigned_to: DANIELA }))
    const reciente = llamada('+34600112233', { fecha: haceDias(2) })
    const antigua = llamada('+34931112244', { fecha: haceDias(60) })
    const yaEnlazada = llamada('+34600112233', { lead_id: 'otro' })
    const oculta = llamada(null)
    const aLeadDeOtro = llamada('+34611223344')
    const desconocida = llamada('+34999000111')
    b.tabla('rinkel_llamadas').push(reciente, antigua, yaEnlazada, oculta, aLeadDeOtro, desconocida)

    const r = await repasarVinculos(servicio(b), { dias: null, ahora: () => AHORA })
    ok('enlaza la reciente y la antigua, y nada más', r.enlazadas === 2 && reciente.lead_id === 'lead-1' && antigua.lead_id === 'lead-2', JSON.stringify(r))
    ok('la reciente se cuenta en su lead y la antigua solo se enlaza', r.contadas === 1 && r.historicas === 1 && b.rpcs.length === 2 && b.rpcs[0].historico === false && b.rpcs[1].historico === true)
    ok('la que ya tenía lead no se toca, aunque sea de otro', yaEnlazada.lead_id === 'otro')
    ok('ni la oculta, ni la de un lead de otro comercial, ni la desconocida', oculta.lead_id === null && aLeadDeOtro.lead_id === null && desconocida.lead_id === null)
    ok('solo se miraron las llamadas SIN lead y con número', r.revisadas === 4, String(r.revisadas))

    const otra = await repasarVinculos(servicio(b), { dias: null, ahora: () => AHORA })
    ok('repetirlo no enlaza nada más', otra.enlazadas === 0)
  }

  console.log('\n=== el repaso mira solo lo que le piden ===')
  {
    const b = new Base()
    b.tabla('cold_leads').push(lead('lead-1', '600112233'), lead('lead-2', '931112244', { assigned_to: DANIELA }))
    const deMaoli = llamada('+34600112233', { fecha: haceDias(3) })
    const deDaniela = llamada('+34931112244', { user_id: DANIELA, fecha: haceDias(3) })
    const vieja = llamada('+34600112233', { fecha: haceDias(40) })
    b.tabla('rinkel_llamadas').push(deMaoli, deDaniela, vieja)
    const r = await repasarVinculos(servicio(b), { usuario: MAOLI, dias: DIAS_RECIENTE, ahora: () => AHORA })
    ok('de una persona y de los últimos días: solo su llamada reciente', r.enlazadas === 1 && deMaoli.lead_id === 'lead-1' && deDaniela.lead_id === null && vieja.lead_id === null, JSON.stringify(r))
  }

  console.log('\n=== sin llamadas que casar no se leen ni los leads ===')
  {
    const b = new Base()
    b.tabla('cold_leads').push(lead('lead-1', '600112233'))
    b.tabla('rinkel_llamadas').push(llamada('+34600112233', { lead_id: 'lead-1' }))
    const r = await repasarVinculos(servicio(b), { dias: null, ahora: () => AHORA })
    ok('todas tienen lead: no hay nada que hacer', r.revisadas === 0 && r.enlazadas === 0)
    ok('y no se ha pedido ningún lead a la base', !b.consultas.includes('select cold_leads'))
  }

  console.log('\n=== un repaso grande respeta los trozos de la base ===')
  {
    const b = new Base()
    for (let i = 0; i < 2300; i++) b.tabla('cold_leads').push(lead(`l${i}`, `+34 6${String(10000000 + i)}`))
    const leidos = await leerLeadsParaVincular(servicio(b))
    ok('lee TODOS los leads aunque pasen de 1.000 por página', leidos.length === 2300 && b.paginas.length === 3, `${leidos.length} leads en ${b.paginas.length} páginas`)
    b.paginas.length = 0
    for (let i = 0; i < 1300; i++) b.tabla('rinkel_llamadas').push(llamada(`+34 6${String(10000000 + i)}`.replace(/\s/g, ''), { fecha: haceDias(1) }))
    const r = await repasarVinculos(servicio(b), { dias: null, ahora: () => AHORA })
    ok('enlaza las 1.300 y manda los pares en lotes de 500', r.enlazadas === 1300 && b.rpcs.length === 3 && b.rpcs[0].pares.length === 500, JSON.stringify({ r, lotes: b.rpcs.map((x) => x.pares.length) }))
  }

  console.log('\n=== sin la migración 237 ===')
  {
    const b = new Base()
    b.tabla('cold_leads').push(lead('lead-1', '600112233'))
    const c = llamada('+34600112233')
    b.tabla('rinkel_llamadas').push(c)
    b.falla.set('rpc cold_vincular_llamadas', 'PGRST202 Could not find the function')
    const r = await repasarVinculos(servicio(b), { dias: null, ahora: () => AHORA })
    ok('dice que falta la migración y no enlaza nada', r.faltaMigracion && r.enlazadas === 0 && c.lead_id === null)

    const e = new Base()
    e.tabla('cold_leads').push(lead('lead-1', '600112233'))
    e.tabla('rinkel_llamadas').push(llamada('+34600112233'))
    e.falla.set('rpc cold_vincular_llamadas', 'XX000 connection reset')
    let lanzo = false
    try {
      await repasarVinculos(servicio(e), { dias: null, ahora: () => AHORA })
    } catch {
      lanzo = true
    }
    ok('otro fallo de la base SÍ se propaga (no se confunde con «falta la migración»)', lanzo)
  }

  console.log('\n=== el repaso tras cada lectura de Rinkel ===')
  {
    olvidarRepasos()
    const b = new Base()
    b.tabla('cold_leads').push(lead('lead-1', '600112233'))
    const c = llamada('+34600112233', { fecha: haceDias(1) })
    b.tabla('rinkel_llamadas').push(c)
    const r1 = await repasarTrasLeer(servicio(b), MAOLI, undefined, () => AHORA)
    ok('la primera vez enlaza', r1 !== null && r1.enlazadas === 1 && c.lead_id === 'lead-1')
    const antes = b.consultas.length
    const r2 = await repasarTrasLeer(servicio(b), MAOLI, undefined, () => AHORA + 10 * 60_000)
    ok('a los diez minutos no vuelve a ir a la base', r2 === null && b.consultas.length === antes)
    const r3 = await repasarTrasLeer(servicio(b), MAOLI, undefined, () => AHORA + 31 * 60_000)
    ok('a la media hora sí', r3 !== null)
    const otra = await repasarTrasLeer(servicio(b), DANIELA, undefined, () => AHORA + 10 * 60_000)
    ok('y cada persona lleva su propio reloj', otra !== null)

    olvidarRepasos()
    const roto = new Base()
    roto.falla.set('select rinkel_llamadas', 'XX000 la base no contesta')
    const registro = console.error
    console.error = () => undefined
    let resultado: unknown = 'sin llamar'
    try {
      resultado = await repasarTrasLeer(servicio(roto), MAOLI, undefined, () => AHORA)
    } finally {
      console.error = registro
    }
    ok('si falla no rompe la lectura: devuelve null', resultado === null)
    const reintento = new Base()
    reintento.tabla('cold_leads').push(lead('lead-1', '600112233'))
    reintento.tabla('rinkel_llamadas').push(llamada('+34600112233', { fecha: haceDias(1) }))
    const despues = await repasarTrasLeer(servicio(reintento), MAOLI, undefined, () => AHORA + 60_000)
    ok('y tras un fallo se vuelve a intentar en la siguiente lectura, no media hora después', despues !== null && despues.enlazadas === 1)
  }

  console.log('\n=== el diagnóstico ===')
  {
    const b = new Base()
    b.tabla('profiles').push({ id: MAOLI, full_name: 'Maoli Gómez', email: 'maoli@x.es' })
    b.tabla('cold_leads').push(lead('lead-1', '600112233'), lead('lead-2', '6001122'))
    b.tabla('rinkel_llamadas').push(llamada('+34600112233', { lead_id: 'lead-1' }), llamada('+34999000111'), llamada('+34999000111'))
    const { diagnostico: d, migracion237 } = await diagnosticoDeVinculos(servicio(b))
    ok('cuenta lo que hay y pone nombre al comercial', d.llamadas.total === 3 && d.llamadas.salientesEnlazadas === 1 && d.llamadas.sinLead === 2 && d.numerosSinLead[0].comercial === 'Maoli Gómez')
    ok('enseña el teléfono que no se reconoce', d.leads.sinReconocer === 1 && d.sinReconocer[0].nombre === 'Tienda lead-2')
    ok('y dice que la migración 237 está lanzada si se puede leer efecto_aplicado', migracion237 === true)

    const sin = new Base()
    sin.tabla('rinkel_llamadas').push(llamada('+34999000111'))
    sin.falla.set('select rinkel_llamadas:efecto_aplicado', 'PGRST204 column efecto_aplicado does not exist')
    const x = await diagnosticoDeVinculos(servicio(sin))
    ok('si la columna efecto_aplicado no existe, dice que falta la 237 y el resto del diagnóstico sale igual', x.migracion237 === false && x.diagnostico.llamadas.total === 1)
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
