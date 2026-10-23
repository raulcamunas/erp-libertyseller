import { isMissingSchema } from '@/lib/plataforma/eventos'
import { createServiceClient } from '@/lib/supabase/service'
import type { TipoDeEvento } from './ingesta'
import { construirDia, type EventoDeActividad } from './linea'
import type { FilaDelEquipo, PersonaDelEquipo, RespuestaPersona } from './tipos'

/**
 * LAS LECTURAS DEL REGISTRO DE ACTIVIDAD. SOLO SERVIDOR.
 *
 * La tabla actividad_registro está cerrada al navegador (migración 240): se lee con la clave de servicio, y por eso
 * QUIEN LLAMA a estas funciones tiene que haber comprobado ya que la persona es administrador o tiene la casilla
 * «Actividad del equipo» (las dos rutas de /api/actividad lo hacen con requireAppAccess('actividad')).
 *
 * Solo se mira a los EMPLEADOS (rol 'employee'), que es a quien se registra: administradores, socios y clientes no.
 */

export const ID_DE_PERSONA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Una página de PostgREST son 1000 filas; un día con 12 páginas ya es mucho más de lo que hace nadie en un día */
const PAGINA = 1000
const MAX_PAGINAS = 12
/** Del registro se devuelven las últimas; lo demás se resume en los tiempos */
const MAX_REGISTRO = 800

type Servicio = ReturnType<typeof createServiceClient>

interface PerfilFila {
  id: string
  full_name: string | null
  email: string | null
  is_comercial: boolean | null
}

const nombreDe = (p: PerfilFila) => p.full_name?.trim() || p.email || 'Sin nombre'

const comoPersona = (p: PerfilFila): PersonaDelEquipo => ({ id: p.id, nombre: nombreDe(p), email: p.email, comercial: p.is_comercial === true })

async function empleados(service: Servicio): Promise<PerfilFila[]> {
  const { data, error } = await service
    .from('profiles')
    .select('id, full_name, email, is_comercial')
    .eq('role', 'employee')
    .order('full_name', { ascending: true })
  if (error) throw new Error(`No se ha podido leer el equipo (${(error as { code?: string }).code ?? 'sin código'})`)
  return (data ?? []) as PerfilFila[]
}

/** El último inicio de sesión de cada persona, que anota Supabase Auth (es la fuente de verdad del acceso) */
async function ultimosInicios(service: Servicio): Promise<Map<string, number>> {
  const mapa = new Map<string, number>()
  const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) {
    // Es un dato de adorno: sin él, la pantalla sigue
    console.warn('[actividad] no se han podido leer los últimos inicios de sesión')
    return mapa
  }
  for (const u of data.users) {
    const t = u.last_sign_in_at ? Date.parse(u.last_sign_in_at) : NaN
    if (Number.isFinite(t)) mapa.set(u.id, t)
  }
  return mapa
}

const aMs = (iso: string | null): number | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

interface FilaResumen {
  user_id: string
  primera: string | null
  ultima: string | null
  minutos_activos: number
  paginas: number
  clics: number
  sesiones: number
  logins: number
}

/** El día de todo el equipo: una fila por empleado, también los que no han hecho nada */
export async function equipoDelDia(desdeMs: number, hastaMs: number): Promise<{ faltaMigracion: true } | { faltaMigracion: false; filas: FilaDelEquipo[] }> {
  const service = createServiceClient()
  const [perfiles, resumen, inicios] = await Promise.all([
    empleados(service),
    service.rpc('actividad_resumen_equipo', { p_desde: new Date(desdeMs).toISOString(), p_hasta: new Date(hastaMs).toISOString() }),
    ultimosInicios(service),
  ])
  if (resumen.error) {
    if (isMissingSchema(resumen.error)) return { faltaMigracion: true }
    throw new Error(`No se ha podido leer la actividad (${(resumen.error as { code?: string }).code ?? 'sin código'})`)
  }
  const porPersona = new Map((resumen.data as FilaResumen[] | null ?? []).map((r) => [r.user_id, r]))

  const filas = perfiles.map((p): FilaDelEquipo => {
    const r = porPersona.get(p.id)
    return {
      ...comoPersona(p),
      primera: aMs(r?.primera ?? null),
      ultima: aMs(r?.ultima ?? null),
      minutosActivos: r?.minutos_activos ?? 0,
      paginas: r?.paginas ?? 0,
      clics: r?.clics ?? 0,
      sesiones: r?.sesiones ?? 0,
      logins: r?.logins ?? 0,
      ultimoLogin: inicios.get(p.id) ?? null,
    }
  })
  return { faltaMigracion: false, filas }
}

interface FilaEvento {
  id: number
  ocurrio_at: string
  tipo: TipoDeEvento
  ruta: string | null
  detalle: string | null
  sesion: string | null
  ip: string | null
  agente: string | null
}

/** El día de una persona: sus tiempos, sus pantallas y el registro de lo que hizo. null si no es un empleado */
export async function personaDelDia(id: string, desdeMs: number, hastaMs: number): Promise<RespuestaPersona | { faltaMigracion: true } | null> {
  const service = createServiceClient()
  const { data: perfil, error: errorPerfil } = await service.from('profiles').select('id, full_name, email, is_comercial, role').eq('id', id).maybeSingle()
  if (errorPerfil) throw new Error(`No se ha podido leer a la persona (${(errorPerfil as { code?: string }).code ?? 'sin código'})`)
  if (!perfil || (perfil as { role: string }).role !== 'employee') return null

  const desde = new Date(desdeMs).toISOString()
  const hasta = new Date(hastaMs).toISOString()
  const eventos: EventoDeActividad[] = []
  let completo = true
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const { data, error } = await service
      .from('actividad_registro')
      .select('id, ocurrio_at, tipo, ruta, detalle, sesion, ip, agente')
      .eq('user_id', id)
      .gte('ocurrio_at', desde)
      .lt('ocurrio_at', hasta)
      .order('ocurrio_at', { ascending: true })
      .order('id', { ascending: true })
      .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1)
    if (error) {
      if (isMissingSchema(error)) return { faltaMigracion: true }
      throw new Error(`No se ha podido leer la actividad (${(error as { code?: string }).code ?? 'sin código'})`)
    }
    const filas = (data ?? []) as FilaEvento[]
    for (const f of filas) {
      eventos.push({ id: Number(f.id), t: Date.parse(f.ocurrio_at), tipo: f.tipo, ruta: f.ruta, detalle: f.detalle, sesion: f.sesion, ip: f.ip, agente: f.agente })
    }
    if (filas.length < PAGINA) break
    if (pagina === MAX_PAGINAS - 1) completo = false
  }

  const dia = construirDia(eventos)
  const recortado = !completo || dia.registro.length > MAX_REGISTRO
  if (dia.registro.length > MAX_REGISTRO) dia.registro = dia.registro.slice(-MAX_REGISTRO)

  const { data: usuario } = await service.auth.admin.getUserById(id)
  const ultimoLogin = aMs(usuario?.user?.last_sign_in_at ?? null)

  return {
    persona: comoPersona(perfil as PerfilFila),
    desde: desdeMs,
    hasta: hastaMs,
    ahora: Date.now(),
    ultimoLogin,
    dia,
    recortado,
  }
}
