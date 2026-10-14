'use client'

import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { RemesaDePanel } from '@/lib/fba/datos'
import type { ResumenRitmo } from '@/lib/fba/analisis'
import { VIZ } from '../comun/graficos'
import { cx } from '../comun/ui'
import { fecha } from '../formato'

/**
 * LAS CIFRAS DE UN ENVÍO, EN UNA SOLA FILA.
 *
 * Son siempre las mismas y siempre visibles, estés en la pestaña que estés: lo
 * que se manda, lo que ha llegado, lo que se ha vendido, lo que queda y a qué
 * ritmo. Antes eran seis tarjetas de dos filas; una fila deja el resto de la
 * pantalla para trabajar.
 *
 * El valor grande va en cifras PROPORCIONALES —no tabulares— porque es un número
 * suelto y no una columna; las columnas alineadas se quedan para las tablas.
 */

export function CifrasEnvio({ remesa, ritmo, rejilla = false }: { remesa: RemesaDePanel; ritmo: ResumenRitmo; rejilla?: boolean }) {
  const enviadas = remesa.lineas.reduce((s, l) => s + l.enviadas, 0)
  const sinPreguntar = remesa.lineas.length > 0 && remesa.lineas.every((l) => l.recibidas === null)
  const recibidas = remesa.lineas.reduce((s, l) => s + (l.recibidas ?? 0), 0)
  const vendidas = remesa.lineas.reduce((s, l) => s + l.consumidas, 0)
  // De lo «vendido», lo que son retiradas del almacén y pérdidas: salen del stock pero no son ventas
  const retiradas = remesa.lineas.reduce((s, l) => s + l.retiradas, 0)
  const mermas = remesa.lineas.reduce((s, l) => s + l.mermas, 0)
  const noVentas = retiradas + mermas
  const devueltas = remesa.lineas.reduce((s, l) => s + l.devueltas, 0)
  const agotadas = remesa.lineas.filter((l) => l.quedan === 0).length
  const base = Math.max(1, sinPreguntar ? enviadas : recibidas)
  const faltan = remesa.unidadesQueNoLlegaron

  const urgente = ritmo.cobertura !== null && ritmo.cobertura < 7
  const pronto = ritmo.cobertura !== null && ritmo.cobertura < 14

  return (
    <div className={rejilla ? 'grid grid-cols-2' : 'grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7'}>
      <Celda rejilla={rejilla} rotulo="Enviadas" valor={enviadas} sub={`${remesa.lineas.length} referencia${remesa.lineas.length === 1 ? '' : 's'}`} />
      <Celda
        rotulo="Recibidas"
        valor={sinPreguntar ? '—' : recibidas}
        sub={
          sinPreguntar ? (
            'sin consultar a Amazon'
          ) : faltan > 0 ? (
            <span className="inline-flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" style={{ color: COLOR_ESTADO.ambar }} />
              faltan {faltan}
            </span>
          ) : (
            `${Math.round((recibidas / Math.max(1, enviadas)) * 100)} % de lo enviado`
          )
        }
      />
      <Celda rejilla={rejilla} color={VIZ.vendidas} rotulo="Vendidas" valor={vendidas} sub={`${Math.round((vendidas / base) * 100)} % de lo recibido`} aviso={noVentas > 0 ? 'ambar' : undefined} pista={noVentas > 0 ? `Incluye ${noVentas} unidad${noVentas === 1 ? '' : 'es'} que no ${noVentas === 1 ? 'es una venta' : 'son ventas'}: ${[retiradas > 0 ? `${retiradas} retirada${retiradas === 1 ? '' : 's'} del almacén` : '', mermas > 0 ? `${mermas} merma${mermas === 1 ? '' : 's'}` : ''].filter(Boolean).join(' y ')}. Salen del stock, por eso restan, pero no son ventas.` : undefined} />
      <Celda rejilla={rejilla} color={VIZ.quedan} rotulo="Quedan" valor={remesa.quedan} sub={`${Math.round((remesa.quedan / base) * 100)} %${agotadas > 0 ? ` · ${agotadas} agotada${agotadas === 1 ? '' : 's'}` : ''}`} />
      <Celda rejilla={rejilla} rotulo="Ritmo" valor={ritmo.udDia7 > 0 ? ritmo.udDia7.toLocaleString('es-ES', { maximumFractionDigits: 1 }) : '0'} unidad="/día" sub="últimos 7 días" />
      <Celda
        rotulo="Stock para"
        valor={ritmo.cobertura === null ? '—' : Math.round(ritmo.cobertura)}
        unidad={ritmo.cobertura === null ? undefined : ' días'}
        aviso={urgente ? 'rojo' : pronto ? 'ambar' : undefined}
        sub={ritmo.seAgotaEl ? `se agota el ${fecha(ritmo.seAgotaEl)}` : remesa.quedan === 0 ? 'agotado' : 'sin ventas ahora'}
      />
      <Celda rejilla={rejilla} rotulo="Devueltas" valor={devueltas} sub={devueltas > 0 ? 'ya descontadas' : 'ninguna'} aviso={devueltas > 0 ? 'ambar' : undefined} ultima />
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
  ultima,
  rejilla,
}: {
  rejilla?: boolean
  rotulo: string
  valor: number | string
  unidad?: string
  sub?: ReactNode
  /** El color de la serie en los gráficos: liga la cifra con lo que se ve abajo */
  color?: string
  aviso?: 'rojo' | 'ambar'
  /** Lo que explica el aviso, al pasar el ratón por encima de la cifra */
  pista?: string
  ultima?: boolean
}) {
  if (rejilla) {
    // La columna de la derecha: dos por fila, el dato arriba y su explicación debajo
    return (
      <div className="min-w-0 border-b border-r border-[var(--ls-linea)] px-3 py-[9px] [&:nth-child(2n)]:border-r-0 [&:nth-last-child(-n+2)]:border-b-0">
        <div className="flex items-center gap-[6px] text-[11px] font-semibold text-[var(--ls-t4)]">
          {color && <span className="h-[8px] w-[8px] rounded-[2px]" style={{ background: color }} />}
          {rotulo}
        </div>
        <div className="mt-[1px] flex items-baseline gap-[4px] whitespace-nowrap" title={pista}>
          <span className="text-[21px] font-semibold leading-[1.15] tracking-[-0.02em] text-[var(--ls-t1)]">{typeof valor === 'number' ? valor.toLocaleString('es-ES') : valor}</span>
          {unidad && <span className="text-[12px] text-[var(--ls-t3)]">{unidad}</span>}
          {aviso && <AlertTriangle className="h-[12px] w-[12px] shrink-0 self-center" style={{ color: COLOR_ESTADO[aviso] }} />}
        </div>
        <div className="mt-[1px] truncate text-[11px] text-[var(--ls-t3)]" title={typeof sub === 'string' ? sub : undefined}>
          {sub}
        </div>
      </div>
    )
  }
  return (
    <div className={cx('min-w-0 border-r border-t border-[var(--ls-linea)] px-3 py-[7px] first:border-t-0 sm:[&:nth-child(-n+4)]:border-t-0 lg:border-t-0', ultima && 'lg:border-r-0')}>
      <div className="flex items-center gap-[6px] text-[11px] font-semibold text-[var(--ls-t4)]">
        {color && <span className="h-[8px] w-[8px] rounded-[2px]" style={{ background: color }} />}
        {rotulo}
      </div>
      <div className="mt-[1px] flex items-baseline gap-[5px] overflow-hidden whitespace-nowrap" title={pista}>
        <span className="text-[19px] font-semibold leading-[1.2] tracking-[-0.02em] text-[var(--ls-t1)]">
          {typeof valor === 'number' ? valor.toLocaleString('es-ES') : valor}
        </span>
        {unidad && <span className="text-[12px] text-[var(--ls-t3)]">{unidad}</span>}
        {aviso && <AlertTriangle className="h-[12px] w-[12px] shrink-0 self-center" style={{ color: COLOR_ESTADO[aviso] }} />}
        <span className="truncate text-[11px] text-[var(--ls-t3)]">{sub}</span>
      </div>
    </div>
  )
}
