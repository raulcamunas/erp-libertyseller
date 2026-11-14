/** Lo que devuelve /api/cuentas, tal y como lo usa la pantalla */
import type { PasoDelCiclo, SemanaDelCiclo } from '@/lib/cuentas/ciclo'
import type { CifrasCumplimiento, ResumenPpc, ResumenSeo } from '@/lib/cuentas/resumen'
import type { Persona } from '@/lib/cuentas/datos'
import type { TareaDeHoy as TareaCumplimiento } from '@/lib/cumplimiento/acciones'

export interface CuentaEnLista {
  slug: string
  nombre: string
  responsable: Persona | null
  cicloInicio: string | null
  notas: string | null
  semana: SemanaDelCiclo | null
  pasos: PasoDelCiclo[]
  hechos: string[]
  ppc: { cuentas: ResumenPpc[]; error: string | null }
  cumplimiento: CifrasCumplimiento | null
  seo?: { cuentas: ResumenSeo[]; error: string | null }
  tareasCumplimiento?: { tareas: TareaCumplimiento[]; error: string | null }
}

export interface RespuestaCuentas {
  hoy: string
  yo: string
  falta307: boolean
  aviso307: string | null
  personas: Persona[]
  clientes: CuentaEnLista[]
}

/** La dirección de cada herramienta, ya en el cliente y la cuenta que toca */
export function enlaceDe(herramienta: PasoDelCiclo['herramienta'], c: Pick<CuentaEnLista, 'slug' | 'ppc' | 'seo'>): string {
  const perfil = c.ppc.cuentas[0]?.perfilId
  const seo = c.seo?.cuentas[0]?.cuentaId
  const q = (base: string, p: string | undefined, t: string) => `${base}?c=${encodeURIComponent(c.slug)}${p ? `&p=${encodeURIComponent(p)}` : ''}&t=${t}`
  switch (herramienta) {
    case 'ppc-hoy':
    case 'ppc-propuestas':
      return q('/dashboard/marketing-test', perfil, 'propuestas')
    case 'ppc-ficha':
      return q('/dashboard/marketing-test', perfil, 'ficha')
    case 'seo-hoy':
      return q('/dashboard/seo-test', seo, 'hoy')
    case 'seo-busquedas':
      return q('/dashboard/seo-test', seo, 'busquedas')
    case 'cumplimiento-hoy':
      return q('/dashboard/cumplimiento', undefined, 'hoy')
    case 'informe':
      return `/dashboard/cuentas?c=${encodeURIComponent(c.slug)}#informe`
    case 'tareas':
      return '/dashboard/tareas-clientes'
  }
}

/** ACoS de una ventana, en tanto por uno (null si no hay ventas) */
export const acosDe = (v: { gasto: number; ventas: number }) => (v.ventas > 0 ? v.gasto / v.ventas : null)

/** La suma de las cuentas de publicidad de un cliente (varios países, misma moneda casi siempre) */
export function sumaPpc(cuentas: readonly ResumenPpc[]) {
  const s = { gasto: 0, ventas: 0, pedidos: 0, gastoAnt: 0, ventasAnt: 0, pendientes: 0, recuperable: 0, totales: 0, conTotales: false }
  for (const c of cuentas) {
    s.gasto += c.ultimos.gasto
    s.ventas += c.ultimos.ventas
    s.pedidos += c.ultimos.pedidos
    s.gastoAnt += c.anteriores.gasto
    s.ventasAnt += c.anteriores.ventas
    s.pendientes += c.pendientes
    s.recuperable += c.recuperable
    if (c.ventasTotales7 != null) {
      s.totales += c.ventasTotales7
      s.conTotales = true
    }
  }
  return s
}
