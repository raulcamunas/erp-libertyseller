'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Search, Store, Upload } from 'lucide-react'
import { BOTON, CAMPO, COLOR_ESTADO, TIPO } from '@/lib/estilo/denso'
import { FRASE_DE_CONFIRMACION } from '@/lib/pccomponentes/frase'
import type { CuentaPcc, ImportacionPcc, OfertaPcc, ProductoPcc } from '@/lib/pccomponentes/datos'
import { cx } from '@/components/remesas/comun/ui'

/**
 * ENTRAIS · PCCOMPONENTES: EL PANEL DE SU TIENDA.
 *
 *   OFERTAS     todo lo que la tienda tiene publicado hoy: producto, EAN, precio, stock y si está activa. Se lee de PcComponentes cada vez que se abre.
 *   PROBAR      busca un producto del proveedor, comprueba si existe en el catálogo de PcComponentes y sube UNA oferta de prueba, con una frase de
 *               confirmación y siguiendo la importación hasta que termina. La cantidad empieza en 0: una oferta sin stock no se puede comprar.
 *   COBERTURA   de los productos del proveedor con EAN, cuántos existen ya en PcComponentes: es el número que dice cuánto catálogo se puede publicar.
 *
 * Nada de aquí cambia la tienda salvo «Subir la oferta», y solo si se escribe la frase de confirmación. La clave de API no llega a esta pantalla.
 */

export type EstadoDelPanel =
  | { tipo: 'ok'; cuenta: CuentaPcc; ofertas: OfertaPcc[]; total: number; leidoAt: string; servidor: string }
  | { tipo: 'sin_clave'; mensaje: string }
  | { tipo: 'error'; mensaje: string }

type Pestana = 'ofertas' | 'probar' | 'cobertura'

const euros = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`)
const POR_PAGINA = 50

async function pedir<T>(url: string, init?: RequestInit): Promise<{ ok: true; datos: T } | { ok: false; error: string }> {
  try {
    const r = await fetch(url, init)
    const d = (await r.json().catch(() => ({}))) as { error?: string; message?: string } & T
    if (!r.ok) return { ok: false, error: d.error ?? d.message ?? `Error ${r.status}` }
    return { ok: true, datos: d }
  } catch {
    return { ok: false, error: 'No se ha podido conectar con el servidor' }
  }
}

export function PanelPccomponentes({ estado }: { estado: EstadoDelPanel }) {
  const router = useRouter()
  const [pestana, setPestana] = useState<Pestana>('ofertas')

  return (
    <div className="fba-cockpit flex min-h-[calc(100vh-4rem)] flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pb-2 pt-[10px]">
        <Store className="h-4 w-4 text-[var(--ls-acc)]" />
        <h1 className={cx(TIPO.xl, 'text-[var(--ls-t1)]')}>Entrais · PcComponentes</h1>
        {estado.tipo === 'ok' && (
          <span className="inline-flex items-center gap-[6px] rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-2 py-[2px] text-[11.5px] text-[var(--ls-t2)]">
            <span className="h-[7px] w-[7px] rounded-full" style={{ background: estado.cuenta.estado === 'OPEN' ? COLOR_ESTADO.verde : COLOR_ESTADO.ambar }} />
            Conectada · {estado.cuenta.nombre} ({estado.cuenta.estado === 'OPEN' ? 'abierta' : estado.cuenta.estado.toLowerCase()})
          </span>
        )}
        <nav aria-label="Vistas" className="flex items-center gap-[2px] rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-[3px]">
          {(
            [
              ['ofertas', 'Ofertas'],
              ['probar', 'Probar un producto'],
              ['cobertura', 'Cobertura del catálogo'],
            ] as const
          ).map(([id, rotulo]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPestana(id)}
              aria-current={pestana === id}
              className={cx('inline-flex h-6 items-center rounded-[6px] px-[10px] text-[12px] font-medium', pestana === id ? 'bg-[var(--ls-sup)] text-[var(--ls-t1)] shadow-sm' : 'text-[var(--ls-t3)] hover:text-[var(--ls-t1)]')}
            >
              {rotulo}
            </button>
          ))}
        </nav>
        <button type="button" onClick={() => router.refresh()} className={cx(BOTON.base, BOTON.alto, BOTON.secundario, 'ml-auto')} title="Vuelve a leer la tienda de PcComponentes">
          <RefreshCw className="h-3 w-3" />
          Actualizar
        </button>
      </header>

      {estado.tipo !== 'ok' ? (
        <div className="px-5 pb-6">
          <Aviso tono="rojo">{estado.mensaje}</Aviso>
          {estado.tipo === 'sin_clave' && <p className="mt-2 text-[12px] text-[var(--ls-t3)]">Se pone en las variables de entorno del servidor (Easypanel) y se reinicia la aplicación.</p>}
        </div>
      ) : (
        <>
          <Cifras cuenta={estado.cuenta} total={estado.total} leidoAt={estado.leidoAt} />
          <div className="px-5 pb-8">
            {pestana === 'ofertas' && <TablaDeOfertas ofertas={estado.ofertas} total={estado.total} />}
            {pestana === 'probar' && <ProbarUnProducto ofertas={estado.ofertas} onSubido={() => router.refresh()} />}
            {pestana === 'cobertura' && <Cobertura />}
          </div>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

function Aviso({ tono, children }: { tono: 'rojo' | 'ambar' | 'verde' | 'gris'; children: React.ReactNode }) {
  return (
    <div className="flex gap-[7px] rounded-[6px] border border-[var(--ls-linea2)] border-l-2 bg-[var(--ls-sup2)] px-[9px] py-[7px] text-[12px] leading-[1.5] text-[var(--ls-t2)]" style={{ borderLeftColor: COLOR_ESTADO[tono] }}>
      <AlertTriangle className="mt-[2px] h-[13px] w-[13px] shrink-0" style={{ color: COLOR_ESTADO[tono] }} />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  )
}

function Cifras({ cuenta, total, leidoAt }: { cuenta: CuentaPcc; total: number; leidoAt: string }) {
  const celdas: Array<[string, string]> = [
    ['Ofertas publicadas', total.toLocaleString('es-ES')],
    ['Pedidos hechos', cuenta.pedidos.toLocaleString('es-ES')],
    ['Valoración', cuenta.valoracion === null ? '—' : `${cuenta.valoracion.toLocaleString('es-ES')} / 5`],
    ['Aprobación de ofertas', cuenta.tasaAprobacion === null ? '—' : `${Math.round(cuenta.tasaAprobacion * 100)} %`],
    ['Canales', cuenta.canales.map((c) => c.replace('WEB_', '')).join(' · ') || '—'],
    ['Leído', new Date(leidoAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })],
  ]
  return (
    <div className="flex flex-wrap gap-2 px-5 pb-3">
      {celdas.map(([k, v]) => (
        <div key={k} className="rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-[6px]">
          <div className="text-[10.5px] uppercase tracking-wide text-[var(--ls-t4)]">{k}</div>
          <div className="text-[14px] font-semibold tabular-nums text-[var(--ls-t1)]">{v}</div>
        </div>
      ))}
      {cuenta.envios.length > 0 && (
        <div className="min-w-[220px] flex-1 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-[6px]">
          <div className="text-[10.5px] uppercase tracking-wide text-[var(--ls-t4)]">Envíos configurados</div>
          <ul className="text-[11.5px] text-[var(--ls-t2)]">
            {cuenta.envios.map((e, i) => (
              <li key={i}>
                {e.zona} · {e.tipo}
                {e.gratisDesde !== null ? ` · gratis desde ${euros(e.gratisDesde)}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Ofertas                                                             */
/* ------------------------------------------------------------------ */

type Filtro = 'todas' | 'activas' | 'inactivas' | 'sin_stock'

function TablaDeOfertas({ ofertas, total }: { ofertas: OfertaPcc[]; total: number }) {
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [pagina, setPagina] = useState(0)

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return ofertas.filter((o) => {
      if (filtro === 'activas' && !o.activa) return false
      if (filtro === 'inactivas' && o.activa) return false
      if (filtro === 'sin_stock' && o.cantidad > 0) return false
      return q === '' || [o.sku, o.titulo, o.ean ?? '', o.mpn ?? '', o.marca ?? '', o.productoId ?? ''].some((t) => t.toLowerCase().includes(q))
    })
  }, [ofertas, busqueda, filtro])
  const paginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA))
  const actual = Math.min(pagina, paginas - 1)
  const trozo = visibles.slice(actual * POR_PAGINA, (actual + 1) * POR_PAGINA)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-[7px] h-3 w-3 text-[var(--ls-t4)]" />
          <input value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setPagina(0) }} placeholder="Buscar por SKU, producto, EAN o marca" className={cx(CAMPO.input, 'w-[300px] pl-7')} />
        </div>
        {(['todas', 'activas', 'inactivas', 'sin_stock'] as const).map((f) => (
          <button key={f} type="button" onClick={() => { setFiltro(f); setPagina(0) }} aria-pressed={filtro === f} className={cx(BOTON.chip, filtro === f && '!border-[var(--ls-acc-borde)] !bg-[var(--ls-sup3)] !text-[var(--ls-t1)]')}>
            {{ todas: 'Todas', activas: 'Activas', inactivas: 'Inactivas', sin_stock: 'Sin stock' }[f]}
          </button>
        ))}
        <span className="ml-auto text-[11.5px] text-[var(--ls-t4)]">
          {visibles.length.toLocaleString('es-ES')} de {total.toLocaleString('es-ES')}
          {ofertas.length < total ? ` (se han leído ${ofertas.length.toLocaleString('es-ES')})` : ''}
        </span>
      </div>

      {ofertas.length === 0 ? (
        <div className="rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-6 py-10 text-center text-[12.5px] text-[var(--ls-t3)]">La tienda no tiene ninguna oferta publicada.</div>
      ) : (
        <div className="overflow-x-auto rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
          <table className="w-full min-w-[980px] text-left text-[12.5px]">
            <thead className="bg-[var(--ls-sup2)] text-[11px] font-semibold text-[var(--ls-t4)]">
              <tr>
                {['SKU', 'Producto', 'EAN', 'Precio', 'Stock', 'Estado', 'Categoría', 'IVA / canon'].map((c, i) => (
                  <th key={c} className={cx('px-3 py-[6px]', (i === 3 || i === 4) && 'text-right')}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ls-linea)]">
              {trozo.map((o) => (
                <tr key={`${o.ofertaId}-${o.sku}`} className="hover:bg-[var(--ls-sup2)]">
                  <td className="px-3 py-[6px] font-mono text-[11.5px] text-[var(--ls-t2)]">{o.sku}</td>
                  <td className="max-w-[360px] px-3 py-[6px]">
                    <div className="truncate text-[var(--ls-t1)]" title={o.titulo}>{o.titulo || '—'}</div>
                    <div className="truncate text-[11px] text-[var(--ls-t4)]">{[o.marca, o.mpn].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="px-3 py-[6px] font-mono text-[11.5px] text-[var(--ls-t3)]">{o.ean ?? '—'}</td>
                  <td className="px-3 py-[6px] text-right tabular-nums text-[var(--ls-t1)]">{euros(o.precio)}</td>
                  <td className={cx('px-3 py-[6px] text-right tabular-nums', o.cantidad === 0 ? 'text-[var(--ls-t4)]' : 'text-[var(--ls-t1)]')}>{o.cantidad.toLocaleString('es-ES')}</td>
                  <td className="px-3 py-[6px]">
                    <span className="inline-flex items-center gap-[5px] text-[11.5px] text-[var(--ls-t2)]" title={o.motivosInactiva.join(', ')}>
                      <span className="h-[7px] w-[7px] rounded-full" style={{ background: o.activa ? COLOR_ESTADO.verde : COLOR_ESTADO.gris }} />
                      {o.activa ? 'Activa' : 'Inactiva'}
                    </span>
                  </td>
                  <td className="px-3 py-[6px] text-[11.5px] text-[var(--ls-t3)]">{o.categoria ?? '—'}</td>
                  <td className="px-3 py-[6px] text-[11.5px] tabular-nums text-[var(--ls-t3)]">{o.adicionales['tipo-iva'] ?? '—'} % · {o.adicionales.canon ?? '0'} €</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {paginas > 1 && (
        <div className="flex items-center justify-end gap-2 text-[12px] text-[var(--ls-t3)]">
          <button type="button" disabled={actual === 0} onClick={() => setPagina(actual - 1)} className={cx(BOTON.base, BOTON.secundario)}>Anterior</button>
          <span className="tabular-nums">{actual + 1} / {paginas}</span>
          <button type="button" disabled={actual >= paginas - 1} onClick={() => setPagina(actual + 1)} className={cx(BOTON.base, BOTON.secundario)}>Siguiente</button>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Probar un producto                                                  */
/* ------------------------------------------------------------------ */

interface ResultadoProveedor {
  codigo: string
  descripcion: string
  marca: string | null
  ean: string | null
  mpn: string | null
  coste: number
  canon: number
  stock: number
  digital: boolean
}
interface RespuestaCatalogo {
  ean: string
  enCatalogo: ProductoPcc | null
  nuestraOferta: OfertaPcc | null
}

function ProbarUnProducto({ ofertas, onSubido }: { ofertas: OfertaPcc[]; onSubido: () => void }) {
  const [consulta, setConsulta] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [resultados, setResultados] = useState<ResultadoProveedor[] | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [elegido, setElegido] = useState<ResultadoProveedor | null>(null)

  const [sku, setSku] = useState('')
  const [ean, setEan] = useState('')
  const [precio, setPrecio] = useState('')
  const [cantidad, setCantidad] = useState('0')
  const [plazo, setPlazo] = useState('0')
  const [canon, setCanon] = useState('0')
  const [iva, setIva] = useState('21')

  const [comprobando, setComprobando] = useState(false)
  const [catalogo, setCatalogo] = useState<RespuestaCatalogo | null>(null)
  const [frase, setFrase] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const [importacion, setImportacion] = useState<{ datos: ImportacionPcc; errores: string } | null>(null)
  const [importacionId, setImportacionId] = useState<string | null>(null)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (temporizador.current) clearTimeout(temporizador.current) }, [])

  async function buscar() {
    setBuscando(true)
    setAviso(null)
    const r = await pedir<{ resultados: ResultadoProveedor[]; deCache: boolean; edadMin: number; llamadasQueQuedan: number | null }>(`/api/pccomponentes?accion=proveedor&q=${encodeURIComponent(consulta)}`)
    setBuscando(false)
    if (!r.ok) {
      setResultados(null)
      setAviso(r.error)
      return
    }
    setResultados(r.datos.resultados)
    setAviso(
      r.datos.deCache
        ? `Datos del proveedor de hace ${r.datos.edadMin} min (no se ha gastado ninguna llamada).`
        : `Se ha consultado al proveedor ahora${r.datos.llamadasQueQuedan !== null ? `; quedan ${r.datos.llamadasQueQuedan} llamadas esta hora` : ''}.`
    )
  }

  function elegir(p: ResultadoProveedor) {
    setElegido(p)
    setSku(p.codigo)
    setEan(p.ean ?? '')
    setCanon(String(p.canon ?? 0))
    setCatalogo(null)
    setFrase('')
    setImportacion(null)
    setImportacionId(null)
  }

  async function comprobar() {
    setComprobando(true)
    const r = await pedir<RespuestaCatalogo>(`/api/pccomponentes?accion=producto&ean=${encodeURIComponent(ean)}`)
    setComprobando(false)
    if (!r.ok) {
      toast.error(r.error)
      setCatalogo(null)
      return
    }
    setCatalogo(r.datos)
    if (r.datos.enCatalogo && precio === '' && r.datos.enCatalogo.precioMinimo !== null) setPrecio(String(r.datos.enCatalogo.precioMinimo))
  }

  const seguirImportacion = useCallback(async (id: string, intento = 0) => {
    const r = await pedir<{ importacion: ImportacionPcc; errores: string }>(`/api/pccomponentes?accion=importacion&id=${id}`)
    if (!r.ok) {
      toast.error(r.error)
      return
    }
    setImportacion({ datos: r.datos.importacion, errores: r.datos.errores })
    if (!r.datos.importacion.terminada && intento < 40) temporizador.current = setTimeout(() => void seguirImportacion(id, intento + 1), 4000)
  }, [])

  async function subir() {
    setSubiendo(true)
    const r = await pedir<{ importacionId: string }>('/api/pccomponentes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        confirmacion: frase,
        ofertas: [{ sku, ean, precio: Number(precio.replace(',', '.')), cantidad: Number(cantidad), plazoEnvioDias: Number(plazo), canon: Number(canon.replace(',', '.')), tipoIva: Number(iva) }],
      }),
    })
    setSubiendo(false)
    if (!r.ok) {
      toast.error(r.error)
      return
    }
    toast.success('Oferta enviada a PcComponentes. Siguiendo la importación…')
    setFrase('')
    setImportacionId(r.datos.importacionId)
    setImportacion(null)
    void seguirImportacion(r.datos.importacionId)
    onSubido()
  }

  const yaOfertado = catalogo?.nuestraOferta ?? ofertas.find((o) => o.ean === ean) ?? null
  const puedeSubir = sku.trim() !== '' && ean !== '' && Number(precio.replace(',', '.')) > 0 && frase === FRASE_DE_CONFIRMACION && !subiendo && catalogo !== null && catalogo.enCatalogo !== null

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      {/* ---------- 1 · el producto, desde el proveedor ---------- */}
      <section className="rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3">
        <h2 className={cx(TIPO.l, 'mb-1 text-[var(--ls-t1)]')}>1 · Elige un producto del proveedor</h2>
        <p className="mb-2 text-[11.5px] text-[var(--ls-t3)]">Busca por código, EAN, referencia del fabricante o parte del nombre (mínimo 3 letras). O salta este paso y escribe el EAN a mano.</p>
        <div className="flex gap-2">
          <input value={consulta} onChange={(e) => setConsulta(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && consulta.trim().length >= 3 && void buscar()} placeholder="Ej.: X670E, 4719331848774…" className={CAMPO.input} />
          <button type="button" disabled={buscando || consulta.trim().length < 3} onClick={buscar} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}>
            {buscando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
            Buscar
          </button>
        </div>
        {aviso && <p className="mt-2 text-[11.5px] text-[var(--ls-t4)]">{aviso}</p>}
        {resultados && resultados.length === 0 && <p className="mt-2 text-[12px] text-[var(--ls-t3)]">No hay ningún producto con eso.</p>}
        {resultados && resultados.length > 0 && (
          <ul className="mt-2 max-h-[320px] divide-y divide-[var(--ls-linea)] overflow-auto rounded-[6px] border border-[var(--ls-linea)]">
            {resultados.map((p) => (
              <li key={p.codigo}>
                <button type="button" onClick={() => elegir(p)} className={cx('w-full px-2 py-[6px] text-left hover:bg-[var(--ls-sup2)]', elegido?.codigo === p.codigo && 'bg-[var(--ls-sel)]')}>
                  <div className="truncate text-[12.5px] text-[var(--ls-t1)]">{p.descripcion}</div>
                  <div className="text-[11px] text-[var(--ls-t4)]">
                    {p.codigo} · {p.ean ?? 'sin EAN'} · coste {euros(p.coste)} · stock {p.stock}
                    {p.digital ? ' · digital' : ''}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------- 2 y 3 · la oferta ---------- */}
      <section className="space-y-3 rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3">
        <h2 className={cx(TIPO.l, 'text-[var(--ls-t1)]')}>2 · La oferta</h2>
        <div className={CAMPO.rejilla}>
          <Campo etiqueta="SKU (código del proveedor)"><input value={sku} onChange={(e) => setSku(e.target.value)} className={CAMPO.input} /></Campo>
          <Campo etiqueta="EAN"><input value={ean} onChange={(e) => { setEan(e.target.value.trim()); setCatalogo(null) }} className={cx(CAMPO.input, 'font-mono')} /></Campo>
          <Campo etiqueta="Precio de venta (€)"><input value={precio} onChange={(e) => setPrecio(e.target.value)} inputMode="decimal" className={cx(CAMPO.input, CAMPO.numero)} /></Campo>
          <Campo etiqueta="Cantidad (0 = no se puede comprar)"><input value={cantidad} onChange={(e) => setCantidad(e.target.value)} inputMode="numeric" className={cx(CAMPO.input, CAMPO.numero)} /></Campo>
          <Campo etiqueta="Plazo de envío (días)"><input value={plazo} onChange={(e) => setPlazo(e.target.value)} inputMode="numeric" className={cx(CAMPO.input, CAMPO.numero)} /></Campo>
          <Campo etiqueta="Canon (€)"><input value={canon} onChange={(e) => setCanon(e.target.value)} inputMode="decimal" className={cx(CAMPO.input, CAMPO.numero)} /></Campo>
          <Campo etiqueta="IVA (%)"><input value={iva} onChange={(e) => setIva(e.target.value)} inputMode="numeric" className={cx(CAMPO.input, CAMPO.numero)} /></Campo>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={comprobando || ean === ''} onClick={comprobar} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}>
            {comprobando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
            Comprobar en el catálogo de PcComponentes
          </button>
        </div>

        {catalogo && (
          catalogo.enCatalogo ? (
            <div className="rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-2 text-[12px] text-[var(--ls-t2)]">
              <div className="flex items-center gap-[6px] font-medium text-[var(--ls-t1)]"><CheckCircle2 className="h-[13px] w-[13px]" style={{ color: COLOR_ESTADO.verde }} />Existe en PcComponentes</div>
              <div>{catalogo.enCatalogo.titulo} · producto {catalogo.enCatalogo.productoId}</div>
              <div className="text-[11.5px] text-[var(--ls-t3)]">{catalogo.enCatalogo.ofertas} tienda{catalogo.enCatalogo.ofertas === 1 ? '' : 's'} lo vende{catalogo.enCatalogo.ofertas === 1 ? '' : 'n'}{catalogo.enCatalogo.precioMinimo !== null ? ` · precio más bajo ${euros(catalogo.enCatalogo.precioMinimo)}` : ''}</div>
            </div>
          ) : (
            <Aviso tono="ambar">Ese EAN NO está en el catálogo de PcComponentes: no se puede ofertar sobre él. Habría que pedirles que den de alta el producto.</Aviso>
          )
        )}
        {yaOfertado && <Aviso tono="ambar">La tienda YA tiene una oferta de este producto ({yaOfertado.sku}, {euros(yaOfertado.precio)}, {yaOfertado.cantidad} uds). Subir otra con el mismo SKU la sustituye por completo.</Aviso>}

        <h2 className={cx(TIPO.l, 'pt-1 text-[var(--ls-t1)]')}>3 · Subirla</h2>
        <Aviso tono="ambar">
          Esto publica una oferta en la tienda real de Entrais. {Number(cantidad) > 0 ? 'Con cantidad mayor que 0 la podrá comprar cualquiera.' : 'Con cantidad 0 no se puede comprar: sirve para probar la subida sin riesgo.'} Para confirmarlo, escribe{' '}
          <b className="font-mono">{FRASE_DE_CONFIRMACION}</b>.
        </Aviso>
        <div className="flex flex-wrap items-center gap-2">
          <input value={frase} onChange={(e) => setFrase(e.target.value)} placeholder={FRASE_DE_CONFIRMACION} className={cx(CAMPO.input, 'max-w-[300px] font-mono')} />
          <button type="button" disabled={!puedeSubir} onClick={subir} className={cx(BOTON.base, BOTON.alto, BOTON.primario)} title={catalogo === null ? 'Primero comprueba el producto en el catálogo' : undefined}>
            {subiendo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            Subir la oferta
          </button>
        </div>

        {importacionId && (
          <div className="rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-2 text-[12px] text-[var(--ls-t2)]">
            <div className="font-medium text-[var(--ls-t1)]">Importación {importacionId}</div>
            {!importacion ? (
              <div className="flex items-center gap-[6px] text-[var(--ls-t3)]"><Loader2 className="h-3 w-3 animate-spin" />Esperando a PcComponentes…</div>
            ) : (
              <>
                <div>
                  Estado: <b>{importacion.datos.estado}</b>
                  {!importacion.datos.terminada && <span className="ml-2 inline-flex items-center gap-1 text-[var(--ls-t3)]"><Loader2 className="h-3 w-3 animate-spin" />procesando</span>}
                </div>
                <div className="tabular-nums text-[11.5px] text-[var(--ls-t3)]">
                  {importacion.datos.lineasLeidas} línea(s) leída(s) · {importacion.datos.lineasCorrectas} correcta(s) · {importacion.datos.lineasConError} con error · {importacion.datos.ofertasCreadas} creada(s) · {importacion.datos.ofertasActualizadas} actualizada(s)
                </div>
                {importacion.datos.motivo && <div className="text-[11.5px] text-[var(--ls-t3)]">{importacion.datos.motivo}</div>}
                {importacion.errores && <pre className="mt-1 max-h-[180px] overflow-auto whitespace-pre-wrap rounded-[4px] bg-[var(--ls-fondo)] p-2 text-[11px] text-[var(--ls-t2)]">{importacion.errores}</pre>}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className={CAMPO.contenedor}>
      <span className={CAMPO.etiqueta}>{etiqueta}</span>
      {children}
    </label>
  )
}

/* ------------------------------------------------------------------ */
/* Cobertura                                                           */
/* ------------------------------------------------------------------ */

interface RespuestaCobertura {
  productosDelProveedor: number
  sinEan: number
  candidatos: number
  desde: number
  mirados: number
  existenEnPcc: number
  siguiente: number | null
  ejemplos: Array<ResultadoProveedor & { pcc: ProductoPcc }>
  llamadasQueQuedan: number | null
}

function Cobertura() {
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tandas, setTandas] = useState<RespuestaCobertura[]>([])

  async function medir(desde: number) {
    setCargando(true)
    setError(null)
    const r = await pedir<RespuestaCobertura>(`/api/pccomponentes?accion=cobertura&desde=${desde}&max=300`)
    setCargando(false)
    if (!r.ok) return setError(r.error)
    setTandas((t) => (desde === 0 ? [r.datos] : [...t, r.datos]))
  }

  const mirados = tandas.reduce((s, t) => s + t.mirados, 0)
  const existen = tandas.reduce((s, t) => s + t.existenEnPcc, 0)
  const ultima = tandas[tandas.length - 1]
  const ejemplos = tandas.flatMap((t) => t.ejemplos).slice(0, 60)

  return (
    <div className="space-y-3">
      <p className="max-w-[820px] text-[12px] leading-[1.6] text-[var(--ls-t3)]">
        PcComponentes solo deja ofertar sobre productos que ya están en su catálogo. Esto toma los productos del proveedor con EAN válido y stock, de 300 en 300, y pregunta cuáles existen ya allí. <b className="text-[var(--ls-t2)]">No escribe nada.</b>
      </p>
      <div className="flex items-center gap-2">
        <button type="button" disabled={cargando} onClick={() => medir(0)} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
          {cargando ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {tandas.length === 0 ? 'Medir los primeros 300' : 'Volver a empezar'}
        </button>
        {ultima?.siguiente !== null && ultima?.siguiente !== undefined && (
          <button type="button" disabled={cargando} onClick={() => medir(ultima.siguiente!)} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}>
            Siguientes 300
          </button>
        )}
      </div>
      {error && <Aviso tono="rojo">{error}</Aviso>}
      {ultima && (
        <>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['Productos del proveedor', ultima.productosDelProveedor],
                ['Sin EAN válido', ultima.sinEan],
                ['Con EAN y stock', ultima.candidatos],
                ['Mirados hasta ahora', mirados],
                ['Existen en PcComponentes', existen],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-[6px]">
                <div className="text-[10.5px] uppercase tracking-wide text-[var(--ls-t4)]">{k}</div>
                <div className="text-[14px] font-semibold tabular-nums text-[var(--ls-t1)]">{v.toLocaleString('es-ES')}</div>
              </div>
            ))}
            <div className="rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-[6px]">
              <div className="text-[10.5px] uppercase tracking-wide text-[var(--ls-t4)]">Cobertura</div>
              <div className="text-[14px] font-semibold tabular-nums text-[var(--ls-t1)]">{mirados > 0 ? `${Math.round((existen / mirados) * 100)} %` : '—'}</div>
            </div>
          </div>
          {ejemplos.length > 0 && (
            <div className="overflow-x-auto rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
              <table className="w-full min-w-[860px] text-left text-[12.5px]">
                <thead className="bg-[var(--ls-sup2)] text-[11px] font-semibold text-[var(--ls-t4)]">
                  <tr>
                    {['Código', 'Producto', 'EAN', 'Coste', 'Stock', 'Tiendas en PCC', 'Precio más bajo'].map((c) => <th key={c} className="px-3 py-[6px]">{c}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ls-linea)]">
                  {ejemplos.map((p) => (
                    <tr key={p.codigo}>
                      <td className="px-3 py-[6px] font-mono text-[11.5px] text-[var(--ls-t2)]">{p.codigo}</td>
                      <td className="max-w-[320px] truncate px-3 py-[6px] text-[var(--ls-t1)]" title={p.descripcion}>{p.descripcion}</td>
                      <td className="px-3 py-[6px] font-mono text-[11.5px] text-[var(--ls-t3)]">{p.ean}</td>
                      <td className="px-3 py-[6px] tabular-nums">{euros(p.coste)}</td>
                      <td className="px-3 py-[6px] tabular-nums">{p.stock}</td>
                      <td className="px-3 py-[6px] tabular-nums">{p.pcc.ofertas}</td>
                      <td className="px-3 py-[6px] tabular-nums">{euros(p.pcc.precioMinimo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
