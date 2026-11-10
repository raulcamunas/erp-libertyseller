'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { AVISO, BOTON, CAMPO, COLOR_ESTADO, TABLA, TARJETA, TEXTO, TIPO, TITULO } from '@/lib/estilo/denso'
import { Cargando, Vacio } from '@/components/plataforma/comun'
import type { EstructuraCreada, ProductoDeAds, ProductoDelCatalogo } from '@/lib/ads/cuenta'
import { ivaPorDefecto, margenDeProducto } from '@/lib/ads/margen'
import { resumenDesdeTitulo } from '@/lib/ads/estructura'
import { fmt, llamar } from './llamar'

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
  notas: string
  activo: boolean
}

const num = (s: string): number | null => {
  const t = s.trim()
  if (!t) return null
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) ? n : null
}

const vacio = (pais: string): Form => ({ asin: '', sku: '', titulo: '', resumen: '', precio: '', ivaPct: String(ivaPorDefecto(pais)), costeProducto: '', comisionPct: '15', tarifaFba: '0', otrosCostes: '0', notas: '', activo: true })

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
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const r = await llamar<{ productos: ProductoDeAds[]; estructuras: EstructuraCreada[] }>(`/api/ads/cuenta/productos?perfilId=${perfilId}`)
      setProductos(r.productos)
      setEstructuras(r.estructuras)
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
        <span className={`${TIPO.xs} ${TEXTO.t3}`}>El coste del producto da el ACoS de equilibrio, que manda en los objetivos de la ficha.</span>
      </div>

      {eligiendo && <Selector perfilId={perfilId} moneda={moneda} cerrar={() => setEligiendo(false)} elegir={(c) => { setEditor({ ...vacio(pais), asin: c.asin, sku: c.sku, titulo: c.titulo ?? '', resumen: resumenDesdeTitulo(c.titulo), precio: c.precio == null ? '' : String(c.precio) }); setEligiendo(false) }} />}

      {editor && <Editor form={editor} cambiar={setEditor} guardar={guardar} cancelar={() => setEditor(null)} ocupado={ocupado} moneda={moneda} />}

      {productos.length === 0 && !editor && !eligiendo ? (
        <Vacio icono={<Search />} titulo="Todavía no hay productos en esta cuenta">
          Elige uno del catálogo del cliente y ponle su coste: sin coste no hay ACoS de equilibrio y no se pueden crear las campañas con objetivos.
        </Vacio>
      ) : (
        productos.length > 0 && (
          <div className={TABLA.caja}>
            <table className={TABLA.tabla}>
              <thead>
                <tr>
                  {['Producto', 'Precio', 'Coste', 'Margen / ud.', 'ACoS de equilibrio', 'Campañas', ''].map((h, i) => (
                    <th key={i} className={`${TABLA.cabecera} ${i >= 1 && i <= 4 ? TABLA.derecha : ''}`}>{h}</th>
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
                      <td className={TABLA.celda}>{n === 0 ? <span className={TEXTO.t4}>ninguna</span> : `${n} creada${n === 1 ? '' : 's'}`}</td>
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

function Editor({ form, cambiar, guardar, cancelar, ocupado, moneda }: { form: Form; cambiar: (f: Form) => void; guardar: () => void; cancelar: () => void; ocupado: boolean; moneda: string | null }) {
  const m = useMemo(
    () => margenDe({ precio: num(form.precio), ivaPct: num(form.ivaPct) ?? 21, costeProducto: num(form.costeProducto), comisionPct: num(form.comisionPct) ?? 15, tarifaFba: num(form.tarifaFba) ?? 0, otrosCostes: num(form.otrosCostes) ?? 0 }),
    [form]
  )
  const campo = (clave: keyof Form, etiqueta: string, opciones: { numero?: boolean; ancho?: string; nota?: string } = {}) => (
    <div className={`${CAMPO.contenedor} ${opciones.ancho ?? ''}`}>
      <label className={CAMPO.etiqueta} htmlFor={`p-${clave}`}>{etiqueta}</label>
      <input id={`p-${clave}`} value={String(form[clave] ?? '')} onChange={(e) => cambiar({ ...form, [clave]: e.target.value })} inputMode={opciones.numero ? 'decimal' : undefined} className={`${CAMPO.input} ${opciones.numero ? CAMPO.numero : ''}`} />
      {opciones.nota && <p className={CAMPO.nota}>{opciones.nota}</p>}
    </div>
  )
  return (
    <section className={TARJETA.base}>
      <header className={TARJETA.cabecera}>
        <h2 className={TITULO.seccion}>{form.id ? 'Editar producto' : 'Nuevo producto'}</h2>
      </header>
      <div className={`${TARJETA.cuerpo} flex flex-col gap-3`}>
        <div className="grid gap-3 sm:grid-cols-3">
          {campo('asin', 'ASIN')}
          {campo('sku', 'SKU')}
          {campo('resumen', 'Resumen para el nombre de las campañas', { nota: 'Corto y en mayúsculas: va en «ASIN | SKU | RESUMEN | ESTRATEGIA».' })}
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {campo('precio', `Precio de venta (${moneda ?? '€'})`, { numero: true })}
          {campo('ivaPct', 'IVA incluido (%)', { numero: true })}
          {campo('costeProducto', `Coste del producto (${moneda ?? '€'})`, { numero: true })}
          {campo('comisionPct', 'Comisión Amazon (%)', { numero: true })}
          {campo('tarifaFba', 'Tarifa FBA', { numero: true })}
          {campo('otrosCostes', 'Otros costes / ud.', { numero: true })}
        </div>
        <div className={`${TIPO.s} ${TEXTO.t2}`}>
          {m ? (
            <>
              Sin IVA {fmt(m.netoSinIva)} · comisión {fmt(m.comision)} · margen antes de publicidad <strong className={TEXTO.t1}>{fmt(m.margen)}</strong> por unidad ·{' '}
              ACoS de equilibrio <strong className={TEXTO.t1}>{m.acosEquilibrioPct > 0 ? `${fmt(m.acosEquilibrioPct, 1)} %` : '0 % (pierde dinero sin publicidad)'}</strong>
            </>
          ) : (
            <span className={TEXTO.t3}>Pon el precio y el coste para ver el margen y el ACoS de equilibrio.</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className={`flex items-center gap-[6px] ${TIPO.s} ${TEXTO.t2}`}>
            <input type="checkbox" checked={form.activo} onChange={(e) => cambiar({ ...form, activo: e.target.checked })} /> Activo (se le pueden crear campañas)
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={ocupado} onClick={guardar} className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario}`}>{ocupado ? 'Guardando…' : 'Guardar producto'}</button>
          <button type="button" onClick={cancelar} className={`${BOTON.base} ${BOTON.alto} ${BOTON.secundario}`}>Cancelar</button>
        </div>
      </div>
    </section>
  )
}
