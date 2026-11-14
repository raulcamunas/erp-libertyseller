'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CircleAlert, ClipboardCopy, Download, FileSearch, Filter, ListTree, RefreshCw, ScrollText, Search, X } from 'lucide-react'
import { Boton, EstadoVacio, Insignia, PanelLateral, Segmentado, TablaAdaptable, Tarjeta, haceCuanto, type Columna } from '@/components/ui-ls'
import { CAMPO, COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import type { EntradaDeLog } from '@/lib/ads/log'
import type { ProductoDeAds } from '@/lib/ads/cuenta'
import { ETIQUETA_ORIGEN, type OrigenDeLog } from '@/lib/ads/log-calculo'
import { textoParaPegar } from '@/lib/ads/log-sop'
import { llamar } from './llamar'

const TONO_ORIGEN: Record<OrigenDeLog, TonoEstado> = { automatico: 'naranja', estructura: 'violeta', manual: 'azul', ensayo: 'cian' }

const PERIODOS = [
  { id: '1', texto: 'Hoy', dias: 1 },
  { id: '7', texto: '7 días', dias: 7 },
  { id: '30', texto: '30 días', dias: 30 },
  { id: '90', texto: '90 días', dias: 90 },
  { id: 'todo', texto: 'Todo', dias: 0 },
] as const
type IdPeriodo = (typeof PERIODOS)[number]['id']

const POR_PAGINA = 50

interface Filtros {
  periodo: IdPeriodo
  desde: string
  hasta: string
  origen: '' | OrigenDeLog
  usuarioId: string
  productoId: string
  campaignId: string
  campanaNombre: string
  propuestaId: string
  soloFallos: boolean
  q: string
}

const FILTROS_INICIALES: Filtros = { periodo: '30', desde: '', hasta: '', origen: '', usuarioId: '', productoId: '', campaignId: '', campanaNombre: '', propuestaId: '', soloFallos: false, q: '' }

/** «YYYY-MM-DD» de hace `dias - 1` días (hoy incluido), en la fecha local */
const fechaDeHace = (dias: number) => {
  const d = new Date()
  d.setDate(d.getDate() - (dias - 1))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Los filtros, como parámetros de la ruta (los mismos para la lista, el CSV y «Copiar») */
function parametros(perfilId: string, f: Filtros): URLSearchParams {
  const q = new URLSearchParams({ perfilId })
  const p = PERIODOS.find((x) => x.id === f.periodo)
  const desde = f.desde || (p && p.dias > 0 ? fechaDeHace(p.dias) : '')
  if (desde) q.set('desde', desde)
  if (f.hasta) q.set('hasta', f.hasta)
  if (f.origen) q.set('origen', f.origen)
  if (f.usuarioId) q.set('usuarioId', f.usuarioId)
  if (f.productoId) q.set('productoId', f.productoId)
  if (f.campaignId) q.set('campaignId', f.campaignId)
  if (f.propuestaId) q.set('propuestaId', f.propuestaId)
  if (f.soloFallos) q.set('fallos', '1')
  if (f.q.trim()) q.set('q', f.q.trim())
  return q
}

const cuando = (iso: string) => new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * EL LOG DE CAMBIOS de la cuenta, auditable: qué se creó, se cambió, se descartó, se deshizo o se ensayó; cuándo, quién, desde qué valor y por qué; y, desde la
 * migración 311, la propuesta de la que sale, el id de lo tocado en Amazon, la petición y la respuesta de la API (código y request id).
 *
 *   · Paginación por CURSOR («Cargar más»): nada se salta ni se repite aunque entren cambios mientras se mira.
 *   · Filtros: periodo o fechas, origen, persona, producto, campaña, propuesta, solo fallos y búsqueda. Viajan igual al CSV y a «Copiar para el Log del cliente».
 *   · Cada fila abre su detalle (petición y respuesta) con enlaces a su propuesta y a su campaña.
 */
export function PestanaLog({ perfilId, irA }: { perfilId: string; irA?: (pestana: string) => void }) {
  const [f, setF] = useState<Filtros>(FILTROS_INICIALES)
  const [busqueda, setBusqueda] = useState('')
  const [entradas, setEntradas] = useState<EntradaDeLog[]>([])
  const [siguiente, setSiguiente] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [masCargando, setMasCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [personas, setPersonas] = useState<Array<{ id: string; nombre: string }>>([])
  const [productos, setProductos] = useState<Array<{ id: string; nombre: string }>>([])
  const [verFiltros, setVerFiltros] = useState(false)
  const [abierta, setAbierta] = useState<EntradaDeLog | null>(null)
  const [detalle, setDetalle] = useState<EntradaDeLog | null>(null)
  const [fuera, setFuera] = useState<Array<{ que: string; motivo: string }>>([])
  const [copiando, setCopiando] = useState(false)
  const peticion = useRef(0)

  // La búsqueda espera a que se deje de escribir (350 ms) antes de pedir
  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.q === busqueda ? x : { ...x, q: busqueda })), 350)
    return () => clearTimeout(t)
  }, [busqueda])

  const cargar = useCallback(
    async (cursor: string | null) => {
      const yo = ++peticion.current
      if (cursor) setMasCargando(true)
      else setCargando(true)
      try {
        const q = parametros(perfilId, f)
        q.set('porPagina', String(POR_PAGINA))
        if (cursor) q.set('cursor', cursor)
        const r = await llamar<{ entradas: EntradaDeLog[]; siguiente: string | null }>(`/api/ads/cuenta/log?${q.toString()}`)
        if (yo !== peticion.current) return // llegó tarde: ya se pidió otra cosa
        setEntradas((ant) => (cursor ? [...ant, ...r.entradas] : r.entradas))
        setSiguiente(r.siguiente)
        setError(null)
      } catch (e) {
        if (yo === peticion.current) setError(e instanceof Error ? e.message : 'No se ha podido cargar el log.')
      } finally {
        if (yo === peticion.current) {
          setCargando(false)
          setMasCargando(false)
        }
      }
    },
    [perfilId, f],
  )

  useEffect(() => {
    void cargar(null)
  }, [cargar])

  // Las listas de los filtros, una vez por cuenta
  useEffect(() => {
    let vivo = true
    llamar<{ personas: Array<{ id: string; nombre: string }> }>(`/api/ads/cuenta/log?perfilId=${perfilId}&personas=1`)
      .then((r) => vivo && setPersonas(r.personas))
      .catch(() => undefined)
    llamar<{ productos: ProductoDeAds[] }>(`/api/ads/cuenta/productos?perfilId=${perfilId}`)
      .then((r) => vivo && setProductos(r.productos.map((p) => ({ id: p.id, nombre: `${p.resumen || p.asin} · ${p.asin}` }))))
      .catch(() => undefined)
    return () => {
      vivo = false
    }
  }, [perfilId])

  // El detalle (petición y respuesta) se pide al abrir una fila: pesa y no hace falta en la lista
  useEffect(() => {
    setDetalle(null)
    if (!abierta) return
    let vivo = true
    llamar<{ entrada: EntradaDeLog | null }>(`/api/ads/cuenta/log?perfilId=${perfilId}&entrada=${abierta.id}`)
      .then((r) => vivo && setDetalle(r.entrada ?? abierta))
      .catch(() => vivo && setDetalle(abierta))
    return () => {
      vivo = false
    }
  }, [abierta, perfilId])

  const cambiar = (c: Partial<Filtros>) => setF((x) => ({ ...x, ...c }))
  const quitarFiltros = () => {
    setBusqueda('')
    setF(FILTROS_INICIALES)
  }
  const hayFiltros = Boolean(f.origen || f.usuarioId || f.productoId || f.campaignId || f.propuestaId || f.soloFallos || f.q || f.desde || f.hasta || f.periodo !== '30')
  const cuantosFiltros = [f.origen, f.usuarioId, f.productoId, f.soloFallos, f.desde || f.hasta].filter(Boolean).length

  /**
   * COPIAR PARA EL LOG DEL CLIENTE (el Google Sheets «Logs Marketing»): las seis columnas del SOP, de TODO el rango filtrado (lo pide al servidor, no solo lo cargado).
   * Solo lo que Amazon aceptó; lo que no encaja en el vocabulario (pausar, deshacer, ensayos, movimientos del ERP) se enseña debajo. Traducción en lib/ads/log-sop.ts.
   */
  async function copiar() {
    setCopiando(true)
    try {
      const q = parametros(perfilId, { ...f, soloFallos: false })
      q.set('formato', 'todo')
      const r = await llamar<{ entradas: EntradaDeLog[]; cortado: boolean }>(`/api/ads/cuenta/log?${q.toString()}`)
      const t = textoParaPegar(r.entradas)
      setFuera(t.fuera)
      if (t.filas === 0) {
        toast.info('No hay cambios aceptados que copiar en este periodo.')
        return
      }
      try {
        await navigator.clipboard.writeText(t.texto)
      } catch {
        toast.error('El navegador no ha dejado copiar. Prueba otra vez con la pestaña en primer plano.')
        return
      }
      toast.success(`${t.filas} ${t.filas === 1 ? 'fila copiada' : 'filas copiadas'}${r.cortado ? ' (las 5.000 más recientes: acota el periodo)' : ''}: pégalas en el Log del cliente.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido leer el log.')
    } finally {
      setCopiando(false)
    }
  }

  const urlCsv = useMemo(() => {
    const q = parametros(perfilId, f)
    q.set('formato', 'csv')
    return `/api/ads/cuenta/log?${q.toString()}`
  }, [perfilId, f])

  const columnas: Columna<EntradaDeLog>[] = useMemo(
    () => [
      {
        id: 'cuando',
        cabecera: 'Cuándo',
        ancho: '118px',
        movil: 'subtitulo',
        celda: (e) => (
          <span className="whitespace-nowrap tabular-nums text-[var(--ls-t2)]" title={new Date(e.creadoAt).toLocaleString('es-ES')}>
            {cuando(e.creadoAt)}
          </span>
        ),
      },
      {
        id: 'que',
        cabecera: 'Qué',
        movil: 'titulo',
        celda: (e) => (
          <span className="flex min-w-0 items-center gap-[6px]">
            {!e.ok && <CircleAlert className="h-[13px] w-[13px] shrink-0" style={{ color: COLOR_ESTADO.rojo }} aria-label="Fallido" />}
            <span className="truncate font-medium text-[var(--ls-t1)]" title={`${e.accion} ${e.entidad}${e.campo ? ` · ${e.campo}` : ''}`}>
              {e.accion} {e.entidad}
              {e.campo ? <span className="font-normal text-[var(--ls-t3)]"> · {e.campo}</span> : null}
            </span>
          </span>
        ),
      },
      {
        id: 'origen',
        cabecera: 'Origen',
        ancho: '150px',
        movil: 'insignia',
        celda: (e) => (
          <Insignia tono={TONO_ORIGEN[e.origen] ?? 'gris'} tamano="sm">
            {ETIQUETA_ORIGEN[e.origen] ?? e.origen}
          </Insignia>
        ),
      },
      {
        id: 'cambio',
        cabecera: 'Antes → después',
        movil: 'dato',
        rotuloMovil: 'Cambio',
        celda: (e) =>
          e.valorAnterior || e.valorNuevo ? (
            <span className="block max-w-[280px] truncate tabular-nums" title={`${e.valorAnterior ?? '—'} → ${e.valorNuevo ?? '—'}`}>
              <span className="text-[var(--ls-t3)]">{e.valorAnterior ?? '—'}</span> → <span className="text-[var(--ls-t1)]">{e.valorNuevo ?? '—'}</span>
            </span>
          ) : (
            <span className="text-[var(--ls-t4)]">—</span>
          ),
      },
      {
        id: 'campana',
        cabecera: 'Campaña',
        movil: 'dato',
        celda: (e) => (
          <span className="block max-w-[260px] truncate text-[var(--ls-t2)]" title={e.nombreCampana ?? ''}>
            {e.nombreCampana ?? '—'}
          </span>
        ),
      },
      {
        id: 'quien',
        cabecera: 'Quién',
        ancho: '130px',
        movil: 'dato',
        celda: (e) => <span className="truncate text-[var(--ls-t2)]">{e.usuario ?? (e.origen === 'automatico' ? 'Motor' : '—')}</span>,
      },
      {
        id: 'resultado',
        cabecera: 'Resultado',
        ancho: '120px',
        movil: 'insignia',
        celda: (e) => (
          <Insignia tono={e.ok ? 'verde' : 'rojo'} tamano="sm" variante="contorno">
            {e.ok ? 'Aceptado' : 'Fallido'}
            {e.httpStatus ? ` · ${e.httpStatus}` : ''}
          </Insignia>
        ),
      },
    ],
    [],
  )

  return (
    <div className="flex flex-col gap-4 pb-8">
      {/* ---- la barra: periodo, búsqueda y acciones ---- */}
      <Tarjeta acento="marketing" cuerpoClassName="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="ls-sin-barra -mx-1 max-w-full overflow-x-auto px-1">
            <Segmentado etiqueta="Periodo" tamano="sm" opciones={PERIODOS.map((p) => ({ id: p.id, texto: p.texto }))} valor={f.periodo} onCambio={(v) => cambiar({ periodo: v, desde: '', hasta: '' })} />
          </div>
          <label className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-[var(--ls-t4)]" aria-hidden />
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar término, campaña, motivo, error…" className={`${CAMPO.input} min-h-[36px] w-full pl-9 text-[13.5px] [@media(pointer:coarse)]:min-h-[44px]`} aria-label="Buscar en el log" />
          </label>
          <Boton variante={verFiltros || cuantosFiltros > 0 ? 'secundario' : 'fantasma'} tamano="sm" icono={Filter} onClick={() => setVerFiltros((v) => !v)} aria-expanded={verFiltros}>
            Filtros{cuantosFiltros > 0 ? ` (${cuantosFiltros})` : ''}
          </Boton>
          <Boton variante="fantasma" tamano="sm" icono={RefreshCw} soloIcono aria-label="Actualizar" onClick={() => void cargar(null)} />
        </div>

        {verFiltros && (
          <div className="grid gap-3 border-t border-[var(--ls-linea)] pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <Campo etiqueta="Origen">
              <select value={f.origen} onChange={(e) => cambiar({ origen: e.target.value as Filtros['origen'] })} className={SELECT}>
                <option value="">Todos</option>
                {(Object.keys(ETIQUETA_ORIGEN) as OrigenDeLog[]).map((o) => (
                  <option key={o} value={o}>
                    {ETIQUETA_ORIGEN[o]}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Persona">
              <select value={f.usuarioId} onChange={(e) => cambiar({ usuarioId: e.target.value })} className={SELECT}>
                <option value="">Cualquiera</option>
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Producto">
              <select value={f.productoId} onChange={(e) => cambiar({ productoId: e.target.value })} className={SELECT}>
                <option value="">Todos</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <div className="grid grid-cols-2 gap-2">
              <Campo etiqueta="Desde">
                <input type="date" value={f.desde} onChange={(e) => cambiar({ desde: e.target.value })} className={SELECT} />
              </Campo>
              <Campo etiqueta="Hasta">
                <input type="date" value={f.hasta} onChange={(e) => cambiar({ hasta: e.target.value })} className={SELECT} />
              </Campo>
            </div>
            <label className="inline-flex min-h-[36px] cursor-pointer items-center gap-2 text-[13px] text-[var(--ls-t2)] [@media(pointer:coarse)]:min-h-[44px]">
              <input type="checkbox" checked={f.soloFallos} onChange={(e) => cambiar({ soloFallos: e.target.checked })} className="h-4 w-4 accent-[var(--ls-acc)]" />
              Solo lo que falló
            </label>
          </div>
        )}

        {/* Los filtros puestos desde una fila (campaña, propuesta), como pastillas que se quitan */}
        {hayFiltros && (
          <div className="flex flex-wrap items-center gap-2">
            {f.campaignId && <Pastilla texto={`Campaña: ${f.campanaNombre || f.campaignId}`} quitar={() => cambiar({ campaignId: '', campanaNombre: '' })} />}
            {f.propuestaId && <Pastilla texto="Una propuesta" quitar={() => cambiar({ propuestaId: '' })} />}
            <button type="button" className="min-h-[32px] text-[12.5px] text-[var(--ls-t3)] underline underline-offset-2 hover:text-[var(--ls-t1)]" onClick={quitarFiltros}>
              Quitar todos los filtros
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--ls-linea)] pt-3">
          <Boton variante="primario" tamano="sm" icono={ClipboardCopy} cargando={copiando} onClick={() => void copiar()} title="Copia los cambios aceptados del periodo con las seis columnas del Log del SOP, para pegarlos en el Google Sheets del cliente">
            Copiar para el Log del cliente
          </Boton>
          <Boton variante="secundario" tamano="sm" icono={Download} asChild>
            <a href={urlCsv} download>
              Exportar CSV
            </a>
          </Boton>
          <span className="ml-auto text-[12px] text-[var(--ls-t4)]">{cargando ? 'Cargando…' : `${entradas.length}${siguiente ? '+' : ''} ${entradas.length === 1 ? 'entrada' : 'entradas'}`}</span>
        </div>
      </Tarjeta>

      {fuera.length > 0 && (
        <p className="rounded-[12px] border px-4 py-3 text-[12.5px] leading-[1.5] text-[var(--ls-t2)]" style={{ borderColor: 'color-mix(in srgb, var(--ls-e-ambar) 40%, transparent)', background: 'color-mix(in srgb, var(--ls-e-ambar) 8%, transparent)' }}>
          <strong style={{ color: COLOR_ESTADO.ambar }}>
            {fuera.length} {fuera.length === 1 ? 'cambio no se ha copiado' : 'cambios no se han copiado'}
          </strong>{' '}
          porque no encajan en el vocabulario del Log del SOP (o no tocaron Amazon): apúntalos a mano si hace falta. {fuera.slice(0, 4).map((x) => `${x.que} (${x.motivo})`).join(' · ')}
          {fuera.length > 4 ? ' …' : ''}
        </p>
      )}

      {error ? (
        <EstadoVacio icono={CircleAlert} titulo="No se ha podido cargar el log" descripcion={error} accion={{ texto: 'Reintentar', onClick: () => void cargar(null) }} />
      ) : (
        <TablaAdaptable
          etiqueta="Log de cambios"
          columnas={columnas}
          filas={entradas}
          claveDe={(e) => e.id}
          cargando={cargando}
          porPagina={0}
          alPulsarFila={setAbierta}
          filaActiva={abierta?.id ?? null}
          vacio={{
            icono: ScrollText,
            acento: 'marketing',
            titulo: hayFiltros ? 'Nada con estos filtros' : 'Todavía no hay ningún cambio registrado',
            descripcion: hayFiltros ? 'Prueba con otro periodo o quita algún filtro.' : 'Aquí aparece cada campaña que se crea, cada propuesta que se aplica, descarta, deshace o ensaya, y cada cambio a mano.',
            accion: hayFiltros ? { texto: 'Quitar filtros', onClick: quitarFiltros } : undefined,
          }}
        />
      )}

      {siguiente && !error && (
        <div className="flex justify-center">
          <Boton variante="secundario" cargando={masCargando} onClick={() => void cargar(siguiente)}>
            Cargar {POR_PAGINA} más
          </Boton>
        </div>
      )}

      {/* ---- el detalle de una entrada ---- */}
      <PanelLateral
        abierto={abierta !== null}
        onCambio={(a) => !a && setAbierta(null)}
        icono={FileSearch}
        acento="marketing"
        titulo={abierta ? `${abierta.accion} ${abierta.entidad}` : ''}
        descripcion={abierta ? `${new Date(abierta.creadoAt).toLocaleString('es-ES')} · ${haceCuanto(abierta.creadoAt)}` : undefined}
        ancho={560}
        pie={
          abierta && (abierta.propuestaId || abierta.campaignId) ? (
            <div className="flex flex-wrap gap-2">
              {abierta.propuestaId && (
                <Boton
                  variante="secundario"
                  tamano="sm"
                  icono={Filter}
                  onClick={() => {
                    cambiar({ propuestaId: abierta.propuestaId ?? '', periodo: 'todo', desde: '', hasta: '' })
                    setAbierta(null)
                  }}
                >
                  Historia de la propuesta
                </Boton>
              )}
              {abierta.campaignId && (
                <Boton
                  variante="secundario"
                  tamano="sm"
                  icono={Filter}
                  onClick={() => {
                    cambiar({ campaignId: abierta.campaignId ?? '', campanaNombre: abierta.nombreCampana ?? '' })
                    setAbierta(null)
                  }}
                >
                  Solo esta campaña
                </Boton>
              )}
              {abierta.campaignId && irA && (
                <Boton variante="fantasma" tamano="sm" icono={ListTree} onClick={() => irA('campanas')}>
                  Ir a Campañas
                </Boton>
              )}
            </div>
          ) : undefined
        }
      >
        {abierta && <DetalleDeEntrada e={detalle ?? abierta} cargando={detalle === null} />}
      </PanelLateral>
    </div>
  )
}

const SELECT = `${CAMPO.input} min-h-[36px] w-full text-[13.5px] [@media(pointer:coarse)]:min-h-[44px]`

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11.5px] font-medium text-[var(--ls-t3)]">{etiqueta}</span>
      {children}
    </label>
  )
}

function Pastilla({ texto, quitar }: { texto: string; quitar: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--ls-acc-borde)] bg-[var(--ls-acc-relleno)] py-[3px] pl-3 pr-1 text-[12px] text-[var(--ls-acc-tinta)]">
      <span className="truncate">{texto}</span>
      <button type="button" onClick={quitar} aria-label={`Quitar «${texto}»`} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--ls-sup2)]">
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}

function DetalleDeEntrada({ e, cargando }: { e: EntradaDeLog; cargando: boolean }) {
  const filas: Array<[string, React.ReactNode]> = [
    ['Origen', ETIQUETA_ORIGEN[e.origen] ?? e.origen],
    ['Quién', e.usuario ?? (e.origen === 'automatico' ? 'Motor (autopiloto)' : '—')],
    ['Campaña', e.nombreCampana ?? '—'],
    ['ID de campaña', e.campaignId ?? '—'],
    ['ID en Amazon', e.entidadId ?? '—'],
    ['Campo', e.campo ?? '—'],
    ['Antes', e.valorAnterior ?? '—'],
    ['Después', e.valorNuevo ?? '—'],
    ['Motivo', e.motivo ?? '—'],
    ['Resultado', e.ok ? 'Aceptado' : 'Fallido'],
    ['HTTP', e.httpStatus ?? '—'],
    ['Request ID', e.requestId ?? '—'],
  ]
  return (
    <div className="flex flex-col gap-4 text-[13px]">
      {!e.ok && e.error && (
        <p className="rounded-[10px] px-3 py-2 leading-[1.5]" style={{ background: 'color-mix(in srgb, var(--ls-e-rojo) 10%, transparent)', color: COLOR_ESTADO.rojo }}>
          {e.error}
        </p>
      )}
      <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2">
        {filas.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[12px] text-[var(--ls-t4)]">{k}</dt>
            <dd className="min-w-0 break-words text-[var(--ls-t1)]">{v}</dd>
          </div>
        ))}
      </dl>
      <Bloque titulo="Petición a Amazon" valor={e.peticion} cargando={cargando} />
      <Bloque titulo="Respuesta de Amazon" valor={e.respuesta} cargando={cargando} />
    </div>
  )
}

function Bloque({ titulo, valor, cargando }: { titulo: string; valor: unknown; cargando: boolean }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--ls-t4)]">{titulo}</div>
      {cargando ? (
        <div className="h-16 animate-pulse rounded-[10px] bg-[var(--ls-sup2)] motion-reduce:animate-none" />
      ) : valor == null ? (
        <p className="text-[12.5px] text-[var(--ls-t4)]">Sin datos (entradas anteriores a la migración 311, o un cambio que no llamó a Amazon).</p>
      ) : (
        <pre className="max-h-[260px] overflow-auto rounded-[10px] bg-[var(--ls-sup2)] px-3 py-2 font-mono text-[11.5px] leading-[1.5] text-[var(--ls-t2)]">{JSON.stringify(valor, null, 2)}</pre>
      )}
    </div>
  )
}
