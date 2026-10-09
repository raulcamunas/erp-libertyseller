'use client'

import type { ContrasteGuardado } from '@/lib/prestashop/informe'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Play, Search, Store } from 'lucide-react'
import {
  AVISO,
  BOTON,
  CAMPO,
  CIFRAS,
  COLOR_ESTADO,
  LINEA,
  PANTALLA,
  RADIO,
  TABLA,
  TEXTO,
  TIPO,
} from '@/lib/estilo/denso'
import { DialogoPrestaShop } from '@/components/growth/auditor/DialogoPrestaShop'
import { agruparPorHora, ZONA } from '@/lib/auditor-stock/horas'
import type { Cambios, FilaDetalle } from '@/lib/auditor-stock/clasificar'
import type { AuditoriaResumen, ListaAuditorias } from '@/lib/auditor-stock/consulta'

/**
 * AUDITOR DE STOCK — LA PANTALLA.
 *
 * Izquierda: las auditorías agrupadas por hora, cada hora en un desplegable.
 * Derecha: los productos de la auditoría que se elija —por defecto la última—,
 * con SKU, ASIN y cantidad, y lo que se movió respecto a la anterior.
 *
 * Se actualiza sola: cada minuto, y cada pocos segundos mientras hay una
 * auditoría en marcha.
 *
 *
 * ============ LAS CIFRAS SON LAS DE LA ÚLTIMA COMPLETA ============
 *
 * Una auditoría `parcial` —se acabó el tiempo— o `error` NO es comparable: sus
 * números son ciertos solo para lo que se leyó. Las cifras de arriba salen de la
 * última COMPLETA, y si la más reciente no lo es se dice con todas las letras
 * encima, para que no se lea «sin stock: 0» de una pasada que falló como si la
 * cuenta se hubiera vaciado.
 */

const hora = new Intl.DateTimeFormat('es-ES', { timeZone: ZONA, hour: '2-digit', minute: '2-digit' })
const n = (v: number) => v.toLocaleString('es-ES')

interface Detalle {
  resumen: AuditoriaResumen
  detalle: FilaDetalle[]
  cambios: Cambios | null
  contraste: ContrasteGuardado | null
}

type VistaTienda = 'sobreventa' | 'ventaPerdida' | 'distinta'
type Vista = 'con_stock' | 'entran' | 'salen' | VistaTienda

const ROTULO_TIENDA: Record<VistaTienda, { corto: string; ayuda: string }> = {
  sobreventa: { corto: 'Sobreventa', ayuda: 'Amazon tiene stock y la tienda no: se puede vender lo que no hay' },
  ventaPerdida: { corto: 'Venta perdida', ayuda: 'La tienda tiene stock y Amazon no: se está dejando de vender' },
  distinta: { corto: 'Distinta cantidad', ayuda: 'Los dos tienen stock pero no el mismo número' },
}

function descargarTabla(
  filas: { sku: string; asin: string | null; cantidad: number; canal: 'M' | 'A' | null; tienda?: number }[],
  vista: Vista,
  creada: string | null
) {
  const conTienda = filas.some((f) => f.tienda !== undefined)
  const celda = (v: string | number | null) => {
    const t = v === null ? '' : String(v)
    return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const lineas = [
    ['SKU', 'ASIN', 'Stock en Amazon', ...(conTienda ? ['Stock en PrestaShop'] : []), 'Canal'].join(';'),
    ...filas.map((f) =>
      [f.sku, f.asin, f.cantidad, ...(conTienda ? [f.tienda ?? ''] : []), f.canal === 'A' ? 'FBA' : f.canal === 'M' ? 'FBM' : '']
        .map(celda)
        .join(';')
    ),
  ]
  const blob = new Blob(['\uFEFF' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `auditor-stock-${vista}-${(creada ?? new Date().toISOString()).slice(0, 16).replace(/[:T]/g, '-')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function haceCuanto(iso: string, ahora: number): string {
  const min = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 60_000))
  if (min < 1) return 'hace un momento'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  return `hace ${h} h ${min % 60} min`
}

export function TableroAuditorStock({
  inicial,
  enCursoInicial,
}: {
  inicial: ListaAuditorias
  enCursoInicial: boolean
}) {
  const [lista, setLista] = useState<ListaAuditorias>(inicial)
  const [enCurso, setEnCurso] = useState(enCursoInicial)
  const [iniciando, setIniciando] = useState(false)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)
  const [verTienda, setVerTienda] = useState(false)
  const [ahora, setAhora] = useState(() => Date.now())

  const filas = useMemo(() => (lista.ok ? lista.filas : []), [lista])
  const grupos = useMemo(() => agruparPorHora(filas), [filas])

  const ultimaCompleta = useMemo(() => filas.find((f) => f.estado === 'completa') ?? null, [filas])
  const ultima = filas[0] ?? null

  // null = nadie ha tocado los desplegables: se enseña abierta la hora más
  // reciente. En cuanto se toca uno, manda lo que haya decidido quien mira.
  const [abiertas, setAbiertas] = useState<ReadonlySet<string> | null>(null)
  const [elegida, setElegida] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<Detalle | null>(null)
  const [cargando, setCargando] = useState(false)
  const [errorDetalle, setErrorDetalle] = useState<string | null>(null)
  const [vista, setVista] = useState<Vista>('con_stock')
  const [busca, setBusca] = useState('')
  const [canal, setCanal] = useState<'todos' | 'M' | 'A'>('todos')

  // Hasta que alguien elija una, se enseña la última completa y la hora más
  // reciente abierta: es lo que se quiere ver al entrar.
  const idActivo = elegida ?? ultimaCompleta?.id ?? ultima?.id ?? null
  const grupoReciente = grupos[0]?.clave ?? null
  const estaAbierta = (clave: string) =>
    abiertas === null ? clave === grupoReciente : abiertas.has(clave)

  /* ---------------- Refresco ---------------- */
  const refrescar = useCallback(async () => {
    try {
      const res = await fetch('/api/auditor-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'lista' }),
      })
      if (!res.ok) return
      const json = (await res.json()) as { enCurso: boolean; lista: ListaAuditorias }
      setLista(json.lista)
      setEnCurso(json.enCurso)
      setAhora(Date.now())
    } catch {
      // Un fallo de red al refrescar no tiene que tirar la pantalla: se ve lo
      // último que había y se vuelve a intentar al rato.
    }
  }, [])

  useEffect(() => {
    const cada = enCurso || iniciando ? 4_000 : 60_000
    const t = setInterval(refrescar, cada)
    return () => clearInterval(t)
  }, [enCurso, iniciando, refrescar])

  // Cuando aparece una auditoría nueva tras «Auditar ahora», se deja de esperar.
  const alLanzar = useRef<string | null>(null)
  useEffect(() => {
    if (iniciando && ultima && ultima.id !== alLanzar.current) setIniciando(false)
  }, [iniciando, ultima])

  async function auditarAhora() {
    setErrorAccion(null)
    alLanzar.current = ultima?.id ?? null
    setIniciando(true)
    try {
      const res = await fetch('/api/auditor-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'ahora' }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string; iniciada?: boolean }
      if (!res.ok) throw new Error(json.error ?? `El servidor ha contestado ${res.status}`)
      if (json.iniciada === false) setIniciando(false)
      setEnCurso(true)
    } catch (e) {
      setIniciando(false)
      setErrorAccion(e instanceof Error ? e.message : 'No se ha podido lanzar la auditoría')
    }
  }

  /* ---------------- El detalle de la auditoría elegida ---------------- */
  useEffect(() => {
    if (!idActivo) return
    let vigente = true
    setCargando(true)
    setErrorDetalle(null)
    ;(async () => {
      try {
        const res = await fetch('/api/auditor-stock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accion: 'detalle', id: idActivo }),
        })
        const json = (await res.json().catch(() => ({}))) as Detalle & { error?: string }
        if (!res.ok) throw new Error(json.error ?? `El servidor ha contestado ${res.status}`)
        // Si mientras tanto se ha elegido otra, esta respuesta ya no vale.
        if (vigente) setDetalle(json)
      } catch (e) {
        if (vigente) setErrorDetalle(e instanceof Error ? e.message : 'No se ha podido cargar')
      } finally {
        if (vigente) setCargando(false)
      }
    })()
    return () => {
      vigente = false
    }
  }, [idActivo])

  /* ---------------- Lo que se enseña a la derecha ---------------- */
  const asinPorSku = useMemo(
    () => new Map((detalle?.detalle ?? []).map((d) => [d[0], d[1]])),
    [detalle]
  )

  const tabla = useMemo(() => {
    if (!detalle) return []
    const t = busca.trim().toLowerCase()
    type Fila = { sku: string; asin: string | null; cantidad: number; canal: 'M' | 'A' | null; tienda?: number }
    let base: Fila[]
    if (vista === 'sobreventa' || vista === 'ventaPerdida' || vista === 'distinta') {
      base = (detalle.contraste?.[vista] ?? []).map((d) => ({
        sku: d[0],
        asin: d[1],
        cantidad: d[2],
        canal: 'M' as const,
        tienda: d[3],
      }))
    } else if (vista === 'con_stock') {
      base = detalle.detalle.map((d) => ({ sku: d[0], asin: d[1], cantidad: d[2], canal: d[3] }))
    } else {
      const lista = (vista === 'entran' ? detalle.cambios?.entran : detalle.cambios?.salen) ?? []
      base = lista.map((c) => ({ sku: c[0], asin: asinPorSku.get(c[0]) ?? null, cantidad: c[1], canal: null }))
    }
    return base.filter((f) => {
      if (canal !== 'todos' && f.canal !== null && f.canal !== canal) return false
      if (!t) return true
      return f.sku.toLowerCase().includes(t) || (f.asin ?? '').toLowerCase().includes(t)
    })
  }, [detalle, vista, busca, canal, asinPorSku])

  /* ---------------- Pintar ---------------- */
  if (!lista.ok && lista.faltaMigracion) {
    return (
      <div
        className={`${AVISO.base} ${AVISO.conTono}`}
        style={{ borderLeftColor: COLOR_ESTADO.ambar }}
      >
        <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.ambar }} />
        <div className={`${TIPO.s} ${TEXTO.t2}`}>
          Falta lanzar la migración <strong>220_auditor_stock.sql</strong> en el editor SQL de
          Supabase: no hay dónde guardar las auditorías. En cuanto esté, esta pantalla se llena sola.
        </div>
      </div>
    )
  }
  if (!lista.ok) {
    return (
      <div
        className={`${AVISO.base} ${AVISO.conTono}`}
        style={{ borderLeftColor: COLOR_ESTADO.rojo }}
      >
        <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.rojo }} />
        <div className={`${TIPO.s} ${TEXTO.t2}`}>
          No se han podido leer las auditorías: {lista.error}
        </div>
      </div>
    )
  }

  const ocupado = enCurso || iniciando
  const cabecera = ultimaCompleta
  const ultimaNoCompleta = ultima && ultima.estado !== 'completa' ? ultima : null

  return (
    <div className={`${PANTALLA.cuerpo} h-full`}>
      {/* ---------- Cifras de la última completa ---------- */}
      <div className="flex shrink-0 flex-wrap items-center gap-[9px]">
        {cabecera ? (
          <div className={`${CIFRAS.tira} flex-1`}>
            <div className={CIFRAS.celda}>
              <span className={`${CIFRAS.valor} ${CIFRAS.urgente}`}>{n(cabecera.con_stock)}</span>
              <span className={CIFRAS.rotulo}>con stock</span>
            </div>
            <div className={CIFRAS.celda}>
              <span className={CIFRAS.valor}>{n(cabecera.sin_stock)}</span>
              <span className={CIFRAS.rotulo}>sin stock</span>
            </div>
            {cabecera.sin_dato > 0 && (
              <div className={CIFRAS.celda} title="Amazon no ha dicho cuántas hay: NO cuentan como agotados">
                <span className={CIFRAS.valor}>{n(cabecera.sin_dato)}</span>
                <span className={CIFRAS.rotulo}>sin dato</span>
              </div>
            )}
            <div className={CIFRAS.celda}>
              <span className={CIFRAS.valor}>{n(cabecera.unidades)}</span>
              <span className={CIFRAS.rotulo}>unidades</span>
            </div>
            {cabecera.entran !== null && cabecera.salen !== null && (
              <div className={CIFRAS.celda} title="Respecto a la auditoría completa anterior">
                <span className={CIFRAS.valor} style={{ color: COLOR_ESTADO.verde }}>
                  +{n(cabecera.entran)}
                </span>
                <span className={CIFRAS.valor} style={{ color: cabecera.salen > 0 ? COLOR_ESTADO.rojo : undefined }}>
                  −{n(cabecera.salen)}
                </span>
                <span className={CIFRAS.rotulo}>entran / salen</span>
              </div>
            )}
            {cabecera.ps_estado === 'ok' && cabecera.cruce_amz_con_stock != null && (
              <div
                className={CIFRAS.celda}
                title={`Entre los ${n(cabecera.cruce_cruzados ?? 0)} listings FBM que se han encontrado en la tienda (por EAN o referencia): cuántos tienen stock en Amazon y cuántos en PrestaShop. La tienda entera tiene ${n(cabecera.ps_tallas ?? 0)} tallas, ${n(cabecera.ps_con_stock ?? 0)} con stock.`}
              >
                <span className={CIFRAS.valor}>
                  {n(cabecera.cruce_amz_con_stock)} / {n(cabecera.cruce_ps_con_stock ?? 0)}
                </span>
                <span className={CIFRAS.rotulo}>Amazon / tienda con stock</span>
              </div>
            )}
            {cabecera.ps_estado === 'ok' && cabecera.ps_con_stock != null && (
              <div className={CIFRAS.celda} title="Tallas de la tienda PrestaShop con stock, estén o no en Amazon">
                <span className={CIFRAS.valor}>{n(cabecera.ps_con_stock)}</span>
                <span className={CIFRAS.rotulo}>en la tienda (de {n(cabecera.ps_tallas ?? 0)})</span>
              </div>
            )}
            <div className={CIFRAS.celda}>
              <span className={CIFRAS.rotulo}>{haceCuanto(cabecera.creada_at, ahora)}</span>
            </div>
          </div>
        ) : (
          <div className={`${TIPO.s} ${TEXTO.t3} flex-1`}>
            Todavía no hay ninguna auditoría completa. La primera sale en cuanto toque —cada 15
            minutos— o pulsando «Auditar ahora».
          </div>
        )}

        <button
          type="button"
          className={`${BOTON.base} ${BOTON.alto} ${BOTON.secundario}`}
          onClick={() => setVerTienda(true)}
          title="Conectar con la tienda PrestaShop de ShoesF para contrastar su stock con el de Amazon"
        >
          <Store className="h-3 w-3" />
          Tienda PrestaShop
        </button>

        <button
          type="button"
          className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario}`}
          disabled={ocupado}
          onClick={auditarAhora}
          title="Lee el stock de toda la cuenta ahora mismo. Tarda dos o tres minutos."
        >
          {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          {ocupado ? 'Auditando…' : 'Auditar ahora'}
        </button>
      </div>

      {errorAccion && (
        <div className={`${AVISO.base} ${AVISO.conTono} shrink-0`} style={{ borderLeftColor: COLOR_ESTADO.rojo }}>
          <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.rojo }} />
          <div className={`${TIPO.s} ${TEXTO.t2}`}>{errorAccion}</div>
        </div>
      )}

      {/* La tienda no se ha podido leer en la última pasada: Amazon sigue auditándose igual */}
      {ultima?.ps_estado === 'error' && (
        <div className={`${AVISO.base} ${AVISO.conTono} shrink-0`} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
          <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.ambar }} />
          <div className={`${TIPO.s} ${TEXTO.t2}`}>
            <strong>La tienda PrestaShop no ha contestado en la última pasada.</strong> {ultima.ps_error}{' '}
            La auditoría de Amazon es válida; solo falta el cruce de esa hora.
          </div>
        </div>
      )}
      {lista.ok && !lista.conTienda && (
        <div className={`${AVISO.base} ${AVISO.conTono} shrink-0`} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
          <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.ambar }} />
          <div className={`${TIPO.s} ${TEXTO.t2}`}>
            Falta lanzar la migración <strong>222_auditor_stock_tienda.sql</strong> para que cada auditoría
            cruce también con la tienda PrestaShop. Mientras tanto el auditor de Amazon sigue igual.
          </div>
        </div>
      )}

      {/* La última NO es completa: se dice, y las cifras de arriba son de la anterior */}
      {ultimaNoCompleta && (
        <div
          className={`${AVISO.base} ${AVISO.conTono} shrink-0`}
          style={{ borderLeftColor: ultimaNoCompleta.estado === 'error' ? COLOR_ESTADO.rojo : COLOR_ESTADO.ambar }}
        >
          <AlertTriangle
            className={AVISO.icono}
            style={{ color: ultimaNoCompleta.estado === 'error' ? COLOR_ESTADO.rojo : COLOR_ESTADO.ambar }}
          />
          <div className={`${TIPO.s} ${TEXTO.t2}`}>
            <strong>
              La última auditoría ({hora.format(new Date(ultimaNoCompleta.creada_at))}){' '}
              {ultimaNoCompleta.estado === 'error' ? 'ha fallado' : 'se ha quedado a medias'}.
            </strong>{' '}
            {ultimaNoCompleta.error}
            {cabecera && (
              <>
                {' '}
                Las cifras de arriba son las de la última completa ({hora.format(new Date(cabecera.creada_at))}).
              </>
            )}
          </div>
        </div>
      )}

      {/* ---------- Historial + detalle ---------- */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(340px,5fr)_minmax(0,7fr)] gap-[9px]">
        {/* ----- Las horas ----- */}
        <div className={`${TABLA.caja} min-w-0`}>
          {grupos.length === 0 && (
            <p className={`${TIPO.s} ${TEXTO.t4} p-3`}>No hay auditorías en las últimas 72 horas.</p>
          )}
          {grupos.map((g) => {
            const abierta = estaAbierta(g.clave)
            return (
              <div key={g.clave} className={`border-b ${LINEA.normal}`}>
                <button
                  type="button"
                  className="flex w-full items-center gap-[7px] bg-[var(--ls-sup2)] px-2 py-[6px] text-left hover:bg-[var(--ls-sup3)]"
                  aria-expanded={abierta}
                  onClick={() =>
                    setAbiertas((prev) => {
                      const s = new Set(prev ?? (grupoReciente ? [grupoReciente] : []))
                      if (s.has(g.clave)) s.delete(g.clave)
                      else s.add(g.clave)
                      return s
                    })
                  }
                >
                  {abierta ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                  <span className={`${TIPO.m} ${TEXTO.t1} font-medium tabular-nums`}>{g.rango}</span>
                  <span className={`${TIPO.s} ${TEXTO.t4}`}>{g.dia}</span>
                  <span className="ml-auto flex items-center gap-[8px]">
                    {g.problemas > 0 && (
                      <span className={TIPO.xs} style={{ color: COLOR_ESTADO.ambar }}>
                        {g.problemas} con problemas
                      </span>
                    )}
                    {g.delta !== null && g.delta !== 0 && (
                      <span
                        className={`${TIPO.xs} tabular-nums`}
                        style={{ color: g.delta < 0 ? COLOR_ESTADO.rojo : COLOR_ESTADO.verde }}
                        title="Cuánto cambió el número de productos con stock a lo largo de la hora"
                      >
                        {g.delta > 0 ? '+' : '−'}
                        {n(Math.abs(g.delta))}
                      </span>
                    )}
                    <span className={`${TIPO.m} ${TEXTO.t1} tabular-nums`}>
                      {g.ultima ? n(g.ultima.con_stock) : '—'}
                    </span>
                  </span>
                </button>

                {abierta && (
                  <table className="w-full text-[12px]">
                    <tbody>
                      {g.filas.map((f) => (
                        <tr
                          key={f.id}
                          className={`${TABLA.fila} cursor-pointer ${f.id === idActivo ? TABLA.filaSel : ''}`}
                          onClick={() => {
                            setElegida(f.id)
                            setVista('con_stock')
                          }}
                        >
                          <td className={`${TABLA.celda} tabular-nums ${TEXTO.t1}`}>
                            {hora.format(new Date(f.creada_at))}
                          </td>
                          <td className={TABLA.celda}>
                            <EstadoChip estado={f.estado} />
                          </td>
                          <td className={`${TABLA.celda} ${TABLA.numero}`}>
                            {f.estado === 'error' ? '—' : n(f.con_stock)}
                          </td>
                          <td className={`${TABLA.celda} ${TABLA.numero} ${TEXTO.t3}`}>
                            {f.estado === 'error' ? '—' : n(f.sin_stock)}
                          </td>
                          <td className={`${TABLA.celda} ${TABLA.numero} ${TEXTO.t3}`}>
                            {f.entran === null ? (
                              '—'
                            ) : (
                              <>
                                <span style={{ color: f.entran > 0 ? COLOR_ESTADO.verde : undefined }}>+{n(f.entran)}</span>
                                {' '}
                                <span style={{ color: (f.salen ?? 0) > 0 ? COLOR_ESTADO.rojo : undefined }}>
                                  −{n(f.salen ?? 0)}
                                </span>
                              </>
                            )}
                          </td>
                          <td
                            className={`${TABLA.celda} ${TABLA.numero} ${TEXTO.t3}`}
                            title="Entre los emparejados con la tienda: con stock en Amazon / con stock en la tienda"
                          >
                            {f.ps_estado === 'ok' && f.cruce_amz_con_stock != null
                              ? `A ${n(f.cruce_amz_con_stock)} · T ${n(f.cruce_ps_con_stock ?? 0)}`
                              : f.ps_estado === 'error'
                                ? 'tienda ✕'
                                : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })}
        </div>

        {/* ----- Los productos de la auditoría elegida ----- */}
        <div className="flex min-h-0 min-w-0 flex-col gap-[7px]">
          <div className="flex shrink-0 flex-wrap items-center gap-[6px]">
            {detalle && (
              <span className={`${TIPO.m} ${TEXTO.t1}`}>
                <strong>{hora.format(new Date(detalle.resumen.creada_at))}</strong>
                <span className={TEXTO.t4}>
                  {' · '}
                  {new Date(detalle.resumen.creada_at).toLocaleDateString('es-ES', { timeZone: ZONA, day: 'numeric', month: 'short' })}
                </span>
              </span>
            )}
            {(['con_stock', 'entran', 'salen'] as const).map((v) => {
              const total =
                v === 'con_stock'
                  ? (detalle?.resumen.con_stock ?? 0)
                  : v === 'entran'
                    ? (detalle?.resumen.entran ?? 0)
                    : (detalle?.resumen.salen ?? 0)
              const sinComparar = v !== 'con_stock' && detalle?.resumen.entran === null
              return (
                <button
                  key={v}
                  type="button"
                  disabled={sinComparar}
                  title={sinComparar ? 'Esta auditoría no se pudo comparar con la anterior' : undefined}
                  className={`${BOTON.chip} ${vista === v ? BOTON.chipEncendido : ''}`}
                  onClick={() => setVista(v)}
                >
                  {v === 'con_stock' ? 'Con stock' : v === 'entran' ? 'Entran' : 'Salen'}
                  {!sinComparar && ` (${n(total)})`}
                </button>
              )
            })}

            {detalle?.contraste &&
              (['sobreventa', 'ventaPerdida', 'distinta'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  title={ROTULO_TIENDA[v].ayuda}
                  className={`${BOTON.chip} ${vista === v ? BOTON.chipEncendido : ''}`}
                  onClick={() => setVista(v)}
                >
                  {ROTULO_TIENDA[v].corto} ({n(detalle.resumen[v === 'sobreventa' ? 'div_sobreventa' : v === 'ventaPerdida' ? 'div_venta_perdida' : 'div_distinta'] ?? 0)})
                </button>
              ))}

            <span className="mx-1 h-4 w-px bg-[var(--ls-linea)]" />
            {(['todos', 'M', 'A'] as const).map((c) => (
              <button
                key={c}
                type="button"
                className={`${BOTON.chip} ${canal === c ? BOTON.chipEncendido : ''}`}
                onClick={() => setCanal(c)}
                title={c === 'A' ? 'FBA: la cantidad es la del último inventario de Amazon, que se lee una vez al día' : undefined}
              >
                {c === 'todos' ? 'Todos' : c === 'M' ? 'FBM' : 'FBA'}
              </button>
            ))}

            <button
              type="button"
              disabled={tabla.length === 0}
              className={`${BOTON.base} ${BOTON.alto} ${BOTON.secundario} ml-auto`}
              title="Descarga lo que se ve ahora, con la pestaña y los filtros elegidos"
              onClick={() => descargarTabla(tabla, vista, detalle?.resumen.creada_at ?? null)}
            >
              Descargar CSV
            </button>

            <label className="relative w-[200px]">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--ls-t4)]" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="SKU o ASIN"
                className={`${CAMPO.input} pl-[26px]`}
              />
            </label>
          </div>

          <div className={TABLA.caja}>
            <table className={TABLA.tabla}>
              <thead>
                <tr>
                  <th className={TABLA.cabecera}>SKU</th>
                  <th className={TABLA.cabecera}>ASIN</th>
                  <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>
                    {vista === 'salen' ? 'Tenían' : vista === 'con_stock' || vista === 'entran' ? 'Cantidad' : 'Amazon'}
                  </th>
                  {(vista === 'sobreventa' || vista === 'ventaPerdida' || vista === 'distinta') && (
                    <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Tienda</th>
                  )}
                  <th className={TABLA.cabecera}>Canal</th>
                </tr>
              </thead>
              <tbody>
                {cargando && (
                  <tr>
                    <td colSpan={5} className={`${TABLA.celda} ${TEXTO.t4}`}>
                      <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                      Cargando…
                    </td>
                  </tr>
                )}
                {errorDetalle && (
                  <tr>
                    <td colSpan={5} className={`${TABLA.celda}`} style={{ color: COLOR_ESTADO.rojo }}>
                      {errorDetalle}
                    </td>
                  </tr>
                )}
                {!cargando && !errorDetalle && tabla.length === 0 && (
                  <tr>
                    <td colSpan={5} className={`${TABLA.celda} ${TEXTO.t4} text-center`}>
                      {!detalle
                        ? 'No hay ninguna auditoría que enseñar.'
                        : detalle.resumen.estado === 'error'
                          ? 'Esta auditoría falló y no guardó productos.'
                          : 'Nada que enseñar con estos filtros.'}
                    </td>
                  </tr>
                )}
                {tabla.map((f, i) => (
                  <tr key={`${f.sku}|${i}`} className={TABLA.fila}>
                    <td className={`${TABLA.celda} font-mono text-[11.5px]`}>{f.sku}</td>
                    <td className={`${TABLA.celda} font-mono text-[11.5px] ${TEXTO.t3}`}>{f.asin ?? '—'}</td>
                    <td className={`${TABLA.celda} ${TABLA.numero} ${TEXTO.t1} font-semibold`}>{n(f.cantidad)}</td>
                    {f.tienda !== undefined && (
                      <td className={`${TABLA.celda} ${TABLA.numero} ${TEXTO.t1} font-semibold`}>{n(f.tienda)}</td>
                    )}
                    <td className={`${TABLA.celda} ${TEXTO.t3}`}>
                      {f.canal === 'A' ? 'FBA' : f.canal === 'M' ? 'FBM' : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={`shrink-0 ${RADIO.r2} ${TIPO.s} ${TEXTO.t4}`}>
            {n(tabla.length)} filas
            {detalle && detalle.resumen.leidas > 0 && (
              <>
                {' · '}
                leídos {n(detalle.resumen.leidas)} de {n(detalle.resumen.skus_pedidos)} listings
                {detalle.resumen.duracion_ms ? ` en ${Math.round(detalle.resumen.duracion_ms / 1000)} s` : ''}
                {detalle.resumen.no_vinieron > 0 && ` · ${n(detalle.resumen.no_vinieron)} que Amazon no devolvió`}
              </>
            )}
          </div>
        </div>
      </div>
      {verTienda && <DialogoPrestaShop onCerrar={() => setVerTienda(false)} />}
    </div>
  )
}

function EstadoChip({ estado }: { estado: AuditoriaResumen['estado'] }) {
  const m = {
    completa: { c: COLOR_ESTADO.verde, t: 'Completa' },
    parcial: { c: COLOR_ESTADO.ambar, t: 'Parcial' },
    error: { c: COLOR_ESTADO.rojo, t: 'Error' },
  }[estado]
  return (
    <span className={TIPO.xs} style={{ color: m.c }}>
      {m.t}
    </span>
  )
}
