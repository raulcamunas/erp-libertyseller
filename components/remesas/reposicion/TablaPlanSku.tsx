'use client'

import { useMemo, useState } from 'react'
import { Download, PackageSearch, Save, Search, TrendingDown, TrendingUp, X } from 'lucide-react'
import { toast } from 'sonner'
import { Boton, TACTIL } from '@/components/ui-ls/Boton'
import { Insignia } from '@/components/ui-ls/Insignia'
import { PanelLateral } from '@/components/ui-ls/PanelLateral'
import { Segmentado, type Opcion } from '@/components/ui-ls/Pestanas'
import { TablaAdaptable, type Columna } from '@/components/ui-ls/TablaAdaptable'
import { CAMPO, COLOR_ESTADO } from '@/lib/estilo/denso'
import type { AjustesReposicion, LineaPlan } from '@/lib/fba/plan-tipos'
import { decimal, dias, diasEntre, dinero, entero, fechaCorta, porcentaje, ritmo, unidades } from '../formato'
import { AVISO_LINEA, CONFIANZA, MOTIVO_FUERA, PRIORIDAD } from '../comun/estilo-plan'
import { descargarCsv } from '../comun/graficos'
import { cx } from '../comun/ui'
import { AjustesSku, guardarAjusteSku } from './AjustesSku'
import { FILTROS, cajaPorGuardar, contarFiltros, filtrarLineas, ordenPorDefecto, ritmoDe, type FiltroTabla } from './calculos'
import { ImagenDeProducto } from '@/components/productos/ImagenDeProducto'

/**
 * LA TABLA DEL PLAN CON TODAS LAS REFERENCIAS DEL CLIENTE (spec remesas-pro §1.5, §2.5, §6.5, D2, D3, D13 y D43; paquete C5).
 *
 * Una fila por referencia, pida envío o no. Columnas: referencia · plan (prioridad, o el motivo por el que no se
 * propone, con el porqué debajo) · stock (vendible, de camino, dudoso y comprometido) · ritmo (con la confianza y la
 * explicación en el `title`) · cobertura y rotura · decidir / salir antes de · cantidad · caja («caja deducida: 18 ·
 * Guardar» la guarda como suya, D13). «Detalle» añade € en juego, entrante sin remesa y reservadas.
 *
 * Filtros (con su cuenta): todas · con propuesta · decidir esta semana · rompen en 30 días · exceso · fuera del plan ·
 * sin datos, y un buscador (referencia, nombre, ASIN, FNSKU, modelo). Orden inicial: lo que pide envío por prioridad,
 * después por rotura. CSV con lo filtrado.
 *
 * Al pulsar una fila se abre la ficha de la referencia en un `PanelLateral` (solo lectura + `AjustesSku`, sin portales:
 * D38 lo permite): todas las cifras del plan y sus ajustes propios. La ficha se controla desde fuera (`abierta`) para
 * que el mapa de cobertura y los grupos de atención la abran también.
 *
 * En el móvil cada referencia es una tarjeta (TablaAdaptable): título, plan, porqué y 4 datos.
 *
 * API
 *   <TablaPlanSku lineas ajustes hoy moneda clienteId puedeEditar abierta onAbrir alCambiar? cargando? />
 */

export interface TablaPlanSkuProps {
  lineas: readonly LineaPlan[]
  ajustes: Pick<AjustesReposicion, 'coberturaMaxima'>
  hoy: string
  moneda: string
  clienteId: string
  clienteNombre?: string
  puedeEditar: boolean
  /** La referencia abierta en la ficha (null = ninguna) */
  abierta: string | null
  onAbrir: (sku: string | null) => void
  /** Tras guardar algo de una referencia (caja, exclusión…) */
  alCambiar?: () => void
  cargando?: boolean
  className?: string
}

type Vista = 'resumen' | 'detalle'

const FIN = '9999-12-31'

function InsigniaPlan({ l }: { l: LineaPlan }) {
  if (l.fuera) {
    return (
      <Insignia tono="gris" variante="contorno" tamano="sm" title={MOTIVO_FUERA[l.fuera]}>
        {MOTIVO_FUERA[l.fuera]}
      </Insignia>
    )
  }
  if (l.cantidad <= 0) return <Insignia tono="gris" tamano="sm">Nada que enviar</Insignia>
  const p = PRIORIDAD[l.prioridad]
  return (
    <Insignia tono={p.tono} variante={p.variante} vivo={p.vivo} tamano="sm">
      {p.texto}
    </Insignia>
  )
}

function CeldaRitmo({ l }: { l: LineaPlan }) {
  const r = ritmoDe(l)
  const c = CONFIANZA[l.ritmo.confianza]
  return (
    <span className="inline-flex min-w-0 items-center gap-[6px]" title={l.ritmo.explicacion}>
      <span className="tabular-nums">{r === null ? '—' : ritmo(r)}</span>
      {l.ritmo.tendencia === 'sube' && <TrendingUp className="h-3 w-3 shrink-0" style={{ color: COLOR_ESTADO.verde }} aria-label="sube" />}
      {l.ritmo.tendencia === 'baja' && <TrendingDown className="h-3 w-3 shrink-0" style={{ color: COLOR_ESTADO.ambar }} aria-label="baja" />}
      {c && (
        <Insignia tono={c.tono} variante={c.variante} tamano="sm" punto={false}>
          {c.corto}
        </Insignia>
      )}
    </span>
  )
}

function CeldaStock({ l, detalle }: { l: LineaPlan; detalle?: boolean }) {
  return (
    <span className="inline-flex flex-col items-end leading-[1.25]">
      <span className="tabular-nums text-[var(--ls-t1)]">{entero(l.vendibles)}</span>
      <span className="whitespace-nowrap text-[11px] text-[var(--ls-t4)]">
        {l.deCamino > 0 && <span title="De camino a Amazon (remesas enviadas y entrante de Amazon)">+{entero(l.deCamino)} camino</span>}
        {l.comprometido > 0 && <span title="En remesas por enviar o envíos propuestos hablados"> · {entero(l.comprometido)} comprom.</span>}
        {l.dudoso > 0 && (
          <span style={{ color: COLOR_ESTADO.rojo }} title="De envíos dudosos (no cuentan para la cobertura)">
            {' '}
            · {entero(l.dudoso)} dudosas
          </span>
        )}
        {detalle && l.entranteSinRemesa > 0 && <span style={{ color: COLOR_ESTADO.ambar }}> · {entero(l.entranteSinRemesa)} sin remesa</span>}
      </span>
    </span>
  )
}

export function TablaPlanSku({ lineas, ajustes, hoy, moneda, clienteId, clienteNombre, puedeEditar, abierta, onAbrir, alCambiar, cargando, className }: TablaPlanSkuProps) {
  const [filtro, setFiltro] = useState<FiltroTabla>('todas')
  const [texto, setTexto] = useState('')
  const [vista, setVista] = useState<Vista>('resumen')
  const [guardandoCaja, setGuardandoCaja] = useState<string | null>(null)

  const ordenadas = useMemo(() => ordenPorDefecto(lineas), [lineas])
  const cuentas = useMemo(() => contarFiltros(lineas, hoy, ajustes.coberturaMaxima), [lineas, hoy, ajustes.coberturaMaxima])
  const filas = useMemo(() => filtrarLineas(ordenadas, filtro, texto, hoy, ajustes.coberturaMaxima), [ordenadas, filtro, texto, hoy, ajustes.coberturaMaxima])
  const lineaAbierta = abierta ? lineas.find((l) => l.sku === abierta) ?? null : null

  async function guardarCaja(l: LineaPlan, cajaUd: number) {
    setGuardandoCaja(l.sku)
    try {
      const r = await guardarAjusteSku(clienteId, { sku: l.sku, guardarCajaDeducida: true })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(`Caja de ${l.sku}: ${entero(cajaUd)} ud. Se usa al recalcular.`)
      alCambiar?.()
    } finally {
      setGuardandoCaja(null)
    }
  }

  const opcionesFiltro: Array<Opcion<FiltroTabla>> = FILTROS.map((f) => ({ id: f.id, texto: f.texto, cuenta: cuentas[f.id], desactivada: f.id !== 'todas' && cuentas[f.id] === 0 && filtro !== f.id }))

  const columnas: Array<Columna<LineaPlan>> = [
    {
      id: 'sku',
      cabecera: 'Referencia',
      movil: 'titulo',
      ordenar: (l) => l.sku,
      className: 'max-w-[220px]',
      celda: (l) => (
        // En una tabla automática el «truncate» de la celda no limita: el ancho máximo va en el contenido
        <span className="flex min-w-0 items-center gap-2">
        <ImagenDeProducto asin={l.asin} lado={30} redondeo={7} className="hidden sm:inline-flex" />
        <span className="block min-w-0 lg:max-w-[210px]">
          <span className="block truncate font-semibold text-[var(--ls-t1)]">{l.sku}</span>
          <span className="block truncate text-[11.5px] font-normal text-[var(--ls-t4)]">
            {[l.nombre, l.modelo && l.talla ? `${l.modelo} · ${l.talla}` : null].filter(Boolean).join(' · ') || l.asin || '—'}
          </span>
          {/* En el móvil el porqué va debajo del nombre (en el ordenador, en la columna Plan) */}
          {l.porque && <span className="mt-[3px] line-clamp-2 whitespace-normal text-[12px] font-normal leading-[1.4] text-[var(--ls-t3)] lg:hidden">{l.porque}</span>}
        </span>
        </span>
      ),
    },
    {
      id: 'plan',
      cabecera: 'Plan',
      movil: 'insignia',
      ordenar: (l) => (l.fuera ? 10 : l.cantidad > 0 ? ['tarde', 'urgente', 'esta_semana', 'proximas_2', 'este_mes', 'mas_adelante'].indexOf(l.prioridad) : 9),
      className: 'max-w-[240px]',
      celda: (l) => (
        <span className="flex min-w-0 flex-col items-start gap-[3px] max-lg:items-end">
          <InsigniaPlan l={l} />
          <span className="hidden max-w-[220px] truncate text-[11.5px] text-[var(--ls-t3)] lg:block" title={l.porque}>
            {l.porque}
          </span>
        </span>
      ),
    },
    {
      id: 'stock',
      cabecera: 'Stock',
      rotuloMovil: 'Vendible',
      alinear: 'derecha',
      ordenar: (l) => l.vendibles,
      celda: (l) => <CeldaStock l={l} detalle={vista === 'detalle'} />,
    },
    {
      id: 'ritmo',
      cabecera: 'Ritmo',
      ordenar: (l) => ritmoDe(l) ?? -1,
      celda: (l) => <CeldaRitmo l={l} />,
    },
    {
      id: 'rotura',
      cabecera: 'Cobertura',
      rotuloMovil: 'Rotura',
      alinear: 'derecha',
      ordenar: (l) => l.fechaRotura ?? FIN,
      celda: (l) => {
        const f = l.fechaRotura ?? l.fechaPrimerHueco
        const cerca = f ? diasEntre(hoy, f) : null
        // Sin fecha de rotura: «sin rotura» solo si hay stock y aguanta; agotada es agotada, y sin datos no se afirma nada
        if (!f && l.fuera === 'sin_datos') {
          return <span className="text-[var(--ls-t4)]">—</span>
        }
        if (!f && l.vendibles <= 0) {
          return (
            <span className="inline-flex flex-col items-end leading-[1.25]">
              <span style={{ color: l.deCamino + l.comprometido > 0 ? COLOR_ESTADO.ambar : COLOR_ESTADO.rojo }}>Agotada</span>
              <span className="text-[11px] text-[var(--ls-t4)]">{l.deCamino + l.comprometido > 0 ? `${l.deCamino + l.comprometido} ud de camino` : 'sin stock'}</span>
            </span>
          )
        }
        return (
          <span className="inline-flex flex-col items-end leading-[1.25]">
            <span className="tabular-nums" style={cerca !== null && cerca <= 14 ? { color: COLOR_ESTADO.rojo } : undefined}>
              {f ? fechaCorta(f, hoy) : 'sin rotura'}
            </span>
            <span className="text-[11px] text-[var(--ls-t4)]">{l.coberturaConLoQueViene !== null ? `${dias(l.coberturaConLoQueViene)} con lo que viene` : l.coberturaDias !== null ? dias(l.coberturaDias) : '—'}</span>
          </span>
        )
      },
    },
    {
      id: 'decidir',
      cabecera: 'Decidir / salir',
      rotuloMovil: 'Salir antes del',
      ordenar: (l) => (l.fuera === null && l.cantidad > 0 ? l.decidirAntesDe ?? FIN : FIN),
      celda: (l) =>
        l.fuera === null && l.cantidad > 0 ? (
          <span className="inline-flex flex-col leading-[1.25]">
            <span className="tabular-nums max-lg:hidden">{fechaCorta(l.decidirAntesDe, hoy)}</span>
            <span className="text-[11px] text-[var(--ls-t4)] max-lg:text-[13px] max-lg:text-[var(--ls-t1)]">
              <span className="lg:hidden">{fechaCorta(l.salirAntesDe, hoy)}</span>
              <span className="max-lg:hidden">salir antes del {fechaCorta(l.salirAntesDe, hoy)}</span>
            </span>
            {l.vaTarde && <span className="text-[11px]" style={{ color: COLOR_ESTADO.rojo }}>va tarde</span>}
          </span>
        ) : (
          <span className="text-[var(--ls-t4)]">—</span>
        ),
    },
    {
      id: 'cantidad',
      cabecera: 'Enviar',
      alinear: 'derecha',
      ordenar: (l) => (l.fuera === null ? l.cantidad : 0),
      celda: (l) =>
        l.fuera === null && l.cantidad > 0 ? (
          <span className="inline-flex flex-col items-end leading-[1.25]">
            <b className="tabular-nums text-[var(--ls-t1)]">{unidades(l.cantidad)}</b>
            {l.cajas !== null && (
              <span className="whitespace-nowrap text-[11px] text-[var(--ls-t4)]">
                {entero(l.cajas)} {l.cajas === 1 ? 'caja' : 'cajas'}
                {vista !== 'detalle' && l.caja ? ` de ${entero(l.caja.unidades)}` : ''}
              </span>
            )}
          </span>
        ) : (
          <span className="text-[var(--ls-t4)]">—</span>
        ),
    },
  ]

  // La caja va en «Detalle»: en el ordenador con la barra lateral (~1180 px) la tabla no cabe con ella y la escondía a la derecha
  if (vista === 'detalle') {
    columnas.push(
      {
        id: 'caja',
        cabecera: 'Caja',
        movil: 'oculto',
        celda: (l) => {
          const deducida = cajaPorGuardar(l)
          if (deducida !== null) {
            return (
              <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12px]" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                <span className="text-[var(--ls-t3)]">
                  caja deducida: <b className="tabular-nums text-[var(--ls-t1)]">{entero(deducida)}</b>
                </span>
                {puedeEditar && (
                  <button
                    type="button"
                    disabled={guardandoCaja === l.sku}
                    onClick={() => void guardarCaja(l, deducida)}
                    className="inline-flex items-center gap-1 rounded-[6px] px-1 font-medium text-[var(--ls-acc)] hover:underline disabled:opacity-50"
                    title="Guardarla como la caja de esta referencia"
                  >
                    · <Save className="h-3 w-3" aria-hidden /> Guardar
                  </button>
                )}
              </span>
            )
          }
          return l.caja ? (
            <span className="whitespace-nowrap text-[12px] text-[var(--ls-t3)]">
              <b className="tabular-nums text-[var(--ls-t1)]">{entero(l.caja.unidades)}</b> {l.caja.origen === 'sku' ? 'suya' : 'del cliente'}
            </span>
          ) : (
            <span className="text-[12px] text-[var(--ls-t4)]">~</span>
          )
        },
      },
      {
        id: 'euros',
        cabecera: 'En juego',
        alinear: 'derecha',
        movil: 'oculto',
        ordenar: (l) => l.eurosEnRiesgo ?? -1,
        celda: (l) => <span className="tabular-nums" title="Ventas que se pierden en los próximos días si no se envía nada">{l.eurosEnRiesgo === null ? (l.precio === null ? 'sin precio' : '—') : dinero(l.eurosEnRiesgo, l.moneda || moneda)}</span>,
      },
      {
        id: 'avisos',
        cabecera: 'Avisos',
        movil: 'oculto',
        celda: (l) =>
          l.avisos.length === 0 ? (
            <span className="text-[var(--ls-t4)]">—</span>
          ) : (
            <span className="flex max-w-[260px] flex-wrap gap-1">
              {l.avisos.slice(0, 3).map((a) => (
                <Insignia key={a} tono={AVISO_LINEA[a].tono} tamano="sm">
                  {AVISO_LINEA[a].texto}
                </Insignia>
              ))}
              {l.avisos.length > 3 && <span className="text-[11px] text-[var(--ls-t4)]">+{l.avisos.length - 3}</span>}
            </span>
          ),
      },
    )
  }

  function csv() {
    descargarCsv(
      `plan-reposicion-${(clienteNombre ?? clienteId).replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}-${hoy}.csv`,
      ['Referencia', 'Nombre', 'Plan', 'Vendible', 'De camino', 'Dudoso', 'Comprometido', 'Ritmo (ud/día)', 'Confianza', 'Rotura', 'Cobertura con lo que viene (días)', 'Decidir antes del', 'Salir antes del', 'Enviar (ud)', 'Cajas', 'Caja (ud)', `En juego`, 'Por qué'],
      filas.map((l) => [
        l.sku,
        l.nombre,
        l.fuera ? MOTIVO_FUERA[l.fuera] : PRIORIDAD[l.prioridad].texto,
        l.vendibles,
        l.deCamino,
        l.dudoso,
        l.comprometido,
        ritmoDe(l) === null ? '' : decimal(ritmoDe(l), 2),
        l.ritmo.confianza,
        l.fechaRotura,
        l.coberturaConLoQueViene === null ? '' : Math.round(l.coberturaConLoQueViene),
        l.fuera === null ? l.decidirAntesDe : '',
        l.fuera === null ? l.salirAntesDe : '',
        l.fuera === null ? l.cantidad : 0,
        l.cajas,
        l.caja?.unidades ?? '',
        l.eurosEnRiesgo === null ? '' : Math.round(l.eurosEnRiesgo),
        l.porque,
      ]),
    )
  }

  return (
    <div className={cx('min-w-0 space-y-3', className)}>
      {/* Se parte en dos filas cuando no cabe (con la barra lateral abierta a 1440 px el contenido mide 1120): el ancho que cuenta
          es el del contenido, no el de la ventana, así que no vale un punto de corte */}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <Segmentado etiqueta="Filtrar referencias" opciones={opcionesFiltro} valor={filtro} onCambio={setFiltro} tamano="sm" className="max-w-full" />
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:flex-none">
          <label className="relative min-w-0 flex-1 sm:w-[240px] sm:flex-none">
            <span className="sr-only">Buscar referencia</span>
            <Search className="pointer-events-none absolute left-[9px] top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-[var(--ls-t4)]" aria-hidden />
            <input
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Referencia, nombre, ASIN…"
              className={cx(CAMPO.input, 'h-8 rounded-[10px] pl-[30px] pr-7', TACTIL)}
            />
            {texto && (
              <button type="button" onClick={() => setTexto('')} className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-[6px] text-[var(--ls-t4)] hover:text-[var(--ls-t1)]" aria-label="Borrar la búsqueda">
                <X className="h-3 w-3" />
              </button>
            )}
          </label>
          <span className="hidden lg:inline-flex">
            <Segmentado
              etiqueta="Columnas"
              tamano="sm"
              valor={vista}
              onCambio={setVista}
              opciones={[
                { id: 'resumen', texto: 'Resumen' },
                { id: 'detalle', texto: 'Detalle' },
              ]}
            />
          </span>
          <Boton tamano="sm" variante="fantasma" icono={Download} onClick={csv} disabled={filas.length === 0} soloIcono aria-label="Descargar lo filtrado en CSV" title="Descargar lo filtrado en CSV" />
        </div>
      </div>

      <TablaAdaptable
        etiqueta="Plan de reposición por referencia"
        columnas={columnas}
        filas={filas}
        claveDe={(l) => l.sku}
        alPulsarFila={(l) => onAbrir(l.sku)}
        filaActiva={abierta}
        porPagina={50}
        cargando={cargando}
        vacio={{
          icono: PackageSearch,
          titulo: texto ? 'Ninguna referencia coincide' : 'Nada en este filtro',
          descripcion: texto ? `No hay referencias con «${texto}».` : 'Prueba con «Todas».',
          accion: texto || filtro !== 'todas' ? { texto: 'Ver todas', onClick: () => { setTexto(''); setFiltro('todas') } } : undefined,
        }}
      />

      <PanelLateral
        abierto={lineaAbierta !== null}
        onCambio={(a) => !a && onAbrir(null)}
        titulo={lineaAbierta?.sku ?? ''}
        descripcion={lineaAbierta?.nombre ?? undefined}
        icono={PackageSearch}
        acento="remesas"
        ancho={520}
      >
        {lineaAbierta && <FichaLinea l={lineaAbierta} hoy={hoy} moneda={moneda} clienteId={clienteId} puedeEditar={puedeEditar} alCambiar={alCambiar} />}
      </PanelLateral>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Ficha de una referencia                                             */
/* ------------------------------------------------------------------ */

function FichaLinea({ l, hoy, moneda, clienteId, puedeEditar, alCambiar }: { l: LineaPlan; hoy: string; moneda: string; clienteId: string; puedeEditar: boolean; alCambiar?: () => void }) {
  const r = l.ritmo
  const m = l.moneda || moneda
  const pide = l.fuera === null && l.cantidad > 0
  return (
    <div className="space-y-5 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <InsigniaPlan l={l} />
        {CONFIANZA[r.confianza] && (
          <Insignia tono={CONFIANZA[r.confianza]!.tono} variante={CONFIANZA[r.confianza]!.variante} tamano="sm">
            {CONFIANZA[r.confianza]!.texto}
          </Insignia>
        )}
        {l.avisos.map((a) => (
          <Insignia key={a} tono={AVISO_LINEA[a].tono} tamano="sm">
            {AVISO_LINEA[a].texto}
          </Insignia>
        ))}
      </div>

      <p className="rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-[10px] text-[13px] leading-[1.55] text-[var(--ls-t1)]">{l.porque || 'Sin explicación.'}</p>

      <Bloque titulo="Stock">
        <Cifra t="Vendible" v={entero(l.vendibles)} />
        <Cifra t="De camino" v={entero(l.deCamino)} n={l.entranteSinRemesa > 0 ? `${entero(l.entranteSinRemesa)} sin remesa` : undefined} />
        <Cifra t="Comprometido" v={entero(l.comprometido)} n="remesas por enviar y hablados" />
        <Cifra t="Dudoso" v={entero(l.dudoso)} n="no cuenta" tono={l.dudoso > 0 ? 'rojo' : undefined} />
        <Cifra t="Reservadas" v={l.reservadas === null ? '—' : entero(l.reservadas)} />
        <Cifra t="Precio" v={l.precio === null ? 'sin precio' : dinero(l.precio, m, 2)} />
      </Bloque>

      <Bloque titulo="Ritmo">
        <Cifra t="Previsto" v={ritmo(r.previsto)} n={r.factorEstacional > 1 ? `temporada ×${decimal(r.factorEstacional, 2)}` : undefined} />
        <Cifra t="Base" v={ritmo(r.base)} n={r.origen === 'modelo' ? 'del modelo, por tallas' : r.origen === 'ultimo_periodo' ? `último periodo con stock${r.ultimoPeriodoHasta ? `, hasta el ${fechaCorta(r.ultimoPeriodoHasta, hoy)}` : ''}` : undefined} />
        <Cifra t="Consumo neto" v={ritmo(r.consumoNeto)} n={r.tasaDevolucionVendible > 0 ? `${porcentaje(r.tasaDevolucionVendible * 100, 0)} vuelve vendible` : undefined} />
        <Cifra t="14 / 30 / 90 d" v={[r.r14, r.r30, r.r90].map((x) => (x === null ? '—' : decimal(x, 2))).join(' / ')} />
        <Cifra t="Ventas 30 / 90 d" v={`${entero(r.ventas30)} / ${entero(r.ventas90)}`} n={`${entero(r.diasConStock90)} días con stock de 90`} />
        <Cifra t="Tendencia" v={r.tendencia === 'sube' ? 'Sube' : r.tendencia === 'baja' ? 'Baja' : r.tendencia === 'estable' ? 'Estable' : '—'} />
      </Bloque>
      <p className="-mt-3 text-[12px] leading-[1.5] text-[var(--ls-t3)]">{r.explicacion}</p>

      <Bloque titulo="Fechas">
        <Cifra t="Rotura" v={fechaCorta(l.fechaRotura, hoy)} n={l.coberturaConLoQueViene !== null ? `${dias(l.coberturaConLoQueViene)} con lo que viene` : undefined} />
        <Cifra t="Primer hueco" v={fechaCorta(l.fechaPrimerHueco, hoy)} n={l.diasSinStockInevitables > 0 ? `${dias(l.diasSinStockInevitables)} sin stock inevitables` : undefined} />
        <Cifra t="Decidir antes del" v={pide ? fechaCorta(l.decidirAntesDe, hoy) : '—'} />
        <Cifra t="Salir antes del" v={pide ? fechaCorta(l.salirAntesDe, hoy) : '—'} />
        <Cifra t="A la venta" v={fechaCorta(l.aLaVentaObjetivo, hoy)} n={l.aLaVentaUrgente ? `en avión, el ${fechaCorta(l.aLaVentaUrgente, hoy)}` : undefined} />
        <Cifra t="Cubre tras llegar" v={dias(l.coberturaEfectiva)} />
      </Bloque>

      <Bloque titulo="Cantidad">
        <Cifra t="Enviar" v={pide ? unidades(l.cantidad) : '—'} n={l.adelantada ? 'adelantada para aprovechar el envío' : undefined} />
        <Cifra t="Cajas" v={l.cajas === null ? '—' : entero(l.cajas)} n={l.caja ? `de ${entero(l.caja.unidades)} ud (${l.caja.origen === 'sku' ? 'suya' : l.caja.origen === 'deducida' ? 'deducida' : 'del cliente'})` : 'sin caja conocida'} />
        <Cifra t="Necesidad / tope" v={`${entero(l.necesidad)} / ${entero(l.tope)}`} />
        <Cifra t="En juego" v={l.eurosEnRiesgo === null ? '—' : dinero(l.eurosEnRiesgo, m)} n="si no se envía nada" />
        <Cifra t="Si va tarde" v={l.eurosSiVaTarde === null ? '—' : dinero(l.eurosSiVaTarde, m)} />
        {l.ajusteIa && <Cifra t="Ajuste de la IA" v={l.ajusteIa.valor === null ? l.ajusteIa.tipo : `${l.ajusteIa.tipo} ${decimal(l.ajusteIa.valor, 2)}`} n={l.ajusteIa.motivo} />}
      </Bloque>

      <section className="space-y-2 border-t border-[var(--ls-linea)] pt-4">
        <h4 className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--ls-t4)]">Ajustes de esta referencia</h4>
        <AjustesSku clienteId={clienteId} sku={l.sku} linea={l} puedeEditar={puedeEditar} alGuardar={alCambiar} />
      </section>
    </div>
  )
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--ls-t4)]">{titulo}</h4>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">{children}</dl>
    </section>
  )
}

function Cifra({ t, v, n, tono }: { t: string; v: string; n?: string; tono?: 'rojo' }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] text-[var(--ls-t4)]">{t}</dt>
      <dd className="truncate text-[14px] font-semibold tabular-nums text-[var(--ls-t1)]" style={tono ? { color: COLOR_ESTADO[tono] } : undefined}>
        {v}
      </dd>
      {n && <dd className="truncate text-[11px] text-[var(--ls-t3)]" title={n}>{n}</dd>}
    </div>
  )
}
