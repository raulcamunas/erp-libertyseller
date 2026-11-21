'use client'

import { useMemo, useState } from 'react'
import { ChevronRight, PackageCheck, PackageX, Timer } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { EnvioPropuestoGuardado, LineaPlan, PlazoEtapas } from '@/lib/fba/plan-tipos'
import { dinero, entero, fechaCorta, unidades } from '../formato'
import { cx } from '../comun/ui'
import { escalaCobertura, filasDeReposicion, semaforo, type FilaDeReposicion, type Tramo } from './cuando-reponer'

/**
 * EL PANEL «REPONER»: cuándo hay que enviar y cuándo no, de un vistazo.
 *
 *   1. Semáforo: tres tarjetas que filtran la lista — Ya (rojo), Pronto (ámbar), No hace falta (verde).
 *   2. Una fila por referencia (o por modelo, con sus tallas) con una barra de cobertura a escala de días:
 *        macizo = días con lo que hay en Amazon · claro = hasta donde llega con lo que viene (camino + comprometido)
 *        raya roja = el plazo hasta la venta (si sale hoy, a la venta ese día) · raya ámbar = plazo + margen
 *      y al lado: se agota el…, enviar antes del…, cuánto mandar.
 *   3. Los envíos propuestos abiertos, en una línea cada uno.
 * La lógica vive en cuando-reponer.ts (misma regla que las alertas). Sin recharts: rejilla CSS que se lee a 375 px.
 */

const MAX_FILAS = 15

const COLOR_TRAMO: Record<Tramo, string> = { ya: COLOR_ESTADO.rojo, pronto: COLOR_ESTADO.ambar, no: COLOR_ESTADO.verde, aparte: COLOR_ESTADO.gris }

export interface PanelReponerProps {
  lineas: readonly LineaPlan[]
  plazo: Pick<PlazoEtapas, 'hastaLaVenta' | 'margen'>
  plazoDePartida?: boolean
  hoy: string
  moneda: string
  envios: readonly EnvioPropuestoGuardado[]
  onAbrirSku: (sku: string) => void
  onAbrirEnvio: (id: string) => void
}

export function PanelReponer({ lineas, plazo, plazoDePartida = false, hoy, moneda, envios, onAbrirSku, onAbrirEnvio }: PanelReponerProps) {
  const s = useMemo(() => semaforo(lineas, hoy), [lineas, hoy])
  const [filtro, setFiltro] = useState<Tramo | null>(null)
  const [todas, setTodas] = useState(false)
  const tramos = useMemo(() => new Set<Tramo>(filtro ? [filtro] : ['ya', 'pronto']), [filtro])
  const filas = useMemo(() => filasDeReposicion(lineas, hoy, tramos), [lineas, hoy, tramos])
  const visibles = todas ? filas : filas.slice(0, MAX_FILAS)
  const escala = escalaCobertura(plazo)
  const enQueEnvio = useMemo(() => {
    const m = new Map<string, EnvioPropuestoGuardado>()
    for (const e of envios) for (const l of e.lineas) if (!m.has(l.sku)) m.set(l.sku, e)
    return m
  }, [envios])

  const nadaQueReponer = s.ya.referencias === 0 && s.pronto.referencias === 0

  return (
    <section className="min-w-0 space-y-3" aria-label="Cuándo reponer">
      {/* 1 · Semáforo */}
      <div className="grid min-w-0 gap-2 sm:grid-cols-3">
        <TarjetaTramo
          activa={filtro === 'ya'}
          onClick={() => setFiltro(filtro === 'ya' ? null : 'ya')}
          color={COLOR_TRAMO.ya}
          titulo="Reponer ya"
          cifra={s.ya.referencias}
          detalle={
            s.ya.referencias === 0
              ? 'Nada urgente'
              : `${s.ya.agotadas > 0 ? `${entero(s.ya.agotadas)} agotada${s.ya.agotadas === 1 ? '' : 's'} · ` : ''}${unidades(s.ya.unidades)} sugeridas${s.ya.euros > 0 ? ` · ${dinero(s.ya.euros, moneda)} en juego` : ''}`
          }
          pie={s.ya.referencias > 0 ? 'Hay que decidirlo hoy' : null}
        />
        <TarjetaTramo
          activa={filtro === 'pronto'}
          onClick={() => setFiltro(filtro === 'pronto' ? null : 'pronto')}
          color={COLOR_TRAMO.pronto}
          titulo="Pronto"
          cifra={s.pronto.referencias}
          detalle={s.pronto.referencias === 0 ? 'Nada en las próximas semanas' : `${unidades(s.pronto.unidades)} sugeridas`}
          pie={s.pronto.primeraDecision ? `La primera, decidirla antes del ${fechaCorta(s.pronto.primeraDecision, hoy)}` : null}
        />
        <TarjetaTramo
          activa={filtro === 'no'}
          onClick={() => setFiltro(filtro === 'no' ? null : 'no')}
          color={COLOR_TRAMO.no}
          titulo="No hace falta"
          cifra={s.no.referencias}
          detalle={s.no.exceso > 0 ? `${entero(s.no.exceso)} con stock de más` : 'Con stock suficiente'}
          pie={s.aparte > 0 ? `${entero(s.aparte)} fuera del plan (sin ventas, descatalogadas…)` : null}
        />
      </div>

      {nadaQueReponer && !filtro && (
        <p className="rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-4 py-3 text-[13px] text-[var(--ls-t2)]" style={{ borderLeft: `3px solid ${COLOR_TRAMO.no}` }}>
          Nada que reponer por ahora.
          {s.proximaRoturaEvitable ? ` La próxima rotura es el ${fechaCorta(s.proximaRoturaEvitable, hoy)}: el plan avisará cuando toque enviar.` : ' Ninguna referencia se agota a la vista.'}
        </p>
      )}

      {/* 2 · Las filas con su barra de cobertura */}
      {filas.length > 0 && (
        <div className="min-w-0 rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
          <Leyenda escala={escala} plazo={plazo} plazoDePartida={plazoDePartida} hoy={hoy} />
          <ul className="divide-y divide-[var(--ls-linea)]">
            {visibles.map((f) => (
              <FilaReponer key={f.clave} f={f} escala={escala} plazo={plazo} hoy={hoy} moneda={moneda} envio={f.skus.map((k) => enQueEnvio.get(k)).find(Boolean) ?? null} onAbrirSku={onAbrirSku} onAbrirEnvio={onAbrirEnvio} />
            ))}
          </ul>
          {filas.length > MAX_FILAS && (
            <button type="button" onClick={() => setTodas((v) => !v)} className="w-full border-t border-[var(--ls-linea)] px-4 py-2.5 text-[12.5px] font-medium text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)] [@media(pointer:coarse)]:min-h-[44px]">
              {todas ? 'Ver menos' : `Ver las ${entero(filas.length)}`}
            </button>
          )}
        </div>
      )}

      {/* 3 · Envíos propuestos abiertos */}
      {envios.length > 0 && (
        <ul className="min-w-0 space-y-1.5">
          {envios.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onAbrirEnvio(e.id)}
                className="flex w-full min-w-0 items-center gap-3 rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-2 text-left text-[12.5px] hover:bg-[var(--ls-sup2)] [@media(pointer:coarse)]:min-h-[44px]"
              >
                <Timer className="h-4 w-4 shrink-0 text-[var(--ls-t4)]" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[var(--ls-t2)]">
                  <b className="font-semibold text-[var(--ls-t1)]">Envío del {fechaCorta(e.salirAntesDe, hoy)}</b> · {entero(e.lineas.filter((l) => l.cantidad > 0).length)} ref · {unidades(e.unidades)}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--ls-t4)]" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function TarjetaTramo({ activa, onClick, color, titulo, cifra, detalle, pie }: { activa: boolean; onClick: () => void; color: string; titulo: string; cifra: number; detalle: string; pie: string | null }) {
  return (
    <button
      type="button"
      aria-pressed={activa}
      onClick={onClick}
      className={cx('relative min-w-0 overflow-hidden rounded-[14px] border bg-[var(--ls-sup)] px-4 py-3 text-left transition-colors hover:bg-[var(--ls-sup2)]', activa ? 'border-[color:var(--ls-t3)]' : 'border-[var(--ls-linea)]')}
      title={activa ? 'Quitar el filtro' : 'Ver solo estas'}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[4px]" style={{ background: color }} />
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-[var(--ls-t2)]">{titulo}</span>
        <span className="text-[24px] font-semibold leading-none tabular-nums" style={{ color }}>
          {entero(cifra)}
        </span>
      </span>
      <span className="mt-1 block truncate text-[12px] text-[var(--ls-t3)]">{detalle}</span>
      {pie && <span className="mt-0.5 block truncate text-[11.5px] text-[var(--ls-t4)]">{pie}</span>}
    </button>
  )
}

function Leyenda({ escala, plazo, plazoDePartida, hoy }: { escala: number; plazo: Pick<PlazoEtapas, 'hastaLaVenta' | 'margen'>; plazoDePartida: boolean; hoy: string }) {
  const aLaVenta = sumar(hoy, plazo.hastaLaVenta)
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--ls-linea)] px-4 py-2 text-[11.5px] text-[var(--ls-t4)]">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-4 rounded-sm" style={{ background: 'var(--ls-t3)' }} /> En Amazon
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-4 rounded-sm opacity-40" style={{ background: 'var(--ls-t3)' }} /> Con lo que viene
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-[2px]" style={{ background: COLOR_ESTADO.rojo }} /> Si sale hoy, a la venta el {fechaCorta(aLaVenta, hoy)} ({plazo.hastaLaVenta} d)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-[2px]" style={{ background: COLOR_ESTADO.ambar }} /> + {plazo.margen} d de margen
      </span>
      <span className="ml-auto">Escala: {escala} días{plazoDePartida ? ' · plazo de partida (sin confirmar)' : ''}</span>
    </div>
  )
}

function FilaReponer({ f, escala, plazo, hoy, moneda, envio, onAbrirSku, onAbrirEnvio }: { f: FilaDeReposicion; escala: number; plazo: Pick<PlazoEtapas, 'hastaLaVenta' | 'margen'>; hoy: string; moneda: string; envio: EnvioPropuestoGuardado | null; onAbrirSku: (sku: string) => void; onAbrirEnvio: (id: string) => void }) {
  const pct = (d: number | null) => (d == null ? 0 : Math.max(0, Math.min(100, (d / escala) * 100)))
  const color = COLOR_TRAMO[f.tramo]
  const agotado = f.vendibles <= 0
  const pasa = (f.diasConLoQueViene ?? 0) > escala
  return (
    <li className="grid min-w-0 gap-x-4 gap-y-1.5 px-4 py-2.5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
      {/* Producto */}
      <button type="button" onClick={() => onAbrirSku(f.skus[0])} className="min-w-0 text-left">
        <span className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
          <span className="truncate text-[13px] font-semibold text-[var(--ls-t1)]">{f.titulo}</span>
        </span>
        {f.subtitulo && <span className="block truncate pl-[14px] text-[11.5px] text-[var(--ls-t4)]">{f.subtitulo}</span>}
        {f.tallas.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1 pl-[14px]">
            {f.tallas.map((t) => (
              <span key={t.talla} className="rounded-[4px] px-1 text-[10.5px] font-semibold tabular-nums" style={{ color: COLOR_TRAMO[t.tramo], background: `color-mix(in srgb, ${COLOR_TRAMO[t.tramo]} 14%, transparent)` }}>
                {t.talla}
              </span>
            ))}
          </span>
        )}
      </button>

      {/* Barra de cobertura */}
      <div className="min-w-0 self-center">
        {agotado ? (
          <p className="text-[12.5px] font-semibold" style={{ color: COLOR_ESTADO.rojo }}>
            <PackageX className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
            Agotado{f.eurosSiVaTarde ? ` · pierde ~${dinero(f.eurosSiVaTarde, moneda)}` : ''}
          </p>
        ) : (
          <div className="relative h-3.5 w-full rounded-full bg-[var(--ls-sup2)]" title={`${f.diasAmazon ?? '?'} días con lo que hay en Amazon · ${f.diasConLoQueViene ?? '?'} con lo que viene`}>
            <span className="absolute inset-y-0 left-0 rounded-full opacity-35" style={{ width: `${pct(f.diasConLoQueViene)}%`, background: color }} />
            <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct(f.diasAmazon)}%`, background: color }} />
            {f.huecoDias != null && (
              <span
                className="absolute inset-y-0 rounded-full"
                title={`Sin stock unos días hasta que llegue lo que viene`}
                style={{ left: `${pct(f.huecoDias)}%`, width: '6%', backgroundImage: `repeating-linear-gradient(135deg, ${COLOR_ESTADO.rojo} 0 3px, transparent 3px 6px)` }}
              />
            )}
            <span aria-hidden className="absolute -top-1 bottom-[-4px] w-[2px]" style={{ left: `${pct(plazo.hastaLaVenta)}%`, background: COLOR_ESTADO.rojo }} />
            <span aria-hidden className="absolute -top-1 bottom-[-4px] w-[2px]" style={{ left: `${pct(plazo.hastaLaVenta + plazo.margen)}%`, background: COLOR_ESTADO.ambar }} />
            {pasa && <span className="absolute -right-1 -top-[3px] text-[11px] font-semibold text-[var(--ls-t3)]">›{entero(f.diasConLoQueViene ?? 0)} d</span>}
          </div>
        )}
        <p className="mt-1 truncate text-[11.5px] tabular-nums text-[var(--ls-t4)]">
          Amazon {entero(f.vendibles)}
          {f.deCamino > 0 ? ` · camino ${entero(f.deCamino)}` : ''}
          {f.comprometido > 0 ? ` · comprometido ${entero(f.comprometido)}` : ''}
          {f.fechaRotura ? ` · se agota el ${fechaCorta(f.fechaRotura, hoy)}` : ''}
        </p>
      </div>

      {/* Qué hacer */}
      <div className="min-w-0 self-center text-[12.5px]">
        {f.noCabe ? (
          <p className="font-semibold" style={{ color: COLOR_ESTADO.rojo }}>
            No cabe en el envío (capacidad)
          </p>
        ) : f.cantidad > 0 ? (
          <p className="text-[var(--ls-t2)]">
            <PackageCheck className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-[var(--ls-t4)]" aria-hidden />
            Mandar <b className="font-semibold tabular-nums text-[var(--ls-t1)]">{unidades(f.cantidad)}</b>
            {f.cajas ? <span className="text-[var(--ls-t4)]"> · {entero(f.cajas)} caja{f.cajas === 1 ? '' : 's'}</span> : null}
          </p>
        ) : null}
        {f.salirAntesDe && (
          <p className="text-[11.5px] text-[var(--ls-t3)]">
            Enviar antes del <b className="font-semibold text-[var(--ls-t1)]">{fechaCorta(f.salirAntesDe, hoy)}</b>
            {f.decidirAntesDe ? ` · decidir antes del ${fechaCorta(f.decidirAntesDe, hoy)}` : ''}
          </p>
        )}
        {envio && (
          <button type="button" onClick={() => onAbrirEnvio(envio.id)} className="mt-0.5 text-[11.5px] font-medium text-[var(--ls-acc)] hover:underline">
            En el envío del {fechaCorta(envio.salirAntesDe, hoy)} ›
          </button>
        )}
      </div>
    </li>
  )
}

function sumar(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}
