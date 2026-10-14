'use client'

import { BadgeCheck, Boxes, Check, PencilRuler, Send, Truck } from 'lucide-react'
import { TIPO } from '@/lib/estilo/denso'
import type { EstadoRemesa } from '@/lib/fba/flujo'
import { FASES_PROPUESTA, type FasePropuesta } from '@/lib/fba/vista'
import { cx } from '../comun/ui'

/**
 * LAS FASES DE UNA PROPUESTA, DE LA IDEA AL ENVÍO.
 *
 * Es el mapa de «¿en qué punto estamos y a quién le toca?». Cada fase dice quién
 * la mueve, y al final queda a la vista el destino: cuando la propuesta se marca
 * como enviada y se enlaza con su número de Amazon, pasa a «Envíos».
 */

export const INFO_FASE: Record<FasePropuesta, { titulo: string; quien: string; pista: string; icono: React.ReactNode }> = {
  borrador: {
    titulo: 'Propuesta',
    quien: 'Agencia propone',
    pista: 'La agencia monta qué se manda y cuánto de cada cosa; el cliente lo revisa y lo corrige.',
    icono: <PencilRuler className="h-[14px] w-[14px]" />,
  },
  aprobada: {
    titulo: 'Aprobada',
    quien: 'Cliente etiqueta',
    pista: 'El cliente ha dado el OK. Ya se pueden imprimir las etiquetas de producto para empezar a etiquetar.',
    icono: <BadgeCheck className="h-[14px] w-[14px]" />,
  },
  encajando: {
    titulo: 'Encajando',
    quien: 'Cliente encaja',
    pista: 'El cliente mete la mercancía en cajas y dice medidas, pesos y qué va en cada una.',
    icono: <Boxes className="h-[14px] w-[14px]" />,
  },
  lista: {
    titulo: 'Lista para enviar',
    quien: 'Agencia envía',
    pista: 'La agencia crea el envío en Seller Central con estos datos y lo enlaza con su número FBA.',
    icono: <Send className="h-[14px] w-[14px]" />,
  },
}

export function FasesPropuesta({ estado }: { estado: EstadoRemesa }) {
  const actual = FASES_PROPUESTA.indexOf(estado as FasePropuesta)

  return (
    <div className="rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-4 pb-[10px] pt-[12px]">
      <ol className="grid grid-cols-5" aria-label="Fases de la propuesta">
        {FASES_PROPUESTA.map((f, i) => {
          const info = INFO_FASE[f]
          const hecha = i < actual
          const enCurso = i === actual
          return (
            <li key={f} className="relative min-w-0" title={info.pista}>
              <span
                className="absolute left-[calc(50%+16px)] right-[calc(-50%+16px)] top-[13px] h-[2px] rounded-full"
                style={{ background: hecha ? 'var(--ls-e-verde)' : 'var(--ls-linea2)', opacity: hecha ? 0.75 : 1 }}
              />
              <div className="flex flex-col items-center gap-[5px]">
                <span
                  className={cx('relative z-10 flex h-[28px] w-[28px] items-center justify-center rounded-full border-2 bg-[var(--ls-sup)]')}
                  style={{
                    borderColor: hecha ? 'var(--ls-e-verde)' : enCurso ? 'var(--ls-acc-graf)' : 'var(--ls-linea2)',
                    background: hecha ? 'var(--ls-e-verde)' : enCurso ? 'var(--ls-acc-suave)' : undefined,
                    color: hecha ? '#0F1114' : enCurso ? 'var(--ls-acc)' : 'var(--ls-t4)',
                  }}
                >
                  {hecha ? <Check className="h-[14px] w-[14px]" strokeWidth={3} /> : info.icono}
                </span>
                <span className={cx(TIPO.m, 'whitespace-nowrap text-center', enCurso ? 'font-semibold text-[var(--ls-t1)]' : hecha ? 'text-[var(--ls-t2)]' : 'text-[var(--ls-t4)]')}>
                  {info.titulo}
                </span>
                <span className="whitespace-nowrap text-[11px] text-[var(--ls-t4)]">{info.quien}</span>
              </div>
            </li>
          )
        })}

        {/* El destino: lo que pasa al marcarla como enviada */}
        <li className="relative min-w-0" title="Al marcarla como enviada y enlazarla con su número de Amazon pasa a la pestaña Envíos">
          <div className="flex flex-col items-center gap-[5px]">
            <span className="relative z-10 flex h-[28px] w-[28px] items-center justify-center rounded-full border-2 border-dashed border-[var(--ls-linea2)] bg-[var(--ls-sup)] text-[var(--ls-t4)]">
              <Truck className="h-[14px] w-[14px]" />
            </span>
            <span className={cx(TIPO.m, 'whitespace-nowrap text-center text-[var(--ls-t4)]')}>Envío en Amazon</span>
            <span className="whitespace-nowrap text-[11px] text-[var(--ls-t4)]">pasa a «Envíos»</span>
          </div>
        </li>
      </ol>
    </div>
  )
}
