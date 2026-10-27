'use client'

import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { History, Loader2, Users } from 'lucide-react'
import { CrmInteractions } from '../CrmInteractions'
import { toMadrid } from '@/lib/timezone'
import { CRM_STAGE_DOTS, CRM_STAGE_LABELS } from '@/lib/types/crm'
import type { LineaDeFases } from '@/lib/crm/fases'
import { Boton, Insignia, Seccion } from './piezas'
import type { ContextoFicha } from './tipos'

const cuando = (iso: string) => format(toMadrid(new Date(iso)), "d MMM yyyy · HH:mm", { locale: es })

/** Lo que ha pasado con el cliente: las tomas de contacto (apuntar sí, borrar solo dirección), el historial de fases y las reuniones con notas */
export function PestanaActividad({ ctx, linea }: { ctx: ContextoFicha; linea: LineaDeFases }) {
  // Más reciente arriba; la fila «recuperado» se dice como lo que es: una fecha aproximada
  const historial = [...ctx.historial].sort((a, b) => b.desde.localeCompare(a.desde))
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <Seccion titulo="Tomas de contacto" icono={<History />}>
        {ctx.cargando ? (
          <p className="flex items-center gap-1.5 text-[11.5px] text-[var(--ls-t4)]">
            <Loader2 className="h-3 w-3 animate-spin" /> Cargando…
          </p>
        ) : (
          <CrmInteractions clientId={ctx.client.id} currentUser={ctx.currentUser} interactions={ctx.interacciones} onChange={ctx.setInteracciones} puedeBorrar={ctx.puedeEditar} />
        )}
      </Seccion>

      <div className="flex min-w-0 flex-col gap-3">
        <Seccion titulo="Historial de fases" icono={<History />}>
          {ctx.migracionFalta ? (
            <p className="text-[12px] text-[var(--ls-t3)]">El historial de fases empieza a guardarse en cuanto se lance la migración 258.</p>
          ) : historial.length === 0 ? (
            <p className="text-[12px] text-[var(--ls-t3)]">Todavía no consta ningún cambio de fase.</p>
          ) : (
            <ol className="space-y-[9px]">
              {historial.map((h, i) => (
                <li key={`${h.etapa}-${h.desde}-${i}`} className="flex items-start gap-2">
                  <span className="mt-[5px] h-[8px] w-[8px] shrink-0 rounded-full" style={{ backgroundColor: CRM_STAGE_DOTS[h.etapa] }} />
                  <div className="min-w-0">
                    <p className="text-[12.5px] text-[var(--ls-t1)]">
                      {h.origen === 'alta' ? 'Alta en ' : h.origen === 'recuperado' ? 'Estaba en ' : 'Pasó a '}
                      <strong className="font-semibold">{CRM_STAGE_LABELS[h.etapa]}</strong>
                    </p>
                    <p className="text-[11px] tabular-nums text-[var(--ls-t4)]">
                      {h.origen === 'recuperado' ? 'Desde ~' : ''}
                      {cuando(h.desde)}
                      {h.origen === 'recuperado' ? ' (fecha aproximada: la ficha es anterior al historial)' : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {linea.diasEnLaActual !== null && !ctx.migracionFalta && <p className="mt-2 border-t border-[var(--ls-linea)] pt-2 text-[11.5px] text-[var(--ls-t3)]">Lleva {linea.diasEnLaActual === 0 ? 'menos de un día' : `${linea.diasEnLaActual} día${linea.diasEnLaActual === 1 ? '' : 's'}`} en esta fase.</p>}
        </Seccion>

        <Seccion titulo="Reuniones" icono={<Users />}>
          {ctx.notas.length === 0 ? (
            <p className="text-[12px] text-[var(--ls-t3)]">Todavía no hay notas de reunión de este cliente.</p>
          ) : (
            <ul className="space-y-2">
              {ctx.notas.map((n) => (
                <li key={n.id} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] text-[var(--ls-t1)]">{n.fecha_reunion ? cuando(n.fecha_reunion) : 'Fecha sin determinar'}</p>
                    <p className="truncate text-[11px] text-[var(--ls-t4)]">{n.resumen ?? n.titulo}</p>
                  </div>
                  <Insignia tono={n.estado === 'procesada' ? 'verde' : n.estado === 'error' ? 'rojo' : 'ambar'}>{n.estado === 'procesada' ? 'Analizada' : n.estado === 'error' ? 'Error' : 'Por analizar'}</Insignia>
                </li>
              ))}
            </ul>
          )}
          {ctx.notas.length > 0 && (
            <div className="mt-2">
              <Boton onClick={() => ctx.irA('reunion')}>Abrir la reunión</Boton>
            </div>
          )}
        </Seccion>
      </div>
    </div>
  )
}
