'use client'

import { useState } from 'react'
import { AlertTriangle, Check, Link2, Loader2 } from 'lucide-react'
import { BOTON, CAMPO, COLOR_ESTADO, TIPO } from '@/lib/estilo/denso'
import type { RemesaDePanel } from '@/lib/fba/datos'
import { ESTADO_INBOUND_TEXTO } from '@/lib/fba/inbound-estados'
import { ESTADOS_AMAZON_MALOS, PASOS_AMAZON, estaEnlazada, fechasDePasos, indicePasoAmazon } from '@/lib/fba/vista'
import { cx } from '../comun/ui'

/**
 * EL RECORRIDO REAL DEL ENVÍO, COMO EL «PROGRESO DEL ENVÍO» DE SELLER CENTRAL.
 *
 * Seis pasos, con la hora a la que se VIO cada uno. Amazon no da por API las
 * horas de su propio recorrido, solo el estado de ahora; el ERP lo mira cada hora
 * y apunta cuándo cambia (migración 224), así que cada hora tiene hasta una hora
 * de margen y se dice en el título.
 *
 * Si la remesa no tiene número de envío no hay recorrido que enseñar: se ofrece
 * enlazarla ahí mismo, que es lo que hace falta para que sea un envío de verdad.
 */

const hora = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

export function SeguidorAmazon({
  remesa,
  puedeEditar,
  onEnlazar,
  vertical = false,
}: {
  remesa: RemesaDePanel
  puedeEditar: boolean
  /** Guarda el número y consulta a Amazon. Lanza si hay que corregirlo */
  onEnlazar: (numero: string) => Promise<void>
  /** En la columna de la derecha va en vertical; en la cabecera, en una fila */
  vertical?: boolean
}) {
  if (!estaEnlazada(remesa)) return <SinEnlazar puedeEditar={puedeEditar} onEnlazar={onEnlazar} />

  const estado = remesa.estadoAmazon
  if (estado && ESTADOS_AMAZON_MALOS.includes(estado)) {
    return (
      <div className="flex items-center gap-2 text-[12.5px] text-[var(--ls-t1)]" style={{ borderLeft: `3px solid ${COLOR_ESTADO.rojo}`, paddingLeft: 10 }}>
        <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: COLOR_ESTADO.rojo }} />
        Amazon dice que este envío está «{ESTADO_INBOUND_TEXTO[estado]?.texto ?? estado}». No va a llegar: no cuentan sus unidades.
      </div>
    )
  }

  const actual = indicePasoAmazon(estado)
  const fechas = fechasDePasos(remesa.eventos)
  const sinDato = actual < 0

  if (vertical) {
    return (
      <div>
        <ol aria-label="Recorrido del envío en Amazon">
          {PASOS_AMAZON.map((paso, i) => {
            const hecho = !sinDato && i < actual
            const enCurso = !sinDato && i === actual
            const completo = enCurso && paso.id === 'cerrado'
            const fecha = fechas[i]
            const ultimo = i === PASOS_AMAZON.length - 1
            return (
              <li key={paso.id} className={cx('relative flex gap-3', !ultimo && 'pb-[13px]')}>
                {!ultimo && (
                  <span
                    className="absolute bottom-[-2px] left-[7px] top-[17px] w-[2px] rounded-full"
                    style={{ background: hecho ? COLOR_ESTADO.verde : 'var(--ls-linea2)', opacity: hecho ? 0.75 : 1 }}
                  />
                )}
                <span
                  className="relative mt-[1px] flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border-2 bg-[var(--ls-sup)]"
                  style={{
                    borderColor: hecho || completo ? COLOR_ESTADO.verde : enCurso ? 'var(--ls-acc-graf)' : 'var(--ls-linea2)',
                    background: hecho || completo ? COLOR_ESTADO.verde : undefined,
                  }}
                >
                  {(hecho || completo) && <Check className="h-[10px] w-[10px] text-[#0F1114]" strokeWidth={3.5} />}
                  {enCurso && !completo && <span className="h-[6px] w-[6px] animate-pulse rounded-full" style={{ background: 'var(--ls-acc-graf)' }} />}
                </span>
                <div className="min-w-0">
                  <p className={cx('text-[12.5px] leading-[1.3]', hecho || enCurso ? 'font-medium text-[var(--ls-t1)]' : 'text-[var(--ls-t4)]')}>{paso.texto}</p>
                  <p className="min-h-[14px] text-[11px] tabular-nums text-[var(--ls-t4)]" title={fecha ? 'La hora en que el ERP vio este paso, no la de Seller Central' : undefined}>
                    {fecha ? hora.format(new Date(fecha)) : hecho || completo ? 'sin hora' : ''}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
        {sinDato && (
          <p className="mt-2 text-[11.5px] leading-[1.5] text-[var(--ls-t3)]">
            {remesa.seguimientoError ? `Amazon contestó: ${remesa.seguimientoError}` : 'Todavía no se ha consultado. Pulsa «Consultar en Amazon».'}
          </p>
        )}
      </div>
    )
  }

  return (
    <div>
      <ol className="flex items-center gap-2" aria-label="Recorrido del envío en Amazon">
        {PASOS_AMAZON.map((paso, i) => {
          const hecho = !sinDato && i < actual
          const enCurso = !sinDato && i === actual
          // Un envío CERRADO ya no «está en» ningún paso: los ha pasado todos
          const completo = enCurso && paso.id === 'cerrado'
          const fecha = fechas[i]
          const ultimo = i === PASOS_AMAZON.length - 1
          return (
            <li key={paso.id} className={cx('flex min-w-0 items-center gap-2', !ultimo && 'flex-1')}>
              <span
                className="relative flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border-2 bg-[var(--ls-sup)]"
                style={{
                  borderColor: hecho || completo ? COLOR_ESTADO.verde : enCurso ? 'var(--ls-acc-graf)' : 'var(--ls-linea2)',
                  background: hecho || completo ? COLOR_ESTADO.verde : undefined,
                }}
              >
                {(hecho || completo) && <Check className="h-[10px] w-[10px] text-[#0F1114]" strokeWidth={3.5} />}
                {enCurso && !completo && <span className="h-[6px] w-[6px] animate-pulse rounded-full" style={{ background: 'var(--ls-acc-graf)' }} />}
              </span>
              <span className="flex min-w-0 shrink-0 items-baseline gap-[6px] whitespace-nowrap">
                <span className={cx('text-[12.5px]', hecho || enCurso ? 'font-medium text-[var(--ls-t1)]' : 'text-[var(--ls-t4)]')}>{paso.texto}</span>
                {fecha && (
                  <span className="hidden text-[11px] tabular-nums text-[var(--ls-t4)] 2xl:inline" title="La hora en que el ERP vio este paso, no la de Seller Central">
                    {hora.format(new Date(fecha))}
                  </span>
                )}
              </span>
              {!ultimo && (
                <span className="h-[2px] min-w-[10px] flex-1 rounded-full" style={{ background: hecho ? COLOR_ESTADO.verde : 'var(--ls-linea2)', opacity: hecho ? 0.75 : 1 }} />
              )}
            </li>
          )
        })}
      </ol>
      {sinDato && (
        <p className="mt-1 text-[11.5px] text-[var(--ls-t3)]">
          {remesa.seguimientoError ? `Amazon contestó: ${remesa.seguimientoError}` : 'Todavía no se ha consultado este envío. Pulsa «Consultar en Amazon».'}
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

const FBA = /^FBA[0-9A-Z]{6,20}$/

function SinEnlazar({ puedeEditar, onEnlazar }: { puedeEditar: boolean; onEnlazar: (numero: string) => Promise<void> }) {
  const [numero, setNumero] = useState('')
  const [enviando, setEnviando] = useState(false)
  const limpio = numero.trim().toUpperCase()
  const valido = FBA.test(limpio)

  async function enlazar() {
    setEnviando(true)
    try {
      await onEnlazar(limpio)
      setNumero('')
    } catch {
      // El aviso ya lo ha dado quien llama
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-[260px] flex-1 items-start gap-2">
          <Link2 className="mt-[2px] h-4 w-4 shrink-0 text-[var(--ls-t4)]" />
          <div>
            <p className={cx(TIPO.l, 'text-[var(--ls-t1)]')}>Este envío no está enlazado con Amazon</p>
            <p className="text-[11.5px] leading-[1.5] text-[var(--ls-t3)]">
              Sin el número de envío FBA —el que empieza por <span className="font-mono">FBA</span>— no se puede ver por
              dónde va ni cuánto ha recibido Amazon.
            </p>
          </div>
        </div>
        {puedeEditar && (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (valido && !enviando) void enlazar()
            }}
          >
            <input
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="FBA15ABCDEF"
              spellCheck={false}
              className={cx(CAMPO.input, 'w-[170px] font-mono')}
              aria-label="Número de envío FBA"
            />
            <button type="submit" disabled={!valido || enviando} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
              {enviando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
              Enlazar y consultar
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
