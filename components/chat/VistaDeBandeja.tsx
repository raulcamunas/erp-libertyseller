'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, AtSign, Bookmark, BookmarkX, CalendarClock, Check, Clock, Plus, TriangleAlert, X } from 'lucide-react'
import { toast } from 'sonner'
import { pedir } from '@/components/tareas-clientes/api'
import { nombreVisible } from '@/lib/chat/canales'
import { textoPlano } from '@/lib/chat/mensajes'
import { describirInstante } from '@/lib/chat/tiempo'
import type { ItemDeBandeja, ProgramadoChat, RecordatorioChat } from '@/lib/chat/tipos'
import { useChat, type VistaDelChat } from './ChatProvider'
import { ElegirHora, FilaDeMensaje } from './Paneles'

const TITULOS: Record<Exclude<VistaDelChat, 'canal'>, { titulo: string; ayuda: string; icono: React.ReactNode }> = {
  menciones: { titulo: 'Menciones', ayuda: 'Los mensajes en los que te han nombrado con @.', icono: <AtSign className="h-4 w-4" /> },
  guardados: { titulo: 'Guardados', ayuda: 'Mensajes que has guardado para volver a ellos. Solo los ves tú.', icono: <Bookmark className="h-4 w-4" /> },
  recordatorios: { titulo: 'Recordatorios', ayuda: 'Te aviso por la campana (y el móvil) cuando llegue la hora.', icono: <Clock className="h-4 w-4" /> },
  programados: { titulo: 'Mensajes programados', ayuda: 'Salen solos a la hora elegida, como si los escribieras entonces.', icono: <CalendarClock className="h-4 w-4" /> },
}

/** Las listas de la «bandeja»: menciones, guardados, recordatorios y mensajes programados */
export function VistaDeBandeja() {
  const { vista, seleccionar } = useChat()
  if (vista === 'canal') return null
  const t = TITULOS[vista]
  return (
    <section className="chat-principal chat-bandeja-vista" aria-label={t.titulo}>
      <header className="chat-cabecera">
        <div className="chat-cabecera-titulo">
          <button type="button" className="chat-icono chat-atras" onClick={() => seleccionar(null)} aria-label="Volver a la lista"><ArrowLeft className="h-4 w-4" /></button>
          {t.icono}
          <h1>{t.titulo}</h1>
          <span className="chat-descripcion">{t.ayuda}</span>
        </div>
      </header>
      <div className="chat-bandeja-cuerpo">
        {(vista === 'menciones' || vista === 'guardados') && <ListaDeMensajes key={vista} tipo={vista} />}
        {vista === 'recordatorios' && <ListaDeRecordatorios />}
        {vista === 'programados' && <ListaDeProgramados />}
      </div>
    </section>
  )
}

function Vacio({ icono, texto }: { icono: React.ReactNode; texto: string }) {
  return <p className="chat-sin-nada">{icono} {texto}</p>
}

function ListaDeMensajes({ tipo }: { tipo: 'menciones' | 'guardados' }) {
  const { irAMensaje, guardar } = useChat()
  const [items, setItems] = useState<ItemDeBandeja[] | null>(null)
  useEffect(() => {
    let vivo = true
    pedir<{ items: ItemDeBandeja[] }>(`/api/chat/bandeja?tipo=${tipo}`)
      .then((r) => vivo && setItems(r.items))
      .catch((e: Error) => {
        toast.error(e.message)
        if (vivo) setItems([])
      })
    return () => {
      vivo = false
    }
  }, [tipo])
  if (items === null) return <div className="tc-esqueleto m-4 h-20" role="status" aria-label="Cargando" />
  if (items.length === 0) return tipo === 'menciones' ? <Vacio icono={<AtSign className="h-5 w-5" />} texto="Nadie te ha mencionado todavía." /> : <Vacio icono={<Bookmark className="h-5 w-5" />} texto="No has guardado nada. Guarda un mensaje desde el menú «⋯» del propio mensaje." />
  return (
    <ul className="chat-lista-mensajes">
      {items.map((it) => (
        <FilaDeMensaje
          key={it.mensaje.id}
          item={it}
          onAbrir={() => void irAMensaje(it.canalId, it.mensaje.id, it.mensaje.hilo_de)}
          extra={
            tipo === 'guardados' ? (
              <button type="button" className="chat-icono" aria-label="Quitar de guardados" title="Quitar de guardados" onClick={() => void guardar(it.mensaje.id, false).then(() => setItems((l) => l && l.filter((x) => x.mensaje.id !== it.mensaje.id))).catch((e: Error) => toast.error(e.message))}>
                <BookmarkX className="h-4 w-4" />
              </button>
            ) : undefined
          }
        />
      ))}
    </ul>
  )
}

function NuevoRecordatorio({ onCerrar, alCrear }: { onCerrar: () => void; alCrear: () => void }) {
  const [texto, setTexto] = useState('')
  return (
    <ElegirHora
      titulo="Nuevo recordatorio"
      onElegir={async (avisarEn) => {
        if (!texto.trim()) throw new Error('Escribe de qué quieres que te avise.')
        await pedir('/api/chat/recordatorios', { metodo: 'POST', cuerpo: { texto: texto.trim(), avisarEn } })
        toast.success(`Te lo recordaré ${describirInstante(Date.parse(avisarEn))}`)
        alCrear()
      }}
      onCerrar={onCerrar}
    >
      <label className="chat-campo">
        <span>¿De qué quieres que te avise?</span>
        <input autoFocus value={texto} maxLength={300} onChange={(e) => setTexto(e.target.value)} placeholder="p. ej. Llamar a ShoesF por el envío" />
      </label>
    </ElegirHora>
  )
}

function ListaDeRecordatorios() {
  const { irAMensaje } = useChat()
  const [datos, setDatos] = useState<{ pendientes: RecordatorioChat[]; enviados: RecordatorioChat[] } | null>(null)
  const [nuevo, setNuevo] = useState(false)
  const cargar = useCallback(() => {
    pedir<{ pendientes: RecordatorioChat[]; enviados: RecordatorioChat[] }>('/api/chat/recordatorios')
      .then(setDatos)
      .catch((e: Error) => {
        toast.error(e.message)
        setDatos({ pendientes: [], enviados: [] })
      })
  }, [])
  useEffect(cargar, [cargar])
  const borrar = (id: string) => void pedir('/api/chat/recordatorios', { metodo: 'DELETE', cuerpo: { id } }).then(cargar).catch((e: Error) => toast.error(e.message))
  const fila = (r: RecordatorioChat, hecho: boolean) => (
    <li key={r.id} className="chat-fila-mensaje" data-hecho={hecho ? 'true' : undefined}>
      <button type="button" disabled={!r.canal_id || !r.mensaje_id} onClick={() => r.canal_id && r.mensaje_id && void irAMensaje(r.canal_id, r.mensaje_id)}>
        <span className="chat-recordatorio-icono">{hecho ? <Check className="h-4 w-4" /> : <Clock className="h-4 w-4" />}</span>
        <span className="chat-fila-mensaje-cuerpo">
          <span className="chat-fila-mensaje-cabecera"><b>{describirInstante(Date.parse(r.avisar_en))}</b>{r.mensaje_id && <i>de un mensaje</i>}</span>
          <span className="chat-fila-mensaje-texto">{r.texto}</span>
        </span>
      </button>
      {!hecho && <button type="button" className="chat-icono" onClick={() => borrar(r.id)} aria-label="Cancelar el recordatorio" title="Cancelar"><X className="h-4 w-4" /></button>}
    </li>
  )
  return (
    <>
      <div className="chat-bandeja-acciones"><button type="button" className="tc-boton-primario" onClick={() => setNuevo(true)}><Plus className="h-3.5 w-3.5" /> Nuevo recordatorio</button></div>
      {datos === null && <div className="tc-esqueleto m-4 h-20" role="status" aria-label="Cargando" />}
      {datos && datos.pendientes.length === 0 && <Vacio icono={<Clock className="h-5 w-5" />} texto="Sin recordatorios pendientes. Crea uno aquí o desde el menú «⋯» de un mensaje." />}
      {datos && datos.pendientes.length > 0 && <ul className="chat-lista-mensajes">{datos.pendientes.map((r) => fila(r, false))}</ul>}
      {datos && datos.enviados.length > 0 && (
        <>
          <h2 className="chat-bandeja-subtitulo">Avisados hace poco</h2>
          <ul className="chat-lista-mensajes">{datos.enviados.map((r) => fila(r, true))}</ul>
        </>
      )}
      {nuevo && <NuevoRecordatorio onCerrar={() => setNuevo(false)} alCrear={cargar} />}
    </>
  )
}

function ListaDeProgramados() {
  const { canales, yo, persona, seleccionar } = useChat()
  const [datos, setDatos] = useState<{ pendientes: ProgramadoChat[]; recientes: ProgramadoChat[] } | null>(null)
  const cargar = useCallback(() => {
    pedir<{ pendientes: ProgramadoChat[]; recientes: ProgramadoChat[] }>('/api/chat/programados')
      .then(setDatos)
      .catch((e: Error) => {
        toast.error(e.message)
        setDatos({ pendientes: [], recientes: [] })
      })
  }, [])
  useEffect(cargar, [cargar])
  const cancelar = (id: string) => void pedir('/api/chat/programados', { metodo: 'DELETE', cuerpo: { id } }).then(cargar).catch((e: Error) => toast.error(e.message))
  const dondeEs = (canalId: string) => {
    const c = canales.find((x) => x.id === canalId)
    return c ? (c.tipo === 'directo' ? `Con ${nombreVisible(c, yo.id, persona)}` : `${c.tipo === 'privado' ? '🔒' : '#'}${c.nombre}`) : 'Un canal'
  }
  const fila = (p: ProgramadoChat) => (
    <li key={p.id} className="chat-fila-mensaje" data-hecho={p.estado !== 'pendiente' ? 'true' : undefined}>
      <button type="button" onClick={() => seleccionar(p.canal_id)}>
        <span className="chat-recordatorio-icono">{p.estado === 'error' ? <TriangleAlert className="h-4 w-4" /> : p.estado === 'enviado' ? <Check className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}</span>
        <span className="chat-fila-mensaje-cuerpo">
          <span className="chat-fila-mensaje-cabecera"><b>{describirInstante(Date.parse(p.enviar_en))}</b><i>{dondeEs(p.canal_id)}</i>{p.estado === 'enviado' && <i>enviado</i>}{p.estado === 'error' && <i>{p.error ?? 'no se pudo enviar'}</i>}</span>
          <span className="chat-fila-mensaje-texto">{textoPlano(p.cuerpo, () => 'alguien', 200) || '📎 Archivo adjunto'}</span>
        </span>
      </button>
      {p.estado === 'pendiente' && <button type="button" className="chat-icono" onClick={() => cancelar(p.id)} aria-label="Cancelar el envío" title="Cancelar el envío"><X className="h-4 w-4" /></button>}
    </li>
  )
  return (
    <>
      {datos === null && <div className="tc-esqueleto m-4 h-20" role="status" aria-label="Cargando" />}
      {datos && datos.pendientes.length === 0 && <Vacio icono={<CalendarClock className="h-5 w-5" />} texto="No tienes mensajes programados. Escribe uno y pulsa el reloj junto a «Enviar»." />}
      {datos && datos.pendientes.length > 0 && <ul className="chat-lista-mensajes">{datos.pendientes.map(fila)}</ul>}
      {datos && datos.recientes.length > 0 && (
        <>
          <h2 className="chat-bandeja-subtitulo">Enviados hace poco</h2>
          <ul className="chat-lista-mensajes">{datos.recientes.map(fila)}</ul>
        </>
      )}
    </>
  )
}
