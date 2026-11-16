'use client'

import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { CifraAnimada } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { RemesaDePanel } from '@/lib/fba/datos'
import type { ResumenRitmo } from '@/lib/fba/analisis'
import { VIZ } from '../comun/graficos'
import { cx } from '../comun/ui'
import { entero, fecha, ritmo as textoRitmo } from '../formato'
import { cuentasDeEnvio } from './reglas'

/**
 * LAS CIFRAS DE UN ENVÍO.
 *
 * Son siempre las mismas: lo que se manda, lo que ha llegado, lo VENDIDO (solo ventas), lo retirado o perdido (aparte:
 * sale del stock pero no es venta), lo que queda, a qué ritmo y para cuántos días.
 *
 * EL RITMO SE LLAMA «RITMO DE ESTE ENVÍO» y lleva al lado el de la referencia (spec remesas-pro §1.1): el de un envío es
 * el de su lote FIFO —si delante hay otro envío más antiguo de las mismas referencias, este vende 0 aunque las
 * referencias vendan mucho—; el de la referencia es el número único del planificador, sumado sobre las del envío.
 *
 * API
 *   <CifrasEnvio remesa ritmo ritmoReferencia? variante? />
 *     variante 'fila'     las ocho en una rejilla que se reparte (cabecera del detalle desde lg)
 *     variante 'clave'    solo cuatro (recibidas, vendidas, quedan y para cuántos días): el móvil
 *     variante 'rejilla'  las ocho de dos en dos (una columna estrecha)
 *   `rejilla` (booleano) se acepta por compatibilidad = variante 'rejilla'.
 */

export interface RitmoDeReferencia {
  total: number | null
  origen: 'plan' | 'panel' | 'mixto' | null
}

type Variante = 'fila' | 'clave' | 'rejilla'

export function CifrasEnvio({
  remesa,
  ritmo,
  ritmoReferencia = null,
  variante,
  rejilla = false,
}: {
  remesa: RemesaDePanel
  ritmo: ResumenRitmo
  ritmoReferencia?: RitmoDeReferencia | null
  variante?: Variante
  rejilla?: boolean
}) {
  const v: Variante = variante ?? (rejilla ? 'rejilla' : 'fila')
  const c = cuentasDeEnvio(remesa)
  const faltan = remesa.unidadesQueNoLlegaron
  const urgente = ritmo.cobertura !== null && ritmo.cobertura < 7
  const pronto = ritmo.cobertura !== null && ritmo.cobertura < 14

  const origenRef =
    ritmoReferencia?.origen === 'plan'
      ? 'El ritmo de las referencias de este envío según el planificador (ud/día, media de 14/30/90 días con stock), sumadas'
      : ritmoReferencia?.origen === 'mixto'
        ? 'El ritmo de las referencias según el planificador; las que no salen en el plan, con la media de 30 días del panel'
        : 'Sin plan calculado: el ritmo de las referencias es la media de 30 días del panel'

  const celdas: Record<string, ReactNode> = {
    enviadas: <Celda key="enviadas" rotulo="Enviadas" valor={c.enviadas} sub={`${c.referencias} referencia${c.referencias === 1 ? '' : 's'}`} />,
    recibidas: (
      <Celda
        key="recibidas"
        rotulo="Recibidas"
        valor={c.sinPreguntar ? null : c.recibidas}
        color={VIZ.recibidas}
        sub={
          c.sinPreguntar ? (
            'sin consultar a Amazon'
          ) : faltan > 0 ? (
            <span className="inline-flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" style={{ color: COLOR_ESTADO.ambar }} aria-hidden />
              faltan {entero(faltan)}
            </span>
          ) : (
            `${Math.round((c.recibidas / Math.max(1, c.enviadas)) * 100)} % de lo enviado`
          )
        }
      />
    ),
    vendidas: (
      <Celda
        key="vendidas"
        rotulo="Vendidas"
        valor={c.vendidas}
        color={VIZ.vendidas}
        sub={c.recibidas === 0 && !c.sinPreguntar ? 'nada recibido aún' : `${Math.round((c.vendidas / c.base) * 100)} % de lo ${c.sinPreguntar ? 'enviado' : 'recibido'}`}
        pista="Solo ventas, en neto de devoluciones. Las retiradas y las mermas van aparte"
      />
    ),
    retiradas: (
      <Celda
        key="retiradas"
        rotulo="Retiradas y mermas"
        valor={c.retiradasYMermas}
        color="var(--ls-e-magenta)"
        aviso={c.retiradasYMermas > 0 ? 'ambar' : undefined}
        sub={
          c.retiradasYMermas > 0
            ? [c.retiradas > 0 ? `${entero(c.retiradas)} retirada${c.retiradas === 1 ? '' : 's'}` : '', c.mermas > 0 ? `${entero(c.mermas)} merma${c.mermas === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')
            : 'ninguna'
        }
        pista="Salen del stock de este envío pero no son ventas: retiradas del almacén y lo que Amazon da por perdido o dañado"
      />
    ),
    quedan: (
      <Celda
        key="quedan"
        rotulo="Quedan"
        valor={c.quedan}
        color={VIZ.quedan}
        sub={`${c.recibidas === 0 && !c.sinPreguntar ? 'sin recibir aún' : `${Math.round((c.quedan / c.base) * 100)} %`}${c.agotadas > 0 ? ` · ${c.agotadas} agotada${c.agotadas === 1 ? '' : 's'}` : ''}`}
      />
    ),
    ritmo: (
      <Celda
        key="ritmo"
        rotulo="Ritmo de este envío"
        valor={ritmo.udDia7}
        decimales
        unidad="ud/día"
        pista="Lo que ha salido de ESTE envío por día en los últimos 7 días (reparto FIFO: primero se vende lo que llegó antes)"
        sub={
          ritmoReferencia?.total != null ? (
            <span title={origenRef}>
              referencia: <b className="font-semibold text-[var(--ls-t2)]">{textoRitmo(ritmoReferencia.total)}</b>
            </span>
          ) : (
            'últimos 7 días'
          )
        }
      />
    ),
    cobertura: (
      <Celda
        key="cobertura"
        rotulo="Stock para"
        valor={ritmo.cobertura === null ? null : Math.round(ritmo.cobertura)}
        unidad={ritmo.cobertura === null ? undefined : 'días'}
        aviso={urgente ? 'rojo' : pronto ? 'ambar' : undefined}
        sub={ritmo.seAgotaEl ? `se agota el ${fecha(ritmo.seAgotaEl)}` : remesa.quedan === 0 ? 'agotado' : 'sin ventas ahora'}
        pista="Lo que queda de este envío entre el ritmo de este envío"
      />
    ),
    devueltas: (
      <Celda key="devueltas" rotulo="Devueltas" valor={c.devueltas} sub={c.devueltas > 0 ? 'ya descontadas' : 'ninguna'} aviso={c.devueltas > 0 ? 'ambar' : undefined} />
    ),
  }

  const orden = v === 'clave' ? ['recibidas', 'vendidas', 'quedan', 'cobertura'] : ['enviadas', 'recibidas', 'vendidas', 'retiradas', 'quedan', 'ritmo', 'cobertura', 'devueltas']

  return (
    <div
      className={cx(
        'grid gap-px overflow-hidden bg-[var(--ls-linea)]',
        v === 'fila' ? 'grid-cols-2 sm:grid-cols-4 2xl:grid-cols-8' : 'grid-cols-2'
      )}
    >
      {orden.map((k) => celdas[k])}
    </div>
  )
}

function Celda({
  rotulo,
  valor,
  unidad,
  sub,
  color,
  aviso,
  pista,
  decimales = false,
}: {
  rotulo: string
  valor: number | null
  unidad?: string
  sub?: ReactNode
  /** El color de la serie en los gráficos: liga la cifra con lo que se ve abajo */
  color?: string
  aviso?: 'rojo' | 'ambar'
  /** Lo que explica la cifra, al pasar el ratón por encima */
  pista?: string
  decimales?: boolean
}) {
  return (
    <div className="min-w-0 bg-[var(--ls-sup)] px-4 py-3" title={pista}>
      <div className="flex items-center gap-[6px] truncate text-[11.5px] font-medium text-[var(--ls-t3)]">
        {color && <span className="h-[8px] w-[8px] shrink-0 rounded-[2px]" style={{ background: color }} aria-hidden />}
        <span className="truncate">{rotulo}</span>
      </div>
      <div className="mt-[3px] flex items-baseline gap-[5px] whitespace-nowrap">
        <span className="text-[22px] font-semibold leading-[1.1] tracking-[-0.025em] text-[var(--ls-t1)] tabular-nums">
          {valor === null ? (
            <span className="text-[var(--ls-t4)]">—</span>
          ) : (
            <CifraAnimada valor={valor} formato={decimales ? (n) => n.toLocaleString('es-ES', { maximumFractionDigits: n < 1 ? 2 : 1 }) : (n) => entero(n)} duracion={0.8} />
          )}
        </span>
        {unidad && valor !== null && <span className="text-[12px] text-[var(--ls-t3)]">{unidad}</span>}
        {aviso && <AlertTriangle className="h-[13px] w-[13px] shrink-0 self-center" style={{ color: COLOR_ESTADO[aviso] }} aria-label={aviso === 'rojo' ? 'Urgente' : 'A revisar'} />}
      </div>
      {sub && <div className="mt-[2px] truncate text-[11.5px] text-[var(--ls-t4)]">{sub}</div>}
    </div>
  )
}
