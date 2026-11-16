'use client'

import { MotionConfig, useAnimate, useReducedMotion } from 'framer-motion'
import { AlertCircle, ArrowLeft, Eye, HelpCircle, KeyRound, Mail, PenSquare, Search, UserCheck, X, Zap } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { Boton, Esqueleto, FOCO } from '@/components/ui-ls'
import { direccionCorta } from '@/lib/correo/marcas'
import type { ModoDeRedactar } from '@/lib/correo/redactar'
import type { BuzonVisible, Carpeta, MensajeDeHilo, VistaDeCorreo } from '@/lib/correo/tipos'
import { cn } from '@/lib/utils'
import { ControlesDeActualizar, EtiquetaDeActualizado } from './ActualizarCorreo'
import { AjustesDeBuzon, type PestanaDeAjustes } from './AjustesDeBuzon'
import { AsignarHilo } from './AsignarHilo'
import { AyudaDeAtajos } from './AyudaDeAtajos'
import { AVISO_FALTA_318, BarraDeBuzones } from './BarraDeBuzones'
import { ConectarBuzon } from './ConectarBuzon'
import type { ModoDeLista, VarianteDeBarra } from './contratos'
import { ElegirMisCorreos } from './ElegirMisCorreos'
import { EquipoYPermisos } from './EquipoYPermisos'
import { filtrarEnCliente } from './lista-de-hilos'
import { ListaDeHilos } from './ListaDeHilos'
import { Redactar } from './Redactar'
import { Aviso } from './ui'
import { useAtajosDeCorreo } from './useAtajosDeCorreo'
import { useBandeja } from './useBandeja'
import { buzonesParaEnviarDe, buzonParaRedactar, origenDeCarpeta, useCorreo, type ManosDeLista } from './useCorreo'
import { mensajeAlQueContestar, VistaDeHilo } from './VistaDeHilo'
import { VistaEquipo } from './VistaEquipo'

/**
 * EL CORREO (rediseño «Correo Pro», spec 1.2 a 1.7). ORQUESTADOR: no pide nada por su cuenta. El estado vive en useCorreo (buzones, carpeta,
 * hilo, sincronizar, peticiones de otras apps, supervisión) y useBandeja (la lista: páginas, cursor, búsqueda y fusión de la primera página).
 *
 *   · Ordenador (lg): tres columnas de altura fija con scroll propio: barra de buzones (248 px), lista (380 px) y el hilo, bajo una cabecera de
 *     56 px con el buscador, «Actualizado hace…», la chuleta de atajos y Redactar (el único botón primario).
 *   · Tableta (md): la barra se queda en un carril de iconos de 64 px y lista e hilo se reparten 40/60, también de altura fija desde md.
 *   · Móvil: una columna por niveles (Carpetas → Lista → Hilo), SIN altura fija (hace scroll la página, por eso las cabeceras `sticky`) y con
 *     el contenedor `overflow-x-clip` (nunca `overflow-hidden`, que rompería los sticky). Se cambia de nivel con un estado y un deslizamiento.
 *   · Secuencias ocupa las columnas 2 y 3 (en el móvil, un nivel más) y, una vez montada, se queda montada.
 *   · Redactar va SIEMPRE por portal a document.body: un `transform` de framer-motion en un nivel no lo vuelve relativo a ese nivel.
 *
 * Lo que decide ESCRIBIR (responder, marcar, destacar, redactar) es `puedeResponder`; `esMio` solo para configurar el buzón y las secuencias.
 * Todo lo que se ve viene de /api/correo, que decide qué puede cada persona: esta pantalla solo decide qué se pinta, nunca qué se puede.
 */

interface Props {
  yo: { id: string; nombre: string }
  /** Administrador, o quien tenga el permiso suelto «Supervisión del correo» o el de «Supervisión del equipo comercial» */
  puedeSupervisar: boolean
  esAdmin: boolean
  buzonInicial: string | null
  hiloInicial: string | null
  /** ¿Es la aplicación que se está viendo? Oculta sigue trayendo correo, pero no toca la dirección ni atiende atajos */
  activa: boolean
}

// La pantalla de Secuencias se baja la primera vez que se abre: quien no la usa no carga ni una línea de ella
const PantallaDeSecuencias = dynamic(() => import('./secuencias/PantallaDeSecuencias').then((m) => m.PantallaDeSecuencias), {
  ssr: false,
  loading: () => (
    <div className="space-y-3 p-4" aria-busy="true" aria-label="Cargando las secuencias">
      <Esqueleto className="h-24 w-full" />
      <Esqueleto className="h-52 w-full" />
    </div>
  ),
})

const MAX_BUZONES_POR_PERSONA = 3

type Ancho = 'movil' | 'tableta' | 'escritorio'
type NivelMovil = 'carpetas' | 'lista' | 'hilo'

function anchoAhora(): Ancho {
  if (typeof window === 'undefined' || !window.matchMedia) return 'escritorio'
  if (window.matchMedia('(min-width: 1024px)').matches) return 'escritorio'
  if (window.matchMedia('(min-width: 768px)').matches) return 'tableta'
  return 'movil'
}

/**
 * Por debajo de esto la caja de Correo no da para tres columnas (248 + 380 + un hilo legible) y se pinta como en la tableta (carril de 64 px
 * y lista/hilo al 40/60), aunque la pantalla sea de ordenador: con la barra lateral del ERP abierta, en un portátil de 1280 px a la caja le
 * quedan ~960 px y el hilo se quedaba en 330.
 */
export const ANCHO_MINIMO_DE_TRES_COLUMNAS = 1040

/**
 * En qué ancho estamos: móvil (< 768 px de pantalla), tableta, o escritorio (≥ 1024 px de pantalla Y la caja de Correo con sitio para las tres
 * columnas). Devuelve también la ref que hay que poner en la caja para medirla.
 */
function useAncho(): { ancho: Ancho; refCaja: (el: HTMLDivElement | null) => void } {
  const [pantalla, setPantalla] = useState<Ancho>(anchoAhora)
  const [caja, setCaja] = useState<number | null>(null)
  useEffect(() => {
    if (!window.matchMedia) return
    const md = window.matchMedia('(min-width: 768px)')
    const lg = window.matchMedia('(min-width: 1024px)')
    const leer = () => setPantalla(anchoAhora())
    md.addEventListener?.('change', leer)
    lg.addEventListener?.('change', leer)
    return () => {
      md.removeEventListener?.('change', leer)
      lg.removeEventListener?.('change', leer)
    }
  }, [])
  const observador = useRef<ResizeObserver | null>(null)
  const refCaja = useCallback((el: HTMLDivElement | null) => {
    observador.current?.disconnect()
    observador.current = null
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entradas) => {
      const w = entradas[0]?.contentRect.width ?? 0
      // Oculta (Correo montado detrás de otra app) conserva su anchura; 0 sería un salto en falso
      if (w > 0) setCaja(Math.round(w))
    })
    ro.observe(el)
    observador.current = ro
  }, [])
  const ancho: Ancho = pantalla === 'escritorio' && caja !== null && caja < ANCHO_MINIMO_DE_TRES_COLUMNAS ? 'tableta' : pantalla
  return { ancho, refCaja }
}

const modoDeCarpeta = (c: Carpeta | null): ModoDeLista => (c?.tipo === 'mios' ? 'mios' : c?.tipo === 'asignados' ? 'asignados' : 'buzon')

const nombreDeCarpeta = (c: Carpeta | null, b: BuzonVisible | null): string =>
  c?.tipo === 'mios' ? 'Mis correos' : c?.tipo === 'asignados' ? 'Asignados a mí' : c?.tipo === 'equipo' ? 'Resumen del equipo' : b ? direccionCorta(b.direccion) : 'Correo'

export function PanelCorreo({ yo, puedeSupervisar, esAdmin, buzonInicial, hiloInicial, activa }: Props) {
  const { ancho, refCaja } = useAncho()
  const movil = ancho === 'movil'

  /* ---------- Filtros de la lista (se limpian al cambiar de carpeta) ---------- */
  const [vista, setVista] = useState<VistaDeCorreo>('todos')
  const [soloNoLeidos, setSoloNoLeidos] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [ocultarSilenciados, setOcultarSilenciados] = useState(false)
  const limpiarFiltros = useCallback(() => {
    setVista('todos')
    setSoloNoLeidos(false)
    setBusqueda('')
    setOcultarSilenciados(false)
  }, [])

  /* ---------- El estado ---------- */
  const manos = useRef<ManosDeLista | null>(null)
  const [bandejaRota, setBandejaRota] = useState(false)
  // La banda «Falta lanzar la migración 318…»: sale al intentar algo que la necesita (Mis correos, Asignados) o si la bandeja la pide
  const [aviso318, setAviso318] = useState(false)
  const c = useCorreo({ yo, puedeSupervisar, esAdmin, buzonInicial, hiloInicial, activa, lista: manos, alCambiarDeCarpeta: limpiarFiltros, bandejaRota })
  const { buzones, carpeta } = c

  const lista = useBandeja({
    origen: c.conectando || c.enSecuencias ? null : origenDeCarpeta(carpeta),
    vista,
    soloNoLeidos,
    busqueda,
    ocultarSilenciados,
    sondear: activa && c.auto,
    version: c.versionDeLista,
  })
  manos.current = { refrescar: lista.refrescar, cambiarHilo: lista.cambiarHilo, hilos: lista.hilos }

  // Sin la 318 la bandeja contesta 503: se cae a la vista por buzón (useCorreo vuelve a aterrizar) y se enseña la banda
  useEffect(() => {
    if (lista.falta318) {
      setBandejaRota(true)
      setAviso318(true)
    }
  }, [lista.falta318])

  // Y se vuelve a encender sola: si una lectura de los buzones POSTERIOR a la caída dice que la 318 está (preferenciasDisponibles), la bandeja
  // vuelve. Sin esto, la bandeja apagada no se recuperaba hasta recargar la página.
  const { preferenciasDisponibles } = c
  const buzonesAlRomperse = useRef<typeof buzones | undefined>(undefined)
  useEffect(() => {
    if (!bandejaRota) {
      buzonesAlRomperse.current = undefined
      return
    }
    if (buzonesAlRomperse.current === undefined) {
      buzonesAlRomperse.current = buzones
      return
    }
    if (buzones !== buzonesAlRomperse.current && preferenciasDisponibles) {
      setBandejaRota(false)
      setAviso318(false)
    }
  }, [bandejaRota, preferenciasDisponibles, buzones])

  // En «Asignados a mí» la lista ya dice cuántas hay: el número de la barra se pone al día sin pedir nada más
  const { setAsignados } = c
  useEffect(() => {
    if (carpeta?.tipo === 'asignados' && !lista.cargando && !lista.error && lista.busquedaAplicada === '') setAsignados(lista.hilos.length)
  }, [carpeta?.tipo, lista.cargando, lista.error, lista.hilos.length, lista.busquedaAplicada, setAsignados])

  const buzonesPorId = useMemo(() => new Map((buzones ?? []).map((b) => [b.id, b])), [buzones])
  const buzonAbierto = c.buzonAbierto
  const buzonDelHilo = c.hilo ? (buzonesPorId.get(c.hilo.buzonId) ?? null) : buzonAbierto
  const puedeResponderHilo = !!c.hilo && (c.hilo.puedeResponder || !!buzonDelHilo?.puedeResponder)
  const paraRedactar = buzones ? buzonParaRedactar(buzones, { carpeta, buzonDelHilo: c.hilo?.buzonId ?? null }) : null
  const buzonesParaEnviar = useMemo(() => (buzones ? buzonesParaEnviarDe(buzones) : []), [buzones])
  const modo = modoDeCarpeta(carpeta)
  const listando = !!origenDeCarpeta(carpeta) && !c.conectando && !c.enSecuencias

  /* ---------- Paneles ---------- */
  const [ajustes, setAjustes] = useState<{ buzonId: string; pestana: PestanaDeAjustes } | null>(null)
  const [elegir, setElegir] = useState(false)
  const [equipoYPermisos, setEquipoYPermisos] = useState(false)
  const [ayuda, setAyuda] = useState(false)
  const [asignando, setAsignando] = useState<{ hiloId: string; buzonId: string; actual: { personaId: string; nombre: string } | null } | null>(null)
  const panelAbierto = !!ajustes || elegir || equipoYPermisos || ayuda || !!asignando || !!c.redactando

  /* ---------- Niveles del móvil ---------- */
  const [nivel, setNivel] = useState<NivelMovil>('lista')
  const scrollDeLista = useRef(0)
  const nivelAnterior = useRef<NivelMovil>('lista')
  const [ambito, animar] = useAnimate<HTMLDivElement>()
  const reducir = useReducedMotion()

  const irANivel = useCallback((n: NivelMovil) => {
    setNivel((antes) => {
      if (antes === 'lista' && n !== 'lista' && typeof window !== 'undefined') scrollDeLista.current = window.scrollY
      return n
    })
  }, [])

  // Abrir una conversación en el móvil la pone a la vista; cerrarla vuelve a la lista
  useEffect(() => {
    if (c.hiloId) irANivel('hilo')
    else setNivel((n) => (n === 'hilo' ? 'lista' : n))
  }, [c.hiloId, irANivel])

  // El deslizamiento de 8 px con fundido (180 ms) y el scroll de la página: arriba en cada nivel, y donde estaba al volver a la lista
  useEffect(() => {
    if (!movil || nivelAnterior.current === nivel) {
      nivelAnterior.current = nivel
      return
    }
    const volviendo = nivel === 'lista' && nivelAnterior.current === 'hilo'
    nivelAnterior.current = nivel
    window.scrollTo({ top: volviendo ? scrollDeLista.current : 0 })
    if (!reducir && ambito.current) void animar(ambito.current, { opacity: [0, 1], x: [volviendo || nivel === 'carpetas' ? -8 : 8, 0] }, { duration: 0.18, ease: 'easeOut' })
  }, [nivel, movil, reducir, animar, ambito])

  /* ---------- Acciones de la pantalla ---------- */
  const abrirCarpeta = useCallback(
    (destino: Carpeta) => {
      if ((destino.tipo === 'mios' || destino.tipo === 'asignados') && !c.bandeja) {
        // Sin la 318 no hay bandeja: se queda en el buzón abierto y se dice por qué (en el móvil, en la lista, que es donde sale la banda)
        setAviso318(true)
        irANivel('lista')
        return
      }
      if (destino.tipo === 'secuencias') {
        c.abrirSecuencias()
        irANivel('lista')
        return
      }
      c.cerrarHilo()
      c.irA(destino)
      irANivel('lista')
    },
    // c cambia en cada pintado; lo que se usa de él es estable
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c.abrirSecuencias, c.cerrarHilo, c.irA, c.bandeja, irANivel]
  )

  const conectar = () => {
    const propios = buzones?.filter((b) => b.esMio).length ?? 0
    if (propios >= MAX_BUZONES_POR_PERSONA) {
      toast.info(`Cada persona puede conectar hasta ${MAX_BUZONES_POR_PERSONA} buzones.`)
      return
    }
    c.cerrarHilo()
    c.setConectando(true)
    irANivel('lista')
  }

  const redactarNuevo = () => c.abrirRedactar('nuevo', null, { buzonId: paraRedactar?.id ?? null })
  const responder = (m: ModoDeRedactar, mensaje: MensajeDeHilo, textoInicial?: string) => c.abrirRedactar(m, mensaje, { textoInicial })
  const abrirAsignar = (hiloId: string) => {
    const enLista = lista.hilos.find((h) => h.id === hiloId)
    const abierto = c.hilo?.id === hiloId ? c.hilo : null
    const buzonId = abierto?.buzonId ?? enLista?.buzonId
    if (!buzonId) return
    const actual = abierto?.asignacion ? { personaId: abierto.asignacion.personaId, nombre: abierto.asignacion.nombre } : enLista?.asignadoA ? { personaId: enLista.asignadoA.id, nombre: enLista.asignadoA.nombre } : null
    setAsignando({ hiloId, buzonId, actual })
  }

  /* ---------- Atajos de teclado ---------- */
  const visibles = useMemo(
    () => filtrarEnCliente(lista.hilos, { busqueda: lista.busquedaAplicada, vista, soloNoLeidos, ocultarSilenciados, modo, seleccionado: c.hiloId }),
    [lista.hilos, lista.busquedaAplicada, vista, soloNoLeidos, ocultarSilenciados, modo, c.hiloId]
  )
  const [marcado, setMarcado] = useState<string | null>(null)
  const mover = (paso: 1 | -1) => {
    if (visibles.length === 0) return
    const actual = c.hiloId ?? marcado
    const i = actual ? visibles.findIndex((h) => h.id === actual) : -1
    const siguiente = visibles[Math.min(visibles.length - 1, Math.max(0, i === -1 ? 0 : i + paso))]
    if (!siguiente) return
    if (movil) setMarcado(siguiente.id)
    else void c.abrir(siguiente.id)
  }
  const objetivo = c.hilo ? mensajeAlQueContestar(c.hilo.mensajes) : null
  const enfocarBuscador = () => {
    const campos = Array.from(document.querySelectorAll<HTMLInputElement>('[data-buscador-correo]'))
    const visible = campos.find((e) => e.offsetParent !== null)
    visible?.focus()
    visible?.select()
  }
  useAtajosDeCorreo({
    activa: activa && !panelAbierto && !!buzones,
    puedeResponder: puedeResponderHilo,
    hiloAbierto: !!c.hilo,
    manejadores: {
      siguiente: () => mover(1),
      anterior: () => mover(-1),
      abrir: () => {
        if (marcado) void c.abrir(marcado)
      },
      volver: () => {
        if (c.hiloId) c.cerrarHilo()
        else if (movil && nivel === 'lista') irANivel('carpetas')
      },
      redactar: paraRedactar ? redactarNuevo : undefined,
      responder: objetivo && puedeResponderHilo ? () => responder('responder', objetivo) : undefined,
      'responder-todos': objetivo && puedeResponderHilo ? () => responder('responder-todos', objetivo) : undefined,
      reenviar: objetivo && puedeResponderHilo ? () => responder('reenviar', objetivo) : undefined,
      destacar: c.hilo && puedeResponderHilo ? () => void c.destacar(c.hilo!.id, !c.hilo!.destacado) : undefined,
      'no-leido': c.hilo && puedeResponderHilo ? () => void c.marcarLeido(c.hilo!.id, false) : undefined,
      silenciar: c.hilo && c.preferenciasDisponibles ? () => void c.silenciarHilo(c.hilo!.id, c.hilo!.silenciado.hilo ? 'quitar' : 'siempre') : undefined,
      buscar: listando ? enfocarBuscador : undefined,
      'ir-mis-correos': c.bandeja ? () => abrirCarpeta({ tipo: 'mios' }) : undefined,
      'ir-asignados': c.bandeja && c.asignados > 0 ? () => abrirCarpeta({ tipo: 'asignados' }) : undefined,
      ayuda: () => setAyuda(true),
    },
  })

  /* ------------------------------ qué se pinta ------------------------------ */

  if (c.errorInicial) {
    return c.errorInicial.faltaMigracion ? (
      <Aviso titulo="Falta preparar la base de datos">
        Hay que lanzar la migración <span className="font-mono text-[var(--ls-t1)]">236_correo.sql</span> en el editor SQL de Supabase. Hasta entonces el correo no puede guardar ni leer nada.
      </Aviso>
    ) : (
      <Aviso titulo="No se ha podido abrir el correo">
        {c.errorInicial.mensaje}{' '}
        <button type="button" onClick={() => window.location.reload()} className="underline underline-offset-2 hover:text-[var(--ls-t1)]">
          Recargar
        </button>
      </Aviso>
    )
  }

  if (buzones === null) return <EsqueletoDeCorreo />

  const sinBuzonPropio = !buzones.some((b) => b.esMio)
  /* Sin buzón propio y sin nadie a quien supervisar: lo primero es conectar el correo, en una tarjeta centrada */
  if (buzones.length === 0 || (sinBuzonPropio && !c.supervisa && !carpeta)) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 px-2 py-6 md:py-10">
        <AvisoDeCifrado visible={!c.cifrado} />
        <ConectarBuzon nombre={yo.nombre} esAdmin={esAdmin} cifradoConfigurado={c.cifrado} onConectado={c.alConectar} />
      </div>
    )
  }

  /* ---------- Piezas ---------- */

  const barra = (variante: VarianteDeBarra) => (
    <BarraDeBuzones
      variante={variante}
      buzones={buzones}
      carpeta={c.enSecuencias ? { tipo: 'secuencias' } : (carpeta ?? { tipo: 'equipo' })}
      onCarpeta={abrirCarpeta}
      sinLeerAsignados={c.asignados}
      sinLeerMios={c.sinLeerMios}
      supervisa={c.supervisa}
      esAdmin={esAdmin}
      verSecuencias={c.verSecuencias}
      onElegir={() => setElegir(true)}
      onSilenciar={(id, d) => void c.silenciarBuzon(id, d)}
      onAlternarMisCorreos={(id) => void c.alternarMisCorreos(id)}
      onAjustes={(id) => setAjustes({ buzonId: id, pestana: 'general' })}
      onConectar={conectar}
      onResumen={() => abrirCarpeta({ tipo: 'equipo' })}
      onEquipoYPermisos={() => setEquipoYPermisos(true)}
      preferenciasDisponibles={c.bandeja}
      vista={carpeta?.tipo === 'mios' ? vista : undefined}
      onVista={
        c.bandeja
          ? (v) => {
              setVista(v)
              setSoloNoLeidos(false)
            }
          : undefined
      }
      onRedactar={variante === 'movil' && paraRedactar ? redactarNuevo : undefined}
    />
  )

  const bandas = (
    <>
      {aviso318 && !c.bandeja && (
        <Banda
          tono="ambar"
          icono={AlertCircle}
          accion={
            <button type="button" onClick={() => setAviso318(false)} aria-label="Cerrar el aviso" className={cn('inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)]', FOCO)}>
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          }
        >
          {AVISO_FALTA_318}. Mientras, cada buzón se abre por separado.
        </Banda>
      )}
      {carpeta?.tipo === 'buzon' && buzonAbierto && <BandasDelBuzon buzon={buzonAbierto} esAdmin={esAdmin} onAjustes={(pestana) => setAjustes({ buzonId: buzonAbierto.id, pestana })} />}
    </>
  )

  const listaDeHilos = (
    <ListaDeHilos
      hilos={lista.hilos}
      cargando={lista.cargando || (!carpeta && !c.conectando)}
      cargandoMas={lista.cargandoMas}
      hayMas={lista.hayMas}
      onCargarMas={lista.cargarMas}
      seleccionado={c.hiloId ?? marcado}
      onElegir={(id) => {
        setMarcado(null)
        void c.abrir(id)
      }}
      vista={vista}
      onVista={setVista}
      soloNoLeidos={soloNoLeidos}
      onSoloNoLeidos={setSoloNoLeidos}
      busqueda={busqueda}
      onBusqueda={setBusqueda}
      resumen={carpeta?.tipo === 'buzon' ? (buzonAbierto?.resumen ?? null) : null}
      importando={carpeta?.tipo === 'buzon' && buzonAbierto?.esMio ? c.importando : null}
      error={lista.error}
      modo={modo}
      buzonesPorId={buzonesPorId}
      onSilenciar={(id, d) => void c.silenciarHilo(id, d)}
      onAlternarLeido={(id, leido) => void c.marcarLeido(id, leido)}
      onDestacar={(id, v) => void c.destacar(id, v)}
      nuevos={lista.nuevos}
      ocultarSilenciados={ocultarSilenciados}
      onOcultarSilenciados={setOcultarSilenciados}
      onAsignar={c.bandeja ? abrirAsignar : undefined}
      esAdmin={esAdmin}
      onElegirMisCorreos={c.bandeja ? () => setElegir(true) : undefined}
      onResumen={c.supervisa ? () => abrirCarpeta({ tipo: 'equipo' }) : undefined}
      titulo={nombreDeCarpeta(carpeta, buzonAbierto)}
      onAtras={() => irANivel('carpetas')}
      onRedactar={paraRedactar ? redactarNuevo : undefined}
      sinBuscador
    />
  )

  const vistaDeHilo = (
    <VistaDeHilo
      hilo={c.hilo}
      cargando={c.cargandoHilo}
      error={c.errorHilo}
      buzon={buzonDelHilo}
      puedeResponder={puedeResponderHilo}
      esMio={puedeResponderHilo}
      yoId={yo.id}
      esAdmin={esAdmin}
      onAtras={c.cerrarHilo}
      onDestacar={() => c.hilo && void c.destacar(c.hilo.id, !c.hilo.destacado)}
      onMarcarNoLeido={() => c.hilo && void c.marcarLeido(c.hilo.id, false)}
      onSilenciarHilo={(d) => c.hilo && void c.silenciarHilo(c.hilo.id, d)}
      onSilenciarRemitente={(d) => void c.silenciarRemitente(d)}
      onAsignar={() => c.hilo && abrirAsignar(c.hilo.id)}
      onHecho={() => void c.hecho()}
      onResponder={responder}
      onRespuestaEnviada={(hiloId) => {
        void c.abrir(hiloId, { sinEsqueleto: true })
        void Promise.all([lista.refrescar(), c.cargarBuzones()])
      }}
    />
  )

  const conectarAqui = (
    <div className="mx-auto w-full max-w-2xl space-y-3 p-0 md:p-6">
      <AvisoDeCifrado visible={!c.cifrado} />
      <ConectarBuzon nombre={yo.nombre} esAdmin={esAdmin} variante="tarjeta" cifradoConfigurado={c.cifrado} onConectado={c.alConectar} onVolver={() => c.setConectando(false)} />
    </div>
  )

  const resumen = <VistaEquipo buzones={buzones} onAbrir={(id) => abrirCarpeta({ tipo: 'buzon', buzonId: id })} />

  const secuencias = c.secuenciasMontadas && (
    <div className={c.enSecuencias ? 'min-w-0 flex-1 md:min-h-0 md:overflow-y-auto md:overscroll-contain md:p-4 lg:p-5' : 'hidden'}>
      <PantallaDeSecuencias onVolver={c.cerrarSecuencias} visible={activa && c.enSecuencias} abrirId={c.secuenciaPedida} onAbierta={c.soltarSecuenciaPedida} />
    </div>
  )

  const redactar =
    c.redactando &&
    typeof document !== 'undefined' &&
    (() => {
      const r = c.redactando
      const b = buzonesPorId.get(r.buzonId)
      if (!b) return null
      return createPortal(
        <Redactar
          buzon={b}
          yoId={yo.id}
          esAdmin={esAdmin}
          borrador={r.borrador}
          onCerrar={c.cerrarRedactar}
          onEnviado={(id, asunto, detalle) => void c.alEnviar(id, asunto, detalle, { borrador: r.borrador, buzonId: r.buzonId })}
          buzonesParaEnviar={buzonesParaEnviar}
          onCambiarBuzon={c.cambiarBuzonDeRedactar}
        />,
        document.body
      )
    })()

  const ajustesDe = ajustes ? buzonesPorId.get(ajustes.buzonId) : undefined
  const paneles = (
    <>
      {redactar}
      {ajustesDe && (
        <AjustesDeBuzon
          buzon={ajustesDe}
          esMio={ajustesDe.esMio}
          verAccesos={esAdmin}
          onCambio={(nuevos) => {
            c.ponerBuzones(nuevos)
            setAjustes(null)
          }}
          onBuzonesAlDia={c.ponerBuzones}
          onCerrar={() => setAjustes(null)}
          onEquipoYPermisos={
            esAdmin
              ? () => {
                  setAjustes(null)
                  setEquipoYPermisos(true)
                }
              : undefined
          }
          preferenciasDisponibles={c.bandeja}
          pestanaInicial={ajustes?.pestana}
        />
      )}
      <ElegirMisCorreos abierto={elegir} onCambio={setElegir} buzones={buzones} disponible={c.bandeja} onGuardar={c.guardarPreferencias} />
      {esAdmin && (
        <EquipoYPermisos
          abierto={equipoYPermisos}
          onCambio={(abierto) => {
            setEquipoYPermisos(abierto)
            // Lo que se asigne, abra o cierre cambia lo que ven los demás (y «Mis correos» de quien se lo asigne a sí mismo)
            if (!abierto) void c.cargarBuzones()
          }}
          yoId={yo.id}
        />
      )}
      <AyudaDeAtajos abierto={ayuda} onCambio={setAyuda} />
      {asignando && (
        <AsignarHilo
          abierto
          onCambio={(abierto) => !abierto && setAsignando(null)}
          hiloId={asignando.hiloId}
          buzonId={asignando.buzonId}
          actual={asignando.actual}
          yoId={yo.id}
          onAsignado={(a) => c.alAsignarHilo(asignando.hiloId, a)}
        />
      )}
    </>
  )

  /* ---------- «Actualizado hace…», el botón y Auto (en la cabecera; en el móvil, al pie de Carpetas) ---------- */
  const actualizadoDe = carpeta?.tipo === 'buzon' ? buzonAbierto : null
  const ultimoDeMisCorreos =
    carpeta?.tipo === 'mios' || carpeta?.tipo === 'asignados'
      ? (buzones
          .filter((b) => b.esMio && b.enMisCorreos && b.ultimoSyncAt)
          .map((b) => b.ultimoSyncAt as string)
          .sort()
          .pop() ?? null)
      : null
  const verActualizar = listando || carpeta?.tipo === 'equipo'


  const etiquetaDeActualizado = (clase?: string) =>
    (actualizadoDe || ultimoDeMisCorreos) && (
      <EtiquetaDeActualizado
        className={clase}
        ultimoSyncAt={actualizadoDe ? actualizadoDe.ultimoSyncAt : ultimoDeMisCorreos}
        sincronizando={c.sincronizando}
        conectado={actualizadoDe ? actualizadoDe.conectado : true}
      />
    )
  const controlesDeActualizar = (
    <ControlesDeActualizar
      onActualizar={carpeta?.tipo === 'equipo' ? () => void c.cargarBuzones() : c.actualizar}
      actualizando={c.sincronizando}
      deshabilitado={!!actualizadoDe && (!actualizadoDe.conectado || actualizadoDe.credencialesInvalidas)}
      titulo={
        carpeta?.tipo === 'equipo'
          ? 'Volver a cargar el resumen del equipo'
          : actualizadoDe
            ? !actualizadoDe.conectado
              ? 'Este buzón está desconectado'
              : actualizadoDe.puedeResponder
                ? 'Buscar correos nuevos'
                : 'Buscar correos nuevos en este buzón (solo lectura)'
            : 'Buscar correos nuevos en tus buzones'
      }
      auto={c.auto}
      onAuto={c.cambiarAuto}
    />
  )

  /* ---------- Móvil: niveles ---------- */
  if (movil) {
    const enLista = nivel === 'lista'
    return (
      <MotionConfig reducedMotion="user">
        <div ref={ambito} className="overflow-x-clip">
          {nivel === 'carpetas' && (
            <>
              {barra('movil')}
              {/* «Actualizado hace…», actualizar y Auto también en el móvil: al pie de Carpetas */}
              {verActualizar && (
                <div className="mb-6 flex items-center justify-between gap-2 rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] py-1.5 pl-3 pr-1.5">
                  <span className="min-w-0 truncate text-[12.5px] text-[var(--ls-t3)]">{etiquetaDeActualizado() || 'Correo'}</span>
                  {controlesDeActualizar}
                </div>
              )}
            </>
          )}
          <div className={enLista ? '' : 'hidden'}>
            {c.enSecuencias ? (
              <CabeceraDeNivel titulo="Secuencias" icono={Zap} onAtras={() => irANivel('carpetas')} />
            ) : c.conectando ? (
              <>
                <CabeceraDeNivel titulo={sinBuzonPropio ? 'Conectar mi correo' : 'Conectar otro buzón'} onAtras={() => c.setConectando(false)} />
                {conectarAqui}
              </>
            ) : carpeta?.tipo === 'equipo' ? (
              <>
                <CabeceraDeNivel titulo="Resumen del equipo" onAtras={() => irANivel('carpetas')} />
                {resumen}
              </>
            ) : (
              <>
                {bandas}
                {listaDeHilos}
              </>
            )}
          </div>
          {/* Secuencias: siempre en el mismo sitio, montada y oculta cuando no se ve (conserva su pestaña y su filtro) */}
          <div className={enLista && c.enSecuencias ? '' : 'hidden'}>{secuencias}</div>
          <div className={nivel === 'hilo' ? '' : 'hidden'}>{vistaDeHilo}</div>
        </div>
        {paneles}
      </MotionConfig>
    )
  }

  /* ---------- Tableta y ordenador: columnas de altura fija ---------- */
  return (
    <MotionConfig reducedMotion="user">
      {/* md: main pt-16 + Ranura p-6 (arriba y abajo) = 7rem. lg: main sin relleno + Ranura p-8 = 4rem (medido en la vista previa: sin scroll de página) */}
      <div ref={refCaja} className="flex h-[calc(100dvh-7rem)] min-h-[520px] flex-col overflow-hidden rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-[var(--ls-sombra-1)] lg:h-[calc(100dvh-4rem)]">
        {/* ---------- Cabecera de 56 px ---------- */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--ls-linea)] px-3 lg:gap-3 lg:px-4">
          <div className="flex shrink-0 items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-[var(--ls-acc-suave)] text-[var(--ls-acc)]" aria-hidden>
              <Mail className="h-[18px] w-[18px]" />
            </span>
            <h1 className="hidden text-[16px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)] lg:block">Correo</h1>
          </div>
          {listando ? (
            <BuscadorDeCabecera valor={busqueda} onCambio={setBusqueda} sitio={nombreDeCarpeta(carpeta, buzonAbierto)} />
          ) : (
            <p className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-[var(--ls-t2)]">{c.enSecuencias ? 'Secuencias' : c.conectando ? 'Conectar un buzón' : nombreDeCarpeta(carpeta, buzonAbierto)}</p>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {verActualizar && (
              <>
                {etiquetaDeActualizado('hidden xl:inline-flex')}
                {controlesDeActualizar}
              </>
            )}
            <button
              type="button"
              onClick={() => setAyuda(true)}
              aria-label="Atajos de teclado"
              title="Atajos de teclado (?)"
              className={cn('hidden h-9 w-9 items-center justify-center rounded-[10px] text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)] lg:inline-flex', FOCO)}
            >
              <HelpCircle className="h-[18px] w-[18px]" aria-hidden />
            </button>
            <Boton variante="primario" icono={PenSquare} onClick={redactarNuevo} disabled={!paraRedactar} title={paraRedactar ? 'Redactar (c)' : 'No puedes enviar desde ninguno de tus buzones'}>
              Redactar
            </Boton>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* ---------- Columna 1: barra (carril en la tableta) ---------- */}
          <div className={cn('flex min-h-0 shrink-0 flex-col border-r border-[var(--ls-linea)]', ancho === 'tableta' ? 'w-16' : 'w-[248px]')}>{barra(ancho === 'tableta' ? 'carril' : 'columna')}</div>

          {/* ---------- Columnas 2 y 3 ---------- */}
          <div className="flex min-h-0 min-w-0 flex-1">
            {secuencias}
            {!c.enSecuencias &&
              (c.conectando ? (
                <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{conectarAqui}</div>
              ) : carpeta?.tipo === 'equipo' ? (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3 lg:p-4">{resumen}</div>
              ) : (
                <>
                  <section aria-label="Conversaciones" className={cn('flex min-h-0 shrink-0 flex-col border-r border-[var(--ls-linea)]', ancho === 'tableta' ? 'w-[40%]' : 'w-[380px] min-w-[320px]')}>
                    {bandas}
                    <div className="min-h-0 flex-1">{listaDeHilos}</div>
                  </section>
                  <section aria-label="Conversación abierta" className="flex min-h-0 min-w-0 flex-1 flex-col">
                    {vistaDeHilo}
                  </section>
                </>
              ))}
          </div>
        </div>
      </div>
      {paneles}
    </MotionConfig>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas pequeñas                                                     */
/* ------------------------------------------------------------------ */

function EsqueletoDeCorreo() {
  return (
    <div className="overflow-hidden rounded-[14px] md:border md:border-[var(--ls-linea)] md:bg-[var(--ls-sup)]" aria-busy="true" aria-label="Cargando el correo">
      <div className="hidden h-14 items-center gap-3 border-b border-[var(--ls-linea)] px-4 md:flex">
        <Esqueleto className="h-8 w-8" />
        <Esqueleto className="h-8 w-72" />
        <Esqueleto className="ml-auto h-9 w-28" />
      </div>
      <div className="flex">
        <div className="hidden w-[248px] space-y-2 border-r border-[var(--ls-linea)] p-3 lg:block">
          {[0, 1, 2, 3, 4].map((i) => (
            <Esqueleto key={i} className="h-9 w-full" />
          ))}
        </div>
        <div className="flex-1 space-y-1 p-2 pl-14 md:pl-2 lg:max-w-[380px]">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-3">
              <Esqueleto redondo className="h-9 w-9 shrink-0" />
              <div className="flex-1 space-y-2">
                <Esqueleto className="h-3 w-2/5" />
                <Esqueleto className="h-2.5 w-4/5" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function AvisoDeCifrado({ visible }: { visible: boolean }) {
  if (!visible) return null
  return (
    <Aviso titulo="Falta configurar el cifrado en el servidor">
      El servidor no tiene la clave con la que se cifran las contraseñas (<span className="font-mono text-[var(--ls-t1)]">AMAZON_TOKEN_KEY</span>), así que de momento no puede guardar la de ningún buzón. Avisa a Liberty Seller.
    </Aviso>
  )
}

/** El buscador de la cabecera (desde md). En el móvil va detrás de la lupa de la lista */
function BuscadorDeCabecera({ valor, onCambio, sitio }: { valor: string; onCambio: (t: string) => void; sitio: string }) {
  return (
    <label className="relative min-w-0 max-w-[520px] flex-1">
      <span className="sr-only">Buscar en {sitio}</span>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ls-t4)]" aria-hidden />
      <input
        type="search"
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            if (valor) onCambio('')
            else e.currentTarget.blur()
          }
        }}
        placeholder={`Buscar en ${sitio}…`}
        enterKeyHint="search"
        data-buscador-correo=""
        className="h-9 w-full rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] pl-9 pr-16 text-base text-[var(--ls-t1)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--ls-t4)] hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)] focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ls-acc-graf)_22%,transparent)] lg:text-[13.5px] [&::-webkit-search-cancel-button]:hidden"
      />
      {valor ? (
        <button
          type="button"
          onClick={() => onCambio('')}
          aria-label="Borrar la búsqueda"
          className={cn('absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[8px] text-[var(--ls-t4)] hover:text-[var(--ls-t1)]', FOCO)}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      ) : (
        <kbd aria-hidden className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] px-1.5 text-[11px] font-medium leading-[18px] text-[var(--ls-t4)] lg:inline-block">
          /
        </kbd>
      )}
    </label>
  )
}

/** Cabecera pegajosa de un nivel del móvil (Resumen, Secuencias, Conectar): el hueco de la hamburguesa y «←» después */
function CabeceraDeNivel({ titulo, icono: Icono, onAtras }: { titulo: string; icono?: typeof Mail; onAtras: () => void }) {
  return (
    <div className="sticky top-0 z-20 flex h-14 items-center gap-1 bg-[var(--ls-fondo)] pl-14 lg:pl-0">
      <button type="button" onClick={onAtras} aria-label="Volver" className={cn('-ml-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-[var(--ls-t2)] active:bg-[var(--ls-sup3)]', FOCO)}>
        <ArrowLeft className="h-5 w-5" aria-hidden />
      </button>
      {Icono && <Icono className="h-4 w-4 shrink-0 text-[var(--ls-acc)]" aria-hidden />}
      <h2 className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)]">{titulo}</h2>
    </div>
  )
}

function Banda({ tono, icono: Icono, children, accion }: { tono: 'ambar' | 'rojo' | 'azul'; icono: typeof Mail; children: ReactNode; accion?: ReactNode }) {
  const color = tono === 'rojo' ? 'var(--ls-e-rojo)' : tono === 'azul' ? 'var(--ls-e-azul)' : 'var(--ls-e-ambar)'
  return (
    <div
      role={tono === 'rojo' ? 'alert' : 'status'}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--ls-linea)] px-3 py-2 text-[12.5px] leading-snug text-[var(--ls-t2)]"
      style={{ background: `color-mix(in srgb, ${color} 10%, transparent)` }}
    >
      <span className="flex min-w-0 flex-1 items-start gap-2">
        <Icono className="mt-[1px] h-4 w-4 shrink-0" style={{ color }} aria-hidden />
        <span className="min-w-0">{children}</span>
      </span>
      {accion}
    </div>
  )
}

/** Lo que hay que saber del buzón abierto: de quién es (supervisión o asignado) y si algo falla. Lo que falla, solo a quien puede arreglarlo */
function BandasDelBuzon({ buzon, esAdmin, onAjustes }: { buzon: BuzonVisible; esAdmin: boolean; onAjustes: (pestana: PestanaDeAjustes) => void }) {
  const enlace = (texto: string, pestana: PestanaDeAjustes) => (
    <button type="button" onClick={() => onAjustes(pestana)} className={cn('font-medium text-[var(--ls-acc)] underline underline-offset-2', FOCO)}>
      {texto}
    </button>
  )
  return (
    <>
      {!buzon.esMio && buzon.asignado && (
        <Banda tono="azul" icono={UserCheck}>
          <strong className="font-semibold text-[var(--ls-t1)]">Asignado a ti</strong> · lo que lees y envías queda anotado.
        </Banda>
      )}
      {!buzon.esMio && !buzon.asignado && (
        <Banda tono="ambar" icono={Eye}>
          Buzón de <strong className="font-semibold text-[var(--ls-t1)]">{buzon.propietario.nombre || 'otra persona'}</strong>: <strong className="font-semibold text-[var(--ls-t1)]">solo lectura</strong> · queda anotado.
        </Banda>
      )}
      {buzon.esMio && buzon.credencialesInvalidas && (
        <Banda tono="rojo" icono={KeyRound} accion={enlace('Volver a poner la contraseña', 'conexion')}>
          El servidor de correo ha rechazado tu contraseña: no llegan correos nuevos ni puedes enviar.
        </Banda>
      )}
      {buzon.esMio && !buzon.conectado && (
        <Banda tono="ambar" icono={AlertCircle} accion={enlace('Reconectar', 'conexion')}>
          Este buzón está desconectado: no llegan correos nuevos ni se puede enviar. Lo ya importado sigue aquí.
        </Banda>
      )}
      {(buzon.esMio || esAdmin) && buzon.conectado && !buzon.credencialesInvalidas && buzon.ultimoError && (
        <Banda tono="ambar" icono={AlertCircle} accion={enlace(buzon.esMio ? 'Ajustes' : 'Ver o desconectar', buzon.esMio ? 'general' : 'conexion')}>
          {buzon.ultimoError}
        </Banda>
      )}
    </>
  )
}
