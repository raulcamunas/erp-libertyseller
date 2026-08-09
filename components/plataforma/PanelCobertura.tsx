'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Inbox, Info, Search } from 'lucide-react'
import { getAmazon } from '@/lib/amazon/client'
import type {
  ClienteConIngesta,
  CoberturaRespuesta,
  CoberturaUnidad,
} from '@/lib/plataforma/cliente'
import {
  BOTON,
  CAMPO,
  COLOR_ESTADO,
  LINEA,
  RADIO,
  SUPERFICIE,
  TEXTO,
  TIPO,
  TITULO,
  type TonoEstado,
} from '@/lib/estilo/denso'
import type { SkuAbierto } from './PlataformaBoard'
import { Aviso, Barra, Cargando, Panel, Vacio, cifra, fechaHora, hace, nombreMarketplace } from './comun'

/**
 * COBERTURA DE DATOS: DE QUÉ ANÁLISIS NOS PODEMOS FIAR.
 *
 * Es la pantalla más aburrida de A1 y la que más dinero ahorra. A2 va a
 * diagnosticar por qué un SKU no tiene Buy Box y A4 va a decir si merece la pena
 * pasarlo a FBA; los dos dan un veredicto POR SKU, y un veredicto sobre datos
 * que no están es peor que no tener veredicto, porque nadie lo distingue de uno
 * bueno. Aquí es donde se ve que el 40 % del catálogo no tiene ni ranking ni
 * medidas ANTES de presentarle nada a un cliente.
 *
 *
 * ============ DOS COSAS QUE HAY QUE ENTENDER PARA LEER ESTA TABLA ============
 *
 * 1. «TENER BSR» SIGNIFICA «LEÍDO ÚLTIMAMENTE», no «alguna vez». Un SKU cuyo
 *    último ranking es de febrero no está cubierto, está abandonado. Por eso las
 *    columnas dicen la ventana, y por eso son dos ventanas distintas: el ranking
 *    se tolera un mes (una serie con huecos sigue siendo una serie) y el
 *    inventario no llega a la semana (a los siete días ya no sirve para decidir
 *    una reposición).
 *
 * 2. EL INVENTARIO VA EN CUATRO CAJONES Y NO EN DOS. «No aplica» es un SKU de
 *    FBM: FBA Inventory no los devuelve, y eso NO es un agujero de cobertura,
 *    es la respuesta correcta. Con dos cajones, ShoesF —mayoría FBM— saldría con
 *    un 10 % de cobertura y alguien perdería una mañana arreglando algo que no
 *    está roto. Lo que sí es un agujero es «desconocido» (se intentó y no se
 *    pudo) y «sin leer».
 *
 * Y el que más importa de todos, aunque no lo parezca: DIMENSIONES CERTIFICADAS.
 * La tarifa de FBA se calcula sobre el embalaje, y la regla 4 del §3.5 de la
 * especificación obliga a marcar los SKU sin dimensiones certificadas porque su
 * estimación de tarifa no es fiable. Si esa columna va baja, el margen que
 * calcule A4 es una conjetura.
 */

export function PanelCobertura({
  cliente,
  onAbrirSku,
}: {
  cliente: ClienteConIngesta
  onAbrirSku: (sku: SkuAbierto) => void
}) {
  const [datos, setDatos] = useState<CoberturaRespuesta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  const clienteRef = useRef(cliente.id)
  clienteRef.current = cliente.id

  const cargar = useCallback(async (clientId: string) => {
    setCargando(true)
    const res = await getAmazon<CoberturaRespuesta>(`/api/plataforma/cobertura?clientId=${clientId}`)
    if (clienteRef.current !== clientId) return
    setCargando(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setError(null)
    setDatos(res.data)
  }, [])

  useEffect(() => {
    void cargar(cliente.id)
  }, [cargar, cliente.id])

  if (cargando && !datos) return <Cargando texto="Contando la cobertura…" />
  if (error) {
    return (
      <Aviso tono="rojo" icono={AlertTriangle}>
        {error}
      </Aviso>
    )
  }
  if (!datos) return null

  const conCatalogo = datos.cobertura.filter((u) => u.total > 0)

  if (conCatalogo.length === 0) {
    return (
      <Vacio icono={<Inbox />} titulo="El espejo del catálogo de este cliente está vacío">
        Todavía no hay ni un SKU del que hablar, así que no hay cobertura que medir. El primer
        trabajo que hay que lanzar es <span className={TEXTO.t1}>«Censo del catálogo»</span> desde la
        pestaña de Ingesta: pide a Amazon el informe completo y descubre los SKU y los ASIN. Todo lo
        demás —atributos, ranking, inventario— cuelga de eso y se pide POR ASIN.
      </Vacio>
    )
  }

  return (
    <div className="flex flex-col gap-2 pb-4">
      {conCatalogo.map((u) => (
        <UnidadCobertura
          key={`${u.connection_id}|${u.marketplace_id}`}
          unidad={u}
          ventanas={datos.ventanas}
          onAbrirSku={onAbrirSku}
        />
      ))}

      {/* La hora de la lectura sí es dato: dice si lo que se está mirando es de
          hace un momento o de hace media hora. El detalle técnico —que los
          recuentos los hace la base y no el navegador— se ha ido al botón de
          información. */}
      <p className={`${TIPO.s} ${TEXTO.t4} px-1`}>Leído {hace(datos.leidoAt)}.</p>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function UnidadCobertura({
  unidad,
  ventanas,
  onAbrirSku,
}: {
  unidad: CoberturaUnidad
  ventanas: { bsrDias: number; inventarioDias: number }
  onAbrirSku: (sku: SkuAbierto) => void
}) {
  const [buscado, setBuscado] = useState('')

  return (
    <Panel
      titulo={
        <>
          {unidad.connection_name}
          <span className={`${TEXTO.t3} font-normal`}> · {nombreMarketplace(unidad.marketplace_id)}</span>
        </>
      }
      derecha={
        <span className={`${TIPO.s} ${TEXTO.t4}`}>
          {cifra(unidad.total)} SKU · {cifra(unidad.fba)} FBA · {cifra(unidad.fbm)} FBM
        </span>
      }
    >
      <div className="space-y-[9px]">
        {/* El tope de ancho no es cosmético: sin él, en un monitor grande el
            nombre de la métrica queda a la izquierda del todo y su barra a
            ochocientos píxeles a la derecha, y hay que recorrer la fila con el
            dedo para saber cuál es cuál. */}
        <table className="w-full max-w-[820px]">
          <tbody>
            <FilaCobertura
              nombre="En seguimiento diario"
              valor={unidad.en_seguimiento}
              total={unidad.total}
              tono="cian"
              nota="Los que se refrescan cada noche. Lo deciden el criterio del cliente y las marcas manuales."
            />
            <FilaCobertura
              nombre="A la venta"
              valor={unidad.a_la_venta}
              total={unidad.total}
              tono="verde"
              nota="Listings BUYABLE. Uno que no está a la venta no tiene Buy Box que perder ni precio que vigilar."
            />
            <FilaCobertura
              nombre="Con precio"
              valor={unidad.con_precio}
              total={unidad.total}
              tono="verde"
              nota="Sin precio no hay margen que calcular ni oferta que comparar."
            />
            <FilaCobertura
              nombre="Con atributos de catálogo"
              valor={unidad.con_atributos}
              total={unidad.total}
              tono="azul"
              nota="Marca, categoría y medidas leídas de Catalog Items. Lo llena el trabajo «Atributos de catálogo»."
            />
            <FilaCobertura
              nombre="Con marca"
              valor={unidad.con_marca}
              total={unidad.total}
              tono="azul"
            />
            <FilaCobertura
              nombre="Con dimensiones de embalaje"
              valor={unidad.con_dimensiones}
              total={unidad.total}
              tono="violeta"
              nota="Las del EMBALAJE, que son las que usa Amazon para calcular la tarifa de FBA. Las del producto no valen para eso."
            />
            <FilaCobertura
              nombre="…y certificadas por Amazon"
              valor={unidad.con_dimensiones_amazon}
              total={unidad.total}
              tono={unidad.con_dimensiones_amazon < unidad.total / 2 ? 'ambar' : 'violeta'}
              nota="Las medidas que dio Amazon, no las que midió alguien a ojo. Sobre las demás, la tarifa de FBA que calcule A4 es una conjetura."
            />
            <FilaCobertura
              nombre={`Con ranking de los últimos ${ventanas.bsrDias} días`}
              valor={unidad.con_bsr}
              total={unidad.en_seguimiento || unidad.total}
              tono={unidad.con_bsr === 0 ? 'rojo' : 'cian'}
              nota={`Sobre los que están en seguimiento, que son los que se piden a diario. El ranking es el dato que NO se puede reconstruir hacia atrás: el día que no se guarda, se pierde.`}
            />
          </tbody>
        </table>

        {/* -------- El inventario, con sus cuatro cajones -------- */}
        <div className={`${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup2} px-[9px] py-[7px]`}>
          <p className={`${TITULO.rotulo} mb-[5px]`}>
            Inventario en Amazon · últimos {ventanas.inventarioDias} días
          </p>
          <div className="flex flex-wrap gap-x-[14px] gap-y-[3px]">
            <Cajon
              tono="verde"
              nombre="leído"
              valor={unidad.inv_conocido}
              nota="Está en FBA y tenemos sus existencias."
            />
            <Cajon
              tono="gris"
              nombre="no aplica"
              valor={unidad.inv_no_aplica}
              nota="Es FBM. Amazon no devuelve existencias de estos, y eso NO es un agujero: es la respuesta correcta. Su stock es el del propio listing."
            />
            <Cajon
              tono="ambar"
              nombre="no se pudo leer"
              valor={unidad.inv_desconocido}
              nota="Se intentó y no se pudo. Nunca se guarda como cero: un cero falso dispara una alerta de reposición que no existe."
            />
            <Cajon
              tono={unidad.inv_sin_leer > 0 ? 'ambar' : 'gris'}
              nombre="sin leer nunca"
              valor={unidad.inv_sin_leer}
              nota={`Ni una lectura en los últimos ${ventanas.inventarioDias} días. Si son muchos, el refresco diario no está llegando.`}
            />
          </div>
        </div>

        {/* -------- Últimas lecturas -------- */}
        <div className="flex flex-wrap gap-x-[14px] gap-y-[3px]">
          <Dato nombre="Último enriquecido" valor={unidad.catalogo_ultimo} />
          <Dato nombre="Último ranking" valor={unidad.bsr_ultimo} />
          <Dato nombre="Último inventario" valor={unidad.inv_ultimo} />
        </div>

        {/* -------- Ir a un SKU -------- */}
        <form
          className="flex flex-wrap items-end gap-[6px]"
          onSubmit={(e) => {
            e.preventDefault()
            const sku = buscado.trim()
            if (sku === '') return
            onAbrirSku({
              connectionId: unidad.connection_id,
              marketplaceId: unidad.marketplace_id,
              sku,
            })
          }}
        >
          <div className={`${CAMPO.contenedor} w-[260px]`}>
            <label className={CAMPO.etiqueta} htmlFor={`sku-${unidad.connection_id}-${unidad.marketplace_id}`}>
              Abrir la ficha de un SKU
            </label>
            <input
              id={`sku-${unidad.connection_id}-${unidad.marketplace_id}`}
              value={buscado}
              onChange={(e) => setBuscado(e.target.value)}
              className={CAMPO.input}
              placeholder="El SKU exacto"
            />
          </div>
          <button type="submit" className={`${BOTON.base} ${BOTON.secundario}`}>
            <Search className="h-3 w-3" />
            Abrir
          </button>
          <p className={`${CAMPO.nota} flex-1 min-w-[200px]`}>
            Para buscar por título o por ASIN, usa la tabla de la pestaña de Seguimiento.
          </p>
        </form>

        {/* Accionable, y por eso se queda: hay algo concreto que lanzar. Lo que
            se ha ido al botón de información es la consecuencia —qué módulos se
            quedan cojos sin ranking—, que no cambia nada de lo que hay que hacer. */}
        {unidad.con_bsr === 0 && unidad.en_seguimiento > 0 && (
          <Aviso tono="ambar" icono={Info}>
            Ningún ranking guardado en {ventanas.bsrDias} días. Lanza «Ranking de ventas (BSR)» desde
            Ingesta.
          </Aviso>
        )}
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------ */

function FilaCobertura({
  nombre,
  valor,
  total,
  tono,
  nota,
}: {
  nombre: string
  valor: number
  total: number
  tono: TonoEstado
  nota?: string
}) {
  /**
   * LA NOTA VA AL `title`, NO DEBAJO DEL NOMBRE.
   *
   * Eran ocho párrafos de dos líneas encima de las ocho barras: la tabla medía
   * cincuenta píxeles por fila en vez de veintiocho y había que bajar la vista
   * para ver la mitad de los datos, en la pantalla que existe justo para mirar
   * ocho cifras de un golpe. Es exactamente el texto explicativo de en medio que
   * se ha pedido quitar.
   *
   * NO SE PIERDE NADA: el texto entero está detrás del botón de información de
   * la cabecera, y aquí sigue al alcance del ratón. Mismo patrón que Cajon, unas
   * líneas más abajo, que ya lo hacía así.
   *
   * `title` y no `aria-label`: aria-label SUSTITUIRÍA el nombre de la fila para
   * un lector de pantalla, y el nombre es lo que hay que leer primero.
   */
  return (
    <tr className="align-middle" title={nota}>
      <td className={`${TIPO.m} ${TEXTO.t2} h-7 pr-3 whitespace-nowrap`}>{nombre}</td>
      <td className="h-7 w-[220px]">
        <Barra valor={valor} total={total} tono={tono} />
      </td>
    </tr>
  )
}

function Cajon({
  tono,
  nombre,
  valor,
  nota,
}: {
  tono: TonoEstado
  nombre: string
  valor: number
  nota: string
}) {
  return (
    <span className="flex items-baseline gap-[5px]" title={nota}>
      <span className="text-[11px] leading-none" style={{ color: COLOR_ESTADO[tono] }} aria-hidden>
        ●
      </span>
      <span className={`${TIPO.m} ${TEXTO.t1} font-semibold tabular-nums`}>{cifra(valor)}</span>
      <span className={`${TIPO.s} ${TEXTO.t3}`}>{nombre}</span>
    </span>
  )
}

function Dato({ nombre, valor }: { nombre: string; valor: string | null }) {
  return (
    <span className="flex items-baseline gap-[5px]">
      <span className={`${TIPO.xs} ${TEXTO.t4}`}>{nombre}</span>
      <span className={`${TIPO.s} ${TEXTO.t2}`}>
        {valor ? `${hace(valor)} · ${fechaHora(valor)}` : 'nunca'}
      </span>
    </span>
  )
}
