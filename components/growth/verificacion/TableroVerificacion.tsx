'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Download, Loader2, Search } from 'lucide-react'
import { BOTON, CAMPO, CIFRAS, COLOR_ESTADO, LINEA, PANTALLA, TABLA, TEXTO, TIPO } from '@/lib/estilo/denso'
import { ZONA } from '@/lib/auditor-stock/horas'
import type { ListaVerificaciones, VerificacionResumen } from '@/lib/stock-sync/verificacion-consulta'
import { ES_FALLO, TEXTO_RESULTADO, type FilaInforme, type Resultado } from '@/lib/stock-sync/verificacion-pura'

/**
 * VERIFICACIÓN DE STOCK — LA PANTALLA.
 *
 * Izquierda: las verificaciones de este cliente, una por cada subida de stock.
 * Derecha: el informe de la que se elija —qué SKU quedaron bien y cuáles no, con lo
 * que se mandó y lo que Amazon tiene ahora—, con filtros y CSV.
 */

const fechaHora = new Intl.DateTimeFormat('es-ES', {
  timeZone: ZONA,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})
const hora = new Intl.DateTimeFormat('es-ES', { timeZone: ZONA, hour: '2-digit', minute: '2-digit' })
const n = (v: number) => v.toLocaleString('es-ES')

type Filtro = 'fallos' | 'avisos' | 'todos'

async function llamar<T>(cuerpo: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/stock-sync/verificaciones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(json.error ?? `El servidor ha contestado ${res.status}`)
  return json
}

const cuenta = (r: VerificacionResumen['resumen'], k: Resultado): number => {
  const v = r?.[k]
  return typeof v === 'number' ? v : 0
}

export function TableroVerificacion({
  stockClientId,
  inicial,
}: {
  stockClientId: string
  inicial: ListaVerificaciones
}) {
  const [lista, setLista] = useState<ListaVerificaciones>(inicial)
  const [elegida, setElegida] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<{ resumen: VerificacionResumen; informe: FilaInforme[] } | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('fallos')
  const [busca, setBusca] = useState('')

  const filas = useMemo(() => (lista.ok ? lista.filas : []), [lista])
  const idActivo = elegida ?? filas.find((f) => f.estado === 'hecha')?.id ?? filas[0]?.id ?? null

  const refrescar = useCallback(async () => {
    try {
      const r = await llamar<{ lista: ListaVerificaciones }>({ accion: 'lista', clienteId: stockClientId })
      setLista(r.lista)
    } catch {
      // Un fallo de red no borra lo que ya se ve
    }
  }, [stockClientId])

  useEffect(() => {
    const t = setInterval(refrescar, 60_000)
    return () => clearInterval(t)
  }, [refrescar])

  useEffect(() => {
    if (!idActivo) {
      setDetalle(null)
      return
    }
    let vigente = true
    setCargando(true)
    setError(null)
    llamar<{ resumen: VerificacionResumen; informe: FilaInforme[] }>({ accion: 'detalle', clienteId: stockClientId, id: idActivo })
      .then((d) => vigente && setDetalle(d))
      .catch((e) => vigente && setError(e instanceof Error ? e.message : 'No se ha podido leer el informe'))
      .finally(() => vigente && setCargando(false))
    return () => {
      vigente = false
    }
  }, [idActivo, stockClientId])

  const visibles = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return (detalle?.informe ?? [])
      .filter((f) => (filtro === 'fallos' ? ES_FALLO.has(f.resultado) : filtro === 'avisos' ? !ES_FALLO.has(f.resultado) : true))
      .filter((f) => !t || f.sku.toLowerCase().includes(t))
  }, [detalle, filtro, busca])

  function descargar() {
    const celda = (v: string | number | null) => {
      const x = v === null ? '' : String(v)
      return /[;"\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x
    }
    const lineas = [
      ['SKU', 'Resultado', 'Antes', 'Enviado', 'Hay ahora', 'Ventas', 'Motivo'].join(';'),
      ...visibles.map((f) => [f.sku, TEXTO_RESULTADO[f.resultado], f.anterior, f.enviado, f.actual, f.ventas, f.motivo].map(celda).join(';')),
    ]
    const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `verificacion-stock-${(detalle?.resumen.creada_at ?? '').slice(0, 16).replace(/[:T]/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!lista.ok && lista.faltaMigracion) {
    return (
      <Aviso tono="ambar">
        Falta lanzar la migración <strong>225_stock_verificacion.sql</strong> en el editor SQL de Supabase. En cuanto
        esté, esta pantalla se llena sola con cada subida de stock.
      </Aviso>
    )
  }
  if (!lista.ok) return <Aviso tono="rojo">No se han podido leer las verificaciones: {lista.error}</Aviso>

  const r = detalle?.resumen.resumen ?? null

  return (
    <div className="flex h-full flex-col gap-[9px]">
      {!lista.activa && (
        <Aviso tono="ambar">
          Este cliente no tiene la verificación activada: las subidas de stock no se comprueban. Se activa dando de alta
          su cliente en <strong>stock_verificacion_clientes</strong>.
        </Aviso>
      )}

      <div className={`${PANTALLA.cuerpo} min-h-0 flex-1`}>
        <div className="grid h-full min-h-0 grid-cols-[minmax(280px,4fr)_minmax(0,8fr)] gap-[9px]">
          {/* ----- Las verificaciones ----- */}
          <div className={`${TABLA.caja} min-h-0 min-w-0 overflow-auto`}>
            {filas.length === 0 && (
              <p className={`${TIPO.s} ${TEXTO.t4} p-3`}>
                Todavía no hay ninguna. Aparece una cada vez que se sube el stock de este cliente.
              </p>
            )}
            {filas.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setElegida(f.id)}
                className={`flex w-full items-center gap-2 border-b px-2 py-[7px] text-left ${LINEA.normal} ${f.id === idActivo ? TABLA.filaSel : 'hover:bg-[var(--ls-sup2)]'}`}
              >
                <Icono estado={f.estado} fallos={f.fallos} />
                <div className="min-w-0 flex-1">
                  <p className={`${TIPO.m} ${TEXTO.t1} tabular-nums`}>{fechaHora.format(new Date(f.creada_at))}</p>
                  <p className={`${TIPO.xs} ${TEXTO.t4}`}>
                    {f.estado === 'pendiente'
                      ? `se comprueba a las ${hora.format(new Date(f.vence_at))}`
                      : f.estado === 'en_curso'
                        ? 'comprobando ahora…'
                        : f.estado === 'error'
                          ? 'no se pudo verificar'
                          : `${n(f.enviados)} enviados · ${f.fallos === 0 ? 'todo bien' : `${n(f.fallos ?? 0)} con problemas`}`}
                  </p>
                </div>
                {f.estado === 'hecha' && f.slack && f.slack !== 'enviado' && (
                  <span className={TIPO.xs} style={{ color: COLOR_ESTADO.ambar }} title={f.slack}>
                    sin aviso
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ----- El informe ----- */}
          <div className="flex min-h-0 min-w-0 flex-col gap-[7px]">
            {error && <Aviso tono="rojo">{error}</Aviso>}
            {detalle?.resumen.estado === 'error' && <Aviso tono="rojo">{detalle.resumen.error}</Aviso>}
            {detalle?.resumen.estado === 'pendiente' && (
              <Aviso tono="ambar">
                Todavía no ha pasado el tiempo de espera: se comprueba a las {hora.format(new Date(detalle.resumen.vence_at))}.
              </Aviso>
            )}

            {detalle && detalle.resumen.estado === 'hecha' && (
              <>
                <div className={`${CIFRAS.tira} shrink-0`}>
                  <Cifra valor={cuenta(r, 'ok') + cuenta(r, 'ok_con_ventas')} rotulo="correctos" />
                  <Cifra valor={cuenta(r, 'rechazado')} rotulo="rechazados" mal />
                  <Cifra valor={cuenta(r, 'no_aplicado')} rotulo="no aplicados" mal />
                  <Cifra valor={cuenta(r, 'distinto')} rotulo="distintos" mal />
                  <Cifra valor={cuenta(r, 'bajo_probable_venta')} rotulo="han bajado" aviso />
                  <Cifra valor={cuenta(r, 'no_verificable')} rotulo="sin verificar" aviso />
                </div>
                {r?.conVentas === false && (
                  <p className={`${TIPO.xs} ${TEXTO.t4}`}>
                    No se han podido contar las ventas del intervalo{typeof r?.notaVentas === 'string' ? ` (${r.notaVentas})` : ''}:
                    las bajadas se marcan como probables ventas, no como fallos.
                  </p>
                )}

                <div className="flex shrink-0 flex-wrap items-center gap-[6px]">
                  {(
                    [
                      ['fallos', 'Fallos'],
                      ['avisos', 'Avisos'],
                      ['todos', 'Todo lo que no está bien'],
                    ] as Array<[Filtro, string]>
                  ).map(([k, t]) => (
                    <button
                      key={k}
                      type="button"
                      className={`${BOTON.chip} ${filtro === k ? BOTON.chipEncendido : ''}`}
                      onClick={() => setFiltro(k)}
                    >
                      {t}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={visibles.length === 0}
                    className={`${BOTON.base} ${BOTON.alto} ${BOTON.secundario} ml-auto`}
                    onClick={descargar}
                  >
                    <Download className="h-3 w-3" />
                    Descargar CSV
                  </button>
                  <label className="relative w-[180px]">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--ls-t4)]" />
                    <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="SKU" className={`${CAMPO.input} pl-[26px]`} />
                  </label>
                </div>

                <div className={`${TABLA.caja} min-h-0 flex-1 overflow-auto`}>
                  <table className={TABLA.tabla}>
                    <thead>
                      <tr>
                        <th className={TABLA.cabecera}>SKU</th>
                        <th className={TABLA.cabecera}>Resultado</th>
                        <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Antes</th>
                        <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Enviado</th>
                        <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Hay ahora</th>
                        <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Ventas</th>
                        <th className={TABLA.cabecera}>Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibles.length === 0 && (
                        <tr>
                          <td colSpan={7} className={`${TABLA.celda} ${TEXTO.t4} text-center`}>
                            {filtro === 'fallos' ? 'Ningún fallo: todo lo enviado ha quedado como se mandó.' : 'Nada que enseñar con este filtro.'}
                          </td>
                        </tr>
                      )}
                      {visibles.slice(0, 500).map((f) => (
                        <tr key={f.sku} className={TABLA.fila}>
                          <td className={`${TABLA.celda} font-mono text-[11.5px]`}>{f.sku}</td>
                          <td className={TABLA.celda} style={{ color: ES_FALLO.has(f.resultado) ? COLOR_ESTADO.rojo : COLOR_ESTADO.ambar }}>
                            {TEXTO_RESULTADO[f.resultado]}
                          </td>
                          <td className={`${TABLA.celda} ${TABLA.numero} ${TEXTO.t3}`}>{f.anterior ?? '—'}</td>
                          <td className={`${TABLA.celda} ${TABLA.numero} ${TEXTO.t1}`}>{f.enviado}</td>
                          <td className={`${TABLA.celda} ${TABLA.numero} ${TEXTO.t1} font-semibold`}>{f.actual ?? '—'}</td>
                          <td className={`${TABLA.celda} ${TABLA.numero} ${TEXTO.t3}`}>{f.ventas ?? '—'}</td>
                          <td className={`${TABLA.celda} ${TEXTO.t3} max-w-[360px] truncate`} title={f.motivo}>
                            {f.motivo}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {visibles.length > 500 && (
                  <p className={`${TIPO.xs} ${TEXTO.t4}`}>Se enseñan 500 de {n(visibles.length)}: el CSV lleva todas.</p>
                )}
              </>
            )}

            {cargando && !detalle && (
              <p className={`${TIPO.s} ${TEXTO.t4}`}>
                <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                Cargando…
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Cifra({ valor, rotulo, mal, aviso }: { valor: number; rotulo: string; mal?: boolean; aviso?: boolean }) {
  const color = valor > 0 ? (mal ? COLOR_ESTADO.rojo : aviso ? COLOR_ESTADO.ambar : undefined) : undefined
  return (
    <div className={CIFRAS.celda}>
      <span className={CIFRAS.valor} style={{ color }}>
        {n(valor)}
      </span>
      <span className={CIFRAS.rotulo}>{rotulo}</span>
    </div>
  )
}

function Icono({ estado, fallos }: { estado: VerificacionResumen['estado']; fallos: number | null }) {
  if (estado === 'pendiente') return <Clock className="h-3.5 w-3.5 shrink-0" style={{ color: COLOR_ESTADO.ambar }} />
  if (estado === 'en_curso') return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
  if (estado === 'error') return <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color: COLOR_ESTADO.rojo }} />
  return fallos && fallos > 0 ? (
    <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color: COLOR_ESTADO.rojo }} />
  ) : (
    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" style={{ color: COLOR_ESTADO.verde }} />
  )
}

function Aviso({ tono, children }: { tono: 'ambar' | 'rojo'; children: React.ReactNode }) {
  const color = tono === 'rojo' ? COLOR_ESTADO.rojo : COLOR_ESTADO.ambar
  return (
    <div className="flex shrink-0 items-start gap-2 rounded-[6px] border border-[var(--ls-linea)] px-3 py-2" style={{ borderLeft: `3px solid ${color}` }}>
      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" style={{ color }} />
      <div className={`${TIPO.s} ${TEXTO.t2}`}>{children}</div>
    </div>
  )
}
