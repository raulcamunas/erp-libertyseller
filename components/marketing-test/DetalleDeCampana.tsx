'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Check, Loader2, Minus, Plus, RefreshCw, X } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { COINCIDENCIA_ES, pujaConCambio, pujaValida, type MetricasDeObjetivo } from '@/lib/ads/segmentaciones-calculo'
import type { DetalleDeCampana as Detalle, GrupoDeAnuncios, Segmentacion } from '@/lib/ads/segmentaciones'
import { llamar } from './llamar'
import { decimal, dinero, entero, porcentaje } from './formato'

type Orden = 'texto' | 'puja' | 'impresiones' | 'clics' | 'ctr' | 'cpc' | 'gasto' | 'pedidos' | 'ventas' | 'acos' | 'cvr'

const COLUMNAS: Array<{ id: Orden; nombre: string; titulo: string }> = [
  { id: 'impresiones', nombre: 'Impr.', titulo: 'Impresiones' },
  { id: 'clics', nombre: 'Clics', titulo: 'Clics' },
  { id: 'ctr', nombre: 'CTR', titulo: 'Clics ÷ impresiones' },
  { id: 'cpc', nombre: 'CPC', titulo: 'Coste por clic' },
  { id: 'gasto', nombre: 'Gasto', titulo: 'Gasto' },
  { id: 'pedidos', nombre: 'Pedidos', titulo: 'Pedidos atribuidos a 7 días' },
  { id: 'ventas', nombre: 'Ventas', titulo: 'Ventas atribuidas a 7 días' },
  { id: 'acos', nombre: 'ACoS', titulo: 'Gasto ÷ ventas' },
  { id: 'cvr', nombre: 'CVR', titulo: 'Conversión: pedidos ÷ clics' },
]

const TIPO_ES: Record<Segmentacion['tipo'], string> = { keyword: 'Keyword', producto: 'Producto', auto: 'Automática' }

/**
 * UNA CAMPAÑA ABIERTA: su presupuesto, sus grupos de anuncios y, en cada uno, las segmentaciones por las que se puja —keywords, productos o las cláusulas de la automática— con todas sus métricas del
 * periodo. La puja se sube o se baja aquí mismo (y el presupuesto de la campaña, y pausar o activar): cada cambio se escribe en Amazon al momento y queda en el log de cambios.
 */
export function DetalleDeCampana({ perfilId, campaignId, nombreCampana, presupuesto, dias, moneda, acosObjetivo, alCambiarPresupuesto }: { perfilId: string; campaignId: string; nombreCampana: string; presupuesto: number | null; dias: number; moneda: string | null; acosObjetivo: number | null; alCambiarPresupuesto?: (n: number) => void }) {
  const [detalle, setDetalle] = useState<Detalle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [orden, setOrden] = useState<{ por: Orden; desc: boolean }>({ por: 'gasto', desc: true })
  const [verPausadas, setVerPausadas] = useState(true)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      setDetalle(await llamar<Detalle>(`/api/ads/cuenta/segmentaciones?perfilId=${perfilId}&campaignId=${campaignId}&dias=${dias}`))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se han podido leer las segmentaciones.')
    } finally {
      setCargando(false)
    }
  }, [perfilId, campaignId, dias])
  useEffect(() => {
    void cargar()
  }, [cargar])

  const enviar = useCallback(
    async (cuerpo: Record<string, unknown>) => llamar<{ ok: true; puja?: number; presupuesto?: number }>('/api/ads/cuenta/segmentaciones', { metodo: 'POST', cuerpo: { perfilId, campaignId, nombreCampana, ...cuerpo } }),
    [perfilId, campaignId, nombreCampana]
  )

  /** Cambia una segmentación en la lista sin volver a pedir nada */
  const actualizarLocal = (id: string, cambio: Partial<Segmentacion>) =>
    setDetalle((d) => (d ? { ...d, grupos: d.grupos.map((g) => ({ ...g, segmentaciones: g.segmentaciones.map((s) => (s.id === id ? { ...s, ...cambio } : s)) })) } : d))
  const actualizarGrupo = (adGroupId: string, cambio: Partial<GrupoDeAnuncios>) => setDetalle((d) => (d ? { ...d, grupos: d.grupos.map((g) => (g.adGroupId === adGroupId ? { ...g, ...cambio } : g)) } : d))

  const ordenar = (lista: readonly Segmentacion[]) => {
    const dir = orden.desc ? -1 : 1
    const v = (s: Segmentacion): number | string => (orden.por === 'texto' ? s.texto.toLowerCase() : orden.por === 'puja' ? (s.puja ?? -1) : ((s.metricas[orden.por as keyof MetricasDeObjetivo] as number | null) ?? -1))
    return [...lista].filter((s) => verPausadas || s.estado === 'ENABLED').sort((a, b) => {
      const x = v(a)
      const y = v(b)
      return (x < y ? -1 : x > y ? 1 : 0) * dir
    })
  }
  const cabecera = (o: Orden, nombre: string, titulo?: string, alinear = 'text-right') => (
    <th key={o} title={titulo} className={`cursor-pointer select-none whitespace-nowrap px-2 py-[7px] font-semibold ${alinear}`} onClick={() => setOrden((p) => (p.por === o ? { por: o, desc: !p.desc } : { por: o, desc: o !== 'texto' }))}>
      {nombre} {orden.por === o && (orden.desc ? <ArrowDown className="inline h-3 w-3" /> : <ArrowUp className="inline h-3 w-3" />)}
    </th>
  )
  const totalSegs = useMemo(() => detalle?.grupos.reduce((n, g) => n + g.segmentaciones.length, 0) ?? 0, [detalle])

  return (
    <div className="flex flex-col gap-3 border-t border-[var(--ls-linea)] bg-[color-mix(in_srgb,var(--ls-bg)_75%,var(--ls-sup))] px-4 py-3 md:pl-[60px]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <EditorDeNumero
          etiqueta="Presupuesto diario"
          valor={presupuesto}
          moneda={moneda}
          paso={10}
          guardar={async (n) => {
            const r = await enviar({ accion: 'presupuesto', anterior: presupuesto, presupuesto: n })
            alCambiarPresupuesto?.(r.presupuesto ?? n)
            toast.success('Presupuesto cambiado en Amazon.')
            return r.presupuesto ?? n
          }}
        />
        {detalle && <span className="text-[11.5px] text-[var(--ls-t4)]">{totalSegs} segmentaciones · cifras del {detalle.periodo.desde.split('-').reverse().slice(0, 2).join('/')} al {detalle.periodo.hasta.split('-').reverse().slice(0, 2).join('/')}</span>}
        <label className="ml-auto inline-flex items-center gap-[6px] text-[12px] text-[var(--ls-t3)]">
          <input type="checkbox" checked={verPausadas} onChange={(e) => setVerPausadas(e.target.checked)} /> Ver las pausadas
        </label>
        <button type="button" onClick={() => void cargar()} className="inline-flex h-[28px] items-center gap-[6px] rounded-[8px] px-2 text-[12px] text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]" title="Volver a leer de Amazon">
          <RefreshCw className={`h-3 w-3 ${cargando ? 'animate-spin' : ''}`} /> Releer
        </button>
      </div>

      {error ? (
        <p className="text-[12.5px]" style={{ color: COLOR_ESTADO.rojo }}>{error}</p>
      ) : !detalle ? (
        <p className="flex items-center gap-2 text-[12.5px] text-[var(--ls-t3)]"><Loader2 className="h-3 w-3 animate-spin" /> Leyendo las segmentaciones de Amazon…</p>
      ) : (
        <>
          {!detalle.conMetricas && (
            <p className="rounded-[9px] px-3 py-2 text-[12px]" style={{ color: COLOR_ESTADO.ambar, background: `color-mix(in srgb, ${COLOR_ESTADO.ambar} 10%, transparent)` }}>
              Las pujas y el estado son los de Amazon ahora mismo. Las métricas de cada segmentación llegan con la próxima lectura automática (cada 3 horas, tras lanzar la migración 298).
            </p>
          )}
          {detalle.grupos.length === 0 && <p className="text-[12.5px] text-[var(--ls-t3)]">Esta campaña no tiene grupos de anuncios activos.</p>}
          {detalle.grupos.map((g) => (
            <div key={g.adGroupId} className="overflow-hidden rounded-[11px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--ls-linea)] px-3 py-2">
                <span className="text-[12.5px] font-semibold text-[var(--ls-t1)]">{g.nombre || 'Grupo de anuncios'}</span>
                {g.estado !== 'ENABLED' && <span className="text-[11px] text-[var(--ls-t4)]">pausado</span>}
                <EditorDeNumero
                  etiqueta="Puja por defecto"
                  valor={g.pujaPorDefecto}
                  moneda={moneda}
                  paso={10}
                  pequeno
                  guardar={async (n) => {
                    const r = await enviar({ accion: 'puja', tipo: 'grupo', id: g.adGroupId, texto: g.nombre || 'grupo de anuncios', pujaAnterior: g.pujaPorDefecto, puja: n })
                    actualizarGrupo(g.adGroupId, { pujaPorDefecto: r.puja ?? n })
                    toast.success('Puja por defecto cambiada en Amazon.')
                    return r.puja ?? n
                  }}
                />
              </div>
              {g.segmentaciones.length === 0 ? (
                <p className="px-3 py-2 text-[12px] text-[var(--ls-t4)]">Sin segmentaciones activas ni pausadas.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-[12.5px]">
                    <thead>
                      <tr className="text-[11px] text-[var(--ls-t4)]">
                        {cabecera('texto', 'Segmentación', undefined, 'text-left pl-3')}
                        <th className="px-2 py-[7px] text-left font-semibold">Estado</th>
                        {cabecera('puja', 'Puja', 'La puja máxima por clic (vacía = la del grupo)')}
                        {COLUMNAS.map((c) => cabecera(c.id, c.nombre, c.titulo))}
                      </tr>
                    </thead>
                    <tbody>
                      {ordenar(g.segmentaciones).map((s) => (
                        <FilaDeSegmentacion
                          key={s.id}
                          s={s}
                          pujaDelGrupo={g.pujaPorDefecto}
                          moneda={moneda}
                          acosObjetivo={acosObjetivo}
                          cambiarPuja={async (n) => {
                            const r = await enviar({ accion: 'puja', tipo: s.tipo, id: s.id, texto: s.texto, pujaAnterior: s.puja ?? g.pujaPorDefecto, puja: n })
                            actualizarLocal(s.id, { puja: r.puja ?? n })
                            toast.success(`Puja de «${s.texto.slice(0, 40)}» cambiada en Amazon.`)
                            return r.puja ?? n
                          }}
                          cambiarEstado={async (activar) => {
                            await enviar({ accion: 'estado', tipo: s.tipo, id: s.id, texto: s.texto, activar })
                            actualizarLocal(s.id, { estado: activar ? 'ENABLED' : 'PAUSED' })
                            toast.success(activar ? 'Activada en Amazon.' : 'Pausada en Amazon.')
                          }}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
          {detalle.sinEstructura.length > 0 && (
            <details className="rounded-[11px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-2 text-[12px] text-[var(--ls-t3)]">
              <summary className="cursor-pointer">{detalle.sinEstructura.length} segmentaciones con gasto en el periodo que ya no están en la campaña</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {detalle.sinEstructura.slice(0, 50).map((x) => (
                  <li key={x.id} className="flex justify-between gap-3">
                    <span className="truncate">{x.texto}</span>
                    <span className="shrink-0 tabular-nums">{dinero(x.metricas.gasto, moneda)} · {entero(x.metricas.pedidos)} pedidos</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  )
}

function FilaDeSegmentacion({ s, pujaDelGrupo, moneda, acosObjetivo, cambiarPuja, cambiarEstado }: { s: Segmentacion; pujaDelGrupo: number | null; moneda: string | null; acosObjetivo: number | null; cambiarPuja: (n: number) => Promise<number>; cambiarEstado: (activar: boolean) => Promise<void> }) {
  const [ocupado, setOcupado] = useState(false)
  const m = s.metricas
  const activa = s.estado === 'ENABLED'
  const colorAcos = m.acos == null || acosObjetivo == null ? undefined : m.acos <= acosObjetivo ? COLOR_ESTADO.verde : m.acos <= acosObjetivo * 1.3 ? COLOR_ESTADO.ambar : COLOR_ESTADO.rojo
  const celda = 'border-t border-[var(--ls-linea)] px-2 py-[6px] text-right tabular-nums'
  return (
    <tr className={`hover:[&>td]:bg-[var(--ls-sup2)] ${activa ? '' : 'opacity-55'}`}>
      <td className="max-w-[340px] border-t border-[var(--ls-linea)] py-[6px] pl-3 pr-2">
        <div className="truncate font-medium text-[var(--ls-t1)]" title={s.texto}>{s.texto}</div>
        <div className="mt-[1px] text-[10.5px] text-[var(--ls-t4)]">
          {TIPO_ES[s.tipo]}
          {s.coincidencia && ` · ${COINCIDENCIA_ES[s.coincidencia] ?? s.coincidencia}`}
        </div>
      </td>
      <td className="border-t border-[var(--ls-linea)] px-2 py-[6px]">
        <button
          type="button"
          role="switch"
          aria-checked={activa}
          disabled={ocupado || (s.estado !== 'ENABLED' && s.estado !== 'PAUSED')}
          onClick={async () => {
            setOcupado(true)
            try {
              await cambiarEstado(!activa)
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'No se ha podido cambiar.')
            } finally {
              setOcupado(false)
            }
          }}
          title={activa ? 'Pausar en Amazon' : 'Activar en Amazon'}
          className="relative inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
          style={{ background: activa ? COLOR_ESTADO.verde : 'var(--ls-sup3)' }}
        >
          <span className="absolute h-[14px] w-[14px] rounded-full bg-white shadow transition-transform" style={{ transform: `translateX(${activa ? 16 : 2}px)` }} />
        </button>
      </td>
      <td className="border-t border-[var(--ls-linea)] px-2 py-[4px] text-right">
        <EditorDeNumero valor={s.puja} reserva={pujaDelGrupo} moneda={moneda} paso={10} pequeno guardar={cambiarPuja} />
      </td>
      <td className={`${celda} text-[var(--ls-t2)]`}>{entero(m.impresiones)}</td>
      <td className={`${celda} text-[var(--ls-t2)]`}>{entero(m.clics)}</td>
      <td className={`${celda} text-[var(--ls-t2)]`}>{porcentaje(m.ctr, 2)}</td>
      <td className={`${celda} text-[var(--ls-t2)]`}>{m.cpc == null ? '—' : dinero(m.cpc, moneda)}</td>
      <td className={`${celda} text-[var(--ls-t1)]`}>{dinero(m.gasto, moneda)}</td>
      <td className={`${celda} text-[var(--ls-t1)]`}>{entero(m.pedidos)}</td>
      <td className={`${celda} text-[var(--ls-t1)]`}>{dinero(m.ventas, moneda)}</td>
      <td className={`${celda} font-semibold`} style={{ color: colorAcos ?? 'var(--ls-t1)' }}>{m.acos == null ? (m.gasto > 0 ? <span style={{ color: COLOR_ESTADO.rojo }}>sin venta</span> : '—') : porcentaje(m.acos)}</td>
      <td className={`${celda} pr-3 text-[var(--ls-t2)]`}>{porcentaje(m.cvr)}</td>
    </tr>
  )
}

/**
 * Un número que se cambia en Amazon: − y + mueven un 10 % (o lo que diga `paso`), se puede teclear, y solo se escribe al pulsar ✓ o Intro. Un cambio de más del doble o de menos de la mitad pide
 * confirmación, que una coma mal puesta en una puja sale cara.
 */
function EditorDeNumero({ etiqueta, valor, reserva, moneda, paso, pequeno, guardar }: { etiqueta?: string; valor: number | null; reserva?: number | null; moneda: string | null; paso: number; pequeno?: boolean; guardar: (n: number) => Promise<number> }) {
  // Lo último guardado manda sobre lo que llegó al abrir (el presupuesto no se vuelve a pedir tras cambiarlo)
  const [guardado, setGuardado] = useState<number | null>(null)
  const base = guardado ?? valor ?? reserva ?? null
  const [borrador, setBorrador] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const actual = borrador ?? (base == null ? '' : decimal(base))
  const n = pujaValida(actual)
  const cambiado = borrador !== null && n !== null && n !== base

  async function confirmar() {
    if (!cambiado || n == null) return
    if (base != null && (n > base * 2 || n < base / 2) && !window.confirm(`¿Seguro? Pasa de ${dinero(base, moneda)} a ${dinero(n, moneda)}.`)) return
    setOcupado(true)
    try {
      setGuardado(await guardar(n))
      setBorrador(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Amazon no ha aceptado el cambio.')
    } finally {
      setOcupado(false)
    }
  }
  const ajustar = (signo: 1 | -1) => {
    const de = pujaValida(actual) ?? base ?? 0.5
    setBorrador(decimal(pujaConCambio(de, signo * paso)))
  }
  const alto = pequeno ? 'h-[26px]' : 'h-[30px]'
  return (
    <span className="inline-flex items-center gap-[6px]">
      {etiqueta && <span className="text-[11.5px] text-[var(--ls-t3)]">{etiqueta}</span>}
      <span className={`inline-flex ${alto} items-center overflow-hidden rounded-[8px] border bg-[var(--ls-sup2)] ${cambiado ? 'border-[var(--ls-acc-graf)]' : 'border-[var(--ls-linea)]'}`}>
        <button type="button" aria-label={`Bajar un ${paso} %`} disabled={ocupado} onClick={() => ajustar(-1)} className="flex h-full w-[22px] items-center justify-center text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]"><Minus className="h-3 w-3" /></button>
        <input
          value={actual}
          placeholder={reserva != null ? decimal(reserva) : '—'}
          onChange={(e) => setBorrador(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void confirmar()
            if (e.key === 'Escape') setBorrador(null)
          }}
          inputMode="decimal"
          aria-label={etiqueta ?? 'Puja'}
          className={`w-[58px] bg-transparent text-right text-[12.5px] tabular-nums outline-none ${valor == null && guardado == null && borrador === null ? 'text-[var(--ls-t4)]' : 'text-[var(--ls-t1)]'}`}
          title={valor == null && reserva != null ? 'Usa la puja por defecto del grupo' : undefined}
        />
        <button type="button" aria-label={`Subir un ${paso} %`} disabled={ocupado} onClick={() => ajustar(1)} className="flex h-full w-[22px] items-center justify-center text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]"><Plus className="h-3 w-3" /></button>
      </span>
      {cambiado && (
        <>
          <button type="button" onClick={() => void confirmar()} disabled={ocupado} aria-label="Guardar en Amazon" title="Guardar en Amazon" className="flex h-[24px] w-[24px] items-center justify-center rounded-[7px] text-white" style={{ background: COLOR_ESTADO.verde }}>
            {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          </button>
          {!ocupado && (
            <button type="button" onClick={() => setBorrador(null)} aria-label="Deshacer" title="Deshacer" className="flex h-[24px] w-[24px] items-center justify-center rounded-[7px] text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)]"><X className="h-3 w-3" /></button>
          )}
        </>
      )}
    </span>
  )
}
