'use client'

import { useMemo, useState } from 'react'
import { AtSign, Bookmark, CalendarClock, ChevronDown, Clock, Hash, Headphones, Lock, MessageSquarePlus, Palette, Plus, Search } from 'lucide-react'
import { Avatar } from '@/components/tareas-clientes/AvatarTC'
import { nombreVisible, repartirCanales } from '@/lib/chat/canales'
import type { CanalChat } from '@/lib/chat/tipos'
import { EmojiDeEstado, EstadoPropio } from './Paneles'
import { useChat } from './ChatProvider'
import { AparienciaDelChat } from './AparienciaDelChat'
import { DialogoNuevoCanal, DialogoNuevoDirecto } from './Dialogos'
import { useJunta } from './JuntaProvider'

export function BarraDeChat({ alBuscar }: { alBuscar: () => void }) {
  const { canales, actual, seleccionar, yo, persona, conectados, enVivo, vista, abrirBandeja, estadoDe } = useChat()
  const [estadoAbierto, setEstadoAbierto] = useState(false)
  const [dialogo, setDialogo] = useState<'canal' | 'directo' | null>(null)
  const [abiertosVisibles, setAbiertosVisibles] = useState(false)
  const [apariencia, setApariencia] = useState(false)
  const reparto = useMemo(() => repartirCanales(canales), [canales])
  const canalesVisibles = reparto.canales
  const directosVisibles = reparto.directos
  const sinUnirme = reparto.sinUnirme
  const miEstado = estadoDe(yo.id)
  const menciones = canales.reduce((n, c) => n + (c.soy_miembro && !c.archivado ? c.menciones : 0), 0)

  return (
    <nav className="chat-barra" aria-label="Canales y conversaciones">
      <header className="chat-barra-cabecera">
        <h2>Chat</h2>
        <span className="chat-en-vivo" data-vivo={enVivo ? 'true' : undefined} title={enVivo ? 'Los mensajes llegan en directo' : 'Sin conexión en directo: se actualiza solo cada pocos segundos'} />
        <button type="button" className="chat-icono ml-auto" onClick={() => setDialogo('directo')} aria-label="Nuevo mensaje directo" title="Nuevo mensaje directo"><MessageSquarePlus className="h-4 w-4" /></button>
      </header>
      <button type="button" className="chat-buscar chat-buscar-barra chat-buscar-boton" onClick={alBuscar} aria-label="Buscar en el chat">
        <Search className="h-3.5 w-3.5" />
        <span>Buscar canales, personas y mensajes…</span>
        <kbd>⌘K</kbd>
      </button>

      <div className="chat-barra-lista">
        <section>
          <ul className="chat-bandeja">
            <li><FilaDeBandeja icono={<AtSign className="h-3.5 w-3.5" />} nombre="Menciones" activa={vista === 'menciones'} insignia={menciones} onClick={() => abrirBandeja('menciones')} /></li>
            <li><FilaDeBandeja icono={<Bookmark className="h-3.5 w-3.5" />} nombre="Guardados" activa={vista === 'guardados'} onClick={() => abrirBandeja('guardados')} /></li>
            <li><FilaDeBandeja icono={<Clock className="h-3.5 w-3.5" />} nombre="Recordatorios" activa={vista === 'recordatorios'} onClick={() => abrirBandeja('recordatorios')} /></li>
            <li><FilaDeBandeja icono={<CalendarClock className="h-3.5 w-3.5" />} nombre="Programados" activa={vista === 'programados'} onClick={() => abrirBandeja('programados')} /></li>
          </ul>
        </section>

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
            {canalesVisibles.length === 0 && <li className="chat-barra-vacio">Aún no estás en ningún canal.</li>}
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
                    <EmojiDeEstado id={otro} />
                  </FilaDeCanal>
                </li>
              )
            })}
            {directosVisibles.length === 0 && <li className="chat-barra-vacio">Abre una conversación con el botón de arriba.</li>}
          </ul>
        </section>

        {sinUnirme.length > 0 && (
          <section>
            <button type="button" className="chat-barra-titulo chat-barra-plegable" onClick={() => setAbiertosVisibles((v) => !v)} aria-expanded={abiertosVisibles}>
              <span>Canales a los que unirte <i>({sinUnirme.length})</i></span>
              <ChevronDown className="h-3.5 w-3.5 transition-transform" style={{ transform: abiertosVisibles ? 'rotate(180deg)' : undefined }} />
            </button>
            {abiertosVisibles && (
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

      <footer className="chat-barra-pie">
        <span className="chat-persona-avatar" data-en-linea="true"><Avatar id={yo.id} nombre={yo.nombre} tamano={30} /></span>
        <button type="button" className="chat-barra-yo chat-barra-yo-boton" data-abre-estado onClick={() => setEstadoAbierto((v) => !v)} aria-label="Cambiar tu estado" title="Cambiar tu estado">
          <b>{yo.nombre}</b>
          <i>{miEstado ? `${miEstado.emoji} ${miEstado.texto}`.trim() : 'En línea · añade un estado'}</i>
        </button>
        <button type="button" className="chat-icono" data-abre-apariencia onClick={() => setApariencia((v) => !v)} aria-label="Apariencia del chat" aria-expanded={apariencia} title="Apariencia: tema, fondo y estilo"><Palette className="h-4 w-4" /></button>
      </footer>
      {apariencia && <AparienciaDelChat onCerrar={() => setApariencia(false)} />}
      {estadoAbierto && <EstadoPropio onCerrar={() => setEstadoAbierto(false)} />}

      {dialogo === 'canal' && <DialogoNuevoCanal onCerrar={() => setDialogo(null)} alCrear={(id) => seleccionar(id)} />}
      {dialogo === 'directo' && <DialogoNuevoDirecto onCerrar={() => setDialogo(null)} alAbrir={(id) => seleccionar(id)} />}
    </nav>
  )
}

function FilaDeCanal({ canal, activa, onClick, children }: { canal: CanalChat; activa: boolean; onClick: () => void; children: React.ReactNode }) {
  const { activas } = useJunta()
  const sinLeer = canal.soy_miembro && !canal.silenciado && canal.no_leidos > 0
  const mencion = canal.soy_miembro && canal.menciones > 0
  return (
    <button type="button" className="chat-fila" data-activa={activa ? 'true' : undefined} data-sin-leer={sinLeer || mencion ? 'true' : undefined} data-silenciado={canal.silenciado ? 'true' : undefined} onClick={onClick} aria-current={activa ? 'true' : undefined}>
      {children}
      {activas[canal.id] && <Headphones className="h-3.5 w-3.5 shrink-0 text-[var(--ls-e-verde)]" aria-label="Hay una junta en curso" />}
      {mencion ? <span key={`m${canal.menciones}`} className="chat-insignia" data-mencion="true" aria-label={`${canal.menciones} menciones`}>@{canal.menciones > 9 ? '9+' : canal.menciones}</span> : sinLeer ? <span key={`n${canal.no_leidos}`} className="chat-insignia" aria-label={`${canal.no_leidos} sin leer`}>{canal.no_leidos > 99 ? '99+' : canal.no_leidos}</span> : null}
    </button>
  )
}

function FilaDeBandeja({ icono, nombre, activa, insignia, onClick }: { icono: React.ReactNode; nombre: string; activa: boolean; insignia?: number; onClick: () => void }) {
  return (
    <button type="button" className="chat-fila" data-activa={activa ? 'true' : undefined} data-sin-leer={insignia ? 'true' : undefined} onClick={onClick} aria-current={activa ? 'true' : undefined}>
      {icono}
      <span className="chat-fila-nombre">{nombre}</span>
      {insignia ? <span key={insignia} className="chat-insignia" data-mencion="true">@{insignia > 9 ? '9+' : insignia}</span> : null}
    </button>
  )
}
