'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Ban, Download, Loader2, Play, Search, Send, ShieldCheck, Upload } from 'lucide-react'
import { postAmazon } from '@/lib/amazon/client'
import { marketplaceLabel } from '@/lib/types/amazon'
import { leerTarifa } from '@/lib/entrais/tarifa'
import {
  AVISO_LABELS,
  type MotivoAviso,
  type MotivoBuybox,
} from '@/lib/entrais/precios'

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
  margen_en_foep: number | null
  motivo_buybox: MotivoBuybox | null
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
  publicar_automatico: boolean
  publicar_cada_minutos: number
  publicar_max_salto_pct: number | null
  publicar_max_por_pasada: number
  publicado_at: string | null
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
  bloqueados: number | null
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

interface ReglaPorte {
  id: string
  orden: number
  nombre: string
  tipo: 'subfamilia' | 'familia' | 'sku' | 'defecto'
  patron: string | null
  importe: number
  iva_incluido: boolean
  activa: boolean
  nota: string | null
}

interface Bloqueado {
  sku: string
  motivo: 'envio_directo' | 'a_mano'
  nombre: string | null
  familia: string | null
  precio_proveedor: number | null
  tarifa_fecha: string | null
  nota: string | null
}

interface Respuesta {
  config: Config
  portes: ReglaPorte[]
  precios: FilaPrecio[]
  ejecuciones: Ejecucion[]
  bloqueados: Bloqueado[]
  conexiones: Conexion[]
  faltaCredencial: string | null
}

const ALTO_FILA = 30
const MARGEN_FILAS = 12
const ALTO_CAJA = 520
/**
 * Diez columnas. Eran doce: se han ido las tres del FOEP —el precio, el margen
 * ahí y «¿se baja?»— y ha entrado una de Buy Box.
 *
 * No es por sitio, es porque el FOEP no se pide ya. De 1.446 referencias donde
 * la tiene otro, en 1.351 bajar a ese precio era VENDER PERDIENDO, y de las 25
 * que dejaban un 5 % o más, en trece ya estábamos por debajo. Doce productos de
 * 6.913, a cambio de tres horas de API cada pasada.
 *
 * Quién tiene la Buy Box sí se sigue leyendo —esa fase es barata— y es lo que
 * dice dónde se están perdiendo ventas.
 */
const REJILLA = '82px 84px 76px 68px 90px 84px 78px 78px 96px 1fr'

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

/** Se escribe corto porque la columna es estrecha y se lee de un vistazo */
const BUYBOX_LABELS: Record<string, string> = {
  nuestra: 'Nuestra',
  de_otro: 'De otro',
  nadie: 'Sin competencia',
  desconocido: '—',
}

const AVISO_COLOR: Record<string, string> = {
  ok: 'text-green-300/70',
  no_vender: 'text-red-400 font-semibold',
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
  const [filtro, setFiltro] = useState<
    'todos' | 'cambian' | 'suben' | 'bajan' | 'problemas' | 'sin_buybox' | 'bloqueados'
  >('todos')
  const [cargandoTarifa, setCargandoTarifa] = useState(false)
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
    const res = await postAmazon<{
      ms: number
      resumen: { productos: number; conPrecio: number; bloqueados: number; retirados: number }
    }>('/api/entrais/motor', { accion: 'calcular' })
    setCalculando(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    const r = res.data.resumen
    toast.success(
      `${r.conPrecio.toLocaleString('es-ES')} precios calculados de ` +
        `${r.productos.toLocaleString('es-ES')} productos` +
        (r.bloqueados > 0 ? ` · ${r.bloqueados} sin precio por envío directo` : '') +
        // Se dice porque es un BORRADO. Que la tabla adelgace de golpe sin
        // explicación es lo que hace dudar de si ha fallado algo.
        (r.retirados > 0 ? ` · ${r.retirados} retirados del catálogo` : '')
    )
    void traer()
  }

  /**
   * EL FICHERO SE LEE AQUÍ Y SE MANDA LO QUE QUEDA.
   *
   * Veinte megas, y de sus veinticinco columnas hacen falta cuatro. Subirlo
   * entero para tirar el 99 % es pedirle a un proxy que lo deje pasar, y ahí es
   * donde mueren estas cosas: en un límite de tamaño que nadie recuerda haber
   * puesto y que da un error que no menciona el tamaño.
   *
   * Se descodifica como windows-1252 porque así lo manda el proveedor. Leído
   * como UTF-8 no falla —sale «GARANTÍA» roto— y eso no se nota hasta que
   * alguien mira la lista dentro de tres semanas.
   */
  async function cargarTarifa(fichero: File) {
    setCargandoTarifa(true)
    try {
      const texto = new TextDecoder('windows-1252').decode(await fichero.arrayBuffer())
      const filasTarifa = leerTarifa(texto)
      const marcados = filasTarifa.filter((f) => f.envioDirecto)

      const res = await postAmazon<{
        carga: { leidos: number; marcados: number; nuevos: string[]; desbloqueados: string[] }
      }>('/api/entrais/motor', {
        accion: 'tarifa',
        marcados,
        leidos: filasTarifa.length,
        // Del nombre del fichero: «tarifa_008262 - 2026-08-05T121718.690.csv».
        // Es la fecha del proveedor, que es la que importa, no la de hoy.
        fecha: /(\d{4}-\d{2}-\d{2})/.exec(fichero.name)?.[1] ?? null,
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      const c = res.data.carga
      toast.success(
        `${c.marcados} artículos de envío directo sobre ${c.leidos.toLocaleString('es-ES')}` +
          (c.nuevos.length > 0 ? ` · ${c.nuevos.length} nuevos` : '') +
          (c.desbloqueados.length > 0 ? ` · ${c.desbloqueados.length} desbloqueados` : '')
      )
      void traer()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se ha podido leer el fichero')
    } finally {
      setCargandoTarifa(false)
    }
  }

  async function guardarPorte(id: string, patch: { importe?: number; activa?: boolean }) {
    const res = await postAmazon('/api/entrais/motor', { accion: 'porte', regla: { id, ...patch } })
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Regla guardada')
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
        case 'sin_buybox':
          return p.buybox === 'de_otro'
        case 'bloqueados':
          return p.origen === 'bloqueado'
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
        BUYBOX: p.buybox,
        ORIGEN: p.origen,
        NO_VENDER: p.origen === 'bloqueado' ? 'SI' : '',
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
                  {marketplaceLabel(m)}
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
          {/* AQUÍ HABÍA UN «SUELO BUY BOX» Y SE HA QUITADO.
              Servía para decir hasta qué margen se aceptaba bajar para ganar la
              oferta destacada, y para eso hace falta el FOEP — que ya no se
              pide. Dejar la casilla habría sido peor que quitarla: se podría
              rellenar, se guardaría, y no pasaría nada. */}
        </div>
        <p className="text-[10px] leading-relaxed text-white/25">
          El precio sale <strong className="text-white/45">solo del margen</strong>. No se persigue
          la oferta destacada: de 1.446 referencias donde la tiene otro, en 1.351 bajar a su precio
          era vender perdiendo, y de las 25 que dejaban un 5 % o más, en trece ya estábamos por
          debajo. Se sigue leyendo QUIÉN la tiene, que es la columna Buy Box de la tabla.
        </p>

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
                  defaultValue={String(Math.round(t.margen * 1e8) / 1e6)}
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

      {/* ---------------- El porte ---------------- */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-[10px] font-semibold text-white/45 uppercase tracking-wider">
            El porte
          </h3>
          <span className="text-[11px] text-white/30">
            La primera regla que encaja manda. Se busca por la subfamilia del proveedor, no por el
            nombre del producto
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
          {datos.portes.map((r) => (
            <div
              key={r.id}
              className={`rounded-lg border px-2 py-1.5 flex items-start gap-2 ${
                r.activa ? 'border-white/[0.08] bg-white/[0.02]' : 'border-white/[0.04] opacity-40'
              }`}
            >
              <button
                type="button"
                onClick={() => void guardarPorte(r.id, { activa: !r.activa })}
                title={r.activa ? 'Desactivar esta regla' : 'Activar esta regla'}
                className={`mt-0.5 h-3.5 w-3.5 rounded flex-shrink-0 border ${
                  r.activa ? 'bg-[#FF6600] border-[#FF6600]' : 'border-white/25'
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[12px] text-white/85 truncate">{r.nombre}</span>
                  <span className="text-[10px] text-white/25 truncate">
                    {r.tipo === 'defecto' ? 'todo lo demás' : `${r.tipo}: ${r.patron}`}
                  </span>
                </div>
                {r.nota && <p className="text-[10px] text-white/30 leading-snug mt-0.5">{r.nota}</p>}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <input
                  key={`${r.id}-${r.importe}`}
                  defaultValue={String(r.importe)}
                  inputMode="decimal"
                  onBlur={(e) => {
                    const v = Number(e.target.value.replace(',', '.'))
                    if (!Number.isFinite(v) || v < 0 || Math.abs(v - r.importe) < 1e-9) return
                    void guardarPorte(r.id, { importe: v })
                  }}
                  className="w-[54px] h-6 rounded border border-white/10 bg-white/[0.03] px-1 text-[12px] text-white text-right tabular-nums outline-none focus:border-[#FF6600]"
                />
                {/* CON IVA O SIN IVA, SIEMPRE A LA VISTA.
                    Es la diferencia entre 35 € y 28,93 € de coste real, y sin
                    verlo dos importes de la misma columna significan cosas
                    distintas. */}
                <span
                  className={`text-[10px] w-[52px] ${
                    r.iva_incluido ? 'text-amber-300/70' : 'text-white/30'
                  }`}
                  title={
                    r.iva_incluido
                      ? `Lleva IVA: se le quita antes de sumarlo. Coste real ${(r.importe / (1 + cfg.iva_venta)).toFixed(2)} €`
                      : 'Sin IVA, se suma tal cual'
                  }
                >
                  {r.iva_incluido ? '€ c/IVA' : '€ s/IVA'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ---------------- Los que no se pueden vender ---------------- */}
      <BloqueLosQueNo
        bloqueados={datos.bloqueados}
        cargando={cargandoTarifa}
        onFichero={(f) => void cargarTarifa(f)}
        onVerlos={() => {
          setFiltro('bloqueados')
          setBusca('')
          caja.current?.scrollTo({ top: 0 })
          setDesde(0)
        }}
      />

      {/* ---------------- Publicar ---------------- */}
      <PublicarPrecios cfg={cfg} guardar={guardar} onHecho={() => void traer()} />

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
                {(ultima.bloqueados ?? 0) > 0 && (
                  <Cifra n={ultima.bloqueados!} texto="no vender" color="text-red-400" />
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
            ['sin_buybox', 'Buy Box perdida'],
            ['bloqueados', 'No vender'],
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
            ['Buy Box', 'Quién tiene hoy la oferta destacada de este listing'],
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
                    {/* QUIÉN TIENE LA BUY BOX. Sustituye a las tres columnas del
                        FOEP: aquélla decía a qué precio se ganaría —que casi
                        siempre era perdiendo dinero—, ésta dice dónde se están
                        perdiendo ventas, que es lo accionable. */}
                    <span
                      className={`px-2 text-[10.5px] truncate ${
                        p.buybox === 'nuestra'
                          ? 'text-green-300/80'
                          : p.buybox === 'de_otro'
                            ? 'text-amber-300/80'
                            : 'text-white/25'
                      }`}
                      title={BUYBOX_LABELS[p.buybox ?? 'desconocido'] ?? ''}
                    >
                      {BUYBOX_LABELS[p.buybox ?? 'desconocido'] ?? '—'}
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
  /**
   * `0.07 * 100` da 7.000000000000001 en coma flotante, y eso salía tal cual en
   * una casilla. En una pantalla que va de números, un decimal imposible hace
   * dudar de todos los demás. Se recorta a seis decimales, que es más precisión
   * de la que ningún margen necesita.
   */
  const mostrado =
    valor === null ? '' : String(porcentaje ? Math.round(valor * 1e8) / 1e6 : valor)
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

/* ------------------------------------------------------------------ */
/* Los que no se pueden vender                                         */
/* ------------------------------------------------------------------ */

/**
 * ENVÍO DIRECTO: el proveedor no los manda desde su almacén, los manda el
 * fabricante. No se pueden vender en Amazon, así que salen con stock 0 y sin
 * precio propuesto.
 *
 * ESTA CAJA SE ENSEÑA SIEMPRE, INCLUSO CON LA LISTA VACÍA, y es lo único que hay
 * que respetar al tocarla. «Ninguno bloqueado» y «nadie ha cargado nunca la
 * tarifa» se ven igual en una pantalla que oculta la sección cuando no hay nada,
 * y significan cosas opuestas: la primera es que todo está en orden, la segunda
 * es que el freno no existe.
 *
 * Es la misma confusión que costó una tarde con el FOEP —«no consultado» leído
 * como «Amazon no contesta»— y aquí sale más cara: un portátil de mil euros
 * vendido y sin forma de enviarlo.
 */
function BloqueLosQueNo({
  bloqueados,
  cargando,
  onFichero,
  onVerlos,
}: {
  bloqueados: Bloqueado[]
  cargando: boolean
  onFichero: (f: File) => void
  onVerlos: () => void
}) {
  const entrada = useRef<HTMLInputElement>(null)
  const vacia = bloqueados.length === 0
  const fecha = bloqueados.find((b) => b.tarifa_fecha)?.tarifa_fecha ?? null
  const total = bloqueados.reduce((a, b) => a + (b.precio_proveedor ?? 0), 0)

  // Cuántos hay de cada familia, de mayor a menor. Un «51 bloqueados» no dice
  // nada; «26 portátiles y 11 garantías» se entiende sin abrir la lista.
  const porFamilia = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of bloqueados) m.set(b.familia || '—', (m.get(b.familia || '—') ?? 0) + 1)
    return [...m].sort((a, b) => b[1] - a[1])
  }, [bloqueados])

  return (
    <div
      className={`rounded-xl border p-3 space-y-2 ${
        vacia ? 'border-amber-400/30 bg-amber-400/[0.04]' : 'border-white/10 bg-white/[0.02]'
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/45">
          <Ban className="h-3 w-3" />
          No se pueden vender
        </h3>
        {vacia ? (
          <span className="text-[11px] text-amber-300">
            La lista está vacía: no se está bloqueando nada.
          </span>
        ) : (
          <>
            <span className="text-[12px] text-white">
              <strong>{bloqueados.length}</strong> artículos de envío directo
            </span>
            <span className="text-[11px] text-white/35">
              {eur(total, 0)} € de coste de proveedor entre todos
            </span>
            {fecha && <span className="text-[11px] text-white/30">tarifa del {fecha}</span>}
          </>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-white/40">
        Los manda el fabricante, no salen del almacén del proveedor. Salen a{' '}
        <strong className="text-white/70">stock 0</strong> en el ciclo y{' '}
        <strong className="text-white/70">sin precio</strong> aquí.{' '}
        {/* Lo importante de este párrafo es la segunda mitad. Sin ella, la
            pantalla parece decir que el ERP sabe solo cuáles son. */}
        La marca <code className="text-white/60">ENVIO_DIRECTO</code> NO viene en la API del
        proveedor —su Swagger no la declara—, solo en el CSV de tarifa que mandan por correo. Hay
        que cargarlo aquí cada vez que llegue uno nuevo: mientras no se haga, esta lista no sabe de
        los artículos dados de alta después.
      </p>

      {!vacia && (
        <div className="flex flex-wrap gap-1.5">
          {porFamilia.map(([familia, n]) => (
            <span
              key={familia}
              className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-white/50"
            >
              {familia} <strong className="text-white/80">{n}</strong>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={entrada}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            // Se limpia para que elegir DOS VECES el mismo fichero vuelva a
            // disparar el change. Sin esto, corregir la tarifa y recargarla con
            // el mismo nombre no hace nada y parece que la pantalla se ha colgado.
            e.target.value = ''
            if (f) onFichero(f)
          }}
        />
        <button
          type="button"
          onClick={() => entrada.current?.click()}
          disabled={cargando}
          className="h-7 flex items-center gap-1.5 rounded-lg border border-[#FF6600]/50 bg-[#FF6600]/10 px-2.5 text-[11px] text-white transition-colors hover:bg-[#FF6600]/20 disabled:opacity-40"
        >
          {cargando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          Cargar tarifa del proveedor
        </button>
        {!vacia && (
          <button
            type="button"
            onClick={onVerlos}
            className="h-7 rounded-lg border border-white/10 px-2.5 text-[11px] text-white/60 transition-colors hover:text-white"
          >
            Ver los {bloqueados.length} en la tabla
          </button>
        )}
        <span className="text-[10px] text-white/25">
          El CSV que manda el proveedor, tal cual: «tarifa_008262 - …csv»
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Publicar en Amazon                                                  */
/* ------------------------------------------------------------------ */

interface FilaPublicable {
  sku: string
  precio: number
  pvpActual: number
  difEuros: number
  difPorcentaje: number | null
  tarifaEstimada: boolean
}

interface Candidatas {
  filas: FilaPublicable[]
  porTramo: number
  resumen: { total: number; suben: number; bajan: number; conTarifaEstimada: number }
}

interface ResultadoEnvio {
  simulado: boolean
  batchId: string | null
  aceptados: number
  fallidos: number
  resultados: { sku: string; status: string; message: string | null }[]
  abortReason: string | null
}

/**
 * EL ÚNICO SITIO DEL MOTOR QUE TOCA LA TIENDA DEL CLIENTE.
 *
 * Todo lo demás calcula y guarda. Esto manda, y el precio que un comprador ve
 * cambia. La pantalla está escrita alrededor de esa diferencia:
 *
 *   · HAY QUE SIMULAR ANTES. El botón de enviar no existe hasta que hay un
 *     simulacro hecho, y desaparece en cuanto cambia la lista. No es un paso de
 *     más: `validateOnly` le pregunta a Amazon si aceptaría cada dato sin
 *     aplicarlo, así que convierte «creo que están bien» en la lista de los que
 *     va a rechazar — antes, y gratis.
 *
 *   · LOS MAYORES SALTOS SE VEN SIN BUSCARLOS. La lista llega ordenada por
 *     diferencia, así que lo primero que se lee es lo que más cambia. Revisar
 *     dos mil filas no puede depender de que alguien tenga la paciencia de bajar
 *     hasta el final.
 *
 *   · NO HAY FRENOS AUTOMÁTICOS, y es una decisión tomada: ni tope de salto ni
 *     tope de cantidad. El freno es que hay alguien delante. Por eso esta
 *     pantalla no tiene ningún camino que envíe sin pasar por el simulacro, y
 *     por eso el día que esto se automatice harán falta los frenos que hoy no
 *     están.
 */
function PublicarPrecios({
  cfg,
  guardar,
  onHecho,
}: {
  cfg: Config
  guardar: (patch: Partial<Config>) => Promise<void>
  onHecho: () => void
}) {
  const [datos, setDatos] = useState<Candidatas | null>(null)
  const [cargando, setCargando] = useState(false)
  const [trabajando, setTrabajando] = useState<'simular' | 'enviar' | null>(null)
  const [progreso, setProgreso] = useState<{ hechos: number; total: number } | null>(null)
  const [simulacro, setSimulacro] = useState<ResultadoEnvio | null>(null)
  const [envio, setEnvio] = useState<ResultadoEnvio | null>(null)

  const traer = useCallback(async () => {
    setCargando(true)
    const res = await postAmazon<Candidatas>('/api/entrais/publicar', {})
    setCargando(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setDatos(res.data)
    // Un simulacro de otra lista no vale para ésta. Se tira, y con él el botón
    // de enviar: si no, se podría simular, recalcular y enviar otra cosa.
    setSimulacro(null)
    setEnvio(null)
  }, [])

  async function correr(accion: 'simular' | 'enviar') {
    if (!datos || datos.filas.length === 0) return
    setTrabajando(accion)
    setProgreso({ hechos: 0, total: datos.filas.length })

    const acumulado: ResultadoEnvio = {
      simulado: accion === 'simular',
      batchId: null,
      aceptados: 0,
      fallidos: 0,
      resultados: [],
      abortReason: null,
    }

    // En tramos, y con el mismo batchId en todos: es lo que hace que las filas
    // que salieron juntas se reconozcan juntas en el registro. El primero lo
    // genera el servidor y los siguientes lo reciben.
    for (let i = 0; i < datos.filas.length; i += datos.porTramo) {
      const tramo = datos.filas.slice(i, i + datos.porTramo)
      const res = await postAmazon<ResultadoEnvio>('/api/entrais/publicar', {
        accion,
        skus: tramo.map((f) => f.sku),
        batchId: acumulado.batchId,
      })
      if (!res.ok) {
        toast.error(res.error, { duration: 10_000 })
        break
      }
      acumulado.batchId = res.data.batchId ?? acumulado.batchId
      acumulado.aceptados += res.data.aceptados
      acumulado.fallidos += res.data.fallidos
      acumulado.resultados.push(...res.data.resultados.filter((r) => r.status !== 'aceptado'))
      setProgreso({ hechos: Math.min(i + tramo.length, datos.filas.length), total: datos.filas.length })

      /**
       * Si Amazon dice que la conexión no vale, se para el lote entero.
       *
       * Seguir mandando los tramos que quedan solo consigue repetir el mismo
       * error una vez por referencia, y enterrar el motivo real debajo.
       */
      if (res.data.abortReason) {
        acumulado.abortReason = res.data.abortReason
        break
      }
    }

    setTrabajando(null)
    setProgreso(null)
    if (accion === 'simular') {
      setSimulacro(acumulado)
      toast[acumulado.fallidos > 0 ? 'warning' : 'success'](
        `Simulacro: Amazon aceptaría ${acumulado.aceptados} y rechazaría ${acumulado.fallidos}. No se ha cambiado nada.`
      )
    } else {
      setEnvio(acumulado)
      toast.success(`${acumulado.aceptados} precios enviados a Amazon.`)
      onHecho()
    }
  }

  return (
    <div className="rounded-xl border border-[#FF6600]/25 bg-[#FF6600]/[0.03] p-3 space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/45">
          <Send className="h-3 w-3" />
          Publicar en Amazon
        </h3>
        <span className="text-[11px] text-amber-300/80">
          Esto SÍ cambia los precios de la tienda del cliente.
        </span>
      </div>

      {/* ---------------- Que lo haga solo ----------------
          VA AQUÍ ARRIBA Y NO DENTRO DEL DESPLEGABLE.

          Estaba metido detrás de «Ver qué se publicaría», que es lo que se pulsa
          para MIRAR un resultado. Esto no es un resultado: es el interruptor que
          decide si el ERP toca los precios de la tienda de un cliente sin que
          nadie mire. Un ajuste que solo aparece si antes pulsas otra cosa es un
          ajuste que nadie encuentra — y de hecho no se encontró. */}
      <div className="rounded-lg border border-white/10 bg-black/20 p-2.5 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void guardar({ publicar_automatico: !cfg.publicar_automatico })}
            className={`h-7 rounded-lg border px-2.5 text-[11px] transition-colors ${
              cfg.publicar_automatico
                ? 'border-[#FF6600]/60 bg-[#FF6600]/15 text-white'
                : 'border-white/10 text-white/45 hover:text-white'
            }`}
          >
            {cfg.publicar_automatico ? 'Publica solo' : 'Publicar a mano'}
          </button>

          {cfg.publicar_automatico && (
            <>
              <label className="flex items-center gap-1.5 text-[11px] text-white/45">
                cada
                <input
                  key={`m-${cfg.publicar_cada_minutos}`}
                  defaultValue={
                    cfg.publicar_cada_minutos === 0 ? '' : String(cfg.publicar_cada_minutos)
                  }
                  inputMode="numeric"
                  placeholder="pasada"
                  onBlur={(e) => {
                    const t = e.target.value.trim()
                    if (t === '') {
                      void guardar({ publicar_cada_minutos: 0 })
                      return
                    }
                    const v = Math.round(Number(t))
                    if (Number.isFinite(v) && v >= 0 && v <= 10080)
                      void guardar({ publicar_cada_minutos: v })
                  }}
                  className="w-[58px] rounded bg-white/[0.06] px-1 py-0.5 text-right text-white tabular-nums outline-none placeholder:text-white/25"
                />
                {cfg.publicar_cada_minutos === 0 ? 'del sincronismo' : 'minutos'}
              </label>

              <label className="flex items-center gap-1.5 text-[11px] text-white/45">
                · no mandar si cambia más de
                <input
                  key={`s-${cfg.publicar_max_salto_pct}`}
                  defaultValue={
                    cfg.publicar_max_salto_pct === null
                      ? ''
                      : String(Math.round(cfg.publicar_max_salto_pct * 100))
                  }
                  inputMode="numeric"
                  placeholder="sin tope"
                  onBlur={(e) => {
                    const t = e.target.value.trim()
                    if (t === '') {
                      void guardar({ publicar_max_salto_pct: null })
                      return
                    }
                    const v = Number(t) / 100
                    if (Number.isFinite(v) && v > 0 && v <= 5)
                      void guardar({ publicar_max_salto_pct: v })
                  }}
                  className="w-[46px] rounded bg-white/[0.06] px-1 py-0.5 text-right text-white tabular-nums outline-none placeholder:text-white/20"
                />
                %
              </label>

              {cfg.publicado_at && (
                <span className="text-[10px] text-white/25">
                  última vez {cuando(cfg.publicado_at)}
                </span>
              )}
            </>
          )}
        </div>

        <p className="text-[10.5px] leading-relaxed text-white/35">
          {cfg.publicar_automatico ? (
            <>
              En cada pasada del sincronismo se recalcula el catálogo entero y se mandan a Amazon
              los precios que hayan cambiado. Vacío en el primer campo = al ritmo del stock, que es
              donde vive la cadencia; un número lo desacopla.{' '}
              {cfg.publicar_max_salto_pct === null ? (
                <>Sin tope de salto: se manda lo que salga del cálculo.</>
              ) : (
                <>
                  Los que se pasen del tope no se mandan y salen en la cola de incidencias —{' '}
                  <strong>vacía el campo</strong> si no lo quieres. Está puesto porque en automático
                  no hay nadie mirando el simulacro, que era el freno del botón de abajo.
                </>
              )}
            </>
          ) : (
            <>
              Enciéndelo y cada pasada del sincronismo recalculará el catálogo entero y publicará
              solo las que hayan cambiado, sin que nadie pulse. No se mandan las que ya están a su precio: reescribir en Amazon el mismo número
              seis mil veces cada media hora agota la cuota de la cuenta y no cambia nada.
            </>
          )}
        </p>
      </div>

      {!datos ? (
        <button
          type="button"
          onClick={() => void traer()}
          disabled={cargando}
          className="h-7 flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-[11px] text-white/70 hover:text-white disabled:opacity-40"
        >
          {cargando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
          Ver qué se publicaría
        </button>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px]">
            <span className="text-white">
              <strong>{datos.resumen.total.toLocaleString('es-ES')}</strong> referencias cambiarían
              de precio
            </span>
            <Cifra n={datos.resumen.suben} texto="suben" color="text-amber-300/80" />
            <Cifra n={datos.resumen.bajan} texto="bajan" color="text-sky-300/80" />
            {datos.resumen.conTarifaEstimada > 0 && (
              <Cifra
                n={datos.resumen.conTarifaEstimada}
                texto="con tarifa estimada"
                color="text-amber-300/60"
              />
            )}
          </div>

          {datos.filas.length > 0 && (
            <div className="rounded-lg border border-white/[0.07] bg-black/20 p-2">
              <p className="mb-1 text-[10px] uppercase tracking-wider text-white/30">
                Los diez saltos más grandes
              </p>
              <div className="space-y-0.5">
                {datos.filas.slice(0, 10).map((f) => (
                  <div key={f.sku} className="flex items-baseline gap-2 text-[11px] tabular-nums">
                    <span className="w-[70px] font-mono text-white/70">{f.sku}</span>
                    <span className="w-[70px] text-right text-white/35">{eur(f.pvpActual)}</span>
                    <span className="text-white/25">→</span>
                    <span className="w-[70px] text-right font-medium text-white">
                      {eur(f.precio)}
                    </span>
                    <span
                      className={`w-[80px] text-right ${
                        f.difEuros > 0 ? 'text-amber-300/80' : 'text-sky-300/80'
                      }`}
                    >
                      {f.difEuros > 0 ? '+' : ''}
                      {eur(f.difEuros)}
                      {f.difPorcentaje !== null && ` (${pct(f.difPorcentaje, 0)})`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {progreso && (
            <div className="text-[11px] text-white/50">
              {progreso.hechos.toLocaleString('es-ES')} de {progreso.total.toLocaleString('es-ES')}
              <div className="mt-1 h-1 rounded-full bg-white/[0.06]">
                <div
                  className="h-1 rounded-full bg-[#FF6600] transition-all"
                  style={{ width: `${(progreso.hechos / Math.max(1, progreso.total)) * 100}%` }}
                />
              </div>
            </div>
          )}

          {simulacro && !envio && (
            <div className="rounded-lg border border-white/10 bg-black/20 p-2 text-[11px]">
              <p className="text-white/70">
                Simulacro: Amazon aceptaría{' '}
                <strong className="text-green-300">{simulacro.aceptados}</strong> y rechazaría{' '}
                <strong className={simulacro.fallidos > 0 ? 'text-red-300' : 'text-white/40'}>
                  {simulacro.fallidos}
                </strong>
                . No se ha cambiado nada todavía.
              </p>
              {simulacro.resultados.slice(0, 6).map((r) => (
                <p key={r.sku} className="mt-0.5 text-[10.5px] text-red-300/70">
                  <span className="font-mono">{r.sku}</span> · {r.message ?? r.status}
                </p>
              ))}
            </div>
          )}

          {envio && (
            <div className="rounded-lg border border-green-400/20 bg-green-400/[0.05] p-2 text-[11px]">
              <p className="text-white">
                Enviados: <strong className="text-green-300">{envio.aceptados}</strong> aceptados,{' '}
                <strong className={envio.fallidos > 0 ? 'text-red-300' : 'text-white/40'}>
                  {envio.fallidos}
                </strong>{' '}
                fallidos.
              </p>
              <p className="mt-0.5 text-[10px] text-white/35">
                Amazon tarda un rato en aplicarlos. Queda todo en el registro de envíos con su
                valor anterior.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void correr('simular')}
              disabled={trabajando !== null || datos.filas.length === 0}
              className="h-7 flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-[11px] text-white/70 hover:text-white disabled:opacity-40"
            >
              {trabajando === 'simular' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ShieldCheck className="h-3 w-3" />
              )}
              Simular
            </button>

            {/* EL BOTÓN DE ENVIAR SOLO EXISTE DESPUÉS DE UN SIMULACRO.
                No está deshabilitado: no está. Un botón gris invita a buscar
                cómo activarlo; uno que aparece cuando toca enseña el orden. */}
            {simulacro && !envio && (
              <button
                type="button"
                onClick={() => void correr('enviar')}
                disabled={trabajando !== null || simulacro.aceptados === 0}
                className="h-7 flex items-center gap-1.5 rounded-lg border border-[#FF6600]/60 bg-[#FF6600]/20 px-2.5 text-[11px] text-white hover:bg-[#FF6600]/30 disabled:opacity-40"
              >
                {trabajando === 'enviar' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                Enviar {simulacro.aceptados} precios a Amazon
              </button>
            )}

            <button
              type="button"
              onClick={() => void traer()}
              disabled={trabajando !== null || cargando}
              className="h-7 rounded-lg border border-white/10 px-2.5 text-[11px] text-white/45 hover:text-white disabled:opacity-40"
            >
              Volver a mirar
            </button>
          </div>
        </>
      )}
    </div>
  )
}
