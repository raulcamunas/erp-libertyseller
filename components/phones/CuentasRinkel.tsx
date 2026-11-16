'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, Copy, Eye, EyeOff, KeyRound, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Boton, Confirmacion, EstadoVacio } from '@/components/ui-ls'
import type { CuentaRinkel } from '@/lib/rinkel-cuentas'

const CAMPO =
  'h-10 w-full min-w-0 rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 text-[13.5px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:text-[16px]'

async function llamar<T>(url: string, init?: { metodo?: string; cuerpo?: unknown }): Promise<T> {
  const res = await fetch(url, { method: init?.metodo ?? 'GET', cache: 'no-store', ...(init?.cuerpo !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.cuerpo) } : {}) })
  const j = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok || !j) throw new Error(j?.error ?? 'No se ha podido completar')
  return j
}

/** CUENTAS DE RINKEL: correo y contraseña de cada cuenta. La contraseña se guarda cifrada y solo se descifra al pulsar «ver» o «copiar». */
export function CuentasRinkel() {
  const [cuentas, setCuentas] = useState<CuentaRinkel[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editando, setEditando] = useState<string | 'nueva' | null>(null)
  const [borrando, setBorrando] = useState<CuentaRinkel | null>(null)
  const [visibles, setVisibles] = useState<Record<string, string>>({})

  const cargar = useCallback(async () => {
    try {
      const j = await llamar<{ cuentas: CuentaRinkel[] }>('/api/rinkel-cuentas')
      setCuentas(j.cuentas)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se han podido leer las cuentas')
    }
  }, [])
  useEffect(() => {
    void cargar()
  }, [cargar])

  async function clave(id: string): Promise<string | null> {
    try {
      return (await llamar<{ clave: string }>(`/api/rinkel-cuentas/${id}/clave`)).clave
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido leer la contraseña')
      return null
    }
  }
  async function alternarVista(id: string) {
    if (visibles[id] !== undefined) {
      setVisibles(({ [id]: _quitada, ...resto }) => resto)
      return
    }
    const c = await clave(id)
    if (c !== null) setVisibles((v) => ({ ...v, [id]: c }))
  }
  async function copiarClave(id: string) {
    const c = visibles[id] ?? (await clave(id))
    if (c === null) return
    navigator.clipboard.writeText(c).then(() => toast.success('Contraseña copiada'), () => toast.error('No se pudo copiar'))
  }

  if (error && !cuentas) return <EstadoVacio icono={KeyRound} acento="marca" compacto titulo="No se pueden mostrar las cuentas" descripcion={error} accion={{ texto: 'Reintentar', onClick: () => void cargar() }} />
  if (!cuentas) return <p className="py-8 text-center text-[13px] text-[var(--ls-t3)]">Cargando…</p>

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-[var(--ls-t3)]">Las contraseñas se guardan cifradas y solo las ven los administradores.</p>
        <Boton variante="primario" icono={Plus} onClick={() => setEditando('nueva')}>
          Añadir cuenta
        </Boton>
      </div>

      {editando === 'nueva' && (
        <Formulario
          onCancelar={() => setEditando(null)}
          onGuardar={async (d) => {
            const j = await llamar<{ cuenta: CuentaRinkel }>('/api/rinkel-cuentas', { metodo: 'POST', cuerpo: d })
            setCuentas((c) => [...(c ?? []), j.cuenta])
            setEditando(null)
            toast.success('Cuenta añadida')
          }}
        />
      )}

      {cuentas.length === 0 && editando !== 'nueva' ? (
        <EstadoVacio icono={KeyRound} acento="marca" compacto titulo="Todavía no hay cuentas de Rinkel" descripcion="Añade la primera con su correo y su contraseña." accion={{ texto: 'Añadir cuenta', onClick: () => setEditando('nueva') }} />
      ) : (
        <ul role="list" className="divide-y divide-[var(--ls-linea)] overflow-hidden rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
          {cuentas.map((c) =>
            editando === c.id ? (
              <li key={c.id} className="p-3">
                <Formulario
                  inicial={c}
                  onCancelar={() => setEditando(null)}
                  onGuardar={async (d) => {
                    const j = await llamar<{ cuenta: CuentaRinkel }>(`/api/rinkel-cuentas/${c.id}`, { metodo: 'PATCH', cuerpo: d.clave === undefined ? { email: d.email, notas: d.notas } : d })
                    setCuentas((xs) => (xs ?? []).map((x) => (x.id === c.id ? j.cuenta : x)))
                    setVisibles(({ [c.id]: _vieja, ...resto }) => resto)
                    setEditando(null)
                    toast.success('Guardado')
                  }}
                />
              </li>
            ) : (
              <li key={c.id} className="group flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 sm:w-[34%]">
                  <p className="truncate text-[13.5px] font-semibold text-[var(--ls-t1)]">{c.email}</p>
                  {c.notas && <p className="truncate text-[12px] text-[var(--ls-t3)]">{c.notas}</p>}
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {c.tiene_clave ? (
                    <>
                      <span className="min-w-0 truncate rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-[5px] font-mono text-[13px] text-[var(--ls-t1)]">{visibles[c.id] ?? '••••••••••'}</span>
                      <BotonIcono etiqueta={visibles[c.id] !== undefined ? 'Ocultar' : 'Ver'} onClick={() => void alternarVista(c.id)}>
                        {visibles[c.id] !== undefined ? <EyeOff className="h-[14px] w-[14px]" /> : <Eye className="h-[14px] w-[14px]" />}
                      </BotonIcono>
                      <BotonIcono etiqueta="Copiar la contraseña" onClick={() => void copiarClave(c.id)}>
                        <Copy className="h-[14px] w-[14px]" />
                      </BotonIcono>
                    </>
                  ) : (
                    <span className="text-[12.5px] text-[var(--ls-t4)]">Sin contraseña guardada</span>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <BotonIcono etiqueta="Copiar el correo" onClick={() => navigator.clipboard.writeText(c.email).then(() => toast.success('Correo copiado'), () => toast.error('No se pudo copiar'))}>
                    <Copy className="h-[14px] w-[14px]" />
                  </BotonIcono>
                  <BotonIcono etiqueta="Editar" onClick={() => setEditando(c.id)}>
                    <Pencil className="h-[14px] w-[14px]" />
                  </BotonIcono>
                  <BotonIcono etiqueta="Borrar" onClick={() => setBorrando(c)}>
                    <Trash2 className="h-[14px] w-[14px]" />
                  </BotonIcono>
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      <Confirmacion
        abierto={!!borrando}
        onCambio={(a) => !a && setBorrando(null)}
        titulo="¿Borrar esta cuenta?"
        descripcion={borrando ? `${borrando.email}. Se borra con su contraseña y no se puede deshacer.` : null}
        palabra={null}
        textoConfirmar="Borrar"
        onConfirmar={async () => {
          if (!borrando) return
          await llamar(`/api/rinkel-cuentas/${borrando.id}`, { metodo: 'DELETE' })
          setCuentas((xs) => (xs ?? []).filter((x) => x.id !== borrando.id))
          toast.success('Cuenta borrada')
        }}
      />
    </div>
  )
}

function BotonIcono({ etiqueta, onClick, children }: { etiqueta: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={etiqueta} title={etiqueta} className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-[var(--ls-t4)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
      {children}
    </button>
  )
}

/** Alta y edición. En edición, la contraseña en blanco = no tocarla */
function Formulario({ inicial, onGuardar, onCancelar }: { inicial?: CuentaRinkel; onGuardar: (d: { email: string; notas: string; clave?: string }) => Promise<void>; onCancelar: () => void }) {
  const [email, setEmail] = useState(inicial?.email ?? '')
  const [clave, setClave] = useState('')
  const [notas, setNotas] = useState(inicial?.notas ?? '')
  const [ver, setVer] = useState(false)
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    setGuardando(true)
    try {
      await onGuardar({ email, notas, ...(clave !== '' || !inicial ? { clave } : {}) })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="mb-3 rounded-[14px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-[12px] text-[var(--ls-t3)]">
          Correo
          <input className={CAMPO} type="email" autoFocus autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cuenta@empresa.com" />
        </label>
        <label className="text-[12px] text-[var(--ls-t3)]">
          Contraseña {inicial?.tiene_clave && <span className="text-[var(--ls-t4)]">(en blanco = no cambiarla)</span>}
          <span className="relative block">
            <input className={`${CAMPO} pr-10`} type={ver ? 'text' : 'password'} autoComplete="new-password" value={clave} onChange={(e) => setClave(e.target.value)} />
            <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? 'Ocultar' : 'Mostrar'} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
              {ver ? <EyeOff className="h-[15px] w-[15px]" /> : <Eye className="h-[15px] w-[15px]" />}
            </button>
          </span>
        </label>
        <label className="text-[12px] text-[var(--ls-t3)] sm:col-span-2">
          Notas
          <input className={CAMPO} value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={500} placeholder="Para qué es esta cuenta (opcional)" />
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Boton variante="secundario" icono={X} onClick={onCancelar}>
          Cancelar
        </Boton>
        <Boton variante="primario" icono={Check} cargando={guardando} onClick={() => void guardar()}>
          Guardar
        </Boton>
      </div>
    </div>
  )
}
