'use client'

import { FlaskConical, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { PANEL } from '@/components/rendimiento/ui'
import type { EjemploVista, VersionVista } from '@/lib/correo/ia-laboratorio-tipos'
import type { CasoVista } from '@/lib/whatsapp/ia-casos'
import { EditorDeVersion } from './EditorDeVersion'
import { BOTON_SECUNDARIO, ETIQUETA } from './ui'

/**
 * LAS VERSIONES Y SU EDITOR.
 *
 * Arriba, un selector con las versiones y su estado en el reparto (cuántos de cada 100 correos escribe cada una) y cuántos correos ha enviado; debajo, el editor de la que se elija o de una
 * nueva, con la prueba siempre a la vista a su derecha. La versión original va siempre la primera: es el punto de comparación. Es el mismo esquema que el de WhatsApp: elegir arriba,
 * ajustar a la izquierda, probar a la derecha.
 */

const NUEVA = 'nueva'

interface Props {
  versiones: VersionVista[]
  ejemplos: EjemploVista[]
  casos: CasoVista[]
  /** Recargar los datos sin parpadeo */
  onCambio: () => Promise<void>
}

const estadoDe = (v: VersionVista) => (v.archivada ? 'Archivada' : v.porcentaje > 0 ? `En marcha · ${v.porcentaje} %` : v.activa ? 'En marcha · sin peso' : 'Pausada')
const enviados = (v: VersionVista) => `${v.enviados} ${v.enviados === 1 ? 'enviado' : 'enviados'}${v.generados > v.enviados ? ` · ${v.generados} escritos` : ''}`

export function TabVersiones({ versiones, ejemplos, casos, onCambio }: Props) {
  const ordenadas = useMemo(() => [...versiones].sort((a, b) => Number(b.esBase) - Number(a.esBase)), [versiones])
  const [seleccion, setSeleccion] = useState<string>(() => ordenadas.find((v) => v.porcentaje > 0 && !v.archivada)?.id ?? ordenadas.find((v) => !v.archivada)?.id ?? NUEVA)

  // Si la elegida desaparece, se vuelve a la primera
  useEffect(() => {
    if (seleccion !== NUEVA && !versiones.some((v) => v.id === seleccion)) setSeleccion(ordenadas.find((v) => !v.archivada)?.id ?? NUEVA)
  }, [seleccion, versiones, ordenadas])

  const version = seleccion === NUEVA ? null : (versiones.find((v) => v.id === seleccion) ?? null)
  const reparto = versiones.filter((v) => v.porcentaje > 0)
  const vivas = ordenadas.filter((v) => !v.archivada)
  const archivadas = ordenadas.filter((v) => v.archivada)

  async function alGuardar(id: string) {
    await onCambio()
    setSeleccion(id)
  }

  return (
    <div className="space-y-3">
      <section className={`${PANEL} space-y-2 p-3`} aria-label="Versiones de la IA">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 basis-60">
            <label htmlFor="version-elegida-correo" className={ETIQUETA}>
              Versión
            </label>
            <select
              id="version-elegida-correo"
              value={seleccion}
              onChange={(e) => setSeleccion(e.target.value)}
              className="h-8 w-full cursor-pointer rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[12.5px] text-[var(--ls-t1)] outline-none hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)]"
            >
              {seleccion === NUEVA && <option value={NUEVA}>Versión nueva (sin guardar)</option>}
              <optgroup label="Versiones">
                {vivas.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nombre}
                    {v.esBase ? ' (original)' : ''} · {estadoDe(v)}
                  </option>
                ))}
              </optgroup>
              {archivadas.length > 0 && (
                <optgroup label="Archivadas">
                  {archivadas.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.nombre}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          <button type="button" onClick={() => setSeleccion(NUEVA)} disabled={seleccion === NUEVA} className={BOTON_SECUNDARIO}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> Nueva versión
          </button>
        </div>
        <p className="text-[12px] leading-snug text-[var(--ls-t3)]">
          {reparto.length === 0 ? (
            'Ninguna versión en marcha: la IA usa las instrucciones originales.'
          ) : (
            <>
              <span className="font-semibold text-[var(--ls-t2)]">Reparto ahora:</span> {reparto.map((v) => `${v.nombre} ${v.porcentaje} %`).join(' · ')}
            </>
          )}
          {version && (
            <span className="text-[var(--ls-t4)]">
              {' '}
              · Ésta: {estadoDe(version).toLowerCase()} · {enviados(version)}
            </span>
          )}
        </p>
      </section>

      <section className={`${PANEL} p-4`} aria-label={version ? `Editar ${version.nombre}` : 'Nueva versión'}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FlaskConical className="h-4 w-4 text-[var(--ls-acc)]" aria-hidden />
          <h2 className="text-[14px] font-semibold text-[var(--ls-t1)]">{version ? version.nombre : 'Nueva versión'}</h2>
          {!version && <span className="text-[12px] text-[var(--ls-t4)]">Parte de las instrucciones originales. Nace pausada: pruébala y ponla en marcha cuando te convenza.</span>}
        </div>
        <EditorDeVersion key={version?.id ?? NUEVA} version={version} todas={versiones} ejemplos={ejemplos} casos={casos} onGuardada={alGuardar} onCambio={onCambio} />
      </section>
    </div>
  )
}
