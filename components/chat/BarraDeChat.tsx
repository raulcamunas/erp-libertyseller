'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, Hash, Lock, MessageSquarePlus, Plus, Search } from 'lucide-react'
import { Avatar } from '@/components/tareas-clientes/AvatarTC'
import { nombreVisible, repartirCanales } from '@/lib/chat/canales'
import type { CanalChat } from '@/lib/chat/tipos'
import { useChat } from './ChatProvider'
import { DialogoNuevoCanal, DialogoNuevoDirecto } from './Dialogos'

const SIN_ACENTOS = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function BarraDeChat() {
  const { canales, actual, seleccionar, yo, persona, conectados, enVivo } = useChat()
  const [q, setQ] = useState('')
  const [dialogo, setDialogo] = useState<'canal' | 'directo' | null>(null)
  const [abiertosVisibles, setAbiertosVisibles] = useState(false)
  const reparto = useMemo(() => repartirCanales(canales), [canales])
  const coincide = (c: CanalChat) => !q.trim() || SIN_ACENTOS(nombreVisible(c, yo.id, persona)).includes(SIN_ACENTOS(q.trim()))
  const canalesVisibles = reparto.canales.filter(coincide)
  const directosVisibles = reparto.directos.filter(coincide)
  const sinUnirme = reparto.sinUnirme.filter(coincide)

  return (
    <nav className="chat-barra" aria-label="Canales y conversaciones">
      <header className="chat-barra-cabecera">
        <h2>Chat</h2>
        <span className="chat-en-vivo" data-vivo={enVivo ? 'true' : undefined} title={enVivo ? 'Los mensajes llegan en directo' : 'Sin conexión en directo: se actualiza solo cada pocos segundos'} />
        <button type="button" className="chat-icono ml-auto" onClick={() => setDialogo('directo')} aria-label="Nuevo mensaje directo" title="Nuevo mensaje directo"><MessageSquarePlus className="h-4 w-4" /></button>
      </header>
      <label className="chat-buscar chat-buscar-barra">
        <Search className="h-3.5 w-3.5" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar canal o persona…" aria-label="Buscar canal o persona" />
      </label>

      <div className="chat-barra-lista">
        <section>
          <h3 className="chat-barra-titulo">
            <span>Canales</span>
            <button type="button" className="chat-icono" onClick={() => setDialogo('canal')} aria-label="Crear un canal" title="Crear un canal"><Plus className="h-3.5 w-3.5" /></button>
          </h3>
          <ul>
            {canalesVisibles.map((c) => (
              <li key={c.id}>
                <FilaDeCanal canal={c} activa={actual?.id === c.id} onClick={() => seleccionar(c.id)}>
                  {c.tipo === 'privado' ? <Lock className="h-3.5 w-3.5 shrink-0" /> : <Hash className="h-3.5 w-3.5 shrink-0" />}
                  <span className="chat-fila-nombre">{c.nombre}</span>
                </FilaDeCanal>
              </li>
            ))}
            {canalesVisibles.length === 0 && <li className="chat-barra-vacio">{q ? 'Nada coincide.' : 'Aún no estás en ningún canal.'}</li>}
          </ul>
        </section>

        <section>
          <h3 className="chat-barra-titulo">
            <span>Mensajes directos</span>
            <button type="button" className="chat-icono" onClick={() => setDialogo('directo')} aria-label="Nuevo mensaje directo" title="Nuevo mensaje directo"><Plus className="h-3.5 w-3.5" /></button>
          </h3>
          <ul>
            {directosVisibles.map((c) => {
              const otro = c.miembros.find((m) => m !== yo.id) ?? ''
              const p = persona(otro)
              return (
                <li key={c.id}>
                  <FilaDeCanal canal={c} activa={actual?.id === c.id} onClick={() => seleccionar(c.id)}>
                    <span className="chat-persona-avatar" data-en-linea={conectados.has(otro) ? 'true' : undefined}><Avatar id={otro || c.id} nombre={p?.nombre ?? 'Alguien'} tamano={20} /></span>
                    <span className="chat-fila-nombre">{p?.nombre ?? 'Alguien del equipo'}</span>
                  </FilaDeCanal>
                </li>
              )
            })}
            {directosVisibles.length === 0 && <li className="chat-barra-vacio">{q ? 'Nada coincide.' : 'Abre una conversación con el botón de arriba.'}</li>}
          </ul>
        </section>

        {sinUnirme.length > 0 && (
          <section>
            <button type="button" className="chat-barra-titulo chat-barra-plegable" onClick={() => setAbiertosVisibles((v) => !v)} aria-expanded={abiertosVisibles || Boolean(q.trim())}>
              <span>Canales a los que unirte <i>({sinUnirme.length})</i></span>
              <ChevronDown className="h-3.5 w-3.5 transition-transform" style={{ transform: abiertosVisibles || q.trim() ? 'rotate(180deg)' : undefined }} />
            </button>
            {(abiertosVisibles || q.trim()) && (
              <ul>
                {sinUnirme.map((c) => (
                  <li key={c.id}>
                    <FilaDeCanal canal={c} activa={actual?.id === c.id} onClick={() => seleccionar(c.id)}>
                      <Hash className="h-3.5 w-3.5 shrink-0 opacity-60" />
                      <span className="chat-fila-nombre">{c.nombre}</span>
                    </FilaDeCanal>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      {dialogo === 'canal' && <DialogoNuevoCanal onCerrar={() => setDialogo(null)} alCrear={(id) => seleccionar(id)} />}
      {dialogo === 'directo' && <DialogoNuevoDirecto onCerrar={() => setDialogo(null)} alAbrir={(id) => seleccionar(id)} />}
    </nav>
  )
}

function FilaDeCanal({ canal, activa, onClick, children }: { canal: CanalChat; activa: boolean; onClick: () => void; children: React.ReactNode }) {
  const sinLeer = canal.soy_miembro && !canal.silenciado && canal.no_leidos > 0
  const mencion = canal.soy_miembro && canal.menciones > 0
  return (
    <button type="button" className="chat-fila" data-activa={activa ? 'true' : undefined} data-sin-leer={sinLeer || mencion ? 'true' : undefined} data-silenciado={canal.silenciado ? 'true' : undefined} onClick={onClick} aria-current={activa ? 'true' : undefined}>
      {children}
      {mencion ? <span className="chat-insignia" data-mencion="true" aria-label={`${canal.menciones} menciones`}>@{canal.menciones > 9 ? '9+' : canal.menciones}</span> : sinLeer ? <span className="chat-insignia" aria-label={`${canal.no_leidos} sin leer`}>{canal.no_leidos > 99 ? '99+' : canal.no_leidos}</span> : null}
    </button>
  )
}
