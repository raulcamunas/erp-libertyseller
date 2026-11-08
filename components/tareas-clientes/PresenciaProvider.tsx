'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ESCRIBIENDO_MS, lugarDeRuta, normalizarActividad, porCliente, porTarea, unirDispositivos, type Conectado, type Observados, type PayloadDePresencia } from '@/lib/tareas-clientes/presencia'

/**
 * QUIÉN ESTÁ DÓNDE EN TAREAS DE CLIENTES, EN VIVO. Cada persona con el módulo abierto cuenta por un canal PRIVADO de tiempo real (solo entra quien tiene acceso al módulo: migración 281)
 * en qué cliente está, qué tarea tiene abierta y si está escribiendo en ella. Es Presence de Supabase: los mensajes viajan por memoria, no pasan por el disco de la base, y al cerrar
 * la pestaña la persona desaparece sola. Si el canal no se puede abrir (falta la migración, sin conexión), todo sigue como antes sin presencia y sin errores a la vista.
 *
 * Quien lo usa fuera del proveedor (la vista de pruebas, otra pantalla) recibe un contexto vacío: nada falla.
 */

const CANAL = 'tareas-presencia'
/** Mientras se está activo se repite el estado cada tanto (sube el «pulso»): así quien mira sabe que sigue ahí */
const LATIDO_MS = 45_000

export interface ContextoDePresencia {
  /** Los demás conectados (y yo): una fila por persona */
  conectados: Conectado[]
  yo: string
  /** El canal está abierto y se está compartiendo la presencia */
  disponible: boolean
  /** Por tarea y por cliente: quién más está ahí (sin mí) */
  deTarea: ReadonlyMap<string, Conectado[]>
  deCliente: ReadonlyMap<string, Conectado[]>
  /** La tarea que tengo abierta (o null) */
  ponerTarea: (tareaId: string | null) => void
  /** Aviso de que estoy escribiendo en la tarea abierta (se puede llamar en cada letra: se limita solo) */
  escribiendo: () => void
}

const VACIO: ContextoDePresencia = { conectados: [], yo: '', disponible: false, deTarea: new Map(), deCliente: new Map(), ponerTarea: () => undefined, escribiendo: () => undefined }
const Contexto = createContext<ContextoDePresencia>(VACIO)
export const usePresencia = (): ContextoDePresencia => useContext(Contexto)
/** Solo para probar las pantallas con una presencia inventada (la vista de pruebas): el contexto en bruto */
export const ContextoDePresenciaParaPruebas = Contexto

export function PresenciaProvider({ yo, children }: { yo: { id: string; nombre: string }; children: ReactNode }) {
  const pathname = usePathname()
  const [conectados, setConectados] = useState<Conectado[]>([])
  const [disponible, setDisponible] = useState(false)
  const canal = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null)
  const suscrito = useRef(false)
  const tareaId = useRef<string | null>(null)
  const escribiendoHasta = useRef(0)
  const ultimoToque = useRef(Date.now())
  const pulso = useRef(0)
  const ruta = useRef(pathname ?? '')
  const ultimoEnvio = useRef(0)
  const pendiente = useRef<ReturnType<typeof setTimeout> | null>(null)
  const observados = useRef<Observados>(new Map())

  const quieto = () => document.visibilityState !== 'visible' || Date.now() - ultimoToque.current > 90_000

  const emitir = useCallback(() => {
    if (!suscrito.current || !canal.current) return
    const { pantalla, clienteId } = lugarDeRuta(ruta.current)
    pulso.current += 1
    ultimoEnvio.current = Date.now()
    const estado: PayloadDePresencia = {
      id: yo.id,
      nombre: yo.nombre,
      pantalla,
      clienteId,
      tareaId: pantalla === 'cliente' || pantalla === 'todas' || pantalla === 'mias' ? tareaId.current : null,
      escribiendoEn: Date.now() < escribiendoHasta.current ? tareaId.current : null,
      escribiendoHasta: escribiendoHasta.current,
      quieto: quieto(),
      pulso: pulso.current,
    }
    void canal.current.track(estado).catch(() => undefined)
  }, [yo.id, yo.nombre])

  // Como mucho un envío por segundo: se agrupan los cambios seguidos (abrir una tarea y escribir, por ejemplo)
  const emitirEnBreve = useCallback(() => {
    if (pendiente.current) return
    const espera = Math.max(0, 1000 - (Date.now() - ultimoEnvio.current))
    pendiente.current = setTimeout(() => {
      pendiente.current = null
      emitir()
    }, espera)
  }, [emitir])

  useEffect(() => {
    ruta.current = pathname ?? ''
    emitirEnBreve()
  }, [pathname, emitirEnBreve])

  useEffect(() => {
    let vivo = true
    const supabase = createClient()
    const refrescar = () => {
      if (!canal.current) return
      const { estados, observados: nuevos } = normalizarActividad(canal.current.presenceState() as never, observados.current, Date.now())
      observados.current = nuevos
      if (vivo) setConectados(unirDispositivos(estados, Date.now()))
    }
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession()
        supabase.realtime.setAuth(data.session?.access_token ?? null)
      } catch {
        /* sin sesión de navegador: el canal privado no se abrirá y se queda sin presencia */
      }
      if (!vivo) return
      const c = supabase.channel(CANAL, { config: { private: true, presence: { key: yo.id } } })
      canal.current = c
      c.on('presence', { event: 'sync' }, refrescar)
        .on('presence', { event: 'join' }, refrescar)
        .on('presence', { event: 'leave' }, refrescar)
        .subscribe((estado) => {
          if (!vivo) return
          if (estado === 'SUBSCRIBED') {
            suscrito.current = true
            setDisponible(true)
            emitir()
          } else if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT' || estado === 'CLOSED') {
            suscrito.current = false
            setDisponible(false)
          }
        })
    })()

    // Lo que hace la persona: mueve el ratón, teclea, pulsa. Solo se anota (no se envía): el latido de abajo es el que avisa
    let ultimoAnotado = 0
    const tocar = () => {
      const ahora = Date.now()
      if (ahora - ultimoAnotado < 1000) return
      ultimoAnotado = ahora
      ultimoToque.current = ahora
    }
    const eventos: Array<keyof WindowEventMap> = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart']
    for (const e of eventos) window.addEventListener(e, tocar, { passive: true })
    const alCambiarVisibilidad = () => {
      if (document.visibilityState === 'visible') ultimoToque.current = Date.now()
      emitirEnBreve()
    }
    document.addEventListener('visibilitychange', alCambiarVisibilidad)
    // El latido: mientras se está activo se repite el estado (y se comprueba si ha pasado a quieto); y se vuelve a calcular quién está quieto aunque no llegue nada nuevo
    let estabaQuieto = false
    const latido = setInterval(() => {
      const q = quieto()
      if (!q || q !== estabaQuieto) emitir()
      estabaQuieto = q
      refrescar()
    }, LATIDO_MS)
    return () => {
      vivo = false
      clearInterval(latido)
      if (pendiente.current) clearTimeout(pendiente.current)
      pendiente.current = null
      for (const e of eventos) window.removeEventListener(e, tocar)
      document.removeEventListener('visibilitychange', alCambiarVisibilidad)
      suscrito.current = false
      if (canal.current) void supabase.removeChannel(canal.current)
      canal.current = null
    }
    // El canal se abre una sola vez por persona
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yo.id])

  const ponerTarea = useCallback(
    (id: string | null) => {
      if (tareaId.current === id) return
      tareaId.current = id
      escribiendoHasta.current = 0
      emitirEnBreve()
    },
    [emitirEnBreve]
  )

  const escribiendo = useCallback(() => {
    const ahora = Date.now()
    ultimoToque.current = ahora
    // Solo se vuelve a avisar cuando el «escribiendo» anterior ya está a punto de caducar
    if (escribiendoHasta.current - ahora > ESCRIBIENDO_MS - 3000) return
    escribiendoHasta.current = ahora + ESCRIBIENDO_MS
    emitirEnBreve()
  }, [emitirEnBreve])

  const valor = useMemo<ContextoDePresencia>(() => ({ conectados, yo: yo.id, disponible, deTarea: porTarea(conectados, yo.id), deCliente: porCliente(conectados, yo.id), ponerTarea, escribiendo }), [conectados, yo.id, disponible, ponerTarea, escribiendo])
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}
