'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AtSign, Bookmark, CalendarClock, ChevronDown, Clock, Database, FileArchive, Hash, Headphones, Lock, MessageSquarePlus, MessageSquareReply, Mic, MicOff, Palette, PhoneOff, Plus, Search, Volume2 } from 'lucide-react'
import { Avatar } from '@/components/tareas-clientes/AvatarTC'
import { nombreVisible, repartirCanales } from '@/lib/chat/canales'
import type { CanalChat } from '@/lib/chat/tipos'
import { EmojiDeEstado, EstadoPropio } from './Paneles'
import { useChat } from './ChatProvider'
import { AparienciaDelChat } from './AparienciaDelChat'
import { DialogoNuevoCanal, DialogoNuevoDirecto } from './Dialogos'
import { ImportarDeSlack } from './ImportarDeSlack'
import { useJunta } from './JuntaProvider'

const BANDEJAS = [
  { vista: 'menciones', nombre: 'Menciones', Icono: AtSign },
  { vista: 'hilos', nombre: 'Hilos', Icono: MessageSquareReply },
  { vista: 'guardados', nombre: 'Guardados', Icono: Bookmark },
  { vista: 'recordatorios', nombre: 'Recordatorios', Icono: Clock },
  { vista: 'programados', nombre: 'Programados', Icono: CalendarClock },
] as const

export function BarraDeChat({ alBuscar }: { alBuscar: () => void }) {
  const { canales, actual, seleccionar, yo, persona, nombreDe, conectados, enVivo, vista, abrirBandeja, estadoDe, abrirAsistente } = useChat()
  const [estadoAbierto, setEstadoAbierto] = useState(false)
  const [importando, setImportando] = useState(false)
  const [dialogo, setDialogo] = useState<'canal' | 'directo' | 'voz' | null>(null)
  const { disponible: hayJuntas, actual: enSala, activas, entrar, salir, alternarMicro, room, version } = useJunta()
  void version
  const [abiertosVisibles, setAbiertosVisibles] = useState(false)
  const [apariencia, setApariencia] = useState(false)
  const reparto = useMemo(() => repartirCanales(canales), [canales])
  const canalesVisibles = reparto.canales
  const voces = reparto.voces
  const directosVisibles = reparto.directos
  const sinUnirme = reparto.sinUnirme
  const miEstado = estadoDe(yo.id)
  const menciones = canales.reduce((n, c) => n + (c.soy_miembro && !c.archivado ? c.menciones : 0), 0)

  return (
    <nav className="chat-barra" aria-label="Canales y conversaciones">
      <header className="chat-barra-cabecera">
        <h2>Chat</h2>
        <span className="chat-en-vivo" data-vivo={enVivo ? 'true' : undefined} title={enVivo ? 'Los mensajes llegan en directo' : 'Sin conexión en directo: se actualiza solo cada pocos segundos'} />
        <div className="chat-cabecera-iconos">
          {BANDEJAS.map(({ vista: v, nombre, Icono }) => (
            <button key={v} type="button" className="chat-icono" data-activa={vista === v ? 'true' : undefined} onClick={() => abrirBandeja(v)} aria-label={nombre} aria-current={vista === v ? 'true' : undefined} title={nombre}>
              <Icono className="h-4 w-4" />
              {v === 'menciones' && menciones > 0 ? <span key={menciones} className="chat-icono-punto" aria-label={`${menciones} menciones sin leer`}>{menciones > 9 ? '9+' : menciones}</span> : null}
            </button>
          ))}
          <button type="button" className="chat-icono" onClick={() => setDialogo('directo')} aria-label="Nuevo mensaje directo" title="Nuevo mensaje directo"><MessageSquarePlus className="h-4 w-4" /></button>
        </div>
      </header>
      <button type="button" className="chat-buscar chat-buscar-barra chat-buscar-boton" onClick={alBuscar} aria-label="Buscar en el chat">
        <Search className="h-3.5 w-3.5" />
        <span>Buscar canales, personas y mensajes…</span>
        <kbd>⌘K</kbd>
      </button>

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
            {canalesVisibles.length === 0 && <li className="chat-barra-vacio">Aún no estás en ningún canal.</li>}
          </ul>
        </section>

        {voces.length > 0 && (
          <section>
            <h3 className="chat-barra-titulo">
              <span>Canales de voz</span>
              {yo.esAdmin && <button type="button" className="chat-icono" onClick={() => setDialogo('voz')} aria-label="Crear un canal de voz" title="Crear un canal de voz"><Plus className="h-3.5 w-3.5" /></button>}
            </h3>
            <ul>
              {voces.map((c) => {
                const dentro = activas[c.id]?.personas ?? []
                const conectado = enSala?.canalId === c.id
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="chat-fila chat-fila-voz"
                      data-activa={actual?.id === c.id ? 'true' : undefined}
                      data-conectado={conectado ? 'true' : undefined}
                      onClick={() => {
                        seleccionar(c.id)
                        if (!hayJuntas) return toast.error('Las juntas todavía no están configuradas en el servidor.')
                        if (!conectado) void entrar(c.id)
                      }}
                      title={conectado ? 'Estás en este canal de voz' : `Entrar al canal de voz ${c.nombre}`}
                    >
                      <Volume2 className="h-3.5 w-3.5 shrink-0" />
                      <span className="chat-fila-nombre">{c.nombre}</span>
                      {dentro.length > 0 && <span className="chat-voz-cuenta">{dentro.length}</span>}
                    </button>
                    {dentro.length > 0 && (
                      <ul className="chat-voz-personas" aria-label={`En ${c.nombre}`}>
                        {dentro.map((id) => (
                          <li key={id} className="chat-voz-persona">
                            <Avatar id={id} nombre={nombreDe(id)} tamano={18} />
                            <span>{id === yo.id ? `${nombreDe(id)} (tú)` : nombreDe(id)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )}

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

      {enSala && (
        <div className="chat-voz-conectado" role="status">
          <Volume2 className="h-4 w-4 shrink-0 text-[var(--ls-e-verde)]" />
          <span className="min-w-0 flex-1">
            <b>{enSala.estado === 'conectando' ? 'Conectando…' : 'Voz conectada'}</b>
            <i>{(() => { const c = canales.find((x) => x.id === enSala.canalId); return c ? nombreVisible(c, yo.id, persona) : 'Junta' })()}</i>
          </span>
          <button type="button" className="chat-icono" onClick={() => void alternarMicro()} aria-label={room?.localParticipant.isMicrophoneEnabled ? 'Silenciar el micrófono' : 'Activar el micrófono'} title={room?.localParticipant.isMicrophoneEnabled ? 'Silenciar el micrófono' : 'Activar el micrófono'} data-apagado={room && !room.localParticipant.isMicrophoneEnabled ? 'true' : undefined}>
            {room && !room.localParticipant.isMicrophoneEnabled ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
          <button type="button" className="chat-icono" onClick={salir} aria-label="Salir de la junta" title="Salir de la junta"><PhoneOff className="h-4 w-4" /></button>
        </div>
      )}

      {yo.esAdmin && (
        <div className="chat-herramientas-admin">
          <button type="button" onClick={() => abrirAsistente()}><Database className="h-3.5 w-3.5" /> Preguntar al ERP</button>
          <button type="button" onClick={() => setImportando(true)}><FileArchive className="h-3.5 w-3.5" /> Importar de Slack</button>
        </div>
      )}
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
      {importando && <ImportarDeSlack onCerrar={() => setImportando(false)} />}

      {dialogo === 'canal' && <DialogoNuevoCanal onCerrar={() => setDialogo(null)} alCrear={(id) => seleccionar(id)} />}
      {dialogo === 'voz' && <DialogoNuevoCanal voz onCerrar={() => setDialogo(null)} alCrear={(id) => seleccionar(id)} />}
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

