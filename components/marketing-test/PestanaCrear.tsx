'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, CircleAlert, Rocket } from 'lucide-react'
import { AVISO, BOTON, CAMPO, COLOR_ESTADO, TABLA, TARJETA, TEXTO, TIPO, TITULO } from '@/lib/estilo/denso'
import { Cargando, Vacio } from '@/components/plataforma/comun'
import type { EstructuraCreada, FichaDeCuenta, ProductoDeAds } from '@/lib/ads/cuenta'
import type { CampanaPlan } from '@/lib/ads/estructura'
import type { ResultadoDeCampana } from '@/lib/ads/crear-estructura'
import { margenDeProducto, objetivosDeProducto, pujaBaseSugerida } from '@/lib/ads/margen'
import { fmt, llamar } from './llamar'

type Fila = CampanaPlan & { yaExiste: boolean }
interface Vista {
  campanas: Fila[]
  listaTruncada: boolean
}

const num = (s: string): number => {
  const t = s.trim()
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
}

/**
 * CREAR LA ESTRUCTURA DE 4 CAMPAÑAS DE UN PRODUCTO, a un clic y con la nomenclatura del SOP («ASIN | SKU | RESUMEN | ESTRATEGIA»):
 * AUTO RADAR · MANUAL AMPLIA · MANUAL EXACTA / DOMINIO · ATAQUE ASIN. Nacen PAUSADAS y sin keywords: no gastan nada hasta que alguien las active (el SOP pide cargar antes las negativas).
 * Primero se ve la vista previa —lo que se crearía y lo que ya existe—, y solo entonces se crea.
 */
export function PestanaCrear({ perfilId, moneda, irA }: { perfilId: string; moneda: string | null; irA: (pestana: string) => void }) {
  const [productos, setProductos] = useState<ProductoDeAds[] | null>(null)
  const [estructuras, setEstructuras] = useState<EstructuraCreada[]>([])
  const [ficha, setFicha] = useState<FichaDeCuenta | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [productoId, setProductoId] = useState('')
  const [presupuesto, setPresupuesto] = useState('')
  const [puja, setPuja] = useState('')
  const [vista, setVista] = useState<Vista | null>(null)
  const [resultados, setResultados] = useState<ResultadoDeCampana[] | null>(null)
  const [ocupado, setOcupado] = useState<'vista' | 'crear' | null>(null)

  const cargar = useCallback(async () => {
    try {
      const [p, f] = await Promise.all([
        llamar<{ productos: ProductoDeAds[]; estructuras: EstructuraCreada[] }>(`/api/ads/cuenta/productos?perfilId=${perfilId}`),
        llamar<{ ficha: FichaDeCuenta }>(`/api/ads/cuenta/ficha?perfilId=${perfilId}`),
      ])
      setProductos(p.productos)
      setEstructuras(p.estructuras)
      setFicha(f.ficha)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido cargar.')
    }
  }, [perfilId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const producto = productos?.find((p) => p.id === productoId) ?? null
  const margen = useMemo(() => (producto ? margenDeProducto(producto) : null), [producto])
  const objetivos = useMemo(
    () => (producto && margen && ficha && producto.precio ? objetivosDeProducto(margen, producto.precio, { fase: ficha.fase, acosLanzamientoX: ficha.acosLanzamientoX, acosMaduroX: ficha.acosMaduroX, gastoSinVentaX: ficha.gastoSinVentaX }) : null),
    [producto, margen, ficha]
  )

  function elegir(id: string) {
    setProductoId(id)
    setVista(null)
    setResultados(null)
    const p = productos?.find((x) => x.id === id)
    const m = p ? margenDeProducto(p) : null
    const o = p && m && ficha && p.precio ? objetivosDeProducto(m, p.precio, { fase: ficha.fase, acosLanzamientoX: ficha.acosLanzamientoX, acosMaduroX: ficha.acosMaduroX, gastoSinVentaX: ficha.gastoSinVentaX }) : null
    const sugerida = p ? pujaBaseSugerida(p.precio, o?.acosObjetivoPct ?? null) : null
    setPuja(sugerida == null ? '' : String(sugerida).replace('.', ','))
  }

  const cuerpo = (accion: 'previsualizar' | 'crear') => ({ perfilId, productoId, presupuestoDiario: num(presupuesto), pujaBase: num(puja), accion })

  async function verVistaPrevia() {
    setOcupado('vista')
    setResultados(null)
    try {
      setVista(await llamar<Vista>('/api/ads/cuenta/estructura', { metodo: 'POST', cuerpo: cuerpo('previsualizar') }))
    } catch (e) {
      setVista(null)
      toast.error(e instanceof Error ? e.message : 'No se ha podido preparar la vista previa.')
    } finally {
      setOcupado(null)
    }
  }

  async function crear() {
    if (!vista || !producto) return
    const nuevas = vista.campanas.filter((c) => !c.yaExiste)
    const total = nuevas.reduce((a, c) => a + c.presupuestoDiario, 0)
    const ok = window.confirm(
      `Se van a crear ${nuevas.length} campañas PAUSADAS en la cuenta de Amazon Ads del cliente para «${producto.resumen}» (${producto.asin}), con ${fmt(total)} ${moneda ?? ''} de presupuesto diario entre todas.\n\nNo gastan nada hasta que las actives. ¿Seguimos?`
    )
    if (!ok) return
    setOcupado('crear')
    try {
      const r = await llamar<{ resultados: ResultadoDeCampana[] }>('/api/ads/cuenta/estructura', { metodo: 'POST', cuerpo: cuerpo('crear') })
      setResultados(r.resultados)
      const bien = r.resultados.filter((x) => x.estado === 'creada').length
      const mal = r.resultados.filter((x) => x.estado === 'error').length
      if (mal === 0) toast.success(`${bien} campañas creadas, pausadas.`)
      else toast.error(`${bien} creadas y ${mal} con error: mira el detalle.`)
      setVista(null)
      await cargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido crear.')
    } finally {
      setOcupado(null)
    }
  }

  if (error) return <p className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.rojo }}>{error}</p>
  if (!productos || !ficha) return <Cargando />

  const activos = productos.filter((p) => p.activo)
  if (activos.length === 0) {
    return (
      <Vacio icono={<Rocket />} titulo="Primero hay que elegir un producto" accion={<button type="button" onClick={() => irA('productos')} className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario}`}>Ir a Productos</button>}>
        Las campañas se crean para un producto de la cuenta, con su coste puesto.
      </Vacio>
    )
  }

  const hechas = producto ? estructuras.filter((e) => e.productoId === producto.id) : []
  const faltaCoste = !!producto && producto.costeProducto == null
  const puedeVer = !!producto && !faltaCoste && num(presupuesto) > 0 && num(puja) > 0

  return (
    <div className="flex max-w-[1100px] flex-col gap-2 pb-6">
      {!ficha.firmadaAt && (
        <div className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
          <CircleAlert className={AVISO.icono} />
          <span>
            La ficha de cuenta <span className={AVISO.fuerte}>no está firmada</span>. Se pueden crear las campañas (nacen pausadas), pero lo ideal es firmar antes los parámetros.{' '}
            <button type="button" className="underline" onClick={() => irA('ficha')}>Ir a la ficha</button>
          </span>
        </div>
      )}

      <section className={TARJETA.base}>
        <header className={TARJETA.cabecera}>
          <h2 className={TITULO.seccion}>1 · Producto, presupuesto y puja</h2>
        </header>
        <div className={`${TARJETA.cuerpo} flex flex-col gap-3`}>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className={CAMPO.contenedor}>
              <label className={CAMPO.etiqueta} htmlFor="c-producto">Producto</label>
              <select id="c-producto" value={productoId} onChange={(e) => elegir(e.target.value)} className={CAMPO.input}>
                <option value="">Elige un producto…</option>
                {activos.map((p) => (
                  <option key={p.id} value={p.id}>{p.resumen} · {p.asin}</option>
                ))}
              </select>
            </div>
            <div className={CAMPO.contenedor}>
              <label className={CAMPO.etiqueta} htmlFor="c-pres">Presupuesto diario total del producto ({moneda ?? '€'})</label>
              <input id="c-pres" inputMode="decimal" value={presupuesto} onChange={(e) => { setPresupuesto(e.target.value); setVista(null) }} className={`${CAMPO.input} ${CAMPO.numero}`} placeholder="20" />
              <p className={CAMPO.nota}>Se reparte entre las 4 campañas según el SOP (Amplia 35 · Exacta 25 · Auto 15 · Ataque 10, normalizado).{ficha.presupuestoMensual ? ` Mensual de la ficha: ${fmt(ficha.presupuestoMensual)} (≈ ${fmt(ficha.presupuestoMensual / 30.4)} al día entre todos los productos).` : ''}</p>
            </div>
            <div className={CAMPO.contenedor}>
              <label className={CAMPO.etiqueta} htmlFor="c-puja">Puja base ({moneda ?? '€'})</label>
              <input id="c-puja" inputMode="decimal" value={puja} onChange={(e) => { setPuja(e.target.value); setVista(null) }} className={`${CAMPO.input} ${CAMPO.numero}`} placeholder="0,80" />
              <p className={CAMPO.nota}>Punto de partida: precio × ACoS objetivo × 10 % de conversión. Edítala: la conversión real se conoce después.</p>
            </div>
          </div>

          {producto && (
            <div className={`${TIPO.s} ${TEXTO.t2}`}>
              {faltaCoste ? (
                <span style={{ color: COLOR_ESTADO.rojo }}>A este producto le falta el coste: ponlo en Productos antes de crear las campañas.</span>
              ) : margen && margen.acosEquilibrioPct === 0 ? (
                <span style={{ color: COLOR_ESTADO.rojo }}>Este producto pierde dinero antes de gastar en publicidad (margen {fmt(margen.margen)} por unidad): revisa el precio y los costes en Productos.</span>
              ) : margen ? (
                <>
                  ACoS de equilibrio <strong className={TEXTO.t1}>{fmt(margen.acosEquilibrioPct, 1)} %</strong>
                  {objetivos && (
                    <>
                      {' '}· objetivo en {ficha.fase} <strong className={TEXTO.t1}>{fmt(objetivos.acosObjetivoPct, 1)} %</strong> · CPA objetivo <strong className={TEXTO.t1}>{fmt(objetivos.cpaObjetivo)}</strong> · gasto sin venta antes de negativizar {fmt(objetivos.gastoMaximoSinVenta)}
                    </>
                  )}
                </>
              ) : null}
            </div>
          )}

          {hechas.length > 0 && (
            <div className={`${TIPO.s} ${TEXTO.t3}`}>
              Este producto ya tiene {hechas.length} campaña{hechas.length === 1 ? '' : 's'} creada{hechas.length === 1 ? '' : 's'} desde el ERP: {hechas.map((h) => h.rol).join(', ')}.
            </div>
          )}

          <div>
            <button type="button" disabled={!puedeVer || ocupado !== null} onClick={verVistaPrevia} className={`${BOTON.base} ${BOTON.alto} ${BOTON.secundario}`}>
              {ocupado === 'vista' ? 'Leyendo la cuenta…' : 'Ver vista previa'}
            </button>
          </div>
        </div>
      </section>

      {vista && (
        <section className={TARJETA.base}>
          <header className={TARJETA.cabecera}>
            <h2 className={TITULO.seccion}>2 · Lo que se creará</h2>
          </header>
          <div className={`${TARJETA.cuerpo} flex flex-col gap-2`}>
            {vista.listaTruncada && (
              <div className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
                <CircleAlert className={AVISO.icono} />
                <span>La cuenta tiene tantas campañas que no se han podido ver todas: puede que alguna de estas ya exista. No se podrá crear hasta revisarlo.</span>
              </div>
            )}
            <div className={TABLA.caja} style={{ maxHeight: 'none' }}>
              <table className={TABLA.tabla}>
                <thead>
                  <tr>
                    {['Campaña', 'Tipo', 'Presupuesto / día', 'Puja', 'Top búsquedas', 'Grupo', 'Estado'].map((h, i) => (
                      <th key={h} className={`${TABLA.cabecera} ${i >= 2 && i <= 4 ? TABLA.derecha : ''}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vista.campanas.map((c) => (
                    <tr key={c.rol} className={TABLA.fila}>
                      <td className={TABLA.celda}>
                        <div className={`${TEXTO.t1} font-medium`}>{c.nombre}</div>
                        <div className={`${TIPO.xs} ${TEXTO.t3} whitespace-normal max-w-[430px]`}>{c.nota}</div>
                      </td>
                      <td className={TABLA.celda}>{c.targetingType === 'AUTO' ? 'Automática' : 'Manual'}</td>
                      <td className={`${TABLA.celda} ${TABLA.numero}`}>{fmt(c.presupuestoDiario)} <span className={TEXTO.t4}>({fmt(c.repartoPct, 0)} %)</span></td>
                      <td className={`${TABLA.celda} ${TABLA.numero}`}>{fmt(c.pujaBase)}</td>
                      <td className={`${TABLA.celda} ${TABLA.numero}`}>{c.topBusquedasPct} %</td>
                      <td className={TABLA.celda}>{c.grupo}</td>
                      <td className={TABLA.celda}>{c.yaExiste ? <span className={TEXTO.t3}>Ya existe</span> : <span style={{ color: COLOR_ESTADO.verde }}>Se crea</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={`${TIPO.xs} ${TEXTO.t3}`}>
              Puja dinámica «solo reducir» en todas. Cada campaña lleva su grupo de anuncios con el producto; la automática, además, sus grupos de segmentación configurados. Las keywords y los ASIN rivales NO se cargan:
              van después de la investigación, y las negativas antes de activar nada (SOP, sección «Montaje»).
            </p>
            <div>
              <button type="button" disabled={ocupado !== null || vista.listaTruncada || vista.campanas.every((c) => c.yaExiste)} onClick={crear} className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario}`}>
                <Rocket className="h-3 w-3" /> {ocupado === 'crear' ? 'Creando en Amazon…' : `Crear ${vista.campanas.filter((c) => !c.yaExiste).length} campañas pausadas`}
              </button>
            </div>
          </div>
        </section>
      )}

      {resultados && (
        <section className={TARJETA.base}>
          <header className={TARJETA.cabecera}>
            <h2 className={TITULO.seccion}>Resultado</h2>
            <button type="button" onClick={() => irA('log')} className={`${BOTON.base} ${BOTON.secundario} ml-auto`}>Ver el log</button>
          </header>
          <div className={`${TARJETA.cuerpo} flex flex-col gap-[6px]`}>
            {resultados.map((r) => (
              <div key={r.rol} className="flex items-start gap-2">
                {r.estado === 'error' ? <CircleAlert className="mt-[2px] h-[13px] w-[13px] shrink-0" style={{ color: COLOR_ESTADO.rojo }} /> : <CheckCircle2 className="mt-[2px] h-[13px] w-[13px] shrink-0" style={{ color: r.estado === 'creada' ? COLOR_ESTADO.verde : COLOR_ESTADO.gris }} />}
                <div className={TIPO.s}>
                  <div className={TEXTO.t1}>{r.nombre}</div>
                  <div className={TEXTO.t3}>{r.estado === 'creada' ? 'Creada, pausada.' : r.estado === 'ya-existia' ? 'Ya existía: no se ha tocado.' : r.error}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
