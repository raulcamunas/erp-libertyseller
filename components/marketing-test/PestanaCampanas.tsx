'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, CircleAlert, Search } from 'lucide-react'
import { AVISO, BOTON, CAMPO, COLOR_ESTADO, TABLA, TEXTO, TIPO } from '@/lib/estilo/denso'
import { diasDelRango, porCampana, tipoDeCampana, totalesDe, type CampanaConCifras } from '@/lib/ads/rendimiento-calculo'
import { agruparPorProducto } from '@/lib/ads/productos-agrupar'
import { COLOR_DE_TIPO, EtiquetaDeTipo, PuntoDeEstado, Segmentado, SelectorDePeriodo, textoDeEstado, TiraDeCifras, type Dias } from './piezas'
import { useProductosConocidos } from './useProductosConocidos'
import { TarjetaDeProducto, type FilaDeCampana } from './TarjetaDeProducto'
import { dinero, decimal, entero, porcentaje } from './formato'
import { useRendimiento } from './useRendimiento'

type Fila = FilaDeCampana
type Orden = 'nombre' | 'presupuesto' | 'gasto' | 'ventas' | 'acos' | 'roas' | 'pedidos' | 'clics' | 'cpc' | 'ctr'
type Filtro = 'ENABLED' | 'PAUSED' | 'ARCHIVED' | 'TODAS'
type Vista = 'producto' | 'lista'

const COLUMNAS: Array<{ id: Orden; nombre: string; derecha: boolean }> = [
  { id: 'presupuesto', nombre: 'Presupuesto / día', derecha: true },
  { id: 'gasto', nombre: 'Gasto', derecha: true },
  { id: 'ventas', nombre: 'Ventas', derecha: true },
  { id: 'acos', nombre: 'ACoS', derecha: true },
  { id: 'roas', nombre: 'ROAS', derecha: true },
  { id: 'pedidos', nombre: 'Pedidos', derecha: true },
  { id: 'clics', nombre: 'Clics', derecha: true },
  { id: 'cpc', nombre: 'CPC', derecha: true },
  { id: 'ctr', nombre: 'CTR', derecha: true },
]

const valorDe = (f: Fila, o: Orden): number | string => (o === 'nombre' ? f.nombre.toLowerCase() : o === 'presupuesto' ? (f.presupuesto ?? -1) : ((f[o] as number | null) ?? -1))

/**
 * LAS CAMPAÑAS QUE YA HAY EN LA CUENTA, con sus cifras del periodo: las de la lista en vivo de Amazon (activas, pausadas y archivadas) cruzadas por id con el informe diario. Una campaña sin gasto
 * en el periodo sale con ceros; una con gasto que ya no está en la lista (archivada y fuera de las primeras páginas) sale igualmente, sin estado.
 */
export function PestanaCampanas({ perfilId, moneda, irA }: { perfilId: string; moneda: string | null; irA: (pestana: string) => void }) {
  const [dias, setDias] = useState<Dias>(14)
  const [filtro, setFiltro] = useState<Filtro>('ENABLED')
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState<{ por: Orden; desc: boolean }>({ por: 'gasto', desc: true })
  const [vista, setVista] = useState<Vista>('producto')
  const [abiertos, setAbiertos] = useState<ReadonlySet<string>>(new Set())
  const { campanas, informe, actualizar } = useRendimiento(perfilId, dias)
  const conocidos = useProductosConocidos(perfilId)

  const filas: Fila[] = useMemo(() => {
    const vivas = campanas.fase === 'listo' ? campanas.datos : []
    const cifras = new Map<string, CampanaConCifras>(informe.fase === 'listo' ? porCampana(informe.datos.actual).map((c) => [c.campaignId, c]) : [])
    const vacio = totalesDe([])
    const salida: Fila[] = vivas.map((v) => {
      const c = cifras.get(v.campaignId)
      cifras.delete(v.campaignId)
      const { campaignId: _i, nombre: _n, ...t } = c ?? { campaignId: '', nombre: '', ...vacio }
      return { ...t, campaignId: v.campaignId, nombre: v.nombre, estado: v.estado, presupuesto: v.presupuesto, segmentacion: v.segmentacion, tipo: tipoDeCampana(v.nombre) }
    })
    // Las que tienen gasto en el informe y no están en la lista en vivo
    for (const c of cifras.values()) salida.push({ ...c, estado: null, presupuesto: null, segmentacion: null, tipo: tipoDeCampana(c.nombre) })
    return salida
  }, [campanas, informe])

  const cuentas = useMemo(() => ({ ENABLED: filas.filter((f) => f.estado === 'ENABLED').length, PAUSED: filas.filter((f) => f.estado === 'PAUSED').length, ARCHIVED: filas.filter((f) => f.estado === 'ARCHIVED').length, TODAS: filas.length }), [filas])

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    const lista = filas.filter((f) => (filtro === 'TODAS' || f.estado === filtro) && (!q || f.nombre.toLowerCase().includes(q)))
    const dir = orden.desc ? -1 : 1
    return lista.sort((a, b) => {
      const x = valorDe(a, orden.por)
      const y = valorDe(b, orden.por)
      return (x < y ? -1 : x > y ? 1 : 0) * dir
    })
  }, [filas, filtro, busqueda, orden])

  const total = useMemo(() => totalesDe(visibles), [visibles])

  // Por producto: el ASIN que lleva el nombre de cada campaña. Los grupos se ordenan por la misma columna que las campañas (el «sin producto» siempre al final)
  const grupos = useMemo(() => {
    const nombres = new Map([...conocidos].map(([asin, p]) => [asin, p.resumen]))
    const g = agruparPorProducto(visibles, nombres)
    const dir = orden.desc ? -1 : 1
    const valorGrupo = (x: (typeof g)[number]): number | string => (orden.por === 'nombre' ? x.titulo.toLowerCase() : orden.por === 'presupuesto' ? x.campanas.reduce((a, c) => a + (c.presupuesto ?? 0), 0) : ((x.totales[orden.por] as number | null) ?? -1))
    return g.sort((a, b) => {
      if (a.asin === null) return 1
      if (b.asin === null) return -1
      const x = valorGrupo(a)
      const y = valorGrupo(b)
      return (x < y ? -1 : x > y ? 1 : 0) * dir
    })
  }, [visibles, conocidos, orden])
  const alternarGrupo = (clave: string) =>
    setAbiertos((prev) => {
      const n = new Set(prev)
      if (n.has(clave)) n.delete(clave)
      else n.add(clave)
      return n
    })
  const maxGasto = Math.max(...visibles.map((f) => f.gasto), 0.0001)
  const conCifras = informe.fase === 'listo'
  const diasDelPeriodo = useMemo(() => (informe.fase === 'listo' ? diasDelRango(informe.datos.periodos.actual.desde, informe.datos.periodos.actual.hasta) : []), [informe])
  const filasDiariasDe = (ids: readonly string[]) => {
    if (informe.fase !== 'listo') return []
    const conjunto = new Set(ids)
    return informe.datos.actual.filter((f) => conjunto.has(f.campaignId))
  }

  /** Una fila de campaña. `sangria` 1 = dentro de un producto */
  function filaDeCampana(f: Fila, sangria: 0 | 1) {
    return (
      <tr key={f.campaignId} className={TABLA.fila}>
        <td className={`${TABLA.celda} h-[38px]`} style={sangria ? { paddingLeft: 30 } : undefined}>
          <div className="flex items-center gap-2">
            <PuntoDeEstado estado={f.estado} />
            <div className="min-w-0">
              <div className={`${TEXTO.t1} ${TABLA.corta} max-w-[420px]`} title={`${f.nombre} · ${textoDeEstado(f.estado)}`}>{f.nombre}</div>
              <div className="mt-[1px] flex items-center gap-[5px]">
                <EtiquetaDeTipo tipo={f.tipo} />
                <span className={`${TIPO.xs} ${TEXTO.t4}`}>{f.segmentacion === 'AUTO' ? 'Automática' : f.segmentacion === 'MANUAL' ? 'Manual' : ''}</span>
              </div>
            </div>
          </div>
        </td>
        <td className={`${TABLA.celda} ${TABLA.numero}`}>{f.presupuesto == null ? '—' : dinero(f.presupuesto, moneda)}</td>
        <td className={`${TABLA.celda} ${TABLA.numero}`}>
          {conCifras ? (
            <div className="ml-auto w-[110px]">
              <div className={TEXTO.t1}>{dinero(f.gasto, moneda)}</div>
              <div className="mt-[2px] h-[3px] overflow-hidden rounded-full bg-[var(--ls-sup2)]">
                <div className="h-full rounded-full" style={{ width: `${(f.gasto / maxGasto) * 100}%`, background: COLOR_DE_TIPO[f.tipo] ?? COLOR_ESTADO.gris }} />
              </div>
            </div>
          ) : (
            '—'
          )}
        </td>
        <td className={`${TABLA.celda} ${TABLA.numero}`}>{conCifras ? dinero(f.ventas, moneda) : '—'}</td>
        <td className={`${TABLA.celda} ${TABLA.numero}`}>{conCifras ? porcentaje(f.acos) : '—'}</td>
        <td className={`${TABLA.celda} ${TABLA.numero}`}>{conCifras && f.roas != null ? decimal(f.roas) : '—'}</td>
        <td className={`${TABLA.celda} ${TABLA.numero}`}>{conCifras ? entero(f.pedidos) : '—'}</td>
        <td className={`${TABLA.celda} ${TABLA.numero}`}>{conCifras ? entero(f.clics) : '—'}</td>
        <td className={`${TABLA.celda} ${TABLA.numero}`}>{conCifras ? dinero(f.cpc, moneda) : '—'}</td>
        <td className={`${TABLA.celda} ${TABLA.numero}`}>{conCifras ? porcentaje(f.ctr, 2) : '—'}</td>
      </tr>
    )
  }

  function ordenarPor(o: Orden) {
    setOrden((prev) => (prev.por === o ? { por: o, desc: !prev.desc } : { por: o, desc: o !== 'nombre' }))
  }

  return (
    <div className="flex max-w-[1240px] flex-col gap-3 pb-8">
      {/* ---- fila 1: el periodo (izquierda) y la búsqueda (derecha) ---- */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SelectorDePeriodo dias={dias} cambiar={setDias} en={informe.fase === 'listo' ? informe.en : undefined} actualizar={actualizar} cargando={informe.fase === 'cargando' || campanas.fase === 'cargando' || (informe.fase === 'listo' && informe.datos.sincronizando)} />
        <label className="relative">
          <span className="sr-only">Buscar una campaña</span>
          <Search className="pointer-events-none absolute left-[10px] top-[9px] h-[13px] w-[13px] text-[var(--ls-t4)]" />
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar una campaña" className="h-[30px] w-[260px] rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] pl-[30px] pr-2 text-[12.5px] text-[var(--ls-t1)] outline-none transition-colors placeholder:text-[var(--ls-t4)] hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)] focus:bg-[var(--ls-sup)]" />
        </label>
      </div>

      {/* ---- fila 2: qué campañas y cómo verlas ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <Segmentado
          etiqueta="Estado de las campañas"
          opciones={[
            { id: 'ENABLED', texto: 'Activas', cuenta: cuentas.ENABLED },
            { id: 'PAUSED', texto: 'Pausadas', cuenta: cuentas.PAUSED },
            { id: 'ARCHIVED', texto: 'Archivadas', cuenta: cuentas.ARCHIVED },
            { id: 'TODAS', texto: 'Todas', cuenta: cuentas.TODAS },
          ]}
          valor={filtro}
          cambiar={(v) => setFiltro(v as Filtro)}
        />
        <Segmentado
          etiqueta="Vista"
          opciones={[
            { id: 'producto', texto: 'Por producto' },
            { id: 'lista', texto: 'Lista' },
          ]}
          valor={vista}
          cambiar={(v) => setVista(v as Vista)}
        />
        {vista === 'producto' && grupos.length > 1 && (
          <button type="button" onClick={() => setAbiertos(abiertos.size > 0 ? new Set() : new Set(grupos.map((g) => g.clave)))} className="ml-auto inline-flex h-[30px] items-center rounded-[9px] px-[10px] text-[12px] font-medium text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">
            {abiertos.size > 0 ? 'Contraer todo' : 'Expandir todo'}
          </button>
        )}
        {informe.fase === 'cargando' && <span className={`${TIPO.xs} ${TEXTO.t4}`}>{informe.nota ?? 'Cargando las cifras…'}</span>}
      </div>

      {campanas.fase === 'error' && (
        <div className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.rojo }}>
          <CircleAlert className={AVISO.icono} />
          <span>{campanas.mensaje}</span>
        </div>
      )}
      {informe.fase === 'error' && (
        <div className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
          <CircleAlert className={AVISO.icono} />
          <span>
            <span className={AVISO.fuerte}>Las campañas se ven, pero sin cifras.</span> {informe.mensaje}
          </span>
        </div>
      )}

      {vista === 'producto' ? (
        <div className="flex flex-col gap-3">
          {conCifras && grupos.length > 0 && (
            <TiraDeCifras
              cifras={[
                { etiqueta: 'Productos', valor: entero(grupos.filter((g) => g.asin !== null).length) },
                { etiqueta: 'Gasto', valor: dinero(total.gasto, moneda) },
                { etiqueta: 'Ventas', valor: dinero(total.ventas, moneda) },
                { etiqueta: 'ACoS', valor: porcentaje(total.acos) },
                { etiqueta: 'ROAS', valor: total.roas == null ? '—' : decimal(total.roas) },
                { etiqueta: 'Pedidos', valor: entero(total.pedidos) },
              ]}
            />
          )}
          {campanas.fase === 'cargando' && grupos.length === 0 && <p className={`${TIPO.s} ${TEXTO.t3}`}>Leyendo las campañas de Amazon…</p>}
          {campanas.fase !== 'cargando' && grupos.length === 0 && <p className={`${TIPO.s} ${TEXTO.t3}`}>No hay campañas con ese filtro.</p>}
          {grupos.map((g) => (
            <TarjetaDeProducto
              key={g.clave}
              grupo={g}
              moneda={moneda}
              equilibrio={g.asin ? (conocidos.get(g.asin)?.equilibrio ?? null) : null}
              objetivo={g.asin ? (conocidos.get(g.asin)?.objetivo ?? null) : null}
              filasDiarias={filasDiariasDe(g.campanas.map((c) => c.campaignId))}
              dias={diasDelPeriodo}
              conCifras={conCifras}
              abierto={abiertos.has(g.clave)}
              alternar={() => alternarGrupo(g.clave)}
              irAProductos={() => irA('productos')}
            />
          ))}
        </div>
      ) : (
      <div className="min-w-0 overflow-x-auto rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
        <table className={TABLA.tabla}>
          <thead>
            <tr>
              <th className={`${TABLA.cabecera} min-w-[340px] cursor-pointer select-none`} onClick={() => ordenarPor('nombre')}>
                Campaña {orden.por === 'nombre' && (orden.desc ? <ArrowDown className="inline h-3 w-3" /> : <ArrowUp className="inline h-3 w-3" />)}
              </th>
              {COLUMNAS.map((c) => (
                <th key={c.id} className={`${TABLA.cabecera} ${TABLA.derecha} cursor-pointer select-none`} onClick={() => ordenarPor(c.id)}>
                  {c.nombre} {orden.por === c.id && (orden.desc ? <ArrowDown className="inline h-3 w-3" /> : <ArrowUp className="inline h-3 w-3" />)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {campanas.fase === 'cargando' && visibles.length === 0 && (
              <tr>
                <td className={`${TABLA.celda} ${TEXTO.t3}`} colSpan={COLUMNAS.length + 1}>Leyendo las campañas de Amazon…</td>
              </tr>
            )}
            {campanas.fase !== 'cargando' && visibles.length === 0 && (
              <tr>
                <td className={`${TABLA.celda} ${TEXTO.t3}`} colSpan={COLUMNAS.length + 1}>No hay campañas con ese filtro.</td>
              </tr>
            )}
            {visibles.map((f) => filaDeCampana(f, 0))}
          </tbody>
          {visibles.length > 0 && conCifras && (
            <tfoot>
              <tr className="font-semibold">
                <td className={`${TABLA.celda} bg-[var(--ls-sup2)] ${TEXTO.t1}`}>Total de las {visibles.length} campañas que se ven</td>
                <td className={`${TABLA.celda} ${TABLA.numero} bg-[var(--ls-sup2)]`}>{dinero(visibles.reduce((s, f) => s + (f.presupuesto ?? 0), 0), moneda)}</td>
                <td className={`${TABLA.celda} ${TABLA.numero} bg-[var(--ls-sup2)]`}>{dinero(total.gasto, moneda)}</td>
                <td className={`${TABLA.celda} ${TABLA.numero} bg-[var(--ls-sup2)]`}>{dinero(total.ventas, moneda)}</td>
                <td className={`${TABLA.celda} ${TABLA.numero} bg-[var(--ls-sup2)]`}>{porcentaje(total.acos)}</td>
                <td className={`${TABLA.celda} ${TABLA.numero} bg-[var(--ls-sup2)]`}>{total.roas != null ? decimal(total.roas) : '—'}</td>
                <td className={`${TABLA.celda} ${TABLA.numero} bg-[var(--ls-sup2)]`}>{entero(total.pedidos)}</td>
                <td className={`${TABLA.celda} ${TABLA.numero} bg-[var(--ls-sup2)]`}>{entero(total.clics)}</td>
                <td className={`${TABLA.celda} ${TABLA.numero} bg-[var(--ls-sup2)]`}>{dinero(total.cpc, moneda)}</td>
                <td className={`${TABLA.celda} ${TABLA.numero} bg-[var(--ls-sup2)]`}>{porcentaje(total.ctr, 2)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      )}

      <p className={`${TIPO.xs} ${TEXTO.t4}`}>Ventas y pedidos atribuidos a 7 días, como en la consola de Amazon Ads. Las cifras de hoy no están: el periodo acaba ayer.</p>
    </div>
  )
}

