'use client'

import { AlertTriangle, CalendarClock, Check, ChevronLeft, ChevronRight, Copy, ExternalLink, Globe, Linkedin, Mail, MapPin, Phone, ShoppingBag, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { clavesDelLead } from '@/lib/cold-calling/vinculos'
import { diaConSemana, haceCuanto, sumarDias } from '@/lib/cold-calling/fechas'
import { BOTON, CAMPO, COLOR_ESTADO } from '@/lib/estilo/denso'
import { emailsDelLead, normalizarTelefono, telefonosDelLead } from '@/lib/cold-calling/contactos'
import { urlSegura } from '@/lib/cold-calling/partners'
import { createClient } from '@/lib/supabase/client'
import type { UserProfile } from '@/lib/supabase/get-user-profile'
import {
  COLD_STATUSES,
  COLD_STATUS_HINTS,
  COLD_STATUS_LABELS,
  COLD_VENDE_DOTS,
  COLD_VENDE_HINTS,
  COLD_VENDE_LABELS,
  COLD_VENDE_ORDEN,
  esPartner,
  esTiendaOnline,
  formatRevenue,
  type ColdLead,
  type ColdLeadStatus,
  type ColdNoteKind,
  type ColdVendeAmazon,
} from '@/lib/types/cold-leads'
import { DatosDelLead } from './DatosDelLead'
import { AvisoDeFestivoDeLaFicha } from './Festivos'
import { HistorialDelLead } from './HistorialDelLead'
import { ESTADO_VISUAL, GlifoDeEstado, InsigniaDeLista, InsigniaDeNivel, InsigniaDePrioridad, Tecla, tinte } from './ui'
import { AnadirContacto } from './AnadirContacto'
import { BotonDeWhatsapp } from './BotonDeWhatsapp'
import { useEscribirAlLead } from './useEscribirAlLead'

/**
 * LA FICHA DE UN LEAD.
 *
 * Arriba, fija, lo que se mira y se toca en cada llamada: el nombre, el teléfono (que se copia con un clic), el estado y el día de
 * rellamada. Debajo, el historial —donde se apunta lo que se habló— junto a los datos del lead. En una ficha estrecha las dos
 * columnas se apilan.
 *
 * La carga es en dos tiempos: la lista solo trae lo justo para pintarse (los campos largos pesaban más que todo lo demás junto), y los
 * demás se piden al abrir el lead. Mientras llegan se enseña lo que ya se tiene, así que la ficha aparece al instante y se completa
 * sola; y se recuerda lo ya pedido, así que volver a un lead que se acaba de ver no tiene espera.
 */

interface Props {
  lead: ColdLead
  currentUser: UserProfile
  canEdit: boolean
  onPatched: (patch: Partial<ColdLead>) => void
  onSiguiente: () => void
  onAnterior: () => void
  /** Dónde está este lead en la lista que se está mirando: «12 / 891» */
  posicion: { indice: number; total: number } | null
  /** El día de hoy en el calendario de quien mira */
  hoy: string
  nombres: ReadonlyMap<string, string>
  version: number
  /** En pantallas estrechas, volver a la lista */
  onVolver?: () => void
}

const CAMPOS_DEL_DETALLE =
  'directors, business_address, mercantile_registry, subcategory, amazon_start, action_label, ' +
  // Los de la lista nueva: no los trae la carga inicial por lo mismo que los de arriba, y son los que rellenan «La tienda»
  'decisor, cargo_decisor, cif, tipo_empresa, n_administradores, plataforma, ' +
  'n_productos, anos_tienda, instagram, telefonos_extra, emails_extra, web, ' +
  'vende_en_amazon_comprobado_en'

/** Un partner además trae sus enlaces largos y las búsquedas con las que se encontró (migración 262). Solo se piden para un partner: antes de lanzar la 262 esas columnas no existen y pedirlas rompería la ficha de todos */
const CAMPOS_DEL_DETALLE_DE_PARTNER = `${CAMPOS_DEL_DETALLE}, linkedin, google_maps_url, busquedas_origen`

/** Lo ya pedido de cada lead, para no esperar al volver a uno que se acaba de ver. Con tope: no crece sin límite */
const DETALLES = new Map<string, Partial<ColdLead>>()
const TOPE_DE_DETALLES = 300
function recordar(id: string, detalle: Partial<ColdLead>) {
  DETALLES.delete(id)
  DETALLES.set(id, detalle)
  if (DETALLES.size > TOPE_DE_DETALLES) DETALLES.delete(DETALLES.keys().next().value as string)
}

/** Cuánto mide un elemento, para decidir si la ficha cabe en dos columnas */
function useAncho(ref: React.RefObject<HTMLElement | null>): number {
  const [ancho, setAncho] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observador = new ResizeObserver(([e]) => setAncho(Math.round(e.contentRect.width)))
    observador.observe(el)
    return () => observador.disconnect()
  }, [ref])
  return ancho
}

/** Dos columnas a partir de este ancho: historial a la izquierda y datos a la derecha */
const ANCHO_PARA_DOS_COLUMNAS = 760

const chipDeEstado = (activo: boolean, tono: (typeof ESTADO_VISUAL)[ColdLeadStatus]['tono']) => ({
  className: `${BOTON.chip} !h-[26px] gap-1.5 !px-2 transition-colors disabled:opacity-50 ${activo ? '!text-[var(--ls-t1)] font-medium' : ''}`,
  style: activo ? { background: tinte(tono, 16), borderColor: COLOR_ESTADO[tono] } : undefined,
})

export function FichaDelLead({ lead: delaLista, currentUser, canEdit, onPatched, onSiguiente, onAnterior, posicion, hoy, nombres, version, onVolver }: Props) {
  const supabase = useMemo(() => createClient(), [])

  const [detalle, setDetalle] = useState<Partial<ColdLead>>(() => DETALLES.get(delaLista.id) ?? {})
  const lead = useMemo(() => ({ ...delaLista, ...detalle }) as ColdLead, [delaLista, detalle])

  useEffect(() => {
    let activo = true
    setDetalle(DETALLES.get(delaLista.id) ?? {})
    supabase
      .from('cold_leads')
      .select(esPartner(delaLista) ? CAMPOS_DEL_DETALLE_DE_PARTNER : CAMPOS_DEL_DETALLE)
      .eq('id', delaLista.id)
      .single()
      .then(({ data }) => {
        if (!activo || !data) return
        recordar(delaLista.id, data as Partial<ColdLead>)
        setDetalle(data as Partial<ColdLead>)
      })
    return () => {
      activo = false
    }
  }, [delaLista.id, supabase])

  const [nota, setNota] = useState(delaLista.follow_up ?? '')
  useEffect(() => {
    setNota(delaLista.follow_up ?? '')
  }, [delaLista.id, delaLista.follow_up])

  const [copiado, setCopiado] = useState<string | null>(null)
  useEffect(() => {
    if (!copiado) return
    const t = setTimeout(() => setCopiado(null), 1600)
    return () => clearTimeout(t)
  }, [copiado])

  const patch = useCallback(
    async (campos: Partial<ColdLead>) => {
      const { error } = await supabase.from('cold_leads').update(campos).eq('id', lead.id)
      if (error) {
        console.error('Error guardando el lead:', error)
        toast.error('No se pudo guardar')
        return false
      }
      // HAY QUE REFRESCAR TAMBIÉN `detalle`, NO SOLO LA LISTA. La ficha se pinta con `{ ...delaLista, ...detalle }` y `detalle` va la
      // ÚLTIMA: lo que se pidió aparte al abrir el lead gana. Guardar un campo que vive en esa segunda consulta y avisar solo a la
      // lista deja el valor viejo pintado encima del nuevo hasta que se cambia de lead (lo destapa `vende_en_amazon_comprobado_en`).
      // Solo se tocan las claves que `detalle` ya tiene: meter las demás lo convertiría en una copia paralela del lead que taparía
      // lo que llegue luego por el canal en tiempo real desde otro comercial.
      setDetalle((previo) => {
        const suyas = Object.entries(campos).filter(([c]) => c in previo)
        if (suyas.length === 0) return previo
        const nuevo = { ...previo, ...(Object.fromEntries(suyas) as Partial<ColdLead>) }
        recordar(lead.id, nuevo)
        return nuevo
      })
      onPatched(campos)
      return true
    },
    [supabase, lead.id, onPatched]
  )

  /** Cambiar el estado deja constancia de cuándo se tocó por última vez */
  const ponerEstado = (estado: ColdLeadStatus) => {
    if (estado !== lead.status) void patch({ status: estado, last_contacted_at: new Date().toISOString() })
  }

  /**
   * Al apuntar algo se sella la fecha del último contacto. NO se suma intento aunque sea una «llamada»: las llamadas de Rinkel suman su
   * intento solas (migración 237) y una «llamada» escrita a mano es un comentario sobre ellas; sumarla también contaría la misma dos veces.
   */
  const alApuntar = (_clase: ColdNoteKind) => void patch({ last_contacted_at: new Date().toISOString() })

  const esTienda = esTiendaOnline(lead)
  /** Un posible socio (agencia, fulfillment, registro de marcas, gestoría): sin facturación, sin «¿vende en Amazon?» y con su propia ficha de datos */
  const esSocio = esPartner(lead)
  /** Si es autónomo (en un partner, «persona física») NO se llama en frío. Criterio de la Leyenda del Excel y de la captación de partners */
  const esAutonomo = (esTienda || esSocio) && lead.tipo_empresa === 'autonomo'

  /**
   * Marcar si vende o no sella SIEMPRE la fecha, y desmarcar la borra. El sello es lo único que distingue «lo hemos mirado y no vende»
   * de «nadie lo ha mirado»: un «no vende» de hace cuatro meses ya no vale, la tienda puede haber entrado en Amazon desde entonces.
   */
  const ponerVende = (valor: ColdVendeAmazon) => {
    if (valor === lead.vende_en_amazon) return
    void patch({ vende_en_amazon: valor, vende_en_amazon_comprobado_en: valor === 'sin_comprobar' ? null : new Date().toISOString() })
  }

  const ponerRellamada = (dia: string | null) => void patch({ next_call_date: dia })

  const copiar = (texto: string, que: string) => {
    void navigator.clipboard.writeText(texto)
    setCopiado(que)
    toast.success(que === 'telefono' ? 'Teléfono copiado' : 'Copiado')
  }

  // Todos los teléfonos y correos de la ficha: los principales y los extra, sin repetidos. La cajita «+» añade más
  const telefonos = useMemo(() => telefonosDelLead(lead), [lead.phone, lead.telefonos_extra]) // eslint-disable-line react-hooks/exhaustive-deps
  const correos = useMemo(() => emailsDelLead(lead), [lead.email, lead.emails_extra]) // eslint-disable-line react-hooks/exhaustive-deps
  /** Un teléfono escrito que no da ninguna clave no recibirá nunca una llamada de Rinkel, y no da ningún error */
  const telefonoSinReconocer = telefonos.length > 0 && clavesDelLead(lead).length === 0 && /\d/.test(lead.phone ?? '')

  const escribirAlLead = useEscribirAlLead()

  const contenedor = useRef<HTMLDivElement>(null)
  const ancho = useAncho(contenedor)
  const dosColumnas = ancho >= ANCHO_PARA_DOS_COLUMNAS

  const intentos = lead.call_attempts ?? 0

  return (
    <div ref={contenedor} className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-[var(--ls-linea)] bg-[var(--ls-sup)]">
        {/* Si hoy es festivo en la comunidad del lead, o lo es el día de su rellamada: casi seguro no contestan. Con el botón de pasarla al primer día que sí se puede llamar
            (lib/festivos/). Un lead sin comunidad conocida no recibe ningún aviso */}
        <AvisoDeFestivoDeLaFicha lead={lead} hoy={hoy} canEdit={canEdit} onRellamar={ponerRellamada} />

        {/* Nombre y navegación */}
        <div className="flex items-start gap-3 px-4 pt-3">
          {onVolver && (
            <button type="button" onClick={onVolver} className={`${BOTON.icono} mt-0.5 !h-6 !w-6`} aria-label="Volver a la lista">
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.012em] text-[var(--ls-t1)]">{lead.store_name}</h2>
              {lead.source_list && <InsigniaDeLista nombre={lead.source_list} />}
              {lead.nivel != null && <InsigniaDeNivel nivel={lead.nivel} />}
              {esSocio && <InsigniaDePrioridad prioridad={lead.prioridad} />}
              {esSocio && lead.puntos != null && (
                <span title={`${lead.puntos} puntos de la captación`} className="text-[11px] tabular-nums text-[var(--ls-t3)]">
                  {lead.puntos} pts
                </span>
              )}
              {esAutonomo && (
                <span className="inline-flex h-[18px] items-center rounded-[4px] px-1.5 text-[10.5px] font-medium" style={{ color: COLOR_ESTADO.ambar, background: tinte('ambar') }}>
                  {esSocio ? 'Persona física' : 'Autónomo'}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11.5px] text-[var(--ls-t3)]">
              {/* De un partner interesa su razón social, QUÉ es y DÓNDE está; del resto, su empresa */}
              {esSocio ? [lead.company || 'Sin razón social', lead.category, lead.ciudad].filter(Boolean).join(' · ') : lead.company || 'Sin empresa'}
              {/* La cifra de ventas estimadas NO sube a la cabecera. Es una estimación de tráfico en dólares y aquí se leería como
                  facturación; vive en su bloque, con la advertencia al lado. Un partner no tiene ninguna de las dos */}
              {!esTienda && !esSocio && lead.revenue_monthly != null ? ` · ${formatRevenue(lead.revenue_monthly)}/mes` : ''}
              {intentos > 0 ? ` · ${intentos} ${intentos === 1 ? 'intento' : 'intentos'}` : ' · sin llamadas todavía'}
              {lead.last_contacted_at ? ` · último contacto ${haceCuanto(lead.last_contacted_at)}` : ''}
              {intentos > 0 && intentos < 3 ? <span className="text-[var(--ls-t4)]"> · las citas suelen caer a partir del tercero</span> : null}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {posicion && (
              <span className="mr-1 hidden text-[11px] tabular-nums text-[var(--ls-t4)] sm:inline">
                {(posicion.indice + 1).toLocaleString('es-ES')} / {posicion.total.toLocaleString('es-ES')}
              </span>
            )}
            <button type="button" onClick={onAnterior} className={`${BOTON.base} ${BOTON.secundario} !h-7 !px-1.5`} title="Lead anterior (↑)" aria-label="Lead anterior">
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={onSiguiente} className={`${BOTON.base} ${BOTON.secundario} !h-7 !px-2.5`} title="Siguiente lead (↓)">
              Siguiente <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Contacto: el teléfono es lo primero que se toca, así que es lo más grande */}
        <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2.5">
          {telefonos.length === 0 && (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-dashed border-[var(--ls-linea2)] px-2.5 text-[12.5px] text-[var(--ls-t4)]">
              <Phone className="h-3.5 w-3.5" aria-hidden /> Sin teléfono
            </span>
          )}
          {telefonos.map((t) => {
            // Un teléfono que se puede marcar es un ENLACE `tel:` de verdad, no un botón: así lo reconoce la extensión «Rinkel Webphone» (y cualquier
            // otra de clic para llamar), que con el botón de antes —solo copiaba— no lo detectaba. Copiar sigue a un clic, en su botón de al lado.
            // Un autónomo no se llama en frío (criterio de la Leyenda del Excel): su teléfono se queda como antes, solo para copiar.
            const marcable = esAutonomo ? null : normalizarTelefono(t)
            const iconoDeCopiar = copiado === 'telefono' ? <Check className="rend-pop h-3.5 w-3.5 text-[var(--ls-e-verde)]" aria-hidden /> : <Copy className="h-3.5 w-3.5 text-[var(--ls-t4)] transition-colors group-hover:text-[var(--ls-t1)]" aria-hidden />
            if (!marcable) {
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => copiar(t, 'telefono')}
                  title={esAutonomo ? 'Autónomo: no se llama en frío' : 'Copiar el teléfono'}
                  className={`group inline-flex h-8 items-center gap-2 rounded-[8px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-2.5 text-[13.5px] font-semibold tabular-nums text-[var(--ls-t1)] transition-colors hover:border-[var(--ls-acc-graf)] hover:bg-[var(--ls-sup3)] ${esAutonomo ? 'opacity-70' : ''}`}
                >
                  <Phone className="h-3.5 w-3.5 text-[var(--ls-t3)]" aria-hidden />
                  {t}
                  {iconoDeCopiar}
                </button>
              )
            }
            return (
              <span key={t} className="group inline-flex h-8 items-stretch overflow-hidden rounded-[8px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] transition-colors hover:border-[var(--ls-acc-graf)]">
                <a
                  href={`tel:${marcable}`}
                  title="Llamar (con la extensión de Rinkel)"
                  className="inline-flex items-center gap-2 px-2.5 text-[13.5px] font-semibold tabular-nums text-[var(--ls-t1)] transition-colors hover:bg-[var(--ls-sup3)]"
                >
                  <Phone className="h-3.5 w-3.5 text-[var(--ls-t3)] transition-colors group-hover:text-[var(--ls-e-verde)]" aria-hidden />
                  {t}
                </a>
                <button
                  type="button"
                  onClick={() => copiar(t, 'telefono')}
                  title="Copiar el teléfono"
                  aria-label="Copiar el teléfono"
                  className="inline-flex w-8 items-center justify-center border-l border-[var(--ls-linea2)] transition-colors hover:bg-[var(--ls-sup3)]"
                >
                  {iconoDeCopiar}
                </button>
              </span>
            )
          })}
          {correos.map((correo) => (
            // Lleva a Correo con el mensaje ya abierto y dirigido a él. Cold Calling se queda donde está (lib/correo/peticiones.ts)
            <button key={correo} type="button" onClick={() => escribirAlLead(lead, correo)} title={`Escribir a ${correo}`} className={`${BOTON.base} ${BOTON.secundario} !h-8 max-w-[240px] !px-2.5 !text-[12px]`}>
              <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden /> <span className="truncate">{correo}</span>
            </button>
          ))}
          {correos.length > 0 && !esSocio && (
            // Abre el mismo mensaje y la IA ya está escribiendo el borrador con los datos y el historial del lead (sin facturación). Se edita antes de enviar.
            // No para un partner: la IA escribe pensando en un vendedor (se le propone mejorar o entrar en Amazon) y a una gestoría o una agencia hay que proponerle otra cosa
            <button
              type="button"
              onClick={() => escribirAlLead(lead, correos[0], { ia: true })}
              title="Abre el correo y la IA lo escribe con los datos y el historial de este lead (sin facturación). Lo editas antes de enviar"
              className={`${BOTON.base} ${BOTON.secundario} !h-8 !px-2.5 !text-[12px]`}
            >
              <Sparkles className="h-3.5 w-3.5 text-[var(--ls-acc)]" aria-hidden /> Correo con IA
            </button>
          )}
          {/* Un solo botón que despliega el cuadro donde se escribe el mensaje (sugerido, de la lista o de la IA, siempre retocable); al enviarlo abre el chat
              del móvil del lead con ese texto y lo apunta en su historial tal cual (components/cold-calling/BotonDeWhatsapp.tsx).
              A un autónomo no se le llama en frío ni se le escribe por aquí: se le escribe por email */}
          {canEdit && !esAutonomo && <BotonDeWhatsapp lead={lead} telefonos={telefonos} currentUser={currentUser} />}
          {canEdit && <AnadirContacto lead={lead} guardar={patch} listo={'telefonos_extra' in lead && 'emails_extra' in lead} />}
          {esTienda && lead.web && (
            <a href={lead.web} target="_blank" rel="noopener noreferrer" className={`${BOTON.base} ${BOTON.secundario} !h-8 !px-2.5 !text-[12px]`}>
              <Globe className="h-3.5 w-3.5" aria-hidden /> Abrir la tienda <ExternalLink className="h-3 w-3 text-[var(--ls-t4)]" aria-hidden />
            </a>
          )}
          {!esTienda && !esSocio && lead.seller_url && (
            <a href={lead.seller_url} target="_blank" rel="noopener noreferrer" className={`${BOTON.base} ${BOTON.secundario} !h-8 !px-2.5 !text-[12px]`}>
              Ver en Amazon <ExternalLink className="h-3 w-3 text-[var(--ls-t4)]" aria-hidden />
            </a>
          )}
          {/* Los tres enlaces de un partner: su web, su LinkedIn y su ficha de Maps. Solo se abren si son http o https (urlSegura) */}
          {esSocio && urlSegura(lead.web) && (
            <a href={urlSegura(lead.web)!} target="_blank" rel="noopener noreferrer" className={`${BOTON.base} ${BOTON.secundario} !h-8 !px-2.5 !text-[12px]`}>
              <Globe className="h-3.5 w-3.5" aria-hidden /> Abrir la web <ExternalLink className="h-3 w-3 text-[var(--ls-t4)]" aria-hidden />
            </a>
          )}
          {esSocio && urlSegura(lead.linkedin) && (
            <a href={urlSegura(lead.linkedin)!} target="_blank" rel="noopener noreferrer" className={`${BOTON.base} ${BOTON.secundario} !h-8 !px-2.5 !text-[12px]`}>
              <Linkedin className="h-3.5 w-3.5" aria-hidden /> LinkedIn <ExternalLink className="h-3 w-3 text-[var(--ls-t4)]" aria-hidden />
            </a>
          )}
          {esSocio && urlSegura(lead.google_maps_url) && (
            <a href={urlSegura(lead.google_maps_url)!} target="_blank" rel="noopener noreferrer" className={`${BOTON.base} ${BOTON.secundario} !h-8 !px-2.5 !text-[12px]`}>
              <MapPin className="h-3.5 w-3.5" aria-hidden /> Maps <ExternalLink className="h-3 w-3 text-[var(--ls-t4)]" aria-hidden />
            </a>
          )}
        </div>

        {telefonoSinReconocer && (
          <p className="mx-4 mt-2 flex items-start gap-1.5 text-[11.5px] leading-snug text-[var(--ls-e-ambar)]">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Este teléfono no se reconoce como un número: las llamadas de Rinkel no se apuntarán solas en este lead. Corrígelo en la vista de tabla.</span>
          </p>
        )}

        {/* Autónomo: NO se llama en frío. Es un criterio de la Leyenda del Excel y la diferencia entre una llamada útil y una metedura de
            pata: va antes del estado porque el teléfono está justo encima */}
        {esAutonomo && (
          <div className="mx-4 mt-2 flex items-start gap-2 rounded-[6px] border border-[var(--ls-linea2)] border-l-2 bg-[var(--ls-sup2)] px-2.5 py-1.5 text-[11.5px] leading-snug text-[var(--ls-t2)]" style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--ls-e-ambar)]" aria-hidden />
            <p>
              <strong className="font-semibold text-[var(--ls-t1)]">{esSocio ? 'Persona física: no se llama en frío.' : 'Autónomo: no se llama en frío.'}</strong> A esta ficha se le escribe por email. El teléfono está ahí para confirmar datos, no para el primer contacto.
            </p>
          </div>
        )}

        {/* ¿VENDE YA EN AMAZON? ANTES DEL ESTADO. No es un dato más: es lo PRIMERO que se hace —30 segundos— y de la respuesta depende el
            discurso entero de la llamada. Puesto abajo, el comercial marca ya el teléfono antes de llegar */}
        {esTienda && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-2.5">
            <span className="flex items-center gap-1 text-[11px] font-semibold text-[var(--ls-t4)]">
              <ShoppingBag className="h-3 w-3" aria-hidden /> ¿Vende ya en Amazon?
            </span>
            <div role="group" aria-label="¿Vende ya en Amazon?" className="flex flex-wrap gap-1">
              {COLD_VENDE_ORDEN.map((v) => {
                const activo = lead.vende_en_amazon === v
                const color = COLD_VENDE_DOTS[v]
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => canEdit && ponerVende(v)}
                    disabled={!canEdit}
                    aria-pressed={activo}
                    title={COLD_VENDE_HINTS[v]}
                    className={`${BOTON.chip} !h-[24px] gap-1.5 disabled:opacity-50 ${activo ? '!text-[var(--ls-t1)] font-medium' : ''}`}
                    style={activo ? { background: `${color}26`, borderColor: `${color}99` } : undefined}
                  >
                    <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: color }} />
                    {COLD_VENDE_LABELS[v]}
                  </button>
                )
              })}
            </div>
            <span className="text-[11px] text-[var(--ls-t4)]">
              {lead.vende_en_amazon !== 'sin_comprobar'
                ? lead.vende_en_amazon_comprobado_en
                  ? `comprobado ${haceCuanto(lead.vende_en_amazon_comprobado_en)}`
                  : 'sin fecha de comprobación: vuelve a mirarlo'
                : 'son 30 segundos y cambia la llamada entera'}
            </span>
            {lead.vende_en_amazon === 'vende' && (
              <span className="basis-full text-[11px] leading-snug text-[var(--ls-e-rojo)]" title="Se sigue contando aparte por esta columna, porque que una tienda haya migrado a Amazon es información de mercado y no un «no» cualquiera.">
                Ya está dentro: descarta el lead con «No le interesa».
              </span>
            )}
          </div>
        )}

        {/* Estado y rellamada: lo que más se toca al colgar. Todo en un mismo bloque que envuelve: el día de rellamada va detrás de los
            estados y solo baja de línea si no cabe, en vez de ocupar siempre una fila propia */}
        <div role="group" aria-label="Estado de la gestión y rellamada" className="flex flex-wrap items-center gap-x-1 gap-y-1.5 px-4 pb-3 pt-2.5">
          {COLD_STATUSES.map((s) => {
            const activo = lead.status === s
            const { tono } = ESTADO_VISUAL[s]
            const c = chipDeEstado(activo, tono)
            return (
              <button key={s} type="button" onClick={() => canEdit && ponerEstado(s)} disabled={!canEdit} aria-pressed={activo} title={COLD_STATUS_HINTS[s]} className={c.className} style={c.style}>
                <span key={activo ? 'si' : 'no'} className={activo ? 'rend-pop' : ''}>
                  <GlifoDeEstado estado={s} tamano={13} />
                </span>
                {COLD_STATUS_LABELS[s]}
              </button>
            )
          })}

          <span aria-hidden className="mx-1 hidden h-4 w-px bg-[var(--ls-linea2)] sm:block" />

          <div className="flex items-center gap-1">
            <CalendarClock className="h-3.5 w-3.5 text-[var(--ls-t4)]" aria-hidden />
            <label htmlFor={`rellamar-${lead.id}`} className="sr-only">
              Rellamar el
            </label>
            <input
              id={`rellamar-${lead.id}`}
              type="date"
              value={lead.next_call_date ?? ''}
              onChange={(e) => ponerRellamada(e.target.value || null)}
              disabled={!canEdit}
              title={lead.next_call_date ? `Rellamar el ${diaConSemana(lead.next_call_date)}` : 'Sin día de rellamada'}
              className={`${CAMPO.input} !h-[26px] !w-[124px] [color-scheme:dark] [.light_&]:[color-scheme:light] disabled:opacity-50`}
            />
            {([
              ['+1 d', 1],
              ['+3 d', 3],
              ['+1 sem', 7],
            ] as const).map(([etiqueta, dias]) => (
              <button key={etiqueta} type="button" onClick={() => ponerRellamada(sumarDias(hoy, dias))} disabled={!canEdit} className={`${BOTON.chip} !h-[26px] !px-1.5 disabled:opacity-50`} title={`Rellamar ${diaConSemana(sumarDias(hoy, dias))}`}>
                {etiqueta}
              </button>
            ))}
            {lead.next_call_date && (
              <button type="button" onClick={() => ponerRellamada(null)} disabled={!canEdit} className={BOTON.icono} title="Quitar la rellamada" aria-label="Quitar la rellamada">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className={`grid gap-x-5 gap-y-4 p-4 ${dosColumnas ? 'grid-cols-[minmax(0,1fr)_minmax(250px,320px)]' : 'grid-cols-1'}`}>
          <section aria-label="Historial" className="min-w-0">
            <h3 className="mb-1.5 text-[11px] font-semibold text-[var(--ls-t3)]">Historial</h3>
            <HistorialDelLead key={lead.id} leadId={lead.id} currentUser={currentUser} nombres={nombres} version={version} onLogged={alApuntar} />
          </section>

          <aside className="min-w-0 space-y-4">
            <DatosDelLead lead={lead} esAutonomo={esAutonomo} />
            {/* Nota viva del lead. El seguimiento original del Excel está además como primera entrada del historial, así que se puede
                reescribir esto sin perder lo que ya se había apuntado */}
            <section>
              <h3 className="mb-0.5 text-[11px] font-semibold text-[var(--ls-t3)]">Nota del lead</h3>
              <textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                onBlur={() => {
                  const limpia = nota.trim() || null
                  if ((lead.follow_up ?? null) !== limpia) void patch({ follow_up: limpia })
                }}
                disabled={!canEdit}
                rows={4}
                placeholder="Contexto del lead, lo que se habló, con quién…"
                className="w-full resize-none rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2.5 py-2 text-[12.5px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)] focus:shadow-[inset_0_0_0_1px_var(--ls-acc-graf)] disabled:opacity-60"
              />
              <p className="mt-1 text-[11px] leading-snug text-[var(--ls-t4)]">
                {esTienda || esSocio
                  ? // De esta lista no se importó ningún seguimiento: las seis columnas de trabajo del Excel venían vacías, así que no hay nada viejo que se pueda pisar
                    'Resumen siempre a la vista. En esta lista empiezas de cero: lo que escribas aquí es lo primero que se ha apuntado del lead.'
                  : 'Resumen siempre a la vista. Lo que venía del Excel está también en el historial, así que puedes reescribirlo sin perderlo.'}
                {!esTienda && !esSocio && lead.action_label ? ` Etiqueta original: ${lead.action_label}.` : ''}
              </p>
            </section>
          </aside>
        </div>
      </div>

      <footer className="hidden shrink-0 items-center gap-3 border-t border-[var(--ls-linea)] px-4 py-1.5 text-[11px] text-[var(--ls-t4)] lg:flex">
        <span className="flex items-center gap-1">
          <Tecla>↑</Tecla>
          <Tecla>↓</Tecla> cambiar de lead
        </span>
        <span className="flex items-center gap-1">
          <Tecla>/</Tecla> buscar
        </span>
        <span className="ml-auto">⌘/Ctrl + Enter guarda un apunte</span>
      </footer>
    </div>
  )
}
