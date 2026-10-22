'use client'

import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { AlertCircle, CheckCircle2, Clock, Eye, Unplug } from 'lucide-react'
import { Avatar } from '@/components/rendimiento/ui'
import type { BuzonVisible } from '@/lib/correo/tipos'
import { BOTON_SECUNDARIO } from './ui'

/**
 * EL RESUMEN DEL EQUIPO: UNA FILA POR BUZÓN.
 *
 * Para quien supervisa. Dice de cada persona si su correo está conectado y al día, cuántas conversaciones tiene sin leer y
 * cuántas esperan que les conteste (un cliente que escribió y no ha recibido respuesta), y cuándo fue el último correo.
 * Abrir un buzón es solo lectura y queda anotado.
 */

interface Props {
  buzones: BuzonVisible[]
  onAbrir: (id: string) => void
}

const numero = (n: number) => n.toLocaleString('es-ES')
const hace = (iso: string) => formatDistanceToNow(new Date(Math.min(Date.parse(iso), Date.now())), { locale: es, addSuffix: true })

function Estado({ b }: { b: BuzonVisible }) {
  if (!b.conectado) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[var(--ls-t4)]">
        <Unplug className="h-3.5 w-3.5" aria-hidden /> Desconectado
      </span>
    )
  }
  if (b.credencialesInvalidas) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[var(--ls-e-ambar)]" title="El servidor ha rechazado la contraseña: su dueño tiene que volver a escribirla">
        <AlertCircle className="h-3.5 w-3.5" aria-hidden /> Contraseña rechazada
      </span>
    )
  }
  if (b.ultimoError) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[var(--ls-e-ambar)]" title={b.ultimoError}>
        <AlertCircle className="h-3.5 w-3.5" aria-hidden /> Con un aviso
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[var(--ls-t2)]" suppressHydrationWarning>
      <CheckCircle2 className="h-3.5 w-3.5 text-[var(--ls-e-verde)]" aria-hidden />
      {b.ultimoSyncAt ? `Leído ${hace(b.ultimoSyncAt)}` : 'Todavía sin leer'}
      {!b.historicoCompleto && ' · importando'}
    </span>
  )
}

export function VistaEquipo({ buzones, onAbrir }: Props) {
  if (buzones.length === 0) {
    return (
      <div className="px-6 py-14 text-center">
        <p className="text-[13px] font-medium text-[var(--ls-t2)]">Todavía nadie ha conectado su correo</p>
        <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-[var(--ls-t4)]">Cada comercial lo conecta desde esta misma pantalla con la contraseña de su buzón. En cuanto lo haga aparecerá aquí.</p>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full min-w-[720px] border-separate border-spacing-0 text-[12.5px]">
        <thead>
          <tr className="text-left text-[11px] font-semibold text-[var(--ls-t4)]">
            <th scope="col" className="sticky top-0 h-8 border-b border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 font-semibold">
              Persona
            </th>
            <th scope="col" className="sticky top-0 h-8 border-b border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 font-semibold">
              Estado
            </th>
            <th scope="col" className="sticky top-0 h-8 border-b border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 text-right font-semibold">
              Conversaciones
            </th>
            <th scope="col" className="sticky top-0 h-8 border-b border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 text-right font-semibold">
              Sin leer
            </th>
            <th scope="col" className="sticky top-0 h-8 border-b border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 text-right font-semibold">
              Esperan respuesta
            </th>
            <th scope="col" className="sticky top-0 h-8 border-b border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 font-semibold">
              Último correo
            </th>
            <th scope="col" className="sticky top-0 h-8 border-b border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3">
              <span className="sr-only">Abrir</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {buzones.map((b) => (
            <tr key={b.id} className="group transition-colors hover:bg-[var(--ls-sup2)]">
              <td className="h-12 border-b border-[var(--ls-linea)] px-3">
                <div className="flex items-center gap-2.5">
                  <Avatar id={b.propietario.id} nombre={b.propietario.nombre} tamano={26} />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-[var(--ls-t1)]">
                      {b.propietario.nombre}
                      {b.esMio && <span className="ml-1.5 text-[11px] font-normal text-[var(--ls-t4)]">(tú)</span>}
                    </p>
                    <p className="truncate text-[11.5px] text-[var(--ls-t4)]">{b.direccion}</p>
                  </div>
                </div>
              </td>
              <td className="border-b border-[var(--ls-linea)] px-3">
                <Estado b={b} />
              </td>
              <td className="border-b border-[var(--ls-linea)] px-3 text-right tabular-nums text-[var(--ls-t2)]">{numero(b.resumen.hilos)}</td>
              <td className="border-b border-[var(--ls-linea)] px-3 text-right tabular-nums">
                <span className={b.resumen.hilosSinLeer > 0 ? 'font-semibold text-[var(--ls-t1)]' : 'text-[var(--ls-t4)]'}>{numero(b.resumen.hilosSinLeer)}</span>
              </td>
              <td className="border-b border-[var(--ls-linea)] px-3 text-right tabular-nums">
                <span className={`inline-flex items-center justify-end gap-1 ${b.resumen.esperandoRespuesta > 0 ? 'font-semibold text-[var(--ls-e-ambar)]' : 'text-[var(--ls-t4)]'}`}>
                  {b.resumen.esperandoRespuesta > 0 && <Clock className="h-3 w-3" aria-hidden />}
                  {numero(b.resumen.esperandoRespuesta)}
                </span>
              </td>
              <td className="border-b border-[var(--ls-linea)] px-3 text-[var(--ls-t3)]" suppressHydrationWarning>
                {b.resumen.ultimoMensajeAt ? hace(b.resumen.ultimoMensajeAt) : '—'}
              </td>
              <td className="border-b border-[var(--ls-linea)] px-3 text-right">
                <button type="button" onClick={() => onAbrir(b.id)} className={BOTON_SECUNDARIO}>
                  <Eye className="h-3.5 w-3.5" aria-hidden /> {b.esMio ? 'Abrir' : 'Mirar'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
