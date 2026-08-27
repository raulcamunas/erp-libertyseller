'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  CalendarDays,
  Check,
  Download,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { postAmazon } from '@/lib/amazon/client'

/**
 * INFORMES DE MARKETING.
 *
 * Elegir una cuenta de anunciante, un rango de fechas y qué informes se quieren.
 * El resto lo hace un proceso, porque no puede hacerlo esta pantalla: Amazon
 * tarda de diez segundos a varios minutos POR INFORME, y una selección normal
 * son diez o quince.
 *
 * De ahí que esto sea una lista de ENCARGOS y no un botón que devuelve un
 * fichero. Se pide, se cierra la pestaña, y se vuelve cuando está.
 *
 *
 * ============ LAS DE AMAZON DSP SALEN, PERO APAGADAS ============
 *
 * Siete de las dieciséis plantillas de la consola de Amazon son de DSP, que es
 * otro producto con su propia API y sus propias cuentas de anunciante. Con las
 * cuentas de publicidad patrocinada que hay conectadas no se pueden pedir.
 *
 * Salen igualmente, en gris y con el motivo escrito. Esconderlas haría que la
 * pregunta «¿y la de geografía?» volviera cada dos meses, y la respuesta no está
 * en ningún sitio.
 */

interface Cuenta {
  perfilId: string
  profileId: number
  nombre: string
  pais: string | null
  moneda: string | null
  clienteNombre: string
}

interface Variante {
  reportTypeId: string
  adProduct: string
  hoja: string
}

interface Plantilla {
  id: string
  nombre: string
  descripcion: string
  variantes: Variante[]
  imposible?: string
}

interface Informe {
  id: string
  perfil_id: string
  desde: string
  hasta: string
  plantillas: string[]
  estado: 'pendiente' | 'preparando' | 'listo' | 'error' | 'cancelado'
  error: string | null
  pedido_at: string
  listo_at: string | null
  descargado_veces: number
}

interface Parte {
  id: string
  informe_id: string
  plantilla: string
  hoja: string
  estado: 'pendiente' | 'pedido' | 'listo' | 'error' | 'sin_datos'
  error: string | null
  intentos: number
}

interface Respuesta {
  cuentas: Cuenta[]
  plantillas: Plantilla[]
  informes: Informe[]
  partes: Parte[]
}

const CAJA = 'rounded-xl border border-white/10 bg-white/[0.02] p-3'
const CAMPO =
  'h-8 rounded-lg border border-white/10 bg-white/[0.03] px-2 text-[12px] text-white outline-none focus:border-[#FF6600]'

function hoy(): string {
  return new Date().toISOString().slice(0, 10)
}

/** El primer y el último día de un mes, en local. Para los atajos */
function mes(retroceso: number): { desde: string; hasta: string } {
  const d = new Date()
  const primero = new Date(d.getFullYear(), d.getMonth() - retroceso, 1)
  const ultimo = new Date(d.getFullYear(), d.getMonth() - retroceso + 1, 0)
  const iso = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  return { desde: iso(primero), hasta: iso(ultimo) }
}

function haceDias(n: number): { desde: string; hasta: string } {
  const fin = new Date()
  const ini = new Date(Date.now() - (n - 1) * 86_400_000)
  const iso = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  return { desde: iso(ini), hasta: iso(fin) }
}

function cuando(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function InformesMarketing() {
  const [datos, setDatos] = useState<Respuesta | null>(null)
  const [cargando, setCargando] = useState(true)
  const [perfilId, setPerfilId] = useState('')
  const [desde, setDesde] = useState(() => mes(1).desde)
  const [hasta, setHasta] = useState(() => mes(1).hasta)
  const [elegidas, setElegidas] = useState<Set<string>>(() => new Set())
  const [encargando, setEncargando] = useState(false)
  const [empujando, setEmpujando] = useState(false)
  const [bajando, setBajando] = useState<string | null>(null)

  const traer = useCallback(async () => {
    const res = await postAmazon<Respuesta>('/api/marketing/informes', {})
    setCargando(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setDatos(res.data)
    setPerfilId((p) => p || (res.data.cuentas[0]?.perfilId ?? ''))
    setElegidas((e) =>
      e.size > 0
        ? e
        : new Set(res.data.plantillas.filter((p) => !p.imposible).map((p) => p.id))
    )
  }, [])

  useEffect(() => {
    void traer()
  }, [traer])

  /**
   * Mientras haya algo preparándose, se vuelve a preguntar solo.
   *
   * Cada quince segundos y solo si hay trabajo: un sondeo constante con la
   * pantalla abierta y nada que hacer son cientos de consultas al día para
   * enterarse de que no ha cambiado nada.
   */
  const hayTrabajo = useMemo(
    () => (datos?.informes ?? []).some((i) => i.estado === 'pendiente' || i.estado === 'preparando'),
    [datos]
  )
  useEffect(() => {
    if (!hayTrabajo) return
    const t = setInterval(() => void traer(), 15_000)
    return () => clearInterval(t)
  }, [hayTrabajo, traer])

  async function encargar() {
    if (!perfilId || elegidas.size === 0) return
    setEncargando(true)
    const res = await postAmazon<{ informeId: string }>('/api/marketing/informes', {
      accion: 'encargar',
      perfilId,
      desde,
      hasta,
      plantillas: [...elegidas],
    })
    setEncargando(false)
    if (!res.ok) {
      toast.error(res.error, { duration: 12_000 })
      return
    }
    toast.success('Encargado. Se va preparando solo; puedes cerrar esto y volver luego.')
    void traer()
  }

  async function empujar() {
    setEmpujando(true)
    const res = await postAmazon('/api/marketing/informes', { accion: 'empujar' })
    setEmpujando(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    void traer()
  }

  async function borrar(id: string) {
    const res = await postAmazon('/api/marketing/informes', { accion: 'borrar', informeId: id })
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    void traer()
  }

  /**
   * La descarga NO va por `postAmazon`: la respuesta es un fichero.
   *
   * Se pide con fetch y se guarda con un enlace de usar y tirar. Un
   * `window.open` habría sido más corto y no vale: cuando la ruta contesta un
   * error en JSON —porque ninguna parte trajo datos— abre una pestaña con el
   * JSON en crudo en vez de decirlo.
   */
  async function descargar(id: string) {
    setBajando(id)
    try {
      const res = await fetch(`/api/marketing/informes/excel?id=${encodeURIComponent(id)}`)
      if (!res.ok) {
        const cuerpo = await res.json().catch(() => null)
        toast.error(cuerpo?.error ?? `No se ha podido armar el Excel (${res.status})`, {
          duration: 12_000,
        })
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download =
        res.headers.get('Content-Disposition')?.match(/filename="(.+?)"/)?.[1] ?? 'informe.xlsx'
      a.click()
      URL.revokeObjectURL(url)
      void traer()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ha fallado la descarga')
    } finally {
      setBajando(null)
    }
  }

  const porInforme = useMemo(() => {
    const m = new Map<string, Parte[]>()
    for (const p of datos?.partes ?? []) {
      const l = m.get(p.informe_id) ?? []
      l.push(p)
      m.set(p.informe_id, l)
    }
    return m
  }, [datos])

  const cuentasPorCliente = useMemo(() => {
    const m = new Map<string, Cuenta[]>()
    for (const c of datos?.cuentas ?? []) {
      const l = m.get(c.clienteNombre) ?? []
      l.push(c)
      m.set(c.clienteNombre, l)
    }
    return [...m]
  }, [datos])

  const peticiones = useMemo(() => {
    let n = 0
    for (const p of datos?.plantillas ?? []) if (elegidas.has(p.id)) n += p.variantes.length
    return n
  }, [datos, elegidas])

  const dias = useMemo(
    () => Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000) + 1,
    [desde, hasta]
  )

  if (cargando) {
    return (
      <div className="flex items-center gap-2 py-8 text-[12px] text-white/40">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Cargando…
      </div>
    )
  }
  if (!datos) return null

  if (datos.cuentas.length === 0) {
    return (
      <div className={CAJA}>
        <p className="text-[12px] text-amber-300">
          No hay ninguna cuenta de anunciante lista para trabajar.
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-white/40">
          Hacen falta dos cosas, y las dos se hacen en <strong>Amazon API → Publicidad</strong>:
          conectar Amazon Ads del cliente, y marcar qué cuentas de anunciante se trabajan y de qué
          cliente son. Una cuenta sin cliente asignado no sale aquí a propósito — enseñar el gasto
          de un anunciante bajo el cliente equivocado es justo lo que el acuerdo con Amazon
          prohíbe.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* ---------------- Qué se pide ---------------- */}
      <div className={CAJA}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[220px] flex-1">
            <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-white/35">
              Cuenta de anunciante
            </span>
            <select
              value={perfilId}
              onChange={(e) => setPerfilId(e.target.value)}
              className={`${CAMPO} w-full`}
            >
              {cuentasPorCliente.map(([cliente, cuentas]) => (
                <optgroup key={cliente} label={cliente}>
                  {cuentas.map((c) => (
                    <option key={c.perfilId} value={c.perfilId}>
                      {c.nombre} · {c.pais ?? '—'} ({c.moneda ?? '—'})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <label>
            <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-white/35">
              Desde
            </span>
            <input
              type="date"
              value={desde}
              max={hoy()}
              onChange={(e) => setDesde(e.target.value)}
              className={`${CAMPO} [color-scheme:dark]`}
            />
          </label>
          <label>
            <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-white/35">
              Hasta
            </span>
            <input
              type="date"
              value={hasta}
              max={hoy()}
              onChange={(e) => setHasta(e.target.value)}
              className={`${CAMPO} [color-scheme:dark]`}
            />
          </label>

          <span className="pb-1.5 text-[11px] text-white/40">
            {dias > 0 ? `${dias} ${dias === 1 ? 'día' : 'días'}` : 'rango al revés'}
          </span>
        </div>

        {/* Atajos. Un calendario suelto obliga a contar días para pedir «el mes
            pasado», que es lo que se pide el 95% de las veces. */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(
            [
              ['Este mes', () => mes(0)],
              ['Mes pasado', () => mes(1)],
              ['Hace 2 meses', () => mes(2)],
              ['Últimos 7 días', () => haceDias(7)],
              ['Últimos 30 días', () => haceDias(30)],
              ['Últimos 90 días', () => haceDias(90)],
            ] as const
          ).map(([texto, fn]) => (
            <button
              key={texto}
              type="button"
              onClick={() => {
                const r = fn()
                setDesde(r.desde)
                setHasta(r.hasta)
              }}
              className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-white/50 transition-colors hover:border-white/25 hover:text-white"
            >
              <CalendarDays className="mr-1 inline h-3 w-3" />
              {texto}
            </button>
          ))}
        </div>
      </div>

      {/* ---------------- Qué informes ---------------- */}
      <div className={CAJA}>
        <div className="mb-2 flex flex-wrap items-baseline gap-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-white/45">
            Qué informes
          </h3>
          <span className="text-[11px] text-white/40">
            {elegidas.size} elegidos · <strong className="text-white/70">{peticiones}</strong>{' '}
            peticiones a Amazon
          </span>
          <button
            type="button"
            onClick={() =>
              setElegidas(new Set(datos.plantillas.filter((p) => !p.imposible).map((p) => p.id)))
            }
            className="text-[11px] text-white/40 underline-offset-2 hover:text-white hover:underline"
          >
            todos
          </button>
          <button
            type="button"
            onClick={() => setElegidas(new Set())}
            className="text-[11px] text-white/40 underline-offset-2 hover:text-white hover:underline"
          >
            ninguno
          </button>
        </div>

        <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {datos.plantillas.map((p) => {
            const bloqueada = Boolean(p.imposible)
            const marcada = elegidas.has(p.id)
            return (
              <button
                key={p.id}
                type="button"
                disabled={bloqueada}
                onClick={() =>
                  setElegidas((prev) => {
                    const s = new Set(prev)
                    if (s.has(p.id)) s.delete(p.id)
                    else s.add(p.id)
                    return s
                  })
                }
                title={p.imposible ?? p.descripcion}
                className={`rounded-lg border p-2 text-left transition-colors ${
                  bloqueada
                    ? 'cursor-default border-white/[0.06] opacity-40'
                    : marcada
                      ? 'border-[#FF6600]/50 bg-[#FF6600]/10'
                      : 'border-white/10 hover:border-white/25'
                }`}
              >
                <span className="flex items-start gap-1.5">
                  {bloqueada ? (
                    <Lock className="mt-[2px] h-3 w-3 flex-shrink-0 text-white/30" />
                  ) : (
                    <span
                      className={`mt-[2px] flex h-3 w-3 flex-shrink-0 items-center justify-center rounded-[3px] border ${
                        marcada ? 'border-[#FF6600] bg-[#FF6600]' : 'border-white/25'
                      }`}
                    >
                      {marcada && <Check className="h-2.5 w-2.5 text-black" />}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block text-[12px] font-medium text-white">{p.nombre}</span>
                    <span className="block text-[10.5px] leading-snug text-white/35">
                      {p.imposible ?? p.descripcion}
                    </span>
                    {!bloqueada && p.variantes.length > 1 && (
                      <span className="mt-0.5 block text-[10px] text-white/25">
                        {p.variantes.length} pestañas: {p.variantes.map((v) => v.hoja).join(', ')}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void encargar()}
            disabled={encargando || elegidas.size === 0 || dias <= 0}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-[#FF6600]/60 bg-[#FF6600]/20 px-3 text-[12px] text-white transition-colors hover:bg-[#FF6600]/30 disabled:opacity-40"
          >
            {encargando ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Encargar el informe
          </button>
          <span className="text-[11px] text-white/35">
            Tarda unos minutos. Se prepara solo — puedes cerrar esto y volver.
          </span>
        </div>
      </div>

      {/* ---------------- Los encargos ---------------- */}
      <div className={CAJA}>
        <div className="mb-2 flex flex-wrap items-baseline gap-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-white/45">
            Encargos
          </h3>
          <button
            type="button"
            onClick={() => void empujar()}
            disabled={empujando}
            className="flex items-center gap-1 text-[11px] text-white/45 transition-colors hover:text-white disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${empujando ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>

        {datos.informes.length === 0 ? (
          <p className="text-[11px] text-white/30">Todavía no se ha encargado ninguno.</p>
        ) : (
          <div className="space-y-1.5">
            {datos.informes.map((inf) => {
              const partes = porInforme.get(inf.id) ?? []
              const listas = partes.filter((p) => p.estado === 'listo').length
              const fallidas = partes.filter((p) => p.estado === 'error').length
              const cuenta = datos.cuentas.find((c) => c.perfilId === inf.perfil_id)
              return (
                <div key={inf.id} className="rounded-lg border border-white/[0.07] bg-black/20 p-2">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-[12px] font-medium text-white">
                      {cuenta ? `${cuenta.nombre} · ${cuenta.pais ?? ''}` : 'Cuenta retirada'}
                    </span>
                    <span className="text-[11px] text-white/50">
                      {inf.desde} → {inf.hasta}
                    </span>
                    <span
                      className={`rounded-full border px-1.5 py-0.5 text-[10px] ${
                        inf.estado === 'listo'
                          ? 'border-green-400/40 bg-green-400/10 text-green-300'
                          : inf.estado === 'error'
                            ? 'border-red-400/40 bg-red-400/10 text-red-300'
                            : 'border-amber-400/40 bg-amber-400/10 text-amber-300'
                      }`}
                    >
                      {inf.estado === 'listo'
                        ? 'Listo'
                        : inf.estado === 'error'
                          ? 'Error'
                          : 'Preparándose'}
                    </span>
                    <span className="text-[11px] text-white/35">
                      {listas} de {partes.length} informes
                      {fallidas > 0 && <span className="text-red-300/70"> · {fallidas} fallan</span>}
                    </span>
                    <span className="text-[10px] text-white/25">
                      pedido {cuando(inf.pedido_at)}
                    </span>

                    <span className="ml-auto flex items-center gap-1.5">
                      {listas > 0 && (
                        <button
                          type="button"
                          onClick={() => void descargar(inf.id)}
                          disabled={bajando === inf.id}
                          className="flex h-7 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-[11px] text-white/70 transition-colors hover:text-white disabled:opacity-40"
                        >
                          {bajando === inf.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Download className="h-3 w-3" />
                          )}
                          Excel
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void borrar(inf.id)}
                        title="Borrar el encargo"
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-white/25 transition-colors hover:text-red-300"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  </div>

                  {inf.error && <p className="mt-1 text-[11px] text-red-300/80">{inf.error}</p>}

                  {/* El detalle por petición. Es lo que convierte «falla» en «falla
                      ESTA, y Amazon dice por qué» — que es la diferencia entre
                      poder arreglarlo y no. */}
                  {partes.some((p) => p.estado === 'error') && (
                    <div className="mt-1 space-y-0.5">
                      {partes
                        .filter((p) => p.estado === 'error')
                        .map((p) => (
                          <p key={p.id} className="text-[10.5px] text-red-300/60">
                            <span className="text-white/40">{p.hoja}</span> · {p.error}
                          </p>
                        ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
