'use client'

import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, Plus, Trash2, X } from 'lucide-react'

/**
 * EL CALENDARIO DE INFORMES: LO QUE HAY PROGRAMADO Y CUÁNDO.
 *
 * Cada día marcado lleva su cuenta y su periodo, y no hay reglas que se repitan.
 * Es a propósito y es lo que se pidió: la gracia está en poder montar «esta
 * semana una, la siguiente dos, la otra una, la otra cuatro» y verlo de un
 * vistazo. Una regla de «todos los miércoles, 7 días» no sabría hacer eso, y la
 * mitad del trabajo de la agencia es justamente alternar.
 *
 *
 * ============ EL PERIODO NO SON DÍAS HACIA ATRÁS ============
 *
 * Programado el miércoles, «1 semana» NO es del miércoles anterior al martes:
 * es la SEMANA ANTERIOR COMPLETA, de lunes a domingo. Debajo del selector se
 * enseña el rango exacto que va a salir, calculado aquí mismo con la misma
 * aritmética que usa el servidor, porque un programador que no te dice qué días
 * va a coger es un programador en el que hay que confiar a ciegas.
 */

export interface CuentaAds {
  id: string
  nombre: string
  pais: string | null
  moneda: string | null
}

export interface Programacion {
  id: string
  perfil_id: string
  fecha: string
  periodo: '7d' | '14d' | '4s'
  estado: 'pendiente' | 'lanzado' | 'error'
  informe_id: string | null
  error: string | null
  lanzado_at: string | null
}

const SEMANAS: Record<Programacion['periodo'], number> = { '7d': 1, '14d': 2, '4s': 4 }

const ETIQUETA: Record<Programacion['periodo'], string> = {
  '7d': '1 sem',
  '14d': '2 sem',
  '4s': '4 sem',
}

/** La misma cuenta que hace el servidor. Ver rangoDe() en lib/ads/programador.ts */
export function rangoDe(fecha: string, periodo: Programacion['periodo']) {
  const [a, m, d] = fecha.split('-').map(Number)
  const dia = new Date(Date.UTC(a, m - 1, d))
  const desdeElLunes = (dia.getUTCDay() + 6) % 7
  const ultimoDomingo = new Date(dia)
  ultimoDomingo.setUTCDate(dia.getUTCDate() - desdeElLunes - 1)
  const primerLunes = new Date(ultimoDomingo)
  primerLunes.setUTCDate(ultimoDomingo.getUTCDate() - (SEMANAS[periodo] * 7 - 1))
  const iso = (x: Date) => x.toISOString().slice(0, 10)
  return { desde: iso(primerLunes), hasta: iso(ultimoDomingo) }
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]
const DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

/**
 * El nombre del cliente recortado para la celda.
 *
 * Se queda con las dos primeras palabras: «Creative Toys España · ES» pasa a
 * «Creative Toys», que es lo que distingue de un vistazo sin comerse la celda.
 * El nombre entero sigue estando en el `title` y en la ficha del día.
 */
function nombreCorto(n: string): string {
  return n.split(/[·|]/)[0].trim().split(/\s+/).slice(0, 2).join(' ')
}

function corto(iso: string): string {
  const [, mm, dd] = iso.split('-')
  const m = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  return `${Number(dd)} ${m[Number(mm) - 1]}`
}

/** Las celdas del mes, empezando en lunes y rellenando los huecos con null */
function celdasDelMes(ano: number, mesIdx: number): (string | null)[] {
  const primero = new Date(Date.UTC(ano, mesIdx, 1))
  const hueco = (primero.getUTCDay() + 6) % 7
  const dias = new Date(Date.UTC(ano, mesIdx + 1, 0)).getUTCDate()
  const out: (string | null)[] = Array(hueco).fill(null)
  for (let d = 1; d <= dias; d += 1) {
    out.push(`${ano}-${String(mesIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  while (out.length % 7 !== 0) out.push(null)
  return out
}

/* ------------------------------------------------------------------ */

export function CalendarioInformes({
  cuentas,
  programaciones,
  onProgramar,
  onQuitar,
  trabajando,
}: {
  cuentas: CuentaAds[]
  programaciones: Programacion[]
  onProgramar: (v: { perfilId: string; fecha: string; periodo: Programacion['periodo'] }) => void
  onQuitar: (id: string) => void
  trabajando: boolean
}) {
  const hoy = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [cursor, setCursor] = useState(() => {
    const d = new Date()
    return { ano: d.getFullYear(), mes: d.getMonth() }
  })
  const [abierto, setAbierto] = useState<string | null>(null)
  const [cuenta, setCuenta] = useState<string>(cuentas[0]?.id ?? '')
  const [periodo, setPeriodo] = useState<Programacion['periodo']>('7d')

  const celdas = useMemo(() => celdasDelMes(cursor.ano, cursor.mes), [cursor])

  const porDia = useMemo(() => {
    const m = new Map<string, Programacion[]>()
    for (const p of programaciones) {
      const y = m.get(p.fecha) ?? []
      y.push(p)
      m.set(p.fecha, y)
    }
    return m
  }, [programaciones])

  const nombreDe = (id: string) => cuentas.find((c) => c.id === id)?.nombre ?? 'Cuenta borrada'

  function mover(n: number) {
    setCursor((c) => {
      const d = new Date(Date.UTC(c.ano, c.mes + n, 1))
      return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() }
    })
    setAbierto(null)
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      {/* ---------------- Cabecera ---------------- */}
      <div className="mb-2 flex items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/45">
          <CalendarDays className="h-3 w-3" />
          Calendario
        </h3>
        <span className="ml-auto text-[12px] text-white capitalize">
          {MESES[cursor.mes]} {cursor.ano}
        </span>
        <button
          type="button"
          onClick={() => mover(-1)}
          className="rounded border border-white/10 p-0.5 text-white/50 hover:text-white"
          aria-label="Mes anterior"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => mover(1)}
          className="rounded border border-white/10 p-0.5 text-white/50 hover:text-white"
          aria-label="Mes siguiente"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ---------------- La rejilla ---------------- */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {DIAS.map((d, i) => (
          <span
            key={d}
            className={`pb-1 text-[10.5px] font-medium ${i >= 5 ? 'text-white/20' : 'text-white/35'}`}
          >
            {d}
          </span>
        ))}

        {celdas.map((fecha, i) => {
          if (!fecha) return <span key={`h${i}`} />

          const hay = porDia.get(fecha) ?? []
          const esHoy = fecha === hoy
          const pasado = fecha < hoy
          const activo = abierto === fecha

          return (
            <button
              key={fecha}
              type="button"
              onClick={() => setAbierto(activo ? null : fecha)}
              className={`min-h-[74px] rounded-md border p-1.5 text-left transition-colors ${
                activo
                  ? 'border-[#FF6600]/60 bg-[#FF6600]/10'
                  : hay.length > 0
                    ? 'border-violet-400/30 bg-violet-400/[0.07] hover:border-violet-400/50'
                    : 'border-white/[0.06] hover:border-white/20 hover:bg-white/[0.03]'
              }`}
            >
              <span
                className={`block text-[12px] tabular-nums ${
                  esHoy
                    ? 'font-semibold text-[#FF8A3D]'
                    : pasado
                      ? 'text-white/25'
                      : 'text-white/60'
                }`}
              >
                {Number(fecha.slice(8))}
              </span>

              {/* CADA PASTILLA LLEVA EL CLIENTE Y EL PERIODO.
                  Solo con el periodo —«2 sem»— la rejilla decía cuándo hay algo
                  pero no de quién, y con seis clientes eso obliga a abrir día por
                  día para saber qué falta. El nombre entero está en el `title`. */}
              {hay.slice(0, 3).map((p) => (
                <span
                  key={p.id}
                  className={`mt-0.5 flex items-baseline gap-1 truncate rounded px-1 py-px text-[9.5px] leading-[14px] ${
                    p.estado === 'error'
                      ? 'bg-red-400/20 text-red-200'
                      : p.estado === 'lanzado'
                        ? 'bg-emerald-400/15 text-emerald-200/90'
                        : 'bg-violet-400/20 text-violet-100'
                  }`}
                  title={`${nombreDe(p.perfil_id)} · ${ETIQUETA[p.periodo]} · ${
                    p.estado === 'lanzado' ? 'generado' : p.estado === 'error' ? 'falló' : 'esperando'
                  }`}
                >
                  <span className="truncate">{nombreCorto(nombreDe(p.perfil_id))}</span>
                  <span className="ml-auto flex-shrink-0 opacity-70">{ETIQUETA[p.periodo]}</span>
                </span>
              ))}
              {hay.length > 3 && (
                <span className="block text-[9px] text-white/35">+{hay.length - 3} más</span>
              )}
            </button>
          )
        })}
      </div>

      {/* ---------------- El día abierto ---------------- */}
      {abierto && (
        <div className="mt-2.5 rounded-lg border border-white/10 bg-black/25 p-2.5">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[11px] font-medium text-white">{corto(abierto)}</span>
            <button
              type="button"
              onClick={() => setAbierto(null)}
              className="ml-auto text-white/30 hover:text-white"
              aria-label="Cerrar"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Lo que ya hay ese día */}
          {(porDia.get(abierto) ?? []).map((p) => {
            const r = rangoDe(p.fecha, p.periodo)
            return (
              <div
                key={p.id}
                className="mb-1 flex flex-wrap items-baseline gap-x-2 rounded border border-white/[0.07] px-2 py-1 text-[10.5px]"
              >
                <span className="text-white/80">{nombreDe(p.perfil_id)}</span>
                <span className="rounded bg-violet-400/15 px-1 text-violet-100">
                  {ETIQUETA[p.periodo]}
                </span>
                <span className="text-white/35">
                  {corto(r.desde)} → {corto(r.hasta)}
                </span>
                <span
                  className={
                    p.estado === 'error'
                      ? 'text-red-300/80'
                      : p.estado === 'lanzado'
                        ? 'text-emerald-300/80'
                        : 'text-white/30'
                  }
                >
                  {p.estado === 'lanzado' ? 'generado' : p.estado === 'error' ? p.error : 'esperando'}
                </span>
                <button
                  type="button"
                  onClick={() => onQuitar(p.id)}
                  className="ml-auto text-white/25 hover:text-red-300"
                  aria-label="Quitar"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            )
          })}

          {/* Añadir uno */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <select
              value={cuenta}
              onChange={(e) => setCuenta(e.target.value)}
              className="h-7 min-w-[150px] flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-1.5 text-[11px] text-white outline-none"
            >
              {cuentas.map((c) => (
                <option key={c.id} value={c.id} className="bg-[#141417]">
                  {c.nombre}
                  {c.pais ? ` · ${c.pais}` : ''}
                </option>
              ))}
            </select>

            <div className="flex rounded-lg border border-white/10">
              {(['7d', '14d', '4s'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriodo(p)}
                  className={`h-7 px-2 text-[11px] first:rounded-l-lg last:rounded-r-lg transition-colors ${
                    periodo === p ? 'bg-[#FF6600]/20 text-white' : 'text-white/45 hover:text-white'
                  }`}
                >
                  {ETIQUETA[p]}
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={trabajando || !cuenta}
              onClick={() => onProgramar({ perfilId: cuenta, fecha: abierto, periodo })}
              className="flex h-7 items-center gap-1 rounded-lg border border-[#FF6600]/50 bg-[#FF6600]/10 px-2 text-[11px] text-white hover:bg-[#FF6600]/20 disabled:opacity-40"
            >
              {trabajando ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Plus className="h-3 w-3" />
              )}
              Programar
            </button>
          </div>

          {/* QUÉ DÍAS VA A COGER, ANTES DE PULSAR.
              Es la mitad del valor de esta pantalla: «1 semana» programado un
              miércoles no es del miércoles anterior, y sin verlo escrito nadie
              lo adivina. */}
          <p className="mt-1.5 text-[10px] leading-relaxed text-white/35">
            Cogerá <strong className="text-white/60">{corto(rangoDe(abierto, periodo).desde)}</strong>{' '}
            → <strong className="text-white/60">{corto(rangoDe(abierto, periodo).hasta)}</strong> —
            semanas completas de lunes a domingo, siempre anteriores a este día. Nunca «los últimos
            N días»: así dos informes del mismo cliente se pueden poner uno al lado del otro.
          </p>
        </div>
      )}
    </div>
  )
}
