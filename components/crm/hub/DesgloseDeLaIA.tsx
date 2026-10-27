'use client'

import { AlertTriangle, Ban, Building2, CheckCircle2, Euro, Flag, HelpCircle, Lightbulb, MessageSquareQuote, Package, ShieldAlert, Target, TrendingUp, Users } from 'lucide-react'
import { CRM_STAGE_LABELS } from '@/lib/types/crm'
import type { AnalisisDeReunion } from '@/lib/crm/gemini/tipos'
import { INTERES, MODELO_DE_NEGOCIO } from './etiquetas'
import { Aviso, Boton, Dato, Insignia, Lista, Seccion } from './piezas'
import type { ContextoFicha } from './tipos'

/**
 * EL DESGLOSE DE LA IA DE UNA REUNIÓN, PINTADO.
 * Lo que sacó la IA de las notas de Gemini (lib/crm/gemini/analisis.ts), en bloques que se leen de un vistazo y siguen el orden de la guía de propuestas: quién es el cliente, su
 * negocio, los dolores (que alimentan el diagnóstico), objetivos, oportunidades, objeciones, lo que se dijo de dinero, alcance y pasos. Es una lectura, no una verdad: la frase
 * de abajo lo recuerda, y las cifras de dinero se enseñan «tal cual se dijeron», sin importes de propuesta.
 */
export function DesgloseDeLaIA({ analisis, ctx }: { analisis: AnalisisDeReunion; ctx: ContextoFicha }) {
  const { cliente, negocio } = analisis
  const interes = INTERES[analisis.interes.nivel]
  const datosDelNegocio: Array<[string, string | null]> = [
    ['Empresa', cliente.empresa],
    ['Contacto', [cliente.contacto, cliente.cargo].filter(Boolean).join(' · ') || null],
    ['Modelo', cliente.modelo_de_negocio !== 'no_claro' ? MODELO_DE_NEGOCIO[cliente.modelo_de_negocio] : null],
    ['Sector', cliente.sector],
    ['Producto', cliente.producto],
    ['Referencias', negocio.n_productos],
    ['Facturación', negocio.facturacion_actual],
  ]
  const hayNegocio = datosDelNegocio.some(([, v]) => v) || negocio.descripcion || negocio.canales.length > 0 || negocio.mercados_activos.length > 0 || negocio.mercados_objetivo.length > 0 || negocio.situacion_en_amazon

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* ---------------- En una frase ---------------- */}
      <Seccion titulo="En una frase" icono={<Flag />}>
        <div className="mb-2 flex flex-wrap items-center gap-[6px]">
          <Insignia tono={interes.tono}>{interes.texto}</Insignia>
          {analisis.fase_sugerida && (
            <Insignia tono="azul" titulo="Es una sugerencia de la IA: la fase la cambia una persona">
              Fase que sugiere: {CRM_STAGE_LABELS[analisis.fase_sugerida]}
            </Insignia>
          )}
          {ctx.puedeEditar && analisis.fase_sugerida && analisis.fase_sugerida !== ctx.client.stage && (
            <Boton onClick={() => void ctx.cambiarFase(analisis.fase_sugerida!)}>Pasar a «{CRM_STAGE_LABELS[analisis.fase_sugerida]}»</Boton>
          )}
        </div>
        <p className="text-[12.5px] leading-[1.6] text-[var(--ls-t1)]">{analisis.resumen}</p>
        {analisis.interes.motivo && <p className="mt-1.5 text-[11.5px] leading-[1.5] text-[var(--ls-t3)]">{analisis.interes.motivo}</p>}
      </Seccion>

      {/* ---------------- Cliente y negocio ---------------- */}
      {hayNegocio && (
        <Seccion titulo="Cliente y negocio" icono={<Building2 />}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 md:grid-cols-3">
            {datosDelNegocio.filter(([, v]) => v).map(([etiqueta, valor]) => (
              <Dato key={etiqueta} etiqueta={etiqueta}>
                {valor}
              </Dato>
            ))}
            {negocio.canales.length > 0 && <Dato etiqueta="Canales">{negocio.canales.join(', ')}</Dato>}
            {negocio.mercados_activos.length > 0 && <Dato etiqueta="Vende en">{negocio.mercados_activos.join(', ')}</Dato>}
            {negocio.mercados_objetivo.length > 0 && <Dato etiqueta="Quiere vender en">{negocio.mercados_objetivo.join(', ')}</Dato>}
          </div>
          {negocio.descripcion && <p className="mt-2.5 border-t border-[var(--ls-linea)] pt-2 text-[12.5px] leading-[1.55] text-[var(--ls-t2)]">{negocio.descripcion}</p>}
          {negocio.situacion_en_amazon && (
            <p className="mt-1.5 text-[12.5px] leading-[1.55] text-[var(--ls-t2)]">
              <span className="font-semibold text-[var(--ls-t1)]">En Amazon: </span>
              {negocio.situacion_en_amazon}
            </p>
          )}
        </Seccion>
      )}

      {/* ---------------- Dolores ---------------- */}
      {analisis.dolores.length > 0 && (
        <Seccion titulo="Dolores detectados" icono={<Target />} derecha={<span className="text-[11px] text-[var(--ls-t4)]">Alimentan el diagnóstico de la propuesta</span>}>
          <div className="grid gap-2 md:grid-cols-2">
            {analisis.dolores.map((d, i) => (
              <div key={i} className="rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-[9px] py-[7px]">
                <p className="text-[12.5px] font-semibold text-[var(--ls-t1)]">{d.titulo}</p>
                <p className="mt-[2px] text-[11.5px] leading-[1.5] text-[var(--ls-t3)]">{d.detalle}</p>
              </div>
            ))}
          </div>
        </Seccion>
      )}

      {/* ---------------- Listas ---------------- */}
      <div className="grid gap-3 lg:grid-cols-2">
        {analisis.objetivos.length > 0 && (
          <Seccion titulo="Objetivos" icono={<TrendingUp />}>
            <Lista items={analisis.objetivos} />
          </Seccion>
        )}
        {analisis.oportunidades.length > 0 && (
          <Seccion titulo="Oportunidades" icono={<Lightbulb />}>
            <Lista items={analisis.oportunidades} />
          </Seccion>
        )}
        {analisis.objeciones.length > 0 && (
          <Seccion titulo="Objeciones" icono={<ShieldAlert />}>
            <Lista items={analisis.objeciones} />
          </Seccion>
        )}
        {analisis.decisiones.length > 0 && (
          <Seccion titulo="Decisiones" icono={<CheckCircle2 />}>
            <Lista items={analisis.decisiones} />
          </Seccion>
        )}
      </div>

      {/* ---------------- Dinero y alcance ---------------- */}
      {(analisis.cifras_dichas.length > 0 || analisis.alcance.incluye.length > 0 || analisis.alcance.no_incluye.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {analisis.cifras_dichas.length > 0 && (
            <Seccion titulo="Lo que se dijo de dinero" icono={<Euro />}>
              <dl className="space-y-1.5">
                {analisis.cifras_dichas.map((c, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-3 border-b border-[var(--ls-linea)] pb-1.5 last:border-b-0 last:pb-0">
                    <dt className="min-w-0 text-[12.5px] text-[var(--ls-t2)]">{c.concepto}</dt>
                    <dd className="shrink-0 text-right text-[12.5px] font-semibold tabular-nums text-[var(--ls-t1)]">{c.valor}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-[11px] leading-[1.5] text-[var(--ls-t4)]">Tal cual se dijo en la reunión. No son los importes de la propuesta: esos los pone una persona.</p>
            </Seccion>
          )}
          {(analisis.alcance.incluye.length > 0 || analisis.alcance.no_incluye.length > 0) && (
            <Seccion titulo="Alcance" icono={<Package />}>
              {analisis.alcance.incluye.length > 0 && (
                <>
                  <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-[var(--ls-t4)]">
                    <CheckCircle2 className="h-3 w-3" /> Incluye
                  </p>
                  <Lista items={analisis.alcance.incluye} />
                </>
              )}
              {analisis.alcance.no_incluye.length > 0 && (
                <>
                  <p className="mb-1 mt-2.5 flex items-center gap-1 text-[11px] font-semibold text-[var(--ls-t4)]">
                    <Ban className="h-3 w-3" /> No incluye
                  </p>
                  <Lista items={analisis.alcance.no_incluye} />
                </>
              )}
            </Seccion>
          )}
        </div>
      )}

      {/* ---------------- Próximos pasos y dudas ---------------- */}
      {(analisis.proximos_pasos.length > 0 || analisis.preguntas_abiertas.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {analisis.proximos_pasos.length > 0 && (
            <Seccion titulo="Próximos pasos" icono={<Users />}>
              <ul className="space-y-2">
                {analisis.proximos_pasos.map((p, i) => (
                  <li key={i} className="min-w-0">
                    <p className="text-[12.5px] text-[var(--ls-t1)]">{p.que}</p>
                    <p className="text-[11px] text-[var(--ls-t4)]">
                      {p.quien || 'Sin responsable'}
                      {p.cuando ? ` · ${p.cuando}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </Seccion>
          )}
          {analisis.preguntas_abiertas.length > 0 && (
            <Seccion titulo="Preguntas abiertas" icono={<HelpCircle />}>
              <Lista items={analisis.preguntas_abiertas} />
            </Seccion>
          )}
        </div>
      )}

      {/* ---------------- Frases ---------------- */}
      {analisis.frases_clave.length > 0 && (
        <Seccion titulo="Frases que merece la pena releer" icono={<MessageSquareQuote />}>
          <ul className="space-y-2.5">
            {analisis.frases_clave.map((f, i) => (
              <li key={i} className="border-l-2 border-[var(--ls-linea2)] pl-2.5">
                <p className="text-[12.5px] italic leading-[1.5] text-[var(--ls-t2)]">«{f.texto}»</p>
                <p className="text-[11px] text-[var(--ls-t4)]">
                  {f.quien}
                  {f.minuto ? ` · ${f.minuto}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </Seccion>
      )}

      <Aviso tono="gris" icono={<AlertTriangle />}>
        Es una lectura automática de las notas de Gemini: puede equivocarse o dejarse cosas. Lo que dice la propia reunión (las notas originales de abajo) manda sobre este desglose.
      </Aviso>
    </div>
  )
}
