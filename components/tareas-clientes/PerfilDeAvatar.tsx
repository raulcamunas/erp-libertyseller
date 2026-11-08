'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronDown, Lock, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { COLORES, ICONOS, ocupadosPorOtros } from '@/lib/tareas-clientes/apariencia'
import type { PersonaTC } from '@/lib/tareas-clientes/tipos'
import { useApariencia } from './AparienciaProvider'
import { AvatarDePersona, DIBUJOS } from './AvatarTC'

/**
 * «TU PERFIL» en Mi día: eliges el icono y el color con los que sales en las tareas (responsables, comentarios, quién está en línea) y con el que se tiñen las tarjetas que llevas.
 * Lo que ya tiene un compañero sale bloqueado, con su nombre. Ver lib/tareas-clientes/apariencia.ts.
 */
export function PerfilDeAvatar({ miId, nombre, personas }: { miId: string; nombre: string; personas: readonly PersonaTC[] }) {
  const { mapa, disponible, guardar } = useApariencia()
  const [abierto, setAbierto] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const yo = mapa[miId] ?? { color: null, icono: null }
  const otros = useMemo(() => ocupadosPorOtros(mapa, miId), [mapa, miId])
  const quien = (id: string) => personas.find((p) => p.id === id)?.nombre.split(' ')[0] ?? 'otra persona'

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
    <section className="tc-dia-tarjeta" aria-label="Tu perfil">
      <button type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} className="tc-perfil-cabecera">
        <AvatarDePersona color={yo.color} icono={yo.icono} id={miId} nombre={nombre} tamano={34} />
        <span className="min-w-0 flex-1 text-left">
          <span className="block text-[13px] font-semibold text-[var(--ls-t1)]">Tu perfil</span>
          <span className="block truncate text-[11.5px] text-[var(--ls-t3)]">{yo.color || yo.icono ? 'Así sales en las tareas' : 'Elige tu icono y tu color'}</span>
        </span>
        <ChevronDown className="h-4 w-4 text-[var(--ls-t4)] transition-transform" style={{ transform: abierto ? 'rotate(180deg)' : undefined }} />
      </button>

      {abierto && !disponible && <p className="mt-3 text-[12px] text-[var(--ls-e-ambar)]">Falta lanzar la migración 283 en Supabase para poder elegir.</p>}
      {abierto && disponible && (
        <div className="mt-3 flex flex-col gap-3" aria-busy={ocupado}>
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
            <h3 className="tc-perfil-titulo">Icono <span className="font-normal normal-case text-[var(--ls-t4)]">· sin icono, tus iniciales</span></h3>
            <div className="tc-perfil-rejilla">
              <button type="button" disabled={ocupado} aria-pressed={!yo.icono} aria-label="Mis iniciales" title="Mis iniciales" onClick={() => void elegir(yo.color, null)} className="tc-perfil-icono" data-mio={!yo.icono ? 'true' : undefined}>
                <UserRound className="h-4 w-4" />
              </button>
              {ICONOS.map((i) => {
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
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
