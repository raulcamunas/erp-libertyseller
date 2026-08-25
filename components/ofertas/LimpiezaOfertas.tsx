'use client'

import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Download, Loader2, Play, Search, Send, ShieldCheck } from 'lucide-react'
import { postAmazon } from '@/lib/amazon/client'
import { marketplaceLabel } from '@/lib/types/amazon'

/**
 * LIMPIEZA DE OFERTAS · PRECIO MÍNIMO, MÁXIMO Y REBAJAS.
 *
 * Se lee el catálogo de un cliente con lo que tiene puesto en cada listing, se
 * decide qué quitar, y se manda.
 *
 *
 * ============ ESTA PANTALLA BORRA COSAS DEL CLIENTE ============
 *
 * Es la única del ERP que quita algo que una persona puso a mano en Seller
 * Central: los límites de precio y las rebajas programadas. No hay «deshacer» —
 * Amazon no guarda el valor anterior de un atributo que se sobrescribe, y el
 * único sitio donde queda constancia es nuestro registro de envíos.
 *
 * Por eso la pantalla está montada al revés de lo normal:
 *
 *   · El botón grande y naranja es SIMULAR, no enviar. Simular pregunta a
 *     Amazon si aceptaría el cambio y no cambia nada.
 *   · Enviar está en gris, pide confirmación escribiendo el número de
 *     referencias, y no se enciende hasta haber simulado.
 *   · Lo que se manda es EXACTAMENTE lo que se ve marcado. No hay ningún
 *     «aplicar a todo el catálogo» que se resuelva en el servidor.
 */

interface Rebaja {
  importe: number | null
  desde: string | null
  hasta: string | null
}

interface Fila {
  sku: string
  asin: string | null
  titulo: string | null
  canal: string | null
  moneda: string | null
  precio: number | null
  precioMinimo: number | null
  precioMaximo: number | null
  rebaja: Rebaja | null
  editable: boolean
}

interface Conexion {
  id: string
  name: string
  marketplace_ids: string[]
  marketplaces_activos: string[] | null
  default_marketplace_id: string | null
}

const ALTO_FILA = 30
const MARGEN = 12
const ALTO_CAJA = 480
const REJILLA = '34px 96px minmax(200px,1fr) 90px 84px 84px 150px 90px'

function eur(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function dia(iso: string | null | undefined): string {
  if (!iso) return ''
  return iso.slice(0, 10).split('-').reverse().join('/')
}

/** Mañana en ISO, que es lo que Amazon quiere en `end_at` */
function manana(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function LimpiezaOfertas({ conexiones }: { conexiones: Conexion[] }) {
  const [connectionId, setConnectionId] = useState(conexiones[0]?.id ?? '')
  const conexion = conexiones.find((c) => c.id === connectionId) ?? null
  const mercados = conexion
    ? conexion.marketplaces_activos && conexion.marketplaces_activos.length > 0
      ? conexion.marketplaces_activos
      : conexion.marketplace_ids
    : []
  const [marketplaceId, setMarketplaceId] = useState(
    conexiones[0]?.default_marketplace_id ?? conexiones[0]?.marketplace_ids?.[0] ?? ''
  )

  const [filas, setFilas] = useState<Fila[]>([])
  const [leyendo, setLeyendo] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [simulado, setSimulado] = useState<{ ok: number; mal: number } | null>(null)
  const [meta, setMeta] = useState('')

  /** Qué SKU van a mandarse. Vacío = ninguno: aquí no se marca nada solo */
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set())
  const [busca, setBusca] = useState('')
  const [soloConLimites, setSoloConLimites] = useState(true)

  /** Precio nuevo por SKU. Sin entrada = se conserva el que tiene */
  const [preciosNuevos, setPreciosNuevos] = useState<Record<string, number>>({})
  /** Qué hacer con la rebaja: quitarla o dejarla terminando mañana */
  const [queHacerConRebaja, setQueHacerConRebaja] = useState<'quitar' | 'terminar_manana'>('quitar')

  const [desde, setDesde] = useState(0)
  const caja = useRef<HTMLDivElement>(null)

  async function leer() {
    if (!connectionId || !marketplaceId || leyendo) return
    setLeyendo(true)
    setSimulado(null)
    setMarcados(new Set())
    setPreciosNuevos({})

    const res = await postAmazon<{
      ms: number
      llamadas: number
      filas: Fila[]
      noVinieron: string[]
    }>('/api/amazon/ofertas', { connectionId, marketplaceId })

    setLeyendo(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setFilas(res.data.filas)
    setMeta(
      `${res.data.filas.length.toLocaleString('es-ES')} referencias en ${res.data.llamadas} llamadas · ` +
        `${Math.round(res.data.ms / 1000)} s` +
        (res.data.noVinieron.length > 0
          ? ` · ${res.data.noVinieron.length} que Amazon no reconoce`
          : '')
    )
  }

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return filas.filter((f) => {
      if (soloConLimites && f.precioMinimo === null && f.precioMaximo === null && !f.rebaja) {
        return false
      }
      if (!q) return true
      return (
        f.sku.toLowerCase().includes(q) ||
        (f.titulo ?? '').toLowerCase().includes(q) ||
        (f.asin ?? '').toLowerCase().includes(q)
      )
    })
  }, [filas, busca, soloConLimites])

  const cuantasCaben = Math.ceil(ALTO_CAJA / ALTO_FILA)
  const inicio = Math.max(0, desde - MARGEN)
  const pintables = visibles.slice(inicio, desde + cuantasCaben + MARGEN)

  function alternar(sku: string) {
    setMarcados((prev) => {
      const s = new Set(prev)
      if (s.has(sku)) s.delete(sku)
      else s.add(sku)
      return s
    })
    setSimulado(null)
  }

  function marcarTodosLosVisibles() {
    const elegibles = visibles.filter((f) => f.editable).map((f) => f.sku)
    setMarcados((prev) =>
      elegibles.every((s) => prev.has(s)) ? new Set() : new Set([...prev, ...elegibles])
    )
    setSimulado(null)
  }

  /** Lo que se va a mandar. Es la MISMA lista para simular y para enviar */
  function construirCambios() {
    const hasta = manana()
    return filas
      .filter((f) => marcados.has(f.sku) && f.editable)
      .map((f) => {
        const precio = preciosNuevos[f.sku] ?? f.precio ?? 0
        const conservar =
          queHacerConRebaja === 'terminar_manana' && f.rebaja && f.rebaja.importe !== null
        return {
          sku: f.sku,
          precio,
          rebajaHasta: conservar ? hasta : null,
          rebajaImporte: conservar ? f.rebaja!.importe : null,
          rebajaDesde: conservar ? (f.rebaja!.desde ?? hasta) : null,
        }
      })
  }

  async function mandar(simular: boolean) {
    const cambios = construirCambios()
    if (cambios.length === 0) {
      toast.error('No hay ninguna referencia marcada.')
      return
    }
    if (cambios.some((c) => !Number.isFinite(c.precio) || c.precio <= 0)) {
      toast.error('Alguna referencia marcada no tiene precio. Quítala o ponle uno.')
      return
    }

    if (!simular) {
      const cuantas = cambios.length
      const escrito = window.prompt(
        `Vas a QUITAR el precio mínimo, el máximo y las rebajas de ${cuantas} referencias en la ` +
          `cuenta de ${conexion?.name ?? 'este cliente'}.\n\n` +
          'Esto no se puede deshacer: Amazon no guarda el valor anterior.\n\n' +
          `Escribe ${cuantas} para confirmar.`
      )
      if (escrito !== String(cuantas)) {
        toast.error('Cancelado.')
        return
      }
    }

    setEnviando(true)
    const res = await postAmazon<{
      simulado: boolean
      aceptados: number
      fallidos: number
      resultados: { sku: string; estado: string; mensaje: string | null }[]
    }>('/api/amazon/ofertas', {
      accion: 'enviar',
      connectionId,
      marketplaceId,
      simular,
      cambios,
    })
    setEnviando(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }

    if (simular) {
      setSimulado({ ok: res.data.aceptados, mal: res.data.fallidos })
      toast.success(
        `Simulacro: Amazon aceptaría ${res.data.aceptados} y rechazaría ${res.data.fallidos}`
      )
      if (res.data.fallidos > 0) {
        const primero = res.data.resultados.find((r) => r.estado !== 'aceptado')
        if (primero) toast.error(`${primero.sku}: ${primero.mensaje ?? 'rechazado'}`)
      }
      return
    }

    toast.success(`${res.data.aceptados} enviadas · ${res.data.fallidos} rechazadas`)
    setSimulado(null)
    setMarcados(new Set())
    void leer()
  }

  async function descargar() {
    const XLSX = await import('xlsx')
    const hoja = XLSX.utils.json_to_sheet(
      visibles.map((f) => ({
        SKU: f.sku,
        ASIN: f.asin,
        TITULO: f.titulo,
        PRECIO: f.precio,
        PRECIO_MINIMO: f.precioMinimo,
        PRECIO_MAXIMO: f.precioMaximo,
        REBAJA: f.rebaja?.importe ?? null,
        REBAJA_DESDE: dia(f.rebaja?.desde),
        REBAJA_HASTA: dia(f.rebaja?.hasta),
      }))
    )
    const libro = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(libro, hoja, 'Ofertas')
    XLSX.writeFile(libro, `ofertas-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const conLimites = filas.filter(
    (f) => f.precioMinimo !== null || f.precioMaximo !== null || f.rebaja
  ).length

  return (
    <div className="space-y-3 pb-6">
      <div>
        <h1 className="text-[22px] font-semibold text-white">Limpieza de ofertas</h1>
        <p className="text-[12px] text-white/45 mt-0.5">
          Quita el precio mínimo, el máximo y las rebajas programadas de los listings de un cliente.
          De forma masiva y con simulacro delante.
        </p>
      </div>

      {/* Lo que hace, dicho antes de que se pueda pulsar nada */}
      <div className="rounded-lg border border-amber-500/25 bg-amber-400/[0.06] px-2.5 py-2 text-[11px] text-amber-200/90 leading-relaxed">
        <span className="font-semibold">Esto borra cosas que el cliente puso a mano.</span> Amazon
        no guarda el valor anterior de un atributo que se sobrescribe, así que{' '}
        <strong>no hay deshacer</strong>. Descarga el Excel antes de enviar: es la única copia de lo
        que había.
      </div>

      {/* ---------------- Qué cuenta ---------------- */}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-[10px] text-white/35 mb-0.5">Cuenta</label>
          <select
            value={connectionId}
            onChange={(e) => {
              setConnectionId(e.target.value)
              setFilas([])
              setMarcados(new Set())
              const c = conexiones.find((x) => x.id === e.target.value)
              setMarketplaceId(c?.default_marketplace_id ?? c?.marketplace_ids?.[0] ?? '')
            }}
            className="h-7 rounded-lg border border-white/10 bg-white/[0.03] px-2 text-[11px] text-white outline-none focus:border-[#FF6600] min-w-[180px]"
          >
            {conexiones.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-white/35 mb-0.5">País</label>
          <select
            value={marketplaceId}
            onChange={(e) => {
              setMarketplaceId(e.target.value)
              setFilas([])
              setMarcados(new Set())
            }}
            className="h-7 rounded-lg border border-white/10 bg-white/[0.03] px-2 text-[11px] text-white outline-none focus:border-[#FF6600]"
          >
            {mercados.map((m) => (
              <option key={m} value={m}>
                {marketplaceLabel(m)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => void leer()}
          disabled={leyendo || !connectionId || !marketplaceId}
          className="h-7 px-3 rounded-full bg-[#FF6600] text-white text-[11px] font-medium flex items-center gap-1.5 disabled:opacity-50"
        >
          {leyendo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Leer catálogo
        </button>
        {meta && <span className="text-[11px] text-white/40 self-center">{meta}</span>}
      </div>

      {filas.length > 0 && (
        <>
          {/* ---------------- Filtros y acciones ---------------- */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-white/30" />
              <input
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value)
                  caja.current?.scrollTo({ top: 0 })
                  setDesde(0)
                }}
                placeholder="Buscar por SKU, ASIN o título"
                className="w-full h-7 rounded-lg border border-white/10 bg-white/[0.03] pl-7 pr-2 text-[11px] text-white outline-none focus:border-[#FF6600]"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setSoloConLimites((v) => !v)
                caja.current?.scrollTo({ top: 0 })
                setDesde(0)
              }}
              className={`px-2.5 py-1 rounded-full border text-[11px] transition-colors ${
                soloConLimites
                  ? 'border-[#FF6600]/60 bg-[#FF6600]/15 text-white'
                  : 'border-white/10 text-white/45 hover:text-white/80'
              }`}
              title="Las que no tienen ni límites ni rebaja no hay nada que limpiarles"
            >
              Solo las que tienen algo puesto ({conLimites.toLocaleString('es-ES')})
            </button>
            <button
              type="button"
              onClick={() => void descargar()}
              className="h-7 px-2.5 rounded-lg border border-white/10 text-[11px] text-white/60 hover:text-white flex items-center gap-1.5"
            >
              <Download className="h-3 w-3" />
              Excel
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-2">
            <span className="text-[11px] text-white/45">Con las rebajas:</span>
            {(
              [
                ['quitar', 'Quitarlas'],
                ['terminar_manana', `Terminarlas mañana (${dia(manana())})`],
              ] as const
            ).map(([id, texto]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setQueHacerConRebaja(id)
                  setSimulado(null)
                }}
                className={`px-2.5 py-1 rounded-full border text-[11px] transition-colors ${
                  queHacerConRebaja === id
                    ? 'border-[#FF6600]/60 bg-[#FF6600]/15 text-white'
                    : 'border-white/10 text-white/45 hover:text-white/80'
                }`}
              >
                {texto}
              </button>
            ))}
            <span className="text-[10px] text-white/25">
              El mínimo y el máximo se quitan siempre
            </span>

            <span className="ml-auto text-[11px] text-white/60">
              <strong className="text-white">{marcados.size.toLocaleString('es-ES')}</strong>{' '}
              marcadas
            </span>
            <button
              type="button"
              onClick={() => void mandar(true)}
              disabled={enviando || marcados.size === 0}
              className="h-7 px-3 rounded-full bg-[#FF6600] text-white text-[11px] font-medium flex items-center gap-1.5 disabled:opacity-40"
            >
              {enviando ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ShieldCheck className="h-3 w-3" />
              )}
              Simular
            </button>
            {/* ENVIAR SOLO DESPUÉS DE SIMULAR, y a propósito: es la única forma
                de saber que Amazon acepta el cambio antes de que sea
                irreversible. */}
            <button
              type="button"
              onClick={() => void mandar(false)}
              disabled={enviando || marcados.size === 0 || simulado === null}
              title={
                simulado === null
                  ? 'Primero hay que simular: es lo que dice si Amazon lo aceptaría'
                  : 'Enviar de verdad'
              }
              className="h-7 px-3 rounded-full border border-red-500/40 bg-red-500/10 text-red-200 text-[11px] font-medium flex items-center gap-1.5 disabled:opacity-30"
            >
              <Send className="h-3 w-3" />
              Enviar de verdad
            </button>
          </div>

          {simulado && (
            <div
              className={`rounded-lg border px-2.5 py-2 text-[11px] ${
                simulado.mal === 0
                  ? 'border-green-500/25 bg-green-500/[0.06] text-green-200'
                  : 'border-amber-500/25 bg-amber-400/[0.06] text-amber-200'
              }`}
            >
              <span className="font-semibold">Simulacro hecho.</span> Amazon aceptaría{' '}
              {simulado.ok.toLocaleString('es-ES')} y rechazaría {simulado.mal.toLocaleString('es-ES')}.
              {simulado.mal === 0
                ? ' Ya se puede enviar de verdad.'
                : ' Revisa las rechazadas antes de enviar: las que fallan aquí van a fallar igual.'}
            </div>
          )}

          {/* ---------------- La tabla ---------------- */}
          <div className="rounded-lg border border-white/10 overflow-hidden">
            <div
              className="grid bg-white/[0.03] border-b border-white/10"
              style={{ gridTemplateColumns: REJILLA }}
            >
              <button
                type="button"
                onClick={marcarTodosLosVisibles}
                className="px-2 py-1.5 text-left text-[10px] text-white/40 hover:text-white"
                title="Marcar o desmarcar todo lo que se está viendo"
              >
                ☐
              </button>
              {['SKU', 'Producto', 'Precio', 'Mínimo', 'Máximo', 'Rebaja', 'Precio nuevo'].map(
                (t, i) => (
                  <span
                    key={t}
                    className={`px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40 ${
                      i >= 2 && i <= 4 ? 'text-right' : 'text-left'
                    }`}
                  >
                    {t}
                  </span>
                )
              )}
            </div>

            <div
              ref={caja}
              onScroll={(e) => setDesde(Math.floor(e.currentTarget.scrollTop / ALTO_FILA))}
              className="overflow-y-auto"
              style={{ height: ALTO_CAJA }}
            >
              {visibles.length === 0 ? (
                <p className="p-4 text-[11px] text-white/35">
                  Ninguna referencia encaja con el filtro.
                </p>
              ) : (
                <div style={{ height: visibles.length * ALTO_FILA, position: 'relative' }}>
                  {pintables.map((f, i) => {
                    const fila = inicio + i
                    const marcado = marcados.has(f.sku)
                    return (
                      <div
                        key={f.sku}
                        className={`grid items-center absolute left-0 right-0 border-b border-white/[0.04] ${
                          marcado ? 'bg-[#FF6600]/[0.08]' : 'hover:bg-white/[0.03]'
                        }`}
                        style={{
                          gridTemplateColumns: REJILLA,
                          top: fila * ALTO_FILA,
                          height: ALTO_FILA,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => f.editable && alternar(f.sku)}
                          disabled={!f.editable}
                          title={
                            f.editable
                              ? undefined
                              : 'No tenemos su tipo de producto, y Amazon lo exige en cada cambio'
                          }
                          className="px-2 text-left disabled:opacity-30"
                        >
                          <span
                            className={`inline-block h-3 w-3 rounded border ${
                              marcado ? 'bg-[#FF6600] border-[#FF6600]' : 'border-white/25'
                            }`}
                          />
                        </button>
                        <span className="px-2 text-[11px] font-mono text-white/80 truncate">
                          {f.sku}
                        </span>
                        <span
                          className="px-2 text-[11px] text-white/60 truncate"
                          title={f.titulo ?? ''}
                        >
                          {f.titulo ?? '—'}
                        </span>
                        <span className="px-2 text-[11px] text-right tabular-nums text-white/70">
                          {eur(f.precio)}
                        </span>
                        <span
                          className={`px-2 text-[11px] text-right tabular-nums ${
                            f.precioMinimo !== null ? 'text-amber-300/80' : 'text-white/20'
                          }`}
                        >
                          {eur(f.precioMinimo)}
                        </span>
                        <span
                          className={`px-2 text-[11px] text-right tabular-nums ${
                            f.precioMaximo !== null ? 'text-amber-300/80' : 'text-white/20'
                          }`}
                        >
                          {eur(f.precioMaximo)}
                        </span>
                        <span
                          className={`px-2 text-[10.5px] truncate ${
                            f.rebaja ? 'text-sky-300/80' : 'text-white/20'
                          }`}
                          title={
                            f.rebaja
                              ? `${eur(f.rebaja.importe)} del ${dia(f.rebaja.desde)} al ${dia(f.rebaja.hasta)}`
                              : ''
                          }
                        >
                          {f.rebaja
                            ? `${eur(f.rebaja.importe)} · ${dia(f.rebaja.desde)}–${dia(f.rebaja.hasta)}`
                            : '—'}
                        </span>
                        {/* EL PRECIO NUEVO ES OPCIONAL. Vacío = se conserva el que
                            tiene. Hay que mandarlo igual —una oferta sin precio
                            Amazon no la publica— pero eso lo resuelve el código,
                            no la persona. */}
                        <input
                          defaultValue=""
                          inputMode="decimal"
                          placeholder={f.precio !== null ? eur(f.precio) : ''}
                          onBlur={(e) => {
                            const t = e.target.value.trim().replace(',', '.')
                            setPreciosNuevos((prev) => {
                              const s = { ...prev }
                              if (t === '') delete s[f.sku]
                              else {
                                const n = Number(t)
                                if (Number.isFinite(n) && n > 0) s[f.sku] = n
                              }
                              return s
                            })
                            setSimulado(null)
                          }}
                          className="mx-1 h-5 rounded border border-white/10 bg-white/[0.03] px-1 text-[11px] text-white text-right tabular-nums outline-none focus:border-[#FF6600] placeholder:text-white/20"
                        />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          <p className="text-[10px] text-white/30 flex items-start gap-1.5">
            <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
            Se manda exactamente lo que está marcado, referencia a referencia y con su precio
            dentro. No hay ningún «aplicar a todo» que se resuelva en el servidor.
          </p>
        </>
      )}
    </div>
  )
}
