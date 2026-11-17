'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FlaskConical, Loader2, Play, Power, TrendingDown, TrendingUp } from 'lucide-react'
import { BOTON, CAMPO, COLOR_ESTADO, TABLA } from '@/lib/estilo/denso'
import { TEXTO_MOTIVO, type MotivoDinamico } from '@/lib/pccomponentes/dinamico'
import type { ConfigDinamica, FilaDeLog, ResumenDePasada } from '@/lib/pccomponentes/dinamico-servidor'
import { cx } from '@/components/remesas/comun/ui'

const eur = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`)
const hora = (iso: string) => new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * PRECIOS DINÁMICOS EN PCCOMPONENTES (lib/pccomponentes/dinamico.ts). Cada `cada_minutos`, cada oferta de Entrais se pone unos céntimos por debajo del más
 * barato (o sube hasta quedar justo por debajo del siguiente si ya es el más barato), nunca por debajo del margen mínimo. En ENSAYO solo apunta lo que haría.
 */
export function PreciosDinamicos() {
  const [config, setConfig] = useState<ConfigDinamica | null>(null)
  const [cambios, setCambios] = useState<FilaDeLog[]>([])
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<'probar' | 'guardar' | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})

  const cargar = useCallback(async () => {
    const res = await fetch('/api/pccomponentes/dinamico', { cache: 'no-store' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) return setError(j.error ?? 'No se ha podido leer')
    setError(null)
    setConfig(j.config)
    setCambios(j.cambios)
    setForm({
      cada_minutos: String(j.config.cada_minutos),
      centimos: String(j.config.centimos).replace('.', ','),
      limite_coste: String(j.config.limite_coste),
      margen_bajo: String(Math.round(j.config.margen_bajo * 1000) / 10).replace('.', ','),
      margen_alto: String(Math.round(j.config.margen_alto * 1000) / 10).replace('.', ','),
    })
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function post(cuerpo: Record<string, unknown>, que: 'probar' | 'guardar') {
    setOcupado(que)
    try {
      const res = await fetch('/api/pccomponentes/dinamico', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'No se ha podido')
      if (que === 'probar') {
        const r = j.resumen as ResumenDePasada
        toast.success(`Ensayo: ${r.cambios ?? 0} de ${r.ofertas ?? 0} ofertas cambiarían (${r.bajan ?? 0} bajan, ${r.suben ?? 0} suben, ${r.alMinimo ?? 0} al mínimo)`)
      } else toast.success('Guardado')
      await cargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setOcupado(null)
    }
  }

  const n = (k: string) => Number((form[k] ?? '').replace(',', '.'))
  const guardar = () =>
    post({ accion: 'guardar', cada_minutos: n('cada_minutos'), centimos: n('centimos'), limite_coste: n('limite_coste'), margen_bajo: n('margen_bajo') / 100, margen_alto: n('margen_alto') / 100 }, 'guardar')

  if (error)
    return (
      <div className="rounded-[8px] border px-3 py-2 text-[12.5px]" style={{ borderColor: COLOR_ESTADO.ambar, color: COLOR_ESTADO.ambar }}>
        {error}
      </div>
    )
  if (!config)
    return (
      <div className="flex items-center gap-2 text-[12px] text-[var(--ls-t3)]">
        <Loader2 className="h-3 w-3 animate-spin" /> Leyendo…
      </div>
    )

  const r = config.ultimo_resumen as (ResumenDePasada & { at?: string }) | null
  const estado = !config.activo ? { t: 'Apagado', c: COLOR_ESTADO.gris } : config.ensayo ? { t: 'En ensayo: calcula y apunta, no cambia la tienda', c: COLOR_ESTADO.ambar } : { t: 'Encendido: cambia los precios en PcComponentes', c: COLOR_ESTADO.verde }

  return (
    <div className="flex max-w-[1300px] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-[10px] border px-3 py-2.5" style={{ borderColor: estado.c }}>
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: estado.c }} />
        <span className="text-[13px] font-semibold text-[var(--ls-t1)]">{estado.t}</span>
        <span className="text-[12px] text-[var(--ls-t3)]">
          · cada {config.cada_minutos} min · {eur(config.centimos)} por debajo · mínimo {Math.round(config.margen_bajo * 100)} % (&lt; {config.limite_coste} €) / {Math.round(config.margen_alto * 100)} % · {config.subir ? 'sube si es el más barato' : 'no sube'}
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          <button type="button" disabled={ocupado !== null} onClick={() => void post({ accion: 'probar' }, 'probar')} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)} title="Una pasada ahora mismo en ensayo: no toca la tienda">
            {ocupado === 'probar' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Probar ahora (ensayo)
          </button>
          <button type="button" disabled={ocupado !== null} onClick={() => void post({ accion: 'guardar', ensayo: !config.ensayo }, 'guardar')} className={cx(BOTON.base, BOTON.alto, config.ensayo ? BOTON.primario : BOTON.secundario)}>
            <FlaskConical className="h-3 w-3" /> {config.ensayo ? 'Salir del ensayo y cambiar precios de verdad' : 'Volver a ensayo'}
          </button>
          <button type="button" disabled={ocupado !== null} onClick={() => void post({ accion: 'guardar', activo: !config.activo }, 'guardar')} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}>
            <Power className="h-3 w-3" /> {config.activo ? 'Apagar' : 'Encender'}
          </button>
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3">
          <div className="mb-2 text-[13px] font-semibold text-[var(--ls-t1)]">Reglas</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(
              [
                ['cada_minutos', 'Cada (minutos)'],
                ['centimos', 'Céntimos por debajo (€)'],
                ['limite_coste', 'Tramo: coste hasta (€)'],
                ['margen_bajo', 'Margen mínimo por debajo del tramo (%)'],
                ['margen_alto', 'Margen mínimo por encima (%)'],
              ] as const
            ).map(([k, t]) => (
              <label key={k} className={CAMPO.contenedor}>
                <span className={CAMPO.etiqueta}>{t}</span>
                <input value={form[k] ?? ''} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} inputMode="decimal" className={cx(CAMPO.input, CAMPO.numero)} />
              </label>
            ))}
            <label className="flex items-center gap-2 self-end pb-1 text-[12px] text-[var(--ls-t2)]">
              <input type="checkbox" checked={config.subir} onChange={(e) => void post({ accion: 'guardar', subir: e.target.checked }, 'guardar')} />
              Subir si ya es el más barato
            </label>
          </div>
          <button type="button" disabled={ocupado !== null} onClick={() => void guardar()} className={cx(BOTON.base, BOTON.alto, BOTON.secundario, 'mt-2')}>
            Guardar reglas
          </button>
          <p className="mt-2 text-[11.5px] text-[var(--ls-t3)]">
            El margen mínimo es sobre el precio sin IVA, después de producto, canon, porte y comisión de PcComponentes. Se compara el precio con envío de cada tienda, que es lo que paga el comprador.
          </p>
        </div>

        <div className="rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3">
          <div className="mb-2 text-[13px] font-semibold text-[var(--ls-t1)]">Última pasada</div>
          {!r ? (
            <p className="text-[12px] text-[var(--ls-t3)]">Todavía no ha pasado. Pulsa «Probar ahora» para ver qué haría.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 text-[12.5px] sm:grid-cols-3">
              {(
                [
                  ['Cuándo', r.at ? hora(r.at) : '—'],
                  ['Modo', r.ensayo ? 'Ensayo' : 'De verdad'],
                  ['Ofertas revisadas', String(r.ofertas ?? 0)],
                  ['Bajan', String(r.bajan ?? 0)],
                  ['Suben', String(r.suben ?? 0)],
                  ['Al mínimo', String(r.alMinimo ?? 0)],
                  ['Sin coste (no se tocan)', String(r.sinCoste ?? 0)],
                  ['Enviados', String(r.enviados ?? 0)],
                  ['Errores', String(r.errores?.length ?? 0)],
                ] as const
              ).map(([t, v]) => (
                <div key={t} className="rounded-[8px] bg-[var(--ls-sup2)] px-2.5 py-1.5">
                  <div className="text-[11px] text-[var(--ls-t4)]">{t}</div>
                  <div className="font-semibold tabular-nums text-[var(--ls-t1)]">{v}</div>
                </div>
              ))}
            </div>
          )}
          {r?.errores && r.errores.length > 0 && <p className="mt-2 text-[11.5px]" style={{ color: COLOR_ESTADO.rojo }}>{r.errores.join(' · ')}</p>}
        </div>
      </div>

      <div className="overflow-hidden rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
        <div className="px-3 py-2 text-[13px] font-semibold text-[var(--ls-t1)]">Cambios {cambios.length ? `(los últimos ${cambios.length})` : ''}</div>
        <div className="max-h-[560px] overflow-auto">
          <table className={TABLA.tabla}>
            <thead>
              <tr>
                {['Cuándo', 'Producto', 'Antes', 'Ahora', 'Más barato (con envío)', 'Puesto', 'Mínimo', 'Por qué', ''].map((t) => (
                  <th key={t} className={TABLA.cabecera}>
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cambios.length === 0 && (
                <tr>
                  <td colSpan={9} className={TABLA.celda}>
                    Sin cambios todavía.
                  </td>
                </tr>
              )}
              {cambios.map((c) => {
                const sube = (c.precio_nuevo ?? 0) > (c.precio_antes ?? 0)
                return (
                  <tr key={c.id} className={TABLA.fila}>
                    <td className={TABLA.celda}>{hora(c.pasada_at)}</td>
                    <td className={cx(TABLA.celda, 'max-w-[340px]')}>
                      <span className={TABLA.corta} title={c.titulo ?? ''}>
                        <span className="text-[var(--ls-t4)]">{c.sku}</span> · {c.titulo}
                      </span>
                    </td>
                    <td className={cx(TABLA.celda, TABLA.numero)}>{eur(c.precio_antes)}</td>
                    <td className={cx(TABLA.celda, TABLA.numero, 'font-semibold')} style={{ color: sube ? COLOR_ESTADO.verde : COLOR_ESTADO.azul }}>
                      <span className="inline-flex items-center gap-1">
                        {sube ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {eur(c.precio_nuevo)}
                      </span>
                    </td>
                    <td className={TABLA.celda}>
                      {eur(c.competidor_precio)} <span className="text-[var(--ls-t4)]">{c.competidor_tienda ?? ''}</span>
                    </td>
                    <td className={cx(TABLA.celda, TABLA.numero)}>{c.puesto ? `${c.puesto}º de ${c.tiendas}` : '—'}</td>
                    <td className={cx(TABLA.celda, TABLA.numero)}>{eur(c.minimo)}</td>
                    <td className={cx(TABLA.celda, 'whitespace-normal text-[12px]')}>{TEXTO_MOTIVO[c.motivo as MotivoDinamico] ?? c.motivo}</td>
                    <td className={TABLA.celda}>
                      {c.error ? (
                        <span style={{ color: COLOR_ESTADO.rojo }} title={c.error}>
                          Error
                        </span>
                      ) : c.ensayo ? (
                        <span style={{ color: COLOR_ESTADO.ambar }}>Ensayo</span>
                      ) : c.enviado ? (
                        <span style={{ color: COLOR_ESTADO.verde }}>Enviado</span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
