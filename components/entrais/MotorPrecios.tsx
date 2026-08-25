'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Download, Loader2, Play, Search } from 'lucide-react'
import { postAmazon } from '@/lib/amazon/client'
import { AVISO_LABELS, type MotivoAviso } from '@/lib/entrais/precios'

/**
 * EL MOTOR DE PRECIOS, EN PANTALLA.
 *
 * Dos mitades: arriba se configura qué margen se quiere ganar, abajo se ve a qué
 * precio saldría cada referencia. Y entre las dos, un botón de recalcular.
 *
 * NADA DE ESTO PUBLICA. Lo que se ve es una propuesta: qué precio tendría cada
 * SKU si se enviara. El envío es otra decisión y todavía no está tomada — y por
 * eso la pantalla no tiene ningún botón que lo insinúe.
 */

interface FilaPrecio {
  sku: string
  precio_proveedor: number | null
  canon: number | null
  coste: number | null
  tarifa_aplicada: number | null
  tarifa_estimada: boolean
  margen_aplicado: number | null
  de_donde_el_margen: string | null
  precio_objetivo: number | null
  precio: number | null
  origen: string | null
  margen_real: number | null
  pvp_actual: number | null
  dif_euros: number | null
  dif_porcentaje: number | null
  foep: number | null
  buybox: string | null
  aviso: MotivoAviso | null
  calculado_at: string
}

interface Config {
  id: string
  connection_id: string | null
  marketplace_id: string | null
  entorno: 'pruebas' | 'real'
  margen_global: number
  usar_tramos: boolean
  tramos: { desde: number; margen: number }[]
  decidir_tramo_por: 'coste' | 'pvp'
  iva_venta: number
  porte: number
  tasa_digital: number
  tarifa_por_defecto: number
  redondeo: 'centimo' | 'noventa_y_nueve' | 'cinco_centimos'
  margen_suelo: number | null
}

interface Ejecucion {
  id: string
  empezado_at: string
  terminado_at: string | null
  productos: number
  con_precio: number
  imposibles: number
  con_tarifa_real: number
  por_buybox: number
  subirian: number
  bajarian: number
  sin_cambio: number
  margen_medio: number | null
  error: string | null
}

interface Conexion {
  id: string
  name: string
  marketplace_ids: string[]
  marketplaces_activos: string[] | null
}

interface Respuesta {
  config: Config
  precios: FilaPrecio[]
  ejecuciones: Ejecucion[]
  conexiones: Conexion[]
  faltaCredencial: string | null
}

const ALTO_FILA = 30
const MARGEN_FILAS = 12
const ALTO_CAJA = 520
const REJILLA = '86px 96px 92px 84px 96px 96px 88px 92px 1fr'

function eur(v: number | null | undefined, dec = 2): string {
  if (v === null || v === undefined) return '—'
  return v.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function pct(v: number | null | undefined, dec = 1): string {
  if (v === null || v === undefined) return '—'
  return `${(v * 100).toLocaleString('es-ES', { maximumFractionDigits: dec })}%`
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

const AVISO_COLOR: Record<string, string> = {
  ok: 'text-green-300/70',
  imposible: 'text-red-300',
  precio_proveedor_cero: 'text-red-300',
  tarifa_estimada: 'text-amber-300/70',
  sin_pvp_actual: 'text-white/35',
  subida_grande: 'text-amber-300',
  puede_bajar: 'text-sky-300/80',
}

export function MotorPrecios() {
  const [datos, setDatos] = useState<Respuesta | null>(null)
  const [cargando, setCargando] = useState(true)
  const [calculando, setCalculando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<'todos' | 'cambian' | 'suben' | 'bajan' | 'problemas'>(
    'todos'
  )
  const [desde, setDesde] = useState(0)
  const caja = useRef<HTMLDivElement>(null)

  const traer = useCallback(async () => {
    const res = await postAmazon<Respuesta>('/api/entrais/motor', {})
    setCargando(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setDatos(res.data)
  }, [])

  useEffect(() => {
    void traer()
  }, [traer])

  async function recalcular() {
    if (calculando) return
    setCalculando(true)
    const res = await postAmazon<{ ms: number; resumen: { productos: number; conPrecio: number } }>(
      '/api/entrais/motor',
      { accion: 'calcular' }
    )
    setCalculando(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(
      `${res.data.resumen.conPrecio.toLocaleString('es-ES')} precios calculados de ` +
        `${res.data.resumen.productos.toLocaleString('es-ES')} productos`
    )
    void traer()
  }

  async function guardar(patch: Partial<Config>) {
    if (!datos) return
    setGuardando(true)
    const res = await postAmazon<{ config: Config }>('/api/entrais/motor', {
      accion: 'guardar',
      config: patch,
    })
    setGuardando(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setDatos({ ...datos, config: res.data.config })
    toast.success('Guardado')
  }

  const filas = useMemo(() => {
    if (!datos) return []
    const q = busca.trim().toLowerCase()
    return datos.precios.filter((p) => {
      if (q && !p.sku.toLowerCase().includes(q)) return false
      switch (filtro) {
        case 'cambian':
          return p.dif_euros !== null && Math.abs(p.dif_euros) > 0.005
        case 'suben':
          return (p.dif_euros ?? 0) > 0.005
        case 'bajan':
          return (p.dif_euros ?? 0) < -0.005
        case 'problemas':
          return p.aviso === 'imposible' || p.aviso === 'precio_proveedor_cero'
        default:
          return true
      }
    })
  }, [datos, busca, filtro])

  const cuantasCaben = Math.ceil(ALTO_CAJA / ALTO_FILA)
  const inicio = Math.max(0, desde - MARGEN_FILAS)
  const visibles = filas.slice(inicio, desde + cuantasCaben + MARGEN_FILAS)

  async function descargar() {
    const XLSX = await import('xlsx')
    const hoja = XLSX.utils.json_to_sheet(
      filas.map((p) => ({
        SKU: p.sku,
        COSTE: p.coste,
        TARIFA_PCT: p.tarifa_aplicada,
        TARIFA_REAL: p.tarifa_estimada ? 'NO' : 'SI',
        MARGEN_OBJETIVO: p.margen_aplicado,
        PRECIO_PROPUESTO: p.precio,
        MARGEN_REAL: p.margen_real,
        PVP_ACTUAL: p.pvp_actual,
        DIFERENCIA: p.dif_euros,
        FOEP: p.foep,
        BUYBOX: p.buybox,
        ORIGEN: p.origen,
        AVISO: p.aviso ? AVISO_LABELS[p.aviso] : '',
      }))
    )
    const libro = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(libro, hoja, 'Precios')
    XLSX.writeFile(libro, `entrais-precios-${new Date().toISOString().slice(0, 10)}.xlsx`)
    toast.success(`${filas.length.toLocaleString('es-ES')} filas descargadas`)
  }

  if (cargando) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-white/40 py-8">
        <Loader2 className="h-3 w-3 animate-spin" /> Leyendo el motor…
      </div>
    )
  }
  if (!datos) return null

  const cfg = datos.config
  const ultima = datos.ejecuciones[0] ?? null
  const conexion = datos.conexiones.find((c) => c.id === cfg.connection_id) ?? null
  const mercados = conexion
    ? conexion.marketplaces_activos && conexion.marketplaces_activos.length > 0
      ? conexion.marketplaces_activos
      : conexion.marketplace_ids
    : []

  return (
    <div className="space-y-3">
      {/* ---------------- La configuración ---------------- */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[10px] font-semibold text-white/45 uppercase tracking-wider">
            El motor
          </h3>
          <span className="text-[11px] text-white/30">
            precio = coste ÷ [ (1 − margen)/{(1 + cfg.iva_venta).toFixed(2)} − tarifa ×{' '}
            {(1 + cfg.tasa_digital).toFixed(2)} ]
          </span>
          <button
            type="button"
            onClick={() => void recalcular()}
            disabled={calculando}
            className="ml-auto px-3 py-1.5 rounded-full bg-[#FF6600] text-white text-[11px] font-medium flex items-center gap-1.5 disabled:opacity-50"
          >
            {calculando ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            Recalcular
          </button>
        </div>

        {datos.faltaCredencial && (
          <p className="text-[11px] text-red-300/80">{datos.faltaCredencial}</p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
          <Campo label="Cuenta de Amazon" ancho>
            <select
              value={cfg.connection_id ?? ''}
              onChange={(e) => void guardar({ connection_id: e.target.value || null })}
              className={SELECT}
            >
              <option value="">— sin elegir —</option>
              {datos.conexiones.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Campo>
          <Campo label="País">
            <select
              value={cfg.marketplace_id ?? ''}
              onChange={(e) => void guardar({ marketplace_id: e.target.value || null })}
              className={SELECT}
            >
              <option value="">—</option>
              {mercados.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Campo>
          <Campo label="Entorno de Entrais">
            <select
              value={cfg.entorno}
              onChange={(e) => void guardar({ entorno: e.target.value as 'pruebas' | 'real' })}
              className={SELECT}
            >
              <option value="pruebas">Pruebas</option>
              <option value="real">Real</option>
            </select>
          </Campo>
          <Numero
            label="Porte (€)"
            valor={cfg.porte}
            onGuardar={(v) => {
              if (v !== null) void guardar({ porte: v })
            }}
            pista="Se suma al coste de cada producto, sin IVA"
          />
          <Numero
            label="IVA de venta"
            valor={cfg.iva_venta}
            porcentaje
            onGuardar={(v) => {
              if (v !== null) void guardar({ iva_venta: v })
            }}
          />
          <Numero
            label="Tasa digital"
            valor={cfg.tasa_digital}
            porcentaje
            onGuardar={(v) => {
              if (v !== null) void guardar({ tasa_digital: v })
            }}
            pista="Se calcula SOBRE la tarifa de referencia, no sobre el precio"
          />
          <Numero
            label="Tarifa por defecto"
            valor={cfg.tarifa_por_defecto}
            porcentaje
            onGuardar={(v) => {
              if (v !== null) void guardar({ tarifa_por_defecto: v })
            }}
            pista="Para los que no están listados y no tienen tarifa real de Amazon"
          />
          <Numero
            label="Margen global"
            valor={cfg.margen_global}
            porcentaje
            onGuardar={(v) => {
              if (v !== null) void guardar({ margen_global: v })
            }}
            pista="Se usa cuando los tramos están apagados"
          />
          <Campo label="Redondeo">
            <select
              value={cfg.redondeo}
              onChange={(e) => void guardar({ redondeo: e.target.value as Config['redondeo'] })}
              className={SELECT}
            >
              <option value="centimo">Al céntimo</option>
              <option value="noventa_y_nueve">Terminar en ,99</option>
              <option value="cinco_centimos">Múltiplos de 0,05</option>
            </select>
          </Campo>
          <Numero
            label="Suelo Buy Box"
            valor={cfg.margen_suelo}
            porcentaje
            admiteVacio
            onGuardar={(v) => void guardar({ margen_suelo: v })}
            pista="Margen mínimo al que se acepta bajar para ganar la oferta destacada. Vacío = no se persigue"
          />
        </div>

        {/* ---------------- Los tramos ---------------- */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] text-white/45">Tramos de margen por coste</span>
            <button
              type="button"
              onClick={() => void guardar({ usar_tramos: !cfg.usar_tramos })}
              className={`px-2 py-0.5 rounded-full border text-[10px] transition-colors ${
                cfg.usar_tramos
                  ? 'border-[#FF6600]/60 bg-[#FF6600]/15 text-white'
                  : 'border-white/10 text-white/40'
              }`}
            >
              {cfg.usar_tramos ? 'Activados' : 'Apagados'}
            </button>
            {!cfg.usar_tramos && (
              <span className="text-[10px] text-white/30">
                Con los tramos apagados, todo el catálogo usa el margen global
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {cfg.tramos.map((t, i) => (
              <div
                key={i}
                className={`rounded-lg border px-2 py-1 ${
                  cfg.usar_tramos ? 'border-white/10' : 'border-white/[0.05] opacity-40'
                }`}
              >
                <div className="text-[10px] text-white/35">
                  {i === cfg.tramos.length - 1
                    ? `desde ${t.desde} €`
                    : `${t.desde} – ${cfg.tramos[i + 1].desde} €`}
                </div>
                <input
                  key={`${cfg.id}-${i}`}
                  defaultValue={(t.margen * 100).toString()}
                  inputMode="decimal"
                  disabled={!cfg.usar_tramos || guardando}
                  onBlur={(e) => {
                    const v = Number(e.target.value.replace(',', '.'))
                    if (!Number.isFinite(v) || v <= 0 || v >= 100) return
                    const nuevo = v / 100
                    if (Math.abs(nuevo - t.margen) < 1e-9) return
                    const tramos = cfg.tramos.map((x, j) => (j === i ? { ...x, margen: nuevo } : x))
                    void guardar({ tramos })
                  }}
                  className="w-[52px] bg-transparent text-[12px] text-white text-right tabular-nums outline-none focus:bg-white/[0.06] rounded px-1"
                />
                <span className="text-[11px] text-white/40">%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---------------- La última pasada ---------------- */}
      {ultima && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px]">
            <span className="text-[10px] uppercase tracking-wider text-white/35">
              Última pasada
            </span>
            <span className="text-white/45">{cuando(ultima.empezado_at)}</span>
            {ultima.error ? (
              <span className="text-red-300">{ultima.error}</span>
            ) : (
              <>
                <Cifra n={ultima.con_precio} de={ultima.productos} texto="con precio" />
                <Cifra n={ultima.con_tarifa_real} texto="con tarifa real de Amazon" />
                <Cifra n={ultima.subirian} texto="subirían" color="text-amber-300/80" />
                <Cifra n={ultima.bajarian} texto="bajarían" color="text-sky-300/80" />
                <Cifra n={ultima.sin_cambio} texto="igual" />
                {ultima.por_buybox > 0 && (
                  <Cifra n={ultima.por_buybox} texto="al precio de la Buy Box" color="text-green-300/80" />
                )}
                {ultima.imposibles > 0 && (
                  <Cifra n={ultima.imposibles} texto="imposibles" color="text-red-300" />
                )}
                {ultima.margen_medio !== null && (
                  <span className="text-white/60">
                    margen medio <strong className="text-white">{pct(ultima.margen_medio)}</strong>
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ---------------- La tabla ---------------- */}
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
            placeholder="Buscar por SKU"
            className="w-full h-7 rounded-lg border border-white/10 bg-white/[0.03] pl-7 pr-2 text-[11px] text-white outline-none focus:border-[#FF6600]"
          />
        </div>
        {(
          [
            ['todos', 'Todos'],
            ['cambian', 'Cambian'],
            ['suben', 'Suben'],
            ['bajan', 'Bajan'],
            ['problemas', 'Problemas'],
          ] as const
        ).map(([id, texto]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setFiltro(id)
              caja.current?.scrollTo({ top: 0 })
              setDesde(0)
            }}
            className={`px-2.5 py-1 rounded-full border text-[11px] transition-colors ${
              filtro === id
                ? 'border-[#FF6600]/60 bg-[#FF6600]/15 text-white'
                : 'border-white/10 text-white/45 hover:text-white/80'
            }`}
          >
            {texto}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void descargar()}
          disabled={filas.length === 0}
          className="h-7 px-2.5 rounded-lg border border-white/10 text-[11px] text-white/60 hover:text-white flex items-center gap-1.5 disabled:opacity-40"
        >
          <Download className="h-3 w-3" />
          Excel
        </button>
        <span className="text-[11px] text-white/40">
          {filas.length.toLocaleString('es-ES')} referencias
        </span>
      </div>

      <div className="rounded-lg border border-white/10 overflow-hidden">
        <div
          className="grid bg-white/[0.03] border-b border-white/10"
          style={{ gridTemplateColumns: REJILLA }}
        >
          {[
            ['SKU', 'El código del proveedor, que es el SKU en Amazon'],
            ['Coste', 'Proveedor + canon + porte, sin IVA'],
            ['Tarifa', 'La de Amazon. En ámbar si es estimada'],
            ['Margen', 'El objetivo que se le aplica'],
            ['Propuesto', 'El precio al que habría que publicar'],
            ['Ahora', 'Lo que está publicado hoy en Amazon'],
            ['Dif.', 'Cuánto cambiaría'],
            ['Margen real', 'El que queda con el precio ya redondeado'],
            ['Aviso', ''],
          ].map(([texto, pista], i) => (
            <span
              key={texto}
              title={pista}
              className={`px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40 ${
                i >= 1 && i <= 7 ? 'text-right' : 'text-left'
              }`}
            >
              {texto}
            </span>
          ))}
        </div>

        <div
          ref={caja}
          onScroll={(e) => setDesde(Math.floor(e.currentTarget.scrollTop / ALTO_FILA))}
          className="overflow-y-auto"
          style={{ height: ALTO_CAJA }}
        >
          {filas.length === 0 ? (
            <p className="p-4 text-[11px] text-white/35">
              {datos.precios.length === 0
                ? 'Todavía no se ha calculado nada. Dale a «Recalcular».'
                : 'Ninguna referencia encaja con el filtro.'}
            </p>
          ) : (
            <div style={{ height: filas.length * ALTO_FILA, position: 'relative' }}>
              {visibles.map((p, i) => {
                const fila = inicio + i
                return (
                  <div
                    key={p.sku}
                    className="grid items-center absolute left-0 right-0 border-b border-white/[0.04] hover:bg-white/[0.03]"
                    style={{
                      gridTemplateColumns: REJILLA,
                      top: fila * ALTO_FILA,
                      height: ALTO_FILA,
                    }}
                  >
                    <span className="px-2 text-[11px] font-mono text-white/80">{p.sku}</span>
                    <span className="px-2 text-[11px] text-right tabular-nums text-white/60">
                      {eur(p.coste)}
                    </span>
                    <span
                      className={`px-2 text-[11px] text-right tabular-nums ${
                        p.tarifa_estimada ? 'text-amber-300/70' : 'text-white/60'
                      }`}
                      title={
                        p.tarifa_estimada
                          ? 'Estimada: este producto no tiene tarifa real de Amazon'
                          : 'Tarifa real de Amazon'
                      }
                    >
                      {pct(p.tarifa_aplicada, 2)}
                    </span>
                    <span className="px-2 text-[11px] text-right tabular-nums text-white/50">
                      {pct(p.margen_aplicado, 0)}
                    </span>
                    <span
                      className={`px-2 text-[11px] text-right tabular-nums font-medium ${
                        p.origen === 'buybox' ? 'text-green-300' : 'text-white'
                      }`}
                      title={
                        p.origen === 'buybox'
                          ? 'Al precio de la Buy Box: da margen suficiente y gana la oferta destacada'
                          : undefined
                      }
                    >
                      {eur(p.precio)}
                    </span>
                    <span className="px-2 text-[11px] text-right tabular-nums text-white/45">
                      {eur(p.pvp_actual)}
                    </span>
                    <span
                      className={`px-2 text-[11px] text-right tabular-nums ${
                        p.dif_euros === null
                          ? 'text-white/20'
                          : p.dif_euros > 0.005
                            ? 'text-amber-300/80'
                            : p.dif_euros < -0.005
                              ? 'text-sky-300/80'
                              : 'text-white/30'
                      }`}
                    >
                      {p.dif_euros === null
                        ? '—'
                        : `${p.dif_euros > 0 ? '+' : ''}${eur(p.dif_euros)}`}
                    </span>
                    <span className="px-2 text-[11px] text-right tabular-nums text-white/60">
                      {pct(p.margen_real)}
                    </span>
                    <span
                      className={`px-2 text-[10.5px] truncate ${
                        AVISO_COLOR[p.aviso ?? 'ok'] ?? 'text-white/40'
                      }`}
                      title={p.aviso ? AVISO_LABELS[p.aviso] : ''}
                    >
                      {p.aviso ? AVISO_LABELS[p.aviso] : ''}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <p className="text-[10px] text-white/30">
        Esto es una propuesta: dice a qué precio habría que publicar cada referencia. No se manda
        nada a Amazon.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

const SELECT =
  'w-full h-7 rounded-lg border border-white/10 bg-white/[0.03] px-2 text-[11px] text-white outline-none focus:border-[#FF6600]'

function Campo({
  label,
  ancho,
  children,
}: {
  label: string
  ancho?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={ancho ? 'col-span-2' : ''}>
      <label className="block text-[10px] text-white/35 mb-0.5">{label}</label>
      {children}
    </div>
  )
}

/**
 * Un número que se guarda al salir del campo y solo si ha cambiado.
 *
 * Los porcentajes se enseñan en 15 y se guardan en 0,15: teclear «0.15» en una
 * casilla que pone «%» es de las cosas que se hacen mal una vez y ya no se
 * vuelven a mirar.
 */
function Numero({
  label,
  valor,
  porcentaje,
  admiteVacio,
  pista,
  onGuardar,
}: {
  label: string
  valor: number | null
  porcentaje?: boolean
  admiteVacio?: boolean
  pista?: string
  onGuardar: (v: number | null) => void
}) {
  const mostrado = valor === null ? '' : porcentaje ? String(valor * 100) : String(valor)
  return (
    <Campo label={label}>
      <div className="relative">
        <input
          key={mostrado}
          defaultValue={mostrado}
          inputMode="decimal"
          title={pista}
          placeholder={admiteVacio ? 'sin usar' : undefined}
          onBlur={(e) => {
            const texto = e.target.value.trim().replace(',', '.')
            if (texto === '') {
              if (admiteVacio && valor !== null) onGuardar(null)
              return
            }
            const n = Number(texto)
            if (!Number.isFinite(n)) return
            const nuevo = porcentaje ? n / 100 : n
            if (valor !== null && Math.abs(nuevo - valor) < 1e-9) return
            onGuardar(nuevo)
          }}
          className={`${SELECT} text-right tabular-nums ${porcentaje ? 'pr-5' : ''}`}
        />
        {porcentaje && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-white/30 pointer-events-none">
            %
          </span>
        )}
      </div>
    </Campo>
  )
}

function Cifra({
  n,
  de,
  texto,
  color = 'text-white/60',
}: {
  n: number
  de?: number
  texto: string
  color?: string
}) {
  return (
    <span className={color}>
      <strong className="text-white">{n.toLocaleString('es-ES')}</strong>
      {de !== undefined && <span className="text-white/30"> / {de.toLocaleString('es-ES')}</span>}{' '}
      {texto}
    </span>
  )
}
