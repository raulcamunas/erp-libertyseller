'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as EventoDePuntero } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronDown, ExternalLink, MessagesSquare, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { leerChatSinLeer, ponerChatSinLeer, suscribirContadores } from '@/lib/avisos/contadores'
import { ANCHO_MINIMO_PARA_EL_DOCK, anchoQueAparta, CLAVE_DEL_DOCK, CLAVE_DEL_TAMANO, leerModo, leerTamano, modoEfectivo, seOfreceElDock, TAMANO_POR_DEFECTO, tamanoAlArrastrar, type BordeDelDock, type ModoDelDock, type TamanoDelDock } from '@/lib/chat/dock'
import { pedirCanalAlChat, ponerChatAbiertoEnElDock, proveedorDelChatVivo } from '@/lib/chat/dock-estado'
import { ponerPastillaDelChatVisible, quitarVistaPrevia, type VistaPrevia } from '@/lib/chat/vista-previa'
import { ChatApp } from './ChatApp'
import { VistasPreviasDelChat } from './VistasPreviasDelChat'

const PREGUNTAR_CADA_MS = 60_000
/** Lo que tiene que quedar libre encima de la ventana flotante para que los avisos vayan encima (un aviso mide ~110 px); si no, van a su izquierda */
const SITIO_MINIMO_PARA_AVISOS = 150

/**
 * EL CHAT A MANO EN CUALQUIER PANTALLA DEL ERP, siempre pequeño y ampliable (lib/chat/dock.ts): una pastilla abajo a la derecha con lo que hay sin leer; al pulsarla, una ventana flotante con el
 * chat entero; y, si hay sitio, un panel lateral que aparta la página en vez de taparla. El chat se monta la primera vez que se abre y desde entonces sigue vivo (mensajes y llamadas siguen
 * llegando) aunque la ventana esté cerrada. En pantallas estrechas no se ofrece: allí se usa la aplicación.
 *
 * La ventana flotante se hace del tamaño que cada uno quiera arrastrando el borde de la izquierda, el de arriba o la esquina de arriba a la izquierda (doble clic: vuelve al de siempre);
 * se recuerda en el navegador y nunca se sale de la ventana. Y lo que ocupa la esquina se publica en `--dock-arriba` / `--avisos-derecha`: los avisos se apilan ENCIMA del chat, no detrás.
 */
export function DockDelChat() {
  const ruta = usePathname()
  const router = useRouter()
  const sinLeer = useSyncExternalStore(suscribirContadores, leerChatSinLeer, leerChatSinLeer)
  const [modo, setModo] = useState<ModoDelDock>('cerrado')
  const [montado, setMontado] = useState(false)
  const [ancho, setAncho] = useState(0)
  const [tamano, setTamano] = useState<TamanoDelDock>(TAMANO_POR_DEFECTO)
  const caja = useRef<HTMLElement>(null)

  // Lo elegido la última vez y el ancho de la ventana
  useEffect(() => {
    try {
      const guardado = leerModo(window.localStorage.getItem(CLAVE_DEL_DOCK))
      setModo(guardado)
      if (guardado !== 'cerrado') setMontado(true)
      setTamano(leerTamano(window.localStorage.getItem(CLAVE_DEL_TAMANO)))
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

  // Lo que ocupa la esquina de abajo a la derecha (la pastilla o la ventana del chat), para los demás:
  //   · la cápsula de la junta de voz (JuntaFlotante) se pone a su izquierda (`--junta-derecha`)
  //   · los avisos (PilaDeAvisos) y las tarjetas del chat (VistasPreviasDelChat) se apilan ENCIMA (`--dock-arriba`); con el panel lateral, a su izquierda (`--avisos-derecha`)
  useEffect(() => {
    const raiz = document.documentElement
    const variables = ['--junta-derecha', '--dock-arriba', '--avisos-derecha']
    const quitar = () => {
      for (const v of variables) raiz.style.removeProperty(v)
    }
    const el = document.querySelector<HTMLElement>(ofrecido && efectivo === 'cerrado' ? '.chat-dock-pastilla' : ofrecido && abierto ? '.chat-dock' : '__ninguno__')
    if (!el) {
      quitar()
      return
    }
    const lateral = efectivo === 'lateral'
    const poner = () => {
      raiz.style.setProperty('--junta-derecha', `${18 + el.offsetWidth + 10}px`)
      // Encima de la ventana flotante no cabe un aviso (la han hecho casi tan alta como la pantalla): se ponen a su izquierda, abajo
      const sinSitioEncima = !lateral && window.innerHeight - (18 + el.offsetHeight + 10) < SITIO_MINIMO_PARA_AVISOS
      if (lateral || sinSitioEncima) {
        raiz.style.setProperty('--avisos-derecha', `${(lateral ? 0 : 18) + el.offsetWidth + (lateral ? 16 : 12)}px`)
        raiz.style.removeProperty('--dock-arriba')
      } else {
        // La pastilla y la ventana flotante están a 18 px del borde de abajo; los avisos, 10 px por encima
        raiz.style.setProperty('--dock-arriba', `${18 + el.offsetHeight + 10}px`)
        raiz.style.removeProperty('--avisos-derecha')
      }
    }
    poner()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(poner) : null
    ro?.observe(el)
    window.addEventListener('resize', poner)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', poner)
      quitar()
    }
  }, [ofrecido, efectivo, abierto, sinLeer])

  // Arrastrar un borde de la ventana flotante: mientras se arrastra se toca el estilo directamente (sin repintar el chat a cada movimiento); al soltar se guarda
  const guardarTamano = useCallback((t: TamanoDelDock) => {
    setTamano(t)
    try {
      window.localStorage.setItem(CLAVE_DEL_TAMANO, JSON.stringify(t))
    } catch {
      /* se queda para esta sesión */
    }
  }, [])
  const empezarArrastre = useCallback(
    (borde: BordeDelDock) => (e: EventoDePuntero<HTMLDivElement>) => {
      const el = caja.current
      if (!el || e.button !== 0) return
      e.preventDefault()
      const inicio = { ancho: el.offsetWidth, alto: el.offsetHeight }
      const x0 = e.clientX
      const y0 = e.clientY
      let ultimo = inicio
      const raiz = document.documentElement
      raiz.setAttribute('data-dock-arrastre', borde)
      const mover = (ev: PointerEvent) => {
        ultimo = tamanoAlArrastrar(inicio, borde, ev.clientX - x0, ev.clientY - y0, { ancho: window.innerWidth, alto: window.innerHeight })
        el.style.setProperty('--dock-w', `${ultimo.ancho}px`)
        el.style.setProperty('--dock-h', `${ultimo.alto}px`)
      }
      const soltar = () => {
        window.removeEventListener('pointermove', mover)
        window.removeEventListener('pointerup', soltar)
        window.removeEventListener('pointercancel', soltar)
        raiz.removeAttribute('data-dock-arrastre')
        guardarTamano(ultimo)
      }
      window.addEventListener('pointermove', mover)
      window.addEventListener('pointerup', soltar)
      window.addEventListener('pointercancel', soltar)
    },
    [guardarTamano]
  )
  const tamanoDeSiempre = useCallback(() => {
    caja.current?.style.removeProperty('--dock-w')
    caja.current?.style.removeProperty('--dock-h')
    guardarTamano(TAMANO_POR_DEFECTO)
  }, [guardarTamano])

  // La campana enseña las tarjetas encima de la pastilla solo mientras la pastilla está a la vista
  const pastillaVisible = ofrecido && efectivo === 'cerrado'
  useEffect(() => {
    ponerPastillaDelChatVisible(pastillaVisible)
    return () => ponerPastillaDelChatVisible(false)
  }, [pastillaVisible])

  const abrirDesdeUnaTarjeta = useCallback(
    (v: VistaPrevia) => {
      quitarVistaPrevia(v.clave)
      if (v.canalId) pedirCanalAlChat(v.canalId)
      cambiar('pequeno')
    },
    [cambiar]
  )

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
      {pastillaVisible && <VistasPreviasDelChat alAbrir={abrirDesdeUnaTarjeta} />}
      {ofrecido && efectivo === 'cerrado' && (
        <button type="button" className="chat-dock-pastilla" data-menciona={sinLeer.menciones > 0 ? 'true' : undefined} onClick={() => cambiar('pequeno')} aria-label={total > 0 ? `Abrir el chat (${total} sin leer)` : 'Abrir el chat'}>
          <MessagesSquare className="h-4 w-4" />
          <span>Chat</span>
          {total > 0 && <b key={total}>{insignia}</b>}
        </button>
      )}
      {montado && (
        <section
          ref={caja}
          className="chat-dock"
          data-modo={efectivo}
          hidden={!abierto}
          aria-label="Chat del equipo"
          style={{ '--dock-w': `${tamano.ancho}px`, '--dock-h': `${tamano.alto}px` } as CSSProperties}
        >
          {efectivo === 'pequeno' &&
            (['izquierda', 'arriba', 'esquina'] as const).map((b) => (
              <div
                key={b}
                className="chat-dock-asa"
                data-borde={b}
                onPointerDown={empezarArrastre(b)}
                onDoubleClick={tamanoDeSiempre}
                title="Arrastra para cambiar el tamaño · doble clic: el de siempre"
                aria-hidden
              />
            ))}
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
