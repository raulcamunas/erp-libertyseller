'use client'

import { AlertTriangle, MousePointerClick, RefreshCw, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  SIN_FILTROS,
  contarNiveles,
  hayPartnersEn,
  listaDe,
  normalizarFiltros,
  panorama,
  rellamadasDe,
  resumenDeCartera,
  type FiltrosDeCartera,
} from '@/lib/cold-calling/cartera'
import { diaConSemana, diaLocal } from '@/lib/cold-calling/fechas'
import { alEnviarseCorreoDeLead } from '@/lib/correo/peticiones'
import { esFestivoParaElLead } from '@/lib/festivos/lead'
import { CorreoRapido } from './CorreoRapido'
import { AVISO, BOTON, COLOR_ESTADO } from '@/lib/estilo/denso'
import { useIsMobile } from '@/lib/use-is-mobile'
import type { CalendarPerson } from '@/lib/types/appointments'
import type { UserProfile } from '@/lib/supabase/get-user-profile'
import { esPartner, type ColdLead } from '@/lib/types/cold-leads'
import { PANEL } from '@/components/rendimiento/ui'
import { BarraDeCartera, type VistaDeCartera } from './BarraDeCartera'
import { DiagnosticoDeVinculos } from './DiagnosticoDeVinculos'
import { BandaDeFestivos } from './Festivos'
import { FichaDelLead } from './FichaDelLead'
import { FiltrosDeLista } from './FiltrosDeLista'
import { ListaDeLeads, ListaPorSecciones, type SeccionDeLista } from './ListaDeLeads'
import { PantallaDeListas } from './listas/PantallaDeListas'
import { NavegadorDeDias } from './NavegadorDeDias'
import { TablaDeLeads } from './TablaDeLeads'
import { TablaDePartners } from './TablaDePartners'
import { Tecla } from './ui'
import { useCartera } from './useCartera'
import { usePreferencias } from './usePreferencias'
import { useAbrirLead } from './useAbrirLead'
import { useSincronizarRinkel } from './useSincronizarRinkel'

/**
 * COLD CALLING: LA CARTERA DE LEADS DE UNA PERSONA.
 *
 * Tres vistas de la misma cartera:
 *   · FICHA      la lista a la izquierda y la ficha del lead a la derecha: para trabajar un lead a fondo y pasar al siguiente.
 *   · TABLA      como el Excel de siempre: muchos leads a la vez, con el estado y la rellamada editables en la fila.
 *   · RELLAMADAS la agenda del día: a quién se prometió volver a llamar. NO se parece a las otras dos y se salta los filtros (ver
 *                las reglas de lib/cold-calling/cartera.ts: una rellamada es un compromiso con una persona, no una prospección).
 *
 * LAS REGLAS DE FILTRAR, ORDENAR Y CONTAR viven en lib/cold-calling/cartera.ts, con sus pruebas. Aquí solo se pinta y se reparte el estado.
 *
 * `puedeVerTodos` ya NO significa «es admin»: desde la migración 212 lo pone también a true el permiso suelto 'equipo-comercial' del manager
 * de captación, que no es admin ni partner. Lo que abre, y nada más: el selector de comercial, y que `canEdit` deje tocar estado, fecha de
 * rellamada, notas y «vende en Amazon» en un lead ajeno. NO reasigna: la ficha no tiene control de `assigned_to` y el trigger de la 212
 * rechaza el cambio. Quien recorta de verdad son las políticas RLS: esto solo evita la pantalla vacía.
 */

interface Props {
  /** 'all' o el id de la persona cuya cartera se pide al montar (la que quien supervisa miraba la última vez) */
  propietarioInicial: string
  team: CalendarPerson[]
  currentUser: UserProfile
  puedeVerTodos: boolean
  /** ¿Puede gestionar las listas de leads (crearlas, moverles leads, asignarlas, añadirles tiendas)? Solo entonces existe la vista «Listas» */
  puedeGestionarListas: boolean
  /**
   * ¿Se sabe ya si puede ver a todos? Quien supervisa por un permiso suelto lo averigua con una consulta, y mientras tanto `puedeVerTodos` vale false: sin este dato, la cartera de
   * una persona recordada de la última vez se tiraba al montar (parecía «alguien sin permiso») y volvía a pedirse la de todos
   */
  permisoResuelto?: boolean
  /**
   * ¿Es la aplicación que se está viendo? Cold Calling se queda montada (oculta) mientras se trabaja en otra y se vuelve: lo único que
   * NO puede seguir haciendo mientras está oculta es secuestrar el teclado (↑ ↓ y «/» son de la pantalla que se ve). Lo demás —el canal
   * en tiempo real, la lectura de Rinkel cada minuto— sigue, y es justo lo que se quiere.
   */
  activa: boolean
  /** El lead que pedía la dirección al montar (`?lead=<id>`: el enlace de la ficha de una cita de la Agenda). Se abre en cuanto llega la cartera */
  leadInicial?: string | null
}

/** Si la pantalla estuvo más de esto fuera de la vista, al volver se pide la cartera otra vez, en silencio (por si el canal en tiempo real se perdió algo) */
const REFRESCO_AL_VOLVER_MS = 10 * 60_000

/**
 * El día de HOY en el calendario de quien mira, y se renueva solo si la pantalla se queda abierta pasada la medianoche. En el servidor vale
 * '' (no sabe en qué calendario está quien mira): así servidor y navegador pintan lo mismo al hidratar y nadie ve un «hoy» equivocado.
 */
function useHoy(): string {
  return useSyncExternalStore(
    (avisar) => {
      const reloj = setInterval(avisar, 60_000)
      document.addEventListener('visibilitychange', avisar)
      return () => {
        clearInterval(reloj)
        document.removeEventListener('visibilitychange', avisar)
      }
    },
    () => diaLocal(),
    () => ''
  )
}

export function ColdCallingBoard({ propietarioInicial, team, currentUser, puedeVerTodos, puedeGestionarListas, permisoResuelto = true, activa, leadInicial = null }: Props) {
  const hoy = useHoy()
  const esMovil = useIsMobile()
  const cartera = useCartera({ propietarioInicial, userId: currentUser.id })
  const { leads, propietario, cargando, incompleta, parchear, cambiarPropietario, refrescar, cargadaEn } = cartera

  const [vistaElegida, setVista] = useState<VistaDeCartera>('ficha')
  // La vista «Listas» solo existe para quien puede gestionarlas: si se recordó de otra vez y ya no puede (le quitaron la casilla), se vuelve a la ficha
  const vista: VistaDeCartera = vistaElegida === 'listas' && !puedeGestionarListas ? 'ficha' : vistaElegida
  const [filtros, setFiltros] = useState<FiltrosDeCartera>(SIN_FILTROS)
  const [seleccionado, setSeleccionado] = useState<string | null>(null)
  const [diaElegido, setDiaElegido] = useState<string | null>(null)
  const [comprobando, setComprobando] = useState(false)
  /**
   * «OCULTAR LOS LEADS EN FESTIVO». Es una decisión de HOY: se guarda con el día en que se pidió y a medianoche deja de valer sola (no se recuerda de un día para otro como los
   * filtros: si no, un día cualquiera la lista aparecería más corta sin que nadie se acordara de por qué). No está en `filtros` por lo mismo: no se guarda en las preferencias.
   */
  const [ocultarFestivosEn, setOcultarFestivosEn] = useState<string | null>(null)
  const ocultarFestivos = ocultarFestivosEn !== null && ocultarFestivosEn === hoy
  const [versionDeLlamadas, setVersionDeLlamadas] = useState(0)
  const caja = useRef<HTMLInputElement>(null)

  /**
   * LAS LLAMADAS DE RINKEL SE APUNTAN SOLAS EN EL LEAD (migración 237). Mientras esta pantalla está abierta se pide cada minuto una lectura
   * rápida de la cuenta de Rinkel de quien mira; si han llegado llamadas nuevas, `version` sube y el historial del lead abierto las vuelve
   * a pedir. Los intentos, el último contacto y el estado del lead llegan solos por el canal en tiempo real.
   */
  useSincronizarRinkel(true, () => setVersionDeLlamadas((v) => v + 1))

  // Un correo enviado desde la ficha de un lead (el chip de su email lleva a Correo) se apunta solo en su historial: aquí se refleja sin recargar
  useEffect(
    () =>
      alEnviarseCorreoDeLead((envio) => {
        parchear(envio.leadId, { last_contacted_at: envio.cuando })
        setVersionDeLlamadas((v) => v + 1)
      }),
    [parchear]
  )

  /** Quién es quién, para que el historial diga «Maoli» y no un identificador */
  const nombres = useMemo(() => {
    const mapa = new Map<string, string>()
    for (const p of team) mapa.set(p.id, p.full_name?.trim() || p.email || 'Sin nombre')
    if (!mapa.has(currentUser.id)) mapa.set(currentUser.id, currentUser.full_name?.trim() || currentUser.email || 'Sin nombre')
    return mapa
  }, [team, currentUser])

  const preferenciasListas = usePreferencias(currentUser.id, puedeVerTodos, { vista: vistaElegida, filtros, propietario: puedeVerTodos ? propietario : null }, (leidas) => {
    if (leidas.vista) setVista(leidas.vista)
    if (leidas.filtros) setFiltros(leidas.filtros)
    if (puedeVerTodos && leidas.propietario && leidas.propietario !== propietarioInicial && (leidas.propietario === 'all' || team.some((t) => t.id === leidas.propietario))) cartera.cambiarPropietario(leidas.propietario)
  })

  // Una cartera de alguien que ya no está en el equipo (o de otro, si a quien mira le han quitado el permiso de ver a todos) se vuelve a «todos»:
  // una cartera sin dueño en el selector, o la de otra persona sin derecho a verla, solo deja la pantalla vacía sin explicar por qué
  useEffect(() => {
    if (propietario === 'all') return
    if (!puedeVerTodos) {
      // Mientras no se sepa si puede, no se le quita la cartera que traía (la de la última vez)
      if (permisoResuelto) cambiarPropietario('all')
    } else if (team.length > 0 && !team.some((t) => t.id === propietario)) cambiarPropietario('all')
  }, [propietario, puedeVerTodos, permisoResuelto, team, cambiarPropietario])

  // Al volver a la pantalla tras mucho rato fuera de la vista (o al despertar el portátil con ella abierta) se vuelve a pedir la cartera, en silencio
  useEffect(() => {
    if (!activa) return
    const alVolver = () => {
      if (document.visibilityState !== 'visible') return
      if (cargadaEn.current > 0 && Date.now() - cargadaEn.current > REFRESCO_AL_VOLVER_MS) void refrescar()
    }
    alVolver()
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [activa, refrescar, cargadaEn])

  /* ---------------- lo que se calcula de la cartera ---------------- */

  // Un filtro de lista o de nivel que ya no tiene nada que filtrar se quita solo (regla 5 de cartera.ts)
  const filtrosEfectivos = useMemo(() => normalizarFiltros(filtros, leads), [filtros, leads])
  // Con «Ocultar» puesto, los leads para los que hoy es festivo no entran en la lista ni en sus recuentos. Las rellamadas NO pasan por aquí: una rellamada es un compromiso con una
  // persona y se enseña siempre (con su marca de festivo)
  const leadsDeTrabajo = useMemo(() => (ocultarFestivos ? leads.filter((l) => !esFestivoParaElLead(hoy, l)) : leads), [leads, ocultarFestivos, hoy])
  const pan = useMemo(() => panorama(leadsDeTrabajo, filtrosEfectivos), [leadsDeTrabajo, filtrosEfectivos])
  const resumen = useMemo(() => resumenDeCartera(leads, hoy), [leads, hoy])
  const diaRellamadas = diaElegido ?? hoy
  const rell = useMemo(() => rellamadasDe(leads, diaRellamadas, hoy), [leads, diaRellamadas, hoy])
  // Si hay filtro de nivel (tiendas) o de facturación (vendedores) lo decide LA LISTA que se mira, no lo que dejen la búsqueda o el estado: con
  // una búsqueda que no encuentra nada los chips de nivel no pueden convertirse en un rango de facturación
  const nivelesDeLaLista = useMemo(() => contarNiveles(leads, filtrosEfectivos.lista), [leads, filtrosEfectivos.lista])
  const hayNiveles = nivelesDeLaLista[1] + nivelesDeLaLista[2] + nivelesDeLaLista[3] > 0
  // LOS PARTNERS (agencias, fulfillment, registro de marcas, gestorías) no tienen nivel ni facturación: tienen prioridad y puntos. Lo que se mira decide qué filtros hay y qué tabla se pinta:
  // la lista elegida (o todas) con algún partner enseña la prioridad y «Menciona Amazon»; con SOLO partners no hay facturación que filtrar y la tabla es la suya, con las columnas del Excel
  const hayPartners = useMemo(() => hayPartnersEn(leads, filtrosEfectivos.lista), [leads, filtrosEfectivos.lista])
  const soloPartners = useMemo(() => hayPartners && leads.every((l) => !(filtrosEfectivos.lista === 'all' || listaDe(l) === filtrosEfectivos.lista) || esPartner(l)), [leads, hayPartners, filtrosEfectivos.lista])
  const tablaDePartners = useMemo(() => pan.visibles.length > 0 && pan.visibles.every(esPartner), [pan.visibles])

  const secciones = useMemo<SeccionDeLista[]>(
    () => [
      ...(diaRellamadas === hoy && rell.atrasadas.length > 0 ? [{ id: 'atrasadas', titulo: 'Atrasadas', nota: 'las que llevan más tiempo cayéndose, primero', tono: 'ambar' as const, leads: rell.atrasadas }] : []),
      { id: 'dia', titulo: diaRellamadas === hoy ? 'Para hoy' : diaConSemana(diaRellamadas), tono: 'cian' as const, leads: rell.delDia },
    ],
    [rell, diaRellamadas, hoy]
  )

  /** La lista por la que se navega con «Siguiente» y las flechas: la que se está viendo */
  const navegacion = useMemo(() => (vista === 'rellamadas' ? [...rell.atrasadas, ...rell.delDia] : pan.visibles), [vista, rell, pan.visibles])

  /** Cambia cuando cambia lo que se está mirando: la lista vuelve arriba y las primeras filas vuelven a entrar */
  const generacion = `${vista}|${ocultarFestivos ? 'sin-festivos' : ''}|${propietario}|${filtrosEfectivos.estado}|${filtrosEfectivos.lista}|${filtrosEfectivos.nivel}|${filtrosEfectivos.prioridad}|${filtrosEfectivos.mencionaAmazon}|${filtrosEfectivos.minRev}|${filtrosEfectivos.maxRev}|${filtrosEfectivos.orden}|${filtrosEfectivos.busqueda}`

  const leadSeleccionado = useMemo(() => (seleccionado ? (leads.find((l) => l.id === seleccionado) ?? null) : null), [leads, seleccionado])
  const indiceSeleccionado = useMemo(() => (seleccionado ? navegacion.findIndex((l) => l.id === seleccionado) : -1), [navegacion, seleccionado])

  /**
   * SI EL LEAD SELECCIONADO SALE DE LA LISTA (se le cambió el estado y ya no cumple el filtro), «Siguiente» no vuelve al principio: va al
   * que ocupa ahora el sitio que él dejó, que es el que le seguía. Así el comercial que clasifica «Sin contactar» uno detrás de otro no
   * pierde su sitio cada vez.
   */
  const posicionPrevia = useRef(0)
  useEffect(() => {
    if (indiceSeleccionado >= 0) posicionPrevia.current = indiceSeleccionado
  }, [indiceSeleccionado])

  const mover = useCallback(
    (delta: 1 | -1) => {
      if (navegacion.length === 0) return
      const base = indiceSeleccionado >= 0 ? indiceSeleccionado + delta : delta === 1 ? posicionPrevia.current : posicionPrevia.current - 1
      const destino = Math.max(0, Math.min(navegacion.length - 1, base))
      setSeleccionado(navegacion[destino].id)
    },
    [navegacion, indiceSeleccionado]
  )

  const abrirFicha = useCallback((id: string) => {
    setSeleccionado(id)
    setVista('ficha')
  }, [])

  // El enlace de la ficha de una cita de la Agenda (`?lead=<id>`) abre ese lead en cuanto llega la cartera; si es de otra persona y quien mira supervisa, va a la cartera de su dueño
  const equipo = useMemo(() => team.map((t) => t.id), [team])
  const { pendiente: leadPendiente } = useAbrirLead({
    leadInicial,
    listo: !!preferenciasListas,
    leads,
    cargando,
    propietario,
    puedeVerTodos,
    equipo,
    cambiarPropietario,
    abrir: abrirFicha,
  })

  // En pantallas anchas la ficha nunca está vacía: si no hay nada elegido, se abre el primero de la lista. En el móvil NO: ahí se ve la lista o la
  // ficha, nunca las dos, y entrar directamente en una ficha sin haber elegido nada desorienta. `esMovil` arranca en false hasta que el primer
  // efecto de su hook mide la pantalla, así que aquí se mira la pantalla directamente
  // Y no antes de haber leído las preferencias: con los filtros de ayer puestos, el primero de la lista NO es el primero de la cartera entera
  useEffect(() => {
    if (!preferenciasListas || esMovil || vista === 'tabla' || vista === 'listas' || leadSeleccionado || navegacion.length === 0) return
    // Con un lead pedido por la dirección no se enseña un instante la ficha del primero: la ficha pide sus datos al abrirse
    if (leadPendiente) return
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) return
    setSeleccionado(navegacion[0].id)
  }, [preferenciasListas, esMovil, vista, leadSeleccionado, navegacion, leadPendiente])

  // Teclado: ↑ ↓ cambian de lead y «/» va a la búsqueda. Nada de esto actúa mientras se escribe o hay un diálogo abierto, ni mientras la
  // pantalla está oculta (se está en Correo: las flechas y la barra son de lo que se ve)
  useEffect(() => {
    if (!activa || vista === 'tabla' || vista === 'listas') return
    const alPulsar = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('[role="dialog"]')) return
      const el = e.target as HTMLElement | null
      const escribiendo = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      if (escribiendo) return
      if (e.key === '/' && vista === 'ficha') {
        e.preventDefault()
        caja.current?.focus()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        mover(1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        mover(-1)
      }
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [activa, vista, mover])

  const cambiarFiltros = useCallback((cambios: Partial<FiltrosDeCartera>) => setFiltros((previos) => ({ ...previos, ...cambios })), [])
  const elegirVista = useCallback((v: VistaDeCartera) => {
    setVista(v)
    // Entrar en la agenda siempre te deja en HOY: el día no se recuerda (ver NavegadorDeDias)
    if (v === 'rellamadas') setDiaElegido(null)
  }, [])

  /* ---------------- piezas ---------------- */

  const cajaDeBusqueda = (
    <label className="relative flex min-w-0 flex-1 items-center">
      <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[var(--ls-t4)]" aria-hidden />
      <input
        ref={caja}
        value={filtros.busqueda}
        onChange={(e) => cambiarFiltros({ busqueda: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            cambiarFiltros({ busqueda: '' })
            e.currentTarget.blur()
          }
        }}
        placeholder="Buscar tienda, empresa, teléfono…"
        aria-label="Buscar en la cartera"
        className="h-7 w-full rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] pl-8 pr-14 text-[12.5px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)] focus:shadow-[inset_0_0_0_1px_var(--ls-acc-graf)]"
      />
      <span className="absolute right-2 flex items-center">
        {filtros.busqueda ? (
          <button type="button" onClick={() => cambiarFiltros({ busqueda: '' })} className="text-[var(--ls-t4)] hover:text-[var(--ls-t1)]" aria-label="Borrar la búsqueda">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <Tecla>/</Tecla>
        )}
      </span>
    </label>
  )

  const hayFiltrosPuestos = filtrosEfectivos.estado !== 'all' || filtrosEfectivos.lista !== 'all' || filtrosEfectivos.nivel !== 'all' || filtrosEfectivos.prioridad !== 'all' || filtrosEfectivos.mencionaAmazon || filtrosEfectivos.minRev !== '' || filtrosEfectivos.maxRev !== '' || filtrosEfectivos.busqueda.trim() !== ''

  const vacio =
    leads.length === 0 && !cargando ? (
      <p className="max-w-[260px] text-center text-[12.5px] leading-relaxed text-[var(--ls-t4)]">Todavía no hay leads en esta cartera.</p>
    ) : vista === 'rellamadas' ? (
      <div className="max-w-[300px] text-center">
        <p className="text-[12.5px] text-[var(--ls-t3)]">{diaRellamadas === hoy ? 'No hay ninguna rellamada apuntada para hoy.' : `No hay ninguna rellamada apuntada para el ${diaConSemana(diaRellamadas)}.`}</p>
        <p className="mt-1 text-[11.5px] leading-snug text-[var(--ls-t4)]">Aquí sale todo lo que tenga fecha en «Rellamar el», sin importar la facturación ni ningún otro filtro.</p>
      </div>
    ) : (
      <div className="text-center">
        <p className="text-[12.5px] text-[var(--ls-t3)]">Ningún lead con estos filtros.</p>
        {hayFiltrosPuestos && (
          <button type="button" onClick={() => setFiltros(SIN_FILTROS)} className={`${BOTON.chip} mt-2`}>
            <X className="h-3 w-3" aria-hidden /> Limpiar filtros
          </button>
        )}
      </div>
    )

  const puedeEditar = (l: ColdLead) => puedeVerTodos || l.assigned_to === currentUser.id

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-2.5">
      <BarraDeCartera
        resumen={resumen}
        vista={vista}
        onVista={elegirVista}
        puedeVerTodos={puedeVerTodos}
        team={team}
        propietario={propietario}
        onPropietario={cartera.cambiarPropietario}
        cargando={cargando}
        onTelefonos={() => setComprobando(true)}
        puedeGestionarListas={puedeGestionarListas}
      />

      {incompleta && !cargando && vista !== 'listas' && (
        <div className={`${AVISO.base} ${AVISO.conTono} items-center`} style={{ borderLeftColor: COLOR_ESTADO.ambar }} role="alert">
          <AlertTriangle className={`${AVISO.icono} !mt-0 text-[var(--ls-e-ambar)]`} aria-hidden />
          <p className="flex-1">
            <span className={AVISO.fuerte}>La cartera ha llegado incompleta.</span> Algún tramo no se ha podido leer, así que puede que falten leads.
          </p>
          <button type="button" onClick={() => void cartera.recargar()} className={`${BOTON.base} ${BOTON.secundario}`}>
            <RefreshCw className="h-3 w-3" aria-hidden /> Reintentar
          </button>
        </div>
      )}

      {/* Hoy es festivo en la comunidad de algunos leads de esta cartera (o lo será en los próximos días): se dice arriba, con los que afecta y el botón de ocultarlos por hoy */}
      {vista !== 'listas' && vista !== 'rellamadas' && <BandaDeFestivos leads={leads} hoy={hoy} ocultando={ocultarFestivos} onOcultar={(ocultar) => setOcultarFestivosEn(ocultar ? hoy : null)} />}

      {vista === 'listas' ? null : vista === 'rellamadas' ? (
        <NavegadorDeDias dia={diaRellamadas} hoy={hoy} onDia={(d) => setDiaElegido(d === hoy ? null : d)} delDia={rell.delDia.length} atrasadas={rell.atrasadas.length} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {vista === 'tabla' && <div className="flex w-[260px] max-w-full">{cajaDeBusqueda}</div>}
          <div className="min-w-0 flex-1">
            <FiltrosDeLista
              filtros={filtrosEfectivos}
              onCambiar={cambiarFiltros}
              porEstado={pan.porEstado}
              total={pan.totalSinEstado}
              listas={pan.listas}
              niveles={pan.niveles}
              hayNiveles={hayNiveles}
              prioridades={pan.prioridades}
              hayPartners={hayPartners}
              soloPartners={soloPartners}
              mencionanAmazon={pan.mencionanAmazon}
              coinciden={pan.visibles.length}
            />
          </div>
        </div>
      )}

      <div className={`min-h-0 min-w-0 flex-1 ${vista === 'listas' ? 'flex flex-col' : ''}`}>
        {vista === 'listas' ? (
          <PantallaDeListas alCambiarLeads={() => void refrescar()} />
        ) : vista === 'tabla' ? (
          // Con SOLO partners a la vista, la tabla con las columnas de su Excel; con cualquier otra mezcla, la de siempre
          tablaDePartners ? (
            <TablaDePartners
              leads={pan.visibles}
              currentUserId={currentUser.id}
              currentUser={currentUser}
              puedeVerTodos={puedeVerTodos}
              selectedId={seleccionado}
              onSelect={setSeleccionado}
              onOpenDetail={abrirFicha}
              onPatched={parchear}
              nombres={nombres}
              version={versionDeLlamadas}
              hoy={hoy}
              generacion={generacion}
            />
          ) : (
            <TablaDeLeads
              leads={pan.visibles}
              currentUserId={currentUser.id}
              currentUser={currentUser}
              puedeVerTodos={puedeVerTodos}
              selectedId={seleccionado}
              onSelect={setSeleccionado}
              onOpenDetail={abrirFicha}
              onPatched={parchear}
              nombres={nombres}
              version={versionDeLlamadas}
              hoy={hoy}
              generacion={generacion}
            />
          )
        ) : (
          <div className="grid h-full min-h-0 grid-cols-1 gap-2.5 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
            <div className={`${PANEL} min-h-0 flex-col overflow-hidden ${esMovil && seleccionado ? 'hidden' : 'flex'}`}>
              {vista === 'ficha' && <div className="shrink-0 border-b border-[var(--ls-linea)] p-2">{cajaDeBusqueda}</div>}
              {vista === 'ficha' ? (
                <ListaDeLeads
                  leads={pan.visibles}
                  seleccionado={seleccionado}
                  onSeleccionar={setSeleccionado}
                  hoy={hoy}
                  mostrarLista={filtrosEfectivos.lista === 'all' && pan.listas.length > 1}
                  generacion={generacion}
                  cargando={cargando}
                  vacio={vacio}
                />
              ) : (
                <ListaPorSecciones secciones={secciones} seleccionado={seleccionado} onSeleccionar={setSeleccionado} hoy={hoy} diaFestivos={diaRellamadas} vacio={vacio} />
              )}
            </div>

            <div className={`${PANEL} min-h-0 overflow-hidden ${esMovil && !seleccionado ? 'hidden' : 'block'}`}>
              {leadSeleccionado ? (
                <div key={leadSeleccionado.id} className="rend-desliza h-full">
                  <FichaDelLead
                    lead={leadSeleccionado}
                    currentUser={currentUser}
                    canEdit={puedeEditar(leadSeleccionado)}
                    onPatched={(campos) => parchear(leadSeleccionado.id, campos)}
                    onSiguiente={() => mover(1)}
                    onAnterior={() => mover(-1)}
                    posicion={indiceSeleccionado >= 0 ? { indice: indiceSeleccionado, total: navegacion.length } : null}
                    hoy={hoy}
                    nombres={nombres}
                    version={versionDeLlamadas}
                    onVolver={esMovil ? () => setSeleccionado(null) : undefined}
                  />
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                  <MousePointerClick className="h-6 w-6 text-[var(--ls-t4)]" aria-hidden />
                  <p className="text-[12.5px] text-[var(--ls-t3)]">{cargando ? 'Cargando leads…' : 'Elige un lead de la izquierda para ver su ficha y empezar a llamar.'}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {puedeVerTodos && <DiagnosticoDeVinculos abierto={comprobando} onCerrar={() => setComprobando(false)} esAdmin={currentUser.role === 'admin'} />}
      {/* Escribir a un lead (su correo o «Correo con IA») se hace en una ventana encima de la ficha, sin salir a Correo */}
      <CorreoRapido yoId={currentUser.id} esAdmin={currentUser.role === 'admin'} />
    </div>
  )
}
