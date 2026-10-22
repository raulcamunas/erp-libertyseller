'use client'

import { ChevronRight, Copy, ExternalLink } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  AVISO_VENTAS_ESTIMADAS,
  COLD_TIPO_EMPRESA_LABELS,
  esTiendaOnline,
  formatRevenue,
  formatVentasEstimadas,
  type ColdLead,
} from '@/lib/types/cold-leads'

/**
 * LOS DATOS DE UN LEAD, en rejilla de dos columnas: la etiqueta pequeña a la izquierda y el valor al lado.
 *
 * Los usan la ficha y el desplegable de la tabla, así que hay UN solo sitio donde se decide qué se enseña de una tienda online y qué
 * de un vendedor de Amazon. Lo que no hay se escribe «—» en el nivel de texto más bajo, no se esconde la fila: «no se sabe» también es
 * un dato (un decisor vacío en seis de cada diez fichas es justo lo que dice «pregunta por el responsable»).
 *
 * El criterio de cada bloque viene de la Leyenda del Excel del equipo y está en los comentarios de abajo: no se pierde con el rediseño.
 */

function Fila({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] items-baseline gap-x-2 py-[3px]">
      <dt className="truncate text-[11px] font-semibold text-[var(--ls-t4)]">{etiqueta}</dt>
      <dd className="min-w-0 break-words text-[12.5px] text-[var(--ls-t2)]">{children}</dd>
    </div>
  )
}

const Vacio = ({ texto = '—' }: { texto?: string }) => <span className="text-[var(--ls-t4)]">{texto}</span>

function Bloque({ titulo, children, className = '' }: { titulo: string; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <h3 className="mb-0.5 text-[11px] font-semibold text-[var(--ls-t3)]">{titulo}</h3>
      <dl>{children}</dl>
    </section>
  )
}

const enlace = 'inline-flex items-center gap-1 text-[var(--ls-t2)] underline-offset-2 transition-colors hover:text-[var(--ls-acc)] hover:underline'

interface Props {
  lead: ColdLead
  /** El teléfono y el correo principales. En la ficha ya están en la cabecera; en el desplegable de la tabla no */
  conContacto?: boolean
  /** Si es autónomo, el teléfono se atenúa: está para confirmar datos, no para el primer contacto */
  esAutonomo?: boolean
}

export function DatosDelLead({ lead, conContacto = false, esAutonomo = false }: Props) {
  const [extrasAbiertos, setExtrasAbiertos] = useState(false)
  const esTienda = esTiendaOnline(lead)
  const tieneExtras = Boolean(lead.telefonos_extra || lead.emails_extra)

  return (
    <div className="space-y-3">
      {(conContacto || esTienda || tieneExtras || (!esTienda && lead.directors)) && (
        <Bloque titulo="Contacto">
          {conContacto && (
            <>
              <Fila etiqueta="Teléfono">
                {lead.phone ? (
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(lead.phone!)
                      toast.success('Teléfono copiado')
                    }}
                    title={esAutonomo ? 'Autónomo: no se llama en frío' : 'Copiar el teléfono'}
                    className={`inline-flex items-center gap-1 transition-colors hover:text-[var(--ls-t1)] ${esAutonomo ? 'opacity-60' : ''}`}
                  >
                    {lead.phone}
                    <Copy className="h-3 w-3 shrink-0 text-[var(--ls-t4)]" aria-hidden />
                  </button>
                ) : (
                  <Vacio />
                )}
              </Fila>
              <Fila etiqueta="Email">
                {lead.email ? (
                  <a href={`mailto:${lead.email.split(/[\s/,;]+/)[0]}`} className={`${enlace} break-all`}>
                    {lead.email}
                  </a>
                ) : (
                  <Vacio />
                )}
              </Fila>
            </>
          )}

          {/* `directors` es del vendedor de Amazon. En una tienda online la persona vive en su propio bloque («Decisor») */}
          {!esTienda && lead.directors && <Fila etiqueta="Directivos">{lead.directors}</Fila>}

          {esTienda && lead.instagram && (
            <Fila etiqueta="Instagram">
              <a href={lead.instagram} target="_blank" rel="noopener noreferrer" className={`${enlace} break-all`}>
                {lead.instagram.replace(/^https?:\/\/(www\.)?instagram\.com\//, '@')}
              </a>
            </Fila>
          )}

          {/* Teléfonos y emails extra, COLAPSADOS: van aparte de `phone` y `email` porque los enlaces de llamar y de escribir cogen el
              primero de la cadena, y apilarlos arriba los dejaría invisibles para ellos. Y colapsados porque son el segundo intento */}
          {tieneExtras && (
            <div className="pt-0.5">
              <button type="button" onClick={() => setExtrasAbiertos((v) => !v)} aria-expanded={extrasAbiertos} className="flex items-center gap-1 text-[11px] text-[var(--ls-t3)] transition-colors hover:text-[var(--ls-t1)]">
                <ChevronRight className={`h-3 w-3 transition-transform ${extrasAbiertos ? 'rotate-90' : ''}`} aria-hidden />
                Más teléfonos y emails
              </button>
              {extrasAbiertos && (
                <div className="rend-entra mt-0.5">
                  {lead.telefonos_extra && <Fila etiqueta="Tel. extra">{lead.telefonos_extra}</Fila>}
                  {lead.emails_extra && <Fila etiqueta="Emails extra">{lead.emails_extra}</Fila>}
                </div>
              )}
            </div>
          )}
        </Bloque>
      )}

      {/* EL DECISOR, EN SU PROPIO BLOQUE. Es el administrador activo del BORME. Cuando falta —607 de cada 1.000— NO se pinta un guion: un
          guion repetido en seis de cada diez fichas no dice qué hacer, y lo que hay que hacer es preguntar por el responsable al descolgar */}
      {esTienda && (
        <Bloque titulo="Decisor">
          {lead.decisor ? (
            <>
              <Fila etiqueta="Nombre">{lead.decisor}</Fila>
              <Fila etiqueta="Cargo">{lead.cargo_decisor || <Vacio texto="sin cargo en el BORME" />}</Fila>
            </>
          ) : (
            <p className="py-0.5 text-[12.5px] leading-snug text-[var(--ls-t2)]">
              <strong className="font-semibold text-[var(--ls-t1)]">Pregunta por el responsable.</strong> El BORME no da administrador activo para esta empresa
              {lead.n_administradores === 0 ? ' (cero administradores registrados)' : ''}, así que el nombre hay que sacarlo en la llamada.
            </p>
          )}
        </Bloque>
      )}

      {/* LA TIENDA. Es otro bloque y no el del vendedor con cuatro condiciones más: Provincia, Facturación, Categoría y Directivos saldrían
          como guiones fijos en una tienda online, y «Provincia: —» además es mentira, porque su geografía está en Ciudad */}
      {esTienda && (
        <Bloque titulo="La tienda">
          {/* LA CIFRA, CON LA ADVERTENCIA PEGADA Y NO EN UN TOOLTIP. Son dólares de un modelo de tráfico, no facturación observada, y esto es
              lo que el comercial tiene abierto MIENTRAS habla por teléfono: por eso no lleva el símbolo del euro y se lee sin pasar el ratón */}
          <Fila etiqueta="Ventas est.">
            <span>
              {formatVentasEstimadas(lead.ventas_estimadas_usd)}
              {lead.ventas_estimadas_usd != null ? ' / mes' : ''}
            </span>
            <span className="block text-[11px] leading-snug text-[var(--ls-e-ambar)]">{AVISO_VENTAS_ESTIMADAS}</span>
          </Fila>
          <Fila etiqueta="Razón social">{lead.company || <Vacio texto="Sin razón social en el BORME" />}</Fila>
          <Fila etiqueta="CIF">{lead.cif || <Vacio />}</Fila>
          <Fila etiqueta="Tipo">{lead.tipo_empresa ? COLD_TIPO_EMPRESA_LABELS[lead.tipo_empresa] : <Vacio texto="sin determinar" />}</Fila>
          <Fila etiqueta="Admin. activos">{lead.n_administradores ?? <Vacio />}</Fila>
          <Fila etiqueta="Sector">{lead.category || <Vacio />}</Fila>
          <Fila etiqueta="Ciudad">{lead.ciudad || <Vacio texto="sin ciudad" />}</Fila>
          <Fila etiqueta="Antigüedad">{lead.anos_tienda != null ? `${String(lead.anos_tienda).replace('.', ',')} años` : <Vacio />}</Fila>
          <Fila etiqueta="Plataforma">{lead.plataforma || <Vacio />}</Fila>
          <Fila etiqueta="Nº productos">{lead.n_productos != null ? lead.n_productos.toLocaleString('es-ES') : <Vacio />}</Fila>
          {lead.web && (
            <Fila etiqueta="Web">
              {/* «Abrir la tienda» y NO «Ver en Amazon»: ese otro rótulo es fijo y pertenece a `seller_url`, que aquí no hay */}
              <a href={lead.web} target="_blank" rel="noopener noreferrer" className={enlace}>
                Abrir la tienda <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </Fila>
          )}
        </Bloque>
      )}

      {/* El vendedor de Amazon: solo para los leads que YA venden en Amazon */}
      {!esTienda && (
        <Bloque titulo="El vendedor">
          <Fila etiqueta="Empresa">{lead.company || <Vacio />}</Fila>
          <Fila etiqueta="Facturación">{lead.revenue_monthly != null ? `${formatRevenue(lead.revenue_monthly)} / mes` : <Vacio />}</Fila>
          {lead.amazon_start && <Fila etiqueta="Vende desde">{lead.amazon_start}</Fila>}
          <Fila etiqueta="Provincia">{lead.province || <Vacio />}</Fila>
          <Fila etiqueta="Categoría">{[lead.category, lead.subcategory].filter(Boolean).join(' · ') || <Vacio />}</Fila>
          {lead.seller_url && (
            <Fila etiqueta="Perfil seller">
              <a href={lead.seller_url} target="_blank" rel="noopener noreferrer" className={enlace}>
                Ver en Amazon <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </Fila>
          )}
          {lead.business_address && <Fila etiqueta="Dirección">{lead.business_address}</Fila>}
          {lead.mercantile_registry && <Fila etiqueta="Reg. mercantil">{lead.mercantile_registry}</Fila>}
        </Bloque>
      )}
    </div>
  )
}
