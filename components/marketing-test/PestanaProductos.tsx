'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { AVISO, BOTON, CAMPO, COLOR_ESTADO, TABLA, TEXTO, TIPO, TITULO } from '@/lib/estilo/denso'
import { CAJA as TARJETA } from './piezas'
import { Cargando, Vacio } from '@/components/plataforma/comun'
import type { EstructuraCreada, ProductoDeAds, ProductoDelCatalogo } from '@/lib/ads/cuenta'
import { ivaPorDefecto, margenDeProducto } from '@/lib/ads/margen'
import { resumenDesdeTitulo } from '@/lib/ads/estructura'
import { fmt, llamar } from './llamar'
import type { DatosDeAmazon, FuenteDeDato } from '@/lib/ads/datos-amazon'

interface Form {
  id?: string
  asin: string
  sku: string
  titulo: string
  resumen: string
  precio: string
  ivaPct: string
  costeProducto: string
  comisionPct: string
  tarifaFba: string
  otrosCostes: string
  acosObjetivoPct: string
  notas: string
  activo: boolean
}

const num = (s: string): number | null => {
  const t = s.trim()
  if (!t) return null
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) ? n : null
}

const vacio = (pais: string): Form => ({ asin: '', sku: '', titulo: '', resumen: '', precio: '', ivaPct: String(ivaPorDefecto(pais)), costeProducto: '', comisionPct: '15', tarifaFba: '0', otrosCostes: '0', acosObjetivoPct: '', notas: '', activo: true })

const deProducto = (p: ProductoDeAds): Form => ({
  id: p.id,
  asin: p.asin,
  sku: p.sku,
  titulo: p.titulo ?? '',
  resumen: p.resumen,
  precio: p.precio == null ? '' : String(p.precio),
  ivaPct: String(p.ivaPct),
  costeProducto: p.costeProducto == null ? '' : String(p.costeProducto),
  comisionPct: String(p.comisionPct),
  tarifaFba: String(p.tarifaFba),
  otrosCostes: String(p.otrosCostes),
  acosObjetivoPct: p.acosObjetivoPct == null ? '' : String(p.acosObjetivoPct),
  notas: p.notas ?? '',
  activo: p.activo,
})

const margenDe = (f: { precio: number | null; ivaPct: number; costeProducto: number | null; comisionPct: number; tarifaFba: number; otrosCostes: number }) => margenDeProducto(f)

/**
 * LOS PRODUCTOS A LOS QUE SE LES HACE MARKETING, con su coste. Del coste y del precio sale el ACoS de equilibrio (margen antes de publicidad ÷ precio), que es el número del que cuelgan los objetivos
 * de la ficha. Los productos se eligen del catálogo de la cuenta de Amazon del cliente, en el país de esta cuenta de anunciante.
 */
export function PestanaProductos({ perfilId, pais, moneda }: { perfilId: string; pais: string; moneda: string | null }) {
  const [productos, setProductos] = useState<ProductoDeAds[] | null>(null)
  const [estructuras, setEstructuras] = useState<EstructuraCreada[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editor, setEditor] = useState<Form | null>(null)
  const [eligiendo, setEligiendo] = useState(false)
  const [pegando, setPegando] = useState(false)
  const [campanasPorAsin, setCampanasPorAsin] = useState<Record<string, { activas: number; pausadas: number }> | null>(null)
  const [detectados, setDetectados] = useState<Array<{ asin: string; sku: string | null; titulo: string | null; precio: number | null; campanas: { activas: number; pausadas: number } }>>([])
  const [anadiendo, setAnadiendo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const r = await llamar<{ productos: ProductoDeAds[]; estructuras: EstructuraCreada[]; campanasPorAsin: Record<string, { activas: number; pausadas: number }> | null; detectados: typeof detectados }>(`/api/ads/cuenta/productos?perfilId=${perfilId}`)
      setProductos(r.productos)
      setEstructuras(r.estructuras)
      setCampanasPorAsin(r.campanasPorAsin)
      setDetectados(r.detectados ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se han podido cargar los productos.')
    }
  }, [perfilId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function guardar() {
    if (!editor) return
    setOcupado(true)
    try {
      const cuerpo = { perfilId, ...editor }
      await llamar(`/api/ads/cuenta/productos`, { metodo: editor.id ? 'PUT' : 'POST', cuerpo })
      toast.success(editor.id ? 'Producto actualizado.' : 'Producto añadido.')
      setEditor(null)
      await cargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar.')
    } finally {
      setOcupado(false)
    }
  }

  async function anadir(asins: string[] | null) {
    setAnadiendo(asins ? asins[0] : 'todos')
    try {
      const r = await llamar<{ anadidos: number; sinSku: string[] }>('/api/ads/cuenta/productos', { metodo: 'POST', cuerpo: { perfilId, accion: 'anadir-detectados', asins } })
      toast.success(`${r.anadidos} ${r.anadidos === 1 ? 'producto añadido' : 'productos añadidos'} con su precio y comisiones de Amazon. Ponles su ACoS objetivo.${r.sinSku.length ? ` ${r.sinSku.length} sin SKU en el catálogo: añádelos a mano (${r.sinSku.join(', ')}).` : ''}`)
      await cargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se han podido añadir.')
    } finally {
      setAnadiendo(null)
    }
  }

  async function quitar(p: ProductoDeAds) {
    if (!window.confirm(`¿Quitar «${p.resumen}» (${p.asin}) de la lista?`)) return
    try {
      await llamar(`/api/ads/cuenta/productos`, { metodo: 'DELETE', cuerpo: { perfilId, id: p.id } })
      toast.success('Producto quitado.')
      await cargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido quitar.')
    }
  }

  if (error) return <p className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.rojo }}>{error}</p>
  if (!productos) return <Cargando />

  return (
    <div className="flex max-w-[1100px] flex-col gap-2 pb-6">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => { setEligiendo(true); setEditor(null) }} className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario}`}>
          <Plus className="h-3 w-3" /> Añadir producto de la cuenta
        </button>
        <button type="button" onClick={() => { setEditor(vacio(pais)); setEligiendo(false) }} className={`${BOTON.base} ${BOTON.alto} ${BOTON.secundario}`}>
          Añadir a mano
        </button>
        <button type="button" onClick={() => { setPegando((x) => !x); setEditor(null); setEligiendo(false) }} className={`${BOTON.base} ${BOTON.alto} ${BOTON.secundario}`} title="Copia dos columnas de Excel (SKU y coste) y pégalas">
          Pegar costes
        </button>
        <span className={`${TIPO.xs} ${TEXTO.t3}`}>Elige el producto y ponle su ACoS objetivo: el precio, el IVA y las comisiones los trae el ERP de Amazon.</span>
      </div>

      {eligiendo && <Selector perfilId={perfilId} moneda={moneda} cerrar={() => setEligiendo(false)} elegir={(c) => { setEditor({ ...vacio(pais), asin: c.asin, sku: c.sku, titulo: c.titulo ?? '', resumen: resumenDesdeTitulo(c.titulo), precio: c.precio == null ? '' : String(c.precio) }); setEligiendo(false) }} />}

      {pegando && <PegarCostes perfilId={perfilId} cerrar={() => setPegando(false)} hecho={() => { setPegando(false); void cargar() }} />}

      {editor && <Editor key={editor.id ?? `${editor.asin}|${editor.sku}`} perfilId={perfilId} form={editor} cambiar={setEditor} guardar={guardar} cancelar={() => setEditor(null)} ocupado={ocupado} moneda={moneda} />}

      {detectados.length > 0 && (
        <section className={TARJETA.base}>
          <header className={TARJETA.cabecera}>
            <h2 className={TITULO.seccion}>{detectados.length} {detectados.length === 1 ? 'producto tiene' : 'productos tienen'} campañas en la cuenta y no {detectados.length === 1 ? 'está' : 'están'} aquí</h2>
            <button type="button" disabled={anadiendo !== null} onClick={() => void anadir(null)} className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario} ml-auto`}>
              {anadiendo === 'todos' ? 'Añadiendo…' : detectados.length === 1 ? 'Añadirlo' : `Añadir los ${detectados.length}`}
            </button>
          </header>
          <div className="flex flex-col divide-y divide-[var(--ls-linea)]">
            {detectados.map((d) => (
              <div key={d.asin} className="flex items-center gap-3 px-4 py-[8px]">
                <div className="min-w-0 flex-1">
                  <div className={`${TIPO.s} ${TEXTO.t1} truncate`}>{d.titulo ?? '(no está en el catálogo leído)'}</div>
                  <div className={`${TIPO.xs} ${TEXTO.t3}`}>{d.asin}{d.sku ? ` · ${d.sku}` : ' · sin SKU'}{d.precio != null ? ` · ${fmt(d.precio)}` : ''}</div>
                </div>
                <span className={`${TIPO.xs} ${TEXTO.t2} shrink-0`}>{d.campanas.activas} activas{d.campanas.pausadas ? ` · ${d.campanas.pausadas} pausadas` : ''}</span>
                <button type="button" disabled={anadiendo !== null || !d.sku} onClick={() => void anadir([d.asin])} title={d.sku ? undefined : 'Sin SKU en el catálogo: añádelo a mano'} className={`${BOTON.base} ${BOTON.secundario} shrink-0`}>
                  {anadiendo === d.asin ? 'Añadiendo…' : 'Añadir'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {productos.length === 0 && !editor && !eligiendo ? (
        <Vacio icono={<Search />} titulo="Todavía no hay productos en esta cuenta">
          Elige uno del catálogo del cliente y ponle su ACoS objetivo: el resto lo trae el ERP de Amazon.
        </Vacio>
      ) : (
        productos.length > 0 && (
          <div className={TABLA.caja}>
            <table className={TABLA.tabla}>
              <thead>
                <tr>
                  {['Producto', 'Precio', 'Coste', 'Margen / ud.', 'ACoS de equilibrio', 'ACoS objetivo', 'Campañas', ''].map((h, i) => (
                    <th key={i} className={`${TABLA.cabecera} ${i >= 1 && i <= 5 ? TABLA.derecha : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {productos.map((p) => {
                  const m = margenDe(p)
                  const n = estructuras.filter((e) => e.productoId === p.id).length
                  return (
                    <tr key={p.id} className={TABLA.fila}>
                      <td className={TABLA.celda}>
                        <div className={`${TEXTO.t1} font-medium`}>{p.resumen}{!p.activo && <span className={`${TEXTO.t4} font-normal`}> · inactivo</span>}</div>
                        <div className={`${TIPO.xs} ${TEXTO.t3}`}>{p.asin} · {p.sku}</div>
                      </td>
                      <td className={`${TABLA.celda} ${TABLA.numero}`}>{fmt(p.precio)}</td>
                      <td className={`${TABLA.celda} ${TABLA.numero}`}>{p.costeProducto == null ? <span className={TEXTO.t4}>falta</span> : fmt(p.costeProducto)}</td>
                      <td className={`${TABLA.celda} ${TABLA.numero}`} style={m && m.margen < 0 ? { color: COLOR_ESTADO.rojo } : undefined}>{m ? fmt(m.margen) : '—'}</td>
                      <td className={`${TABLA.celda} ${TABLA.numero}`}>{m ? (m.acosEquilibrioPct > 0 ? `${fmt(m.acosEquilibrioPct, 1)} %` : <span style={{ color: COLOR_ESTADO.rojo }}>pierde sin publicidad</span>) : '—'}</td>
                      <td className={`${TABLA.celda} ${TABLA.numero}`}>
                        {p.acosObjetivoPct == null ? (
                          <span style={{ color: COLOR_ESTADO.ambar }} title="Sin ACoS objetivo el motor no le propone nada">sin fijar</span>
                        ) : (
                          <span className={m && m.acosEquilibrioPct > 0 && p.acosObjetivoPct > m.acosEquilibrioPct ? '' : TEXTO.t1} style={m && m.acosEquilibrioPct > 0 && p.acosObjetivoPct > m.acosEquilibrioPct ? { color: COLOR_ESTADO.ambar } : undefined} title={m && m.acosEquilibrioPct > 0 && p.acosObjetivoPct > m.acosEquilibrioPct ? 'Por encima del equilibrio: cada venta con ese ACoS pierde dinero' : undefined}>
                            {fmt(p.acosObjetivoPct, 1)} %
                          </span>
                        )}
                      </td>
                      <td className={TABLA.celda}>
                        {(() => {
                          const c = campanasPorAsin?.[p.asin.toUpperCase()]
                          if (c && c.activas + c.pausadas > 0)
                            return (
                              <span title={n > 0 ? `${n} creadas desde el ERP` : undefined}>
                                <span className={TEXTO.t1}>{c.activas} activas</span>
                                {c.pausadas > 0 && <span className={TEXTO.t3}> · {c.pausadas} pausadas</span>}
                              </span>
                            )
                          return n === 0 ? <span className={TEXTO.t4}>{campanasPorAsin ? 'ninguna' : '—'}</span> : `${n} creada${n === 1 ? '' : 's'}`
                        })()}
                      </td>
                      <td className={`${TABLA.celda} ${TABLA.derecha}`}>
                        <button type="button" className={BOTON.icono} title="Editar" onClick={() => { setEditor(deProducto(p)); setEligiendo(false) }}><Pencil className="h-3 w-3" /></button>
                        <button type="button" className={BOTON.icono} title={n > 0 ? 'Tiene campañas: márcalo como inactivo en vez de quitarlo' : 'Quitar'} onClick={() => quitar(p)}><Trash2 className="h-3 w-3" /></button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}

function Selector({ perfilId, moneda, cerrar, elegir }: { perfilId: string; moneda: string | null; cerrar: () => void; elegir: (p: ProductoDelCatalogo) => void }) {
  const [q, setQ] = useState('')
  const [lista, setLista] = useState<ProductoDelCatalogo[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setLista(null)
    const t = setTimeout(async () => {
      try {
        const r = await llamar<{ productos: ProductoDelCatalogo[] }>(`/api/ads/cuenta/catalogo?perfilId=${perfilId}&q=${encodeURIComponent(q)}`)
        if (vivo) { setLista(r.productos); setError(null) }
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : 'No se ha podido leer el catálogo.')
      }
    }, q ? 300 : 0)
    return () => { vivo = false; clearTimeout(t) }
  }, [perfilId, q])

  return (
    <section className={TARJETA.base}>
      <header className={TARJETA.cabecera}>
        <h2 className={TITULO.seccion}>Elegir un producto del catálogo de la cuenta</h2>
        <button type="button" onClick={cerrar} className={`${BOTON.base} ${BOTON.secundario} ml-auto`}>Cerrar</button>
      </header>
      <div className={`${TARJETA.cuerpo} flex flex-col gap-2`}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por SKU, ASIN o título…" className={CAMPO.input} />
        {error ? <p className={`${TIPO.s} ${TEXTO.t3}`}>{error}</p> : !lista ? <Cargando /> : lista.length === 0 ? (
          <p className={`${TIPO.s} ${TEXTO.t3}`}>No hay productos con ASIN {q ? 'que coincidan' : 'en el catálogo de este país'}. Si el cliente vende aquí pero no sale, puede que el catálogo no esté sincronizado: se puede añadir a mano.</p>
        ) : (
          <div className="max-h-[300px] overflow-auto">
            {lista.map((p) => (
              <div key={`${p.asin}|${p.sku}`} className="flex items-center gap-2 border-b border-[var(--ls-linea)] py-[5px]">
                <div className="min-w-0 flex-1">
                  <div className={`${TIPO.s} ${TEXTO.t1} truncate`}>{p.titulo ?? '(sin título)'}</div>
                  <div className={`${TIPO.xs} ${TEXTO.t3}`}>{p.asin} · {p.sku}{p.stockFba != null ? ` · ${p.stockFba} en FBA` : ''}</div>
                </div>
                <span className={`${TIPO.s} ${TEXTO.t2} tabular-nums`}>{p.precio == null ? '' : `${fmt(p.precio)} ${p.moneda ?? moneda ?? ''}`}</span>
                <button type="button" disabled={p.yaAnadido} onClick={() => elegir(p)} className={`${BOTON.base} ${BOTON.secundario}`}>{p.yaAnadido ? 'Ya está' : 'Elegir'}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

type EstadoAmazon = { cargando: true } | { cargando: false; datos: DatosDeAmazon | null; error: string | null }

const ETIQUETA_FUENTE: Record<FuenteDeDato, string> = { amazon: 'de Amazon', guardado: 'de Amazon (última lectura)', pais: 'del país', erp: 'del ERP', falta: 'sin dato de Amazon' }

/** Si los números del producto son los de relleno de antes (15 % y FBA 0), se vuelven a pedir a Amazon al abrirlo */
const tieneValoresDeRelleno = (f: Form) => num(f.comisionPct) === 15 && (num(f.tarifaFba) ?? 0) === 0

function Editor({ perfilId, form, cambiar, guardar, cancelar, ocupado, moneda }: { perfilId: string; form: Form; cambiar: (f: Form) => void; guardar: () => void; cancelar: () => void; ocupado: boolean; moneda: string | null }) {
  const [amazon, setAmazon] = useState<EstadoAmazon | null>(null)
  const [aMano, setAMano] = useState(false)
  const m = useMemo(
    () => margenDe({ precio: num(form.precio), ivaPct: num(form.ivaPct) ?? 21, costeProducto: num(form.costeProducto), comisionPct: num(form.comisionPct) ?? 15, tarifaFba: num(form.tarifaFba) ?? 0, otrosCostes: num(form.otrosCostes) ?? 0 }),
    [form]
  )

  const traer = useCallback(
    async (f: Form) => {
      if (!f.sku.trim()) return
      setAmazon({ cargando: true })
      try {
        const d = await llamar<DatosDeAmazon>(`/api/ads/cuenta/datos-amazon?perfilId=${perfilId}&sku=${encodeURIComponent(f.sku.trim())}`)
        const siguiente: Form = { ...f, ivaPct: String(d.ivaPct) }
        if (d.precio != null) siguiente.precio = String(d.precio)
        if (d.comisionPct != null) siguiente.comisionPct = String(d.comisionPct)
        if (d.tarifaFba != null) siguiente.tarifaFba = String(d.tarifaFba)
        if (d.otrosCostes != null) siguiente.otrosCostes = String(d.otrosCostes)
        if (d.costeProducto != null) siguiente.costeProducto = String(d.costeProducto)
        cambiar(siguiente)
        setAmazon({ cargando: false, datos: d, error: null })
      } catch (e) {
        setAmazon({ cargando: false, datos: null, error: e instanceof Error ? e.message : 'No se ha podido leer de Amazon.' })
      }
    },
    [perfilId, cambiar]
  )

  // Al abrir: un producto nuevo de la cuenta, o uno guardado con los números de relleno, se rellena solo
  useEffect(() => {
    if (form.sku.trim() && (!form.id || tieneValoresDeRelleno(form))) void traer(form)
    // solo al abrir este producto
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.id, form.asin])

  const campo = (clave: keyof Form, etiqueta: string, opciones: { numero?: boolean; ancho?: string; nota?: string; grande?: boolean } = {}) => (
    <div className={`${CAMPO.contenedor} ${opciones.ancho ?? ''}`}>
      <label className={CAMPO.etiqueta} htmlFor={`p-${clave}`}>{etiqueta}</label>
      <input id={`p-${clave}`} value={String(form[clave] ?? '')} onChange={(e) => cambiar({ ...form, [clave]: e.target.value })} inputMode={opciones.numero ? 'decimal' : undefined} className={`${CAMPO.input} ${opciones.numero ? CAMPO.numero : ''} ${opciones.grande ? '!h-[38px] !text-[15px] font-semibold' : ''}`} />
      {opciones.nota && <p className={CAMPO.nota}>{opciones.nota}</p>}
    </div>
  )
  const d = amazon && !amazon.cargando ? amazon.datos : null
  const fuente = (k: keyof DatosDeAmazon['fuentes']) => (d ? d.fuentes[k] : null)
  const dato = (etiqueta: string, valor: string, f: FuenteDeDato | null) => (
    <div className="flex min-w-[110px] flex-col gap-[2px] rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-[7px]">
      <span className={`${TIPO.xs} ${TEXTO.t3}`}>{etiqueta}</span>
      <span className={`${TIPO.s} ${TEXTO.t1} font-semibold tabular-nums`}>{valor}</span>
      {f && <span className="text-[10.5px]" style={{ color: f === 'falta' ? COLOR_ESTADO.ambar : f === 'amazon' || f === 'guardado' ? COLOR_ESTADO.verde : 'var(--ls-t4)' }}>{ETIQUETA_FUENTE[f]}</span>}
    </div>
  )
  const mon = moneda ?? '€'
  const conValor = (s: string, sufijo = '', decimales = 2) => (num(s) == null ? '—' : `${fmt(num(s), decimales)}${sufijo}`)

  return (
    <section className={TARJETA.base}>
      <header className={TARJETA.cabecera}>
        <h2 className={TITULO.seccion}>{form.id ? 'Editar producto' : 'Nuevo producto'}</h2>
        {form.titulo && <span className={`${TIPO.xs} ${TEXTO.t3} ml-2 min-w-0 truncate`}>{form.titulo}</span>}
      </header>
      <div className={`${TARJETA.cuerpo} flex flex-col gap-4`}>
        <div className="grid gap-3 sm:grid-cols-3">
          {campo('acosObjetivoPct', 'ACoS objetivo (%)', { numero: true, grande: true, nota: m && m.acosEquilibrioPct > 0 ? `Tu equilibrio es ${fmt(m.acosEquilibrioPct, 1)} %: por encima de eso pierdes dinero con cada venta.` : 'Es lo único que eliges tú: el motor optimiza para quedarse por debajo.' })}
          {campo('asin', 'ASIN')}
          {campo('sku', 'SKU')}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`${TIPO.s} ${TEXTO.t1} font-semibold`}>Datos de Amazon</span>
            {amazon?.cargando && <span className={`${TIPO.xs} ${TEXTO.t3}`}>Leyendo precio y comisiones de Amazon…</span>}
            <button type="button" disabled={!form.sku.trim() || amazon?.cargando === true} onClick={() => traer(form)} className={`${BOTON.base} ${BOTON.secundario} ml-auto`}>Volver a leer de Amazon</button>
            <button type="button" onClick={() => setAMano((x) => !x)} className={`${BOTON.base} ${BOTON.secundario}`}>{aMano ? 'Ocultar' : 'Cambiar a mano'}</button>
          </div>
          {amazon && !amazon.cargando && (amazon.error || amazon.datos?.aviso) && (
            <p className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>{amazon.error ?? amazon.datos?.aviso}</p>
          )}
          {aMano ? (
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {campo('precio', `Precio de venta (${mon})`, { numero: true })}
              {campo('ivaPct', 'IVA incluido (%)', { numero: true })}
              {campo('comisionPct', 'Comisión Amazon (%)', { numero: true })}
              {campo('tarifaFba', `Tarifa FBA (${mon})`, { numero: true })}
              {campo('otrosCostes', `Otros / ud. (${mon})`, { numero: true })}
              {campo('costeProducto', `Coste del producto (${mon})`, { numero: true, nota: 'Opcional: solo para ver tu equilibrio.' })}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {dato('Precio', conValor(form.precio, ` ${mon}`), fuente('precio'))}
              {dato('IVA incluido', conValor(form.ivaPct, ' %', 0), fuente('iva'))}
              {dato('Comisión', conValor(form.comisionPct, ' %', 1), fuente('tarifas'))}
              {dato('Tarifa FBA', conValor(form.tarifaFba, ` ${mon}`), fuente('tarifas'))}
              {num(form.otrosCostes) ? dato('Otras tarifas', conValor(form.otrosCostes, ` ${mon}`), fuente('tarifas')) : null}
              {dato('Coste del producto', num(form.costeProducto) == null ? 'opcional' : conValor(form.costeProducto, ` ${mon}`), num(form.costeProducto) == null ? null : fuente('coste') === 'erp' ? 'erp' : null)}
            </div>
          )}
        </div>

        <div className={`${TIPO.s} ${TEXTO.t2}`}>
          {m ? (
            <>
              Sin IVA {fmt(m.netoSinIva)} · comisión {fmt(m.comision)} · margen antes de publicidad <strong className={TEXTO.t1}>{fmt(m.margen)}</strong> por unidad ·{' '}
              ACoS de equilibrio <strong className={TEXTO.t1}>{m.acosEquilibrioPct > 0 ? `${fmt(m.acosEquilibrioPct, 1)} %` : '0 % (pierde dinero sin publicidad)'}</strong>
            </>
          ) : (
            <span className={TEXTO.t3}>Con el coste del producto (opcional, en «Cambiar a mano») te digo el margen y el ACoS de equilibrio.</span>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {campo('resumen', 'Nombre corto para las campañas', { nota: 'Sale solo del título. Va en «ASIN | SKU | RESUMEN | ESTRATEGIA».' })}
        </div>
        <label className={`flex items-center gap-[6px] ${TIPO.s} ${TEXTO.t2}`}>
          <input type="checkbox" checked={form.activo} onChange={(e) => cambiar({ ...form, activo: e.target.checked })} /> Activo (se le pueden crear campañas)
        </label>
        <div className="flex items-center gap-2">
          <button type="button" disabled={ocupado || amazon?.cargando === true} onClick={guardar} className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario}`}>{ocupado ? 'Guardando…' : 'Guardar producto'}</button>
          <button type="button" onClick={cancelar} className={`${BOTON.base} ${BOTON.alto} ${BOTON.secundario}`}>Cancelar</button>
        </div>
      </div>
    </section>
  )
}

/** Dos columnas pegadas de una hoja de cálculo (SKU y coste) → el coste de cada producto de esta cuenta con ese SKU */
function PegarCostes({ perfilId, cerrar, hecho }: { perfilId: string; cerrar: () => void; hecho: () => void }) {
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState(false)
  async function enviar() {
    setOcupado(true)
    try {
      const r = await llamar<{ actualizados: number; sinProducto: string[]; leidos: number; descartadas: number }>('/api/ads/cuenta/productos', { metodo: 'POST', cuerpo: { perfilId, accion: 'pegar-costes', texto } })
      toast.success(`Coste puesto a ${r.actualizados} ${r.actualizados === 1 ? 'producto' : 'productos'}.${r.sinProducto.length ? ` ${r.sinProducto.length} SKU no están en Marketing Test (${r.sinProducto.slice(0, 3).join(', ')}${r.sinProducto.length > 3 ? '…' : ''}).` : ''}${r.descartadas ? ` ${r.descartadas} líneas no se han entendido.` : ''}`)
      hecho()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se han podido guardar los costes.')
    } finally {
      setOcupado(false)
    }
  }
  return (
    <section className={TARJETA.base}>
      <header className={TARJETA.cabecera}>
        <h2 className={TITULO.seccion}>Pegar costes</h2>
        <span className={`${TIPO.xs} ${TEXTO.t3}`}>Dos columnas copiadas de Excel o Google Sheets: SKU y coste por unidad (sin IVA). La cabecera da igual.</span>
      </header>
      <div className={`${TARJETA.cuerpo} flex flex-col gap-2`}>
        <textarea autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} rows={7} placeholder={'650 GATO GRIS/37\t6,20\nBOTA-44\t12,50'} className={`${CAMPO.input} !h-auto font-mono text-[12px]`} />
        <div className="flex items-center gap-2">
          <button type="button" disabled={ocupado || !texto.trim()} onClick={() => void enviar()} className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario}`}>{ocupado ? 'Guardando…' : 'Guardar costes'}</button>
          <button type="button" onClick={cerrar} className={`${BOTON.base} ${BOTON.alto} ${BOTON.secundario}`}>Cancelar</button>
          <span className={`${TIPO.xs} ${TEXTO.t4}`}>Se guarda también como coste del SKU en el ERP, vigente desde hoy.</span>
        </div>
      </div>
    </section>
  )
}
