'use client'

import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { AlertCircle, CheckCircle2, Eye, Loader2, Unplug, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { fechaCompleta } from '@/lib/correo/formato'
import type { AccesoRegistrado, BuzonVisible } from '@/lib/correo/tipos'
import { enviarJson, pedir } from './api'
import { BOTON_ICONO, BOTON_PRIMARIO, BOTON_SECUNDARIO, CAMPO } from './ui'

/**
 * LOS AJUSTES DE UN BUZÓN: nombre y firma, contraseña, quién lo ha mirado y desconectarlo.
 *
 * Su dueño ve su firma, su contraseña y el botón de desconectar. Un administrador que abre el de otra persona ve solo el estado, el
 * rastro de accesos y el botón de desconectar (no puede cambiarle la firma ni la contraseña). La ruta lo vuelve a comprobar; `esMio`
 * solo decide qué se pinta.
 *
 * EL RASTRO DE ACCESOS («quién ha mirado este buzón y cuándo») LO VE SOLO UN ADMINISTRADOR (`verAccesos`). Es el registro de auditoría de
 * la empresa y no se enseña a la persona auditada: ni el bloque ni su explicación salen en los ajustes de un empleado, y la ruta
 * /api/correo/accesos tampoco le contesta.
 */

interface Props {
  buzon: BuzonVisible
  esMio: boolean
  /** Es un administrador: el único que ve quién ha mirado el buzón */
  verAccesos: boolean
  onCambio: (buzones: BuzonVisible[]) => void
  onCerrar: () => void
}

const ETIQUETA_DE_ACCION: Record<AccesoRegistrado['accion'], string> = {
  lista: 'miró la lista de correos',
  hilo: 'abrió la conversación',
  busqueda: 'buscó en el buzón',
  adjunto: 'descargó el adjunto',
}

const hace = (iso: string) => formatDistanceToNow(new Date(Math.min(Date.parse(iso), Date.now())), { locale: es, addSuffix: true })

export function AjustesDeBuzon({ buzon, esMio, verAccesos, onCambio, onCerrar }: Props) {
  const [nombre, setNombre] = useState(buzon.nombre ?? '')
  const [firma, setFirma] = useState(buzon.firma ?? '')
  const [password, setPassword] = useState('')
  const [guardando, setGuardando] = useState<null | 'firma' | 'contrasena' | 'desconectar'>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmaDesconectar, setConfirmaDesconectar] = useState(false)
  const [accesos, setAccesos] = useState<AccesoRegistrado[] | null>(null)
  const [errorAccesos, setErrorAccesos] = useState<string | null>(null)

  useEffect(() => {
    // Quien no es administrador ni lo pide: la ruta le contestaría «no existe», pero ni siquiera se intenta
    if (!verAccesos) return
    let vivo = true
    void pedir<{ accesos: AccesoRegistrado[] }>(`/api/correo/accesos?buzon=${encodeURIComponent(buzon.id)}`).then((r) => {
      if (!vivo) return
      if (r.ok) setAccesos(r.datos.accesos)
      else setErrorAccesos(r.mensaje)
    })
    return () => {
      vivo = false
    }
  }, [buzon.id, verAccesos])

  async function guardarFirma() {
    setGuardando('firma')
    setError(null)
    const r = await enviarJson<{ buzones: BuzonVisible[] }>(`/api/correo/buzones/${buzon.id}`, 'PATCH', { nombre, firma })
    setGuardando(null)
    if (!r.ok) return setError(r.mensaje)
    toast.success('Guardado.')
    onCambio(r.datos.buzones)
  }

  async function cambiarContrasena() {
    if (!password) return
    const escrita = password
    setPassword('')
    setGuardando('contrasena')
    setError(null)
    const r = await enviarJson<{ buzones: BuzonVisible[] }>(`/api/correo/buzones/${buzon.id}`, 'PATCH', { password: escrita })
    setGuardando(null)
    if (!r.ok) return setError(r.mensaje)
    toast.success('Contraseña guardada. Vuelves a recibir correos.')
    onCambio(r.datos.buzones)
  }

  async function desconectar() {
    setGuardando('desconectar')
    setError(null)
    const r = await enviarJson<{ buzones: BuzonVisible[] }>(`/api/correo/buzones/${buzon.id}`, 'DELETE')
    setGuardando(null)
    setConfirmaDesconectar(false)
    if (!r.ok) return setError(r.mensaje)
    toast.success('Buzón desconectado. Lo ya importado se queda.')
    onCambio(r.datos.buzones)
  }

  const estado = !buzon.conectado ? 'desconectado' : buzon.credencialesInvalidas ? 'rechazada' : buzon.ultimoError ? 'aviso' : 'bien'

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/55 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()} onKeyDown={(e) => e.key === 'Escape' && onCerrar()}>
      <div role="dialog" aria-modal="true" aria-label="Ajustes del buzón" className="flex max-h-[94dvh] w-full max-w-[560px] flex-col overflow-hidden rounded-t-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-2xl shadow-black/50 sm:rounded-[12px]">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--ls-linea)] px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="text-[13.5px] font-semibold text-[var(--ls-t1)]">Ajustes del buzón</h2>
            <p className="truncate text-[11.5px] text-[var(--ls-t4)]">{buzon.direccion}</p>
          </div>
          <button type="button" onClick={onCerrar} className={BOTON_ICONO} aria-label="Cerrar">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          <section aria-label="Estado" className="space-y-1">
            <p className="flex items-center gap-2 text-[13px] font-medium text-[var(--ls-t1)]">
              {estado === 'bien' ? <CheckCircle2 className="h-4 w-4 text-[var(--ls-e-verde)]" aria-hidden /> : <AlertCircle className="h-4 w-4 text-[var(--ls-e-ambar)]" aria-hidden />}
              {estado === 'bien' && 'Conectado'}
              {estado === 'aviso' && 'Conectado, con un aviso'}
              {estado === 'rechazada' && 'El servidor ha rechazado la contraseña'}
              {estado === 'desconectado' && 'Desconectado'}
            </p>
            <p className="text-[12px] leading-relaxed text-[var(--ls-t3)]" suppressHydrationWarning>
              {buzon.ultimoSyncAt ? `Última lectura ${hace(buzon.ultimoSyncAt)}.` : 'Todavía no se ha leído nada.'} {!buzon.historicoCompleto && buzon.conectado && 'Se están trayendo los correos antiguos.'}
              {' '}Trae los correos desde el {new Date(buzon.desdeFecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}.
            </p>
            {buzon.ultimoError && <p className="text-[12px] text-[var(--ls-e-ambar)]">{buzon.ultimoError}</p>}
          </section>

          {esMio && (
            <section aria-label="Firma" className="space-y-2">
              <h3 className="text-[12px] font-semibold text-[var(--ls-t2)]">Cómo firmas</h3>
              <label className="block space-y-1">
                <span className="text-[11px] text-[var(--ls-t3)]">Tu nombre al enviar</span>
                <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} className={CAMPO} />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] text-[var(--ls-t3)]">Firma (sale ya escrita al redactar; la puedes cambiar en cada mensaje)</span>
                <textarea
                  value={firma}
                  onChange={(e) => setFirma(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  className="w-full resize-y rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-3 text-[13px] leading-relaxed text-[var(--ls-t1)] outline-none transition-colors focus:border-[var(--ls-acc-graf)]"
                />
              </label>
              <button type="button" onClick={guardarFirma} disabled={guardando !== null || !nombre.trim()} className={BOTON_SECUNDARIO}>
                {guardando === 'firma' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Guardar
              </button>
            </section>
          )}

          {esMio && (
            <section aria-label="Contraseña" className="space-y-2">
              <h3 className="text-[12px] font-semibold text-[var(--ls-t2)]">{buzon.conectado ? 'Cambiar la contraseña' : 'Volver a conectar'}</h3>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  spellCheck={false}
                  data-1p-ignore
                  data-lpignore="true"
                  placeholder="Contraseña del buzón"
                  aria-label="Contraseña del buzón"
                  className={CAMPO}
                />
                <button type="button" onClick={cambiarContrasena} disabled={guardando !== null || !password} className={BOTON_PRIMARIO}>
                  {guardando === 'contrasena' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  {guardando === 'contrasena' ? 'Comprobando…' : 'Guardar'}
                </button>
              </div>
              <p className="text-[11.5px] text-[var(--ls-t4)]">Se comprueba contra el servidor antes de guardarla. No se vuelve a mostrar.</p>
            </section>
          )}

          {verAccesos && (
            <section aria-label="Quién ha mirado este buzón" className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--ls-t2)]">
                <Eye className="h-3.5 w-3.5 text-[var(--ls-t4)]" aria-hidden /> Quién ha mirado {esMio ? 'tu buzón' : 'este buzón'}
              </h3>
              {errorAccesos ? (
                <p className="text-[12px] text-[var(--ls-e-ambar)]">{errorAccesos}</p>
              ) : accesos === null ? (
                <p className="text-[12px] text-[var(--ls-t4)]">Cargando…</p>
              ) : accesos.length === 0 ? (
                <p className="text-[12px] text-[var(--ls-t4)]">Nadie lo ha mirado desde que se conectó.</p>
              ) : (
                <ul className="divide-y divide-[var(--ls-linea)] rounded-[8px] border border-[var(--ls-linea)]">
                  {accesos.map((a) => (
                    <li key={a.id} className="px-3 py-2 text-[12px] leading-snug text-[var(--ls-t2)]">
                      <span className="font-medium text-[var(--ls-t1)]">{a.quien}</span> {ETIQUETA_DE_ACCION[a.accion]}
                      {a.asunto ? <span className="text-[var(--ls-t3)]"> «{a.asunto}»</span> : null}
                      <span className="block text-[11px] text-[var(--ls-t4)]" suppressHydrationWarning>
                        {fechaCompleta(a.cuando)} · {hace(a.cuando)}
                      </span>
                    </li>
                  ))}
                </ul>
            )}
            <p className="text-[11.5px] leading-relaxed text-[var(--ls-t4)]">Se anota cuando alguien que supervisa al equipo abre una lista, una conversación, una búsqueda o un adjunto. Varias miradas seguidas a lo mismo cuentan como una.</p>
          </section>
          )}

          {buzon.conectado && (
            <section aria-label="Desconectar" className="space-y-2 border-t border-[var(--ls-linea)] pt-4">
              {confirmaDesconectar ? (
                <>
                  <p className="text-[12px] leading-relaxed text-[var(--ls-t3)]">
                    Se borra la contraseña y dejan de llegar correos nuevos y de poder enviarse. Los correos ya importados se quedan en el ERP.
                  </p>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={desconectar} disabled={guardando !== null} className={`${BOTON_SECUNDARIO} border-[var(--ls-e-rojo)] text-[var(--ls-e-rojo)]`}>
                      {guardando === 'desconectar' ? 'Desconectando…' : 'Sí, desconectar'}
                    </button>
                    <button type="button" onClick={() => setConfirmaDesconectar(false)} className="h-8 px-2 text-[12px] text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
                      No
                    </button>
                  </div>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmaDesconectar(true)} className={BOTON_SECUNDARIO}>
                  <Unplug className="h-3.5 w-3.5" aria-hidden /> Desconectar este buzón
                </button>
              )}
            </section>
          )}

          {error && (
            <p className="flex items-start gap-2 text-[12px] leading-snug text-[var(--ls-e-ambar)]" role="alert">
              <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden /> {error}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
