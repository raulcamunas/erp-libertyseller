'use client'

import { useMemo, useState } from 'react'
import { Check, Lock, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { COLORES, ICONOS, PERSONAJES, ocupadosPorOtros } from '@/lib/tareas-clientes/apariencia'
import { useApariencia } from './AparienciaProvider'
import { AvatarDePersona, DIBUJOS } from './AvatarTC'

/**
 * EL PERFIL: eliges el color y el icono (o un personaje) con los que sales en las tareas, en el chat y en la barra del ERP. Se abre al pulsar tu círculo, abajo a la izquierda (components/layout/PerfilEnLaBarra.tsx).
 * Lo que ya tiene un compañero sale bloqueado, con su nombre. Ver lib/tareas-clientes/apariencia.ts.
 */
export function EditorDePerfil({ miId, nombre }: { miId: string; nombre: string }) {
  const { mapa, disponible, guardar, nombres } = useApariencia()
  const [ocupado, setOcupado] = useState(false)
  const yo = mapa[miId] ?? { color: null, icono: null }
  const [pestana, setPestana] = useState<'iconos' | 'personajes'>(yo.icono?.startsWith('e-') ? 'personajes' : 'iconos')
  const otros = useMemo(() => ocupadosPorOtros(mapa, miId), [mapa, miId])
  const quien = (id: string) => nombres[id] ?? 'otra persona'

  const elegir = async (color: string | null, icono: string | null) => {
    setOcupado(true)
    try {
      await guardar(color, icono)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="flex flex-col gap-3" aria-busy={ocupado}>
      <div className="flex items-center gap-3">
        <AvatarDePersona color={yo.color} icono={yo.icono} id={miId} nombre={nombre} tamano={44} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-[var(--ls-t1)]">{nombre}</span>
          <span className="block text-[11.5px] text-[var(--ls-t3)]">{yo.color || yo.icono ? 'Así sales en las tareas y el chat' : 'Elige tu color y tu icono'}</span>
        </span>
        {(yo.color || yo.icono) && (
          <button type="button" disabled={ocupado} onClick={() => void elegir(null, null)} className="rounded-[7px] px-2 py-1 text-[11.5px] text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]">Quitar</button>
        )}
      </div>

      {!disponible && <p className="text-[12px] text-[var(--ls-e-ambar)]">Falta lanzar la migración 283 en Supabase para poder elegir.</p>}
      {disponible && (
        <>
          <div>
            <h3 className="tc-perfil-titulo">Color</h3>
            <div className="tc-perfil-rejilla">
              {COLORES.map((c) => {
                const dueno = otros.colores.get(c.id)
                const mio = yo.color === c.id
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={ocupado || Boolean(dueno)}
                    aria-pressed={mio}
                    aria-label={dueno ? `${c.nombre}, lo tiene ${quien(dueno)}` : c.nombre}
                    title={dueno ? `${c.nombre} · lo tiene ${quien(dueno)}` : c.nombre}
                    onClick={() => void elegir(mio ? null : c.id, yo.icono)}
                    className="tc-perfil-color"
                    style={{ background: c.hex }}
                    data-cogido={dueno ? 'true' : undefined}
                  >
                    {mio ? <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} /> : dueno ? <Lock className="h-3 w-3 text-white/80" /> : null}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <div className="tc-perfil-pestanas" role="tablist" aria-label="Icono o personaje">
              <button type="button" role="tab" aria-selected={pestana === 'iconos'} onClick={() => setPestana('iconos')}>Iconos · {ICONOS.length}</button>
              <button type="button" role="tab" aria-selected={pestana === 'personajes'} onClick={() => setPestana('personajes')}>Personajes · {PERSONAJES.length}</button>
            </div>
            <div className="tc-perfil-rejilla tc-perfil-rejilla-alta">
              <button type="button" disabled={ocupado} aria-pressed={!yo.icono} aria-label="Mis iniciales" title="Mis iniciales" onClick={() => void elegir(yo.color, null)} className="tc-perfil-icono" data-mio={!yo.icono ? 'true' : undefined}>
                <UserRound className="h-4 w-4" />
              </button>
              {pestana === 'iconos' &&
                ICONOS.map((i) => {
                  const Dibujo = DIBUJOS[i.id]
                  const dueno = otros.iconos.get(i.id)
                  const mio = yo.icono === i.id
                  return (
                    <button
                      key={i.id}
                      type="button"
                      disabled={ocupado || Boolean(dueno)}
                      aria-pressed={mio}
                      aria-label={dueno ? `${i.nombre}, lo tiene ${quien(dueno)}` : i.nombre}
                      title={dueno ? `${i.nombre} · lo tiene ${quien(dueno)}` : i.nombre}
                      onClick={() => void elegir(yo.color, mio ? null : i.id)}
                      className="tc-perfil-icono"
                      data-mio={mio ? 'true' : undefined}
                      data-cogido={dueno ? 'true' : undefined}
                    >
                      {Dibujo && <Dibujo className="h-4 w-4" />}
                    </button>
                  )
                })}
              {pestana === 'personajes' &&
                PERSONAJES.map((p) => {
                  const dueno = otros.iconos.get(p.id)
                  const mio = yo.icono === p.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={ocupado || Boolean(dueno)}
                      aria-pressed={mio}
                      aria-label={dueno ? `${p.nombre}, lo tiene ${quien(dueno)}` : p.nombre}
                      title={dueno ? `${p.nombre} · lo tiene ${quien(dueno)}` : p.nombre}
                      onClick={() => void elegir(yo.color, mio ? null : p.id)}
                      className="tc-perfil-icono tc-perfil-personaje"
                      data-mio={mio ? 'true' : undefined}
                      data-cogido={dueno ? 'true' : undefined}
                    >
                      <span aria-hidden>{p.emoji}</span>
                    </button>
                  )
                })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
