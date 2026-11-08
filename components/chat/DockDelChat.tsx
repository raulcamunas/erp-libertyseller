'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronDown, ExternalLink, MessagesSquare, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { leerChatSinLeer, ponerChatSinLeer, suscribirContadores } from '@/lib/avisos/contadores'
import { ANCHO_MINIMO_PARA_EL_DOCK, anchoQueAparta, CLAVE_DEL_DOCK, leerModo, modoEfectivo, seOfreceElDock, type ModoDelDock } from '@/lib/chat/dock'
import { ponerChatAbiertoEnElDock, proveedorDelChatVivo } from '@/lib/chat/dock-estado'
import { ChatApp } from './ChatApp'

const PREGUNTAR_CADA_MS = 60_000

/**
 * EL CHAT A MANO EN CUALQUIER PANTALLA DEL ERP, siempre pequeño y ampliable (lib/chat/dock.ts): una pastilla abajo a la derecha con lo que hay sin leer; al pulsarla, una ventana flotante con el
 * chat entero; y, si hay sitio, un panel lateral que aparta la página en vez de taparla. El chat se monta la primera vez que se abre y desde entonces sigue vivo (mensajes y llamadas siguen
 * llegando) aunque la ventana esté cerrada. En pantallas estrechas no se ofrece: allí se usa la aplicación.
 */
export function DockDelChat() {
  const ruta = usePathname()
  const router = useRouter()
  const sinLeer = useSyncExternalStore(suscribirContadores, leerChatSinLeer, leerChatSinLeer)
  const [modo, setModo] = useState<ModoDelDock>('cerrado')
  const [montado, setMontado] = useState(false)
  const [ancho, setAncho] = useState(0)

  // Lo elegido la última vez y el ancho de la ventana
  useEffect(() => {
    try {
      const guardado = leerModo(window.localStorage.getItem(CLAVE_DEL_DOCK))
      setModo(guardado)
      if (guardado !== 'cerrado') setMontado(true)
    } catch {
      /* sin almacenamiento: empieza cerrado */
    }
    const medir = () => setAncho(window.innerWidth)
    medir()
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  }, [])

  const cambiar = useCallback((nuevo: ModoDelDock) => {
    setModo(nuevo)
    if (nuevo !== 'cerrado') setMontado(true)
    try {
      window.localStorage.setItem(CLAVE_DEL_DOCK, nuevo)
    } catch {
      /* se queda para esta sesión */
    }
  }, [])

  const ofrecido = ancho >= ANCHO_MINIMO_PARA_EL_DOCK && seOfreceElDock(ruta)
  const efectivo = modoEfectivo(modo, ancho)
  const abierto = ofrecido && efectivo !== 'cerrado'

  // Lo que se aparta la página por la derecha, y si el chat está a la vista (para que la campana no repita avisos)
  useEffect(() => {
    const raiz = document.documentElement
    const aparta = ofrecido ? anchoQueAparta(modo, ancho) : 0
    if (aparta > 0) raiz.style.setProperty('--dock-ancho', `${aparta}px`)
    else raiz.style.removeProperty('--dock-ancho')
    ponerChatAbiertoEnElDock(abierto)
    return () => {
      raiz.style.removeProperty('--dock-ancho')
      ponerChatAbiertoEnElDock(false)
    }
  }, [ofrecido, modo, ancho, abierto])

  // Mientras el chat no está vivo, se pregunta cada minuto cuánto hay sin leer (una consulta pequeña) para el número de la barra y de la pastilla
  useEffect(() => {
    let vivo = true
    const preguntar = () => {
      if (document.visibilityState !== 'visible' || proveedorDelChatVivo()) return
      fetch('/api/chat/sin-leer', { cache: 'no-store' })
        .then((r) => (r.ok ? (r.json() as Promise<{ mensajes: number; menciones: number }>) : null))
        .then((d) => vivo && d && ponerChatSinLeer(d.mensajes, d.menciones))
        .catch(() => undefined)
    }
    preguntar()
    const t = setInterval(preguntar, PREGUNTAR_CADA_MS)
    document.addEventListener('visibilitychange', preguntar)
    return () => {
      vivo = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', preguntar)
    }
  }, [])

  const total = sinLeer.mensajes + sinLeer.menciones
  const insignia = total > 99 ? '99+' : String(total)
  if (!ofrecido && !montado) return null

  return (
    <>
      {ofrecido && efectivo === 'cerrado' && (
        <button type="button" className="chat-dock-pastilla" data-menciona={sinLeer.menciones > 0 ? 'true' : undefined} onClick={() => cambiar('pequeno')} aria-label={total > 0 ? `Abrir el chat (${total} sin leer)` : 'Abrir el chat'}>
          <MessagesSquare className="h-4 w-4" />
          <span>Chat</span>
          {total > 0 && <b key={total}>{insignia}</b>}
        </button>
      )}
      {montado && (
        <section className="chat-dock" data-modo={efectivo} hidden={!abierto} aria-label="Chat del equipo">
          <header className="chat-dock-cabecera">
            <MessagesSquare className="h-4 w-4" />
            <b>Chat</b>
            {total > 0 && <i>{insignia} sin leer</i>}
            <span className="ml-auto" />
            {ancho >= 1180 && (
              <button type="button" className="chat-icono" onClick={() => cambiar(efectivo === 'lateral' ? 'pequeno' : 'lateral')} aria-label={efectivo === 'lateral' ? 'Hacerlo flotante' : 'Fijarlo al lado de la página'} title={efectivo === 'lateral' ? 'Hacerlo flotante' : 'Fijarlo al lado de la página'}>
                {efectivo === 'lateral' ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
              </button>
            )}
            <button type="button" className="chat-icono" onClick={() => router.push('/dashboard/chat')} aria-label="Abrir el chat completo" title="Abrir el chat completo"><ExternalLink className="h-4 w-4" /></button>
            <button type="button" className="chat-icono" onClick={() => cambiar('cerrado')} aria-label="Minimizar el chat" title="Minimizar"><ChevronDown className="h-4 w-4" /></button>
          </header>
          <div className="chat-dock-cuerpo">
            <ChatApp dock />
          </div>
        </section>
      )}
    </>
  )
}
