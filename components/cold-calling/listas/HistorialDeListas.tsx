'use client'

import { Undo2 } from 'lucide-react'
import { haceCuanto } from '@/lib/cold-calling/fechas'
import type { Movimiento } from '@/lib/cold-calling/listas'
import { ETIQUETA_DE_ACCION, describirMovimiento } from '@/lib/cold-calling/listas-vista'
import { BOTON, TABLA } from '@/lib/estilo/denso'
import { Vacio } from './atomos'

/**
 * LA PESTAÑA «HISTORIAL»: quién movió, asignó o añadió qué, y cuándo. Lo que se hizo en las dos últimas semanas se puede deshacer desde aquí.
 *
 * Deshacer devuelve cada lead a su lista y su dueño de antes SOLO si nadie lo ha vuelto a tocar desde entonces (si lo han movido otra vez, se respeta lo último). Una
 * tanda de tiendas añadidas se deshace quitando las que siguen sin tocar; las que ya tienen una llamada o una nota se quedan.
 */

interface Props {
  movimientos: readonly Movimiento[]
  nombres: Record<string, string>
  puedeCambiar: boolean
  onDeshacer: (m: Movimiento) => void
}

const fechaCompleta = (iso: string) => new Date(iso).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })

export function HistorialDeListas({ movimientos, nombres, puedeCambiar, onDeshacer }: Props) {
  const nombreDe = (id: string | null) => (id ? (nombres[id] ?? 'Persona desconocida') : 'Nadie')
  return (
    <div className={`${TABLA.caja} !flex-none`}>
      <table className={TABLA.tabla}>
        <thead>
          <tr>
            <th className={TABLA.cabecera}>Cuándo</th>
            <th className={TABLA.cabecera}>Quién</th>
            <th className={TABLA.cabecera}>Qué</th>
            <th className={TABLA.cabecera}>Qué pasó</th>
            <th className={`${TABLA.cabecera} text-right`}>
              <span className="sr-only">Deshacer</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {movimientos.length === 0 && (
            <tr>
              <td colSpan={5}>
                <Vacio>Todavía no se ha movido ni asignado nada desde esta pantalla.</Vacio>
              </td>
            </tr>
          )}
          {movimientos.map((m) => (
            <tr key={m.id} className={`${TABLA.fila} ${m.deshecho_at ? 'opacity-55' : ''}`}>
              <td className={`${TABLA.celda} text-[var(--ls-t3)]`} title={fechaCompleta(m.created_at)}>
                {haceCuanto(m.created_at)}
              </td>
              <td className={TABLA.celda}>{nombreDe(m.usuario)}</td>
              <td className={`${TABLA.celda} text-[var(--ls-t3)]`}>{ETIQUETA_DE_ACCION[m.accion] ?? m.accion}</td>
              <td className={`${TABLA.celda} max-w-[520px]`}>
                <span className="block overflow-hidden text-ellipsis text-[var(--ls-t1)]" title={describirMovimiento(m, nombreDe)}>
                  {describirMovimiento(m, nombreDe)}
                </span>
              </td>
              <td className={`${TABLA.celda} text-right`}>
                {m.deshecho_at ? (
                  <span className="text-[11.5px] text-[var(--ls-t4)]" title={`Deshecho ${fechaCompleta(m.deshecho_at)}`}>
                    Deshecho
                  </span>
                ) : m.se_puede_deshacer ? (
                  <button type="button" disabled={!puedeCambiar} onClick={() => onDeshacer(m)} className={`${BOTON.base} ${BOTON.secundario}`} title="Devolver estos leads a como estaban">
                    <Undo2 className="h-3 w-3" aria-hidden /> Deshacer
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
