/** Lo que devuelve /api/cuentas, tal y como lo usa la pantalla */
import type { PasoDelCiclo, SemanaDelCiclo } from '@/lib/cuentas/ciclo'
import type { CifrasCumplimiento, ResumenPpc, ResumenSeo } from '@/lib/cuentas/resumen'
import type { Persona } from '@/lib/cuentas/datos'
import type { TareaDeHoy as TareaCumplimiento } from '@/lib/cumplimiento/acciones'
import type { ResumenRemesas } from '@/lib/cuentas/remesas-tipos'
import type { EntradaDeSalud } from '@/lib/cuentas/salud'

export interface CuentaEnLista {
  slug: string
  nombre: string
  /** El id de amazon_clients (Remesas enlaza por él, no por el slug) */
  amazonClientId: string
  responsable: Persona | null
  cicloInicio: string | null
  notas: string | null
  semana: SemanaDelCiclo | null
  pasos: PasoDelCiclo[]
  hechos: string[]
  ppc: { cuentas: ResumenPpc[]; error: string | null }
  cumplimiento: CifrasCumplimiento | null
  remesas: ResumenRemesas
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

/** Remesas abre por el id del cliente (?cliente=) y una vista concreta */
export const enlaceRemesas = (c: Pick<CuentaEnLista, 'amazonClientId'>, vista: 'envios' | 'propuestas' | 'inventario' = 'envios') =>
  `/dashboard/remesas?cliente=${encodeURIComponent(c.amazonClientId)}&vista=${vista}`
export const ENLACE_ALERTAS_FBA = '/dashboard/remesas/alertas'

/** Las cifras de la cuenta tal como las quiere la salud (lib/cuentas/salud.ts). En la lista no hay SEO: sale gris y se mira al abrir */
export function entradaDeSalud(c: CuentaEnLista, hoy: string): EntradaDeSalud {
  const s = sumaPpc(c.ppc.cuentas)
  const hechos = c.pasos.filter((p) => c.hechos.includes(p.id)).length
  const seo = c.seo
  const tareasSeo = seo?.cuentas.flatMap((x) => x.tareas) ?? []
  return {
    hoy,
    ciclo: c.semana ? { total: c.pasos.length, hechos, siguiente: c.pasos.find((p) => !c.hechos.includes(p.id))?.titulo ?? null } : null,
    ppc: {
      conectado: c.ppc.cuentas.length > 0,
      error: Boolean(c.ppc.error),
      gasto: s.gasto,
      ventas: s.ventas,
      gastoAnt: s.gastoAnt,
      ventasAnt: s.ventasAnt,
      pendientes: s.pendientes,
      recuperable: s.recuperable,
      motorApagado: c.ppc.cuentas.length > 0 && c.ppc.cuentas.every((x) => x.modo === 'apagado'),
      moneda: c.ppc.cuentas[0]?.moneda ?? 'EUR',
    },
    seo: seo
      ? {
          error: Boolean(seo.error),
          cuentas: seo.cuentas.length,
          productos: seo.cuentas.reduce((a, x) => a + x.productos, 0),
          graves: tareasSeo.filter((t) => t.gravedad === 'grave').length,
          atencion: tareasSeo.filter((t) => t.gravedad === 'atencion').length,
          sinBrandAnalytics: seo.cuentas.some((x) => x.acceso === 'no'),
          titulosCambiados: seo.cuentas.reduce((a, x) => a + (x.titulosCambiados?.length ?? 0), 0),
          propuestasPendientes: seo.cuentas.reduce((a, x) => a + (x.propuestasPendientes ?? 0), 0),
        }
      : null,
    cumplimiento: c.cumplimiento,
    remesas: {
      acceso: c.remesas.acceso,
      error: Boolean(c.remesas.error),
      abiertas: c.remesas.abiertas,
      criticas: c.remesas.alertas.critica,
      altas: c.remesas.alertas.alta,
      faltaAlertas: c.remesas.faltaAlertas,
      totalRemesas: c.remesas.totalRemesas,
    },
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
