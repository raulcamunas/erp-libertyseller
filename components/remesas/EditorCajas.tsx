'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { Box, Check, Package, Plus, Save, Trash2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Boton } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { LineaDePanel } from '@/lib/fba/datos'
import { invalidarRemesas } from './comun/useAgencia'
import { cx } from './comun/ui'

/**
 * EL EDITOR DE CAJAS.
 *
 * Sustituye a la hoja donde había un bloque por caja —CAJA 1, medidas, peso, total unidades— y debajo qué iba
 * dentro, más tres celdas al final: Total unidades, Total Envío y Discrepancia.
 *
 * Ese cero de «Discrepancia» era lo único que se miraba antes de cerrar un envío. Aquí se calcula solo, a cada
 * tecla, y se enseña arriba del todo: no hay que buscarlo en una celda perdida a la derecha.
 *
 *
 * ============ POR QUÉ SE EDITA TODO Y SE GUARDA UNA VEZ ============
 *
 * Encajar es mover cosas: añades una caja, pasas tres unidades de la 1 a la 2, corriges un peso. Si cada tecla
 * fuera a la base, la mitad de los estados intermedios serían inválidos —una remesa con seis unidades de más
 * durante dos segundos— y cualquier corte dejaría las cajas a medias.
 *
 * Así que se trabaja en memoria y se guarda el conjunto entero cuando quieres. El botón avisa si hay cambios sin
 * guardar. Si el cliente guardó desde su enlace entre medias, el servidor contesta 409 y se ofrece «Recargar».
 *
 * Colores: los de estado del kit (`COLOR_ESTADO`, spec §6.1): verde cuadra, ámbar faltan, rojo sobran.
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
  'h-9 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[13px] tabular-nums text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] ' +
  'hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)] focus:shadow-[inset_0_0_0_1px_var(--ls-acc-graf)] disabled:opacity-60 [@media(pointer:coarse)]:h-11'

/** Un color de estado con un velo: para fondos y bordes suaves */
const velo = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`

export function EditorCajas({
  remesaId,
  clienteId,
  lineas,
  cajasIniciales,
  puedeEditar,
  version = null,
}: {
  remesaId: string
  /** Para vaciar la memoria de las pantallas de ese cliente al guardar */
  clienteId?: string
  lineas: LineaDePanel[]
  cajasIniciales: CajaUI[]
  puedeEditar: boolean
  /** La versión de las cajas cargada (bloqueo optimista, migración 309). null = sin comprobar */
  version?: number | null
}) {
  const router = useRouter()
  const [cajas, setCajas] = useState<CajaUI[]>(cajasIniciales.length > 0 ? cajasIniciales : [nuevaCaja(1)])
  const [sucio, setSucio] = useState(false)
  const [guardando, setGuardando] = useState(false)
  // La versión que tenemos: viaja al guardar y vuelve la nueva. Si el cliente guardó desde su enlace entre medias, 409
  const versionRef = useRef<number | null>(version)
  /**
   * AL RECARGAR TRAS UN 409, LO DE LA BASE ENTRA EN EL EDITOR.
   *
   * `cajas` y la versión se inician una vez: un router.refresh() trae props nuevas pero el estado se quedaba con
   * lo viejo, así que «Recargar» no recargaba nada y cada guardado volvía a chocar. Cuando llega otra versión de
   * la base y no hay cambios sin guardar (o se ha pedido recargar), se toma la de la base.
   */
  const recargando = useRef(false)
  const versionVista = useRef<number | null>(version)
  useEffect(() => {
    if (version === versionVista.current) return
    versionVista.current = version
    if (!recargando.current && sucio) return
    recargando.current = false
    versionRef.current = version
    setCajas(cajasIniciales.length > 0 ? cajasIniciales : [nuevaCaja(1)])
    setSucio(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

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
        body: JSON.stringify({ cajas, version: versionRef.current }),
      })
      const p = (await res.json().catch(() => null)) as { error?: string; conflicto?: boolean; version?: number | null } | null
      if (res.status === 409 && p?.conflicto) {
        toast.error(p.error ?? 'Alguien ha cambiado las cajas. Recarga.', {
          action: {
            label: 'Recargar',
            onClick: () => {
              recargando.current = true
              router.refresh()
              invalidarRemesas(clienteId ?? null)
            },
          },
          duration: 10000,
        })
        return
      }
      if (!res.ok) {
        toast.error(p?.error ?? 'No se han podido guardar las cajas')
        return
      }
      toast.success(`${cajas.length} caja${cajas.length === 1 ? '' : 's'} guardada${cajas.length === 1 ? '' : 's'}`)
      if (typeof p?.version === 'number') versionRef.current = p.version
      setSucio(false)
      router.refresh()
      invalidarRemesas(clienteId ?? null)
    } catch {
      toast.error('Se ha cortado la conexión con el servidor. Las cajas siguen aquí: vuelve a guardar.')
    } finally {
      setGuardando(false)
    }
  }

  const tono = cuadre.cuadra ? COLOR_ESTADO.verde : cuadre.pendientes > 0 ? COLOR_ESTADO.ambar : COLOR_ESTADO.rojo
  const totalDeclarado = lineas.reduce((s, l) => s + l.enviadas, 0)

  return (
    <MotionConfig reducedMotion="user">
      <div className="space-y-3">
        {/* ---------- EL CUADRE, ARRIBA Y GRANDE ---------- */}
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[14px] border bg-[var(--ls-sup)] p-4 shadow-[var(--ls-sombra-1)]"
          style={{ borderColor: velo(tono, 40) }}
          role="status"
          aria-live="polite"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: velo(tono, 15), color: tono }} aria-hidden>
            {cuadre.cuadra ? <Check className="h-5 w-5" /> : <TriangleAlert className="h-5 w-5" />}
          </span>

          <div className="min-w-0 flex-1 basis-[200px]">
            <p className="text-[14px] font-semibold" style={{ color: tono }}>
              {cuadre.cuadra
                ? 'Las cajas cuadran con lo declarado'
                : cuadre.pendientes > 0 && cuadre.sobrantes > 0
                  ? `Faltan ${cuadre.pendientes} y sobran ${cuadre.sobrantes}`
                  : cuadre.pendientes > 0
                    ? `Faltan ${cuadre.pendientes} unidades por encajar`
                    : `Sobran ${cuadre.sobrantes} unidades en las cajas`}
            </p>
            <p className="text-[12px] tabular-nums text-[var(--ls-t3)]">
              {totales.unidades} de {totalDeclarado} unidades · {cajas.length} caja{cajas.length === 1 ? '' : 's'} · {totales.peso} kg
              {totales.sinMedidas > 0 && <span style={{ color: COLOR_ESTADO.ambar }}> · {totales.sinMedidas} sin medidas</span>}
              {totales.vacias > 0 && <span style={{ color: COLOR_ESTADO.ambar }}> · {totales.vacias} vacías</span>}
            </p>
          </div>

          {puedeEditar && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Boton variante="secundario" tamano="sm" icono={Plus} onClick={() => tocar((p) => [...p, nuevaCaja(Math.max(0, ...p.map((c) => c.numero)) + 1)])}>
                Añadir caja
              </Boton>
              <Boton variante="primario" tamano="sm" icono={sucio ? Save : Check} cargando={guardando} disabled={!sucio} onClick={() => void guardar()}>
                {sucio ? 'Guardar cambios' : 'Guardado'}
              </Boton>
            </div>
          )}
        </div>

        {/* ---------- LO QUE FALTA POR REPARTIR ---------- */}
        {!cuadre.cuadra && (
          <div className="rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4">
            {/* El «faltan» va una vez en el titular, no en cada chip: 24 veces la misma palabra era ruido */}
            <p className="mb-2 text-[12px] font-medium text-[var(--ls-t3)]">
              Pendiente de repartir · {cuadre.filas.filter((f) => f.diferencia !== 0).length} referencias
              {cuadre.pendientes > 0 && ` · ${cuadre.pendientes} unidades`}
              {cuadre.sobrantes > 0 && <span style={{ color: COLOR_ESTADO.rojo }}> · sobran {cuadre.sobrantes}</span>}
            </p>
            <div className="flex flex-wrap gap-[6px]">
              {cuadre.filas
                .filter((f) => f.diferencia !== 0)
                .map((f) => {
                  const color = f.diferencia > 0 ? COLOR_ESTADO.ambar : COLOR_ESTADO.rojo
                  return (
                    <span
                      key={f.sku}
                      title={`${f.diferencia > 0 ? `Faltan ${f.diferencia}` : `Sobran ${-f.diferencia}`} unidades${[f.nombre, f.variante].filter(Boolean).length > 0 ? ` · ${[f.nombre, f.variante].filter(Boolean).join(' · ')}` : ''}`}
                      className="inline-flex max-w-full items-center gap-[6px] rounded-full py-[3px] pl-[10px] pr-[3px] font-mono text-[11.5px]"
                      style={{ background: velo(color, 12), color }}
                    >
                      <span className="truncate">{f.sku}</span>
                      <b className="min-w-[20px] rounded-full px-[6px] text-center text-[11px] font-semibold tabular-nums" style={{ background: velo(color, 22) }}>
                        {f.diferencia > 0 ? f.diferencia : `−${-f.diferencia}`}
                      </b>
                    </span>
                  )
                })}
            </div>
          </div>
        )}

        {/* ---------- LAS CAJAS ---------- */}
        <AnimatePresence initial={false}>
          {cajas.map((caja) => {
            const enCaja = caja.contenido.reduce((s, x) => s + x.unidades, 0)
            return (
              <motion.div
                key={caja.numero}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4"
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-[10px]" style={{ background: velo('var(--ls-mod-remesas)', 14), color: 'var(--ls-mod-remesas)' }} aria-hidden>
                      <Box className="h-4 w-4" />
                    </span>
                    <span className="text-[14px] font-semibold text-[var(--ls-t1)]">Caja {caja.numero}</span>
                  </div>

                  <fieldset className="flex items-center gap-[6px]">
                    <legend className="sr-only">Medidas de la caja {caja.numero} en centímetros</legend>
                    <span className="text-[11px] font-medium text-[var(--ls-t4)]" aria-hidden>
                      cm
                    </span>
                    {(['largoCm', 'anchoCm', 'altoCm'] as const).map((campo, idx) => (
                      <input
                        key={campo}
                        type="number"
                        inputMode="decimal"
                        step="0.1"
                        min="0"
                        disabled={!puedeEditar}
                        value={caja[campo] ?? ''}
                        placeholder={['largo', 'ancho', 'alto'][idx]}
                        aria-label={`${['Largo', 'Ancho', 'Alto'][idx]} de la caja ${caja.numero} (cm)`}
                        onChange={(e) => tocar((p) => p.map((c) => (c.numero === caja.numero ? { ...c, [campo]: num(e.target.value) } : c)))}
                        className={cx(CAMPO, 'w-[64px] text-right')}
                      />
                    ))}
                  </fieldset>

                  <label className="flex items-center gap-[6px]">
                    <span className="text-[11px] font-medium text-[var(--ls-t4)]">kg</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      disabled={!puedeEditar}
                      value={caja.pesoKg ?? ''}
                      placeholder="peso"
                      aria-label={`Peso de la caja ${caja.numero} (kg)`}
                      onChange={(e) => tocar((p) => p.map((c) => (c.numero === caja.numero ? { ...c, pesoKg: num(e.target.value) } : c)))}
                      className={cx(CAMPO, 'w-[72px] text-right')}
                    />
                  </label>

                  <div className="ml-auto flex items-center gap-3">
                    <span className="text-[12px] text-[var(--ls-t3)]">
                      <span className="font-semibold tabular-nums text-[var(--ls-t1)]">{enCaja}</span> ud
                    </span>
                    {puedeEditar && cajas.length > 1 && (
                      <Boton
                        variante="fantasma"
                        tamano="sm"
                        soloIcono
                        icono={Trash2}
                        aria-label={`Quitar la caja ${caja.numero}`}
                        title="Quitar esta caja"
                        className="hover:!text-[var(--ls-e-rojo)]"
                        // Al quitar una caja se vuelven a numerar 1..N: el Excel de Amazon coloca cada caja en la columna de su número (A3.2)
                        onClick={() => tocar((p) => p.filter((c) => c.numero !== caja.numero).sort((a, b) => a.numero - b.numero).map((c, i) => ({ ...c, numero: i + 1 })))}
                      />
                    )}
                  </div>
                </div>

                {/* Qué va dentro */}
                <ul className="mt-3 divide-y divide-[var(--ls-linea)] border-t border-[var(--ls-linea)]">
                  {lineas.map((l) => {
                    const dentro = caja.contenido.find((x) => x.sku === l.sku)?.unidades ?? 0
                    const f = cuadre.filas.find((x) => x.sku === l.sku)
                    const restantes = (f?.diferencia ?? 0) + dentro
                    return (
                      <li key={l.sku} className="flex items-center gap-3 py-[6px]">
                        <div className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-[12px] text-[var(--ls-t2)]">{l.sku}</span>
                          <span className="block truncate text-[11.5px] text-[var(--ls-t4)]">{[l.nombre, l.variante].filter(Boolean).join(' · ')}</span>
                        </div>
                        {puedeEditar && restantes > dentro && (
                          <button
                            type="button"
                            title={`Meter las ${restantes - dentro} que faltan`}
                            onClick={() =>
                              tocar((p) =>
                                p.map((c) =>
                                  c.numero !== caja.numero ? c : { ...c, contenido: [...c.contenido.filter((x) => x.sku !== l.sku), { sku: l.sku, unidades: restantes }] }
                                )
                              )
                            }
                            className="inline-flex h-8 min-w-[40px] items-center justify-center rounded-[10px] px-2 text-[12px] font-semibold tabular-nums [@media(pointer:coarse)]:h-11"
                            style={{ background: velo('var(--ls-mod-remesas)', 12), color: 'var(--ls-mod-remesas)' }}
                          >
                            +{restantes - dentro}
                          </button>
                        )}
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          max={restantes}
                          disabled={!puedeEditar}
                          value={dentro || ''}
                          placeholder="0"
                          aria-label={`Unidades de ${l.sku} en la caja ${caja.numero}`}
                          onChange={(e) => {
                            const v = Math.max(0, Math.floor(Number(e.target.value) || 0))
                            tocar((p) =>
                              p.map((c) =>
                                c.numero !== caja.numero
                                  ? c
                                  : { ...c, contenido: [...c.contenido.filter((x) => x.sku !== l.sku), ...(v > 0 ? [{ sku: l.sku, unidades: v }] : [])] }
                              )
                            )
                          }}
                          className={cx(CAMPO, 'w-[68px] shrink-0 text-right')}
                        />
                      </li>
                    )
                  })}
                </ul>
              </motion.div>
            )
          })}
        </AnimatePresence>

        {cajas.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-[var(--ls-linea2)] p-8 text-center">
            <Package className="h-7 w-7 text-[var(--ls-t4)]" aria-hidden />
            <p className="text-[13px] text-[var(--ls-t3)]">Ninguna caja todavía</p>
          </div>
        )}
      </div>
    </MotionConfig>
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
