'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, CircleAlert, Search } from 'lucide-react'
import { AVISO, BOTON, CAMPO, COLOR_ESTADO, TABLA, TEXTO, TIPO } from '@/lib/estilo/denso'
import { porCampana, tipoDeCampana, totalesDe, type CampanaConCifras, type Totales } from '@/lib/ads/rendimiento-calculo'
import { COLOR_DE_TIPO, EtiquetaDeTipo, PuntoDeEstado, SelectorDePeriodo, textoDeEstado, type Dias } from './piezas'
import { dinero, decimal, entero, porcentaje } from './formato'
import { useRendimiento, type CampanaViva } from './useRendimiento'

type Fila = Totales & { campaignId: string; nombre: string; estado: CampanaViva['estado'] | null; presupuesto: number | null; segmentacion: CampanaViva['segmentacion']; tipo: string }
type Orden = 'nombre' | 'presupuesto' | 'gasto' | 'ventas' | 'acos' | 'roas' | 'pedidos' | 'clics' | 'cpc' | 'ctr'
type Filtro = 'ENABLED' | 'PAUSED' | 'ARCHIVED' | 'TODAS'

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
export function PestanaCampanas({ perfilId, moneda }: { perfilId: string; moneda: string | null }) {
  const [dias, setDias] = useState<Dias>(14)
  const [filtro, setFiltro] = useState<Filtro>('ENABLED')
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState<{ por: Orden; desc: boolean }>({ por: 'gasto', desc: true })
  const { campanas, informe, actualizar } = useRendimiento(perfilId, dias)

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
  const maxGasto = Math.max(...visibles.map((f) => f.gasto), 0.0001)
  const conCifras = informe.fase === 'listo'

  function ordenarPor(o: Orden) {
    setOrden((prev) => (prev.por === o ? { por: o, desc: !prev.desc } : { por: o, desc: o !== 'nombre' }))
  }

  return (
    <div className="flex flex-col gap-2 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SelectorDePeriodo dias={dias} cambiar={setDias} en={informe.fase === 'listo' ? informe.en : undefined} actualizar={actualizar} cargando={informe.fase === 'cargando' || campanas.fase === 'cargando'} />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-[7px] h-3 w-3 text-[var(--ls-t4)]" />
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar una campaña…" className={`${CAMPO.input} w-[240px] pl-6`} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-[6px]">
        {([
          ['ENABLED', 'Activas'],
          ['PAUSED', 'Pausadas'],
          ['ARCHIVED', 'Archivadas'],
          ['TODAS', 'Todas'],
        ] as const).map(([id, nombre]) => (
          <button key={id} type="button" onClick={() => setFiltro(id)} className={`${BOTON.chip} ${filtro === id ? BOTON.chipEncendido : ''}`}>
            {nombre} <span className="tabular-nums opacity-70">{cuentas[id]}</span>
          </button>
        ))}
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
            {visibles.map((f) => (
              <tr key={f.campaignId} className={TABLA.fila}>
                <td className={`${TABLA.celda} h-[38px]`}>
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
            ))}
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
      <p className={`${TIPO.xs} ${TEXTO.t4}`}>Ventas y pedidos atribuidos a 7 días, como en la consola de Amazon Ads. Las cifras de hoy no están: el periodo acaba ayer.</p>
    </div>
  )
}
