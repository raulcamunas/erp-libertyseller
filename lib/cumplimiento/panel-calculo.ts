import type { Gravedad, Tema } from './tipos'

/**
 * EL PANEL DE CUMPLIMIENTO · LOS TIPOS Y LAS CUENTAS PURAS. Sin base de datos: lo importan igual el servidor (lib/cumplimiento/panel.ts) que la pantalla.
 */

export interface CifrasDePais {
  id: string
  nombre: string
  pais: string
  /** Listings del catálogo del ERP en ese país */
  total: number
  revisados: number
  limpios: number
  atencion: number
  conErrores: number
  ocultos: number
  soloAvisos: number
  atencionConStock: number
  normativa: number
  /** Los que necesitan atención, por cuánto llevan abiertos */
  antiguedad: { d7: number; d30: number; d90: number; mas: number }
  ultimaRevision: string | null
}

export type CifrasTotales = Omit<CifrasDePais, 'id' | 'nombre' | 'pais'>

export interface TemaDelPanel {
  tema: Tema
  atencion: number
  todos: number
  atencionConStock: number
}

export interface CodigoDelPanel {
  codigo: string
  gravedad: Gravedad
  tema: Tema
  mensaje: string
  listings: number
  conStock: number
  ocultan: number
  desde: string | null
}

export interface PuntoDiario {
  dia: string
  revisados: number
  limpios: number
  atencion: number
  ocultos: number
  soloAvisos: number
  atencionConStock: number
}

export type PanelDeCumplimiento =
  | {
      ok: true
      /** Los países del cliente con listings, con sus cifras */
      paises: CifrasDePais[]
      /** Lo elegido: un país o la suma de todos */
      cifras: CifrasTotales
      temas: TemaDelPanel[]
      codigos: CodigoDelPanel[]
      diario: PuntoDiario[]
    }
  | { ok: false; faltaMigracion: true }
  | { ok: false; faltaMigracion?: false; error: string }

const n = (v: unknown) => Number(v ?? 0) || 0

export const CIFRAS_VACIAS: CifrasTotales = {
  total: 0,
  revisados: 0,
  limpios: 0,
  atencion: 0,
  conErrores: 0,
  ocultos: 0,
  soloAvisos: 0,
  atencionConStock: 0,
  normativa: 0,
  antiguedad: { d7: 0, d30: 0, d90: 0, mas: 0 },
  ultimaRevision: null,
}

/** La suma de varios países. Pura */
export function sumarCifras(lista: readonly CifrasTotales[]): CifrasTotales {
  return lista.reduce<CifrasTotales>(
    (a, c) => ({
      total: a.total + c.total,
      revisados: a.revisados + c.revisados,
      limpios: a.limpios + c.limpios,
      atencion: a.atencion + c.atencion,
      conErrores: a.conErrores + c.conErrores,
      ocultos: a.ocultos + c.ocultos,
      soloAvisos: a.soloAvisos + c.soloAvisos,
      atencionConStock: a.atencionConStock + c.atencionConStock,
      normativa: a.normativa + c.normativa,
      antiguedad: { d7: a.antiguedad.d7 + c.antiguedad.d7, d30: a.antiguedad.d30 + c.antiguedad.d30, d90: a.antiguedad.d90 + c.antiguedad.d90, mas: a.antiguedad.mas + c.antiguedad.mas },
      ultimaRevision: !a.ultimaRevision ? c.ultimaRevision : !c.ultimaRevision ? a.ultimaRevision : a.ultimaRevision > c.ultimaRevision ? a.ultimaRevision : c.ultimaRevision,
    }),
    CIFRAS_VACIAS
  )
}

/**
 * LA SALUD: qué parte de lo revisado NO necesita atención (sin errores ni oculto). null si no hay nada revisado: un 100 % sobre cero listings se leería como «todo bien».
 */
export function saludDe(c: Pick<CifrasTotales, 'revisados' | 'atencion'>): number | null {
  return c.revisados > 0 ? (c.revisados - c.atencion) / c.revisados : null
}

/** El color de la salud: verde desde el 95 %, ámbar desde el 85 %, rojo por debajo */
export function tonoDeSalud(s: number | null): 'verde' | 'ambar' | 'rojo' | 'gris' {
  if (s == null) return 'gris'
  return s >= 0.95 ? 'verde' : s >= 0.85 ? 'ambar' : 'rojo'
}

/** Los puntos de la foto diaria de varias cuentas y países, sumados por día. Pura */
export function sumarPorDia(filas: ReadonlyArray<{ dia: string; revisados: number; limpios: number; atencion: number; ocultos: number; solo_avisos: number; atencion_con_stock: number }>): PuntoDiario[] {
  const m = new Map<string, PuntoDiario>()
  for (const f of filas) {
    const p = m.get(f.dia) ?? { dia: f.dia, revisados: 0, limpios: 0, atencion: 0, ocultos: 0, soloAvisos: 0, atencionConStock: 0 }
    p.revisados += n(f.revisados)
    p.limpios += n(f.limpios)
    p.atencion += n(f.atencion)
    p.ocultos += n(f.ocultos)
    p.soloAvisos += n(f.solo_avisos)
    p.atencionConStock += n(f.atencion_con_stock)
    m.set(f.dia, p)
  }
  return [...m.values()].sort((a, b) => a.dia.localeCompare(b.dia))
}

