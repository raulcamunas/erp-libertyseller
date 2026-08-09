'use client'

import { AlertTriangle } from 'lucide-react'
import { COLOR_ESTADO, LINEA, TEXTO, TIPO, TITULO } from '@/lib/estilo/denso'
import { Dialogo, dinero } from '@/components/plataforma/comun'
import type { AnalisisSku, DesgloseMargen, ResultadoMargen } from '@/lib/plataforma/fbmfba/cliente'
import { AmazonEnAsin, Canal, CeldaRotacion, Diferencia, EtiquetaVeredicto, Medidas, Techo, porcentaje } from './piezas'

/**
 * LA FICHA DE UNA REFERENCIA: DE DÓNDE SALE CADA EURO.
 *
 * Los dos escenarios EN COLUMNAS, línea a línea, con el mismo orden de restas
 * que hace la fórmula. No es un adorno: un margen sin desglose se obedece y uno
 * con desglose se discute, y discutirlo es lo que hace que se detecte cuando
 * está mal. Además es lo que se le enseña al cliente cuando pregunta «¿por qué
 * dices que este no compensa?».
 *
 * Las dos líneas que casi nadie espera y que son la mitad del valor de esto:
 *
 *   · EL PORTE en la columna del canal propio. El precio de referencia de Amazon
 *     es precio de listing SIN ENVÍO, así que en FBM el porte lo paga el cliente
 *     y no sale en ninguna respuesta de la API. Sin restarlo, ese margen sale
 *     inflado y la comparación está amañada.
 *   · EL ALMACENAMIENTO Y EL FLETE en la de Amazon. Su estimación de tarifas no
 *     los incluye. Con esos dos a cero, todo compensa migrar.
 */
export function FichaFbmFba({
  fila,
  moneda,
  etiqueta,
  onCerrar,
}: {
  fila: AnalisisSku
  moneda: string | null
  etiqueta: string
  onCerrar: () => void
}) {
  return (
    <Dialogo titulo={fila.sku} onCerrar={onCerrar} ancho="max-w-[720px]">
      {/* -------- Quién es -------- */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <EtiquetaVeredicto veredicto={fila.veredicto} etiqueta={etiqueta} fuerte />
        <Canal canal={fila.canal} />
        {fila.asin && <span className={`${TIPO.s} ${TEXTO.t3}`}>{fila.asin}</span>}
        {fila.marca && <span className={`${TIPO.s} ${TEXTO.t3}`}>{fila.marca}</span>}
        {!fila.enSeguimiento && (
          <span className={`${TIPO.s} ${TEXTO.t4}`} title="No entra en el refresco diario, así que sus datos pueden ser viejos.">
            fuera del refresco diario
          </span>
        )}
      </div>
      {fila.titulo && <p className={`${TIPO.s} ${TEXTO.t3} truncate`}>{fila.titulo}</p>}

      {/* -------- EL PORQUÉ, entero -------- */}
      <p className={`${TIPO.s} ${TEXTO.t2} leading-[1.55]`}>{fila.motivo}</p>

      {/* -------- Las dudas que acompañan al veredicto -------- */}
      {fila.salvedades.length > 0 && (
        <ul className="space-y-[5px]">
          {fila.salvedades.map((s) => (
            <li key={s.clave} className={`flex gap-[6px] ${TIPO.s} ${TEXTO.t3} leading-[1.5]`}>
              <AlertTriangle
                className="mt-[2px] h-[13px] w-[13px] shrink-0"
                style={{ color: COLOR_ESTADO[s.degrada ? 'ambar' : 'gris'] }}
              />
              <span>
                {s.degrada && <strong className={TEXTO.t2}>Frena. </strong>}
                {s.texto}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* -------- De dónde sale cada euro -------- */}
      <div className={`overflow-x-auto rounded-[6px] border ${LINEA.normal}`}>
        <table className="w-full border-separate border-spacing-0 text-[12.5px]">
          <thead>
            <tr>
              <Th />
              <Th derecha>Lo envía el cliente</Th>
              <Th derecha>Lo envía Amazon</Th>
            </tr>
          </thead>
          <tbody>
            <Linea
              titulo="Precio con el que se calcula"
              pista={
                fila.sentidoFoep === 'ofensivo'
                  ? 'El techo de Amazon: es el precio al que habría que bajar para vender de verdad, porque hoy la oferta destacada no es nuestra.'
                  : fila.sentidoFoep === 'defensivo'
                    ? 'El precio de hoy. La oferta destacada ya es nuestra, así que el techo de Amazon está por encima y contarlo ahí sería inflar el margen.'
                    : fila.sentidoFoep === 'sin_juicio'
                      ? 'El menor entre el precio de hoy y el techo de Amazon. No se sabe de quién es la oferta destacada, así que se ha cogido el más prudente de los dos en vez de suponer hacia qué lado corregir.'
                      : 'El precio de hoy: no hay techo de Amazon con el que corregirlo.'
              }
              propio={fila.precioEvaluado}
              fba={fila.precioEvaluado}
              moneda={moneda}
            />
            <FilaDesglose titulo="Impuesto que se retira" campo="impuesto" fila={fila} moneda={moneda} negativo />
            <FilaDesglose titulo="Base imponible" campo="precioBase" fila={fila} moneda={moneda} fuerte />
            <FilaDesglose titulo="Precio de compra" campo="costeCompra" fila={fila} moneda={moneda} negativo />
            <FilaDesglose
              titulo="Porte que paga el cliente"
              pista="El precio de referencia de Amazon NO incluye el envío. En FBM y en Prime del vendedor el porte lo paga el cliente y no sale en ninguna respuesta de la API."
              campo="costeEnvioPropio"
              fila={fila}
              moneda={moneda}
              negativo
            />
            <FilaDesglose
              titulo="Almacenamiento en Amazon"
              pista="La estimación de tarifas de Amazon NO lo incluye. Con esto a cero, todo saldría a favor de migrar."
              campo="costeAlmacenFba"
              fila={fila}
              moneda={moneda}
              negativo
            />
            <FilaDesglose
              titulo="Flete de entrada"
              pista="Llevar la mercancía hasta el centro logístico. Tampoco viene en la estimación de Amazon."
              campo="costeFleteFba"
              fila={fila}
              moneda={moneda}
              negativo
            />
            <FilaDesglose titulo="Comisión de referencia" campo="referral" fila={fila} moneda={moneda} negativo />
            <FilaDesglose titulo="Tarifa de logística de Amazon" campo="fba" fila={fila} moneda={moneda} negativo />
            <FilaDesglose titulo="Otras tarifas" campo="otras" fila={fila} moneda={moneda} negativo />

            <tr>
              <Td fuerte>Margen por unidad</Td>
              <Td derecha fuerte>
                <Importe margen={fila.margenPropio} moneda={moneda} />
              </Td>
              <Td derecha fuerte>
                <Importe margen={fila.margenFba} moneda={moneda} />
              </Td>
            </tr>
            <tr>
              <Td>Margen sobre la base</Td>
              <Td derecha>{porcentaje(fila.margenPropio.porcentaje)}</Td>
              <Td derecha>{porcentaje(fila.margenFba.porcentaje)}</Td>
            </tr>
            <tr>
              <Td fuerte>Diferencia</Td>
              <Td derecha colSpan={2}>
                <Diferencia puntos={fila.comparacion.puntos} /> puntos ·{' '}
                {dinero(fila.comparacion.importe, moneda)} por unidad
              </Td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* -------- Lo que sostiene el juicio -------- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-[6px]">
        <Dato titulo="Precio actual">{dinero(fila.precioActual, moneda)}</Dato>
        <Dato titulo="Techo de Amazon">
          <Techo fila={fila} />
        </Dato>
        <Dato titulo="Rotación">
          <CeldaRotacion rotacion={fila.rotacion} />
        </Dato>
        <Dato titulo="Medidas">
          <Medidas procedencia={fila.procedenciaDims} confianza={fila.confianzaDims} />
        </Dato>
        <Dato titulo="Amazon en el ASIN">
          <AmazonEnAsin estado={fila.amazon} />
        </Dato>
        {fila.foepHoras !== null && (
          <Dato titulo="Edad del techo">
            {fila.foepHoras < 48
              ? `${Math.round(fila.foepHoras)} h`
              : `${Math.round(fila.foepHoras / 24)} días`}
          </Dato>
        )}
      </div>

      <p className={`${TIPO.s} ${TEXTO.t4} leading-[1.5]`}>
        Desde aquí no se crea ningún envío a Amazon: la aplicación no tiene ese permiso. Esto es una
        propuesta para decidirla con el cliente y ejecutarla a mano en Seller Central.
      </p>
    </Dialogo>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas de la tabla del desglose                                     */
/* ------------------------------------------------------------------ */

function Th({ children, derecha }: { children?: React.ReactNode; derecha?: boolean }) {
  return (
    <th
      className={`h-[26px] px-2 text-[11px] font-semibold ${TEXTO.t4} whitespace-nowrap border-b ${LINEA.fuerte} bg-[var(--ls-sup2)] ${derecha ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  derecha,
  fuerte,
  colSpan,
}: {
  children?: React.ReactNode
  derecha?: boolean
  fuerte?: boolean
  colSpan?: number
}) {
  return (
    <td
      colSpan={colSpan}
      className={`h-7 px-2 align-middle whitespace-nowrap border-b ${LINEA.normal} ${
        derecha ? 'text-right tabular-nums' : ''
      } ${fuerte ? `font-medium ${TEXTO.t1}` : TEXTO.t2}`}
    >
      {children}
    </td>
  )
}

/**
 * Una línea del desglose.
 *
 * Solo se pinta si tiene algo que decir en alguna de las dos columnas: el porte
 * no existe en el escenario de Amazon y el almacenamiento no existe en el del
 * cliente, así que enseñar «0,00» en el que no aplica invita a pensar que ahí
 * hay un coste que sale gratis.
 */
function FilaDesglose({
  titulo,
  pista,
  campo,
  fila,
  moneda,
  negativo,
  fuerte,
}: {
  titulo: string
  pista?: string
  campo: keyof DesgloseMargen
  fila: AnalisisSku
  moneda: string | null
  negativo?: boolean
  fuerte?: boolean
}) {
  const propio = fila.margenPropio.desglose?.[campo] ?? null
  const fba = fila.margenFba.desglose?.[campo] ?? null
  if ((propio === null || propio === 0) && (fba === null || fba === 0)) return null

  return (
    <tr>
      <Td fuerte={fuerte}>
        {pista ? (
          <span className="cursor-help" title={pista}>
            {titulo}
          </span>
        ) : (
          titulo
        )}
      </Td>
      <Td derecha fuerte={fuerte}>
        {celda(propio, moneda, negativo)}
      </Td>
      <Td derecha fuerte={fuerte}>
        {celda(fba, moneda, negativo)}
      </Td>
    </tr>
  )
}

function Linea({
  titulo,
  pista,
  propio,
  fba,
  moneda,
}: {
  titulo: string
  pista?: string
  propio: number | null
  fba: number | null
  moneda: string | null
}) {
  return (
    <tr>
      <Td>
        {pista ? (
          <span className="cursor-help" title={pista}>
            {titulo}
          </span>
        ) : (
          titulo
        )}
      </Td>
      <Td derecha>{dinero(propio, moneda)}</Td>
      <Td derecha>{dinero(fba, moneda)}</Td>
    </tr>
  )
}

function celda(valor: number | null, moneda: string | null, negativo?: boolean): string {
  if (valor === null || valor === 0) return '—'
  return `${negativo ? '− ' : ''}${dinero(valor, moneda)}`
}

function Importe({ margen, moneda }: { margen: ResultadoMargen; moneda: string | null }) {
  if (margen.estado !== 'calculado' || margen.importe === null) {
    return (
      <span className={`${TEXTO.t4} cursor-help font-normal`} title={margen.motivo}>
        sin dato
      </span>
    )
  }
  return <>{dinero(margen.importe, moneda)}</>
}

function Dato({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <span className="flex items-baseline gap-[5px]">
      <span className={TITULO.rotulo}>{titulo}</span>
      <span className={`${TIPO.m} ${TEXTO.t2}`}>{children}</span>
    </span>
  )
}
