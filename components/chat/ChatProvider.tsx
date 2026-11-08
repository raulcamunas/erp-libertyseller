'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { pedir } from '@/components/tareas-clientes/api'
import { conMensaje } from '@/lib/chat/agrupar'
import type { DatosDeInicioChat } from '@/lib/chat/servidor'
import { estaVigente } from '@/lib/chat/estado'
import type { EncuestaChat } from '@/lib/chat/encuesta'
import type { AdjuntoChat, CanalChat, EstadoChat, EventoDeChat, MensajeChat, NivelDeAvisos, PersonaChat } from '@/lib/chat/tipos'
import { zonaDetectada } from '@/lib/chat/zonas'
import { createClient } from '@/lib/supabase/client'

const BASE = '/api/chat'
/** Si el directo no está disponible, la pantalla se relee sola con esta frecuencia (solo con la pestaña a la vista) */
const RELEER_CANAL_MS = 6_000
const RELEER_INICIO_MS = 15_000
const ESCRIBIENDO_VIDA_MS = 4_500

export interface EstadoDeCanal {
  mensajes: MensajeChat[]
  hayMas: boolean
  cargado: boolean
  cargando: boolean
  /** Se ha saltado a un mensaje antiguo: lo que hay no llega hasta lo último, y lo nuevo no se añade solo (hay que «ir al final») */
  conSalto: boolean
}

export type VistaDelChat = 'canal' | 'menciones' | 'guardados' | 'hilos' | 'recordatorios' | 'programados'

const VACIO: EstadoDeCanal = { mensajes: [], hayMas: false, cargado: false, cargando: false, conSalto: false }
const SIN_YO = { id: '', nombre: '', esAdmin: false }

interface ContextoDeChat {
  yo: { id: string; nombre: string; esAdmin: boolean }
  personas: PersonaChat[]
  persona: (id: string | null | undefined) => PersonaChat | undefined
  nombreDe: (id: string | null | undefined) => string
  canales: CanalChat[]
  cargando: boolean
  error: string | null
  actual: CanalChat | null
  seleccionar: (id: string | null) => void
  estado: (canalId: string) => EstadoDeCanal
  /** Desde cuándo había mensajes sin leer al abrir el canal: para la marca «Nuevos» */
  marcaDeNuevos: (canalId: string) => string | null
  cargarMas: (canalId: string) => Promise<void>
  hilo: { canalId: string; id: number } | null
  mensajesDelHilo: MensajeChat[]
  abrirHilo: (canalId: string, id: number) => void
  cerrarHilo: () => void
  enviar: (canalId: string, cuerpo: string, opciones?: { hiloDe?: number; respondeA?: number; adjuntos?: AdjuntoChat[]; encuesta?: Pick<EncuestaChat, 'pregunta' | 'opciones' | 'multiple'> }) => Promise<void>
  editar: (id: number, cuerpo: string) => Promise<void>
  borrar: (id: number) => Promise<void>
  reaccionar: (id: number, emoji: string) => Promise<void>
  crearCanal: (datos: { tipo: 'canal' | 'privado'; nombre: string; descripcion?: string; miembros?: string[]; clienteId?: string; anuncios?: boolean }) => Promise<string>
  abrirDirecto: (con: string) => Promise<string>
  unirse: (canalId: string) => Promise<void>
  salir: (canalId: string) => Promise<void>
  silenciar: (canalId: string, silenciado: boolean) => Promise<void>
  anadir: (canalId: string, miembros: string[]) => Promise<void>
  cambiar: (canalId: string, cambios: { nombre?: string; descripcion?: string; archivar?: boolean; anuncios?: boolean }) => Promise<void>
  /** Cuánto te avisa un canal: todo · solo menciones · nada (null = lo de siempre) */
  cambiarAvisos: (canalId: string, nivel: NivelDeAvisos | null) => Promise<void>
  votar: (id: number, opcion: number) => Promise<void>
  cerrarEncuesta: (id: number) => Promise<void>
  ponerZona: (zona: string) => Promise<void>
  /** El asistente del ERP (solo administradores): abierto, con una pregunta ya escrita si viene de «/erp» */
  asistente: { abierto: boolean; pregunta: string | null }
  abrirAsistente: (pregunta?: string) => void
  cerrarAsistente: () => void
  conectados: ReadonlySet<string>
  escribiendo: (canalId: string) => string[]
  avisarQueEscribo: (canalId: string) => void
  /** El directo está funcionando (si no, la pantalla se relee sola) */
  enVivo: boolean
  recargar: () => void
  /** Alguien ha abierto una junta en un canal mío (y no soy yo): suena si es un directo */
  llamadaEntrante: { canalId: string; de: string; en: number } | null
  descartarLlamada: () => void
  /** Sube cada vez que llega el aviso de una junta nueva: la pantalla de juntas relee las que hay abiertas */
  versionDeJuntas: number
  /** Qué se ve: un canal o una de las listas de la «bandeja» */
  vista: VistaDelChat
  abrirBandeja: (v: Exclude<VistaDelChat, 'canal'>) => void
  /** Salta a un mensaje, aunque sea muy antiguo (una respuesta de un hilo abre el hilo) */
  irAMensaje: (canalId: string, id: number, hiloDe?: number | null) => Promise<void>
  /** El mensaje al que hay que llevar la pantalla en cuanto esté pintado */
  objetivo: { canalId: string; id: number; n: number } | null
  limpiarObjetivo: () => void
  /** Vuelve a lo último del canal (después de saltar a un mensaje antiguo) */
  irAlFinal: (canalId: string) => Promise<void>
  guardados: ReadonlySet<number>
  guardar: (id: number, valor: boolean) => Promise<void>
  fijar: (id: number, valor: boolean) => Promise<void>
  /** El estado vigente de una persona («En reunión»…), o null */
  estadoDe: (id: string | null | undefined) => EstadoChat | null
  ponerEstado: (emoji: string, texto: string, duracion: string) => Promise<void>
}

const Contexto = createContext<ContextoDeChat | null>(null)

export function useChat(): ContextoDeChat {
  const c = useContext(Contexto)
  if (!c) throw new Error('useChat va dentro de ChatProvider')
  return c
}

/** Solo para probar las pantallas con datos inventados (la vista de pruebas) */
export const ContextoDeChatParaPruebas = Contexto

const ULTIMO_CANAL = 'chat:ultimo-canal'
const leerUltimo = (): string | null => {
  try {
    return window.localStorage.getItem(ULTIMO_CANAL)
  } catch {
    return null
  }
}
const guardarUltimo = (id: string | null) => {
  try {
    if (id) window.localStorage.setItem(ULTIMO_CANAL, id)
  } catch {
    /* sin almacenamiento: no se recuerda */
  }
}

export function ChatProvider({ canalInicial, children }: { canalInicial?: string | null; children: ReactNode }) {
  const [datos, setDatos] = useState<DatosDeInicioChat | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [canales, setCanales] = useState<CanalChat[]>([])
  const [actualId, setActualId] = useState<string | null>(canalInicial ?? null)
  const [estados, setEstados] = useState<Record<string, EstadoDeCanal>>({})
  const [marcas, setMarcas] = useState<Record<string, string | null>>({})
  const [hilo, setHilo] = useState<{ canalId: string; id: number } | null>(null)
  const [mensajesDelHilo, setMensajesDelHilo] = useState<MensajeChat[]>([])
  const [conectados, setConectados] = useState<ReadonlySet<string>>(new Set())
  const [escribiendoPor, setEscribiendoPor] = useState<Record<string, Record<string, number>>>({})
  const [enVivo, setEnVivo] = useState(false)
  const [llamadaEntrante, setLlamadaEntrante] = useState<{ canalId: string; de: string; en: number } | null>(null)
  const [versionDeJuntas, setVersionDeJuntas] = useState(0)
  const [vista, setVista] = useState<VistaDelChat>('canal')
  const [guardados, setGuardados] = useState<ReadonlySet<number>>(new Set())
  const [estadosDePersonas, setEstadosDePersonas] = useState<Record<string, EstadoChat>>({})
  const [objetivo, setObjetivo] = useState<{ canalId: string; id: number; n: number } | null>(null)
  const [asistente, setAsistente] = useState<{ abierto: boolean; pregunta: string | null }>({ abierto: false, pregunta: null })

  // Lo último, siempre a mano para los avisos del directo (que llegan con el estado de cuando se abrió el canal)
  const canalesRef = useRef<CanalChat[]>([])
  const estadosRef = useRef<Record<string, EstadoDeCanal>>({})
  const actualRef = useRef<string | null>(actualId)
  const hiloRef = useRef(hilo)
  const yoRef = useRef<string>('')
  const vistos = useRef<Set<number>>(new Set())
  const canalDePresencia = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null)
  const ultimoAviso = useRef(0)
  const refrescoPendiente = useRef<ReturnType<typeof setTimeout> | null>(null)
  canalesRef.current = canales
  estadosRef.current = estados
  actualRef.current = actualId
  hiloRef.current = hilo

  const yo = datos?.yo ?? SIN_YO
  yoRef.current = yo.id
  const personas = useMemo(() => datos?.personas ?? [], [datos])
  const mapaDePersonas = useMemo(() => new Map(personas.map((p) => [p.id, p])), [personas])
  const persona = useCallback((id: string | null | undefined) => (id ? mapaDePersonas.get(id) : undefined), [mapaDePersonas])
  const nombreDe = useCallback((id: string | null | undefined) => (id ? mapaDePersonas.get(id)?.nombre ?? 'Alguien del equipo' : 'Alguien del equipo'), [mapaDePersonas])

  /* ---------------- Carga ---------------- */

  const cargarInicio = useCallback(async () => {
    try {
      const d = await pedir<DatosDeInicioChat>(`${BASE}/inicio`)
      setDatos(d)
      setCanales(d.canales)
      setGuardados(new Set(d.guardados ?? []))
      setEstadosDePersonas(d.estados ?? {})
      setError(null)
      return d
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido abrir el chat')
      return null
    }
  }, [])

  const cambiarEstado = useCallback((canalId: string, f: (e: EstadoDeCanal) => EstadoDeCanal) => {
    setEstados((previo) => ({ ...previo, [canalId]: f(previo[canalId] ?? VACIO) }))
  }, [])

  const cargarCanal = useCallback(
    async (canalId: string, { sustituir = false }: { sustituir?: boolean } = {}) => {
      if (estadosRef.current[canalId]?.cargando) return
      // Con un salto a un mensaje antiguo no se mezcla lo último en medio: se vuelve al final cuando la persona lo pide
      if (estadosRef.current[canalId]?.conSalto && !sustituir) return
      cambiarEstado(canalId, (e) => ({ ...e, cargando: true }))
      try {
        const r = await pedir<{ mensajes: MensajeChat[]; hayMas: boolean }>(`${BASE}/mensajes?canalId=${canalId}`)
        for (const m of r.mensajes) vistos.current.add(m.id)
        cambiarEstado(canalId, (e) => {
          // Al releer no se pierde lo que ya había más arriba: se mezcla
          const mezclados = sustituir || !e.cargado ? r.mensajes : r.mensajes.reduce((acc, m) => conMensaje(acc, m), e.mensajes)
          return { mensajes: mezclados, hayMas: e.cargado && !sustituir ? e.hayMas : r.hayMas, cargado: true, cargando: false, conSalto: false }
        })
      } catch (e) {
        cambiarEstado(canalId, (x) => ({ ...x, cargando: false, cargado: x.cargado }))
        if (!estadosRef.current[canalId]?.cargado) toast.error(e instanceof Error ? e.message : 'No se han podido leer los mensajes')
      }
    },
    [cambiarEstado]
  )

  const cargarMas = useCallback(
    async (canalId: string) => {
      const e = estadosRef.current[canalId]
      if (!e || e.cargando || !e.hayMas || e.mensajes.length === 0) return
      const masViejo = e.mensajes.find((m) => m.hilo_de === null)?.id
      if (!masViejo) return
      cambiarEstado(canalId, (x) => ({ ...x, cargando: true }))
      try {
        const r = await pedir<{ mensajes: MensajeChat[]; hayMas: boolean }>(`${BASE}/mensajes?canalId=${canalId}&antes=${masViejo}`)
        for (const m of r.mensajes) vistos.current.add(m.id)
        cambiarEstado(canalId, (x) => ({ ...x, mensajes: r.mensajes.reduce((acc, m) => conMensaje(acc, m), x.mensajes), hayMas: r.hayMas, cargando: false }))
      } catch (err) {
        cambiarEstado(canalId, (x) => ({ ...x, cargando: false }))
        toast.error(err instanceof Error ? err.message : 'No se han podido leer los mensajes anteriores')
      }
    },
    [cambiarEstado]
  )

  const cargarHilo = useCallback(async (canalId: string, id: number) => {
    try {
      const r = await pedir<{ mensajes: MensajeChat[] }>(`${BASE}/mensajes?canalId=${canalId}&hilo=${id}`)
      for (const m of r.mensajes) vistos.current.add(m.id)
      setMensajesDelHilo(r.mensajes)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido abrir el hilo')
    }
  }, [])

  /* ---------------- Leer ---------------- */

  const marcarLeido = useCallback((canalId: string) => {
    const ahora = new Date().toISOString()
    setCanales((cs) => cs.map((c) => (c.id === canalId && c.soy_miembro ? { ...c, no_leidos: 0, menciones: 0, ultimo_leido_en: ahora } : c)))
    void pedir(`${BASE}/canales`, { metodo: 'PATCH', cuerpo: { accion: 'leido', canalId } }).catch(() => undefined)
  }, [])

  const seleccionar = useCallback(
    (id: string | null) => {
      setActualId(id)
      setVista('canal')
      setHilo(null)
      setMensajesDelHilo([])
      if (!id) return
      guardarUltimo(id)
      try {
        const url = new URL(window.location.href)
        url.searchParams.set('canal', id)
        window.history.replaceState(null, '', url.toString())
      } catch {
        /* sin historial: no pasa nada */
      }
      const c = canalesRef.current.find((x) => x.id === id)
      // La marca «Nuevos» se queda donde estaba al abrir
      setMarcas((m) => ({ ...m, [id]: c?.ultimo_leido_en ?? null }))
      if (!estadosRef.current[id]?.cargado) void cargarCanal(id)
      if (c?.soy_miembro && (c.no_leidos > 0 || c.menciones > 0)) marcarLeido(id)
    },
    [cargarCanal, marcarLeido]
  )

  /* ---------------- El directo ---------------- */

  const refrescarEnBreve = useCallback(() => {
    if (refrescoPendiente.current) return
    refrescoPendiente.current = setTimeout(() => {
      refrescoPendiente.current = null
      void cargarInicio()
    }, 400)
  }, [cargarInicio])

  const aplicarEvento = useCallback(
    (e: EventoDeChat) => {
      if (e.tipo === 'canales') return refrescarEnBreve()
      if (e.tipo === 'estado') {
        setEstadosDePersonas((previo) => {
          const nuevo = { ...previo }
          if (e.estado) nuevo[e.usuario] = e.estado
          else delete nuevo[e.usuario]
          return nuevo
        })
        return
      }
      if (e.tipo === 'junta') {
        setVersionDeJuntas((v) => v + 1)
        if (e.de !== yoRef.current) setLlamadaEntrante({ canalId: e.canalId, de: e.de, en: Date.now() })
        return
      }
      const reemplazar = (lista: MensajeChat[], id: number, f: (m: MensajeChat) => MensajeChat) => lista.map((m) => (m.id === id ? f(m) : m))
      if (e.tipo === 'editado') {
        cambiarEstado(e.mensaje.canal_id, (x) => ({ ...x, mensajes: reemplazar(x.mensajes, e.mensaje.id, (m) => ({ ...e.mensaje, respuestas: m.respuestas })) }))
        setMensajesDelHilo((l) => reemplazar(l, e.mensaje.id, (m) => ({ ...e.mensaje, respuestas: m.respuestas })))
        return
      }
      if (e.tipo === 'borrado') {
        const borrar = (m: MensajeChat): MensajeChat => ({ ...m, cuerpo: '', adjuntos: [], menciones: [], reacciones: {}, borrado_en: new Date().toISOString() })
        cambiarEstado(e.canalId, (x) => ({ ...x, mensajes: reemplazar(x.mensajes, e.id, borrar) }))
        setMensajesDelHilo((l) => reemplazar(l, e.id, borrar))
        return
      }
      if (e.tipo === 'reaccion') {
        cambiarEstado(e.canalId, (x) => ({ ...x, mensajes: reemplazar(x.mensajes, e.id, (m) => ({ ...m, reacciones: e.reacciones })) }))
        setMensajesDelHilo((l) => reemplazar(l, e.id, (m) => ({ ...m, reacciones: e.reacciones })))
        return
      }
      // Un mensaje nuevo
      const m = e.mensaje
      const nuevo = !vistos.current.has(m.id)
      vistos.current.add(m.id)
      const mio = m.autor_id === yoRef.current
      if (m.hilo_de === null) {
        const estadoDelCanal = estadosRef.current[m.canal_id]
        if (estadoDelCanal?.cargado && !estadoDelCanal.conSalto) cambiarEstado(m.canal_id, (x) => ({ ...x, mensajes: conMensaje(x.mensajes, m) }))
      } else {
        if (nuevo) cambiarEstado(m.canal_id, (x) => ({ ...x, mensajes: x.mensajes.map((p) => (p.id === m.hilo_de ? { ...p, respuestas: p.respuestas + 1 } : p)) }))
        if (hiloRef.current?.id === m.hilo_de) setMensajesDelHilo((l) => conMensaje(l, m))
      }
      const canal = canalesRef.current.find((c) => c.id === m.canal_id)
      if (!canal) return refrescarEnBreve()
      const viendoLo = actualRef.current === m.canal_id && document.visibilityState === 'visible'
      setCanales((cs) =>
        cs.map((c) => {
          if (c.id !== m.canal_id) return c
          const base = { ...c, ultimo_mensaje_en: m.creado_en }
          if (!nuevo || mio) return mio ? { ...base, ultimo_leido_en: m.creado_en } : base
          if (viendoLo) return { ...base, ultimo_leido_en: m.creado_en }
          return { ...base, no_leidos: c.no_leidos + 1, menciones: c.menciones + (m.menciones.includes(yoRef.current) ? 1 : 0) }
        })
      )
      if (nuevo && !mio && viendoLo && canal.soy_miembro) marcarLeido(m.canal_id)
    },
    [cambiarEstado, marcarLeido, refrescarEnBreve]
  )
  const aplicarRef = useRef(aplicarEvento)
  aplicarRef.current = aplicarEvento

  useEffect(() => {
    if (!yo.id) return
    const supabase = createClient()
    let vivo = true
    let propio: ReturnType<typeof supabase.channel> | null = null
    let presencia: ReturnType<typeof supabase.channel> | null = null
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession()
        supabase.realtime.setAuth(data.session?.access_token ?? null)
      } catch {
        /* sin sesión de navegador: no habrá directo y la pantalla se relee sola */
      }
      if (!vivo) return
      propio = supabase.channel(`chat:${yo.id}`, { config: { private: true } })
      propio
        .on('broadcast', { event: 'chat' }, ({ payload }) => aplicarRef.current(payload as EventoDeChat))
        .subscribe((s) => {
          if (!vivo) return
          if (s === 'SUBSCRIBED') {
            setEnVivo(true)
            // Al (re)conectar se recoge lo que pudo pasar mientras estaba caído
            void cargarInicio()
            if (actualRef.current) void cargarCanal(actualRef.current)
          } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') setEnVivo(false)
        })
      presencia = supabase.channel('chat-presencia', { config: { private: true, presence: { key: yo.id } } })
      canalDePresencia.current = presencia
      const sincronizar = () => {
        if (!vivo || !presencia) return
        setConectados(new Set(Object.keys(presencia.presenceState())))
      }
      presencia
        .on('presence', { event: 'sync' }, sincronizar)
        .on('broadcast', { event: 'escribe' }, ({ payload }) => {
          const p = payload as { canalId?: string; id?: string }
          if (!p.canalId || !p.id || p.id === yoRef.current) return
          setEscribiendoPor((e) => ({ ...e, [p.canalId as string]: { ...(e[p.canalId as string] ?? {}), [p.id as string]: Date.now() + ESCRIBIENDO_VIDA_MS } }))
        })
        .subscribe((s) => {
          if (s === 'SUBSCRIBED' && presencia) void presencia.track({ id: yo.id, en: Date.now() })
        })
    })()
    return () => {
      vivo = false
      canalDePresencia.current = null
      if (propio) void supabase.removeChannel(propio)
      if (presencia) void supabase.removeChannel(presencia)
    }
  }, [yo.id, cargarInicio, cargarCanal])

  // «Escribiendo…» se apaga solo
  useEffect(() => {
    const t = setInterval(() => {
      setEscribiendoPor((e) => {
        const ahora = Date.now()
        let cambia = false
        const nuevo: typeof e = {}
        for (const [canal, quienes] of Object.entries(e)) {
          const vivos = Object.fromEntries(Object.entries(quienes).filter(([, hasta]) => hasta > ahora))
          if (Object.keys(vivos).length !== Object.keys(quienes).length) cambia = true
          if (Object.keys(vivos).length > 0) nuevo[canal] = vivos
        }
        return cambia ? nuevo : e
      })
    }, 1500)
    return () => clearInterval(t)
  }, [])

  /* ---------------- Arranque, relectura y respaldo ---------------- */

  useEffect(() => {
    void cargarInicio().then((d) => {
      if (!d) return
      const pedido = canalInicial ?? leerUltimo()
      const elegido = d.canales.find((c) => c.id === pedido && (c.soy_miembro || c.tipo === 'canal')) ?? d.canales.find((c) => c.auto_unirse && c.soy_miembro) ?? d.canales.find((c) => c.soy_miembro) ?? null
      if (elegido) seleccionar(elegido.id)
    })
    // Solo al abrir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState !== 'visible' || Date.now() - ultimoAviso.current < 5_000) return
      ultimoAviso.current = Date.now()
      void cargarInicio()
      if (actualRef.current) {
        void cargarCanal(actualRef.current)
        const c = canalesRef.current.find((x) => x.id === actualRef.current)
        if (c?.soy_miembro && (c.no_leidos > 0 || c.menciones > 0)) marcarLeido(c.id)
      }
    }
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('online', alVolver)
    return () => {
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('online', alVolver)
    }
  }, [cargarInicio, cargarCanal, marcarLeido])

  // Sin directo, se relee sola
  useEffect(() => {
    if (enVivo || !yo.id) return
    const canal = setInterval(() => {
      if (document.visibilityState === 'visible' && actualRef.current) void cargarCanal(actualRef.current)
    }, RELEER_CANAL_MS)
    const inicio = setInterval(() => {
      if (document.visibilityState === 'visible') void cargarInicio()
    }, RELEER_INICIO_MS)
    return () => {
      clearInterval(canal)
      clearInterval(inicio)
    }
  }, [enVivo, yo.id, cargarCanal, cargarInicio])

  /* ---------------- Acciones ---------------- */

  const enviar = useCallback(
    async (canalId: string, cuerpo: string, opciones?: { hiloDe?: number; respondeA?: number; adjuntos?: AdjuntoChat[]; encuesta?: Pick<EncuestaChat, 'pregunta' | 'opciones' | 'multiple'> }) => {
      const m = await pedir<MensajeChat>(`${BASE}/mensajes`, { metodo: 'POST', cuerpo: { canalId, cuerpo, hiloDe: opciones?.hiloDe, respondeA: opciones?.respondeA, adjuntos: opciones?.adjuntos, encuesta: opciones?.encuesta } })
      aplicarRef.current({ tipo: 'mensaje', mensaje: m })
    },
    []
  )

  const editar = useCallback(async (id: number, cuerpo: string) => {
    const m = await pedir<MensajeChat>(`${BASE}/mensajes`, { metodo: 'PATCH', cuerpo: { id, cuerpo } })
    aplicarRef.current({ tipo: 'editado', mensaje: m })
  }, [])

  const borrar = useCallback(async (id: number) => {
    const canalId = Object.entries(estadosRef.current).find(([, e]) => e.mensajes.some((m) => m.id === id))?.[0] ?? hiloRef.current?.canalId
    await pedir(`${BASE}/mensajes`, { metodo: 'DELETE', cuerpo: { id } })
    if (canalId) aplicarRef.current({ tipo: 'borrado', canalId, id })
  }, [])

  const reaccionar = useCallback(async (id: number, emoji: string) => {
    const canalId = Object.entries(estadosRef.current).find(([, e]) => e.mensajes.some((m) => m.id === id))?.[0] ?? hiloRef.current?.canalId
    const r = await pedir<{ reacciones: Record<string, string[]> }>(`${BASE}/reacciones`, { metodo: 'POST', cuerpo: { id, emoji } })
    if (canalId) aplicarRef.current({ tipo: 'reaccion', canalId, id, reacciones: r.reacciones })
  }, [])

  const crearCanal = useCallback(
    async (d: { tipo: 'canal' | 'privado'; nombre: string; descripcion?: string; miembros?: string[]; clienteId?: string; anuncios?: boolean }) => {
      const r = await pedir<{ canalId: string }>(`${BASE}/canales`, { metodo: 'POST', cuerpo: d })
      await cargarInicio()
      return r.canalId
    },
    [cargarInicio]
  )

  const abrirDirecto = useCallback(
    async (con: string) => {
      const r = await pedir<{ canalId: string }>(`${BASE}/directo`, { metodo: 'POST', cuerpo: { con } })
      await cargarInicio()
      return r.canalId
    },
    [cargarInicio]
  )

  const accion = useCallback(
    async (cuerpo: Record<string, unknown>) => {
      await pedir(`${BASE}/canales`, { metodo: 'PATCH', cuerpo })
      await cargarInicio()
    },
    [cargarInicio]
  )
  const unirse = useCallback((canalId: string) => accion({ accion: 'unirse', canalId }), [accion])
  const salir = useCallback(
    async (canalId: string) => {
      await accion({ accion: 'salir', canalId })
      if (actualRef.current === canalId) setActualId(null)
    },
    [accion]
  )
  const silenciar = useCallback((canalId: string, silenciado: boolean) => accion({ accion: 'silenciar', canalId, silenciado }), [accion])
  const anadir = useCallback((canalId: string, miembros: string[]) => accion({ accion: 'anadir', canalId, miembros }), [accion])
  const cambiar = useCallback((canalId: string, cambios: { nombre?: string; descripcion?: string; archivar?: boolean; anuncios?: boolean }) => accion({ accion: 'cambiar', canalId, ...cambios }), [accion])
  const cambiarAvisos = useCallback((canalId: string, nivel: NivelDeAvisos | null) => accion({ accion: 'avisos', canalId, nivel }), [accion])

  const votar = useCallback(async (id: number, opcion: number) => {
    const r = await pedir<{ mensaje: MensajeChat }>(`${BASE}/votos`, { metodo: 'POST', cuerpo: { accion: 'votar', id, opcion } })
    aplicarRef.current({ tipo: 'editado', mensaje: r.mensaje })
  }, [])
  const cerrarEncuesta = useCallback(async (id: number) => {
    const r = await pedir<{ mensaje: MensajeChat }>(`${BASE}/votos`, { metodo: 'POST', cuerpo: { accion: 'cerrar', id } })
    aplicarRef.current({ tipo: 'editado', mensaje: r.mensaje })
  }, [])
  const ponerZona = useCallback(async (zona: string) => {
    await pedir(`${BASE}/zona`, { metodo: 'PUT', cuerpo: { zona } })
    await cargarInicio()
  }, [cargarInicio])
  const abrirAsistente = useCallback((pregunta?: string) => setAsistente({ abierto: true, pregunta: pregunta ?? null }), [])
  const cerrarAsistente = useCallback(() => setAsistente({ abierto: false, pregunta: null }), [])

  // La primera vez, se guarda la zona horaria del navegador (si es una de la lista) para que los demás vean la hora que es allí
  const zonaIntentada = useRef(false)
  useEffect(() => {
    if (!datos || zonaIntentada.current) return
    zonaIntentada.current = true
    const mia = datos.personas.find((p) => p.id === datos.yo.id)
    if (mia?.zona) return
    const z = zonaDetectada(Intl.DateTimeFormat().resolvedOptions().timeZone)
    if (z) void pedir(`${BASE}/zona`, { metodo: 'PUT', cuerpo: { zona: z } }).then(() => cargarInicio()).catch(() => undefined)
  }, [datos, cargarInicio])

  const abrirHilo = useCallback(
    (canalId: string, id: number) => {
      setHilo({ canalId, id })
      setMensajesDelHilo([])
      void cargarHilo(canalId, id)
    },
    [cargarHilo]
  )
  const cerrarHilo = useCallback(() => {
    setHilo(null)
    setMensajesDelHilo([])
  }, [])

  const abrirBandeja = useCallback((v: Exclude<VistaDelChat, 'canal'>) => {
    setVista(v)
    setActualId(null)
    setHilo(null)
  }, [])

  const abrirHiloRef = useRef<(canalId: string, id: number) => void>(() => undefined)
  abrirHiloRef.current = abrirHilo

  const irAMensaje = useCallback(
    async (canalId: string, id: number, hiloDe?: number | null) => {
      const destino = hiloDe ?? id
      const marca = () => setObjetivo({ canalId, id: destino, n: Date.now() })
      setVista('canal')
      setActualId(canalId)
      setHilo(null)
      guardarUltimo(canalId)
      const c = canalesRef.current.find((x) => x.id === canalId)
      setMarcas((m) => ({ ...m, [canalId]: c?.ultimo_leido_en ?? null }))
      if (c?.soy_miembro && (c.no_leidos > 0 || c.menciones > 0)) marcarLeido(canalId)
      // Si ya está cargado, basta con llevar la pantalla hasta él
      const actual = estadosRef.current[canalId]
      if (actual?.cargado && actual.mensajes.some((m) => m.id === destino)) {
        marca()
      } else {
        try {
          const r = await pedir<{ mensajes: MensajeChat[]; hayMas: boolean; hayMasNuevos?: boolean }>(`${BASE}/mensajes?canalId=${canalId}&alrededor=${destino}`)
          for (const m of r.mensajes) vistos.current.add(m.id)
          cambiarEstado(canalId, () => ({ mensajes: r.mensajes, hayMas: r.hayMas, cargado: true, cargando: false, conSalto: Boolean(r.hayMasNuevos) }))
          marca()
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'No se ha podido abrir ese mensaje')
          return
        }
      }
      if (hiloDe) abrirHiloRef.current(canalId, hiloDe)
    },
    [cambiarEstado, marcarLeido]
  )

  const irAlFinal = useCallback((canalId: string) => cargarCanal(canalId, { sustituir: true }), [cargarCanal])

  const guardar = useCallback(async (id: number, valor: boolean) => {
    setGuardados((g) => {
      const n = new Set(g)
      if (valor) n.add(id)
      else n.delete(id)
      return n
    })
    try {
      await pedir(`${BASE}/marcas`, { metodo: 'POST', cuerpo: { accion: 'guardar', id, valor } })
    } catch (e) {
      // Si falla se deshace
      setGuardados((g) => {
        const n = new Set(g)
        if (valor) n.delete(id)
        else n.add(id)
        return n
      })
      throw e
    }
  }, [])

  const fijar = useCallback(async (id: number, valor: boolean) => {
    const r = await pedir<{ mensaje: MensajeChat }>(`${BASE}/marcas`, { metodo: 'POST', cuerpo: { accion: 'fijar', id, valor } })
    aplicarRef.current({ tipo: 'editado', mensaje: r.mensaje })
  }, [])

  const ponerEstado = useCallback(async (emoji: string, texto: string, duracion: string) => {
    const r = await pedir<{ estado: EstadoChat | null }>(`${BASE}/estado`, { metodo: 'PUT', cuerpo: { emoji, texto, duracion } })
    aplicarRef.current({ tipo: 'estado', usuario: yoRef.current, estado: r.estado })
  }, [])

  const estadoDe = useCallback((id: string | null | undefined) => (id && estaVigente(estadosDePersonas[id]) ? estadosDePersonas[id] : null), [estadosDePersonas])

  const avisarQueEscribo = useCallback((canalId: string) => {
    const c = canalDePresencia.current
    if (!c) return
    void c.send({ type: 'broadcast', event: 'escribe', payload: { canalId, id: yoRef.current } })
  }, [])

  const escribiendo = useCallback(
    (canalId: string) => Object.entries(escribiendoPor[canalId] ?? {}).filter(([, hasta]) => hasta > Date.now()).map(([id]) => id),
    [escribiendoPor]
  )

  const actual = useMemo(() => canales.find((c) => c.id === actualId) ?? null, [canales, actualId])
  const estado = useCallback((canalId: string) => estados[canalId] ?? VACIO, [estados])
  const marcaDeNuevos = useCallback((canalId: string) => marcas[canalId] ?? null, [marcas])

  const valor = useMemo<ContextoDeChat>(
    () => ({
      yo,
      personas,
      persona,
      nombreDe,
      canales,
      cargando: !datos && !error,
      error,
      actual,
      seleccionar,
      estado,
      marcaDeNuevos,
      cargarMas,
      hilo,
      mensajesDelHilo,
      abrirHilo,
      cerrarHilo,
      enviar,
      editar,
      borrar,
      reaccionar,
      crearCanal,
      abrirDirecto,
      unirse,
      salir,
      silenciar,
      anadir,
      cambiar,
      conectados,
      escribiendo,
      avisarQueEscribo,
      enVivo,
      recargar: () => void cargarInicio(),
      llamadaEntrante,
      descartarLlamada: () => setLlamadaEntrante(null),
      versionDeJuntas,
      vista,
      abrirBandeja,
      irAMensaje,
      objetivo,
      limpiarObjetivo: () => setObjetivo(null),
      irAlFinal,
      guardados,
      guardar,
      fijar,
      estadoDe,
      ponerEstado,
      cambiarAvisos,
      votar,
      cerrarEncuesta,
      ponerZona,
      asistente,
      abrirAsistente,
      cerrarAsistente,
    }),
    [yo, personas, persona, nombreDe, canales, datos, error, actual, seleccionar, estado, marcaDeNuevos, cargarMas, hilo, mensajesDelHilo, abrirHilo, cerrarHilo, enviar, editar, borrar, reaccionar, crearCanal, abrirDirecto, unirse, salir, silenciar, anadir, cambiar, conectados, escribiendo, avisarQueEscribo, enVivo, cargarInicio, llamadaEntrante, versionDeJuntas, vista, abrirBandeja, irAMensaje, objetivo, irAlFinal, guardados, guardar, fijar, estadoDe, ponerEstado, cambiarAvisos, votar, cerrarEncuesta, ponerZona, asistente, abrirAsistente, cerrarAsistente]
  )

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export type { AdjuntoChat }
