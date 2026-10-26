'use client'

import { Archive, ArchiveRestore, ChevronDown, Copy, Loader2, Lock, Plus, Rocket, Save } from 'lucide-react'
import { useMemo, useState } from 'react'
import { BOTON } from '@/lib/estilo/denso'
import type { VersionDeWhatsappVista } from '@/lib/whatsapp/ia-laboratorio-tipos'
import { ETIQUETA, LINEA, fechaCorta } from '../correo-laboratorio/ui'

/**
 * LA BARRA DE VERSIONES: qué versión se está viendo, en qué estado está y qué se puede hacer con ella.
 *
 * Una versión es un BORRADOR (se edita, se prueba, no la usa nadie), LA QUE USA EL EQUIPO o una que YA ESTUVO en producción. Estas dos últimas nunca se modifican: si se toca algo se crea una
 * versión nueva a partir de ellas (la pantalla lo hace sola al primer cambio), que es como se evita estropear lo que está funcionando. Publicar pide antes una prueba que haya salido bien con
 * lo que hay en el editor: una configuración que la API rechazara dejaría a todo el equipo sin mensajes. Y antes de confirmar, enseña qué cambia respecto a lo que se usa ahora.
 */

export const NUEVA = 'nueva'

interface Props {
  versiones: VersionDeWhatsappVista[]
  /** El id de la elegida, o NUEVA */
  seleccion: string
  onElegir: (id: string) => void
  version: VersionDeWhatsappVista | null
  /** Si es una versión nueva nacida de otra, el nombre de esa */
  parteDe: string | null
  nombre: string
  notas: string
  onNombre: (v: string) => void
  onNotas: (v: string) => void
  /** Hay cambios sin guardar */
  sucio: boolean
  /** Ocupado guardando, publicando… */
  ocupado: boolean
  /** La base de datos no está lista (migración sin lanzar): se puede probar, no guardar ni publicar */
  sinBase: boolean
  /** Lo que hay en el editor se ha probado y todo salió bien */
  probado: boolean
  /** Qué cambia lo que hay en el editor respecto a lo que usa el equipo (o a la configuración de serie si no hay base de datos), en frases */
  cambios: string[]
  cambiosContra: string
  onGuardar: () => void
  onPublicar: () => void
  onDuplicar: () => void
  onArchivar: (archivada: boolean) => void
}

const porFecha = (campo: 'actualizadaAt' | 'publicadaAt') => (a: VersionDeWhatsappVista, b: VersionDeWhatsappVista) => (b[campo] ?? b.creadaAt).localeCompare(a[campo] ?? a.creadaAt)

export function BarraDeVersion({ versiones, seleccion, onElegir, version, parteDe, nombre, notas, onNombre, onNotas, sucio, ocupado, sinBase, probado, cambios, cambiosContra, onGuardar, onPublicar, onDuplicar, onArchivar }: Props) {
  const [confirma, setConfirma] = useState(false)
  const [verCambios, setVerCambios] = useState(false)
  const esNueva = seleccion === NUEVA
  const bloqueada = !esNueva && version?.bloqueada === true
  const enProduccion = !esNueva && version?.enProduccion === true
  const grupos = useMemo(() => {
    const vivas = versiones.filter((v) => !v.archivada)
    return {
      produccion: vivas.find((v) => v.enProduccion) ?? null,
      borradores: vivas.filter((v) => !v.bloqueada && !v.enProduccion).sort(porFecha('actualizadaAt')),
      historial: vivas.filter((v) => v.bloqueada && !v.enProduccion).sort(porFecha('publicadaAt')),
      archivadas: versiones.filter((v) => v.archivada).sort(porFecha('actualizadaAt')),
    }
  }, [versiones])

  const estado = esNueva
    ? { punto: 'var(--ls-t4)', texto: `Versión nueva${parteDe ? `, a partir de «${parteDe}»` : ''}, sin guardar. Nadie la usa.${sinBase ? ' Todavía no se puede guardar (falta preparar la base de datos), pero puedes probarla.' : ''}` }
    : enProduccion
      ? { punto: 'var(--ls-e-verde)', texto: `La usa todo el equipo ahora${version?.publicadaAt ? ` · desde el ${fechaCorta(version.publicadaAt)}` : ''}. Nunca se modifica: si cambias algo, se crea una versión nueva a partir de ella.` }
      : bloqueada
        ? { punto: 'var(--ls-t3)', texto: `Ya estuvo en producción${version?.publicadaAt ? ` (${fechaCorta(version.publicadaAt)})` : ''}. Nunca se modifica: si cambias algo, se crea una versión nueva a partir de ella; también puedes volver a usarla tal cual.` }
        : version?.archivada
          ? { punto: 'var(--ls-t4)', texto: 'Archivada: no estorba en la lista y no se puede publicar mientras lo esté.' }
          : { punto: 'var(--ls-e-ambar)', texto: 'Borrador: no la usa nadie hasta que la publiques.' }

  const motivoSinPublicar = sinBase
    ? 'Falta preparar la base de datos.'
    : esNueva
      ? 'Guarda la versión para poder publicarla.'
      : version?.archivada
        ? 'Restáurala para poder publicarla.'
        : sucio
          ? 'Guarda los cambios para poder publicarla.'
          : !bloqueada && !probado
            ? 'Pruébala primero (panel de la derecha): así sabes que funciona antes de que la use el equipo.'
            : ''
  const puedePublicar = motivoSinPublicar === '' && !ocupado

  return (
    <section aria-label="Versión" className="space-y-3 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-56">
          <label htmlFor="version-elegida" className={ETIQUETA}>
            Versión
          </label>
          <select
            id="version-elegida"
            value={seleccion}
            onChange={(e) => onElegir(e.target.value)}
            className="h-8 w-full cursor-pointer rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[12.5px] text-[var(--ls-t1)] outline-none hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)]"
          >
            {esNueva && <option value={NUEVA}>{nombre.trim() === '' ? 'Versión nueva' : nombre} (sin guardar)</option>}
            {grupos.produccion && (
              <optgroup label="La que usa el equipo">
                <option value={grupos.produccion.id}>{grupos.produccion.nombre}</option>
              </optgroup>
            )}
            {grupos.borradores.length > 0 && (
              <optgroup label="Borradores">
                {grupos.borradores.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nombre}
                  </option>
                ))}
              </optgroup>
            )}
            {grupos.historial.length > 0 && (
              <optgroup label="Historial (ya estuvieron en producción)">
                {grupos.historial.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nombre}
                    {v.publicadaAt ? ` · ${fechaCorta(v.publicadaAt)}` : ''}
                  </option>
                ))}
              </optgroup>
            )}
            {grupos.archivadas.length > 0 && (
              <optgroup label="Archivadas">
                {grupos.archivadas.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nombre}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <button type="button" onClick={() => onElegir(NUEVA)} disabled={(esNueva && !parteDe) || ocupado} className={`${BOTON.base} ${BOTON.secundario} !h-8`} title="Empieza una versión nueva desde la configuración de serie">
          <Plus className="h-3.5 w-3.5" aria-hidden /> Nueva
        </button>
      </div>

      <p className="flex items-start gap-2 text-[12px] leading-snug text-[var(--ls-t3)]">
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: estado.punto }} aria-hidden />
        <span>
          {estado.texto}
          {sucio && !esNueva && <strong className="ml-1.5 text-[var(--ls-e-ambar)]">· Cambios sin guardar</strong>}
        </span>
      </p>

      {!enProduccion && (
        <div>
          <button type="button" onClick={() => setVerCambios((v) => !v)} aria-expanded={verCambios} className="inline-flex items-center gap-1 text-[12px] text-[var(--ls-t3)] hover:text-[var(--ls-t1)]">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${verCambios ? '' : '-rotate-90'}`} aria-hidden />
            {cambios.length === 0 ? `Idéntica a ${cambiosContra}` : `${cambios.length} ${cambios.length === 1 ? 'cambio' : 'cambios'} respecto a ${cambiosContra}`}
          </button>
          {verCambios && (cambios.length === 0 ? <p className="mt-1 pl-5 text-[11.5px] text-[var(--ls-t4)]">No has tocado nada que cambie lo que escribe la IA.</p> : <ListaDeCambios cambios={cambios} />)}
        </div>
      )}

      {(!bloqueada || esNueva) && !sinBase && (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <div>
            <label htmlFor="version-nombre" className={ETIQUETA}>
              Nombre
            </label>
            <input id="version-nombre" value={nombre} onChange={(e) => onNombre(e.target.value)} maxLength={80} className={LINEA} />
          </div>
          <div>
            <label htmlFor="version-notas" className={ETIQUETA}>
              Qué estás probando (para acordarte)
            </label>
            <input id="version-notas" value={notas} onChange={(e) => onNotas(e.target.value)} maxLength={1000} placeholder="Ej.: trato de usted y una petición más directa" className={LINEA} />
          </div>
        </div>
      )}
      {bloqueada && !esNueva && version?.notas && <p className="text-[11.5px] leading-snug text-[var(--ls-t4)]">{version.notas}</p>}

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--ls-linea)] pt-3">
        {(!bloqueada || esNueva) && (
          <button type="button" onClick={onGuardar} disabled={ocupado || sinBase || (!esNueva && !sucio) || nombre.trim() === ''} className={`${BOTON.base} ${BOTON.secundario} !h-8`} title={sinBase ? 'Falta preparar la base de datos' : undefined}>
            {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Save className="h-3.5 w-3.5" aria-hidden />} {esNueva ? 'Guardar como borrador' : 'Guardar cambios'}
          </button>
        )}
        {!esNueva && (
          <button type="button" onClick={onDuplicar} disabled={ocupado} className={`${BOTON.base} ${BOTON.secundario} !h-8`}>
            <Copy className="h-3.5 w-3.5" aria-hidden /> {bloqueada ? 'Crear una copia para editar' : 'Duplicar'}
          </button>
        )}
        {!enProduccion && !confirma && (
          <button
            type="button"
            onClick={() => setConfirma(true)}
            disabled={!puedePublicar}
            title={motivoSinPublicar || (bloqueada ? 'Vuelve a usar esta versión en todo el equipo' : 'La usará todo el equipo desde ya')}
            className={`${BOTON.base} ${BOTON.primario} !h-8`}
          >
            <Rocket className="h-3.5 w-3.5" aria-hidden /> {bloqueada ? 'Volver a esta versión' : 'Publicar para todo el equipo'}
          </button>
        )}
        {!enProduccion && !confirma && motivoSinPublicar && <span className="text-[11.5px] text-[var(--ls-t4)]">{motivoSinPublicar}</span>}
        {!esNueva && version && !version.esBase && !version.enProduccion && (
          <button type="button" onClick={() => onArchivar(!version.archivada)} disabled={ocupado || sinBase} className={`${BOTON.base} ${BOTON.secundario} !h-8 ml-auto`}>
            {version.archivada ? <ArchiveRestore className="h-3.5 w-3.5" aria-hidden /> : <Archive className="h-3.5 w-3.5" aria-hidden />} {version.archivada ? 'Restaurar' : 'Archivar'}
          </button>
        )}
        {bloqueada && (
          <span className={`inline-flex items-center gap-1 text-[11.5px] text-[var(--ls-t4)] ${version?.esBase || version?.enProduccion ? 'ml-auto' : ''}`}>
            <Lock className="h-3 w-3" aria-hidden /> No se modifica
          </span>
        )}
      </div>

      {confirma && (
        <div role="alertdialog" aria-label="Confirmar la publicación" className="space-y-2 rounded-[8px] border border-[var(--ls-acc-borde)] bg-[var(--ls-sup2)] p-3">
          <p className="text-[12.5px] font-semibold text-[var(--ls-t1)]">
            {bloqueada ? 'Volver a esta versión' : 'Publicar esta versión'}: desde ya la usa todo el equipo comercial.
          </p>
          {cambios.length > 0 ? (
            <div>
              <p className="text-[11.5px] text-[var(--ls-t3)]">Esto es lo que cambia respecto a {cambiosContra}:</p>
              <ListaDeCambios cambios={cambios} />
            </div>
          ) : (
            <p className="text-[11.5px] text-[var(--ls-t3)]">No cambia nada de lo que escribe la IA respecto a {cambiosContra}.</p>
          )}
          <p className="text-[11.5px] text-[var(--ls-t4)]">La anterior no se borra: puedes volver a ella desde el historial cuando quieras.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirma(false)
                onPublicar()
              }}
              disabled={ocupado}
              className={`${BOTON.base} ${BOTON.primario} !h-8`}
            >
              <Rocket className="h-3.5 w-3.5" aria-hidden /> Sí, publicar
            </button>
            <button type="button" onClick={() => setConfirma(false)} className={`${BOTON.base} ${BOTON.secundario} !h-8`}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function ListaDeCambios({ cambios }: { cambios: string[] }) {
  return (
    <ul className="mt-1 list-disc space-y-0.5 pl-9 text-[12px] leading-snug text-[var(--ls-t2)]">
      {cambios.map((c) => (
        <li key={c}>{c}</li>
      ))}
    </ul>
  )
}
