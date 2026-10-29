'use client'

import { AlertCircle, ChevronDown, Eye, KeyRound, Mail, PenSquare, Plus, Settings, ShieldCheck, Users, Workflow } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Avatar, Esqueleto } from '@/components/rendimiento/ui'
import { ponerCorreoSinLeer } from '@/lib/avisos/contadores'
import { apuntarCorreoEnLead } from '@/lib/correo/lead-cliente'
import { avisarCorreoEnviadoALead, escucharPeticiones, type PeticionAlCorreo } from '@/lib/correo/peticiones'
import { textoSinFirma } from '@/lib/correo/plantillas'
import { borradorDe, type BorradorDeCorreo, type ModoDeRedactar } from '@/lib/correo/redactar'
import type { BuzonVisible, HiloAbierto, HiloDeLista, MensajeDeHilo, RespuestaDeSincronizar, VistaDeCorreo } from '@/lib/correo/tipos'
import { enviarJson, pedir } from './api'
import { AjustesDeBuzon } from './AjustesDeBuzon'
import { ControlesDeActualizar, EtiquetaDeActualizado } from './ActualizarCorreo'
import { ConectarBuzon } from './ConectarBuzon'
import { ListaDeHilos } from './ListaDeHilos'
import { Redactar, type DetalleDeEnvio } from './Redactar'
import { BOTON_ICONO, BOTON_PRIMARIO, BOTON_SECUNDARIO, Aviso } from './ui'
import { VistaDeHilo } from './VistaDeHilo'
import { VistaEquipo } from './VistaEquipo'

/**
 * EL CORREO.
 *
 * El webmail de cada comercial dentro del ERP: su buzón de Hostinger (IMAP/SMTP) con sus conversaciones agrupadas en hilos,
 * búsqueda, y poder leer, contestar, reenviar y enviar con adjuntos. Quien supervisa (administrador, o con el permiso
 * «Supervisión del correo» o el de «Supervisión del equipo comercial») elige desde el selector qué bandeja del equipo
 * leer, en SOLO LECTURA, y cada vez que mira una queda anotado (el rastro lo lee solo un administrador: su dueño no lo ve).
 *
 *   · Al abrir un buzón y después cada 30 s (mientras la pestaña se ve y «Auto» está encendido; cada minuto si Correo está oculto), la pantalla le pide al servidor que traiga
 *     los correos nuevos de ESE buzón, sea el suyo o uno ajeno que supervisa (solo lectura), y vuelve a cargar lo que se ve. El botón de actualizar lo hace al momento, también
 *     en los buzones ajenos. Una importación grande del propio buzón se trae por tramos: la pantalla insiste mientras la respuesta diga que quedan.
 *   · Un proceso automático hace lo mismo cada minuto aunque nadie tenga la pantalla abierta.
 *   · Todo lo que se ve viene de las rutas de /api/correo, que deciden qué buzón puede abrir cada persona: la pantalla solo
 *     decide qué se pinta, nunca qué se puede.
 *
 * LA DIRECCIÓN GUARDA DÓNDE ESTÁS: ?buzon=<id>&hilo=<id>. Recargar, o compartir el enlace con quien pueda abrir ese buzón, enseña lo mismo.
 */

interface Props {
  yo: { id: string; nombre: string }
  /** Administrador, o quien tenga el permiso suelto «Supervisión del correo» o el de «Supervisión del equipo comercial» */
  puedeSupervisar: boolean
  esAdmin: boolean
  buzonInicial: string | null
  hiloInicial: string | null
  /**
   * ¿Es la aplicación que se está viendo? El correo se queda montado (oculto) mientras se trabaja en Cold Calling y se vuelve: oculto sigue
   * trayendo correo nuevo cada minuto, pero NO toca la dirección del navegador, que en ese momento es la de la otra aplicación.
   */
  activa: boolean
}

// La pantalla de Secuencias se baja la primera vez que se abre: quien no la usa no carga ni una línea de ella
const PantallaDeSecuencias = dynamic(() => import('./secuencias/PantallaDeSecuencias').then((m) => m.PantallaDeSecuencias), {
  ssr: false,
  loading: () => (
    <div className="space-y-3" aria-busy="true" aria-label="Cargando las secuencias">
      <Esqueleto className="h-24 w-full" />
      <Esqueleto className="h-52 w-full" />
    </div>
  ),
})

// «Quién ve qué» es solo para administradores: se baja la primera vez que se abre
const PermisosDeBuzones = dynamic(() => import('./PermisosDeBuzones').then((m) => m.PermisosDeBuzones), { ssr: false })

const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms))
const EN_SEGUNDO_PLANO_MS = 60_000
/** Cada cuánto se pone al día un buzón que se está mirando (con «Auto» encendido) */
const A_LA_VISTA_MS = 30_000
const CLAVE_DE_AUTO = 'correo.actualizar-solo'
const MAX_BUZONES_POR_PERSONA = 3

export function PanelCorreo({ yo, puedeSupervisar, esAdmin, buzonInicial, hiloInicial, activa }: Props) {
  const [buzones, setBuzones] = useState<BuzonVisible[] | null>(null)
  const [errorInicial, setErrorInicial] = useState<{ mensaje: string; faltaMigracion: boolean } | null>(null)
  const [cifrado, setCifrado] = useState(true)
  const [buzonId, setBuzonId] = useState<string | null>(buzonInicial)
  const [enEquipo, setEnEquipo] = useState(false)
  const [conectando, setConectando] = useState(false)
  const [selectorAbierto, setSelectorAbierto] = useState(false)
  const [ajustes, setAjustes] = useState(false)
  // «Quién ve qué»: la tabla con la que un administrador decide qué buzones lee cada persona (solo administradores)
  const [verPermisos, setVerPermisos] = useState(false)
  // Los seguimientos automáticos: si se ofrece el botón, si se está viendo la pantalla y si ya se montó (una vez montada se queda, con su pestaña y su filtro)
  const [verSecuencias, setVerSecuencias] = useState(false)
  const [enSecuencias, setEnSecuencias] = useState(false)
  const [secuenciasMontadas, setSecuenciasMontadas] = useState(false)
  // La secuencia que otra aplicación (la campana de la barra lateral) ha pedido abrir; se le entrega a la pantalla de Secuencias, que la abre y la suelta
  const [secuenciaPedida, setSecuenciaPedida] = useState<string | null>(null)

  const [vista, setVista] = useState<VistaDeCorreo>('todos')
  const [soloNoLeidos, setSoloNoLeidos] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [busquedaAplicada, setBusquedaAplicada] = useState('')
  const [hilos, setHilos] = useState<HiloDeLista[]>([])
  const [siguiente, setSiguiente] = useState<string | null>(null)
  const [cargandoLista, setCargandoLista] = useState(false)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [errorLista, setErrorLista] = useState<string | null>(null)

  const [hiloId, setHiloId] = useState<string | null>(hiloInicial)
  const [hilo, setHilo] = useState<HiloAbierto | null>(null)
  const [cargandoHilo, setCargandoHilo] = useState(false)
  const [errorHilo, setErrorHilo] = useState<string | null>(null)

  const [redactando, setRedactando] = useState<BorradorDeCorreo | null>(null)
  const [sincronizando, setSincronizando] = useState(false)
  const [importando, setImportando] = useState<{ quedan: number } | null>(null)
  // «Auto»: la pantalla pone al día lo que se mira cada 30 s. Encendido por defecto; lo que cada persona elige se recuerda en su navegador (solo una comodidad: sin él, encendido)
  const [auto, setAuto] = useState(true)
  useEffect(() => {
    try {
      if (window.localStorage.getItem(CLAVE_DE_AUTO) === '0') setAuto(false)
    } catch {
      // sin almacenamiento (ventana privada, bloqueado): se queda encendido
    }
  }, [])
  const cambiarAuto = useCallback(() => {
    const nuevo = !auto
    setAuto(nuevo)
    try {
      window.localStorage.setItem(CLAVE_DE_AUTO, nuevo ? '1' : '0')
    } catch {
      // no se pudo recordar: vale solo para esta visita
    }
  }, [auto])

  // Lo último que se ha pedido: una respuesta lenta que llega tarde no pisa a una más reciente
  const generacionLista = useRef(0)
  const generacionHilo = useRef(0)
  const paginasCargadas = useRef(1)
  const sincronizandoAhora = useRef(false)
  const raizSelector = useRef<HTMLDivElement>(null)

  const buzon = buzones?.find((b) => b.id === buzonId) ?? null
  const propios = buzones?.filter((b) => b.esMio) ?? []
  // Quien lee algún buzón ajeno supervisa, venga de donde venga ese permiso (un permiso suelto, ser administrador o un buzón que un administrador le ha abierto a mano:
  // este último el navegador no lo puede saber por su cuenta, así que se deduce de lo que el servidor ha dejado ver)
  const supervisa = puedeSupervisar || (buzones?.some((b) => !b.esMio) ?? false)
  const esMio = buzon?.esMio ?? false
  const puedeEscribir = esMio && !!buzon && buzon.conectado && !buzon.credencialesInvalidas
  const buzonRef = useRef<BuzonVisible | null>(null)
  buzonRef.current = buzon

  /* ------------------------------ los buzones ------------------------------ */

  const cargarBuzones = useCallback(async (): Promise<BuzonVisible[] | null> => {
    const r = await pedir<{ buzones: BuzonVisible[]; cifradoConfigurado: boolean }>('/api/correo/buzones')
    if (!r.ok) {
      setErrorInicial({ mensaje: r.mensaje, faltaMigracion: r.estado === 503 })
      return null
    }
    setBuzones(r.datos.buzones)
    setCifrado(r.datos.cifradoConfigurado)
    // El número que va junto a «Correo» en el menú se pone al día al momento, sin esperar a la siguiente lectura por detrás
    ponerCorreoSinLeer(r.datos.buzones.filter((b) => b.esMio).reduce((suma, b) => suma + b.resumen.hilosSinLeer, 0))
    return r.datos.buzones
  }, [])

  // La primera carga decide dónde se aterriza: el buzón pedido en la dirección, el propio, o el resumen del equipo
  useEffect(() => {
    let vivo = true
    void (async () => {
      const lista = await cargarBuzones()
      if (!vivo || !lista) return
      const pedido = buzonInicial ? lista.find((b) => b.id === buzonInicial) : null
      const mio = lista.find((b) => b.esMio)
      if (pedido) setBuzonId(pedido.id)
      else if (mio) setBuzonId(mio.id)
      else {
        setBuzonId(null)
        if (lista.length > 0) setEnEquipo(true)
      }
    })()
    return () => {
      vivo = false
    }
  }, [buzonInicial, cargarBuzones])

  // Si el buzón elegido desaparece (se ha desconectado y borrado), se vuelve a otro
  useEffect(() => {
    if (!buzones || !buzonId || buzon) return
    const otro = buzones.find((b) => b.esMio) ?? buzones[0]
    setBuzonId(otro ? otro.id : null)
    setHiloId(null)
    setHilo(null)
  }, [buzones, buzonId, buzon])

  /* ------------------------------ la lista ------------------------------ */

  const cargarLista = useCallback(
    async (modo: 'reiniciar' | 'mas' | 'silenciosa', antes: string | null = null) => {
      if (!buzonId) return
      const generacion = ++generacionLista.current
      if (modo === 'reiniciar') {
        setCargandoLista(true)
        setErrorLista(null)
      } else if (modo === 'mas') {
        setCargandoMas(true)
      }
      const p = new URLSearchParams({ buzon: buzonId, vista })
      if (soloNoLeidos) p.set('sinLeer', '1')
      if (busquedaAplicada.trim().length >= 2) p.set('q', busquedaAplicada.trim())
      if (antes) p.set('antes', antes)
      const r = await pedir<{ hilos: HiloDeLista[]; siguiente: string | null }>(`/api/correo/hilos?${p.toString()}`)
      if (generacion !== generacionLista.current) return
      setCargandoLista(false)
      setCargandoMas(false)
      if (!r.ok) {
        if (modo !== 'silenciosa') setErrorLista(r.mensaje)
        return
      }
      if (modo === 'mas') {
        paginasCargadas.current += 1
        setHilos((previos) => [...previos, ...r.datos.hilos.filter((h) => !previos.some((p2) => p2.id === h.id))])
      } else {
        paginasCargadas.current = 1
        setHilos(r.datos.hilos)
      }
      setSiguiente(r.datos.siguiente)
    },
    [buzonId, vista, soloNoLeidos, busquedaAplicada]
  )

  // Una actualización en segundo plano solo reemplaza la lista si la persona no ha bajado a páginas más antiguas
  const refrescarLista = useCallback(async () => {
    if (paginasCargadas.current === 1) await cargarLista('silenciosa')
  }, [cargarLista])
  // La lectura de correo nuevo no puede depender de los filtros de la lista (se relanzaría al pulsar uno): llama a la última versión por aquí
  const refrescarListaActual = useRef(refrescarLista)
  refrescarListaActual.current = refrescarLista

  useEffect(() => {
    const t = setTimeout(() => setBusquedaAplicada(busqueda), 350)
    return () => clearTimeout(t)
  }, [busqueda])

  useEffect(() => {
    if (!buzonId) {
      setHilos([])
      return
    }
    setHilos([])
    setSiguiente(null)
    void cargarLista('reiniciar')
  }, [buzonId, cargarLista])

  /* ------------------------------ un hilo ------------------------------ */

  const abrir = useCallback(
    async (id: string) => {
      const generacion = ++generacionHilo.current
      setHiloId(id)
      setHilo(null)
      setErrorHilo(null)
      setCargandoHilo(true)
      const r = await pedir<{ hilo: HiloAbierto; esMio: boolean }>(`/api/correo/hilos/${encodeURIComponent(id)}`)
      if (generacion !== generacionHilo.current) return
      setCargandoHilo(false)
      if (!r.ok) {
        setErrorHilo(r.mensaje)
        return
      }
      setHilo(r.datos.hilo)
      // Abrirlo es leerlo (solo en el buzón propio): se marca en el ERP y en el servidor de correo
      if (r.datos.esMio && r.datos.hilo.mensajes.some((m) => !m.leido)) {
        const m = await enviarJson(`/api/correo/hilos/${encodeURIComponent(id)}`, 'PATCH', { leido: true })
        if (m.ok && generacion === generacionHilo.current) {
          setHilos((previos) => previos.map((h) => (h.id === id ? { ...h, noLeidos: 0 } : h)))
          void cargarBuzones()
        }
      }
    },
    [cargarBuzones]
  )

  // El enlace con ?hilo= abre ese hilo en cuanto se sabe cuál es el buzón
  const hiloInicialAbierto = useRef(false)
  useEffect(() => {
    if (hiloInicialAbierto.current || !hiloInicial || !buzon) return
    hiloInicialAbierto.current = true
    void abrir(hiloInicial)
  }, [hiloInicial, buzon, abrir])

  function cerrarHilo() {
    generacionHilo.current += 1
    setHiloId(null)
    setHilo(null)
    setErrorHilo(null)
    setCargandoHilo(false)
  }

  // La dirección refleja dónde se está, y SOLO mientras esta es la aplicación que se ve: oculta, la dirección es la de otra pantalla
  useEffect(() => {
    if (!activa) return
    const url = new URL(window.location.href)
    if (buzonId) url.searchParams.set('buzon', buzonId)
    else url.searchParams.delete('buzon')
    if (hiloId) url.searchParams.set('hilo', hiloId)
    else url.searchParams.delete('hilo')
    window.history.replaceState(window.history.state, '', url)
  }, [activa, buzonId, hiloId])

  async function destacar() {
    if (!hilo) return
    const nuevo = !hilo.destacado
    setHilo({ ...hilo, destacado: nuevo })
    setHilos((previos) => previos.map((h) => (h.id === hilo.id ? { ...h, destacado: nuevo } : h)))
    const r = await enviarJson(`/api/correo/hilos/${encodeURIComponent(hilo.id)}`, 'PATCH', { destacado: nuevo })
    if (!r.ok) {
      toast.error(r.mensaje)
      setHilo((h) => (h ? { ...h, destacado: !nuevo } : h))
      setHilos((previos) => previos.map((h) => (h.id === hilo.id ? { ...h, destacado: !nuevo } : h)))
    }
  }

  async function marcarNoLeido() {
    if (!hilo) return
    const r = await enviarJson(`/api/correo/hilos/${encodeURIComponent(hilo.id)}`, 'PATCH', { leido: false })
    if (!r.ok) return toast.error(r.mensaje)
    toast.success('Marcado como no leído.')
    cerrarHilo()
    await Promise.all([cargarBuzones(), refrescarLista()])
  }

  /* ------------------------------ traer correo nuevo ------------------------------ */

  // Por qué se lee: 'inicio' al abrir el buzón (la lista acaba de cargarse), 'auto' por el reloj de la pantalla, 'manual' por el botón. Fuera del inicio, aunque esta lectura no traiga
  // nada también se vuelve a cargar lo que se ve: el dueño o el proceso automático pueden haber traído correo entre dos lecturas
  const sincronizar = useCallback(
    async (motivo: 'inicio' | 'auto' | 'manual') => {
      const manual = motivo === 'manual'
      const inicial = buzonRef.current
      if (!inicial || !inicial.conectado || inicial.credencialesInvalidas) return
      if (sincronizandoAhora.current) return
      sincronizandoAhora.current = true
      setSincronizando(true)
      let hubo = false
      // El dueño trae el histórico por tramos hasta acabar; quien supervisa hace UNA pasada (solo lectura) y deja el resto al dueño y al proceso automático
      const pasadas = inicial.esMio ? 400 : 1
      try {
        for (let vuelta = 0; vuelta < pasadas; vuelta += 1) {
          if (buzonRef.current?.id !== inicial.id) break // la persona ha cambiado de buzón: esta lectura ya no es la suya
          const r = await enviarJson<RespuestaDeSincronizar>('/api/correo/sincronizar', 'POST', { buzonId: inicial.id })
          if (!r.ok) {
            if (manual) toast.error(r.mensaje)
            break
          }
          const d = r.datos
          if (d.credencialesInvalidas) {
            if (manual && !inicial.esMio && d.error) toast.error(d.error)
            await cargarBuzones()
            break
          }
          if (d.ok === false) {
            if (manual && d.error) toast.error(d.error)
            await cargarBuzones()
            break
          }
          if (d.recienLeido) {
            if (manual) toast.info('Ya estaba al día.')
            break
          }
          if (d.ocupada) {
            if (!inicial.esMio) {
              if (manual) toast.info('Se está leyendo este buzón ahora mismo: en unos segundos estará al día.')
              break
            }
            // Otra lectura (el proceso automático, otra pestaña) va avanzando: se espera y se vuelve a mirar
            if (vuelta > 6) break
            await esperar(3000)
            continue
          }
          const lectura = d.lectura
          if (!lectura) break
          if (lectura.importados > 0) {
            hubo = true
            await Promise.all([cargarBuzones(), refrescarListaActual.current()])
          }
          if (lectura.completo || lectura.quedan === 0) {
            setImportando(null)
            if (manual && !hubo) toast.success('Correo al día.')
            break
          }
          setImportando({ quedan: lectura.quedan })
        }
      } finally {
        sincronizandoAhora.current = false
        setSincronizando(false)
        if (hubo) await cargarBuzones()
      }
      if (!hubo && motivo !== 'inicio') await Promise.all([cargarBuzones(), refrescarListaActual.current()])
    },
    [cargarBuzones]
  )

  // Se lee este buzón por detrás si está conectado y es mío, o si es de otra persona y esta es la pantalla que se ve (oculta no se lee el de nadie más)
  const lee = !!buzon && buzon.conectado && !buzon.credencialesInvalidas && (buzon.esMio || activa)
  const idDelQueLee = lee ? buzon?.id : null
  useEffect(() => {
    if (idDelQueLee) void sincronizar('inicio')
  }, [idDelQueLee, sincronizar])
  useEffect(() => {
    if (!idDelQueLee || !auto) return
    const intervalo = setInterval(() => {
      if (document.visibilityState === 'visible') void sincronizar('auto')
    }, activa ? A_LA_VISTA_MS : EN_SEGUNDO_PLANO_MS)
    return () => clearInterval(intervalo)
  }, [idDelQueLee, sincronizar, auto, activa])

  // El resumen del equipo no lee ningún buzón: solo se vuelve a pedir lo que ya hay guardado
  useEffect(() => {
    if (!enEquipo || !activa || !auto) return
    const intervalo = setInterval(() => {
      if (document.visibilityState === 'visible') void cargarBuzones()
    }, A_LA_VISTA_MS)
    return () => clearInterval(intervalo)
  }, [enEquipo, activa, auto, cargarBuzones])

  // El selector de buzones se cierra al pulsar fuera o con Esc
  useEffect(() => {
    if (!selectorAbierto) return
    const fuera = (e: MouseEvent) => {
      if (raizSelector.current && !raizSelector.current.contains(e.target as Node)) setSelectorAbierto(false)
    }
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && setSelectorAbierto(false)
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', tecla)
    }
  }, [selectorAbierto])

  /* ------------------------------ acciones ------------------------------ */

  function elegirBuzon(id: string) {
    setSelectorAbierto(false)
    setEnEquipo(false)
    setConectando(false)
    if (id === buzonId) return
    cerrarHilo()
    setVista('todos')
    setSoloNoLeidos(false)
    setBusqueda('')
    setBusquedaAplicada('')
    setImportando(null)
    paginasCargadas.current = 1
    setBuzonId(id)
  }

  function verEquipo() {
    setSelectorAbierto(false)
    setConectando(false)
    cerrarHilo()
    setEnEquipo(true)
  }

  function redactar(modo: ModoDeRedactar, mensaje: MensajeDeHilo | null) {
    if (!buzon || !puedeEscribir) return
    setRedactando(borradorDe(modo, mensaje, { miDireccion: buzon.direccion, firma: buzon.firma }))
  }

  /* ------------------------------ lo que piden otras aplicaciones ------------------------------ */

  // Cold Calling («escribe a este lead») y el aviso de correo nuevo («abre este correo») dejan un encargo en lib/correo/peticiones.ts y cambian
  // de aplicación sin recargar nada. Se guarda aquí y se atiende en cuanto hay buzones: si el correo se acaba de abrir por primera vez en la
  // sesión, todavía se están leyendo.
  const [peticion, setPeticion] = useState<PeticionAlCorreo | null>(null)
  useEffect(() => escucharPeticiones(setPeticion), [])

  useEffect(() => {
    if (!peticion || !buzones) return
    setPeticion(null)

    if (peticion.tipo === 'secuencia') {
      setEnEquipo(false)
      setConectando(false)
      setSecuenciaPedida(peticion.inscripcionId)
      abrirSecuencias()
      return
    }

    if (peticion.tipo === 'hilo') {
      const destino = buzones.find((b) => b.id === peticion.buzonId)
      if (!destino) return
      setEnEquipo(false)
      setConectando(false)
      setEnSecuencias(false)
      if (destino.id !== buzonId) elegirBuzon(destino.id)
      void abrir(peticion.hiloId)
      return
    }

    // Escribir: siempre desde un buzón PROPIO y conectado. Sin él, la pantalla ya está enseñando cómo conectarlo
    const mio = (buzonId ? buzones.find((b) => b.id === buzonId && b.esMio && b.conectado && !b.credencialesInvalidas) : null) ?? buzones.find((b) => b.esMio && b.conectado && !b.credencialesInvalidas)
    if (!mio) {
      toast.info('Para escribir desde aquí primero conecta tu correo.')
      return
    }
    setEnEquipo(false)
    setConectando(false)
    if (mio.id !== buzonId) elegirBuzon(mio.id)
    const base = borradorDe('nuevo', null, { miDireccion: mio.direccion, firma: mio.firma })
    setRedactando({ ...base, para: peticion.para, asunto: peticion.asunto ?? '', texto: peticion.texto ?? base.texto, lead: peticion.lead ?? null, generarIa: peticion.ia === true && Boolean(peticion.lead) })
    // `elegirBuzon` y `abrir` son funciones de este mismo componente que se redefinen en cada pintado: depender de ellas relanzaría este efecto
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peticion, buzones])

  async function alEnviar(hiloEnviado: string, borrador: BorradorDeCorreo, asuntoEnviado: string, detalle: DetalleDeEnvio) {
    setRedactando(null)
    setEnSecuencias(false)
    // Un correo que sale desde la ficha de un lead se apunta solo en su historial (y sella su último contacto): el comercial no escribe nada
    if (borrador.lead) {
      const cuando = new Date().toISOString()
      void apuntarCorreoEnLead({ leadId: borrador.lead.id, userId: yo.id, asunto: asuntoEnviado, cuando, para: detalle.para, texto: textoSinFirma(detalle.texto, buzonRef.current?.firma) }).then((hecho) => {
        if (hecho) avisarCorreoEnviadoALead({ leadId: borrador.lead!.id, asunto: asuntoEnviado, cuando })
      })
    }
    await Promise.all([cargarBuzones(), refrescarLista()])
    void abrir(hiloEnviado)
  }

  function alConectar(nuevos: BuzonVisible[], id: string) {
    setBuzones(nuevos)
    setConectando(false)
    setEnEquipo(false)
    cerrarHilo()
    setBuzonId(id)
  }

  // ¿Se ofrece «Secuencias»? Un administrador siempre; el resto, con el motor en marcha. Un fallo = no se ofrece: Correo funciona igual sin ello
  const hayBuzones = buzones !== null
  useEffect(() => {
    if (!hayBuzones) return
    let vivo = true
    void pedir<{ visible?: boolean }>('/api/correo/secuencias/estado').then((r) => {
      if (vivo && r.ok) setVerSecuencias(r.datos.visible === true)
    })
    return () => {
      vivo = false
    }
  }, [hayBuzones])

  function abrirSecuencias() {
    setSecuenciasMontadas(true)
    setEnSecuencias(true)
    setSelectorAbierto(false)
  }

  /* ------------------------------ qué se pinta ------------------------------ */

  if (errorInicial) {
    return errorInicial.faltaMigracion ? (
      <Aviso titulo="Falta preparar la base de datos">
        Hay que lanzar la migración <span className="font-mono text-[var(--ls-t1)]">236_correo.sql</span> en el editor SQL de Supabase. Hasta entonces el correo no puede guardar ni leer nada.
      </Aviso>
    ) : (
      <Aviso titulo="No se ha podido abrir el correo">
        {errorInicial.mensaje}{' '}
        <button type="button" onClick={() => window.location.reload()} className="underline underline-offset-2 hover:text-[var(--ls-t1)]">
          Recargar
        </button>
      </Aviso>
    )
  }

  if (buzones === null) {
    return (
      <div className="rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4" aria-busy="true" aria-label="Cargando el correo">
        <div className="space-y-3">
          <Esqueleto className="h-8 w-64" />
          <Esqueleto className="h-14 w-full" />
          <Esqueleto className="h-14 w-full" />
          <Esqueleto className="h-14 w-full" />
        </div>
      </div>
    )
  }

  const sinBuzonPropio = propios.length === 0
  const mostrarConectar = conectando || (sinBuzonPropio && !supervisa) || (sinBuzonPropio && buzones.length === 0)

  /* Sin buzón propio y sin nadie a quien supervisar: lo primero es conectar el correo */
  if (mostrarConectar) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        {!cifrado && (
          <Aviso titulo="Falta configurar el cifrado en el servidor">
            El servidor no tiene la clave con la que se cifran las contraseñas (<span className="font-mono text-[var(--ls-t1)]">AMAZON_TOKEN_KEY</span>), así que de momento no puede guardar la de ningún buzón. Avisa a Liberty Seller.
          </Aviso>
        )}
        <ConectarBuzon nombre={yo.nombre} esAdmin={esAdmin} onConectado={alConectar} />
        {conectando && (
          <button type="button" onClick={() => setConectando(false)} className={BOTON_SECUNDARIO}>
            Volver
          </button>
        )}
      </div>
    )
  }

  const total = buzones.length
  const sinLeerEnOtros = buzones.filter((b) => b.id !== buzonId).reduce((suma, b) => suma + b.resumen.hilosSinLeer, 0)

  const selector = (
    <div ref={raizSelector} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setSelectorAbierto((v) => !v)}
        aria-expanded={selectorAbierto}
        aria-haspopup="listbox"
        disabled={total <= 1 && !supervisa && propios.length >= MAX_BUZONES_POR_PERSONA}
        className="flex h-8 max-w-full items-center gap-2 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] pl-1.5 pr-2 text-left transition-colors hover:border-[var(--ls-linea2)]"
      >
        {enEquipo ? (
          <>
            <Users className="ml-0.5 h-4 w-4 shrink-0 text-[var(--ls-acc)]" aria-hidden />
            <span className="truncate text-[12.5px] font-medium text-[var(--ls-t1)]">Resumen del equipo</span>
          </>
        ) : buzon ? (
          <>
            <Avatar id={buzon.propietario.id} nombre={buzon.propietario.nombre} tamano={22} />
            <span className="min-w-0 truncate text-[12.5px] text-[var(--ls-t1)]">
              <span className="font-medium">{buzon.esMio ? 'Mi correo' : buzon.propietario.nombre}</span>
              <span className="ml-1.5 hidden text-[var(--ls-t4)] sm:inline">{buzon.direccion}</span>
            </span>
          </>
        ) : (
          <span className="text-[12.5px] text-[var(--ls-t3)]">Elige un buzón</span>
        )}
        {sinLeerEnOtros > 0 && <span className="rounded-full bg-[var(--ls-acc-graf)] px-1.5 text-[10px] font-semibold leading-[15px] text-[var(--ls-acc-tinta)]">{sinLeerEnOtros}</span>}
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)] transition-transform ${selectorAbierto ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {selectorAbierto && (
        <div role="listbox" aria-label="Buzones" className="absolute left-0 top-full z-30 mt-1.5 max-h-[60dvh] w-[min(92vw,380px)] overflow-y-auto rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] py-1 shadow-2xl shadow-black/50">
          {propios.length > 0 && <p className="px-3 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--ls-t4)]">Mis buzones</p>}
          {propios.map((b) => (
            <ElementoDeBuzon key={b.id} b={b} activo={!enEquipo && b.id === buzonId} onElegir={() => elegirBuzon(b.id)} />
          ))}
          {buzones.some((b) => !b.esMio) && (
            <>
              <p className="px-3 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--ls-t4)]">Equipo · solo lectura</p>
              {buzones
                .filter((b) => !b.esMio)
                .map((b) => (
                  <ElementoDeBuzon key={b.id} b={b} activo={!enEquipo && b.id === buzonId} onElegir={() => elegirBuzon(b.id)} />
                ))}
            </>
          )}
          <div className="mt-1 border-t border-[var(--ls-linea)] pt-1">
            {supervisa && (
              <button type="button" onClick={verEquipo} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)]">
                <Users className="h-4 w-4 text-[var(--ls-t4)]" aria-hidden /> Resumen del equipo
              </button>
            )}
            {propios.length < MAX_BUZONES_POR_PERSONA && (
              <button
                type="button"
                onClick={() => {
                  setSelectorAbierto(false)
                  setConectando(true)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)]"
              >
                <Plus className="h-4 w-4 text-[var(--ls-t4)]" aria-hidden /> {sinBuzonPropio ? 'Conectar mi correo' : 'Conectar otro buzón'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )

  return (
    <>
      {/* Con las Secuencias a la vista la bandeja se oculta sin desmontarla (como hace el ERP con sus apps): conserva el hilo abierto, la búsqueda y el scroll */}
      <div className={`flex flex-col overflow-hidden rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] ${enSecuencias ? 'pointer-events-none invisible h-0 min-h-0 border-0' : 'h-[calc(100dvh-10.5rem)] min-h-[540px]'}`} aria-hidden={enSecuencias ? true : undefined}>
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-[var(--ls-linea)] px-3 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            {selector}
            {verSecuencias && (
              <button type="button" onClick={abrirSecuencias} className={BOTON_SECUNDARIO} title="Los seguimientos automáticos: qué sale hoy, la cola de leads y cómo va cada uno">
                <Workflow className="h-3.5 w-3.5 text-[var(--ls-acc)]" aria-hidden /> Secuencias
              </button>
            )}
            {esAdmin && (
              <button type="button" onClick={() => setVerPermisos(true)} className={BOTON_SECUNDARIO} title="Qué buzones puede leer cada persona del equipo (solo administradores)">
                <ShieldCheck className="h-3.5 w-3.5 text-[var(--ls-acc)]" aria-hidden /> Quién ve qué
              </button>
            )}
          </div>
          {!enEquipo && buzon && (
            <div className="flex min-w-0 items-center gap-1.5">
              <EtiquetaDeActualizado ultimoSyncAt={buzon.ultimoSyncAt} sincronizando={sincronizando} conectado={buzon.conectado} />
              <ControlesDeActualizar
                onActualizar={() => void sincronizar('manual')}
                actualizando={sincronizando}
                deshabilitado={!buzon.conectado || buzon.credencialesInvalidas}
                titulo={!buzon.conectado ? 'Este buzón está desconectado' : esMio ? 'Buscar correos nuevos' : 'Buscar correos nuevos en este buzón (solo lectura)'}
                auto={auto}
                onAuto={cambiarAuto}
              />
              {(esMio || esAdmin) && (
                <button type="button" onClick={() => setAjustes(true)} className={BOTON_ICONO} title="Ajustes del buzón" aria-label="Ajustes del buzón">
                  <Settings className="h-4 w-4" aria-hidden />
                </button>
              )}
              {esMio && (
                <button type="button" onClick={() => redactar('nuevo', null)} disabled={!puedeEscribir} className={BOTON_PRIMARIO}>
                  <PenSquare className="h-4 w-4" aria-hidden /> Redactar
                </button>
              )}
            </div>
          )}
          {enEquipo && (
            <div className="flex min-w-0 items-center gap-1.5">
              <ControlesDeActualizar onActualizar={() => void cargarBuzones()} titulo="Volver a cargar el resumen del equipo" auto={auto} onAuto={cambiarAuto} />
              {sinBuzonPropio && (
                <button type="button" onClick={() => setConectando(true)} className={BOTON_SECUNDARIO}>
                  <Mail className="h-3.5 w-3.5" aria-hidden /> Conectar mi correo
                </button>
              )}
            </div>
          )}
        </div>

        {enEquipo ? (
          <VistaEquipo buzones={buzones} onAbrir={elegirBuzon} />
        ) : buzon ? (
          <>
            {!esMio && (
              <p className="flex items-center gap-2 border-b border-[var(--ls-linea)] bg-[color-mix(in_srgb,var(--ls-e-ambar)_10%,transparent)] px-3 py-1.5 text-[12px] text-[var(--ls-t2)]" role="status">
                <Eye className="h-3.5 w-3.5 shrink-0 text-[var(--ls-e-ambar)]" aria-hidden />
                <span>
                  Estás mirando el buzón de <strong className="font-semibold text-[var(--ls-t1)]">{buzon.propietario.nombre}</strong> en solo lectura. Queda anotado que lo has abierto.
                </span>
              </p>
            )}
            {esMio && buzon.credencialesInvalidas && <AvisoDeContrasena onAbrir={() => setAjustes(true)} />}
            {esMio && !buzon.conectado && (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2 text-[12.5px] text-[var(--ls-t2)]">
                Este buzón está desconectado: no llegan correos nuevos ni se puede enviar. Lo ya importado sigue aquí.
                <button type="button" onClick={() => setAjustes(true)} className="font-medium text-[var(--ls-acc)] underline underline-offset-2">
                  Volver a conectarlo
                </button>
              </p>
            )}
            {esMio && buzon.conectado && !buzon.credencialesInvalidas && buzon.ultimoError && (
              <p className="flex items-center gap-2 border-b border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-1.5 text-[12px] text-[var(--ls-e-ambar)]" role="status">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden /> {buzon.ultimoError}
              </p>
            )}

            <div className="flex min-h-0 flex-1">
              <aside className={`${hiloId ? 'hidden md:flex' : 'flex'} min-h-0 w-full shrink-0 flex-col border-r border-[var(--ls-linea)] md:w-[340px] xl:w-[380px]`}>
                <ListaDeHilos
                  hilos={hilos}
                  cargando={cargandoLista}
                  cargandoMas={cargandoMas}
                  hayMas={siguiente !== null}
                  onMas={() => void cargarLista('mas', siguiente)}
                  seleccionado={hiloId}
                  onElegir={(id) => void abrir(id)}
                  vista={vista}
                  onVista={(v) => setVista(v)}
                  soloNoLeidos={soloNoLeidos}
                  onSoloNoLeidos={setSoloNoLeidos}
                  busqueda={busqueda}
                  onBusqueda={setBusqueda}
                  resumen={buzon.resumen}
                  importando={esMio ? importando : null}
                  error={errorLista}
                />
              </aside>
              <section className={`${hiloId ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0 flex-1 flex-col`}>
                <VistaDeHilo hilo={hilo} cargando={cargandoHilo} error={errorHilo} esMio={puedeEscribir} onAtras={cerrarHilo} onDestacar={() => void destacar()} onNoLeido={() => void marcarNoLeido()} onResponder={redactar} />
              </section>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-[13px] text-[var(--ls-t3)]">Elige un buzón arriba para ver sus correos.</div>
        )}
      </div>

      {secuenciasMontadas && (
        <div className={enSecuencias ? '' : 'hidden'}>
          <PantallaDeSecuencias onVolver={() => setEnSecuencias(false)} visible={activa && enSecuencias} abrirId={secuenciaPedida} onAbierta={() => setSecuenciaPedida(null)} />
        </div>
      )}

      {redactando && buzon && <Redactar buzon={buzon} yoId={yo.id} esAdmin={esAdmin} borrador={redactando} onCerrar={() => setRedactando(null)} onEnviado={(id, asunto, detalle) => void alEnviar(id, redactando, asunto, detalle)} />}
      {verPermisos && (
        <PermisosDeBuzones
          onCerrar={() => {
            setVerPermisos(false)
            // Lo que se haya abierto o cerrado cambia lo que ven los demás, no lo que ve un administrador; aun así se vuelve a leer por si cambió el selector
            void cargarBuzones()
          }}
        />
      )}
      {ajustes && buzon && (
        <AjustesDeBuzon
          buzon={buzon}
          esMio={esMio}
          verAccesos={esAdmin}
          onCambio={(nuevos) => {
            setBuzones(nuevos)
            setAjustes(false)
          }}
          onCerrar={() => setAjustes(false)}
        />
      )}
    </>
  )
}

function ElementoDeBuzon({ b, activo, onElegir }: { b: BuzonVisible; activo: boolean; onElegir: () => void }) {
  return (
    <button type="button" role="option" aria-selected={activo} onClick={onElegir} className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${activo ? 'bg-[var(--ls-sel)]' : 'hover:bg-[var(--ls-sup2)]'}`}>
      <Avatar id={b.propietario.id} nombre={b.propietario.nombre} tamano={26} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium text-[var(--ls-t1)]">{b.esMio ? 'Mi correo' : b.propietario.nombre}</span>
        <span className="block truncate text-[11.5px] text-[var(--ls-t4)]">{b.direccion}</span>
      </span>
      {(!b.conectado || b.credencialesInvalidas) && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-[var(--ls-e-ambar)]" aria-label={b.credencialesInvalidas ? 'Contraseña rechazada' : 'Desconectado'} />}
      {b.resumen.hilosSinLeer > 0 && <span className="rounded-full bg-[var(--ls-acc-graf)] px-1.5 text-[10px] font-semibold leading-[15px] text-[var(--ls-acc-tinta)]">{b.resumen.hilosSinLeer}</span>}
    </button>
  )
}

function AvisoDeContrasena({ onAbrir }: { onAbrir: () => void }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--ls-linea)] bg-[color-mix(in_srgb,var(--ls-e-ambar)_10%,transparent)] px-3 py-2 text-[12.5px] text-[var(--ls-t2)]" role="alert">
      <span className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 shrink-0 text-[var(--ls-e-ambar)]" aria-hidden /> El servidor de correo ha rechazado tu contraseña, así que no llegan correos nuevos ni puedes enviar.
      </span>
      <button type="button" onClick={onAbrir} className="font-medium text-[var(--ls-acc)] underline underline-offset-2">
        Escribirla otra vez
      </button>
    </p>
  )
}
