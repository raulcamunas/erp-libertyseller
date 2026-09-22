'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { Box, Check, Loader2, Package, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import type { LineaDePanel } from '@/lib/fba/datos'

/**
 * EL EDITOR DE CAJAS.
 *
 * Sustituye a la hoja donde había un bloque por caja —CAJA 1, medidas, peso,
 * total unidades— y debajo qué iba dentro, más tres celdas al final: Total
 * unidades, Total Envío y Discrepancia.
 *
 * Ese cero de «Discrepancia» era lo único que se miraba antes de cerrar un
 * envío. Aquí se calcula solo, a cada tecla, y se enseña arriba del todo: no
 * hay que buscarlo en una celda perdida a la derecha.
 *
 *
 * ============ POR QUÉ SE EDITA TODO Y SE GUARDA UNA VEZ ============
 *
 * Encajar es mover cosas: añades una caja, pasas tres unidades de la 1 a la 2,
 * corriges un peso. Si cada tecla fuera a la base, la mitad de los estados
 * intermedios serían inválidos —una remesa con seis unidades de más durante dos
 * segundos— y cualquier corte dejaría las cajas a medias.
 *
 * Así que se trabaja en memoria y se guarda el conjunto entero cuando quieres.
 * El botón avisa si hay cambios sin guardar.
 */

export interface CajaUI {
  numero: number
  largoCm: number | null
  anchoCm: number | null
  altoCm: number | null
  pesoKg: number | null
  contenido: Array<{ sku: string; unidades: number }>
}

const CAMPO =
  'w-full rounded border border-white/10 bg-white/[0.03] px-1.5 py-1 text-[12px] text-white placeholder:text-white/20 focus:border-[#FF6600]/40 focus:outline-none tabular-nums'

export function EditorCajas({
  remesaId,
  lineas,
  cajasIniciales,
  puedeEditar,
}: {
  remesaId: string
  lineas: LineaDePanel[]
  cajasIniciales: CajaUI[]
  puedeEditar: boolean
}) {
  const router = useRouter()
  const [cajas, setCajas] = useState<CajaUI[]>(
    cajasIniciales.length > 0 ? cajasIniciales : [nuevaCaja(1)]
  )
  const [sucio, setSucio] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const declaradas = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of lineas) m.set(l.sku, l.enviadas)
    return m
  }, [lineas])

  /** El cuadre, a cada tecla. Es el corazón de la pantalla */
  const cuadre = useMemo(() => {
    const encajadas = new Map<string, number>()
    for (const c of cajas) {
      for (const x of c.contenido) {
        encajadas.set(x.sku, (encajadas.get(x.sku) ?? 0) + x.unidades)
      }
    }
    const filas = lineas.map((l) => {
      const e = encajadas.get(l.sku) ?? 0
      return { sku: l.sku, nombre: l.nombre, variante: l.variante, declaradas: l.enviadas, encajadas: e, diferencia: l.enviadas - e }
    })
    // Lo que está en las cajas y no en la remesa: mercancía sin declarar
    for (const [sku, e] of encajadas) {
      if (!declaradas.has(sku)) {
        filas.push({ sku, nombre: null, variante: null, declaradas: 0, encajadas: e, diferencia: -e })
      }
    }
    return {
      filas,
      cuadra: filas.every((f) => f.diferencia === 0),
      pendientes: filas.reduce((s, f) => s + Math.max(0, f.diferencia), 0),
      sobrantes: filas.reduce((s, f) => s + Math.max(0, -f.diferencia), 0),
    }
  }, [cajas, lineas, declaradas])

  const totales = useMemo(
    () => ({
      unidades: cajas.reduce((s, c) => s + c.contenido.reduce((t, x) => t + x.unidades, 0), 0),
      peso: Math.round(cajas.reduce((s, c) => s + (c.pesoKg ?? 0), 0) * 100) / 100,
      sinMedidas: cajas.filter((c) => ![c.largoCm, c.anchoCm, c.altoCm, c.pesoKg].every((v) => v && v > 0)).length,
      vacias: cajas.filter((c) => c.contenido.length === 0).length,
    }),
    [cajas]
  )

  function tocar(fn: (prev: CajaUI[]) => CajaUI[]) {
    setCajas(fn)
    setSucio(true)
  }

  async function guardar() {
    setGuardando(true)
    try {
      const res = await fetch(`/api/fba/remesas/${remesaId}/cajas`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cajas }),
      })
      const p = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast.error(p?.error ?? 'No se han podido guardar las cajas')
        return
      }
      toast.success(`${cajas.length} caja${cajas.length === 1 ? '' : 's'} guardada${cajas.length === 1 ? '' : 's'}`)
      setSucio(false)
      router.refresh()
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* ---------- EL CUADRE, ARRIBA Y GRANDE ---------- */}
      <motion.div
        layout
        className={`glass-card flex flex-wrap items-center gap-4 border p-3 ${
          cuadre.cuadra ? 'border-emerald-400/30' : 'border-amber-400/30'
        }`}
      >
        <motion.div
          key={cuadre.cuadra ? 'ok' : 'no'}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className={`flex h-9 w-9 items-center justify-center rounded-full ${
            cuadre.cuadra ? 'bg-emerald-400/15' : 'bg-amber-400/15'
          }`}
        >
          {cuadre.cuadra ? (
            <Check className="h-4 w-4 text-emerald-400" />
          ) : (
            <TriangleAlert className="h-4 w-4 text-amber-400" />
          )}
        </motion.div>

        <div className="min-w-0">
          <p className={`text-[13px] font-semibold ${cuadre.cuadra ? 'text-emerald-400' : 'text-amber-400'}`}>
            {cuadre.cuadra
              ? 'Las cajas cuadran con lo declarado'
              : cuadre.pendientes > 0 && cuadre.sobrantes > 0
                ? `Faltan ${cuadre.pendientes} y sobran ${cuadre.sobrantes}`
                : cuadre.pendientes > 0
                  ? `Faltan ${cuadre.pendientes} unidades por encajar`
                  : `Sobran ${cuadre.sobrantes} unidades en las cajas`}
          </p>
          <p className="text-[11px] text-white/40">
            {totales.unidades} de {lineas.reduce((s, l) => s + l.enviadas, 0)} unidades ·{' '}
            {cajas.length} caja{cajas.length === 1 ? '' : 's'} · {totales.peso} kg
            {totales.sinMedidas > 0 && (
              <span className="text-amber-400"> · {totales.sinMedidas} sin medidas</span>
            )}
            {totales.vacias > 0 && <span className="text-amber-400"> · {totales.vacias} vacías</span>}
          </p>
        </div>

        {puedeEditar && (
          <div className="ml-auto flex items-center gap-2">
            <motion.button
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => tocar((p) => [...p, nuevaCaja(Math.max(0, ...p.map((c) => c.numero)) + 1)])}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] text-white/70 hover:border-white/25 hover:text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              Añadir caja
            </motion.button>
            <motion.button
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={guardar}
              disabled={guardando || !sucio}
              className="flex items-center gap-1.5 rounded-lg bg-[#FF6600] px-3 py-1.5 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-30"
            >
              {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {sucio ? 'Guardar cambios' : 'Guardado'}
            </motion.button>
          </div>
        )}
      </motion.div>

      {/* ---------- LO QUE FALTA POR REPARTIR ---------- */}
      {!cuadre.cuadra && (
        <div className="glass-card p-3">
          <p className="mb-2 text-[11px] font-medium text-white/50">Pendiente de repartir</p>
          <div className="flex flex-wrap gap-1.5">
            {cuadre.filas
              .filter((f) => f.diferencia !== 0)
              .map((f) => (
                <span
                  key={f.sku}
                  title={[f.nombre, f.variante].filter(Boolean).join(' · ')}
                  className={`rounded-full px-2 py-1 font-mono text-[11px] ${
                    f.diferencia > 0
                      ? 'bg-amber-400/10 text-amber-300'
                      : 'bg-red-400/10 text-red-300'
                  }`}
                >
                  {f.sku} {f.diferencia > 0 ? `faltan ${f.diferencia}` : `sobran ${-f.diferencia}`}
                </span>
              ))}
          </div>
        </div>
      )}

      {/* ---------- LAS CAJAS ---------- */}
      <AnimatePresence initial={false}>
        {cajas.map((caja) => (
          <motion.div
            key={caja.numero}
            layout
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className="glass-card overflow-hidden p-3"
          >
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Box className="h-4 w-4 text-[#FF6600]" />
                <span className="text-[13px] font-semibold text-white">Caja {caja.numero}</span>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wide text-white/30">cm</span>
                {(['largoCm', 'anchoCm', 'altoCm'] as const).map((campo, idx) => (
                  <input
                    key={campo}
                    type="number"
                    step="0.1"
                    min="0"
                    disabled={!puedeEditar}
                    value={caja[campo] ?? ''}
                    placeholder={['largo', 'ancho', 'alto'][idx]}
                    onChange={(e) =>
                      tocar((p) =>
                        p.map((c) => (c.numero === caja.numero ? { ...c, [campo]: num(e.target.value) } : c))
                      )
                    }
                    className={`${CAMPO} w-[62px]`}
                  />
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wide text-white/30">kg</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  disabled={!puedeEditar}
                  value={caja.pesoKg ?? ''}
                  placeholder="peso"
                  onChange={(e) =>
                    tocar((p) => p.map((c) => (c.numero === caja.numero ? { ...c, pesoKg: num(e.target.value) } : c)))
                  }
                  className={`${CAMPO} w-[70px]`}
                />
              </div>

              <div className="ml-auto flex items-center gap-3">
                <span className="text-[11px] text-white/45">
                  <span className="font-semibold text-white">
                    {caja.contenido.reduce((s, x) => s + x.unidades, 0)}
                  </span>{' '}
                  ud
                </span>
                {puedeEditar && cajas.length > 1 && (
                  <button
                    type="button"
                    onClick={() => tocar((p) => p.filter((c) => c.numero !== caja.numero))}
                    title="Quitar esta caja"
                    className="rounded p-1 text-white/30 hover:bg-red-400/10 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Qué va dentro */}
            <div className="mt-2 border-t border-white/[0.06] pt-2">
              <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                {lineas.map((l) => {
                  const dentro = caja.contenido.find((x) => x.sku === l.sku)?.unidades ?? 0
                  const f = cuadre.filas.find((x) => x.sku === l.sku)
                  const restantes = (f?.diferencia ?? 0) + dentro
                  return (
                    <div key={l.sku} className="contents">
                      <div className="flex min-w-0 items-baseline gap-2 py-0.5">
                        <span className="font-mono text-[11px] text-white/55">{l.sku}</span>
                        <span className="truncate text-[11px] text-white/35">
                          {[l.nombre, l.variante].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 py-0.5">
                        <input
                          type="number"
                          min="0"
                          max={restantes}
                          disabled={!puedeEditar}
                          value={dentro || ''}
                          placeholder="0"
                          onChange={(e) => {
                            const v = Math.max(0, Math.floor(Number(e.target.value) || 0))
                            tocar((p) =>
                              p.map((c) =>
                                c.numero !== caja.numero
                                  ? c
                                  : {
                                      ...c,
                                      contenido: [
                                        ...c.contenido.filter((x) => x.sku !== l.sku),
                                        ...(v > 0 ? [{ sku: l.sku, unidades: v }] : []),
                                      ],
                                    }
                              )
                            )
                          }}
                          className={`${CAMPO} w-[58px] text-right`}
                        />
                        {puedeEditar && restantes > dentro && (
                          <button
                            type="button"
                            title={`Meter las ${restantes - dentro} que faltan`}
                            onClick={() =>
                              tocar((p) =>
                                p.map((c) =>
                                  c.numero !== caja.numero
                                    ? c
                                    : {
                                        ...c,
                                        contenido: [
                                          ...c.contenido.filter((x) => x.sku !== l.sku),
                                          { sku: l.sku, unidades: restantes },
                                        ],
                                      }
                                )
                              )
                            }
                            className="rounded px-1 text-[10px] text-[#FF6600]/70 hover:bg-[#FF6600]/10 hover:text-[#FF6600]"
                          >
                            +{restantes - dentro}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {cajas.length === 0 && (
        <div className="glass-card flex flex-col items-center gap-2 p-8 text-center">
          <Package className="h-7 w-7 text-white/15" />
          <p className="text-[12px] text-white/40">Ninguna caja todavía</p>
        </div>
      )}
    </div>
  )
}

function nuevaCaja(numero: number): CajaUI {
  return { numero, largoCm: null, anchoCm: null, altoCm: null, pesoKg: null, contenido: [] }
}

function num(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}
