'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Download, Loader2, RefreshCw, Search, Store, Upload } from 'lucide-react'
import { BOTON, CAMPO, COLOR_ESTADO, TIPO } from '@/lib/estilo/denso'
import { FRASE_DE_CONFIRMACION } from '@/lib/pccomponentes/frase'
import type { CuentaPcc, ImportacionPcc, OfertaPcc, ProductoPcc } from '@/lib/pccomponentes/datos'
import type { FilaMercado } from '@/lib/pccomponentes/mercado'
import { juzgar, type JuicioDeMercado } from '@/lib/pccomponentes/margenes'
import { cx } from '@/components/remesas/comun/ui'

/**
 * ENTRAIS · PCCOMPONENTES: EL PANEL DE SU TIENDA.
 *
 *   OFERTAS     todo lo que la tienda tiene publicado hoy: producto, EAN, precio, stock y si está activa. Se lee de PcComponentes cada vez que se abre.
 *   PROBAR      busca un producto del proveedor, comprueba si existe en el catálogo de PcComponentes y sube UNA oferta de prueba, con una frase de
 *               confirmación y siguiendo la importación hasta que termina. La cantidad empieza en 0: una oferta sin stock no se puede comprar.
 *   MERCADO Y MARGEN   cada producto del proveedor que ya existe en PcComponentes, con su coste, el precio más bajo del mercado (la oferta destacada, aproximada)
 *               y el margen que quedaría con la comisión REAL de su categoría. Lee lo guardado en `pcc_mercado`; un botón lo refresca.
 *
 * Nada de aquí cambia la tienda salvo «Subir la oferta», y solo si se escribe la frase de confirmación. La clave de API no llega a esta pantalla.
 */

export type EstadoDelPanel =
  | { tipo: 'ok'; cuenta: CuentaPcc; ofertas: OfertaPcc[]; total: number; leidoAt: string; servidor: string; deMemoria?: boolean }
  | { tipo: 'sin_clave'; mensaje: string }
  | { tipo: 'error'; mensaje: string }

type Pestana = 'ofertas' | 'probar' | 'mercado'

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
  const ruta = usePathname()
  const [pestana, setPestana] = useState<Pestana>('ofertas')
  // La lista de ofertas se guarda un minuto en el servidor (PcComponentes admite muy pocas lecturas): ?fresco la pide de nuevo
  const releer = () => router.replace(`${ruta}?fresco=${Date.now()}`)

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
              ['mercado', 'Mercado y margen'],
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
        <button type="button" onClick={releer} className={cx(BOTON.base, BOTON.alto, BOTON.secundario, 'ml-auto')} title="Vuelve a leer la tienda de PcComponentes">
          <RefreshCw className="h-3 w-3" />
          Actualizar
        </button>
      </header>

      {estado.tipo !== 'ok' ? (
        <div className="space-y-3 px-5 pb-6">
          <Aviso tono="rojo">{estado.mensaje}</Aviso>
          {estado.tipo === 'sin_clave' && <p className="text-[12px] text-[var(--ls-t3)]">Se pone en las variables de entorno del servidor (Easypanel) y se reinicia la aplicación.</p>}
          {/* Si solo ha fallado la lectura de la tienda (un corte de PcComponentes, por ejemplo), el mercado y el margen se pueden seguir viendo: salen de lo guardado */}
          {estado.tipo === 'error' && pestana === 'mercado' && <MercadoYMargen ofertas={[]} />}
          {estado.tipo === 'error' && pestana !== 'mercado' && <p className="text-[12px] text-[var(--ls-t3)]">Espera un minuto y pulsa «Actualizar». La pestaña «Mercado y margen» funciona igualmente.</p>}
        </div>
      ) : (
        <>
          <Cifras cuenta={estado.cuenta} total={estado.total} leidoAt={estado.leidoAt} deMemoria={estado.deMemoria === true} />
          <div className="px-5 pb-8">
            {pestana === 'ofertas' && <TablaDeOfertas ofertas={estado.ofertas} total={estado.total} />}
            {pestana === 'probar' && <ProbarUnProducto ofertas={estado.ofertas} onSubido={releer} />}
            {pestana === 'mercado' && <MercadoYMargen ofertas={estado.ofertas} />}
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

function Cifras({ cuenta, total, leidoAt, deMemoria }: { cuenta: CuentaPcc; total: number; leidoAt: string; deMemoria: boolean }) {
  const celdas: Array<[string, string]> = [
    ['Ofertas publicadas', total.toLocaleString('es-ES')],
    ['Pedidos hechos', cuenta.pedidos.toLocaleString('es-ES')],
    ['Valoración', cuenta.valoracion === null ? '—' : `${cuenta.valoracion.toLocaleString('es-ES')} / 5`],
    ['Aprobación de ofertas', cuenta.tasaAprobacion === null ? '—' : `${Math.round(cuenta.tasaAprobacion * 100)} %`],
    ['Canales', cuenta.canales.map((c) => c.replace('WEB_', '')).join(' · ') || '—'],
    ['Ofertas leídas', `${new Date(leidoAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}${deMemoria ? ' · memoria' : ''}`],
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
/* Mercado y margen                                                    */
/* ------------------------------------------------------------------ */

interface RespuestaMercado {
  filas: FilaMercado[]
  conEan: number
  comprobados: number
  existen: number
  actualizadoAt: string | null
}

type FiltroMercado = 'todos' | 'competitivos' | 'fuera' | 'sin_competencia'
type Orden = 'beneficio' | 'margen' | 'cercania' | 'coste' | 'tiendas'

const ORDENES: Record<Orden, string> = {
  beneficio: 'Más beneficio por unidad',
  margen: 'Más margen %',
  cercania: 'Más cerca de ser competitivo',
  coste: 'Coste más alto',
  tiendas: 'Más tiendas lo venden',
}

const pct = (n: number, dec = 1) => `${(n * 100).toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec })} %`

interface FilaJuzgada extends FilaMercado {
  j: JuicioDeMercado
  publicada: boolean
}

function MercadoYMargen({ ofertas }: { ofertas: OfertaPcc[] }) {
  const [datos, setDatos] = useState<RespuestaMercado | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [progreso, setProgreso] = useState<string | null>(null)
  const [margenTexto, setMargenTexto] = useState('5')
  const [busqueda, setBusqueda] = useState('')
  const [categoria, setCategoria] = useState('')
  const [filtro, setFiltro] = useState<FiltroMercado>('competitivos')
  const [orden, setOrden] = useState<Orden>('beneficio')
  const [pagina, setPagina] = useState(0)

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await pedir<RespuestaMercado>('/api/pccomponentes/mercado')
    setCargando(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setError(null)
    setDatos(r.datos)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function actualizar() {
    setError(null)
    let desde = 0
    for (;;) {
      setProgreso(desde === 0 ? 'Preguntando a PcComponentes…' : `Preguntados ${desde.toLocaleString('es-ES')}…`)
      const r = await pedir<{ siguiente: number | null; total: number }>('/api/pccomponentes/mercado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ desde }),
      })
      if (!r.ok) {
        setProgreso(null)
        setError(r.error)
        return
      }
      if (r.datos.siguiente === null) break
      desde = r.datos.siguiente
    }
    setProgreso(null)
    await cargar()
    toast.success('Mercado actualizado')
  }

  const margenObjetivo = Math.min(0.9, Math.max(0, (Number(margenTexto.replace(',', '.')) || 0) / 100))
  const nuestros = useMemo(() => new Set(ofertas.map((o) => o.sku)), [ofertas])

  const filas = useMemo<FilaJuzgada[]>(
    () => (datos?.filas ?? []).map((f) => ({ ...f, j: juzgar({ coste: f.coste, categoria: f.categoria, precioMercado: f.precioMin, margenObjetivo }), publicada: nuestros.has(f.sku) })),
    [datos, margenObjetivo, nuestros]
  )

  const categorias = useMemo(() => {
    const cuenta = new Map<string, number>()
    for (const f of filas) cuenta.set(f.categoria ?? '(sin categoría)', (cuenta.get(f.categoria ?? '(sin categoría)') ?? 0) + 1)
    return [...cuenta.entries()].sort((a, b) => b[1] - a[1])
  }, [filas])

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    const sel = filas.filter((f) => {
      if (categoria !== '' && (f.categoria ?? '(sin categoría)') !== categoria) return false
      if (filtro === 'competitivos' && !f.j.competitivo) return false
      if (filtro === 'fuera' && (f.j.competitivo || f.precioMin === null)) return false
      if (filtro === 'sin_competencia' && f.precioMin !== null) return false
      return q === '' || [f.sku, f.ean, f.titulo, f.marca ?? ''].some((t) => t.toLowerCase().includes(q))
    })
    const clave: Record<Orden, (f: FilaJuzgada) => number> = {
      beneficio: (f) => -(f.j.alMercado?.beneficio ?? -1e9),
      margen: (f) => -(f.j.alMercado?.margen ?? -1e9),
      cercania: (f) => f.j.sobreElMercado ?? 1e9,
      coste: (f) => -f.coste,
      tiendas: (f) => -f.ofertas,
    }
    return sel.sort((a, b) => clave[orden](a) - clave[orden](b))
  }, [filas, busqueda, categoria, filtro, orden])

  const competitivos = filas.filter((f) => f.j.competitivo).length
  const sinNadie = filas.filter((f) => f.precioMin === null).length
  const paginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA))
  const actual = Math.min(pagina, paginas - 1)
  const trozo = visibles.slice(actual * POR_PAGINA, (actual + 1) * POR_PAGINA)

  async function descargar() {
    const XLSX = await import('xlsx')
    const hoja = XLSX.utils.json_to_sheet(
      visibles.map((f) => ({
        SKU: f.sku,
        EAN: f.ean,
        PRODUCTO: f.titulo,
        CATEGORIA: f.categoria ?? '',
        COSTE: f.coste,
        COMISION_PCT: f.j.comision.pct,
        COMISION_FIJA: f.j.comision.fija,
        COMISION_ESTIMADA: f.j.comision.porDefecto ? 'POR DEFECTO' : f.j.comision.origen,
        PRECIO_MAS_BAJO: f.precioMin,
        TIENDA_MAS_BARATA: f.tiendaMin ?? '',
        TIENDAS: f.ofertas,
        COMISION_EUR: f.j.alMercado?.comision ?? null,
        BENEFICIO_EUR: f.j.alMercado?.beneficio ?? null,
        MARGEN: f.j.alMercado?.margen ?? null,
        PRECIO_MINIMO_PARA_EL_MARGEN: f.j.suelo,
        COMPETITIVO: f.j.competitivo ? 'SI' : f.precioMin === null ? 'SIN COMPETENCIA' : 'NO',
        YA_PUBLICADA: f.publicada ? 'SI' : '',
      }))
    )
    const libro = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(libro, hoja, 'Mercado')
    XLSX.writeFile(libro, `entrais-pccomponentes-mercado-${new Date().toISOString().slice(0, 10)}.xlsx`)
    toast.success(`${visibles.length.toLocaleString('es-ES')} filas descargadas`)
  }

  const celdas: Array<[string, string]> = datos
    ? [
        ['Con EAN en el proveedor', datos.conEan.toLocaleString('es-ES')],
        ['Ya preguntados', datos.comprobados.toLocaleString('es-ES')],
        ['Existen en PcComponentes', `${datos.existen.toLocaleString('es-ES')}${datos.comprobados > 0 ? ` · ${Math.round((datos.existen / datos.comprobados) * 100)} %` : ''}`],
        ['Sin nadie vendiéndolo', sinNadie.toLocaleString('es-ES')],
        [`Competitivos con ${pct(margenObjetivo, 0)}`, competitivos.toLocaleString('es-ES')],
        ['Última actualización', datos.actualizadoAt ? new Date(datos.actualizadoAt).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'],
      ]
    : []

  return (
    <div className="space-y-3">
      <p className="max-w-[900px] text-[12px] leading-[1.6] text-[var(--ls-t3)]">
        Los productos del proveedor que ya existen en PcComponentes, con el <b className="text-[var(--ls-t2)]">precio más bajo del mercado</b> (la oferta destacada, aproximada: PcComponentes no dice cómo la elige) y lo que quedaría de margen con la comisión de su categoría. La comisión es una <b className="text-[var(--ls-t2)]">estimación sacada de vuestro histórico</b> y no cuenta las devoluciones. Los costes salen de la tabla de precios de Entrais Amazon: no se gasta ninguna llamada al proveedor. <b className="text-[var(--ls-t2)]">No escribe nada en la tienda.</b>
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={progreso !== null} onClick={() => void actualizar()} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
          {progreso !== null ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {progreso ?? 'Actualizar mercado'}
        </button>
        <label className="flex items-center gap-[6px] text-[12px] text-[var(--ls-t3)]">
          Margen objetivo
          <input value={margenTexto} onChange={(e) => { setMargenTexto(e.target.value); setPagina(0) }} inputMode="decimal" className={cx(CAMPO.input, CAMPO.numero, '!w-[64px]')} />
          %
        </label>
        <button type="button" disabled={visibles.length === 0} onClick={() => void descargar()} className={cx(BOTON.base, BOTON.alto, BOTON.secundario, 'ml-auto')}>
          <Download className="h-3 w-3" />
          Excel
        </button>
      </div>

      {error && <Aviso tono={error.includes('migración 270') ? 'ambar' : 'rojo'}>{error}</Aviso>}
      {cargando && !datos && <div className="flex items-center gap-2 text-[12px] text-[var(--ls-t3)]"><Loader2 className="h-3 w-3 animate-spin" /> Leyendo lo guardado…</div>}

      {datos && datos.comprobados === 0 && !error && (
        <Aviso tono="ambar">Todavía no se ha preguntado nada a PcComponentes. Pulsa «Actualizar mercado»: son unos 6.000 productos, tarda un par de minutos y se puede dejar la pantalla abierta. Si «Con EAN en el proveedor» sale en 0, falta recalcular los precios en Entrais Amazon (el EAN se guarda en cada recálculo).</Aviso>
      )}

      {datos && (
        <div className="flex flex-wrap gap-2">
          {celdas.map(([k, v]) => (
            <div key={k} className="rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-[6px]">
              <div className="text-[10.5px] uppercase tracking-wide text-[var(--ls-t4)]">{k}</div>
              <div className="text-[14px] font-semibold tabular-nums text-[var(--ls-t1)]">{v}</div>
            </div>
          ))}
        </div>
      )}

      {datos && datos.filas.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-[7px] h-3 w-3 text-[var(--ls-t4)]" />
              <input value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setPagina(0) }} placeholder="Buscar por SKU, EAN, producto o marca" className={cx(CAMPO.input, 'w-[300px] pl-7')} />
            </div>
            {(['competitivos', 'fuera', 'sin_competencia', 'todos'] as const).map((f) => (
              <button key={f} type="button" onClick={() => { setFiltro(f); setPagina(0) }} aria-pressed={filtro === f} className={cx(BOTON.chip, filtro === f && '!border-[var(--ls-acc-borde)] !bg-[var(--ls-sup3)] !text-[var(--ls-t1)]')}>
                {{ competitivos: 'Competitivos', fuera: 'Por encima del mercado', sin_competencia: 'Nadie lo vende', todos: 'Todos' }[f]}
              </button>
            ))}
            <select value={categoria} onChange={(e) => { setCategoria(e.target.value); setPagina(0) }} className={cx(CAMPO.input, '!w-[210px]')} aria-label="Categoría">
              <option value="">Todas las categorías</option>
              {categorias.map(([c, n]) => <option key={c} value={c}>{c} ({n})</option>)}
            </select>
            <select value={orden} onChange={(e) => { setOrden(e.target.value as Orden); setPagina(0) }} className={cx(CAMPO.input, '!w-[210px]')} aria-label="Orden">
              {(Object.keys(ORDENES) as Orden[]).map((o) => <option key={o} value={o}>{ORDENES[o]}</option>)}
            </select>
            <span className="ml-auto text-[11.5px] text-[var(--ls-t4)]">{visibles.length.toLocaleString('es-ES')} de {filas.length.toLocaleString('es-ES')}</span>
          </div>

          <div className="overflow-x-auto rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
            <table className="w-full min-w-[1080px] text-left text-[12.5px]">
              <thead className="bg-[var(--ls-sup2)] text-[11px] font-semibold text-[var(--ls-t4)]">
                <tr>
                  {['Producto', 'Coste', 'Comisión', 'Precio más bajo', 'Tiendas', 'Margen a ese precio', `Mínimo para el ${pct(margenObjetivo, 0)}`, 'Estado'].map((c, i) => (
                    <th key={c} className={cx('px-3 py-[6px]', i >= 1 && i <= 6 && 'text-right')}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ls-linea)]">
                {trozo.map((f) => {
                  const m = f.j.alMercado
                  const color = m === null ? undefined : m.margen < 0 ? COLOR_ESTADO.rojo : m.margen >= margenObjetivo ? COLOR_ESTADO.verde : COLOR_ESTADO.ambar
                  return (
                    <tr key={f.sku} className="hover:bg-[var(--ls-sup2)]">
                      <td className="max-w-[380px] px-3 py-[6px]">
                        <div className="truncate text-[var(--ls-t1)]" title={f.titulo}>{f.titulo || '—'}</div>
                        <div className="truncate text-[11px] text-[var(--ls-t4)]"><span className="font-mono">{f.sku}</span> · <span className="font-mono">{f.ean}</span> · {f.categoria ?? 'sin categoría'}</div>
                      </td>
                      <td className="px-3 py-[6px] text-right tabular-nums text-[var(--ls-t2)]">{euros(f.coste)}</td>
                      <td className="px-3 py-[6px] text-right tabular-nums text-[var(--ls-t3)]" title={f.j.comision.porDefecto ? 'Categoría sin histórico: se usa una tarifa prudente por defecto' : `Estimada con ${f.j.comision.lineas} líneas de vuestro histórico (${f.j.comision.origen})`}>
                        {m ? euros(m.comision) : '—'}
                        <div className="text-[11px] text-[var(--ls-t4)]">{pct(f.j.comision.pct)}{f.j.comision.fija > 0 ? ` + ${euros(f.j.comision.fija)}` : ''}{f.j.comision.porDefecto ? ' *' : ''}</div>
                      </td>
                      <td className="px-3 py-[6px] text-right tabular-nums text-[var(--ls-t1)]">
                        {euros(f.precioMin)}
                        <div className="max-w-[130px] truncate text-[11px] text-[var(--ls-t4)]" title={f.tiendaMin ?? ''}>{f.tiendaMin ?? ''}</div>
                      </td>
                      <td className="px-3 py-[6px] text-right tabular-nums text-[var(--ls-t3)]">{f.ofertas}</td>
                      <td className="px-3 py-[6px] text-right tabular-nums" style={{ color }}>
                        {m ? euros(m.beneficio) : '—'}
                        <div className="text-[11px]">
                          {m ? pct(m.margen) : ''}
                          {m && m.margen > 0.4 && (
                            <span className="ml-1 rounded-[4px] px-1" style={{ color: COLOR_ESTADO.ambar }} title="Un margen tan alto suele ser un coste desfasado o un producto de otro formato (pack, unidad): revisar antes de fiarse">
                              revisar
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-[6px] text-right tabular-nums text-[var(--ls-t2)]">{euros(f.j.suelo)}</td>
                      <td className="px-3 py-[6px] text-[11.5px]">
                        <span className="inline-flex items-center gap-[5px] text-[var(--ls-t2)]">
                          <span className="h-[7px] w-[7px] rounded-full" style={{ background: f.precioMin === null ? COLOR_ESTADO.gris : f.j.competitivo ? COLOR_ESTADO.verde : COLOR_ESTADO.ambar }} />
                          {f.precioMin === null ? 'Nadie lo vende' : f.j.competitivo ? 'Competitivo' : `Por encima ${euros(f.j.sobreElMercado)}`}
                        </span>
                        {f.publicada && <div className="text-[11px] text-[var(--ls-t4)]">Ya publicada</div>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {paginas > 1 && (
            <div className="flex items-center justify-end gap-2 text-[12px] text-[var(--ls-t3)]">
              <button type="button" disabled={actual === 0} onClick={() => setPagina(actual - 1)} className={cx(BOTON.base, BOTON.secundario)}>Anterior</button>
              <span className="tabular-nums">{actual + 1} / {paginas}</span>
              <button type="button" disabled={actual >= paginas - 1} onClick={() => setPagina(actual + 1)} className={cx(BOTON.base, BOTON.secundario)}>Siguiente</button>
            </div>
          )}
          <p className="text-[11px] text-[var(--ls-t4)]">* Categoría sin histórico: comisión por defecto prudente. El margen es sobre el precio sin IVA y antes de devoluciones. No se mira el stock del proveedor.</p>
        </>
      )}
    </div>
  )
}
