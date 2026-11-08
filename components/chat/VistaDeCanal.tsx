'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, Bell, BellOff, Hash, LogOut, Lock, MessageCircle, Settings2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { filasDeMensajes } from '@/lib/chat/agrupar'
import { nombreVisible } from '@/lib/chat/canales'
import type { CanalChat } from '@/lib/chat/tipos'
import { useChat } from './ChatProvider'
import { DialogoMiembros } from './Dialogos'
import { MensajeVista } from './MensajeVista'
import { Redactor } from './Redactor'

/** Lo que cada cual ha empezado a escribir en cada canal, para que no se pierda al cambiar de uno a otro */
const borradores = new Map<string, string>()

export function VistaDeCanal() {
  const { actual, cargando, error, recargar } = useChat()
  if (error) {
    return (
      <section className="chat-vacio" role="alert">
        <MessageCircle className="h-8 w-8 text-[var(--ls-t4)]" />
        <p>{error}</p>
        <button type="button" onClick={recargar} className="tc-boton-primario">Reintentar</button>
      </section>
    )
  }
  if (cargando) return <section className="chat-principal"><div className="tc-esqueleto m-6 h-24" role="status" aria-label="Cargando el chat" /></section>
  if (!actual) {
    return (
      <section className="chat-vacio">
        <MessageCircle className="h-8 w-8 text-[var(--ls-t4)]" />
        <p>Elige un canal o abre una conversación.</p>
      </section>
    )
  }
  return <CuerpoDeCanal key={actual.id} canal={actual} />
}

function CuerpoDeCanal({ canal }: { canal: CanalChat }) {
  const { yo, persona, personas, estado, marcaDeNuevos, cargarMas, enviar, abrirHilo, escribiendo, avisarQueEscribo, unirse, silenciar, salir, nombreDe, conectados, seleccionar } = useChat()
  const [miembrosAbierto, setMiembrosAbierto] = useState(false)
  const [pegado, setPegado] = useState(true)
  const lista = useRef<HTMLDivElement>(null)
  const pegadoRef = useRef(true)
  const alturaPrevia = useRef(0)
  const primerId = useRef<number | null>(null)
  const posicionado = useRef(false)
  const e = estado(canal.id)
  const marca = marcaDeNuevos(canal.id)
  const nombre = nombreVisible(canal, yo.id, persona)
  const filas = useMemo(() => filasDeMensajes(e.mensajes, { yo: yo.id, ultimoLeidoEn: marca }), [e.mensajes, yo.id, marca])
  const quienesEscriben = escribiendo(canal.id).map((id) => nombreDe(id).split(' ')[0])
  const otro = canal.tipo === 'directo' ? canal.miembros.find((m) => m !== yo.id) : undefined
  const candidatos = canal.tipo === 'canal' ? personas.filter((p) => p.id !== yo.id) : personas.filter((p) => p.id !== yo.id && canal.miembros.includes(p.id))

  useLayoutEffect(() => {
    const el = lista.current
    if (!el || !e.cargado) return
    const primero = e.mensajes.find((m) => m.hilo_de === null)?.id ?? null
    if (!posicionado.current) {
      // La primera vez: en la marca «Nuevos» si hay, y si no, abajo del todo
      posicionado.current = true
      const marcaEl = el.querySelector('[data-marca-nuevos]')
      if (marcaEl) marcaEl.scrollIntoView({ block: 'center' })
      else el.scrollTop = el.scrollHeight
    } else if (primerId.current !== null && primero !== null && primero < primerId.current) {
      // Han llegado mensajes más viejos por arriba: que lo que se estaba leyendo no salte
      el.scrollTop += el.scrollHeight - alturaPrevia.current
    } else if (pegadoRef.current) {
      el.scrollTop = el.scrollHeight
    }
    alturaPrevia.current = el.scrollHeight
    primerId.current = primero
  }, [e.mensajes, e.cargado])

  // Las imágenes que cargan después empujan el contenido: si se estaba abajo, se sigue abajo
  useEffect(() => {
    const el = lista.current
    if (!el) return
    const alCargar = () => {
      if (pegadoRef.current) el.scrollTop = el.scrollHeight
    }
    el.addEventListener('load', alCargar, true)
    return () => el.removeEventListener('load', alCargar, true)
  }, [])

  const alDesplazar = () => {
    const el = lista.current
    if (!el) return
    const abajo = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    pegadoRef.current = abajo
    setPegado(abajo)
    if (el.scrollTop < 140 && e.hayMas && !e.cargando) void cargarMas(canal.id)
  }

  const alIrAlFinal = () => {
    const el = lista.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  const hacer = (f: () => Promise<unknown>) => void f().catch((err: Error) => toast.error(err.message))
  const icono = canal.tipo === 'privado' ? <Lock className="h-4 w-4" /> : canal.tipo === 'directo' ? null : <Hash className="h-4 w-4" />

  return (
    <section className="chat-principal" aria-label={nombre}>
      <header className="chat-cabecera">
        <div className="chat-cabecera-titulo">
          <button type="button" className="chat-icono chat-atras" onClick={() => seleccionar(null)} aria-label="Volver a la lista"><ArrowLeft className="h-4 w-4" /></button>
          {icono}
          <h1>{nombre}</h1>
          {otro && <span className="chat-estado-persona" data-en-linea={conectados.has(otro) ? 'true' : undefined}>{conectados.has(otro) ? 'En línea' : 'Desconectado'}</span>}
          {canal.descripcion && <span className="chat-descripcion" title={canal.descripcion}>{canal.descripcion}</span>}
        </div>
        <div className="chat-cabecera-acciones">
          {canal.soy_miembro && (
            <button type="button" className="chat-icono" onClick={() => hacer(() => silenciar(canal.id, !canal.silenciado))} aria-label={canal.silenciado ? 'Quitar el silencio' : 'Silenciar'} title={canal.silenciado ? 'Silenciado: pulsa para recibir avisos' : 'Silenciar los avisos de este canal'}>
              {canal.silenciado ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
            </button>
          )}
          {canal.tipo !== 'directo' && (
            <button type="button" className="chat-icono chat-miembros-boton" onClick={() => setMiembrosAbierto(true)} aria-label="Miembros y ajustes del canal" title="Miembros y ajustes">
              <Users className="h-4 w-4" /> <span>{canal.miembros.length}</span> <Settings2 className="h-3.5 w-3.5 opacity-60" />
            </button>
          )}
          {canal.soy_miembro && canal.tipo !== 'directo' && !canal.auto_unirse && (
            <button type="button" className="chat-icono" onClick={() => window.confirm(`¿Salir de ${nombre}?`) && hacer(() => salir(canal.id))} aria-label="Salir del canal" title="Salir del canal"><LogOut className="h-4 w-4" /></button>
          )}
        </div>
      </header>

      <div className="chat-lista" ref={lista} onScroll={alDesplazar} role="log" aria-live="polite" aria-label={`Mensajes de ${nombre}`}>
        {e.cargando && e.mensajes.length > 0 && <p className="chat-cargando-arriba">Cargando mensajes anteriores…</p>}
        {!e.hayMas && e.cargado && (
          <div className="chat-inicio-canal">
            {icono && <span className="chat-inicio-icono">{icono}</span>}
            <h2>{canal.tipo === 'directo' ? `Tu conversación con ${nombre}` : `Este es el principio de ${canal.tipo === 'privado' ? '🔒 ' : '#'}${nombre}`}</h2>
            {canal.descripcion && <p>{canal.descripcion}</p>}
          </div>
        )}
        {!e.cargado && <div className="tc-esqueleto m-4 h-20" role="status" aria-label="Cargando mensajes" />}
        {filas.map((f) =>
          f.tipo === 'dia' ? (
            <div key={f.clave} className="chat-dia"><span>{f.etiqueta}</span></div>
          ) : f.tipo === 'nuevos' ? (
            <div key={f.clave} className="chat-nuevos" data-marca-nuevos><span>Nuevos</span></div>
          ) : (
            <MensajeVista key={f.clave} m={f.mensaje} continuacion={f.continuacion} puedeBorrarAjeno={yo.esAdmin && canal.tipo === 'canal'} alResponder={(m) => abrirHilo(canal.id, m.id)} />
          )
        )}
        {e.cargado && e.mensajes.length === 0 && <p className="chat-sin-mensajes">Aún no hay mensajes. ¡Escribe el primero!</p>}
      </div>

      {!pegado && (
        <button type="button" className="chat-ir-al-final" onClick={alIrAlFinal} aria-label="Ir al último mensaje">
          <ArrowDown className="h-3.5 w-3.5" /> Ir al final
        </button>
      )}

      <div className="chat-pie">
        <p className="chat-escribiendo" aria-live="polite">{quienesEscriben.length === 0 ? ' ' : quienesEscriben.length === 1 ? `${quienesEscriben[0]} está escribiendo…` : `${quienesEscriben.join(' y ')} están escribiendo…`}</p>
        {canal.soy_miembro ? (
          <Redactor
            candidatos={candidatos}
            placeholder={canal.tipo === 'directo' ? `Escribe a ${nombre}` : `Escribe en ${canal.tipo === 'privado' ? '🔒 ' : '#'}${nombre}`}
            borradorInicial={borradores.get(canal.id) ?? ''}
            alCambiarBorrador={(t) => (t ? borradores.set(canal.id, t) : borradores.delete(canal.id))}
            alEscribir={() => avisarQueEscribo(canal.id)}
            alEnviar={async (cuerpo) => {
              await enviar(canal.id, cuerpo)
              pegadoRef.current = true
            }}
            autoEnfocar
          />
        ) : (
          <div className="chat-unirse">
            <span>Estás viendo <b>#{nombre}</b>. Únete para escribir y recibir sus mensajes.</span>
            <button type="button" className="tc-boton-primario" onClick={() => hacer(() => unirse(canal.id))}>Unirme al canal</button>
          </div>
        )}
      </div>
      {miembrosAbierto && <DialogoMiembros canal={canal} onCerrar={() => setMiembrosAbierto(false)} />}
    </section>
  )
}
