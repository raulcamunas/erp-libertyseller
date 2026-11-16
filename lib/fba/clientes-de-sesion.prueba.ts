import { agenciaQueEdita, decidirAcceso, esAgencia, puedeEditar } from '@/lib/fba/acceso'
import { TEXTO_SIN_CLIENTES, clientesDeSesion, olvidarCachesDeSesion, sesionDeRemesas } from '@/lib/fba/clientes-de-sesion'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const ver = (x: unknown) => JSON.stringify(x)

/**
 * ACCESO A REMESAS DE PUNTA A PUNTA CON UNA BASE FALSA (spec remesas-pro §1.3, §1.4, §11 D21, D27, D39, D40).
 * =========================================================================================================
 * La regla pura ya tiene su prueba (regla-acceso.prueba.ts). Aquí se comprueba que la LECTURA (perfil, puesto, casilla de
 * `user_app_permissions` y `fba_accesos`) llega bien a la regla y que `decidirAcceso` (lo que contesta `requireFbaAccess`),
 * `agenciaQueEdita` (la barrera de la propuesta a medida, D21) y `clientesDeSesion` (el selector) dicen lo mismo, con los 5 casos
 * de D27. La base falsa imita el constructor de consultas de Supabase: solo lo que usan estas piezas.
 */

/* ---------------- la base falsa ---------------- */

type Fila = Record<string, unknown>
const SIN_TABLA = { code: '42P01', message: 'no existe' }

function baseFalsa(tablas: Record<string, Fila[] | 'sin_tabla'>) {
  const consultas: string[] = []
  const from = (tabla: string) => {
    const filtros: Array<(f: Fila) => boolean> = []
    let orden: { col: string; asc: boolean } | null = null
    let limite: number | null = null
    let rango: [number, number] | null = null
    const resultado = () => {
      const t = tablas[tabla]
      if (t === undefined || t === 'sin_tabla') return { data: null, error: SIN_TABLA }
      let filas = t.filter((f) => filtros.every((p) => p(f)))
      if (orden) {
        const { col, asc } = orden
        filas = [...filas].sort((a, b) => String(a[col] ?? '').localeCompare(String(b[col] ?? '')) * (asc ? 1 : -1))
      }
      if (rango) filas = filas.slice(rango[0], rango[1] + 1)
      if (limite !== null) filas = filas.slice(0, limite)
      return { data: filas, error: null }
    }
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filtros.push((f) => f[c] === v), q),
      in: (c: string, vs: unknown[]) => (filtros.push((f) => vs.includes(f[c])), q),
      not: (c: string, op: string, v: unknown) => (filtros.push((f) => (op === 'is' && v === null ? f[c] !== null && f[c] !== undefined : true)), q),
      order: (col: string, o?: { ascending?: boolean }) => ((orden = { col, asc: o?.ascending !== false }), q),
      limit: (n: number) => ((limite = n), q),
      range: (a: number, b: number) => ((rango = [a, b]), q),
      maybeSingle: async () => {
        const r = resultado()
        return r.error ? r : { data: (r.data ?? [])[0] ?? null, error: null }
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(resultado()).then(res, rej),
    }
    consultas.push(tabla)
    return q
  }
  return { from, consultas } as unknown as Parameters<typeof sesionDeRemesas>[1] & { consultas: string[] }
}

/* ---------------- los datos ---------------- */

const OPINAS = '11111111-1111-1111-1111-111111111111'
const COBO = '22222222-2222-2222-2222-222222222222'
const SHOESF = '33333333-3333-3333-3333-333333333333'
const PORTICO = '44444444-4444-4444-4444-444444444444'

const PERFILES: Fila[] = [
  { id: 'admin', role: 'admin', puesto: null },
  { id: 'ceo-con', role: 'admin', puesto: 'ceo' },
  { id: 'ceo-sin', role: 'admin', puesto: 'ceo' },
  { id: 'administrativa', role: 'employee', puesto: 'gestion_administrativa' },
  { id: 'administrativa-sin', role: 'employee', puesto: 'gestion_administrativa' },
  { id: 'comercial', role: 'employee', puesto: 'comercial' },
  { id: 'cliente', role: 'cliente', puesto: null },
  { id: 'cliente-sin', role: 'cliente', puesto: null },
]
const CASILLAS: Fila[] = [
  { user_id: 'ceo-con', app_id: 'remesas', can_access: true },
  { user_id: 'administrativa', app_id: 'remesas', can_access: true },
  { user_id: 'administrativa-sin', app_id: 'remesas', can_access: false },
  // Una casilla a un cliente de fuera no le abre nada
  { user_id: 'cliente', app_id: 'remesas', can_access: true },
]
const ACCESOS: Fila[] = [
  { user_id: 'comercial', client_id: COBO, puede_editar: false },
  { user_id: 'cliente', client_id: OPINAS, puede_editar: true },
  { user_id: 'cliente', client_id: COBO, puede_editar: false },
]
const CLIENTES: Fila[] = [
  { id: OPINAS, name: 'Opinas' },
  { id: COBO, name: 'Cobo' },
  { id: SHOESF, name: 'ShoesF' },
  { id: PORTICO, name: 'Portico' },
]
const REMESAS: Fila[] = [
  { id: 'r1', client_id: OPINAS, estado: 'enviada', marketplace_id: 'A13V1IB3VIYZZH', fecha_envio: '2026-11-01' },
  { id: 'r2', client_id: OPINAS, estado: 'cerrada', marketplace_id: 'A1RKKUPIHCS9HS', fecha_envio: '2026-10-01' },
  { id: 'r3', client_id: OPINAS, estado: 'borrador', marketplace_id: 'A1RKKUPIHCS9HS', fecha_envio: null },
  { id: 'r4', client_id: COBO, estado: 'enviada', marketplace_id: 'A1RKKUPIHCS9HS', fecha_envio: '2026-10-20' },
  { id: 'r5', client_id: COBO, estado: 'lista', marketplace_id: 'A1RKKUPIHCS9HS', fecha_envio: null },
]
const CONEXIONES: Fila[] = [
  { id: 'c-opinas', client_id: OPINAS, region: 'eu', is_active: true },
  { id: 'c-portico', client_id: PORTICO, region: 'na', is_active: true },
]
// Cobo tiene catálogo por DATOS (D40) aunque su nombre no sea ShoesF; ShoesF lo tiene por el nombre sin filas
const CATALOGO: Fila[] = [{ client_id: COBO, fbasku: '262 BURDEO/37 FBA' }]

const base = () =>
  baseFalsa({
    profiles: PERFILES,
    user_app_permissions: CASILLAS,
    fba_accesos: ACCESOS,
    amazon_clients: CLIENTES,
    fba_remesas: REMESAS,
    amazon_connections: CONEXIONES,
    fba_catalogo: CATALOGO,
    fba_lecturas: [],
    // Sin la migración 316: la salud degrada a null (salvo la del cliente nuevo)
    fba_plan_ultima: 'sin_tabla',
    fba_reposicion_config: 'sin_tabla',
  })

const HOY = '2026-11-15'

async function main() {
  console.log('\n1. admin que no es CEO')
  {
    const s = await sesionDeRemesas('admin', base())
    ok('todos, edita, agencia, esAdmin', s.clientesPermitidos === null && s.editables === null && s.esAdmin && s.actor === 'agencia' && s.rol === 'admin', ver(s))
    const d = decidirAcceso(s, 'borrar', OPINAS)
    ok('puede borrar (solo admin)', !('estado' in d) && d.esAdmin)
  }

  console.log('\n2. CEO: con la casilla como admin, sin ella como empleado sin acceso')
  {
    const con = await sesionDeRemesas('ceo-con', base())
    ok('CEO con la casilla: todos y esAdmin', con.clientesPermitidos === null && con.esAdmin, ver(con))
    const sin = await sesionDeRemesas('ceo-sin', base())
    ok('CEO sin la casilla: ningún cliente y sin poderes de admin', ver(sin.clientesPermitidos) === '[]' && !sin.esAdmin && sin.actor === 'agencia', ver(sin))
    const d = decidirAcceso(sin, 'ver')
    ok('y la ruta contesta 403 con el texto de empleado', 'estado' in d && d.estado === 403 && d.mensaje === TEXTO_SIN_CLIENTES.empleado, ver(d))
  }

  console.log('\n3. empleado con la casilla `remesas` (los administrativos, D27)')
  {
    const s = await sesionDeRemesas('administrativa', base())
    ok('todos, edita, agencia y NO admin', s.clientesPermitidos === null && s.editables === null && !s.esAdmin && s.esAgencia && s.rol === 'employee', ver(s))
    const ed = decidirAcceso(s, 'editar', SHOESF)
    ok('edita cualquier cliente', !('estado' in ed))
    ok('la propuesta a medida y el análisis IA son suyos (D21)', !('estado' in ed) && agenciaQueEdita(ed, SHOESF) && esAgencia(ed) && puedeEditar(ed, SHOESF))
    ok('pero sigue sin poder borrar remesas', 'estado' in decidirAcceso(s, 'borrar', SHOESF))
    ok('y sin las barreras de admin (Leer ventas, Enviar a Amazon, POST /api/fba/productos)', !('estado' in ed) && ed.esAdmin === false)
    const lista = await clientesDeSesion('administrativa', { service: base(), hoy: HOY })
    ok('ve los 4 clientes, ordenados por nombre', lista.clientes.map((c) => c.nombre).join() === 'Cobo,Opinas,Portico,ShoesF' && lista.vacio === null, lista.clientes.map((c) => c.nombre).join())
    ok('y en todos puede editar', lista.clientes.every((c) => c.puedeEditar))
  }

  console.log('\n4. empleado sin la casilla: solo sus fba_accesos (el puesto no da acceso)')
  {
    const sinCasilla = await sesionDeRemesas('administrativa-sin', base())
    ok('«Gestión Administrativa» con la casilla desmarcada: nada', ver(sinCasilla.clientesPermitidos) === '[]' && sinCasilla.actor === 'agencia')
    const vacia = await clientesDeSesion('administrativa-sin', { service: base(), hoy: HOY })
    ok('pantalla vacía con el texto de empleado', vacia.clientes.length === 0 && vacia.vacio === TEXTO_SIN_CLIENTES.empleado, String(vacia.vacio))
    const s = await sesionDeRemesas('comercial', base())
    ok('comercial con un acceso de lectura a Cobo', ver(s.clientesPermitidos) === ver([COBO]) && ver(s.editables) === '[]' && s.actor === 'agencia', ver(s))
    const d = decidirAcceso(s, 'ver', COBO)
    ok('ve Cobo', !('estado' in d))
    const e = decidirAcceso(s, 'editar', COBO)
    ok('no edita Cobo (solo lectura)', 'estado' in e && e.estado === 403, ver(e))
    const otro = decidirAcceso(s, 'ver', OPINAS)
    ok('otro cliente: 404, como si no existiera', 'estado' in otro && otro.estado === 404)
    ok('sin editar, la propuesta a medida no es suya', !('estado' in d) && !agenciaQueEdita(d, COBO))
  }

  console.log('\n5. cliente de fuera: sus fba_accesos, actor cliente')
  {
    const s = await sesionDeRemesas('cliente', base())
    ok('Opinas (edita) y Cobo (lee); la casilla no le abre nada', ver([...(s.clientesPermitidos ?? [])].sort()) === ver([OPINAS, COBO].sort()) && ver(s.editables) === ver([OPINAS]) && s.actor === 'cliente' && !s.esAdmin && !s.esAgencia, ver(s))
    const d = decidirAcceso(s, 'editar', OPINAS)
    ok('edita Opinas (propuesta manual, «Acepto», encaje… D39)', !('estado' in d))
    ok('pero la propuesta a medida no (es de la agencia, D21)', !('estado' in d) && !agenciaQueEdita(d, OPINAS))
    const lista = await clientesDeSesion('cliente', { service: base(), hoy: HOY })
    ok('su selector: solo sus dos cuentas (tablero reducido, D39)', lista.clientes.map((c) => c.id).sort().join() === [OPINAS, COBO].sort().join(), lista.clientes.map((c) => c.nombre).join())
    ok('y edita solo donde puede', lista.clientes.find((c) => c.id === OPINAS)?.puedeEditar === true && lista.clientes.find((c) => c.id === COBO)?.puedeEditar === false)
    const sin = await clientesDeSesion('cliente-sin', { service: base(), hoy: HOY })
    ok('un cliente sin accesos ve el texto de cliente (§1.3)', sin.clientes.length === 0 && sin.vacio === TEXTO_SIN_CLIENTES.cliente, String(sin.vacio))
    ok('y la ruta le contesta 403', 'estado' in decidirAcceso(sin.sesion, 'ver'))
  }

  console.log('\n6. lo que pinta clientesDeSesion de cada cliente (D20, D40)')
  {
    olvidarCachesDeSesion()
    const { clientes } = await clientesDeSesion('admin', { service: base(), hoy: HOY })
    const de = (id: string) => clientes.find((c) => c.id === id)!
    ok('mercado de remesa: el de la última enviada o cerrada (Opinas, Italia el 1 nov)', de(OPINAS).mercadoRemesa === 'A13V1IB3VIYZZH', de(OPINAS).mercadoRemesa)
    ok('Portico (NA, sin enviadas) → Estados Unidos', de(PORTICO).mercadoRemesa === 'ATVPDKIKX0DER', de(PORTICO).mercadoRemesa)
    ok('y su moneda, dólares', de(PORTICO).moneda === 'USD', de(PORTICO).moneda)
    ok('catálogo por datos: Cobo tiene filas en fba_catalogo', de(COBO).tieneCatalogo === true)
    ok('catálogo por nombre: ShoesF', de(SHOESF).tieneCatalogo === true)
    ok('Opinas sin catálogo', de(OPINAS).tieneCatalogo === false)
    ok('contadores: Cobo con una propuesta encajada («lista»)', de(COBO).contadores.listas === 1 && de(COBO).contadores.propuestas === 1, ver(de(COBO).contadores))
    ok('contadores: Opinas 2 envíos y 1 propuesta', ver(de(OPINAS).contadores) === ver({ envios: 2, propuestas: 1, listas: 0, enviosNuevos: 0 }), ver(de(OPINAS).contadores))
    ok('conectado según la conexión activa', de(OPINAS).conectado && de(PORTICO).conectado && !de(COBO).conectado)
    ok('sin la 316 la salud no se inventa (null), salvo el cliente sin envíos (gris)', de(OPINAS).salud === null && de(PORTICO).salud?.tono === 'gris', ver([de(OPINAS).salud, de(PORTICO).salud]))
    const ligero = await clientesDeSesion('admin', { service: base(), hoy: HOY, detalle: false })
    ok('sin detalle: catálogo solo por el nombre y sin mercado de lectura', ligero.clientes.find((c) => c.id === COBO)!.tieneCatalogo === false && ligero.clientes.every((c) => c.mercadoLectura === null))
  }

  console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
