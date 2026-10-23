'use client'

import { Archive, FlaskConical, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { PANEL } from '@/components/rendimiento/ui'
import type { EjemploVista, VersionVista } from '@/lib/correo/ia-laboratorio-tipos'
import { EditorDeVersion } from './EditorDeVersion'
import { BOTON_SECUNDARIO } from './ui'

/**
 * LA LISTA DE VERSIONES Y SU EDITOR.
 *
 * A la izquierda, las versiones con su estado en el reparto (cuántos de cada 100 correos escribe cada una) y cuántos correos ha enviado; a la
 * derecha, el editor de la que se elija o de una nueva. La versión original va siempre la primera: es el punto de comparación.
 */

const NUEVA = 'nueva'

interface Props {
  versiones: VersionVista[]
  ejemplos: EjemploVista[]
  /** Recargar los datos sin parpadeo */
  onCambio: () => Promise<void>
}

export function TabVersiones({ versiones, ejemplos, onCambio }: Props) {
  const [verArchivadas, setVerArchivadas] = useState(false)
  const archivadas = versiones.filter((v) => v.archivada).length
  const visibles = useMemo(() => versiones.filter((v) => verArchivadas || !v.archivada).sort((a, b) => Number(b.esBase) - Number(a.esBase)), [versiones, verArchivadas])
  const [seleccion, setSeleccion] = useState<string>(() => visibles.find((v) => v.porcentaje > 0)?.id ?? visibles[0]?.id ?? NUEVA)

  // Si la elegida desaparece (se archiva sin ver archivadas), se vuelve a la primera
  useEffect(() => {
    if (seleccion !== NUEVA && !versiones.some((v) => v.id === seleccion && (verArchivadas || !v.archivada))) setSeleccion(visibles[0]?.id ?? NUEVA)
  }, [seleccion, versiones, verArchivadas, visibles])

  const version = seleccion === NUEVA ? null : (versiones.find((v) => v.id === seleccion) ?? null)
  const reparto = versiones.filter((v) => v.porcentaje > 0)

  async function alGuardar(id: string) {
    await onCambio()
    setSeleccion(id)
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
      <aside className={`${PANEL} overflow-hidden`} aria-label="Versiones de la IA">
        <div className="space-y-2 border-b border-[var(--ls-linea)] p-3">
          <p className="text-[12px] leading-snug text-[var(--ls-t3)]">
            {reparto.length === 0 ? (
              'Ninguna versión en marcha: la IA usa las instrucciones originales.'
            ) : (
              <>
                <span className="font-semibold text-[var(--ls-t2)]">Reparto ahora:</span> {reparto.map((v) => `${v.nombre} ${v.porcentaje} %`).join(' · ')}
              </>
            )}
          </p>
          <button type="button" onClick={() => setSeleccion(NUEVA)} className={`${BOTON_SECUNDARIO} w-full`}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> Nueva versión
          </button>
        </div>
        <ul>
          {visibles.map((v) => {
            const activa = v.id === seleccion
            const estado = v.archivada ? 'Archivada' : v.porcentaje > 0 ? `En marcha · ${v.porcentaje} %` : v.activa ? 'En marcha · sin peso' : 'Pausada'
            return (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setSeleccion(v.id)}
                  aria-current={activa}
                  className={`flex w-full flex-col gap-0.5 border-b border-[var(--ls-linea)] px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-[var(--ls-sup3)] ${activa ? 'bg-[var(--ls-acc-suave)] shadow-[inset_2px_0_0_var(--ls-acc-graf)]' : ''}`}
                >
                  <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--ls-t1)]">
                    <span className="min-w-0 truncate">{v.nombre}</span>
                    {v.esBase && <span className="shrink-0 rounded-[4px] bg-[var(--ls-sup3)] px-1.5 py-px text-[10px] font-medium text-[var(--ls-t3)]">Original</span>}
                  </span>
                  <span className={`text-[11.5px] ${v.porcentaje > 0 ? 'text-[var(--ls-e-verde)]' : 'text-[var(--ls-t4)]'}`}>{estado}</span>
                  <span className="text-[11px] text-[var(--ls-t4)]">
                    {v.enviados} {v.enviados === 1 ? 'enviado' : 'enviados'}
                    {v.generados > v.enviados ? ` · ${v.generados} escritos` : ''}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        {archivadas > 0 && (
          <button type="button" onClick={() => setVerArchivadas((x) => !x)} className="flex w-full items-center gap-1.5 border-t border-[var(--ls-linea)] px-3 py-2 text-left text-[11.5px] text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
            <Archive className="h-3 w-3" aria-hidden /> {verArchivadas ? 'Ocultar' : 'Ver'} las archivadas ({archivadas})
          </button>
        )}
      </aside>

      <section className={`${PANEL} p-4`} aria-label={version ? `Editar ${version.nombre}` : 'Nueva versión'}>
        <div className="mb-3 flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-[var(--ls-acc)]" aria-hidden />
          <h2 className="text-[14px] font-semibold text-[var(--ls-t1)]">{version ? version.nombre : 'Nueva versión'}</h2>
          {!version && <span className="text-[12px] text-[var(--ls-t4)]">Parte de las instrucciones originales. Nace pausada: pruébala y ponla en marcha cuando te convenza.</span>}
        </div>
        <EditorDeVersion key={version?.id ?? NUEVA} version={version} todas={versiones} ejemplos={ejemplos} onGuardada={alGuardar} onCambio={onCambio} />
      </section>
    </div>
  )
}
