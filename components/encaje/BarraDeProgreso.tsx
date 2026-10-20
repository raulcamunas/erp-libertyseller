'use client'

import { Check, CloudOff, Loader2, TriangleAlert } from 'lucide-react'
import type { ResumenDeEncaje } from '@/lib/fba/encaje-resumen'
import { FUENTE_TITULO, M, cx, n0, n1 } from './marca'
import type { EstadoDeGuardado } from './useAutoguardado'

/**
 * LA BARRA QUE SE QUEDA ARRIBA: CÓMO VAS Y CUÁNDO TERMINAS.
 *
 * Es lo único que el cliente tiene siempre a la vista mientras baja por las cajas: cuántas unidades
 * lleva encajadas de las que tiene que mandar, si se está guardando lo que hace y el botón de terminar.
 * El botón no se esconde cuando no se puede pulsar: se apaga y dice DEBAJO qué falta, con las mismas
 * palabras que usa el ERP, para que no haya que adivinar por qué.
 */
export function BarraDeProgreso({
  resumen,
  guardado,
  motivoDelFallo,
  editable,
  terminando,
  onTerminar,
}: {
  resumen: ResumenDeEncaje
  guardado: EstadoDeGuardado
  motivoDelFallo: string | null
  editable: boolean
  terminando: boolean
  onTerminar: () => void
}) {
  const pct = resumen.declaradas === 0 ? 0 : Math.min(100, Math.round((resumen.encajadas / resumen.declaradas) * 100))
  const completo = resumen.pendientes === 0 && resumen.sobrantes === 0 && resumen.declaradas > 0
  const falta = resumen.motivos.slice(0, 2)

  return (
    <div className="sticky top-0 z-30 border-b border-[#E5E1DB] bg-[#FFFFFF]/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 sm:px-8">
        <div className="min-w-[210px] flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[24px] leading-none tabular-nums text-[#141414]" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>
              {n0(resumen.encajadas)}
            </span>
            <span className="text-[13px] text-[#5E5852]">de {n0(resumen.declaradas)} unidades en cajas</span>
          </div>
          <div className="mt-2 h-[6px] overflow-hidden rounded-full bg-[#E5E1DB]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Unidades encajadas">
            <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, background: completo ? M.verde : M.naranja }} />
          </div>
        </div>

        <div className="flex items-center gap-4 text-[13px] text-[#5E5852]">
          <span>
            <b className="font-semibold text-[#141414] tabular-nums">{n0(resumen.cajas)}</b> caja{resumen.cajas === 1 ? '' : 's'}
          </span>
          <span>
            <b className="font-semibold text-[#141414] tabular-nums">{n1(resumen.pesoTotalKg)}</b> kg
          </span>
        </div>

        {editable && (
          <>
            <EstadoDelGuardado estado={guardado} motivo={motivoDelFallo} />
            <button
              type="button"
              onClick={onTerminar}
              disabled={!resumen.listo || terminando || guardado === 'error'}
              className={cx(
                'flex h-11 items-center gap-2 rounded-xl px-5 text-[14px] font-semibold transition',
                resumen.listo && guardado !== 'error' ? 'bg-[#F26212] text-[#FFFFFF] shadow-[0_8px_20px_-8px_rgba(242,98,18,0.7)] hover:bg-[#E0560C]' : 'cursor-not-allowed bg-[#EDE6DC] text-[#8C857C]'
              )}
            >
              {terminando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              He terminado de encajar
            </button>
          </>
        )}
      </div>

      {editable && !resumen.listo && falta.length > 0 && (
        <div className="border-t border-[#F1EDE7] bg-[#FBF9F6]">
          <p className="mx-auto flex max-w-[1180px] items-start gap-2 px-5 py-2 text-[12.5px] leading-snug text-[#5E5852] sm:px-8">
            <TriangleAlert className="mt-[2px] h-3.5 w-3.5 shrink-0 text-[#9A7410]" />
            {/* En el móvil la barra se queda fija y no puede comerse media pantalla: dos líneas; en ordenador, entero */}
            <span className="line-clamp-2 sm:line-clamp-none">
              <b className="font-semibold text-[#141414]">Para poder terminar: </b>
              {falta.join(' · ')}
              {resumen.motivos.length > falta.length && ` · y ${resumen.motivos.length - falta.length} más`}
            </span>
          </p>
        </div>
      )}
    </div>
  )
}

function EstadoDelGuardado({ estado, motivo }: { estado: EstadoDeGuardado; motivo: string | null }) {
  if (estado === 'error') {
    return (
      <span className="flex max-w-[260px] items-center gap-1.5 text-[12.5px] text-[#9A7410]" title={motivo ?? undefined} role="status">
        <CloudOff className="h-4 w-4 shrink-0" />
        <span className="line-clamp-2">{motivo ?? 'No se ha podido guardar'}</span>
      </span>
    )
  }
  if (estado === 'guardando' || estado === 'pendiente') {
    return (
      <span className="flex items-center gap-1.5 text-[12.5px] text-[#8C857C]" role="status">
        <Loader2 className={cx('h-3.5 w-3.5', estado === 'guardando' && 'animate-spin')} />
        {estado === 'guardando' ? 'Guardando…' : 'Cambios sin guardar…'}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-[12.5px] text-[#2F9657]" role="status">
      <Check className="h-3.5 w-3.5" />
      Guardado
    </span>
  )
}
