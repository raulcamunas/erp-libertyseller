'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { toMadrid } from '@/lib/timezone'
import {
  Phone,
  Mail,
  Building2,
  Euro,
  MapPin,
  Tag,
  ExternalLink,
  Users,
  CalendarClock,
  History,
  FileText,
  ChevronRight,
  Copy,
  ShoppingBag,
  Store,
  Instagram as InstagramIcon,
  Layers3,
  Package,
  Globe,
  BadgeCheck,
  AlertTriangle,
  UserSearch,
  TrendingUp,
} from 'lucide-react'
import {
  ColdLead,
  ColdLeadStatus,
  ColdNoteKind,
  ColdVendeAmazon,
  COLD_STATUSES,
  COLD_STATUS_LABELS,
  COLD_STATUS_HINTS,
  COLD_STATUS_DOTS,
  COLD_VENDE_ORDEN,
  COLD_VENDE_LABELS,
  COLD_VENDE_HINTS,
  COLD_VENDE_DOTS,
  COLD_NIVEL_LABELS,
  COLD_NIVEL_DOTS,
  COLD_TIPO_EMPRESA_LABELS,
  AVISO_VENTAS_ESTIMADAS,
  esTiendaOnline,
  formatVentasEstimadas,
  colorForList,
  formatRevenue,
} from '@/lib/types/cold-leads'
import { UserProfile } from '@/lib/supabase/get-user-profile'
import { ColdLeadNotes } from './ColdLeadNotes'

interface ColdLeadDetailProps {
  lead: ColdLead
  currentUser: UserProfile
  canEdit: boolean
  onPatched: (patch: Partial<ColdLead>) => void
  onNext: () => void
}

const ghostInput =
  'w-full bg-transparent hover:bg-white/[0.04] focus:bg-white/[0.06] border border-transparent focus:border-white/15 rounded-md px-2 py-1 text-[13px] text-white outline-none transition-colors placeholder:text-white/25'

function Section({
  icon,
  title,
  children,
}: {
  icon?: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <h3 className="text-[10px] font-semibold text-white/45 flex items-center gap-1.5 tracking-wider uppercase mb-1.5">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  )
}

function Row({ icon, label, children }: { icon?: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <div className="w-[104px] flex-shrink-0 flex items-center gap-1.5 text-[12px] text-white/40">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

function Value({ children }: { children: ReactNode }) {
  return <span className="text-[13px] text-white/80 px-2 break-words">{children}</span>
}

export function ColdLeadDetail({
  lead: listLead,
  currentUser,
  canEdit,
  onPatched,
  onNext,
}: ColdLeadDetailProps) {
  const supabase = createClient()

  // La lista solo trae lo justo para pintarse: los campos largos —
  // directivos, dirección, registro mercantil — se piden al abrir el lead.
  // Mientras llegan se enseña lo que ya se tiene, así que la ficha aparece
  // al instante y se completa sola.
  const [detail, setDetail] = useState<Partial<ColdLead>>({})
  const lead = { ...listLead, ...detail } as ColdLead

  useEffect(() => {
    let active = true
    setDetail({})
    supabase
      .from('cold_leads')
      .select(
        'directors, business_address, mercantile_registry, subcategory, amazon_start, action_label, ' +
          // Los de la lista nueva: no los trae la carga inicial por lo mismo
          // que los de arriba, y son los que rellenan «Datos de la tienda».
          'decisor, cargo_decisor, cif, tipo_empresa, n_administradores, plataforma, ' +
          'n_productos, anos_tienda, instagram, telefonos_extra, emails_extra, web, ' +
          'vende_en_amazon_comprobado_en'
      )
      .eq('id', listLead.id)
      .single()
      .then(({ data }) => {
        if (active && data) setDetail(data as Partial<ColdLead>)
      })
    return () => {
      active = false
    }
  }, [listLead.id, supabase])

  const [followUp, setFollowUp] = useState(listLead.follow_up ?? '')
  const [nextCall, setNextCall] = useState(listLead.next_call_date ?? '')

  useEffect(() => {
    setFollowUp(listLead.follow_up ?? '')
    setNextCall(listLead.next_call_date ?? '')
  }, [listLead.id, listLead.follow_up, listLead.next_call_date])

  async function patch(fields: Partial<ColdLead>) {
    const { error } = await supabase.from('cold_leads').update(fields).eq('id', lead.id)
    if (error) {
      console.error('Error guardando el lead:', error)
      toast.error('No se pudo guardar')
      return
    }

    // HAY QUE REFRESCAR TAMBIÉN `detail`, NO SOLO LA LISTA.
    //
    // La ficha se pinta con `{ ...listLead, ...detail }`, y `detail` va LA
    // ÚLTIMA: lo que se pidió aparte al abrir el lead gana. Así que guardar un
    // campo que vive en esa segunda consulta y avisar solo a la lista deja el
    // valor viejo pintado encima del nuevo hasta que se cambia de lead.
    //
    // Lo que lo destapa es `vende_en_amazon_comprobado_en`: el comercial marca
    // «no vende», se sella la fecha en la base, y la ficha le sigue diciendo
    // «sin fecha de comprobación: vuelve a mirarlo» sobre algo que acaba de
    // mirar. Justo la frase que tenía que distinguir «lo hemos comprobado» de
    // «nadie lo ha mirado».
    //
    // Solo se tocan las claves que `detail` ya tiene. Meter las demás lo
    // convertiría en una copia paralela del lead que taparía lo que llegue
    // luego por realtime desde otro comercial.
    setDetail((previo) => {
      const suyas = Object.entries(fields).filter(([campo]) => campo in previo)
      if (suyas.length === 0) return previo
      return { ...previo, ...(Object.fromEntries(suyas) as Partial<ColdLead>) }
    })

    onPatched(fields)
  }

  /** Cambiar estado deja constancia de cuándo se tocó por última vez */
  function setStatus(status: ColdLeadStatus) {
    if (status === lead.status) return
    patch({ status, last_contacted_at: new Date().toISOString() })
  }

  /** Al registrar una llamada se suma intento y se sella la fecha */
  function handleLogged(kind: ColdNoteKind) {
    const fields: Partial<ColdLead> = { last_contacted_at: new Date().toISOString() }
    if (kind === 'llamada') fields.call_attempts = (lead.call_attempts ?? 0) + 1
    patch(fields)
  }

  /**
   * LO QUE DECIDE LA FICHA ENTERA.
   *
   * Sale de `tipo_lead` y no de `source_list`: ver el comentario del tipo en
   * lib/types/cold-leads.ts. Con el texto de la lista, un acento de más le
   * pintaría a una tienda online los bloques de vendedor de Amazon y le
   * esconderÍa el de «¿Vende ya en Amazon?», sin dar ningún error.
   */
  const esTienda = esTiendaOnline(lead)

  /**
   * Marcar si vende o no sella SIEMPRE la fecha, y desmarcar la borra.
   *
   * El sello es lo único que distingue «lo hemos mirado y no vende» de «nadie
   * lo ha mirado». Un 'no_vende' de hace cuatro meses ya no vale: la tienda
   * puede haber entrado en Amazon desde entonces, y sin fecha se leería como
   * fresco y se llamaría con el discurso equivocado.
   */
  function setVendeEnAmazon(valor: ColdVendeAmazon) {
    if (valor === lead.vende_en_amazon) return
    patch({
      vende_en_amazon: valor,
      vende_en_amazon_comprobado_en:
        valor === 'sin_comprobar' ? null : new Date().toISOString(),
    })
  }

  /** Si es autónomo NO se llama en frío. Criterio de la Leyenda del Excel */
  const esAutonomo = esTienda && lead.tipo_empresa === 'autonomo'

  const [extrasAbiertos, setExtrasAbiertos] = useState(false)
  const tieneExtras = Boolean(lead.telefonos_extra || lead.emails_extra)

  return (
    <div className="h-full overflow-y-auto p-4 space-y-3">
      {/* Cabecera del lead */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        className="flex items-start justify-between gap-3"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-white text-lg font-semibold truncate">{lead.store_name}</h2>
            {lead.source_list && (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded border leading-none whitespace-nowrap flex-shrink-0"
                style={{
                  color: colorForList(lead.source_list),
                  borderColor: `${colorForList(lead.source_list)}55`,
                  backgroundColor: `${colorForList(lead.source_list)}1a`,
                }}
                title="Lista del Excel de la que viene este lead"
              >
                {lead.source_list}
              </span>
            )}
            {lead.nivel != null && COLD_NIVEL_LABELS[lead.nivel] && (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded border leading-none whitespace-nowrap flex-shrink-0"
                style={{
                  color: COLD_NIVEL_DOTS[lead.nivel],
                  borderColor: `${COLD_NIVEL_DOTS[lead.nivel]}55`,
                  backgroundColor: `${COLD_NIVEL_DOTS[lead.nivel]}1a`,
                }}
                title="Nivel de prioridad de la lista"
              >
                Nivel {lead.nivel} · {COLD_NIVEL_LABELS[lead.nivel]}
              </span>
            )}
          </div>
          <p className="text-[12px] text-white/40 truncate">
            {lead.company || 'Sin empresa'}
            {/* La cifra de ventas estimadas NO sube a la cabecera. Es una
                estimación de tráfico en dólares y aquí se leería como
                facturación; vive en su bloque, con la advertencia al lado. */}
            {!esTienda && lead.revenue_monthly != null
              ? ` · ${formatRevenue(lead.revenue_monthly)}/mes`
              : ''}
            {lead.call_attempts > 0
              ? ` · ${lead.call_attempts} ${
                  lead.call_attempts === 1 ? 'intento' : 'intentos'
                }`
              : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            type="button"
            onClick={onNext}
            title="Siguiente lead sin contactar"
            className="h-9 px-3 rounded-full border border-white/10 bg-white/[0.03] text-white/70 text-[13px] font-medium flex items-center gap-1 hover:bg-white/[0.06] hover:text-white transition-colors"
          >
            Siguiente <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </motion.div>

      {/* AUTÓNOMO: NO SE LLAMA EN FRÍO.
          Es un criterio de la Leyenda del Excel que hasta ahora no tenía dónde
          vivir, y la diferencia entre una llamada útil y una metedura de pata.
          Va antes que cualquier otra cosa porque el botón de llamar está justo
          debajo. */}
      {esAutonomo && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0 mt-[1px]" />
          <p className="text-[12px] text-amber-200/90 leading-snug">
            <span className="font-semibold">Autónomo: no se llama en frío.</span>{' '}
            A esta ficha se le escribe por email. El teléfono está ahí para
            confirmar datos, no para el primer contacto.
          </p>
        </div>
      )}

      {/* ¿VENDE YA EN AMAZON? ARRIBA DEL TODO, ANTES DEL ESTADO DE GESTIÓN.
          No es un dato más del bloque de datos: es lo PRIMERO que se hace —30
          segundos— y de la respuesta depende el discurso entero de la llamada.
          Puesto abajo, el comercial marca ya el teléfono antes de llegar. */}
      {esTienda && (
        <Section icon={<ShoppingBag className="h-3 w-3" />} title="¿Vende ya en Amazon?">
          <div className="flex flex-wrap gap-1.5">
            {COLD_VENDE_ORDEN.map((v) => {
              const active = lead.vende_en_amazon === v
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => canEdit && setVendeEnAmazon(v)}
                  disabled={!canEdit}
                  title={COLD_VENDE_HINTS[v]}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all flex items-center gap-1.5 disabled:opacity-50 ${
                    active
                      ? 'text-white ring-1 ring-white/25'
                      : 'border-white/10 text-white/45 hover:text-white/85 hover:border-white/25'
                  }`}
                  style={
                    active
                      ? {
                          backgroundColor: `${COLD_VENDE_DOTS[v]}26`,
                          borderColor: `${COLD_VENDE_DOTS[v]}80`,
                        }
                      : undefined
                  }
                >
                  <span
                    className="h-2 w-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: COLD_VENDE_DOTS[v] }}
                  />
                  {COLD_VENDE_LABELS[v]}
                </button>
              )
            })}
          </div>
          <p className="text-[10px] text-white/35 mt-1.5 leading-snug">
            {COLD_VENDE_HINTS[lead.vende_en_amazon]}
            {/* La fecha, siempre que haya. Un «no vende» sin fecha se lee como
                recién comprobado, y a los cuatro meses puede ser falso. */}
            {lead.vende_en_amazon !== 'sin_comprobar' && (
              <>
                {' · '}
                {lead.vende_en_amazon_comprobado_en
                  ? `comprobado el ${format(
                      toMadrid(lead.vende_en_amazon_comprobado_en),
                      "d MMM yyyy, HH:mm",
                      { locale: es }
                    )}`
                  : 'sin fecha de comprobación: vuelve a mirarlo'}
              </>
            )}
          </p>
          {lead.vende_en_amazon === 'vende' && (
            <p className="text-[10px] text-red-300/80 mt-1 leading-snug">
              Ya está dentro: descarta el lead con «No le interesa». Se sigue
              contando aparte por esta columna, porque que una tienda haya
              migrado a Amazon es información de mercado y no un «no» cualquiera.
            </p>
          )}
        </Section>
      )}

      {/* Estado: lo que más se toca, arriba del todo */}
      <Section title="Estado de la gestión">
        <div className="flex flex-wrap gap-1.5">
          {COLD_STATUSES.map((s) => {
            const active = lead.status === s
            return (
              <button
                key={s}
                type="button"
                onClick={() => canEdit && setStatus(s)}
                disabled={!canEdit}
                title={COLD_STATUS_HINTS[s]}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all flex items-center gap-1.5 disabled:opacity-50 ${
                  active
                    ? 'text-white ring-1 ring-white/25'
                    : 'border-white/10 text-white/45 hover:text-white/85 hover:border-white/25'
                }`}
                style={
                  active
                    ? {
                        backgroundColor: `${COLD_STATUS_DOTS[s]}26`,
                        borderColor: `${COLD_STATUS_DOTS[s]}80`,
                      }
                    : undefined
                }
              >
                <span
                  className="h-2 w-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: COLD_STATUS_DOTS[s] }}
                />
                {COLD_STATUS_LABELS[s]}
              </button>
            )
          })}
        </div>
        <p className="text-[10px] text-white/30 mt-1.5">{COLD_STATUS_HINTS[lead.status]}</p>

        <div className="mt-2 pt-2 border-t border-white/[0.06]">
          <Row icon={<CalendarClock className="h-3 w-3" />} label="Rellamar el">
            <input
              type="date"
              value={nextCall}
              onChange={(e) => {
                setNextCall(e.target.value)
                patch({ next_call_date: e.target.value || null })
              }}
              disabled={!canEdit}
              className={`${ghostInput} [color-scheme:dark]`}
            />
          </Row>
          {/* LOS INTENTOS, PEGADOS A LA FECHA DE RELLAMADA Y NO ESCONDIDOS EN
              LA CABECERA. En esta línea las citas caen A PARTIR DEL TERCER
              toque, así que «llevo dos» y «llevo seis» son dos decisiones
              distintas y hay que verlo justo al elegir el día. */}
          <Row icon={<History className="h-3 w-3" />} label="Intentos">
            <Value>
              {lead.call_attempts > 0 ? (
                <>
                  {lead.call_attempts}
                  {lead.call_attempts < 3 && (
                    <span className="text-white/40">
                      {' · las citas suelen caer a partir del tercero'}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-white/40">sin llamadas todavía</span>
              )}
            </Value>
          </Row>
          {lead.last_contacted_at && (
            <Row icon={<History className="h-3 w-3" />} label="Último contacto">
              <Value>
                {format(toMadrid(lead.last_contacted_at), "d MMM yyyy, HH:mm", { locale: es })}
              </Value>
            </Row>
          )}
          {/* «Resultado» del Excel. Antes vivía en letra pequeña al pie de la
              nota; en esta lista es la etiqueta del último toque y pertenece
              aquí, junto al estado. */}
          {lead.action_label && (
            <Row icon={<BadgeCheck className="h-3 w-3" />} label="Resultado">
              <Value>{lead.action_label}</Value>
            </Row>
          )}
        </div>
      </Section>

      {/* Contacto */}
      <Section icon={<Phone className="h-3 w-3" />} title="Contacto">
        <div className="space-y-0.5">
          <Row icon={<Phone className="h-3 w-3" />} label="Teléfono">
            {lead.phone ? (
              <span className="flex items-center gap-1.5 px-2">
                <span className="text-[13px] text-white/85 break-all">{lead.phone}</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(lead.phone!)
                    toast.success('Teléfono copiado')
                  }}
                  className={`transition-colors flex-shrink-0 ${
                    // Atenuado en los autónomos: el teléfono sigue ahí porque a
                    // veces hay que confirmar un dato, pero copiarlo no debería
                    // ser el gesto natural de esta ficha.
                    esAutonomo
                      ? 'text-white/15 hover:text-white/40'
                      : 'text-white/30 hover:text-white'
                  }`}
                  title={esAutonomo ? 'Autónomo: no se llama en frío' : 'Copiar'}
                >
                  <Copy className="h-3 w-3" />
                </button>
              </span>
            ) : (
              <Value>—</Value>
            )}
          </Row>
          <Row icon={<Mail className="h-3 w-3" />} label="Email">
            {lead.email ? (
              <a
                href={`mailto:${lead.email.split(/[\s/,;]+/)[0]}`}
                className="text-[13px] text-white/80 hover:text-[#FF6600] px-2 transition-colors break-all"
              >
                {lead.email}
              </a>
            ) : (
              <Value>—</Value>
            )}
          </Row>
          {/* `directors` es del vendedor de Amazon. En una tienda online la
              persona vive en su propio bloque, separada de su cargo. */}
          {!esTienda && (
            <Row icon={<Users className="h-3 w-3" />} label="Directivos">
              <Value>{lead.directors || '—'}</Value>
            </Row>
          )}
          {esTienda && lead.instagram && (
            <Row icon={<InstagramIcon className="h-3 w-3" />} label="Instagram">
              <a
                href={lead.instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] text-white/80 hover:text-[#FF6600] px-2 transition-colors break-all"
              >
                {lead.instagram.replace(/^https?:\/\/(www\.)?instagram\.com\//, '@')}
              </a>
            </Row>
          )}

          {/* TELÉFONOS Y EMAILS EXTRA, COLAPSADOS.
              Van aparte de `phone` y `email` porque telHref() y el mailto: cogen
              el primero de la cadena: apilarlos arriba los dejaría invisibles
              para los enlaces aunque se vieran en pantalla. Y colapsados porque
              son el segundo intento, no el primero. */}
          {tieneExtras && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setExtrasAbiertos((v) => !v)}
                className="text-[11px] text-white/35 hover:text-white/70 transition-colors flex items-center gap-1"
              >
                <ChevronRight
                  className={`h-3 w-3 transition-transform ${extrasAbiertos ? 'rotate-90' : ''}`}
                />
                Más teléfonos y emails
              </button>
              {extrasAbiertos && (
                <div className="mt-1 space-y-0.5">
                  {lead.telefonos_extra && (
                    <Row icon={<Phone className="h-3 w-3" />} label="Tel. extra">
                      <Value>{lead.telefonos_extra}</Value>
                    </Row>
                  )}
                  {lead.emails_extra && (
                    <Row icon={<Mail className="h-3 w-3" />} label="Emails extra">
                      <Value>{lead.emails_extra}</Value>
                    </Row>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </Section>

      {/* EL DECISOR, EN SU PROPIO BLOQUE.
          Es el administrador activo del BORME. Cuando falta —607 de cada
          1.000— NO se pinta un guion: un guion repetido en seis de cada diez
          fichas no dice qué hacer, y lo que hay que hacer es preguntar por el
          responsable al descolgar. */}
      {esTienda && (
        <Section icon={<UserSearch className="h-3 w-3" />} title="Decisor">
          {lead.decisor ? (
            <div className="space-y-0.5">
              <Row icon={<Users className="h-3 w-3" />} label="Nombre">
                <Value>{lead.decisor}</Value>
              </Row>
              <Row icon={<BadgeCheck className="h-3 w-3" />} label="Cargo">
                <Value>{lead.cargo_decisor || 'sin cargo en el BORME'}</Value>
              </Row>
            </div>
          ) : (
            <p className="text-[12px] text-white/70 px-0.5 leading-snug">
              <span className="font-semibold text-white/85">
                Pregunta por el responsable.
              </span>{' '}
              El BORME no da administrador activo para esta empresa
              {lead.n_administradores === 0
                ? ' (cero administradores registrados)'
                : ''}
              , así que el nombre hay que sacarlo en la llamada.
            </p>
          )}
        </Section>
      )}

      {/* DATOS DE LA TIENDA: el bloque equivalente para la lista nueva.
          Es otro bloque y no el de abajo con cuatro `{lead.x && ...}` más,
          porque cuatro de las filas de abajo —Provincia, Facturación,
          Categoría, Directivos— se pintan SIEMPRE, con un guion si están
          vacías: en una tienda online serían cuatro guiones fijos y un
          «Provincia: —» que además es mentira, porque la geografía está en
          Ciudad. */}
      {esTienda && (
        <Section icon={<Store className="h-3 w-3" />} title="Datos de la tienda">
          <div className="space-y-0.5">
            {/* LA CIFRA, CON LA ADVERTENCIA PEGADA Y NO EN UN TOOLTIP.
                Son dólares de un modelo de tráfico, no facturación observada, y
                esto es lo que el comercial tiene abierto MIENTRAS habla por
                teléfono. Por eso no lleva el símbolo del euro ni vive en la
                cabecera, y por eso la frase se lee sin pasar el ratón. */}
            <Row icon={<TrendingUp className="h-3 w-3" />} label="Ventas est.">
              <span className="px-2 block">
                <span className="text-[13px] text-white/80">
                  {formatVentasEstimadas(lead.ventas_estimadas_usd)}
                  {lead.ventas_estimadas_usd != null ? ' / mes' : ''}
                </span>
                <span className="block text-[10px] text-amber-300/70 leading-snug">
                  {AVISO_VENTAS_ESTIMADAS}
                </span>
              </span>
            </Row>
            <Row icon={<Building2 className="h-3 w-3" />} label="Razón social">
              <Value>{lead.company || 'Sin razón social en el BORME'}</Value>
            </Row>
            <Row icon={<FileText className="h-3 w-3" />} label="CIF">
              <Value>{lead.cif || '—'}</Value>
            </Row>
            <Row icon={<BadgeCheck className="h-3 w-3" />} label="Tipo">
              <Value>
                {lead.tipo_empresa
                  ? COLD_TIPO_EMPRESA_LABELS[lead.tipo_empresa]
                  : 'sin determinar'}
              </Value>
            </Row>
            <Row icon={<Users className="h-3 w-3" />} label="Admin. activos">
              <Value>{lead.n_administradores ?? '—'}</Value>
            </Row>
            <Row icon={<Tag className="h-3 w-3" />} label="Sector">
              <Value>{lead.category || '—'}</Value>
            </Row>
            <Row icon={<MapPin className="h-3 w-3" />} label="Ciudad">
              <Value>{lead.ciudad || 'sin ciudad'}</Value>
            </Row>
            <Row icon={<CalendarClock className="h-3 w-3" />} label="Antigüedad">
              <Value>
                {lead.anos_tienda != null
                  ? `${String(lead.anos_tienda).replace('.', ',')} años`
                  : '—'}
              </Value>
            </Row>
            <Row icon={<Layers3 className="h-3 w-3" />} label="Plataforma">
              <Value>{lead.plataforma || '—'}</Value>
            </Row>
            <Row icon={<Package className="h-3 w-3" />} label="Nº productos">
              <Value>
                {lead.n_productos != null
                  ? lead.n_productos.toLocaleString('es-ES')
                  : '—'}
              </Value>
            </Row>
            {lead.web && (
              <Row icon={<Globe className="h-3 w-3" />} label="Web">
                {/* Rótulo «Abrir la tienda» y NO «Ver en Amazon»: ese otro
                    rótulo es fijo y pertenece a `seller_url`, que aquí no hay. */}
                <a
                  href={lead.web}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] text-white/80 hover:text-[#FF6600] px-2 transition-colors inline-flex items-center gap-1"
                >
                  Abrir la tienda <ExternalLink className="h-3 w-3" />
                </a>
              </Row>
            )}
          </div>
        </Section>
      )}

      {/* Datos del seller: solo para los leads que YA venden en Amazon */}
      {!esTienda && (
      <Section icon={<Building2 className="h-3 w-3" />} title="Datos del seller">
        <div className="space-y-0.5">
          <Row icon={<Building2 className="h-3 w-3" />} label="Empresa">
            <Value>{lead.company || '—'}</Value>
          </Row>
          <Row icon={<Euro className="h-3 w-3" />} label="Facturación">
            <Value>
              {lead.revenue_monthly != null
                ? `${formatRevenue(lead.revenue_monthly)} / mes`
                : '—'}
            </Value>
          </Row>
          {lead.amazon_start && (
            <Row icon={<CalendarClock className="h-3 w-3" />} label="Vende desde">
              <Value>{lead.amazon_start}</Value>
            </Row>
          )}
          <Row icon={<MapPin className="h-3 w-3" />} label="Provincia">
            <Value>{lead.province || '—'}</Value>
          </Row>
          <Row icon={<Tag className="h-3 w-3" />} label="Categoría">
            <Value>
              {[lead.category, lead.subcategory].filter(Boolean).join(' · ') || '—'}
            </Value>
          </Row>
          {lead.seller_url && (
            <Row icon={<ExternalLink className="h-3 w-3" />} label="Perfil seller">
              <a
                href={lead.seller_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] text-white/80 hover:text-[#FF6600] px-2 transition-colors inline-flex items-center gap-1"
              >
                Ver en Amazon <ExternalLink className="h-3 w-3" />
              </a>
            </Row>
          )}
          {lead.business_address && (
            <Row icon={<MapPin className="h-3 w-3" />} label="Dirección">
              <Value>{lead.business_address}</Value>
            </Row>
          )}
          {lead.mercantile_registry && (
            <Row icon={<FileText className="h-3 w-3" />} label="Reg. mercantil">
              <Value>{lead.mercantile_registry}</Value>
            </Row>
          )}
        </div>
      </Section>
      )}

      {/* Interacciones */}
      <Section icon={<History className="h-3 w-3" />} title="Interacciones">
        <ColdLeadNotes
          key={lead.id}
          leadId={lead.id}
          currentUser={currentUser}
          onLogged={handleLogged}
        />
      </Section>

      {/* Nota viva del lead. El seguimiento original del Excel está además
          como primera entrada del historial, así que se puede reescribir
          esto sin perder lo que ya se había apuntado. */}
      <Section icon={<FileText className="h-3 w-3" />} title="Nota del lead">
        <textarea
          value={followUp}
          onChange={(e) => setFollowUp(e.target.value)}
          onBlur={() => {
            const clean = followUp.trim() || null
            if ((lead.follow_up ?? null) !== clean) patch({ follow_up: clean })
          }}
          disabled={!canEdit}
          rows={4}
          placeholder="Contexto del lead, lo que se habló, con quién..."
          className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-2.5 py-2 text-[12px] text-white outline-none focus:border-[#FF6600] transition-colors resize-none placeholder:text-white/25 disabled:opacity-60"
        />
        <p className="text-[10px] text-white/25 mt-1.5">
          {esTienda
            ? // De esta lista no se importó ningún seguimiento: las seis
              // columnas de trabajo del Excel venían vacías, así que aquí no
              // hay nada viejo que se pueda pisar.
              'Resumen siempre a la vista. En esta lista empiezas de cero: lo que escribas aquí es lo primero que se ha apuntado del lead.'
            : 'Resumen siempre a la vista. Lo que venía del Excel está también en el historial de arriba, así que puedes reescribir esto sin perderlo.'}
          {/* En las tiendas online el «Resultado» ya está arriba, en el bloque
              de estado: repetirlo aquí en letra pequeña sobra. */}
          {!esTienda && lead.action_label
            ? ` · Etiqueta original: ${lead.action_label}`
            : ''}
        </p>
      </Section>
    </div>
  )
}
