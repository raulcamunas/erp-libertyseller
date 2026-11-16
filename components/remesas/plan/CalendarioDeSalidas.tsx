'use client'

import type { CSSProperties } from 'react'
import { CalendarRange } from 'lucide-react'
import { EstadoVacio, Insignia } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { EnvioPropuestoGuardado } from '@/lib/fba/plan-tipos'
import { ESTADO_ENVIO, PRIORIDAD, diasEntre, dinero, entero, fechaCorta, sumarDias } from '../comun/estilo-plan'
import { cx } from '../comun/ui'

/**
 * CALENDARIO DE SALIDAS DEL PLAN (spec remesas-pro §1.5 y §6.3, D38): SIN recharts.
 *
 *   · Desde `xl:` (≥ 1280 px), una REJILLA CSS: semanas en columnas × envíos propuestos en filas. Cada envío es una
 *     pastilla del color de su prioridad que va de «decidir antes de» a «salir antes de», con un ROMBO en la primera
 *     rotura que evita y una raya en hoy.
 *   · Por debajo de `xl:`, una LISTA agrupada por la semana de salida (lo que cabe en un móvil de 375 px).
 *   Lo decide CSS (hidden / xl:block), no un hook: no salta al hidratar.
 *
 * API
 *   <CalendarioDeSalidas envios hoy onAbrir maxSemanas? mostrarCliente? />
 *
 * Puro (con prueba en plan.prueba.ts):
 *   lunesDe(fecha) · semanaIso(fecha) → { anio, semana } · roturaDeEnvio(envio) · rangoCalendario(envios, hoy, max)
 *   posicionEnRango(fecha, inicio, dias) (en %, recortada a 0-100) · agruparPorSemana(envios)
 */

/* ------------------------------------------------------------------ */
/* Puro                                                                */
/* ------------------------------------------------------------------ */

const diaSemanaIso = (fecha: string): number => {
  const d = new Date(`${fecha.slice(0, 10)}T00:00:00Z`).getUTCDay()
  return d === 0 ? 7 : d
}

/** El lunes de la semana ISO de `fecha` */
export function lunesDe(fecha: string): string {
  return sumarDias(fecha.slice(0, 10), 1 - diaSemanaIso(fecha))
}

/** Semana ISO (la del jueves de esa semana manda el año) */
export function semanaIso(fecha: string): { anio: number; semana: number } {
  const jueves = sumarDias(fecha.slice(0, 10), 4 - diaSemanaIso(fecha))
  const anio = Number(jueves.slice(0, 4))
  const primero = `${anio}-01-01`
  return { anio, semana: Math.floor(diasEntre(primero, jueves) / 7) + 1 }
}

/** La primera rotura (que decide) de las referencias que van en el envío */
export function roturaDeEnvio(e: Pick<EnvioPropuestoGuardado, 'lineas' | 'lineasAceptadas'>): string | null {
  let min: string | null = null
  for (const l of e.lineasAceptadas ?? e.lineas) {
    if (!(l.cantidad > 0) || !l.fechaRotura) continue
    if (min === null || l.fechaRotura < min) min = l.fechaRotura
  }
  return min
}

/**
 * De qué lunes a qué domingo se dibuja: desde la semana de hoy (o una antes si hay algo vencido) hasta la salida o la
 * rotura más tardía, con `maxSemanas` como mucho.
 */
export function rangoCalendario(
  envios: ReadonlyArray<Pick<EnvioPropuestoGuardado, 'decidirAntesDe' | 'salirAntesDe' | 'lineas' | 'lineasAceptadas'>>,
  hoy: string,
  maxSemanas = 12
): { inicio: string; semanas: number; dias: number } {
  let primero = hoy
  let ultimo = hoy
  for (const e of envios) {
    if (e.decidirAntesDe < primero) primero = e.decidirAntesDe
    if (e.salirAntesDe > ultimo) ultimo = e.salirAntesDe
    const r = roturaDeEnvio(e)
    if (r && r > ultimo) ultimo = r
  }
  const lunesHoy = lunesDe(hoy)
  const inicio = primero < lunesHoy ? sumarDias(lunesHoy, -7) : lunesHoy
  const semanas = Math.max(4, Math.min(maxSemanas, Math.floor(diasEntre(inicio, lunesDe(ultimo)) / 7) + 1))
  return { inicio, semanas, dias: semanas * 7 }
}

/** Dónde cae una fecha en la rejilla, en % del ancho (0-100) */
export function posicionEnRango(fecha: string, inicio: string, dias: number): number {
  const p = (diasEntre(inicio, fecha) / Math.max(1, dias)) * 100
  return Math.max(0, Math.min(100, p))
}

export interface SemanaDeSalidas<T> {
  lunes: string
  anio: number
  semana: number
  envios: T[]
}

/** Los envíos agrupados por la semana en la que tienen que salir, de la más próxima a la más lejana */
export function agruparPorSemana<T extends Pick<EnvioPropuestoGuardado, 'salirAntesDe' | 'decidirAntesDe'>>(envios: readonly T[]): Array<SemanaDeSalidas<T>> {
  const grupos = new Map<string, SemanaDeSalidas<T>>()
  for (const e of envios) {
    const lunes = lunesDe(e.salirAntesDe)
    let g = grupos.get(lunes)
    if (!g) {
      const s = semanaIso(e.salirAntesDe)
      g = { lunes, anio: s.anio, semana: s.semana, envios: [] }
      grupos.set(lunes, g)
    }
    g.envios.push(e)
  }
  return [...grupos.values()]
    .sort((a, b) => a.lunes.localeCompare(b.lunes))
    .map((g) => ({ ...g, envios: [...g.envios].sort((a, b) => a.salirAntesDe.localeCompare(b.salirAntesDe) || a.decidirAntesDe.localeCompare(b.decidirAntesDe)) }))
}

/* ------------------------------------------------------------------ */
/* Pantalla                                                            */
/* ------------------------------------------------------------------ */

function RomboRotura({ titulo, className, style }: { titulo: string; className?: string; style?: CSSProperties }) {
  return (
    <span className={cx('absolute top-1/2 z-[2] -translate-x-1/2 -translate-y-1/2', className)} style={style} title={titulo}>
      <svg viewBox="0 0 12 12" className="h-[12px] w-[12px]" aria-hidden>
        <path d="M6 0.8 L11.2 6 L6 11.2 L0.8 6 Z" fill="var(--ls-sup)" stroke={COLOR_ESTADO.rojo} strokeWidth={1.8} />
      </svg>
      <span className="sr-only">{titulo}</span>
    </span>
  )
}

export function CalendarioDeSalidas({
  envios,
  hoy,
  onAbrir,
  maxSemanas = 12,
  mostrarCliente = true,
}: {
  envios: readonly EnvioPropuestoGuardado[]
  hoy: string
  onAbrir: (id: string) => void
  maxSemanas?: number
  mostrarCliente?: boolean
}) {
  if (envios.length === 0) {
    return <EstadoVacio compacto icono={CalendarRange} titulo="Nada que salir en este filtro" descripcion="Cuando el plan proponga un envío, aquí verás cuándo hay que decidirlo y cuándo tiene que salir." />
  }
  const filas = [...envios].sort((a, b) => a.salirAntesDe.localeCompare(b.salirAntesDe) || a.decidirAntesDe.localeCompare(b.decidirAntesDe))
  const { inicio, semanas, dias } = rangoCalendario(filas, hoy, maxSemanas)
  const fin = sumarDias(inicio, dias - 1)
  const xHoy = posicionEnRango(hoy, inicio, dias) + 100 / dias / 2
  const columnas = Array.from({ length: semanas }, (_, i) => sumarDias(inicio, i * 7))
  const porSemana = agruparPorSemana(filas)

  return (
    <div className="min-w-0">
      {/* ---------------- Escritorio ancho: rejilla ---------------- */}
      <div className="hidden xl:block">
        <div className="grid min-w-0 text-[12px]" style={{ gridTemplateColumns: `minmax(170px, 220px) repeat(${semanas}, minmax(0, 1fr))` }}>
          <div className="border-b border-[var(--ls-linea)] pb-2 text-[11px] uppercase tracking-[0.06em] text-[var(--ls-t4)]">Envío</div>
          {columnas.map((l) => {
            const s = semanaIso(l)
            const esHoy = hoy >= l && hoy <= sumarDias(l, 6)
            return (
              <div key={l} className={cx('border-b border-l border-[var(--ls-linea)] px-2 pb-2 text-[11px] tabular-nums', esHoy ? 'font-semibold text-[var(--ls-t1)]' : 'text-[var(--ls-t4)]')}>
                S{s.semana} <span className="text-[var(--ls-t4)]">· {fechaCorta(l, hoy)}</span>
              </div>
            )
          })}

          {filas.map((e) => {
            const p = PRIORIDAD[e.prioridad]
            const color = COLOR_ESTADO[p.tono]
            const desde = e.decidirAntesDe < inicio ? inicio : e.decidirAntesDe
            const hasta = e.salirAntesDe > fin ? fin : e.salirAntesDe
            const izq = posicionEnRango(desde, inicio, dias)
            const der = posicionEnRango(sumarDias(hasta, 1), inicio, dias)
            const rotura = roturaDeEnvio(e)
            const xRotura = rotura && rotura >= inicio && rotura <= fin ? posicionEnRango(rotura, inicio, dias) + 100 / dias / 2 : null
            const titulo = `${e.clienteNombre}: decidir antes del ${fechaCorta(e.decidirAntesDe, hoy)}, salir antes del ${fechaCorta(e.salirAntesDe, hoy)}${rotura ? `, rotura el ${fechaCorta(rotura, hoy)}` : ''} · ${entero(e.unidades)} ud`
            return (
              <div key={e.id} className="contents">
                <button
                  type="button"
                  onClick={() => onAbrir(e.id)}
                  className="group flex min-w-0 flex-col items-start justify-center border-b border-[var(--ls-linea)] py-[7px] pr-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)]"
                  title={titulo}
                >
                  <span className="flex w-full min-w-0 items-center gap-[6px]">
                    <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: color }} aria-hidden />
                    <span className="truncate font-medium text-[var(--ls-t1)] group-hover:underline">{mostrarCliente ? e.clienteNombre : `Semana ${semanaIso(e.salirAntesDe).semana}`}</span>
                  </span>
                  <span className="truncate pl-[14px] text-[11px] tabular-nums text-[var(--ls-t4)]">
                    {entero(e.unidades)} ud · {ESTADO_ENVIO[e.estado].corto}
                  </span>
                </button>
                <div className="relative border-b border-[var(--ls-linea)]" style={{ gridColumn: `span ${semanas} / span ${semanas}` }}>
                  {/* Rayas de las semanas */}
                  {columnas.map((l, i) => (
                    <span key={l} aria-hidden className="absolute inset-y-0 border-l border-[var(--ls-linea)]" style={{ left: `${(i / semanas) * 100}%` }} />
                  ))}
                  {/* Hoy */}
                  <span aria-hidden className="absolute inset-y-0 z-[1] w-px" style={{ left: `${xHoy}%`, background: 'var(--ls-acc-graf, var(--ls-e-naranja))', opacity: 0.7 }} />
                  {/* Pastilla decidir → salir */}
                  <button
                    type="button"
                    onClick={() => onAbrir(e.id)}
                    title={titulo}
                    aria-label={titulo}
                    className="absolute top-1/2 z-[1] h-[18px] -translate-y-1/2 rounded-full border outline-none transition-[filter] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)]"
                    style={{
                      left: `${izq}%`,
                      width: `max(10px, ${Math.max(0, der - izq)}%)`,
                      background: `color-mix(in srgb, ${color} ${p.variante === 'solida' ? 34 : 22}%, transparent)`,
                      borderColor: `color-mix(in srgb, ${color} 55%, transparent)`,
                      backgroundImage: e.provisional ? `repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, ${color} 30%, transparent) 5px 7px)` : undefined,
                    }}
                  >
                    {e.vencido && <span className="absolute -left-[3px] top-1/2 h-[7px] w-[7px] -translate-y-1/2 rounded-full" style={{ background: COLOR_ESTADO.rojo }} />}
                  </button>
                  {xRotura !== null && <RomboRotura titulo={`Rotura el ${fechaCorta(rotura, hoy)}`} style={{ left: `${xRotura}%` }} />}
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-[var(--ls-t3)]">
          <span className="inline-flex items-center gap-[6px]">
            <span className="h-[8px] w-[22px] rounded-full border border-[var(--ls-linea2)] bg-[var(--ls-sup3)]" aria-hidden />
            de «decidir antes de» a «salir antes de»
          </span>
          <span className="inline-flex items-center gap-[6px]">
            <svg viewBox="0 0 12 12" className="h-[10px] w-[10px]" aria-hidden>
              <path d="M6 0.8 L11.2 6 L6 11.2 L0.8 6 Z" fill="none" stroke={COLOR_ESTADO.rojo} strokeWidth={1.8} />
            </svg>
            rotura que evita
          </span>
          <span className="inline-flex items-center gap-[6px]">
            <span className="h-[12px] w-px" style={{ background: 'var(--ls-acc-graf, var(--ls-e-naranja))' }} aria-hidden />
            hoy
          </span>
          <span>Rayado: plan provisional</span>
        </div>
      </div>

      {/* ---------------- Móvil, tableta y portátil: lista por semanas ---------------- */}
      <ol className="space-y-4 xl:hidden">
        {porSemana.map((g) => {
          const pasada = sumarDias(g.lunes, 6) < hoy
          const total = g.envios.reduce((s, e) => s + e.unidades, 0)
          return (
            <li key={g.lunes} className="min-w-0">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-[2px]">
                <h4 className="text-[12.5px] font-semibold text-[var(--ls-t1)]">
                  Semana {g.semana} <span className="font-normal text-[var(--ls-t3)]">· del {fechaCorta(g.lunes, hoy)} al {fechaCorta(sumarDias(g.lunes, 6), hoy)}</span>
                </h4>
                <span className="text-[11.5px] tabular-nums text-[var(--ls-t4)]">
                  {pasada ? 'ya pasada · ' : ''}
                  {g.envios.length} {g.envios.length === 1 ? 'envío' : 'envíos'} · {entero(total)} ud
                </span>
              </div>
              <ul className="space-y-[6px]">
                {g.envios.map((e) => {
                  const p = PRIORIDAD[e.prioridad]
                  const rotura = roturaDeEnvio(e)
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => onAbrir(e.id)}
                        className="flex min-h-[44px] w-full min-w-0 items-center gap-3 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2 text-left outline-none hover:border-[var(--ls-linea2)] focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)]"
                      >
                        <span className="h-9 w-[3px] shrink-0 rounded-full" style={{ background: COLOR_ESTADO[p.tono] }} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-[var(--ls-t1)]">
                            {mostrarCliente ? e.clienteNombre : `Envío de la semana ${g.semana}`}
                          </span>
                          <span className="block truncate text-[11.5px] tabular-nums text-[var(--ls-t3)]">
                            sale antes del {fechaCorta(e.salirAntesDe, hoy)}
                            {rotura ? ` · rotura ${fechaCorta(rotura, hoy)}` : ''} · {entero(e.unidades)} ud
                            {e.eurosEnRiesgo ? ` · ${dinero(e.eurosEnRiesgo, e.moneda)}` : ''}
                          </span>
                        </span>
                        <Insignia tono={p.tono} variante={p.variante} tamano="sm" vivo={p.vivo}>
                          {e.vencido ? 'Vencido' : p.corto}
                        </Insignia>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
