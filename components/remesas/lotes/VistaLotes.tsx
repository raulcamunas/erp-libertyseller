'use client'

import { useMemo, useState } from 'react'
import { ArrowUpRight, Boxes, Clock, GanttChartSquare, Info, PackageX, RefreshCw, Timer, Truck } from 'lucide-react'
import { Boton, EstadoVacio, EsqueletoTarjeta, FilaDeKpis, Insignia, Kpi, TablaAdaptable, Tarjeta, type Columna } from '@/components/ui-ls'
import type { LoteEnvio } from '@/lib/fba/plan-tipos'
import { decimal, entero, fechaCorta } from '../formato'
import { CronogramaLotes } from './CronogramaLotes'
import { CurvasConsumo } from './CurvasConsumo'
import { EmbudoLote } from './EmbudoLote'
import { loteDestacado, textoDuracion, useLotes, velocidadDe, type RespuestaLotes } from './useLotes'

/**
 * LOTES: EL FIFO VISUAL DE UN CLIENTE (sección `lotes`, spec remesas-pro §5.3). GET /api/fba/lotes?cliente=.
 *
 *   · KPI: lo que dura un envío (mediana, de llegada a agotado), lo que tarda en llegar, lo que se pierde por el camino
 *     y los envíos vivos.
 *   · Cronograma de lotes (recharts en el escritorio, tarjetas en el móvil). Pulsar un envío lo abre debajo.
 *   · El envío elegido: embudo al 100 %, curvas de consumo frente a los 8 últimos agotados y sus referencias con la
 *     insignia «Lote vivo» (el lote del que el FIFO está vendiendo ahora esa referencia).
 *   · La nota fija del FIFO.
 *
 * Lo mismo para un solo envío, en la pestaña «Lotes» del detalle: TabLotes (usa <DetalleLote>).
 *
 *   <VistaLotes clienteId hoy? onAbrirEnvio? />
 *   <DetalleLote lote lotes resumen hoy onAbrirEnvio? />
 *   <NotaFifo />
 */

export function VistaLotes({ clienteId, hoy: hoyDado, onAbrirEnvio }: { clienteId: string; hoy?: string; onAbrirEnvio?: (remesaId: string) => void }) {
  const hoy = hoyDado ?? diaDeHoy()
  const { lotes, resumen, ritmo, cargando, error, recargar, hayDatos } = useLotes(clienteId)
  const [elegido, setElegido] = useState<string | null>(null)
  const lote = useMemo(() => lotes.find((l) => l.remesaId === elegido) ?? loteDestacado(lotes), [lotes, elegido])

  if (!hayDatos && cargando) {
    return (
      <div className="space-y-4" aria-busy>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Kpi key={i} etiqueta="…" valor={null} cargando />
          ))}
        </div>
        <EsqueletoTarjeta />
      </div>
    )
  }
  if (!hayDatos && error) {
    return (
      <div className="rounded-[14px] border border-dashed border-[var(--ls-linea2)] bg-[var(--ls-sup)]">
        <EstadoVacio icono={GanttChartSquare} acento="remesas" titulo="No se han podido calcular los lotes" descripcion={error} accion={{ texto: 'Volver a probar', icono: RefreshCw, onClick: () => void recargar() }} />
      </div>
    )
  }
  if (lotes.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-[14px] border border-dashed border-[var(--ls-linea2)] bg-[var(--ls-sup)]">
          <EstadoVacio
            icono={GanttChartSquare}
            acento="remesas"
            titulo="Todavía no hay envíos que seguir"
            descripcion="Cuando un envío salga hacia Amazon, aquí se verá cuánto tarda en llegar, a qué ritmo se vende y cuánto dura."
          />
        </div>
        <NotaFifo />
      </div>
    )
  }

  return (
    <div className="min-w-0 space-y-4">
      <FilaDeKpis minimo={200}>
        <Kpi
          indice={0}
          acento="remesas"
          icono={Timer}
          etiqueta="Un envío dura"
          valor={resumen?.duracionMediana ?? null}
          formato={(n) => `${entero(n)} días`}
          nota="mediana, de llegada a agotado (12 meses)"
        />
        <Kpi indice={1} acento="remesas" icono={Truck} etiqueta="Tarda en llegar" valor={resumen?.transitoMediano ?? null} formato={(n) => `${entero(n)} días`} nota="mediana, del envío a la llegada" />
        <Kpi
          indice={2}
          acento="remesas"
          icono={PackageX}
          etiqueta="Se pierde por el camino"
          valor={resumen?.pctNoLlegadoMedio ?? null}
          formato={(n) => `${decimal(n, 1)} %`}
          nota="de lo enviado, en los ya contados"
        />
        <Kpi indice={3} acento="remesas" icono={Boxes} etiqueta="Envíos vivos" valor={resumen?.vivos ?? 0} nota="con unidades que vender" />
      </FilaDeKpis>

      <Tarjeta
        acento="remesas"
        icono={GanttChartSquare}
        titulo="Cronograma de lotes"
        subtitulo="Cuánto tardó cada envío en llegar y cuánto le duró la venta. Pulsa uno para verlo abajo"
        acciones={cargando ? <RefreshCw className="h-4 w-4 animate-spin text-[var(--ls-t4)] motion-reduce:animate-none" aria-label="Actualizando" /> : undefined}
      >
        <CronogramaLotes lotes={lotes} hoy={hoy} seleccionado={lote?.remesaId ?? null} onElegir={setElegido} />
      </Tarjeta>

      {lote && <DetalleLote lote={lote} lotes={lotes} resumen={resumen} hoy={hoy} onAbrirEnvio={onAbrirEnvio} />}

      <NotaFifo ritmo={ritmo} />
    </div>
  )
}

/** Un lote: cabecera con su duración, embudo, curvas frente a los anteriores y sus referencias */
export function DetalleLote({
  lote,
  lotes,
  resumen,
  hoy,
  onAbrirEnvio,
}: {
  lote: LoteEnvio
  lotes: ReadonlyArray<LoteEnvio>
  resumen: RespuestaLotes['resumen'] | null
  hoy: string
  onAbrirEnvio?: (remesaId: string) => void
}) {
  const velocidad = velocidadDe(resumen, lote.remesaId)
  type FilaSku = LoteEnvio['porSku'][number]
  const columnas: Columna<FilaSku>[] = [
    {
      id: 'sku',
      cabecera: 'Referencia',
      celda: (s) => (
        <span className="flex min-w-0 flex-col lg:flex-row lg:items-baseline lg:gap-2">
          <span className="shrink-0 whitespace-nowrap font-mono text-[12px] text-[var(--ls-t3)]">{s.sku}</span>
          {/* El ancho máximo va en el contenido: el «truncate» dentro de una celda de tabla automática no limita y escondía «Quedan» y «Duración» */}
          <span className="block min-w-0 truncate font-normal text-[var(--ls-t1)] lg:max-w-[32ch]" title={s.nombre ?? undefined}>{s.nombre ?? '—'}</span>
        </span>
      ),
      ordenar: (s) => s.sku,
      movil: 'titulo',
    },
    {
      id: 'vivo',
      cabecera: 'Estado',
      rotuloMovil: 'Lote vivo',
      celda: (s) =>
        s.loteVivo ? (
          <Insignia tono="cian" tamano="sm" vivo title="El FIFO está vendiendo esta referencia de este envío ahora mismo">
            Lote vivo
          </Insignia>
        ) : null,
      ordenar: (s) => (s.loteVivo ? 0 : 1),
      movil: 'insignia',
    },
    { id: 'enviadas', cabecera: 'Enviadas', celda: (s) => entero(s.enviadas), ordenar: (s) => s.enviadas, alinear: 'derecha' },
    { id: 'recibidas', cabecera: 'Recibidas', celda: (s) => entero(s.recibidas), ordenar: (s) => s.recibidas, alinear: 'derecha' },
    { id: 'vendidas', cabecera: 'Vendidas', celda: (s) => entero(s.vendidas), ordenar: (s) => s.vendidas, alinear: 'derecha' },
    {
      id: 'retiradas',
      cabecera: 'Retir. o mermas',
      rotuloMovil: 'Retiradas o mermas',
      celda: (s) => (s.retiradasYMermas > 0 ? <span className="text-[var(--ls-e-magenta)]">{entero(s.retiradasYMermas)}</span> : <span className="text-[var(--ls-t4)]">—</span>),
      ordenar: (s) => s.retiradasYMermas,
      alinear: 'derecha',
    },
    { id: 'quedan', cabecera: 'Quedan', celda: (s) => <b className="font-semibold text-[var(--ls-t1)]">{entero(s.quedan)}</b>, ordenar: (s) => s.quedan, alinear: 'derecha' },
    {
      id: 'duracion',
      cabecera: 'Duración',
      celda: (s) =>
        s.d100 !== null ? (
          `${entero(s.d100)} d`
        ) : s.estimada !== null ? (
          <span className="text-[var(--ls-t3)]" title="Estimado con el ritmo de la referencia y lo que tiene delante en el FIFO">
            ~{entero(s.estimada)} d
          </span>
        ) : (
          <span className="text-[var(--ls-t4)]">—</span>
        ),
      ordenar: (s) => s.d100 ?? s.estimada ?? 1e9,
      alinear: 'derecha',
    },
  ]

  return (
    <Tarjeta
      variante="destacada"
      acento="remesas"
      titulo={lote.nombre}
      subtitulo={[lote.referenciaEnvio, lote.fechaEnvio ? `salió el ${fechaCorta(lote.fechaEnvio, hoy)}` : null, lote.fechaLlegada ? `llegó el ${fechaCorta(lote.fechaLlegada, hoy)}` : null]
        .filter(Boolean)
        .join(' · ')}
      acciones={
        onAbrirEnvio ? (
          <Boton tamano="sm" variante="fantasma" iconoDerecha={ArrowUpRight} onClick={() => onAbrirEnvio(lote.remesaId)}>
            Abrir el envío
          </Boton>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Dato icono={Clock} rotulo={lote.duracionDias !== null ? 'Duración' : 'Lo que le queda'} valor={textoDuracion(lote, hoy)} />
          {lote.diasTransito !== null && <Dato icono={Truck} rotulo="Tránsito" valor={`${entero(lote.diasTransito)} días`} />}
          {lote.hitos.d50 !== null && <Dato rotulo="Mitad vendida" valor={`día ${entero(lote.hitos.d50)}`} />}
          {lote.hitos.d80 !== null && <Dato rotulo="80 % vendido" valor={`día ${entero(lote.hitos.d80)}`} />}
          {velocidad && <Dato rotulo="Frente a los demás" valor={velocidad} />}
        </div>

        <section aria-label="Embudo del envío">
          <h4 className="mb-2 text-[12.5px] font-semibold text-[var(--ls-t2)]">De lo enviado a lo vendido</h4>
          <EmbudoLote embudo={lote.embudo} />
        </section>

        <section aria-label="Curvas de consumo">
          <h4 className="mb-1 text-[12.5px] font-semibold text-[var(--ls-t2)]">¿Se vende más rápido o más lento que los anteriores?</h4>
          <p className="mb-2 text-[12px] text-[var(--ls-t4)]">% vendido de lo que se podía vender, por días desde la llegada</p>
          <CurvasConsumo lotes={lotes} destacado={lote.remesaId} />
        </section>

        <section aria-label="Referencias del envío">
          <h4 className="mb-2 text-[12.5px] font-semibold text-[var(--ls-t2)]">Referencias</h4>
          <TablaAdaptable
            etiqueta={`Referencias de ${lote.nombre}`}
            columnas={columnas}
            filas={lote.porSku}
            claveDe={(s) => s.sku}
            ordenInicial={{ id: 'vendidas', sentido: 'desc' }}
            vacio={{ icono: Boxes, titulo: 'Este envío no tiene referencias' }}
          />
        </section>
      </div>
    </Tarjeta>
  )
}

/** La nota del FIFO (la misma que lleva el informe PDF) y de dónde sale el ritmo de lo que queda */
export function NotaFifo({ ritmo }: { ritmo?: RespuestaLotes['ritmo'] | null }) {
  return (
    <p className="flex items-start gap-2 px-1 text-[12px] leading-[1.55] text-[var(--ls-t4)]">
      <Info className="mt-[2px] h-[13px] w-[13px] shrink-0" aria-hidden />
      <span>
        El FIFO es una convención: Amazon no dice de qué envío sale cada venta; se asume que primero se vende lo que llegó antes.
        {ritmo &&
          (ritmo.origen === 'plan'
            ? ` Lo que le queda a un envío vivo se estima con el ritmo del planificador${ritmo.calculadoAt ? ` (calculado el ${fechaCorta(ritmo.calculadoAt.slice(0, 10))})` : ''}.`
            : ' Lo que le queda a un envío vivo se estima con el ritmo del inventario (todavía no hay plan calculado).')}
      </span>
    </p>
  )
}

function Dato({ rotulo, valor, icono: Icono }: { rotulo: string; valor: string; icono?: typeof Clock }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-[6px] text-[11.5px] font-medium text-[var(--ls-t3)]">
        {Icono && <Icono className="h-3 w-3" aria-hidden />}
        {rotulo}
      </div>
      <div className="mt-[2px] text-[15px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)]">{valor}</div>
    </div>
  )
}

/** Hoy en España (YYYY-MM-DD), por si quien monta no lo pasa */
function diaDeHoy(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}
