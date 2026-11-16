import { createServiceClient } from '@/lib/supabase/service'
import { marketplaceById } from '@/lib/types/amazon'
import type { ClienteRemesas, SesionRemesas } from '@/components/remesas/comun/tipos-ui'
import type { CalidadDatos, ResumenPlan, SaludCliente } from './plan-tipos'
import type { SesionFba } from './acceso'
import { esClienteConCatalogo } from './catalogo/tipos'
import { diaEnEspana } from './fechas'
import { elegirLectura } from './lectura-elegida'
import { mercadoDeRemesa } from './medidas-cliente'
import { leerTodo } from './paginar'
import { reglaDeAcceso, type AccesoFba } from './regla-acceso'
import { saludCliente } from './salud'

/**
 * QUIÉN ES LA PERSONA QUE ABRE REMESAS A FBA Y QUÉ CLIENTES VE (spec remesas-pro §1.3, §1.4 y §11 D20, D27, D39, D40). SOLO SERVIDOR, SOLO LECTURA.
 * ==============================================================================================================================================
 * Es la única puerta: la página, la de alertas, `requireFbaAccess` (todas las rutas de /api/fba), el tablero y Cuentas de clientes
 * (lib/cuentas/remesas.ts) preguntan aquí. La regla es pura (`reglaDeAcceso`, regla-acceso.ts); aquí solo se leen sus datos:
 *
 *   profiles.role y profiles.puesto      el rol y, para el CEO, el puesto
 *   user_app_permissions (app remesas)   la casilla de Gestión de Usuarios: la que da el acceso de agencia a un empleado (D27)
 *   fba_accesos                          los clientes sueltos de un empleado sin casilla o de un cliente de fuera
 *
 * CAMBIO DE COMPORTAMIENTO (anotado, §1.4 y D27): hasta ahora un empleado solo veía los clientes de `fba_accesos` (0 filas en producción,
 * así que los administrativos no veían nada). Ahora un empleado con la casilla `remesas` ve todos los clientes y edita como agencia, pero
 * NO es administrador: Leer ventas, Leer de Amazon, Enviar a Amazon, borrar remesas o filas del catálogo, los accesos externos y refrescar
 * el catálogo contra Amazon siguen siendo solo de admin. Un CEO sin la casilla pasa a ser como un empleado sin ella.
 *
 * `clientesDeSesion` además pinta cada cliente para el selector (ClienteRemesas): contadores, si tiene base de datos de referencias (D40, por
 * DATOS: filas en `fba_catalogo` o el nombre de ShoesF), el mercado de la lectura elegida, el mercado de las remesas nuevas (D20), la moneda,
 * si está conectado y la salud de la última pasada del planificador (si la migración 316 está lanzada; si no, `null`).
 * Cada parte falla por su lado: si una lectura de adorno falla, el cliente sale igual con el valor prudente.
 */

type Servicio = ReturnType<typeof createServiceClient>

/** El id de la app en `user_app_permissions` (lib/config/apps.ts) */
export const APP_REMESAS = 'remesas'

/** Pantalla vacía (§1.3): el texto depende de quién mira */
export const TEXTO_SIN_CLIENTES = {
  cliente: 'Tu cuenta todavía no tiene acceso a ninguna cuenta de Amazon. Pídeselo a Liberty Seller.',
  empleado: 'Pide a un administrador que te dé acceso a Remesas.',
  admin: 'No hay ningún cliente de Amazon dado de alta todavía.',
} as const

const sinTabla = (e: { code?: string } | null | undefined) =>
  e?.code === '42P01' || e?.code === '42703' || e?.code === 'PGRST204' || e?.code === 'PGRST205'

/* ------------------------------------------------------------------ */
/* La sesión (ligera: tres lecturas pequeñas)                          */
/* ------------------------------------------------------------------ */

export interface PerfilDeAcceso {
  userId: string
  role: string
  puesto: string | null
  casillaRemesas: boolean
  accesos: AccesoFba[]
}

/** Lee lo que necesita `reglaDeAcceso`. Un admin que no es CEO no necesita ni la casilla ni sus accesos: no se leen */
export async function leerPerfilDeAcceso(service: Servicio, userId: string): Promise<PerfilDeAcceso> {
  let role = 'employee'
  let puesto: string | null = null
  const conPuesto = await service.from('profiles').select('role, puesto').eq('id', userId).maybeSingle()
  if (conPuesto.error && sinTabla(conPuesto.error)) {
    // Sin la columna `puesto` (migración vieja): solo el rol
    const soloRol = await service.from('profiles').select('role').eq('id', userId).maybeSingle()
    if (soloRol.error) throw soloRol.error
    role = (soloRol.data as { role?: string } | null)?.role ?? 'employee'
  } else {
    if (conPuesto.error) throw conPuesto.error
    const p = conPuesto.data as { role?: string | null; puesto?: string | null } | null
    role = p?.role ?? 'employee'
    puesto = p?.puesto ?? null
  }

  if (role === 'admin' && puesto !== 'ceo') return { userId, role, puesto, casillaRemesas: true, accesos: [] }

  const [casilla, accesos] = await Promise.all([
    role === 'admin' || role === 'employee'
      ? service.from('user_app_permissions').select('can_access').eq('user_id', userId).eq('app_id', APP_REMESAS).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    service.from('fba_accesos').select('client_id, puede_editar').eq('user_id', userId),
  ])
  if (accesos.error) throw accesos.error
  // La casilla que no se puede leer no da acceso (lo prudente); los accesos sueltos siguen valiendo
  const casillaRemesas = !casilla.error && (casilla.data as { can_access?: boolean } | null)?.can_access === true
  return {
    userId,
    role,
    puesto,
    casillaRemesas,
    accesos: ((accesos.data ?? []) as Array<{ client_id: string; puede_editar: boolean | null }>).map((a) => ({ clienteId: a.client_id, puedeEditar: a.puede_editar === true })),
  }
}

export function rolDeRemesas(role: string): SesionRemesas['rol'] {
  return role === 'admin' ? 'admin' : role === 'employee' ? 'employee' : 'cliente'
}

/** La sesión de Remesas a partir del perfil leído (puro) */
export function sesionDesdePerfil(p: PerfilDeAcceso): SesionRemesas {
  const regla = reglaDeAcceso({ role: p.role, puesto: p.puesto, casillaRemesas: p.casillaRemesas, accesos: p.accesos })
  return {
    usuarioId: p.userId,
    rol: rolDeRemesas(p.role),
    actor: regla.actor,
    esAgencia: regla.actor === 'agencia',
    esAdmin: regla.esAdmin,
    clientesPermitidos: regla.clientesPermitidos,
    editables: regla.editables,
  }
}

/** Solo la sesión, sin pintar los clientes: es lo que usa `requireFbaAccess` en cada ruta */
export async function sesionDeRemesas(userId: string, service: Servicio = createServiceClient()): Promise<SesionRemesas> {
  return sesionDesdePerfil(await leerPerfilDeAcceso(service, userId))
}

/** La forma vieja (lib/fba/acceso.ts) de la misma sesión, para las piezas que aún la usan (alertas, tablero…) */
export function sesionFbaDe(s: SesionRemesas): SesionFba {
  return {
    userId: s.usuarioId,
    role: s.rol,
    esAdmin: s.esAdmin,
    actor: s.actor,
    clientesPermitidos: s.clientesPermitidos,
    clientesEditables: s.editables,
  }
}

export function puedeEditarCliente(s: Pick<SesionRemesas, 'clientesPermitidos' | 'editables'>, clienteId: string): boolean {
  const ve = s.clientesPermitidos === null || s.clientesPermitidos.includes(clienteId)
  return ve && (s.editables === null || s.editables.includes(clienteId))
}

export function textoSinClientes(s: Pick<SesionRemesas, 'actor' | 'esAdmin' | 'clientesPermitidos'>): string {
  if (s.actor === 'cliente') return TEXTO_SIN_CLIENTES.cliente
  // Con acceso a todos y aun así ninguno: es que no hay clientes dados de alta
  if (s.clientesPermitidos === null) return TEXTO_SIN_CLIENTES.admin
  return TEXTO_SIN_CLIENTES.empleado
}

/* ------------------------------------------------------------------ */
/* Cachés del proceso para lo que casi no cambia                       */
/* ------------------------------------------------------------------ */

const CACHE_MS = 10 * 60_000
const cacheLeidoDesde = new Map<string, { valor: string | null; hasta: number }>()
const cacheCatalogo = new Map<string, { valor: boolean; hasta: number }>()

function deCache<T>(m: Map<string, { valor: T; hasta: number }>, k: string): T | undefined {
  const x = m.get(k)
  if (!x) return undefined
  if (x.hasta < Date.now()) {
    m.delete(k)
    return undefined
  }
  return x.valor
}

/** Vacía las cachés (pruebas, o tras importar un CSV de catálogo) */
export function olvidarCachesDeSesion(): void {
  cacheLeidoDesde.clear()
  cacheCatalogo.clear()
}

/**
 * ¿Tiene base de datos de referencias? (D40) Filas en `fba_catalogo`, o el nombre de ShoesF (compatibilidad). Sin la tabla, solo el nombre.
 */
export async function tieneCatalogo(clienteId: string, nombre: string | null, service: Servicio = createServiceClient()): Promise<boolean> {
  if (esClienteConCatalogo(nombre)) return true
  const guardado = deCache(cacheCatalogo, clienteId)
  if (guardado !== undefined) return guardado
  const { data, error } = await service.from('fba_catalogo').select('client_id').eq('client_id', clienteId).limit(1)
  if (error) return false
  const valor = ((data ?? []) as unknown[]).length > 0
  cacheCatalogo.set(clienteId, { valor, hasta: Date.now() + CACHE_MS })
  return valor
}

/** El primer día del libro de una copia (conexión + mercado): `elegirLectura` lo necesita para saber si cubre la historia (D35) */
async function leidoDesde(service: Servicio, conexion: string, mercado: string): Promise<string | null> {
  const k = `${conexion}:${mercado}`
  const guardado = deCache(cacheLeidoDesde, k)
  if (guardado !== undefined) return guardado
  const { data, error } = await service
    .from('fba_movimientos')
    .select('fecha')
    .eq('connection_id', conexion)
    .eq('marketplace_id', mercado)
    .order('fecha', { ascending: true })
    .limit(1)
  if (error) return null
  const valor = ((data ?? []) as Array<{ fecha: string }>)[0]?.fecha?.slice(0, 10) ?? null
  cacheLeidoDesde.set(k, { valor, hasta: Date.now() + CACHE_MS })
  return valor
}

function restarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - dias)
  return d.toISOString().slice(0, 10)
}

/** El mercado de las remesas nuevas de UN cliente (D20): su última remesa enviada o cerrada; si no, la región de su conexión */
export async function mercadoDeRemesaDe(clienteId: string, service: Servicio = createServiceClient()): Promise<string> {
  const [ultima, conexion] = await Promise.all([
    service
      .from('fba_remesas')
      .select('marketplace_id, fecha_envio')
      .eq('client_id', clienteId)
      .in('estado', ['enviada', 'cerrada'])
      .order('fecha_envio', { ascending: false })
      .limit(1),
    service.from('amazon_connections').select('region').eq('client_id', clienteId).eq('is_active', true).limit(1),
  ])
  const m = ((ultima.data ?? []) as Array<{ marketplace_id: string | null }>)[0]?.marketplace_id ?? null
  const r = ((conexion.data ?? []) as Array<{ region: string | null }>)[0]?.region ?? null
  return mercadoDeRemesa(m, r === 'eu' || r === 'na' || r === 'fe' ? r : null)
}

/* ------------------------------------------------------------------ */
/* Los clientes de la sesión                                           */
/* ------------------------------------------------------------------ */

export interface ClientesDeSesion {
  sesion: SesionRemesas
  clientes: ClienteRemesas[]
  /** Texto para la pantalla vacía; null si hay clientes */
  vacio: string | null
}

export interface OpcionesClientesDeSesion {
  service?: Servicio
  hoy?: string
  /**
   * false = solo id, nombre, contadores y si edita (el tablero y Cuentas no necesitan más): no se leen lecturas, catálogo ni salud.
   * `tieneCatalogo` sale entonces solo del nombre y `mercadoLectura` es null.
   */
  detalle?: boolean
}

/**
 * La sesión y sus clientes pintados para el selector, ordenados por nombre. Nunca devuelve un cliente fuera de lo permitido:
 * la lista se filtra en la consulta, no en pantalla.
 */
export async function clientesDeSesion(userId: string, opciones: OpcionesClientesDeSesion = {}): Promise<ClientesDeSesion> {
  const service = opciones.service ?? createServiceClient()
  const hoy = opciones.hoy ?? diaEnEspana()
  const detalle = opciones.detalle !== false
  const sesion = await sesionDeRemesas(userId, service)

  if (sesion.clientesPermitidos !== null && sesion.clientesPermitidos.length === 0) {
    return { sesion, clientes: [], vacio: textoSinClientes(sesion) }
  }

  const consulta = service.from('amazon_clients').select('id, name')
  const { data: filasClientes, error } = await (sesion.clientesPermitidos === null ? consulta : consulta.in('id', sesion.clientesPermitidos)).order('name', { ascending: true })
  if (error) throw error
  const base = ((filasClientes ?? []) as Array<{ id: string; name: string | null }>).map((c) => ({ id: c.id, nombre: c.name ?? '' }))
  if (base.length === 0) return { sesion, clientes: [], vacio: textoSinClientes(sesion) }
  const ids = base.map((c) => c.id)

  /* ---------- remesas: contadores, último mercado enviado y primer envío (una lectura paginada) ---------- */
  type FilaRemesa = { id: string; client_id: string; estado: string | null; marketplace_id: string | null; fecha_envio: string | null }
  const remesas = await leerTodo<FilaRemesa>((a, b) =>
    service.from('fba_remesas').select('id, client_id, estado, marketplace_id, fecha_envio').in('client_id', ids).order('id', { ascending: true }).range(a, b)
  ).catch(() => [] as FilaRemesa[])
  const contar = new Map<string, { envios: number; propuestas: number; listas: number; ultima: { fecha: string; mercado: string | null } | null; primera: string | null }>()
  for (const r of remesas) {
    const x = contar.get(r.client_id) ?? { envios: 0, propuestas: 0, listas: 0, ultima: null, primera: null }
    // Sin estado = remesa de antes de la migración 195: historia, o sea envío
    const real = ['enviada', 'cerrada'].includes(r.estado ?? 'cerrada')
    if (real) {
      x.envios++
      const f = (r.fecha_envio ?? '').slice(0, 10)
      if (f) {
        if (!x.ultima || f > x.ultima.fecha) x.ultima = { fecha: f, mercado: r.marketplace_id }
        if (!x.primera || f < x.primera) x.primera = f
      }
    } else {
      x.propuestas++
      // Encajadas y listas para enlazar: «Importar pedidos» avisa de que no se cree otra remesa encima
      if (r.estado === 'lista') x.listas++
    }
    contar.set(r.client_id, x)
  }

  /* ---------- conexiones activas: conectado y región ---------- */
  const { data: conexiones } = await service.from('amazon_connections').select('id, client_id, region').in('client_id', ids).eq('is_active', true)
  const conexionDe = new Map<string, { id: string; region: 'eu' | 'na' | 'fe' | null }>()
  for (const c of (conexiones ?? []) as Array<{ id: string; client_id: string; region: string | null }>) {
    if (conexionDe.has(c.client_id)) continue // una por cliente hoy; con dos, la pasada lo dice en la calidad (D34)
    conexionDe.set(c.client_id, { id: c.id, region: c.region === 'eu' || c.region === 'na' || c.region === 'fe' ? c.region : null })
  }

  /* ---------- con detalle: lectura elegida, catálogo y salud ---------- */
  const mercadoLectura = new Map<string, string | null>()
  const catalogo = new Map<string, boolean>()
  const salud = new Map<string, SaludCliente | null>()
  if (detalle) {
    const idsConexion = [...new Set([...conexionDe.values()].map((c) => c.id))]
    const lecturas = idsConexion.length
      ? await service.from('fba_lecturas').select('connection_id, marketplace_id, leido_hasta, ultimo_error').in('connection_id', idsConexion)
      : { data: [], error: null }
    const porConexion = new Map<string, Array<{ marketplace_id: string; leido_hasta: string | null; ultimo_error: string | null }>>()
    for (const l of (lecturas.data ?? []) as Array<{ connection_id: string; marketplace_id: string; leido_hasta: string | null; ultimo_error: string | null }>) {
      const lista = porConexion.get(l.connection_id) ?? []
      lista.push(l)
      porConexion.set(l.connection_id, lista)
    }

    const [, , ultimas, ajustes] = await Promise.all([
      Promise.all(
        base.map(async (c) => {
          const con = conexionDe.get(c.id)
          const filas = con ? porConexion.get(con.id) ?? [] : []
          if (!con || filas.length === 0) {
            mercadoLectura.set(c.id, null)
            return
          }
          const candidatas = await Promise.all(
            filas.map(async (f) => ({
              marketplaceId: f.marketplace_id,
              leidoHasta: f.leido_hasta,
              leidoDesde: f.leido_hasta ? await leidoDesde(service, con.id, f.marketplace_id) : null,
              ultimoError: f.ultimo_error,
            }))
          )
          const primera = contar.get(c.id)?.primera ?? null
          const tope = restarDias(hoy, 400)
          const desdeNecesario = primera && primera > tope ? primera : tope
          mercadoLectura.set(c.id, elegirLectura(candidatas, desdeNecesario)?.elegida.marketplaceId ?? null)
        })
      ),
      Promise.all(base.map(async (c) => catalogo.set(c.id, await tieneCatalogo(c.id, c.nombre, service).catch(() => esClienteConCatalogo(c.nombre))))),
      service.from('fba_plan_ultima').select('client_id, resumen, calidad').in('client_id', ids),
      service.from('fba_reposicion_config').select('client_id, planificador_activo').in('client_id', ids),
    ])

    const activo = new Map<string, boolean>()
    if (!ajustes.error) for (const a of (ajustes.data ?? []) as Array<{ client_id: string; planificador_activo: boolean | null }>) activo.set(a.client_id, a.planificador_activo !== false)
    const pasada = new Map<string, { resumen: ResumenPlan | null; calidad: CalidadDatos | null }>()
    if (!ultimas.error) {
      for (const u of (ultimas.data ?? []) as Array<{ client_id: string; resumen: unknown; calidad: unknown }>) {
        const r = u.resumen && typeof u.resumen === 'object' && Object.keys(u.resumen).length ? (u.resumen as ResumenPlan) : null
        const q = u.calidad && typeof u.calidad === 'object' && Object.keys(u.calidad).length ? (u.calidad as CalidadDatos) : null
        pasada.set(u.client_id, { resumen: r, calidad: q })
      }
    }
    for (const c of base) {
      const p = pasada.get(c.id)
      const primerEnvio = (contar.get(c.id)?.envios ?? 0) === 0
      // Sin pasada guardada (o sin la 316) no se inventa la salud, salvo la del cliente nuevo, que no depende del plan
      if (!p) {
        salud.set(c.id, primerEnvio ? saludCliente(null, null, { activo: true, movimientos90: 0, primerEnvio }) : null)
        continue
      }
      salud.set(
        c.id,
        saludCliente(p.resumen, p.calidad, {
          activo: activo.get(c.id) ?? true,
          // La pasada no guarda el número de movimientos: con el libro leído se da por hecho que los hay (sin leer ya es gris)
          movimientos90: p.calidad && p.calidad.libro !== 'sin_leer' ? 1 : 0,
          primerEnvio,
        })
      )
    }
  }

  const clientes: ClienteRemesas[] = base.map((c) => {
    const x = contar.get(c.id)
    const con = conexionDe.get(c.id) ?? null
    const mercadoRemesa = mercadoDeRemesa(x?.ultima?.mercado ?? null, con?.region ?? null)
    const lectura = mercadoLectura.get(c.id) ?? null
    const moneda = marketplaceById(lectura ?? mercadoRemesa)?.currency ?? marketplaceById(mercadoRemesa)?.currency ?? 'EUR'
    return {
      id: c.id,
      nombre: c.nombre,
      tieneCatalogo: detalle ? catalogo.get(c.id) ?? esClienteConCatalogo(c.nombre) : esClienteConCatalogo(c.nombre),
      mercadoLectura: lectura,
      mercadoRemesa,
      moneda,
      conectado: con !== null,
      salud: salud.get(c.id) ?? null,
      // «+N envíos nuevos en Amazon» no se calcula aquí (pide Amazon): lo trae el navegador después (useEnviosNuevos)
      contadores: { envios: x?.envios ?? 0, propuestas: x?.propuestas ?? 0, listas: x?.listas ?? 0, enviosNuevos: 0 },
      puedeEditar: puedeEditarCliente(sesion, c.id),
    }
  })

  return { sesion, clientes, vacio: null }
}

