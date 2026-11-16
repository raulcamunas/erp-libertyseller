'use client'

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { toast } from 'sonner'
import { ponerCorreoSinLeer } from '@/lib/avisos/contadores'
import { apuntarCorreoEnLead } from '@/lib/correo/lead-cliente'
import { avisarCorreoEnviadoALead, escucharPeticiones, type PeticionAlCorreo } from '@/lib/correo/peticiones'
import { textoSinFirma } from '@/lib/correo/plantillas'
import type { CambioDePreferencia } from '@/lib/correo/preferencias'
import { borradorDe, type BorradorDeCorreo, type ModoDeRedactar } from '@/lib/correo/redactar'
import { sePuedeEnviarDesde } from '@/lib/correo/redactar-de'
import type { BuzonVisible, Carpeta, Duracion, HiloAbierto, HiloDeLista, MensajeDeHilo, RespuestaDeBuzones, RespuestaDeSincronizar } from '@/lib/correo/tipos'
import { enviarJson, pedir } from './api'
import type { DetalleDeEnvio } from './contratos'

/**
 * EL ESTADO DE CORREO (todo menos la lista, que es useBandeja).
 * ============================================================
 *   · Los buzones que se pueden leer (GET /api/correo/buzones), `sinLeerMios` (el número del menú: una sola fuente) y si la 318 está lanzada.
 *   · La carpeta abierta (Mis correos, Asignados a mí, un buzón, el resumen del equipo) y el aterrizaje: la dirección, luego «Mis correos» si
 *     hay 2 o más, luego el propio, luego el resumen. Si el buzón abierto desaparece, se vuelve a aterrizar.
 *   · El hilo abierto: abrirlo lo marca leído (si se puede responder desde su buzón), destacar optimista con vuelta atrás, no leído SIN cerrar,
 *     silencios (personales), encargar y «Hecho».
 *   · Traer correo nuevo y «Auto»: el buzón abierto cada 30 s (60 s con Correo oculto; un buzón ajeno, solo con Correo a la vista). El dueño
 *     trae el histórico por tramos (hasta 400 pasadas); quien no es el dueño, una. «Mis correos» NO sincroniza (la bandeja solo vuelve a
 *     pedir su primera página); el botón manual sí lee los buzones propios.
 *   · Lo que piden otras aplicaciones (lib/correo/peticiones.ts): `redactar` (siempre desde el buzón PROPIO), `hilo` (a «Mis correos» si
 *     su buzón está ahí) y `secuencia`.
 *   · Redactar: desde qué buzón sale y qué buzones se ofrecen en el «De:» (puedeResponder, conectado y sin la contraseña rechazada).
 */

const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms))
export const EN_SEGUNDO_PLANO_MS = 60_000
/** Cada cuánto se pone al día un buzón que se está mirando (con «Auto» encendido) */
export const A_LA_VISTA_MS = 30_000
/** Cada cuánto se vuelve a contar «Asignados a mí» con Correo a la vista */
const ASIGNADOS_MS = 120_000
export const CLAVE_DE_AUTO = 'correo.actualizar-solo'

/* ------------------------------------------------------------------ */
/* Puro (con prueba en integracion.prueba.ts)                          */
/* ------------------------------------------------------------------ */

export const misCorreosDe = (buzones: readonly BuzonVisible[]) => buzones.filter((b) => b.enMisCorreos)

/** Desde qué buzones se puede enviar ahora mismo (el «De:» de Redactar) */
export const buzonesParaEnviarDe = (buzones: readonly BuzonVisible[]) => buzones.filter(sePuedeEnviarDesde)

/**
 * A qué carpeta lleva abrir una conversación de `buzonId`: si la carpeta de ahora ya la enseña, se queda; si el buzón está en «Mis correos»
 * (y la bandeja funciona), a «Mis correos»; si no, a ese buzón.
 */
export function carpetaParaHilo(buzonId: string, buzones: readonly BuzonVisible[], bandeja: boolean, actual?: Carpeta | null): Carpeta {
  const b = buzones.find((x) => x.id === buzonId)
  if (actual?.tipo === 'buzon' && actual.buzonId === buzonId) return actual
  if (bandeja && b?.enMisCorreos) return actual?.tipo === 'mios' ? actual : { tipo: 'mios' }
  return { tipo: 'buzon', buzonId }
}

/**
 * Dónde se aterriza al abrir Correo: el buzón (y el hilo) de la dirección, luego «Mis correos» si hay 2 o más, luego el propio, luego el
 * único de «Mis correos», luego el resumen del equipo. null = no hay nada que leer (conectar).
 */
export function aterrizaje(buzones: readonly BuzonVisible[], o: { buzonPedido?: string | null; hiloPedido?: string | null; bandeja: boolean }): Carpeta | null {
  const pedido = o.buzonPedido ? buzones.find((b) => b.id === o.buzonPedido) : null
  if (pedido) return o.hiloPedido ? carpetaParaHilo(pedido.id, buzones, o.bandeja, null) : { tipo: 'buzon', buzonId: pedido.id }
  const mios = misCorreosDe(buzones)
  if (o.bandeja && mios.length >= 2) return { tipo: 'mios' }
  const propio = buzones.find((b) => b.esMio)
  if (propio) return { tipo: 'buzon', buzonId: propio.id }
  if (mios[0]) return { tipo: 'buzon', buzonId: mios[0].id }
  if (buzones.length > 0) return { tipo: 'equipo' }
  return null
}

/**
 * Desde qué buzón sale «Redactar» de la cabecera: el abierto si se puede enviar desde él, si no el del hilo abierto, si no el primero propio,
 * si no el primero desde el que se pueda. null = no se puede escribir desde ninguno.
 */
export function buzonParaRedactar(buzones: readonly BuzonVisible[], o: { carpeta: Carpeta | null; buzonDelHilo?: string | null }): BuzonVisible | null {
  const enviables = buzonesParaEnviarDe(buzones)
  if (o.carpeta?.tipo === 'buzon') {
    const id = o.carpeta.buzonId
    const abierto = enviables.find((b) => b.id === id)
    if (abierto) return abierto
  }
  if (o.buzonDelHilo) {
    const delHilo = enviables.find((b) => b.id === o.buzonDelHilo)
    if (delHilo) return delHilo
  }
  return enviables.find((b) => b.esMio) ?? enviables[0] ?? null
}

/** El buzón PROPIO y conectado para lo que piden otras aplicaciones (Cold Calling): el abierto si es propio, si no el primero propio */
export function buzonPropioParaEscribir(buzones: readonly BuzonVisible[], abiertoId: string | null): BuzonVisible | null {
  const sirve = (b: BuzonVisible) => b.esMio && b.conectado && !b.credencialesInvalidas
  return (abiertoId ? buzones.find((b) => b.id === abiertoId && sirve(b)) : undefined) ?? buzones.find(sirve) ?? null
}

/** Lo que se guarda en la dirección (?buzon=&hilo=): con un hilo abierto, su buzón y él; con un buzón abierto, el buzón; si no, nada */
export function parametrosDeDireccion(carpeta: Carpeta | null, hilo: { id: string; buzonId: string | null } | null): { buzon: string | null; hilo: string | null } {
  if (hilo && hilo.buzonId) return { buzon: hilo.buzonId, hilo: hilo.id }
  if (carpeta?.tipo === 'buzon') return { buzon: carpeta.buzonId, hilo: hilo?.id ?? null }
  return { buzon: null, hilo: null }
}

/** El origen de la lista para una carpeta (null = la carpeta no lista conversaciones) */
export function origenDeCarpeta(carpeta: Carpeta | null): { tipo: 'buzon'; buzonId: string } | { tipo: 'mios' } | { tipo: 'asignados' } | null {
  if (!carpeta) return null
  if (carpeta.tipo === 'buzon') return { tipo: 'buzon', buzonId: carpeta.buzonId }
  if (carpeta.tipo === 'mios' || carpeta.tipo === 'asignados') return { tipo: carpeta.tipo }
  return null
}

/* ------------------------------------------------------------------ */
/* El gancho                                                           */
/* ------------------------------------------------------------------ */

/** Lo que useCorreo necesita de la lista (lo pone PanelCorreo en cuanto tiene useBandeja) */
export interface ManosDeLista {
  refrescar: () => Promise<void>
  cambiarHilo: (id: string, cambio: Partial<HiloDeLista>) => void
  hilos: readonly HiloDeLista[]
}

export interface RedactandoCorreo {
  borrador: BorradorDeCorreo
  buzonId: string
}

interface Opciones {
  yo: { id: string; nombre: string }
  puedeSupervisar: boolean
  esAdmin: boolean
  buzonInicial: string | null
  hiloInicial: string | null
  activa: boolean
  /** La lista (useBandeja), por referencia para no depender de ella */
  lista: MutableRefObject<ManosDeLista | null>
  /** Se ha cambiado de carpeta: la pantalla limpia sus filtros y su búsqueda */
  alCambiarDeCarpeta?: () => void
  /** La bandeja ha dicho que falta la 318 (no se aterriza en «Mis correos») */
  bandejaRota: boolean
}

export function useCorreo({ yo, puedeSupervisar, esAdmin, buzonInicial, hiloInicial, activa, lista, alCambiarDeCarpeta, bandejaRota }: Opciones) {
  const [buzones, setBuzonesCrudo] = useState<BuzonVisible[] | null>(null)
  const [errorInicial, setErrorInicial] = useState<{ mensaje: string; faltaMigracion: boolean } | null>(null)
  const [cifrado, setCifrado] = useState(true)
  const [sinLeerMios, setSinLeerMios] = useState(0)
  const [preferenciasDisponibles, setPreferenciasDisponibles] = useState(true)
  const [carpeta, setCarpeta] = useState<Carpeta | null>(null)
  const [conectando, setConectando] = useState(false)
  const [enSecuencias, setEnSecuencias] = useState(false)
  const [secuenciasMontadas, setSecuenciasMontadas] = useState(false)
  const [secuenciaPedida, setSecuenciaPedida] = useState<string | null>(null)
  const [verSecuencias, setVerSecuencias] = useState(false)
  const [asignados, setAsignados] = useState(0)

  const bandeja = preferenciasDisponibles && !bandejaRota

  const aplicarRespuesta = useCallback((r: RespuestaDeBuzones) => {
    setBuzonesCrudo(r.buzones)
    setCifrado(r.cifradoConfigurado)
    setSinLeerMios(r.sinLeerMios ?? 0)
    setPreferenciasDisponibles(r.preferenciasDisponibles !== false)
    // El número que va junto a «Correo» en el menú, al momento (una sola fuente: sinLeerMios, sin lo silenciado)
    ponerCorreoSinLeer(r.sinLeerMios ?? 0)
  }, [])

  /** Unos buzones que llegan sin `sinLeerMios` (Ajustes, Conectar): se pintan ya y se vuelve a pedir la respuesta completa */
  const cargarBuzones = useCallback(async (): Promise<BuzonVisible[] | null> => {
    const r = await pedir<RespuestaDeBuzones>('/api/correo/buzones')
    if (!r.ok) {
      setErrorInicial((previo) => previo ?? (buzonesRef.current === null ? { mensaje: r.mensaje, faltaMigracion: r.estado === 503 } : null))
      return null
    }
    aplicarRespuesta(r.datos)
    return r.datos.buzones
  }, [aplicarRespuesta])

  const ponerBuzones = useCallback(
    (nuevos: BuzonVisible[]) => {
      setBuzonesCrudo(nuevos)
      void cargarBuzones()
    },
    [cargarBuzones]
  )

  const buzonesRef = useRef<BuzonVisible[] | null>(null)
  buzonesRef.current = buzones
  const carpetaRef = useRef<Carpeta | null>(null)
  carpetaRef.current = carpeta

  const irA = useCallback(
    (nueva: Carpeta) => {
      setConectando(false)
      setEnSecuencias(false)
      const antes = carpetaRef.current
      const igual = antes && antes.tipo === nueva.tipo && (nueva.tipo !== 'buzon' || (antes.tipo === 'buzon' && antes.buzonId === nueva.buzonId))
      if (igual) return
      setCarpeta(nueva)
      setImportando(null)
      alCambiarDeCarpeta?.()
    },
    [alCambiarDeCarpeta]
  )

  /* ------------------------------ el aterrizaje ------------------------------ */

  const aterrizado = useRef(false)
  useEffect(() => {
    let vivo = true
    void (async () => {
      const r = await pedir<RespuestaDeBuzones>('/api/correo/buzones')
      if (!vivo) return
      if (!r.ok) {
        setErrorInicial({ mensaje: r.mensaje, faltaMigracion: r.estado === 503 })
        return
      }
      aplicarRespuesta(r.datos)
      const destino = aterrizaje(r.datos.buzones, { buzonPedido: buzonInicial, hiloPedido: hiloInicial, bandeja: r.datos.preferenciasDisponibles !== false })
      setCarpeta(destino)
      aterrizado.current = true
    })()
    return () => {
      vivo = false
    }
  }, [buzonInicial, hiloInicial, aplicarRespuesta])

  // Si el buzón abierto desaparece (se ha desconectado y borrado, o ya no se puede leer), o la bandeja deja de funcionar, se vuelve a aterrizar
  useEffect(() => {
    if (!buzones || !aterrizado.current || !carpeta) return
    const desaparecido = carpeta.tipo === 'buzon' && !buzones.some((b) => b.id === carpeta.buzonId)
    const sinBandeja = (carpeta.tipo === 'mios' || carpeta.tipo === 'asignados') && !bandeja
    if (!desaparecido && !sinBandeja) return
    const otro = aterrizaje(buzones, { bandeja })
    setCarpeta(otro)
    cerrarHilo()
    // cerrarHilo es estable en la práctica (solo toca estado y refs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buzones, carpeta, bandeja])

  /* ------------------------------ el hilo ------------------------------ */

  const [hiloId, setHiloId] = useState<string | null>(hiloInicial)
  const [hilo, setHilo] = useState<HiloAbierto | null>(null)
  const [cargandoHilo, setCargandoHilo] = useState(false)
  const [errorHilo, setErrorHilo] = useState<string | null>(null)
  const generacionHilo = useRef(0)
  const hiloRef = useRef<HiloAbierto | null>(null)
  hiloRef.current = hilo

  const abrir = useCallback(
    async (id: string, o: { sinEsqueleto?: boolean } = {}) => {
      const generacion = ++generacionHilo.current
      setHiloId(id)
      if (!o.sinEsqueleto) setHilo(null)
      setErrorHilo(null)
      if (!o.sinEsqueleto) setCargandoHilo(true)
      const r = await pedir<{ hilo: HiloAbierto; esMio: boolean }>(`/api/correo/hilos/${encodeURIComponent(id)}`)
      if (generacion !== generacionHilo.current) return
      setCargandoHilo(false)
      if (!r.ok) {
        if (!o.sinEsqueleto) setErrorHilo(r.mensaje)
        return
      }
      setHilo(r.datos.hilo)
      // Abrirlo es leerlo, si se puede responder desde su buzón (el dueño o quien lo tiene asignado con respuesta): en el ERP y en el servidor de correo
      if (!o.sinEsqueleto && r.datos.hilo.puedeResponder && r.datos.hilo.mensajes.some((m) => !m.leido)) {
        const m = await enviarJson(`/api/correo/hilos/${encodeURIComponent(id)}`, 'PATCH', { leido: true })
        if (m.ok && generacion === generacionHilo.current) {
          lista.current?.cambiarHilo(id, { noLeidos: 0 })
          void cargarBuzones()
        }
      }
    },
    [cargarBuzones, lista]
  )

  // El enlace con ?hilo= abre ese hilo en cuanto se ha aterrizado
  const hiloInicialAbierto = useRef(false)
  useEffect(() => {
    if (hiloInicialAbierto.current || !hiloInicial || !carpeta) return
    hiloInicialAbierto.current = true
    void abrir(hiloInicial)
  }, [hiloInicial, carpeta, abrir])

  const cerrarHilo = useCallback(() => {
    generacionHilo.current += 1
    setHiloId(null)
    setHilo(null)
    setErrorHilo(null)
    setCargandoHilo(false)
  }, [])

  // La dirección refleja dónde se está, y SOLO mientras esta es la aplicación que se ve: oculta, la dirección es la de otra pantalla
  useEffect(() => {
    if (!activa || !aterrizado.current) return
    const p = parametrosDeDireccion(carpeta, hiloId ? { id: hiloId, buzonId: hilo?.buzonId ?? (carpeta?.tipo === 'buzon' ? carpeta.buzonId : null) } : null)
    const url = new URL(window.location.href)
    if (p.buzon) url.searchParams.set('buzon', p.buzon)
    else url.searchParams.delete('buzon')
    if (p.hilo) url.searchParams.set('hilo', p.hilo)
    else url.searchParams.delete('hilo')
    window.history.replaceState(window.history.state, '', url)
  }, [activa, carpeta, hiloId, hilo?.buzonId])

  /* ------------------------------ «Asignados a mí» ------------------------------ */

  const bandejaRef = useRef(bandeja)
  bandejaRef.current = bandeja
  const recargarAsignados = useCallback(async () => {
    if (!bandejaRef.current) return
    const r = await pedir<{ hilos: HiloDeLista[] }>('/api/correo/bandeja?carpeta=asignados&limite=100')
    if (r.ok) setAsignados(r.datos.hilos?.length ?? 0)
  }, [])
  const hayBuzones = buzones !== null
  useEffect(() => {
    if (!hayBuzones || !bandeja) return
    void recargarAsignados()
    if (!activa) return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void recargarAsignados()
    }, ASIGNADOS_MS)
    return () => clearInterval(t)
  }, [hayBuzones, bandeja, activa, recargarAsignados])

  /* ------------------------------ acciones sobre un hilo ------------------------------ */

  const patch = (id: string, cuerpo: Record<string, unknown>) => enviarJson<{ ok: true; asignacion?: unknown }>(`/api/correo/hilos/${encodeURIComponent(id)}`, 'PATCH', cuerpo)

  const destacar = useCallback(
    async (id: string, nuevo: boolean) => {
      const enHilo = hiloRef.current?.id === id
      if (enHilo) setHilo((h) => (h ? { ...h, destacado: nuevo } : h))
      lista.current?.cambiarHilo(id, { destacado: nuevo })
      const r = await patch(id, { destacado: nuevo })
      if (!r.ok) {
        toast.error(r.mensaje)
        setHilo((h) => (h && h.id === id ? { ...h, destacado: !nuevo } : h))
        lista.current?.cambiarHilo(id, { destacado: !nuevo })
      }
    },
    [lista]
  )

  /** Leído / no leído. «No leído» YA NO cierra el hilo: se queda abierto y la fila vuelve a negrita */
  const marcarLeido = useCallback(
    async (id: string, leido: boolean) => {
      const previa = lista.current?.hilos.find((h) => h.id === id)
      lista.current?.cambiarHilo(id, { noLeidos: leido ? 0 : Math.max(1, previa?.noLeidos ?? 0) })
      const r = await patch(id, { leido })
      if (!r.ok) {
        toast.error(r.mensaje)
        if (previa) lista.current?.cambiarHilo(id, { noLeidos: previa.noLeidos })
        return
      }
      if (!leido && hiloRef.current?.id === id) toast.success('Marcado como no leído.')
      void cargarBuzones()
    },
    [cargarBuzones, lista]
  )

  const silenciarHilo = useCallback(
    async (id: string, d: Duracion | 'quitar') => {
      const r = await patch(id, { silenciado: d })
      if (!r.ok) return toast.error(r.mensaje)
      const silenciado = d !== 'quitar'
      const h = hiloRef.current
      if (h?.id === id) setHilo({ ...h, silenciado: { ...h.silenciado, hilo: silenciado } })
      const remitente = h?.id === id ? h.silenciado.remitente : false
      lista.current?.cambiarHilo(id, { silenciado: silenciado || remitente })
      toast.success(silenciado ? 'Conversación silenciada: no te avisará.' : 'Vuelve a avisarte.')
      void cargarBuzones()
    },
    [cargarBuzones, lista]
  )

  const silenciarRemitente = useCallback(
    async (d: Duracion | 'quitar') => {
      const h = hiloRef.current
      if (!h) return
      const r = await patch(h.id, { silenciarRemitente: d })
      if (!r.ok) return toast.error(r.mensaje)
      const silenciado = d !== 'quitar'
      setHilo((x) => (x && x.id === h.id ? { ...x, silenciado: { ...x.silenciado, remitente: silenciado } } : x))
      toast.success(silenciado ? 'Remitente silenciado en todos los buzones que lees.' : 'Este remitente vuelve a avisarte.')
      // Afecta a más filas (todas las de ese remitente): se vuelve a pedir la primera página
      void Promise.all([cargarBuzones(), lista.current?.refrescar()])
    },
    [cargarBuzones, lista]
  )

  const hecho = useCallback(async () => {
    const h = hiloRef.current
    if (!h) return
    const r = await patch(h.id, { hecho: true })
    if (!r.ok) return toast.error(r.mensaje)
    setHilo((x) => (x && x.id === h.id ? { ...x, asignacion: null } : x))
    lista.current?.cambiarHilo(h.id, { asignadoA: null })
    toast.success('Hecho. La conversación ya no está encargada a nadie.')
    void recargarAsignados()
    if (carpetaRef.current?.tipo === 'asignados') void lista.current?.refrescar()
  }, [lista, recargarAsignados])

  const alAsignarHilo = useCallback(
    (id: string, a: { personaId: string; nombre: string; nota: string | null } | null) => {
      setHilo((x) => (x && x.id === id ? { ...x, asignacion: a ? { ...a, asignadoPor: yo.id, asignadoAt: new Date().toISOString() } : null } : x))
      lista.current?.cambiarHilo(id, { asignadoA: a ? { id: a.personaId, nombre: a.nombre } : null })
      void recargarAsignados()
      if (carpetaRef.current?.tipo === 'asignados') void lista.current?.refrescar()
    },
    [lista, recargarAsignados, yo.id]
  )

  /* ------------------------------ preferencias (Mis correos y silencio del buzón) ------------------------------ */

  const [versionDeLista, setVersionDeLista] = useState(0)

  /** Un POST /api/correo/preferencias. Rechaza con el mensaje si falla (ElegirMisCorreos se queda abierto) */
  const guardarPreferencias = useCallback(
    async (cambios: CambioDePreferencia[]) => {
      if (cambios.length === 0) return
      const r = await enviarJson<RespuestaDeBuzones>('/api/correo/preferencias', 'POST', { cambios })
      if (!r.ok) {
        if (r.estado === 503) setPreferenciasDisponibles(false)
        throw new Error(r.mensaje)
      }
      aplicarRespuesta(r.datos)
      // Lo que entra en «Mis correos» ha podido cambiar: la bandeja se vuelve a cargar entera
      if (carpetaRef.current?.tipo === 'mios') setVersionDeLista((v) => v + 1)
    },
    [aplicarRespuesta]
  )

  const silenciarBuzon = useCallback(
    async (buzonId: string, d: Duracion | 'quitar') => {
      try {
        await guardarPreferencias([{ buzonId, silencio: d }])
        toast.success(d === 'quitar' ? 'El buzón vuelve a avisarte.' : 'Buzón silenciado: no te avisará.')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'No se ha podido guardar.')
      }
    },
    [guardarPreferencias]
  )

  const alternarMisCorreos = useCallback(
    async (buzonId: string) => {
      const b = buzonesRef.current?.find((x) => x.id === buzonId)
      if (!b) return
      try {
        await guardarPreferencias([{ buzonId, enMisCorreos: !b.enMisCorreos }])
        toast.success(b.enMisCorreos ? 'Quitado de Mis correos.' : 'Añadido a Mis correos.')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'No se ha podido guardar.')
      }
    },
    [guardarPreferencias]
  )

  /* ------------------------------ traer correo nuevo ------------------------------ */

  const [sincronizando, setSincronizando] = useState(false)
  const [importando, setImportando] = useState<{ quedan: number } | null>(null)
  const sincronizandoAhora = useRef(false)

  // «Auto»: encendido por defecto; lo que cada persona elige se recuerda en su navegador (solo una comodidad: sin él, encendido)
  const [auto, setAuto] = useState(true)
  useEffect(() => {
    try {
      if (window.localStorage.getItem(CLAVE_DE_AUTO) === '0') setAuto(false)
    } catch {
      // sin almacenamiento (ventana privada, bloqueado): se queda encendido
    }
  }, [])
  const cambiarAuto = useCallback(() => {
    setAuto((antes) => {
      const nuevo = !antes
      try {
        window.localStorage.setItem(CLAVE_DE_AUTO, nuevo ? '1' : '0')
      } catch {
        // no se pudo recordar: vale solo para esta visita
      }
      return nuevo
    })
  }, [])

  const buzonAbierto = carpeta?.tipo === 'buzon' ? (buzones?.find((b) => b.id === carpeta.buzonId) ?? null) : null
  const buzonAbiertoRef = useRef<BuzonVisible | null>(null)
  buzonAbiertoRef.current = buzonAbierto

  /**
   * Lee un buzón. 'inicio' al abrirlo (la lista acaba de cargarse), 'auto' por el reloj, 'manual' por el botón. `sigue` dice si esta lectura
   * sigue siendo la que toca (la persona puede cambiar de buzón a mitad). Devuelve si ha llegado algo.
   */
  const leerBuzon = useCallback(
    async (inicial: BuzonVisible, motivo: 'inicio' | 'auto' | 'manual', sigue: () => boolean, avisos: boolean): Promise<boolean> => {
      const manual = motivo === 'manual' && avisos
      let hubo = false
      // El dueño trae el histórico por tramos hasta acabar; quien no es el dueño hace UNA pasada y deja el resto al dueño y al proceso automático
      const pasadas = inicial.esMio ? 400 : 1
      for (let vuelta = 0; vuelta < pasadas; vuelta += 1) {
        if (!sigue()) break
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
          await Promise.all([cargarBuzones(), lista.current?.refrescar()])
        }
        if (lectura.completo || lectura.quedan === 0) {
          if (sigue()) setImportando(null)
          if (manual && !hubo) toast.success('Correo al día.')
          break
        }
        if (sigue()) setImportando({ quedan: lectura.quedan })
      }
      return hubo
    },
    [cargarBuzones, lista]
  )

  const sincronizar = useCallback(
    async (motivo: 'inicio' | 'auto' | 'manual') => {
      if (sincronizandoAhora.current) return
      const c = carpetaRef.current
      const todos = buzonesRef.current ?? []
      // Un buzón abierto: ese. «Mis correos» y «Asignados a mí» SOLO con el botón: los buzones propios de Mis correos (sin multiplicar el IMAP)
      const objetivos =
        c?.tipo === 'buzon'
          ? todos.filter((b) => b.id === c.buzonId)
          : motivo === 'manual' && (c?.tipo === 'mios' || c?.tipo === 'asignados')
            ? todos.filter((b) => b.esMio && b.enMisCorreos)
            : []
      const leibles = objetivos.filter((b) => b.conectado && !b.credencialesInvalidas)
      if (leibles.length === 0) {
        if (motivo === 'manual' && c?.tipo !== 'buzon') {
          await Promise.all([cargarBuzones(), lista.current?.refrescar()])
          toast.info('Lista al día.')
        }
        return
      }
      sincronizandoAhora.current = true
      setSincronizando(true)
      let hubo = false
      try {
        for (const b of leibles) {
          const deEste = c?.tipo === 'buzon'
          const sigue = () => (deEste ? buzonAbiertoRef.current?.id === b.id : carpetaRef.current?.tipo === c?.tipo)
          if (await leerBuzon(b, motivo, sigue, leibles.length === 1)) hubo = true
        }
      } finally {
        sincronizandoAhora.current = false
        setSincronizando(false)
      }
      if (hubo) await cargarBuzones()
      // Aunque esta lectura no traiga nada se vuelve a cargar lo que se ve: el dueño o el proceso automático pueden haber traído correo entre dos lecturas
      if (!hubo && motivo !== 'inicio') await Promise.all([cargarBuzones(), lista.current?.refrescar()])
      if (motivo === 'manual' && leibles.length > 1 && !hubo) toast.success('Correo al día.')
    },
    [cargarBuzones, leerBuzon, lista]
  )

  // Se lee el buzón abierto por detrás si está conectado y quien mira es el dueño, o si es de otra persona y esta es la pantalla que se ve
  const lee = !!buzonAbierto && buzonAbierto.conectado && !buzonAbierto.credencialesInvalidas && (buzonAbierto.esMio || activa)
  const idDelQueLee = lee ? buzonAbierto?.id : null
  useEffect(() => {
    if (idDelQueLee) void sincronizar('inicio')
  }, [idDelQueLee, sincronizar])
  useEffect(() => {
    if (!idDelQueLee || !auto) return
    const intervalo = setInterval(
      () => {
        if (document.visibilityState === 'visible') void sincronizar('auto')
      },
      activa ? A_LA_VISTA_MS : EN_SEGUNDO_PLANO_MS
    )
    return () => clearInterval(intervalo)
  }, [idDelQueLee, sincronizar, auto, activa])

  // El resumen del equipo no lee ningún buzón: solo se vuelve a pedir lo que ya hay guardado
  const enEquipo = carpeta?.tipo === 'equipo'
  useEffect(() => {
    if (!enEquipo || !activa || !auto) return
    const intervalo = setInterval(() => {
      if (document.visibilityState === 'visible') void cargarBuzones()
    }, A_LA_VISTA_MS)
    return () => clearInterval(intervalo)
  }, [enEquipo, activa, auto, cargarBuzones])

  // Con «Mis correos» a la vista y Auto, los números de la barra también se ponen al día (la lista ya se sondea en useBandeja)
  const enBandeja = carpeta?.tipo === 'mios' || carpeta?.tipo === 'asignados'
  useEffect(() => {
    if (!enBandeja || !activa || !auto) return
    const intervalo = setInterval(() => {
      if (document.visibilityState === 'visible') void cargarBuzones()
    }, A_LA_VISTA_MS)
    return () => clearInterval(intervalo)
  }, [enBandeja, activa, auto, cargarBuzones])

  /* ------------------------------ redactar ------------------------------ */

  const [redactando, setRedactando] = useState<RedactandoCorreo | null>(null)

  /** Responder, a todos, reenviar (desde el buzón del hilo) o uno nuevo (desde `buzonId`, o el que toca) */
  const abrirRedactar = useCallback((modo: ModoDeRedactar, mensaje: MensajeDeHilo | null, o: { buzonId?: string | null; textoInicial?: string } = {}) => {
    const todos = buzonesRef.current ?? []
    const id = o.buzonId ?? (modo === 'nuevo' ? buzonParaRedactar(todos, { carpeta: carpetaRef.current, buzonDelHilo: hiloRef.current?.buzonId })?.id : hiloRef.current?.buzonId)
    const b = id ? todos.find((x) => x.id === id) : null
    if (!b || !sePuedeEnviarDesde(b)) {
      toast.info(modo === 'nuevo' ? 'Para escribir desde aquí primero conecta tu correo.' : 'Desde este buzón no puedes responder.')
      return
    }
    const base = borradorDe(modo, mensaje, { miDireccion: b.direccion, firma: b.firma })
    const texto = o.textoInicial && o.textoInicial.trim() ? `${o.textoInicial}${base.texto}` : base.texto
    setRedactando({ borrador: { ...base, texto }, buzonId: b.id })
  }, [])

  const cerrarRedactar = useCallback(() => setRedactando(null), [])
  const cambiarBuzonDeRedactar = useCallback((buzonId: string) => setRedactando((r) => (r ? { ...r, buzonId } : r)), [])

  /** Tras enviar (Redactar o la respuesta rápida): apuntar en el lead, recargar y abrir el hilo enviado en una carpeta que lo enseñe */
  const alEnviar = useCallback(
    async (hiloEnviado: string, asuntoEnviado: string, detalle: DetalleDeEnvio, desde: { borrador: BorradorDeCorreo | null; buzonId: string | null }) => {
      setRedactando(null)
      setEnSecuencias(false)
      const b = desde.buzonId ? buzonesRef.current?.find((x) => x.id === desde.buzonId) : null
      const lead = desde.borrador?.lead
      // Un correo que sale desde la ficha de un lead se apunta solo en su historial (y sella su último contacto): el comercial no escribe nada
      if (lead) {
        const cuando = new Date().toISOString()
        void apuntarCorreoEnLead({ leadId: lead.id, userId: yo.id, asunto: asuntoEnviado, cuando, para: detalle.para, texto: textoSinFirma(detalle.texto, b?.firma) }).then((hechoApunte) => {
          if (hechoApunte) avisarCorreoEnviadoALead({ leadId: lead.id, asunto: asuntoEnviado, cuando })
        })
      }
      if (b && carpetaRef.current) {
        const destino = carpetaParaHilo(b.id, buzonesRef.current ?? [], bandejaRef.current, carpetaRef.current)
        if (destino !== carpetaRef.current) irA(destino)
      }
      await Promise.all([cargarBuzones(), lista.current?.refrescar()])
      void abrir(hiloEnviado)
    },
    [abrir, cargarBuzones, irA, lista, yo.id]
  )

  /* ------------------------------ lo que piden otras aplicaciones ------------------------------ */

  // Cold Calling («escribe a este lead») y el aviso de correo nuevo («abre este correo») dejan un encargo y cambian de aplicación sin
  // recargar. Se guarda aquí y se atiende en cuanto hay buzones: si el correo se acaba de abrir por primera vez, todavía se están leyendo.
  const [peticion, setPeticion] = useState<PeticionAlCorreo | null>(null)
  useEffect(() => escucharPeticiones(setPeticion), [])

  const abrirSecuencias = useCallback(() => {
    setConectando(false)
    setSecuenciasMontadas(true)
    setEnSecuencias(true)
  }, [])

  useEffect(() => {
    if (!peticion || !buzones || !carpeta) return
    setPeticion(null)

    if (peticion.tipo === 'secuencia') {
      setSecuenciaPedida(peticion.inscripcionId)
      abrirSecuencias()
      return
    }

    if (peticion.tipo === 'hilo') {
      const destino = buzones.find((b) => b.id === peticion.buzonId)
      if (!destino) return
      irA(carpetaParaHilo(destino.id, buzones, bandeja, carpeta))
      setEnSecuencias(false)
      void abrir(peticion.hiloId)
      return
    }

    // Escribir: SIEMPRE desde un buzón PROPIO y conectado (nunca desde uno asignado). Sin él, el aviso
    const mio = buzonPropioParaEscribir(buzones, carpeta.tipo === 'buzon' ? carpeta.buzonId : null)
    if (!mio) {
      toast.info('Para escribir desde aquí primero conecta tu correo.')
      return
    }
    const base = borradorDe('nuevo', null, { miDireccion: mio.direccion, firma: mio.firma })
    setRedactando({
      buzonId: mio.id,
      borrador: { ...base, para: peticion.para, asunto: peticion.asunto ?? '', texto: peticion.texto ?? base.texto, lead: peticion.lead ?? null, generarIa: peticion.ia === true && Boolean(peticion.lead) },
    })
  }, [peticion, buzones, carpeta, bandeja, abrir, irA, abrirSecuencias])

  // ¿Se ofrece «Secuencias»? Un administrador siempre; el resto, con el motor en marcha. Un fallo = no se ofrece: Correo funciona igual sin ello
  useEffect(() => {
    if (!hayBuzones) return
    let vivo = true
    void pedir<{ visible?: boolean }>('/api/correo/secuencias/estado').then((r) => {
      if (vivo && r.ok) setVerSecuencias(r.datos.visible === true || esAdmin)
    })
    return () => {
      vivo = false
    }
  }, [hayBuzones, esAdmin])

  /* ------------------------------ conectar ------------------------------ */

  const alConectar = useCallback(
    (nuevos: BuzonVisible[], id: string) => {
      setBuzonesCrudo(nuevos)
      void cargarBuzones()
      cerrarHilo()
      setConectando(false)
      setEnSecuencias(false)
      setCarpeta({ tipo: 'buzon', buzonId: id })
      alCambiarDeCarpeta?.()
    },
    [alCambiarDeCarpeta, cargarBuzones, cerrarHilo]
  )

  // Quien lee algún buzón ajeno supervisa, venga de donde venga ese permiso (un permiso suelto, ser administrador, un buzón abierto a mano o
  // asignado: este último el navegador no lo puede saber por su cuenta, así que se deduce de lo que el servidor ha dejado ver)
  const supervisa = puedeSupervisar || (buzones?.some((b) => !b.esMio) ?? false)

  return {
    buzones,
    errorInicial,
    cifrado,
    sinLeerMios,
    preferenciasDisponibles,
    bandeja,
    carpeta,
    irA,
    supervisa,
    conectando,
    setConectando,
    // secuencias
    verSecuencias,
    enSecuencias,
    secuenciasMontadas,
    secuenciaPedida,
    soltarSecuenciaPedida: () => setSecuenciaPedida(null),
    abrirSecuencias,
    cerrarSecuencias: () => setEnSecuencias(false),
    // buzones
    cargarBuzones,
    ponerBuzones,
    buzonAbierto,
    guardarPreferencias,
    silenciarBuzon,
    alternarMisCorreos,
    versionDeLista,
    // asignados
    asignados,
    setAsignados,
    recargarAsignados,
    // hilo
    hiloId,
    hilo,
    cargandoHilo,
    errorHilo,
    abrir,
    cerrarHilo,
    destacar,
    marcarLeido,
    silenciarHilo,
    silenciarRemitente,
    hecho,
    alAsignarHilo,
    // sincronizar
    sincronizando,
    importando,
    auto,
    cambiarAuto,
    actualizar: () => void sincronizar('manual'),
    // redactar
    redactando,
    abrirRedactar,
    cerrarRedactar,
    cambiarBuzonDeRedactar,
    alEnviar,
    alConectar,
  }
}

export type EstadoDeCorreo = ReturnType<typeof useCorreo>
