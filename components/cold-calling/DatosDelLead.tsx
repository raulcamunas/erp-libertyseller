'use client'

import { ChevronRight, Contact, Copy, ExternalLink, Handshake, Link2, ShoppingBag, Store, UserRound, Users, type LucideIcon } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { agruparPorCargo, parsearDirectivos } from '@/lib/cold-calling/directivos'
import { busquedasDeOrigen, dominioDeWeb, esPrioridadDePartner, PRIORIDADES_DE_PARTNER, textoDeLinkedin, urlSegura, valoracionDe } from '@/lib/cold-calling/partners'
import { InsigniaDePrioridad } from './ui'
import { useEscribirAlLead } from './useEscribirAlLead'
import {
  AVISO_VENTAS_ESTIMADAS,
  COLD_TIPO_EMPRESA_LABELS,
  esPartner,
  esTiendaOnline,
  formatRevenue,
  formatVentasEstimadas,
  type ColdLead,
} from '@/lib/types/cold-leads'

/**
 * LOS DATOS DE UN LEAD, en CAJITAS: cada bloque (contacto, directivos, el vendedor, la tienda…) es una caja con su título y, dentro, un
 * mosaico de casillas con la etiqueta pequeña arriba y el valor debajo.
 *
 * Antes eran filas de «etiqueta · valor» en una sola columna: lo corto (una provincia, un CIF) dejaba media línea vacía y lo largo (los
 * directivos, una dirección) se partía en cinco líneas sin que se viera dónde acababa uno y empezaba otro. Ahora lo corto va de dos en dos,
 * lo largo ocupa la fila entera y cada directivo es su propia casilla.
 *
 * Los usan la ficha y el desplegable de la tabla, así que hay UN solo sitio donde se decide qué se enseña de una tienda online y qué
 * de un vendedor de Amazon. Lo que no hay se escribe «—» en el nivel de texto más bajo, no se esconde la casilla: «no se sabe» también es
 * un dato (un decisor vacío en seis de cada diez fichas es justo lo que dice «pregunta por el responsable»).
 *
 * El criterio de cada bloque viene de la Leyenda del Excel del equipo y está en los comentarios de abajo: no se pierde con el rediseño.
 *
 * UN PARTNER (agencia, fulfillment, registro de marcas, gestoría) NO ES UN CLIENTE: no tiene facturación, ni decisor del BORME, ni «¿vende en Amazon?». Tiene los datos de Google
 * Maps —prioridad, puntos, valoración, categoría, con qué búsquedas se encontró— y tres enlaces (su web, su LinkedIn y su ficha de Maps). Por eso tiene sus dos cajas propias y no
 * pasa por las del vendedor ni las de la tienda.
 */

/** Una caja: título con su icono, y, si hace falta, una acción a la derecha (el enlace al perfil) */
function Caja({ titulo, icono: Icono, cuenta, accion, children }: { titulo: string; icono: LucideIcon; cuenta?: number; accion?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-2.5">
      <h3 className="mb-2 flex min-h-[18px] items-center gap-1.5 text-[11px] font-semibold text-[var(--ls-t3)]">
        <Icono className="h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)]" aria-hidden />
        <span className="truncate">{titulo}</span>
        {cuenta != null && <span className="rounded-full bg-[var(--ls-sup3)] px-1.5 text-[10px] font-medium tabular-nums leading-[16px] text-[var(--ls-t3)]">{cuenta}</span>}
        {accion && <span className="ml-auto shrink-0 font-normal">{accion}</span>}
      </h3>
      {children}
    </section>
  )
}

/** El mosaico: las casillas cortas se reparten de dos en dos (o más, si la caja es ancha); las largas ocupan la fila */
function Mosaico({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1.5">{children}</dl>
}

function Casilla({ etiqueta, children, entera = false }: { etiqueta: string; children: ReactNode; entera?: boolean }) {
  return (
    <div className={`min-w-0 rounded-[7px] bg-[var(--ls-sup)] px-2 py-1.5 ${entera ? 'col-span-full' : ''}`}>
      <dt className="truncate text-[10.5px] font-semibold text-[var(--ls-t4)]">{etiqueta}</dt>
      <dd className="mt-0.5 min-w-0 break-words text-[12.5px] leading-snug text-[var(--ls-t1)]">{children}</dd>
    </div>
  )
}

const Vacio = ({ texto = '—' }: { texto?: string }) => <span className="text-[var(--ls-t4)]">{texto}</span>

const enlace = 'inline-flex items-center gap-1 text-[var(--ls-t2)] underline-offset-2 transition-colors hover:text-[var(--ls-acc)] hover:underline'

/** Cuántos directivos se enseñan antes de ofrecer «ver todos»: una empresa con doce administradores no se come la ficha */
const DIRECTIVOS_VISIBLES = 8

interface Props {
  lead: ColdLead
  /** El teléfono y el correo principales. En la ficha ya están en la cabecera; en el desplegable de la tabla no */
  conContacto?: boolean
  /** Si es autónomo, el teléfono se atenúa: está para confirmar datos, no para el primer contacto */
  esAutonomo?: boolean
}

function copiar(texto: string, aviso: string) {
  void navigator.clipboard.writeText(texto)
  toast.success(aviso)
}

export function DatosDelLead({ lead, conContacto = false, esAutonomo = false }: Props) {
  const [extrasAbiertos, setExtrasAbiertos] = useState(false)
  const [todosLosDirectivos, setTodosLosDirectivos] = useState(false)
  const escribirAlLead = useEscribirAlLead()
  const esTienda = esTiendaOnline(lead)
  const esSocio = esPartner(lead)
  const tieneExtras = Boolean(lead.telefonos_extra || lead.emails_extra)

  // `directors` es del vendedor de Amazon. En una tienda online la persona vive en su propio bloque («Decisor»); un partner no tiene ninguno de los dos
  const grupos = useMemo(() => (esTienda || esSocio ? [] : agruparPorCargo(parsearDirectivos(lead.directors))), [esTienda, esSocio, lead.directors])
  const totalDirectivos = grupos.reduce((n, g) => n + g.nombres.length, 0)
  const recortar = !todosLosDirectivos && totalDirectivos > DIRECTIVOS_VISIBLES

  // Con el recorte puesto se enseñan los primeros, grupo a grupo, hasta llegar al tope
  let restantes = recortar ? DIRECTIVOS_VISIBLES : Infinity
  const gruposVisibles = grupos
    .map((g) => {
      const nombres = g.nombres.slice(0, Math.max(0, restantes))
      restantes -= nombres.length
      return { ...g, nombres }
    })
    .filter((g) => g.nombres.length > 0)

  return (
    <div className="space-y-2">
      {(conContacto || (esTienda && lead.instagram) || tieneExtras) && (
        <Caja titulo="Contacto" icono={Contact}>
          <Mosaico>
            {conContacto && (
              <>
                <Casilla etiqueta="Teléfono">
                  {lead.phone ? (
                    <button
                      type="button"
                      onClick={() => copiar(lead.phone!, 'Teléfono copiado')}
                      title={esAutonomo ? (esSocio ? 'Persona física: no se llama en frío' : 'Autónomo: no se llama en frío') : 'Copiar el teléfono'}
                      className={`inline-flex items-center gap-1 transition-colors hover:text-[var(--ls-acc)] ${esAutonomo ? 'opacity-60' : ''}`}
                    >
                      {lead.phone}
                      <Copy className="h-3 w-3 shrink-0 text-[var(--ls-t4)]" aria-hidden />
                    </button>
                  ) : (
                    <Vacio />
                  )}
                </Casilla>
                <Casilla etiqueta="Email">
                  {lead.email ? (
                    <button type="button" onClick={() => escribirAlLead(lead)} title={`Escribir a ${lead.email}`} className={`${enlace} break-all text-left`}>
                      {lead.email}
                    </button>
                  ) : (
                    <Vacio />
                  )}
                </Casilla>
              </>
            )}

            {esTienda && lead.instagram && (
              <Casilla etiqueta="Instagram">
                <a href={lead.instagram} target="_blank" rel="noopener noreferrer" className={`${enlace} break-all`}>
                  {lead.instagram.replace(/^https?:\/\/(www\.)?instagram\.com\//, '@')}
                </a>
              </Casilla>
            )}

            {/* Teléfonos y emails extra, COLAPSADOS: van aparte de `phone` y `email` porque los enlaces de llamar y de escribir cogen el
                primero de la cadena, y apilarlos arriba los dejaría invisibles para ellos. Y colapsados porque son el segundo intento */}
            {tieneExtras && (
              <div className="col-span-full">
                <button type="button" onClick={() => setExtrasAbiertos((v) => !v)} aria-expanded={extrasAbiertos} className="flex items-center gap-1 text-[11px] text-[var(--ls-t3)] transition-colors hover:text-[var(--ls-t1)]">
                  <ChevronRight className={`h-3 w-3 transition-transform ${extrasAbiertos ? 'rotate-90' : ''}`} aria-hidden />
                  Más teléfonos y emails
                </button>
                {extrasAbiertos && (
                  <dl className="rend-entra mt-1.5 grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1.5">
                    {lead.telefonos_extra && <Casilla etiqueta="Tel. extra">{lead.telefonos_extra}</Casilla>}
                    {lead.emails_extra && <Casilla etiqueta="Emails extra">{lead.emails_extra}</Casilla>}
                  </dl>
                )}
              </div>
            )}
          </Mosaico>
        </Caja>
      )}

      {/* LOS DIRECTIVOS, CADA UNO EN SU CASILLA Y AGRUPADOS POR CARGO. Eran una cadena de nombres en mayúsculas separados por «;». Pulsar uno
          lo copia: es lo que se necesita al descolgar («¿puedo hablar con Julián?») */}
      {totalDirectivos > 0 && (
        <Caja titulo="Directivos" icono={Users} cuenta={totalDirectivos}>
          <div className="space-y-2">
            {gruposVisibles.map((g) => (
              <div key={g.cargo ?? 'sin-cargo'}>
                {g.cargo && <p className="mb-1 text-[10.5px] font-semibold text-[var(--ls-t4)]">{g.cargo}</p>}
                <ul className="flex flex-wrap gap-1.5">
                  {g.nombres.map((nombre) => (
                    <li key={nombre}>
                      <button
                        type="button"
                        onClick={() => copiar(nombre, 'Nombre copiado')}
                        title="Copiar el nombre"
                        className="rounded-[7px] bg-[var(--ls-sup)] px-2 py-1 text-left text-[12.5px] leading-snug text-[var(--ls-t1)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-acc)]"
                      >
                        {nombre}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {totalDirectivos > DIRECTIVOS_VISIBLES && (
            <button type="button" onClick={() => setTodosLosDirectivos((v) => !v)} aria-expanded={todosLosDirectivos} className="mt-2 flex items-center gap-1 text-[11px] text-[var(--ls-t3)] transition-colors hover:text-[var(--ls-t1)]">
              <ChevronRight className={`h-3 w-3 transition-transform ${todosLosDirectivos ? 'rotate-90' : ''}`} aria-hidden />
              {todosLosDirectivos ? 'Ver menos' : `Ver los ${totalDirectivos}`}
            </button>
          )}
        </Caja>
      )}

      {/* EL DECISOR, EN SU PROPIA CAJA. Es el administrador activo del BORME. Cuando falta —607 de cada 1.000— NO se pinta un guion: un
          guion repetido en seis de cada diez fichas no dice qué hacer, y lo que hay que hacer es preguntar por el responsable al descolgar */}
      {esTienda && (
        <Caja titulo="Decisor" icono={UserRound}>
          {lead.decisor ? (
            <Mosaico>
              <Casilla etiqueta="Nombre">{lead.decisor}</Casilla>
              <Casilla etiqueta="Cargo">{lead.cargo_decisor || <Vacio texto="sin cargo en el BORME" />}</Casilla>
            </Mosaico>
          ) : (
            <p className="rounded-[7px] bg-[var(--ls-sup)] px-2 py-1.5 text-[12.5px] leading-snug text-[var(--ls-t2)]">
              <strong className="font-semibold text-[var(--ls-t1)]">Pregunta por el responsable.</strong> El BORME no da administrador activo para esta empresa
              {lead.n_administradores === 0 ? ' (cero administradores registrados)' : ''}, así que el nombre hay que sacarlo en la llamada.
            </p>
          )}
        </Caja>
      )}

      {/* LA TIENDA. Es otra caja y no la del vendedor con cuatro condiciones más: Provincia, Facturación, Categoría y Directivos saldrían
          como guiones fijos en una tienda online, y «Provincia: —» además es mentira, porque su geografía está en Ciudad */}
      {esTienda && (
        <Caja
          titulo="La tienda"
          icono={ShoppingBag}
          accion={
            lead.web ? (
              // «Abrir la tienda» y NO «Ver en Amazon»: ese otro rótulo es fijo y pertenece a `seller_url`, que aquí no hay
              <a href={lead.web} target="_blank" rel="noopener noreferrer" className={`${enlace} text-[11px]`}>
                Abrir la tienda <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            ) : undefined
          }
        >
          <Mosaico>
            {/* LA CIFRA, CON LA ADVERTENCIA PEGADA Y NO EN UN TOOLTIP. Son dólares de un modelo de tráfico, no facturación observada, y esto es
                lo que el comercial tiene abierto MIENTRAS habla por teléfono: por eso no lleva el símbolo del euro y se lee sin pasar el ratón */}
            <Casilla etiqueta="Ventas est." entera>
              <span className="font-semibold tabular-nums">
                {formatVentasEstimadas(lead.ventas_estimadas_usd)}
                {lead.ventas_estimadas_usd != null ? ' / mes' : ''}
              </span>
              <span className="mt-0.5 block text-[11px] font-normal leading-snug text-[var(--ls-e-ambar)]">{AVISO_VENTAS_ESTIMADAS}</span>
            </Casilla>
            <Casilla etiqueta="Razón social" entera>
              {lead.company || <Vacio texto="Sin razón social en el BORME" />}
            </Casilla>
            <Casilla etiqueta="CIF">{lead.cif || <Vacio />}</Casilla>
            <Casilla etiqueta="Tipo">{lead.tipo_empresa ? COLD_TIPO_EMPRESA_LABELS[lead.tipo_empresa] : <Vacio texto="sin determinar" />}</Casilla>
            <Casilla etiqueta="Admin. activos">{lead.n_administradores ?? <Vacio />}</Casilla>
            <Casilla etiqueta="Antigüedad">{lead.anos_tienda != null ? `${String(lead.anos_tienda).replace('.', ',')} años` : <Vacio />}</Casilla>
            <Casilla etiqueta="Ciudad">{lead.ciudad || <Vacio texto="sin ciudad" />}</Casilla>
            <Casilla etiqueta="Plataforma">{lead.plataforma || <Vacio />}</Casilla>
            <Casilla etiqueta="Nº productos">{lead.n_productos != null ? lead.n_productos.toLocaleString('es-ES') : <Vacio />}</Casilla>
            <Casilla etiqueta="Sector" entera>
              {lead.category || <Vacio />}
            </Casilla>
          </Mosaico>
        </Caja>
      )}

      {/* EL PARTNER: los datos de Google Maps con los que se captó. La prioridad va arriba del todo con su pista: es lo que dice si se llama o solo se escribe. */}
      {esSocio && <CajaDelPartner lead={lead} />}
      {esSocio && <CajaDeEnlaces lead={lead} />}

      {/* El vendedor de Amazon: solo para los leads que YA venden en Amazon */}
      {!esTienda && !esSocio && (
        <Caja
          titulo="El vendedor"
          icono={Store}
          accion={
            lead.seller_url ? (
              <a href={lead.seller_url} target="_blank" rel="noopener noreferrer" className={`${enlace} text-[11px]`}>
                Ver en Amazon <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            ) : undefined
          }
        >
          <Mosaico>
            <Casilla etiqueta="Empresa" entera>
              <span className="font-medium">{lead.company || <Vacio />}</span>
            </Casilla>
            <Casilla etiqueta="Facturación">
              {lead.revenue_monthly != null ? (
                <span className="font-semibold tabular-nums">
                  {formatRevenue(lead.revenue_monthly)} <span className="font-normal text-[var(--ls-t3)]">/ mes</span>
                </span>
              ) : (
                <Vacio />
              )}
            </Casilla>
            <Casilla etiqueta="Provincia">{lead.province || <Vacio />}</Casilla>
            {lead.amazon_start && <Casilla etiqueta="Vende desde">{lead.amazon_start}</Casilla>}
            {lead.mercantile_registry && <Casilla etiqueta="Reg. mercantil">{lead.mercantile_registry}</Casilla>}
            <Casilla etiqueta="Categoría" entera>
              {[lead.category, lead.subcategory].filter(Boolean).join(' · ') || <Vacio />}
            </Casilla>
            {lead.business_address && (
              <Casilla etiqueta="Dirección" entera>
                {lead.business_address}
              </Casilla>
            )}
          </Mosaico>
        </Caja>
      )}
    </div>
  )
}

/** Lo que se sabe de un partner. Lo que no hay se escribe «—» (no se esconde la casilla: «no se sabe» también es un dato), salvo las búsquedas, que son una lista */
function CajaDelPartner({ lead }: { lead: ColdLead }) {
  const valoracion = valoracionDe(lead.rating, lead.resenas)
  const busquedas = busquedasDeOrigen(lead.busquedas_origen)
  return (
    <Caja titulo="El partner" icono={Handshake}>
      <Mosaico>
        <Casilla etiqueta="Prioridad" entera>
          {esPrioridadDePartner(lead.prioridad) ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <InsigniaDePrioridad prioridad={lead.prioridad} />
              <span className="text-[11px] font-normal leading-snug text-[var(--ls-t3)]">{PRIORIDADES_DE_PARTNER[lead.prioridad].pista}</span>
            </span>
          ) : (
            <Vacio texto="sin prioridad" />
          )}
        </Casilla>
        <Casilla etiqueta="Puntos">{lead.puntos != null ? <span className="font-semibold tabular-nums">{lead.puntos}</span> : <Vacio />}</Casilla>
        <Casilla etiqueta="Valoración en Maps">{valoracion ? <span className="tabular-nums">★ {valoracion}</span> : <Vacio texto="sin valoración" />}</Casilla>
        <Casilla etiqueta="Tipo">
          {lead.tipo_empresa === 'sociedad' ? (
            COLD_TIPO_EMPRESA_LABELS.sociedad
          ) : lead.tipo_empresa === 'autonomo' ? (
            <span className="text-[var(--ls-e-ambar)]">Persona física · no se llama en frío</span>
          ) : (
            <Vacio texto="Sin verificar" />
          )}
        </Casilla>
        <Casilla etiqueta="Menciona Amazon">
          {lead.menciona_amazon == null ? <Vacio /> : lead.menciona_amazon ? <span className="font-semibold text-[var(--ls-e-verde)]">Sí</span> : 'No'}
        </Casilla>
        <Casilla etiqueta="Razón social" entera>
          {lead.company || <Vacio texto="Sin razón social" />}
        </Casilla>
        <Casilla etiqueta="Categoría">{lead.category || <Vacio />}</Casilla>
        <Casilla etiqueta="Ciudad">{lead.ciudad || <Vacio texto="sin ciudad" />}</Casilla>
        {busquedas.length > 0 && (
          <Casilla etiqueta="Lo encontramos buscando" entera>
            <ul className="flex flex-wrap gap-1">
              {busquedas.map((b) => (
                <li key={b} className="rounded-[4px] bg-[var(--ls-sup3)] px-1.5 py-px text-[11.5px] leading-snug text-[var(--ls-t2)]">
                  {b}
                </li>
              ))}
            </ul>
          </Casilla>
        )}
      </Mosaico>
    </Caja>
  )
}

/** Sus tres enlaces. Solo se abren si son http o https (urlSegura): vienen de un Excel y de la web de cada negocio */
function CajaDeEnlaces({ lead }: { lead: ColdLead }) {
  const web = urlSegura(lead.web)
  const linkedin = urlSegura(lead.linkedin)
  const maps = urlSegura(lead.google_maps_url)
  // Las que llegan con la ficha abierta (LinkedIn y Maps) tardan un instante: hasta entonces no se sabe si no hay, y no se pinta un guion que luego cambie
  const cargadoElDetalle = 'linkedin' in lead || 'google_maps_url' in lead
  return (
    <Caja titulo="Enlaces" icono={Link2}>
      <Mosaico>
        <Casilla etiqueta="Web">
          {web ? (
            <a href={web} target="_blank" rel="noopener noreferrer" className={`${enlace} break-all`} title={web}>
              {dominioDeWeb(web)} <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            </a>
          ) : (
            <Vacio texto="sin web" />
          )}
        </Casilla>
        <Casilla etiqueta="LinkedIn">
          {linkedin ? (
            <a href={linkedin} target="_blank" rel="noopener noreferrer" className={`${enlace} break-all`} title={linkedin}>
              {textoDeLinkedin(linkedin)} <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            </a>
          ) : cargadoElDetalle ? (
            <Vacio texto="sin LinkedIn" />
          ) : (
            <Vacio texto="…" />
          )}
        </Casilla>
        <Casilla etiqueta="Google Maps" entera>
          {maps ? (
            <a href={maps} target="_blank" rel="noopener noreferrer" className={enlace}>
              Ver su ficha en Maps <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            </a>
          ) : cargadoElDetalle ? (
            <Vacio texto="sin ficha de Maps" />
          ) : (
            <Vacio texto="…" />
          )}
        </Casilla>
      </Mosaico>
    </Caja>
  )
}
