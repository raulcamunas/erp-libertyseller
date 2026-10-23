'use client'

import { BookText, Loader2, Lock, Plus, Save, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { enviarJson } from '@/components/correo/api'
import { PANEL } from '@/components/rendimiento/ui'
import type { EjemploVista, VersionVista } from '@/lib/correo/ia-laboratorio-tipos'
import { validarEjemplo } from '@/lib/correo/ia-version'
import { AYUDA, BOTON_PRIMARIO, BOTON_SECUNDARIO, CAJA, ETIQUETA, LINEA, fechaCorta } from './ui'

/**
 * MIS EJEMPLOS: los correos que escribe quien supervisa al equipo.
 *
 * Son los «textos ganadores» candidatos. Una versión de la IA elige cuáles se le enseñan y la IA imita su estructura, su ritmo y su tono
 * (nunca copia sus datos). Aquí se escriben, se corrigen y se desactivan. Si una versión que ya ha escrito borradores lee un ejemplo, queda
 * bloqueado: cambiarlo mezclaría los resultados de antes y de después. Entonces se crea uno nuevo con los cambios.
 */

const NUEVO = 'nuevo'

const TIPOS: ReadonlyArray<{ id: EjemploVista['tipo']; texto: string }> = [
  { id: 'ambos', texto: 'Para cualquiera' },
  { id: 'entrar', texto: 'Para quien todavía no vende en Amazon' },
  { id: 'optimizar', texto: 'Para quien ya vende en Amazon' },
]

interface Props {
  versiones: VersionVista[]
  ejemplos: EjemploVista[]
  onCambio: () => Promise<void>
  /** Para abrir directamente uno recién creado (al copiarlo desde «Lo que ya funciona») */
  inicial?: string
}

export function TabEjemplos({ versiones, ejemplos, onCambio, inicial }: Props) {
  const [seleccion, setSeleccion] = useState<string>(inicial ?? ejemplos[0]?.id ?? NUEVO)
  const ejemplo = seleccion === NUEVO ? null : (ejemplos.find((e) => e.id === seleccion) ?? null)

  async function alGuardar(id: string) {
    await onCambio()
    setSeleccion(id)
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
      <aside className={`${PANEL} overflow-hidden`} aria-label="Mis ejemplos">
        <div className="space-y-2 border-b border-[var(--ls-linea)] p-3">
          <p className="text-[12px] leading-snug text-[var(--ls-t3)]">Correos que has escrito tú para enseñarle a la IA cómo suena un buen correo.</p>
          <button type="button" onClick={() => setSeleccion(NUEVO)} className={`${BOTON_SECUNDARIO} w-full`}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> Nuevo ejemplo
          </button>
        </div>
        {ejemplos.length === 0 ? (
          <p className="px-3 py-4 text-[12px] text-[var(--ls-t4)]">Todavía no hay ninguno. Escribe el primero o copia uno desde «Lo que ya funciona».</p>
        ) : (
          <ul>
            {ejemplos.map((e) => {
              const usadoPor = versiones.filter((v) => v.ejemplosIds.includes(e.id)).length
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setSeleccion(e.id)}
                    aria-current={e.id === seleccion}
                    className={`flex w-full flex-col gap-0.5 border-b border-[var(--ls-linea)] px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-[var(--ls-sup3)] ${e.id === seleccion ? 'bg-[var(--ls-acc-suave)] shadow-[inset_2px_0_0_var(--ls-acc-graf)]' : ''}`}
                  >
                    <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--ls-t1)]">
                      <span className="min-w-0 truncate">{e.titulo}</span>
                      {e.bloqueado && <Lock className="h-3 w-3 shrink-0 text-[var(--ls-t4)]" aria-label="Bloqueado" />}
                    </span>
                    <span className="truncate text-[11.5px] text-[var(--ls-t4)]">{e.asunto}</span>
                    <span className="text-[11px] text-[var(--ls-t4)]">
                      {e.activo ? 'Activo' : 'Desactivado'} · {usadoPor === 0 ? 'ninguna versión lo usa' : `lo usa${usadoPor === 1 ? '' : 'n'} ${usadoPor} ${usadoPor === 1 ? 'versión' : 'versiones'}`} · {fechaCorta(e.creadoAt)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </aside>

      <section className={`${PANEL} p-4`} aria-label={ejemplo ? `Editar ${ejemplo.titulo}` : 'Nuevo ejemplo'}>
        <div className="mb-3 flex items-center gap-2">
          <BookText className="h-4 w-4 text-[var(--ls-acc)]" aria-hidden />
          <h2 className="text-[14px] font-semibold text-[var(--ls-t1)]">{ejemplo ? ejemplo.titulo : 'Nuevo ejemplo'}</h2>
        </div>
        <EditorDeEjemplo key={ejemplo?.id ?? NUEVO} ejemplo={ejemplo} onGuardado={alGuardar} onBorrado={async () => { await onCambio(); setSeleccion(NUEVO) }} />
      </section>
    </div>
  )
}

function EditorDeEjemplo({ ejemplo, onGuardado, onBorrado }: { ejemplo: EjemploVista | null; onGuardado: (id: string) => Promise<void>; onBorrado: () => Promise<void> }) {
  const bloqueado = ejemplo?.bloqueado === true
  const [titulo, setTitulo] = useState(ejemplo?.titulo ?? '')
  const [asunto, setAsunto] = useState(ejemplo?.asunto ?? '')
  const [texto, setTexto] = useState(ejemplo?.texto ?? '')
  const [tipo, setTipo] = useState<EjemploVista['tipo']>(ejemplo?.tipo ?? 'ambos')
  const [nota, setNota] = useState(ejemplo?.nota ?? '')
  const [activo, setActivo] = useState(ejemplo?.activo ?? true)
  const [guardando, setGuardando] = useState(false)
  const [confirmaBorrar, setConfirmaBorrar] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Lo que se ve mientras se escribe: lo que la IA va a ignorar o a recibir tapado (la misma comprobación que hace el servidor)
  const avisos = useMemo(() => {
    const v = validarEjemplo({ titulo, asunto, texto, tipo, nota })
    return v.ok ? v.avisos : []
  }, [titulo, asunto, texto, tipo, nota])

  async function guardar() {
    if (guardando) return
    setError(null)
    setGuardando(true)
    const cuerpo = { titulo, asunto, texto, tipo, nota, activo }
    const r = ejemplo
      ? await enviarJson<{ ejemplo: EjemploVista; avisos: string[] }>(`/api/correo/laboratorio/ejemplos/${ejemplo.id}`, 'PATCH', cuerpo)
      : await enviarJson<{ ejemplo: EjemploVista; avisos: string[] }>('/api/correo/laboratorio/ejemplos', 'POST', cuerpo)
    setGuardando(false)
    if (!r.ok) return setError(r.mensaje)
    toast.success(ejemplo ? 'Ejemplo guardado.' : 'Ejemplo creado. Ahora elígelo en una versión para que la IA lo vea.')
    await onGuardado(r.datos.ejemplo.id)
  }

  async function borrar() {
    if (!ejemplo || guardando) return
    setGuardando(true)
    const r = await enviarJson(`/api/correo/laboratorio/ejemplos/${ejemplo.id}`, 'DELETE')
    setGuardando(false)
    setConfirmaBorrar(false)
    if (!r.ok) return setError(r.mensaje)
    toast.success('Ejemplo borrado.')
    await onBorrado()
  }

  return (
    <div className="space-y-3">
      {bloqueado && (
        <div className="flex items-start gap-2 rounded-[8px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 py-2 text-[12px] leading-snug text-[var(--ls-t3)]">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)]" aria-hidden />
          <span>Una versión que ya ha escrito borradores lo usa: su texto no se puede cambiar ni se puede borrar (los resultados de esa versión dejarían de decir lo que dicen). Crea uno nuevo con los cambios. El título y la nota sí se pueden cambiar.</span>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ejemplo-titulo" className={ETIQUETA}>
            Título (para reconocerlo)
          </label>
          <input id="ejemplo-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={80} placeholder="Ej.: Entrar con pregunta" className={LINEA} />
        </div>
        <div>
          <label htmlFor="ejemplo-tipo" className={ETIQUETA}>
            Para qué leads sirve
          </label>
          <select
            id="ejemplo-tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as EjemploVista['tipo'])}
            disabled={bloqueado}
            className="h-8 w-full cursor-pointer rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[12.5px] text-[var(--ls-t1)] outline-none hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {TIPOS.map((t) => (
              <option key={t.id} value={t.id} className="bg-[var(--ls-sup)]">
                {t.texto}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="ejemplo-asunto" className={ETIQUETA}>
          Asunto
        </label>
        <input id="ejemplo-asunto" value={asunto} onChange={(e) => setAsunto(e.target.value)} maxLength={150} disabled={bloqueado} className={LINEA} />
      </div>
      <div>
        <label htmlFor="ejemplo-texto" className={ETIQUETA}>
          Correo
        </label>
        <textarea id="ejemplo-texto" value={texto} onChange={(e) => setTexto(e.target.value)} rows={14} maxLength={4000} disabled={bloqueado} placeholder={'Hola,\n\nEscribe aquí el correo tal como lo enviarías…'} className={CAJA} />
        <p className={AYUDA}>
          Escríbelo como un correo completo, sin huecos entre corchetes. La IA aprende la estructura y el tono; no copia nombres ni datos. {texto.length.toLocaleString('es-ES')} / 4.000 caracteres.
        </p>
      </div>
      <div>
        <label htmlFor="ejemplo-nota" className={ETIQUETA}>
          Nota (opcional)
        </label>
        <input id="ejemplo-nota" value={nota} onChange={(e) => setNota(e.target.value)} maxLength={500} placeholder="Ej.: me funcionó con tiendas de moda" className={LINEA} />
      </div>
      {ejemplo && (
        <label className={`flex items-center gap-2 text-[12.5px] text-[var(--ls-t2)] ${bloqueado ? 'opacity-70' : 'cursor-pointer'}`}>
          <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} disabled={bloqueado} className="h-3.5 w-3.5 accent-[var(--ls-acc-graf)]" /> Activo (si lo desactivas, las versiones que lo eligen no se lo enseñan a la IA)
        </label>
      )}

      {avisos.map((a) => (
        <p key={a} className="text-[12px] leading-snug text-[var(--ls-e-ambar)]" role="status">
          {a}
        </p>
      ))}
      {error && (
        <p className="text-[12.5px] leading-snug text-[var(--ls-e-ambar)]" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--ls-linea)] pt-3">
        <button type="button" onClick={() => void guardar()} disabled={guardando} className={BOTON_PRIMARIO}>
          {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Save className="h-3.5 w-3.5" aria-hidden />}
          {ejemplo ? 'Guardar cambios' : 'Guardar ejemplo'}
        </button>
        {ejemplo &&
          !bloqueado &&
          (confirmaBorrar ? (
            <span className="ml-auto inline-flex items-center gap-2 text-[12.5px] text-[var(--ls-t2)]">
              ¿Borrarlo?
              <button type="button" onClick={() => void borrar()} disabled={guardando} className="rounded-[6px] border border-[var(--ls-e-rojo)] px-2.5 py-1 text-[12px] text-[var(--ls-e-rojo)] hover:bg-[var(--ls-sup3)]">
                Sí, borrar
              </button>
              <button type="button" onClick={() => setConfirmaBorrar(false)} className="text-[12px] text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
                No
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmaBorrar(true)} disabled={guardando} className={`${BOTON_SECUNDARIO} ml-auto`}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden /> Borrar
            </button>
          ))}
      </div>
    </div>
  )
}
