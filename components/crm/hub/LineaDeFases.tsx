'use client'

import { Check, Minus, RotateCcw, XCircle } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { toMadrid } from '@/lib/timezone'
import { CRM_STAGE_LABELS, type CrmStage } from '@/lib/types/crm'
import { FASES_DEL_CAMINO, textoDeDias, textoDeDuracion, type LineaDeFases as Linea, type PasoDeLaLinea } from '@/lib/crm/fases'

/**
 * LA LÍNEA VISUAL DE FASES DE UN CLIENTE.
 * ========================================
 * Seis nodos en horizontal —Nuevo, En seguimiento, Propuesta enviada, Revisión de propuesta, Negociación, Cliente cerrado— unidos por un tramo que se va llenando de verde
 * hasta la fase actual. Debajo de cada nodo, el día en que se entró y cuánto se estuvo; en la actual, en naranja, cuánto lleva. «Perdido» no es un paso del camino: se pinta
 * aparte, en rojo, al final, y la línea se queda hasta donde llegó.
 *
 *   hecho      círculo verde con un check          las fases ya recorridas
 *   actual     anillo naranja con un punto          donde está HOY
 *   pendiente  círculo vacío                        lo que le falta
 *   saltado    círculo con trazos y un guion         nadie la vivió (de «Nuevo» a «Negociación» sin pasar por las del medio)
 *
 * Quien puede editar mueve al cliente pulsando un nodo. El cambio se puede DESHACER desde el aviso (lo hace FichaHub), porque un nodo es un blanco grande y un clic de más es fácil.
 * Sin historial (la 258 no está lanzada) se ve igual pero sin fechas; una fecha aproximada lleva «~».
 */

interface Props {
  linea: Linea
  puedeEditar: boolean
  onCambiar: (etapa: CrmStage) => void
}

const corto = (iso: string | null, aproximada: boolean): string | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return `${aproximada ? '~' : ''}${format(toMadrid(new Date(t)), 'd MMM', { locale: es })}`
}

function Nodo({ paso }: { paso: PasoDeLaLinea }) {
  const base = 'relative z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full'
  if (paso.estado === 'hecho') {
    return (
      <span className={base} style={{ backgroundColor: COLOR_ESTADO.verde }}>
        <Check className="h-[11px] w-[11px] text-[var(--ls-fondo)]" strokeWidth={3} />
      </span>
    )
  }
  if (paso.estado === 'actual') {
    return (
      <span className={`${base} border-2 bg-[var(--ls-sup)]`} style={{ borderColor: 'var(--ls-acc-graf)', boxShadow: '0 0 0 3px var(--ls-acc-suave)' }}>
        <span className="h-[7px] w-[7px] rounded-full" style={{ backgroundColor: 'var(--ls-acc-graf)' }} />
      </span>
    )
  }
  if (paso.estado === 'saltado') {
    return (
      <span className={`${base} border border-dashed border-[var(--ls-linea2)] bg-[var(--ls-sup)]`}>
        <Minus className="h-[10px] w-[10px] text-[var(--ls-t4)]" strokeWidth={2.5} />
      </span>
    )
  }
  return <span className={`${base} border border-[var(--ls-linea2)] bg-[var(--ls-sup)]`} />
}

export function LineaDeFases({ linea, puedeEditar, onCambiar }: Props) {
  const perdida = linea.perdido !== null

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <ol className="grid min-w-[560px] grid-cols-6" aria-label="Fases del cliente">
          {linea.pasos.map((paso, i) => {
            const ultimo = i === linea.pasos.length - 1
            // El tramo hacia la derecha va lleno si esta fase se recorrió de verdad y la siguiente también se alcanzó
            const siguiente = linea.pasos[i + 1]
            const lleno = !ultimo && (paso.estado === 'hecho' || paso.estado === 'saltado') && siguiente && (siguiente.estado === 'hecho' || siguiente.estado === 'actual' || siguiente.estado === 'saltado') && i < linea.indice
            const punteado = !ultimo && (paso.estado === 'saltado' || siguiente?.estado === 'saltado') && i < linea.indice
            const fecha = corto(paso.desde, paso.aproximada)
            const etiqueta = CRM_STAGE_LABELS[paso.etapa]
            const actual = paso.estado === 'actual'
            // «Cliente cerrado» es el FINAL del camino: cuando se llega, se pinta como cumplido (verde, con su check) y no como una fase en curso
            const cerrado = actual && paso.etapa === 'ganado'

            const contenido = (
              <>
                <Nodo paso={cerrado ? { ...paso, estado: 'hecho' } : paso} />
                <span className={`mt-[6px] block px-1 text-center text-[11.5px] leading-[1.25] ${actual ? 'font-semibold text-[var(--ls-t1)]' : paso.estado === 'pendiente' ? 'text-[var(--ls-t4)]' : 'text-[var(--ls-t2)]'}`}>{etiqueta}</span>
                <span className="mt-[2px] block min-h-[28px] px-1 text-center text-[11px] leading-[1.35] tabular-nums text-[var(--ls-t3)]">
                  {fecha && <span className="block">{fecha}</span>}
                  {actual && !cerrado && !perdida && linea.diasEnLaActual !== null && (
                    <span className="block font-semibold text-[var(--ls-acc)]">{textoDeDuracion(linea.diasEnLaActual)}</span>
                  )}
                  {cerrado && linea.diasEnLaActual !== null && <span className="block text-[var(--ls-t3)]">{textoDeDias(linea.diasEnLaActual)}</span>}
                  {paso.estado === 'hecho' && paso.dias !== null && <span className="block text-[var(--ls-t4)]">{textoDeDuracion(paso.dias)}</span>}
                  {paso.estado === 'saltado' && <span className="block text-[var(--ls-t4)]">saltada</span>}
                </span>
              </>
            )

            return (
              <li key={paso.etapa} className="relative flex min-w-0 flex-col items-center">
                {!ultimo && (
                  <span
                    aria-hidden
                    className={`absolute left-1/2 top-[8px] z-0 w-full ${punteado ? 'border-t-2 border-dashed' : 'h-[2px]'}`}
                    style={punteado ? { borderColor: lleno ? COLOR_ESTADO.verde : 'var(--ls-linea2)' } : { backgroundColor: lleno ? COLOR_ESTADO.verde : 'var(--ls-linea2)' }}
                  />
                )}
                {puedeEditar && !actual ? (
                  <button type="button" onClick={() => onCambiar(paso.etapa)} title={`Pasar a «${etiqueta}»`} className="group flex w-full min-w-0 cursor-pointer flex-col items-center rounded-[6px] outline-none hover:bg-[var(--ls-sup2)] focus-visible:outline-2 focus-visible:outline-[var(--ls-acc-graf)]">
                    {contenido}
                  </button>
                ) : (
                  <div className="flex w-full min-w-0 flex-col items-center">{contenido}</div>
                )}
              </li>
            )
          })}
        </ol>
      </div>

      {/* PERDIDO: aparte, al final, en rojo. Si el cliente está perdido, se dice cuándo y se ofrece recuperarlo */}
      {(perdida || puedeEditar) && (
        <div className="flex flex-wrap items-center gap-2">
          {perdida ? (
            <>
              <span className="inline-flex h-[19px] items-center gap-[5px] rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] pl-[6px] pr-[8px] text-[11px] font-medium text-[var(--ls-t1)]">
                <XCircle className="h-3 w-3" style={{ color: COLOR_ESTADO.rojo }} />
                Perdido
                {linea.perdido?.desde && (
                  <span className="font-normal tabular-nums text-[var(--ls-t3)]">
                    · {corto(linea.perdido.desde, linea.perdido.aproximada)}
                    {linea.perdido.dias !== null ? ` · ${textoDeDias(linea.perdido.dias)}` : ''}
                  </span>
                )}
              </span>
              <span className="text-[11.5px] text-[var(--ls-t3)]">Llegó hasta «{CRM_STAGE_LABELS[FASES_DEL_CAMINO[linea.indice]]}».</span>
              {puedeEditar && (
                <button type="button" onClick={() => onCambiar(FASES_DEL_CAMINO[linea.indice])} className="inline-flex h-6 items-center gap-[5px] rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-[9px] text-[11.5px] font-medium text-[var(--ls-t2)] hover:border-[var(--ls-linea2)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]">
                  <RotateCcw className="h-3 w-3" /> Recuperar
                </button>
              )}
            </>
          ) : (
            <button type="button" onClick={() => onCambiar('perdido')} className="inline-flex h-6 items-center gap-[5px] rounded-[6px] border border-transparent px-[7px] text-[11.5px] text-[var(--ls-t4)] hover:border-[var(--ls-linea)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">
              <XCircle className="h-3 w-3" /> Marcar como perdido
            </button>
          )}
        </div>
      )}
    </div>
  )
}
