import { PUESTO_CEO } from '@/lib/usuarios/ceo'
import { sinAcentos } from '@/lib/usuarios/casillas'

/**
 * LA LISTA DE GESTIÓN DE USUARIOS: CATEGORÍAS, FILTROS, RESUMEN Y CAMBIOS DE LA FICHA — PURO.
 * ===========================================================================================
 * Se comprueba con filtros.prueba.ts.
 */

export interface UsuarioDeLista {
  id: string
  email: string
  full_name: string | null
  role: string
  puesto?: string | null
  is_comercial?: boolean
  created_at: string
  desactivado?: boolean
  ultimo_acceso?: string | null
  /** Ids de las casillas marcadas */
  accesos: readonly string[]
}

export type Categoria = 'direccion' | 'comercial' | 'administracion' | 'empleado' | 'cliente'
export type Filtro = 'todos' | Categoria | 'desactivados'

export const ETIQUETA_DE_CATEGORIA: Record<Categoria, string> = {
  direccion: 'Dirección',
  comercial: 'Comercial',
  administracion: 'Administración',
  empleado: 'Empleados',
  cliente: 'Clientes',
}

/** En qué montón cae cada persona (para los filtros y las tarjetas de resumen) */
export function categoriaDe(u: Pick<UsuarioDeLista, 'role' | 'puesto'>): Categoria {
  if (u.role === 'admin' || u.role === 'partner') return 'direccion'
  if (u.role === 'cliente') return 'cliente'
  if (u.puesto === 'comercial' || u.puesto === 'manager_comercial' || u.puesto === 'comercial_autonomo') return 'comercial'
  if (u.puesto === 'gestion_administrativa') return 'administracion'
  return 'empleado'
}

export function coincideBusqueda(u: Pick<UsuarioDeLista, 'email' | 'full_name'>, texto: string): boolean {
  const q = sinAcentos(texto.trim())
  if (!q) return true
  return sinAcentos(u.full_name ?? '').includes(q) || u.email.toLowerCase().includes(q)
}

/** Los que se ven con un filtro y una búsqueda. «Todos» no enseña a los desactivados: tienen su propio filtro */
export function filtrarUsuarios<T extends UsuarioDeLista>(usuarios: readonly T[], filtro: Filtro, texto: string): T[] {
  return usuarios.filter((u) => {
    if (!coincideBusqueda(u, texto)) return false
    if (filtro === 'desactivados') return u.desactivado === true
    if (u.desactivado) return false
    return filtro === 'todos' || categoriaDe(u) === filtro
  })
}

export interface Resumen {
  activos: number
  desactivados: number
  porCategoria: Record<Categoria, number>
  /** Los CEO, dentro de Dirección */
  ceos: number
  /** Personas dadas de alta cada mes, los últimos `meses` (la más antigua primero), acumuladas: para la sparkline */
  altasAcumuladas: number[]
  /** Altas en los últimos 30 días */
  altasRecientes: number
}

export function resumir(usuarios: readonly UsuarioDeLista[], ahora: number = Date.now(), meses = 8): Resumen {
  const porCategoria: Record<Categoria, number> = { direccion: 0, comercial: 0, administracion: 0, empleado: 0, cliente: 0 }
  let activos = 0
  let desactivados = 0
  let ceos = 0
  let altasRecientes = 0
  const fin = new Date(ahora)
  const inicios = Array.from({ length: meses }, (_, i) => Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth() - (meses - 1 - i) + 1, 1))
  const acumuladas = new Array<number>(meses).fill(0)
  for (const u of usuarios) {
    const alta = Date.parse(u.created_at)
    if (Number.isFinite(alta)) {
      if (ahora - alta <= 30 * 86_400_000 && alta <= ahora) altasRecientes++
      // Cuenta en cada mes cuyo final (inicio del siguiente) es posterior al alta
      inicios.forEach((finDeMes, i) => {
        if (alta < finDeMes) acumuladas[i]++
      })
    }
    if (u.desactivado) {
      desactivados++
      continue
    }
    activos++
    porCategoria[categoriaDe(u)]++
    if (u.role === 'admin' && u.puesto === PUESTO_CEO) ceos++
  }
  return { activos, desactivados, porCategoria, ceos, altasAcumuladas: acumuladas, altasRecientes }
}

/* ------------------------------------------------------------------ */
/* La ficha: cuántos cambios sin guardar                               */
/* ------------------------------------------------------------------ */

export interface DatosDeFicha {
  email: string
  full_name: string
  password: string
  role: string
  puesto: string | null
  is_comercial: boolean
  accesos: readonly string[]
}

/** Cuántas cosas han cambiado respecto a lo guardado: cada campo cuenta uno y cada casilla puesta o quitada, otro */
export function contarCambios(antes: DatosDeFicha, ahora: DatosDeFicha): number {
  let n = 0
  if (antes.email.trim() !== ahora.email.trim()) n++
  if (antes.full_name.trim() !== ahora.full_name.trim()) n++
  if (ahora.password.length > 0) n++
  if (antes.role !== ahora.role || (antes.puesto ?? null) !== (ahora.puesto ?? null)) n++
  if (antes.is_comercial !== ahora.is_comercial) n++
  const a = new Set(antes.accesos)
  const b = new Set(ahora.accesos)
  for (const id of Array.from(a)) if (!b.has(id)) n++
  for (const id of Array.from(b)) if (!a.has(id)) n++
  return n
}

/** Una contraseña de 14 caracteres sin letras que se confunden (l, 1, O, 0) */
export function generarContrasena(aleatorio: () => number = Math.random, largo = 14): string {
  const letras = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const signos = '!@#$%*?'
  let s = ''
  for (let i = 0; i < largo - 2; i++) s += letras[Math.floor(aleatorio() * letras.length)]
  s += signos[Math.floor(aleatorio() * signos.length)]
  s += String(2 + Math.floor(aleatorio() * 8))
  return s
}
