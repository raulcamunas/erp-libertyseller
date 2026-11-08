'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter } from 'next/navigation'
import { AlertTriangle, Loader2, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { colocar } from '@/lib/tareas-clientes/orden'
import { filtrarTareas } from '@/lib/tareas-clientes/filtros'
import type { TareaLigera } from '@/lib/tareas-clientes/servidor'
import { departamentosDe, estadosDe, FILTROS_VACIOS, ordenarSegun, type ClienteTC, type FiltrosDeTareas, type OpcionDeEstado, type OpcionSimple, type PlantillaTC, type Portada as PortadaGuardada, type TipoDeVista } from '@/lib/tareas-clientes/tipos'
import { tareasBloqueadas } from '@/lib/tareas-clientes/subtareas'
import { ambitoDeRuta, mismoAmbito, rutaDeAmbito, type Ambito } from '@/lib/tareas-clientes/ambito'
import { BASE, memoria, pedir, type DatosDeTodas, type Preferencias } from './api'
import { alternar } from '@/lib/tareas-clientes/seleccion'
import { BarraDeSeleccion } from './BarraDeSeleccion'
import { BarraLateral, SelectorMovil } from './BarraLateral'
import { BuscadorGlobal } from './BuscadorGlobal'
import { Cabecera } from './Cabecera'
import { CompartirConElCliente } from './CompartirConElCliente'
import { Calendario } from './Calendario'
import { Cronograma } from './Cronograma'
import { BloqueadasContexto } from './contexto'
import { PanelDeTarea } from './PanelDeTarea'
import { PlantillasGestor } from './PlantillasGestor'
import { useMarco } from './useMarco'
import { estiloDePortada, FondoAnimado, fondoNecesitaCortina } from './Portada'
import { Tablero } from './Tablero'
import { Tabla } from './Tabla'
import { estaHechaLaTarea } from './vistas'

/**
 * EL ESPACIO DE TRABAJO: tres columnas (los clientes, la vista elegida y la tarea abierta).
 *
 * Se trae TODO de una vez (los clientes y sus tareas sin el cuerpo) y cada cliente, «Todas las tareas» y «Mis tareas» son filtros de ese mismo conjunto: cambiar de uno a
 * otro es instantáneo y no pide nada al servidor. Cada cambio se pinta al momento y se manda por detrás; si el servidor lo rechaza, se deshace y se dice por qué. Cada 20
 * segundos, y al volver a la pestaña, se vuelve a leer para ver lo que han hecho los demás (o Notion), salvo mientras haya un cambio sin confirmar.
 */

const RELEER_CADA_MS = 20_000

const VISTAS_DE_CLIENTE: readonly TipoDeVista[] = ['tablero', 'tabla', 'cronograma', 'calendario']
const VISTAS_DE_TODAS: readonly TipoDeVista[] = ['tabla', 'tablero', 'cronograma', 'calendario']

function leerLocal(clave: string): string | null {
  try {
    return window.localStorage.getItem(clave)
  } catch {
    return null
  }
}
function escribirLocal(clave: string, valor: string) {
  try {
    window.localStorage.setItem(clave, valor)
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}

export function EspacioDeTrabajo({ ambito: ambitoInicial, miId, esAdmin, tareaInicial }: { ambito: Ambito; miId: string; esAdmin: boolean; tareaInicial?: string | null }) {
  const router = useRouter()
  const pathname = usePathname()
  // El ámbito (un cliente, «Todas», «Mis tareas») vive aquí y no en la página: cambiar de cliente solo cambia el filtro, no se vuelve a pedir nada (ver lib/tareas-clientes/ambito.ts)
  const [ambito, setAmbito] = useState<Ambito>(ambitoInicial)
  // Lo último que se leyó, si ya se leyó antes en esta pestaña: se pinta al momento y se refresca por detrás
  const [datos, setDatos] = useState<DatosDeTodas | null>(memoria.todas)
  const [error, setError] = useState<string | null>(null)
  const [vistaElegida, setVistaElegida] = useState<TipoDeVista | null>(null)
  const [filtros, setFiltros] = useState<FiltrosDeTareas>(FILTROS_VACIOS)
  const [abierta, setAbierta] = useState<string | null>(tareaInicial ?? null)
  const [colapsada, setColapsada] = useState(false)
  const [releyendo, setReleyendo] = useState(false)
  const [plantillas, setPlantillas] = useState<PlantillaTC[]>([])
  const [gestorAbierto, setGestorAbierto] = useState(false)
  const [compartirAbierto, setCompartirAbierto] = useState(false)
  const pendientes = useRef(0)

  useEffect(() => {
    setColapsada(leerLocal('tc-lateral') === '1')
    const v = leerLocal('tc-vista') as TipoDeVista | null
    if (v && VISTAS_DE_CLIENTE.includes(v)) setVistaElegida(v)
  }, [])

  /* ---- Cargar y mantener al día ---- */
  const cargar = useCallback(async (silencioso: boolean) => {
    if (pendientes.current > 0) return
    if (!silencioso) setReleyendo(true)
    try {
      const d = await pedir<DatosDeTodas>(`${BASE}/todas`)
      if (pendientes.current > 0) return
      memoria.todas = d
      setDatos(d)
      setError(null)
    } catch (e) {
      if (!silencioso || !datos) setError(e instanceof Error ? e.message : 'No se han podido leer las tareas')
    } finally {
      setReleyendo(false)
    }
    // `datos` solo se mira para no tapar con un error una pantalla que ya está pintada
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void cargar(false)
    const intervalo = setInterval(() => document.visibilityState === 'visible' && void cargar(true), RELEER_CADA_MS)
    const alVolver = () => document.visibilityState === 'visible' && void cargar(true)
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('focus', alVolver)
    return () => {
      clearInterval(intervalo)
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('focus', alVolver)
    }
  }, [cargar])

  /* ---- Lo que se ve ---- */
  const mapa = useMemo(() => new Map((datos?.clientes ?? []).map((c) => [c.id, c])), [datos?.clientes])
  const cliente: ClienteTC | null = ambito.tipo === 'cliente' ? (mapa.get(ambito.id) ?? null) : null
  const vistasDisponibles = ambito.tipo === 'cliente' ? VISTAS_DE_CLIENTE : VISTAS_DE_TODAS
  const vista = vistaElegida && vistasDisponibles.includes(vistaElegida) ? vistaElegida : vistasDisponibles[0]
  const personas = useMemo(() => datos?.personas ?? [], [datos?.personas])

  /* ---- Varias tareas a la vez: el cuadro de selección, Mayús/Ctrl/Cmd + clic, y la barra con «Mover a…» y «Archivar» ---- */
  const [seleccion, setSeleccion] = useState<ReadonlySet<string>>(() => new Set())
  const [lotePendiente, setLotePendiente] = useState(false)
  const [centro, setCentro] = useState<HTMLElement | null>(null)
  const { marco } = useMarco(centro, { seleccion, fijar: setSeleccion, vaciar: () => setSeleccion(new Set()), activo: vista === 'tablero' || vista === 'tabla' })
  const alternarSeleccion = useCallback((id: string) => setSeleccion((s) => alternar(s, id)), [])
  // Al cambiar de cliente o de vista la selección se quita; y lo que ya no existe (archivado por otro compañero) sale de ella
  useEffect(() => setSeleccion(new Set()), [ambito, vista])
  useEffect(() => {
    const ids = new Set((datos?.tareas ?? []).map((t) => t.id))
    setSeleccion((s) => {
      const vivas = [...s].filter((id) => ids.has(id))
      return vivas.length === s.size ? s : new Set(vivas)
    })
  }, [datos?.tareas])
  useEffect(() => {
    if (seleccion.size === 0) return
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement | null)?.closest?.('input, textarea, [role="dialog"], [data-radix-popper-content-wrapper], .tc-editable, .tc-modal')) setSeleccion(new Set())
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [seleccion.size])
  const nombreDe = useCallback((id: string) => personas.find((p) => p.id === id)?.nombre ?? '', [personas])

  const delAmbito = useMemo(() => {
    const todas = datos?.tareas ?? []
    if (ambito.tipo === 'cliente') return todas.filter((t) => t.cliente_id === ambito.id)
    if (ambito.tipo === 'mias') return todas.filter((t) => t.responsables.includes(miId))
    return todas
  }, [datos?.tareas, ambito, miId])

  const estadosDelAmbito = useMemo(() => estadosDe(cliente), [cliente])
  // Las columnas a las que se puede mover lo seleccionado: las del cliente, o la unión de las de todos (cada nombre una vez)
  const estadosDeLote = useMemo(() => {
    if (cliente) return estadosDelAmbito
    const unicos = new Map<string, OpcionDeEstado>()
    for (const c of datos?.clientes ?? []) for (const e of estadosDe(c)) if (!unicos.has(e.nombre)) unicos.set(e.nombre, e)
    return [...unicos.values()]
  }, [cliente, estadosDelAmbito, datos?.clientes])
  const visibles = useMemo(() => filtrarTareas(delAmbito, filtros, miId, cliente ? estadosDelAmbito : [...mapa.values()].flatMap((c) => estadosDe(c)), nombreDe), [delAmbito, filtros, miId, cliente, estadosDelAmbito, mapa, nombreDe])

  // Las tareas que esperan a otra: se calcula una vez y las tarjetas y las filas solo lo miran
  const bloqueadas = useMemo(() => tareasBloqueadas(datos?.tareas ?? [], (t) => estaHechaLaTarea(t, mapa)), [datos?.tareas, mapa])

  const prefs: Preferencias = datos?.preferencias ?? { fondo: {}, portada: {}, favoritos: [] }
  const fondo: PortadaGuardada = cliente?.fondo?.tipo ? cliente.fondo : prefs.fondo

  /* ---- Cambios con respuesta inmediata ---- */
  const aplicarFila = useCallback((nueva: TareaLigera) => setDatos((d) => (d ? { ...d, tareas: d.tareas.some((t) => t.id === nueva.id) ? d.tareas.map((t) => (t.id === nueva.id ? { ...t, ...nueva } : t)) : [...d.tareas, nueva] } : d)), [])

  const cambiar = useCallback(
    async (id: string, cambios: Record<string, unknown>) => {
      const previa = datos?.tareas.find((t) => t.id === id)
      if (!previa) return
      pendientes.current += 1
      setDatos((d) => (d ? { ...d, tareas: d.tareas.map((t) => (t.id === id ? ({ ...t, ...cambios } as TareaLigera) : t)) } : d))
      try {
        const { tarea } = await pedir<{ tarea: TareaLigera }>(`${BASE}/tareas/${id}`, { metodo: 'PATCH', cuerpo: cambios })
        aplicarFila(tarea)
      } catch (e) {
        setDatos((d) => (d ? { ...d, tareas: d.tareas.map((t) => (t.id === id ? previa : t)) } : d))
        toast.error(e instanceof Error ? e.message : 'No se ha podido guardar el cambio')
      } finally {
        pendientes.current -= 1
      }
    },
    [datos?.tareas, aplicarFila]
  )

  const mover = useCallback(
    async (id: string, estado: string, despuesDe: string | null) => {
      const previa = datos?.tareas.find((t) => t.id === id)
      if (!previa || !datos) return
      const columna = datos.tareas.filter((t) => t.cliente_id === previa.cliente_id && t.estado === estado && t.id !== id).sort((a, b) => Number(a.orden) - Number(b.orden))
      const ids = columna.map((t) => t.id)
      const { orden } = colocar(ids, new Map(columna.map((t) => [t.id, Number(t.orden)])), despuesDe ? ids.indexOf(despuesDe) + 1 : 0)
      pendientes.current += 1
      setDatos((d) => (d ? { ...d, tareas: d.tareas.map((t) => (t.id === id ? { ...t, estado, orden } : t)) } : d))
      try {
        const r = await pedir<{ tarea: TareaLigera; renumeradas: Array<{ id: string; orden: number }> | null }>(`${BASE}/tareas/${id}/mover`, { metodo: 'POST', cuerpo: { estado, despuesDe } })
        setDatos((d) => {
          if (!d) return d
          const nuevos = new Map((r.renumeradas ?? []).map((x) => [x.id, x.orden]))
          return { ...d, tareas: d.tareas.map((t) => (t.id === id ? { ...t, ...r.tarea } : nuevos.has(t.id) ? { ...t, orden: nuevos.get(t.id) as number } : t)) }
        })
      } catch (e) {
        setDatos((d) => (d ? { ...d, tareas: d.tareas.map((t) => (t.id === id ? previa : t)) } : d))
        toast.error(e instanceof Error ? e.message : 'No se ha podido mover la tarea')
      } finally {
        pendientes.current -= 1
      }
    },
    [datos]
  )

  const crear = useCallback(
    async (clienteId: string, estado: string | null, titulo: string, extra: Record<string, unknown> = {}) => {
      try {
        const { tarea } = await pedir<{ tarea: TareaLigera }>(`${BASE}/tareas`, { metodo: 'POST', cuerpo: { clienteId, titulo, ...(estado ? { estado } : {}), ...extra } })
        aplicarFila(tarea)
        return tarea
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'No se ha podido crear la tarea')
        return null
      }
    },
    [aplicarFila]
  )

  const aplicarLote = useCallback(
    async (accion: 'mover' | 'archivar', estado?: string) => {
      const ids = [...seleccion]
      if (ids.length === 0 || lotePendiente) return
      if (accion === 'archivar' && !window.confirm(`¿Archivar ${ids.length} ${ids.length === 1 ? 'tarea' : 'tareas'}? No se borran: se pueden recuperar (en Notion van a la papelera).`)) return
      const previas = datos?.tareas ?? []
      setLotePendiente(true)
      pendientes.current += 1
      setDatos((d) => (d ? { ...d, tareas: accion === 'archivar' ? d.tareas.filter((t) => !ids.includes(t.id)) : d.tareas.map((t) => (ids.includes(t.id) ? { ...t, estado: estado as string } : t)) } : d))
      try {
        const r = await pedir<{ hechas: number; fallidas: Array<{ id: string; motivo: string }> }>(`${BASE}/tareas/lote`, { metodo: 'POST', cuerpo: { ids, accion, estado } })
        if (r.fallidas.length > 0) toast.error(`${r.hechas} hechas y ${r.fallidas.length} no: ${r.fallidas[0].motivo}`)
        else toast.success(accion === 'mover' ? `${r.hechas} movidas a «${estado}»` : `${r.hechas} archivadas`)
        // Las que no han podido quedan marcadas, para ver cuáles son
        setSeleccion(new Set(r.fallidas.map((f) => f.id)))
      } catch (e) {
        setDatos((d) => (d ? { ...d, tareas: previas } : d))
        toast.error(e instanceof Error ? e.message : 'No se ha podido aplicar')
      } finally {
        pendientes.current -= 1
        setLotePendiente(false)
        void cargar(true)
      }
    },
    [seleccion, lotePendiente, datos?.tareas, cargar]
  )

  const nuevaTarea = useCallback(async () => {
    const destino = cliente ?? (datos?.clientes[0] ?? null)
    if (!destino) return
    if (!cliente) {
      toast.message('Elige un cliente de la izquierda para crear su tarea', { description: 'En «Todas» y «Mis tareas» no hay un cliente al que añadirla.' })
      return
    }
    const t = await crear(destino.id, null, '', ambito.tipo === 'mias' ? { responsables: [miId] } : {})
    if (t) setAbierta(t.id)
  }, [cliente, datos?.clientes, crear, ambito.tipo, miId])

  // Las plantillas del cliente que se está viendo (para «Nueva tarea ▾»). Si todavía no existe la tabla o falla, simplemente no hay ninguna
  const idDelCliente = cliente?.id ?? null
  useEffect(() => {
    setPlantillas([])
    if (!idDelCliente) return
    let vigente = true
    void pedir<{ plantillas: PlantillaTC[] }>(`${BASE}/plantillas?clienteId=${idDelCliente}`)
      .then((r) => vigente && setPlantillas(r.plantillas))
      .catch(() => undefined)
    return () => {
      vigente = false
    }
  }, [idDelCliente])

  const usarPlantilla = useCallback(
    async (id: string) => {
      if (!idDelCliente) return
      try {
        const { tarea } = await pedir<{ tarea: TareaLigera }>(`${BASE}/plantillas/${id}/usar`, { metodo: 'POST', cuerpo: { clienteId: idDelCliente } })
        aplicarFila(tarea)
        setAbierta(tarea.id)
        toast.success('Tarea creada desde la plantilla')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'No se ha podido crear la tarea')
      }
    },
    [idDelCliente, aplicarFila]
  )

  const cambiarCliente = useCallback(
    async (cambios: Record<string, unknown>) => {
      if (!cliente) return
      const previo = cliente
      setDatos((d) => (d ? { ...d, clientes: d.clientes.map((c) => (c.id === previo.id ? ({ ...c, ...cambios } as ClienteTC) : c)) } : d))
      try {
        const { cliente: nuevo } = await pedir<{ cliente: ClienteTC }>(`${BASE}/clientes/${previo.id}`, { metodo: 'PATCH', cuerpo: cambios })
        setDatos((d) => (d ? { ...d, clientes: d.clientes.map((c) => (c.id === nuevo.id ? nuevo : c)) } : d))
      } catch (e) {
        setDatos((d) => (d ? { ...d, clientes: d.clientes.map((c) => (c.id === previo.id ? previo : c)) } : d))
        toast.error(e instanceof Error ? e.message : 'No se ha podido guardar')
      }
    },
    [cliente]
  )

  // Arrastrar una columna para cambiarla de sitio: se pinta ya y se guarda en el cliente (solo en el ERP: Notion no se entera)
  const ordenarColumnas = useCallback(
    async (nombres: string[]) => {
      if (!cliente) return
      const previo = cliente
      setDatos((d) => (d ? { ...d, clientes: d.clientes.map((c) => (c.id === previo.id ? { ...c, opciones: { ...c.opciones, orden_columnas: nombres } } : c)) } : d))
      try {
        const { cliente: nuevo } = await pedir<{ cliente: ClienteTC }>(`${BASE}/clientes/${previo.id}`, { metodo: 'PATCH', cuerpo: { orden_columnas: nombres } })
        setDatos((d) => (d ? { ...d, clientes: d.clientes.map((c) => (c.id === nuevo.id ? nuevo : c)) } : d))
      } catch (e) {
        setDatos((d) => (d ? { ...d, clientes: d.clientes.map((c) => (c.id === previo.id ? previo : c)) } : d))
        toast.error(e instanceof Error ? e.message : 'No se ha podido guardar el orden de las columnas')
      }
    },
    [cliente]
  )

  const cambiarPreferencias = useCallback(async (cambios: Partial<Preferencias>) => {
    setDatos((d) => (d ? { ...d, preferencias: { ...(d.preferencias ?? { fondo: {}, portada: {}, favoritos: [] }), ...cambios } } : d))
    try {
      await pedir(`${BASE}/preferencias`, { metodo: 'PUT', cuerpo: cambios })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se han podido guardar tus preferencias')
    }
  }, [])

  const alternarFavorito = (id: string) => void cambiarPreferencias({ favoritos: prefs.favoritos.includes(id) ? prefs.favoritos.filter((f) => f !== id) : [...prefs.favoritos, id] })

  /* ---- La tarea abierta, en la dirección ---- */
  const abrir = useCallback((id: string | null) => {
    setAbierta(id)
    try {
      const url = new URL(window.location.href)
      if (id) url.searchParams.set('tarea', id)
      else url.searchParams.delete('tarea')
      window.history.replaceState(null, '', url)
    } catch {
      /* la dirección no es imprescindible */
    }
  }, [])

  // Cerrar el panel: primero sale (0,24 s) y luego se quita; quien pide menos movimiento lo ve cerrarse al instante
  const [saliendo, setSaliendo] = useState(false)
  const temporizadorDeSalida = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cerrarPanel = useCallback(() => {
    if (!abierta || temporizadorDeSalida.current) return
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      abrir(null)
      return
    }
    setSaliendo(true)
    temporizadorDeSalida.current = setTimeout(() => {
      temporizadorDeSalida.current = null
      setSaliendo(false)
      abrir(null)
    }, 240)
  }, [abierta, abrir])
  useEffect(
    () => () => {
      if (temporizadorDeSalida.current) clearTimeout(temporizadorDeSalida.current)
    },
    []
  )

  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && abierta && !(e.target as HTMLElement | null)?.closest?.('[role="dialog"], [data-radix-popper-content-wrapper], .tc-editable, .tc-modal')) cerrarPanel()
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [abierta, cerrarPanel])

  // Cambiar de ámbito es instantáneo: se cambia el filtro y la dirección (con pushState, que Next sigue en `usePathname`) sin pasar por el servidor. Lo que no es un espacio
  // de trabajo (el inicio) sí es otra página y se abre con el router
  const irA = useCallback((nuevo: Ambito, ruta: string) => {
    setAbierta(null)
    setFiltros(FILTROS_VACIOS)
    setAmbito(nuevo)
    try {
      window.history.pushState(null, '', ruta)
    } catch {
      router.push(ruta, { scroll: false })
    }
  }, [router])

  const navegar = (ruta: string) => {
    const nuevo = ambitoDeRuta(ruta)
    if (nuevo) irA(nuevo, ruta)
    else {
      setAbierta(null)
      setFiltros(FILTROS_VACIOS)
      router.push(ruta, { scroll: false })
    }
  }

  // Atrás y adelante, o un enlace de fuera (el aviso de la campana): si la dirección es la de otro ámbito, se sigue
  const ambitoRef = useRef(ambito)
  ambitoRef.current = ambito
  useEffect(() => {
    const nuevo = ambitoDeRuta(pathname)
    if (!nuevo || mismoAmbito(ambitoRef.current, nuevo)) return
    setAbierta(null)
    setFiltros(FILTROS_VACIOS)
    setAmbito(nuevo)
  }, [pathname])
  /* ---- El buscador: Ctrl/Cmd + K, o «/» fuera de un campo ---- */
  const [buscadorAbierto, setBuscadorAbierto] = useState(false)
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const enCampo = Boolean(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setBuscadorAbierto(true)
      } else if (e.key === '/' && !enCampo && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        setBuscadorAbierto(true)
      }
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [])
  // Elegir un resultado: se abre la tarea, yendo antes a su cliente si no se está viendo (en «Mis tareas» no tiene por qué salir)
  const elegirResultado = useCallback(
    (tareaId: string, clienteId: string) => {
      if (ambito.tipo === 'mias' || (ambito.tipo === 'cliente' && ambito.id !== clienteId)) irA({ tipo: 'cliente', id: clienteId }, rutaDeAmbito({ tipo: 'cliente', id: clienteId }))
      setAbierta(tareaId)
    },
    [ambito, irA]
  )

  // Atrás y adelante también por el propio navegador: con las direcciones que cambiamos nosotros no depende de que el router se entere
  useEffect(() => {
    const alVolver = () => {
      const nuevo = ambitoDeRuta(window.location.pathname)
      if (!nuevo || mismoAmbito(ambitoRef.current, nuevo)) return
      setAbierta(null)
      setFiltros(FILTROS_VACIOS)
      setAmbito(nuevo)
    }
    window.addEventListener('popstate', alVolver)
    return () => window.removeEventListener('popstate', alVolver)
  }, [])
  // Un aviso de la campana lleva a una tarea concreta (`?tarea=`): se abre aunque ya se estuviera en ese cliente
  useEffect(() => {
    if (tareaInicial) setAbierta(tareaInicial)
  }, [tareaInicial])

  /* ---- Pintar ---- */
  if (error && !datos) {
    return (
      <div className="tc-zona flex items-center justify-center" role="alert">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <AlertTriangle className="h-6 w-6 text-[var(--ls-e-ambar)]" />
          <p className="text-[13.5px] text-[var(--ls-t2)]">{error}</p>
          <button type="button" onClick={() => void cargar(false)} className="tc-boton-primario"><RefreshCw className="h-3.5 w-3.5" /> Reintentar</button>
        </div>
      </div>
    )
  }
  if (!datos) {
    return (
      <div className="tc-zona" role="status" aria-label="Cargando las tareas">
        <aside className="tc-lateral"><div className="space-y-2 p-3">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="tc-esqueleto h-7" />)}</div></aside>
        <section className="tc-centro"><div className="tc-esqueleto h-[112px] rounded-none" /><div className="flex gap-3 p-4">{[0, 1, 2, 3].map((i) => <div key={i} className="tc-esqueleto h-72 w-[280px] shrink-0" />)}</div></section>
      </div>
    )
  }
  if (ambito.tipo === 'cliente' && !cliente) {
    return (
      <div className="tc-zona flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-[14px] text-[var(--ls-t2)]">Ese cliente no existe o está desactivado.</p>
          <button type="button" onClick={() => navegar('/dashboard/tareas-clientes/todas')} className="tc-boton-primario">Ver todas las tareas</button>
        </div>
      </div>
    )
  }

  const titulo = cliente?.nombre ?? (ambito.tipo === 'mias' ? 'Mis tareas' : 'Todas las tareas')
  const abiertaLigera = abierta ? (datos.tareas.find((t) => t.id === abierta) ?? null) : null
  const clienteDeLaAbierta = abiertaLigera ? (mapa.get(abiertaLigera.cliente_id) ?? null) : null

  // LA TAREA ABIERTA es una hoja flotante por encima del tablero (como el «vistazo lateral» de Notion): no estrecha lo de debajo, entra y sale con movimiento, y pulsar fuera la cierra
  const panel = abierta && (
    <div className="tc-panel-capa" data-saliendo={saliendo ? 'true' : undefined}>
      <div className="tc-panel-fondo" onClick={cerrarPanel} aria-hidden />
      <aside className="tc-panel" aria-label="Tarea">
        <PanelDeTarea
          key={abierta}
          tareaId={abierta}
          inicial={abiertaLigera}
          cliente={clienteDeLaAbierta}
          personas={personas}
          miId={miId}
          esAdmin={esAdmin}
          tareas={datos.tareas}
          estaHecha={(t) => estaHechaLaTarea(t, mapa)}
          onCerrar={cerrarPanel}
          onCambio={aplicarFila}
          onArchivada={(id) => {
            setDatos((d) => (d ? { ...d, tareas: d.tareas.filter((t) => t.id !== id) } : d))
            abrir(null)
            toast.success('Tarea archivada')
          }}
        />
      </aside>
    </div>
  )

  return (
    <BloqueadasContexto.Provider value={bloqueadas}>
    <div className="tc-zona" data-fondo={fondoNecesitaCortina(fondo) ? 'true' : undefined} style={{ '--tc-ambiente': cliente ? `var(--tc-${cliente.color || 'orange'})` : 'var(--ls-acc-graf)', ...(estiloDePortada(fondo, true) as CSSProperties | undefined) } as CSSProperties}>
      <FondoAnimado valor={fondo} />
      <BarraLateral onBuscar={() => setBuscadorAbierto(true)} clientes={datos.clientes} tareas={datos.tareas} ambito={ambito} miId={miId} favoritos={prefs.favoritos} colapsada={colapsada} onAlternar={() => { setColapsada(!colapsada); escribirLocal('tc-lateral', colapsada ? '0' : '1') }} onNavegar={navegar} onFavorito={alternarFavorito} />

      <section className="tc-centro" ref={setCentro}>
        <div className="tc-movil-barra"><SelectorMovil clientes={datos.clientes} ambito={ambito} onNavegar={navegar} /><button type="button" onClick={() => setBuscadorAbierto(true)} aria-label="Buscar en todo" className="tc-movil-buscar"><Search className="h-4 w-4" /></button></div>
        <Cabecera
          titulo={titulo}
          icono={cliente?.icono ?? (ambito.tipo === 'mias' ? '🎯' : '🗂️')}
          descripcion={cliente?.descripcion ?? null}
          fondo={fondo}
          editable
          vistas={vistasDisponibles}
          vista={vista}
          onVista={(v) => { setVistaElegida(v); escribirLocal('tc-vista', v) }}
          filtros={filtros}
          onFiltros={setFiltros}
          esAdmin={esAdmin}
          onCompartir={esAdmin && cliente ? () => setCompartirAbierto(true) : undefined}
          personas={personas}
          clientesParaDepartamentos={cliente ? [cliente] : datos.clientes}
          puedeAgrupar={vista === 'tabla'}
          onTitulo={cliente ? (t) => void cambiarCliente({ nombre: t }) : undefined}
          onIcono={cliente ? (e) => void cambiarCliente({ icono: e }) : undefined}
          onDescripcion={cliente ? (d) => void cambiarCliente({ descripcion: d }) : undefined}
          onFondo={(p) => (cliente ? void cambiarCliente({ fondo: p }) : void cambiarPreferencias({ fondo: p }))}
          onNueva={() => void nuevaTarea()}
          plantillas={plantillas}
          onPlantilla={(id) => void usarPlantilla(id)}
          onGestionarPlantillas={cliente ? () => setGestorAbierto(true) : undefined}
          total={delAmbito.length}
          visibles={visibles.length}
          extra={releyendo ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ls-t4)]" aria-label="Actualizando" /> : cliente?.sync_error ? <span title={cliente.sync_error} className="inline-flex items-center gap-1 text-[11.5px] text-[var(--ls-e-ambar)]"><AlertTriangle className="h-3 w-3" /> Notion con problemas</span> : null}
        />

        <div className="tc-vista" key={`${ambito.tipo}-${'id' in ambito ? ambito.id : ''}-${vista}`}>
          {vista === 'tablero' && cliente && <Tablero estados={estadosDelAmbito} departamentos={departamentosDe(cliente)} tareas={visibles} personas={personas} tareaAbierta={abierta} onAbrir={abrir} onMover={(id, e, d) => void mover(id, e, d)} onOrdenarColumnas={(n) => void ordenarColumnas(n)} seleccion={seleccion} onSeleccionar={alternarSeleccion} onCrear={async (estado, t) => void (await crear(cliente.id, estado, t))} />}
          {vista === 'tablero' && !cliente && <TableroDeVarios clientes={datos.clientes} tareas={visibles} personas={personas} abierta={abierta} onAbrir={abrir} onMover={(id, e, d) => void mover(id, e, d)} seleccion={seleccion} onSeleccionar={alternarSeleccion} />}
          {vista === 'tabla' && <Tabla tareas={visibles} clientes={mapa} personas={personas} agruparPor={cliente ? filtros.agruparPor : filtros.agruparPor === 'estado' ? 'cliente' : filtros.agruparPor} mostrarCliente={!cliente} tareaAbierta={abierta} onAbrir={abrir} onCambiar={(id, c) => void cambiar(id, c)} seleccion={seleccion} onSeleccionar={alternarSeleccion} onCrear={cliente ? async (clave, t) => void (await crear(cliente.id, filtros.agruparPor === 'estado' ? clave : null, t, filtros.agruparPor === 'departamento' && clave ? { departamento: clave } : {})) : undefined} />}
          {vista === 'cronograma' && <Cronograma tareas={visibles} clientes={mapa} tareaAbierta={abierta} onAbrir={abrir} />}
          {vista === 'calendario' && <Calendario tareas={visibles} clientes={mapa} tareaAbierta={abierta} onAbrir={abrir} onCambiar={(id, c) => void cambiar(id, c)} />}
        </div>
      </section>

      {seleccion.size > 0 && (
        <BarraDeSeleccion cantidad={seleccion.size} columnas={estadosDeLote} ocupada={lotePendiente} onMover={(e) => void aplicarLote('mover', e)} onArchivar={() => void aplicarLote('archivar')} onQuitar={() => setSeleccion(new Set())} />
      )}
      {marco && typeof document !== 'undefined' && createPortal(<div className="tc-marco" style={{ left: marco.left, top: marco.top, width: marco.right - marco.left, height: marco.bottom - marco.top }} aria-hidden />, document.body)}

      {buscadorAbierto && <BuscadorGlobal tareas={datos.tareas} clientes={datos.clientes} clienteActual={cliente} onElegirTarea={elegirResultado} onElegirCliente={(id) => irA({ tipo: 'cliente', id }, rutaDeAmbito({ tipo: 'cliente', id }))} onCerrar={() => setBuscadorAbierto(false)} />}

      {gestorAbierto && cliente && <PlantillasGestor cliente={cliente} personas={personas} onCerrar={() => setGestorAbierto(false)} onCambio={setPlantillas} onCreada={(t) => { aplicarFila(t); setAbierta(t.id) }} />}

      {compartirAbierto && esAdmin && cliente && <CompartirConElCliente clienteId={cliente.id} clienteNombre={cliente.nombre} onCerrar={() => setCompartirAbierto(false)} />}

      {panel}
    </div>
    </BloqueadasContexto.Provider>
  )
}

/**
 * «Mis tareas» y «Todas» en tablero: no hay un solo cliente, así que las columnas son la unión de las de todos (cada nombre una vez, en el orden en que aparece). Una tarea
 * solo se puede mover a una columna que su cliente tenga (el servidor lo comprueba y, si no, dice cuáles tiene). Es una vista de repaso: crear tareas se hace dentro de
 * cada cliente.
 */
function TableroDeVarios({ clientes, tareas, personas, abierta, onAbrir, onMover, seleccion, onSeleccionar }: { seleccion: ReadonlySet<string>; onSeleccionar: (id: string) => void; clientes: readonly ClienteTC[]; tareas: readonly TareaLigera[]; personas: DatosDeTodas['personas']; abierta: string | null; onAbrir: (id: string) => void; onMover: (id: string, estado: string, despuesDe: string | null) => void }) {
  const { estados, departamentos } = useMemo(() => {
    const e = new Map<string, OpcionDeEstado>()
    const d = new Map<string, OpcionSimple>()
    for (const c of clientes) {
      for (const x of estadosDe(c)) if (!e.has(x.nombre)) e.set(x.nombre, x)
      for (const x of departamentosDe(c)) if (!d.has(x.nombre)) d.set(x.nombre, x)
    }
    return { estados: [...e.values()], departamentos: [...d.values()] }
  }, [clientes])
  // Con varios clientes no hay un orden «del cliente» que guardar: el que cada persona elige arrastrando se recuerda en su navegador
  const [orden, setOrden] = useState<string[]>([])
  useEffect(() => {
    try {
      const guardado = JSON.parse(leerLocal('tc-orden-columnas-global') ?? '[]')
      if (Array.isArray(guardado)) setOrden(guardado.filter((x): x is string => typeof x === 'string'))
    } catch {
      /* sin orden guardado */
    }
  }, [])
  const estadosEnOrden = useMemo(() => (orden.length > 0 ? ordenarSegun(estados, orden) : estados), [estados, orden])
  return <Tablero estados={estadosEnOrden} departamentos={departamentos} tareas={tareas} personas={personas} tareaAbierta={abierta} onAbrir={onAbrir} onMover={onMover} clientes={clientes} seleccion={seleccion} onSeleccionar={onSeleccionar} onOrdenarColumnas={(n) => { setOrden(n); escribirLocal('tc-orden-columnas-global', JSON.stringify(n)) }} onCrear={() => { toast.message('Para crear una tarea, abre un cliente de la izquierda') }} />
}
