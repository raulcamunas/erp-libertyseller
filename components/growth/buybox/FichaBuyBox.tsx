'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, History, Timer } from 'lucide-react'
import { getAmazon } from '@/lib/amazon/client'
import type { FilaBuyBox, HistoricoRespuesta } from '@/lib/plataforma/buybox/cliente'
import {
  BOTON,
  CIFRAS,
  COLOR_ESTADO,
  LINEA,
  RADIO,
  SUPERFICIE,
  TABLA,
  TEXTO,
  TIPO,
  TITULO,
  type TonoEstado,
} from '@/lib/estilo/denso'
import {
  BUYBOX_LABELS,
  CANAL_CORTO,
  textoResultadoFoep,
  type EstadoBuyBox,
} from '@/lib/plataforma/buybox/tipos'
import {
  Aviso,
  Cargando,
  Dialogo,
  Vacio,
  cifra,
  dinero,
  fechaHora,
  hace,
  nombreMarketplace,
} from '@/components/plataforma/comun'
import { Serie, type Punto } from '@/components/plataforma/Serie'
import { AmazonEnAsin, Canal, EtiquetaVeredicto, avisoPrime, datosDe, grupoDe } from './piezas'

/**
 * LA FICHA DE UNA REFERENCIA — EL PORQUÉ ENTERO Y EL HISTÓRICO.
 *
 * Aquí es donde va el texto que la tabla no lleva. La especificación insiste en
 * que «el equipo tiene que entender la decisión, no solo obedecerla», así que
 * cada veredicto viene con SU RAZÓN ESCRITA y con LOS NÚMEROS CON LOS QUE SE
 * DECIDIÓ, que es lo que permite defenderlo cuando un cliente pregunta en marzo
 * por qué en enero se dijo lo que se dijo.
 *
 * El motivo NO se compone aquí: se guarda en la base tal cual lo escribió el
 * motor y se pinta literal. Si el texto se montara al enseñarlo, lo guardado y
 * lo visto podrían divergir y una auditoría no cuadraría.
 *
 *
 * ============ EL HISTÓRICO ES LO QUE SUSTITUYE A KEEPA ============
 *
 * Porcentaje del tiempo con la oferta destacada, evolución del número de
 * competidores y hasta dónde ha bajado cada uno. Amazon NO da histórico de nada
 * de esto: si no lo hemos guardado nosotros, no existe.
 *
 * Y como este módulo acaba de empezar a guardarlo, LO NORMAL DURANTE SEMANAS ES
 * QUE NO HAYA NINGUNO. Ese estado se dice con todas las letras y no se pinta ni
 * un cero ni un gráfico vacío: un 0 % de tiempo perdido con cero lecturas se lee
 * como «vamos perfectos», y es exactamente lo contrario de la verdad.
 */

const VENTANAS = [30, 90, 365]

/** El color de cada estado de la oferta destacada. Uno solo, y aquí */
const TONO_BUYBOX: Record<EstadoBuyBox, TonoEstado> = {
  nuestra: 'verde',
  de_otro: 'rojo',
  nadie: 'violeta',
  desconocido: 'gris',
}

export function FichaBuyBox({
  clientId,
  fila,
  lecturasParaSerie,
  onCerrar,
  onPedirTecho,
}: {
  clientId: string
  fila: FilaBuyBox
  lecturasParaSerie: number
  onCerrar: () => void
  /** Mete esta referencia en la cola del techo. null = ya está pedido */
  onPedirTecho: ((fila: FilaBuyBox) => void) | null
}) {
  const [dias, setDias] = useState(90)
  const [datos, setDatos] = useState<HistoricoRespuesta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    setCargando(true)
    const query = new URLSearchParams({
      clientId,
      connectionId: fila.connection_id,
      marketplaceId: fila.marketplace_id,
      sku: fila.sku,
      dias: String(dias),
    })
    const res = await getAmazon<HistoricoRespuesta>(`/api/plataforma/buybox/sku?${query.toString()}`)
    setCargando(false)
    if (!res.ok) {
      setError(res.error)
      setDatos(null)
      return
    }
    setError(null)
    setDatos(res.data)
  }, [clientId, fila.connection_id, fila.marketplace_id, fila.sku, dias])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return (
    <Dialogo
      titulo={fila.sku}
      ancho="max-w-[880px]"
      entradilla={
        <>
          {fila.connection_name} · {nombreMarketplace(fila.marketplace_id)}
          {fila.asin ? ` · ${fila.asin}` : ''}
          {fila.titulo ? ` · ${fila.titulo}` : ''}
        </>
      }
      onCerrar={onCerrar}
    >
      <ElVeredicto fila={fila} onPedirTecho={onPedirTecho} />
      <LosNumeros fila={fila} />

      <section>
        <div className="mb-[5px] flex flex-wrap items-center gap-2">
          <h3 className={TITULO.rotulo}>Histórico</h3>
          <div className="flex items-center gap-[4px]">
            {VENTANAS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setDias(v)}
                className={`${BOTON.chip} ${dias === v ? BOTON.chipEncendido : ''}`}
              >
                {v} d
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <Aviso tono="rojo" icono={AlertTriangle}>
            {error}
          </Aviso>
        ) : cargando && !datos ? (
          <Cargando texto="Leyendo el histórico…" />
        ) : datos ? (
          <ElHistorico datos={datos} lecturasParaSerie={lecturasParaSerie} moneda={fila.moneda} />
        ) : null}
      </section>
    </Dialogo>
  )
}

/* ------------------------------------------------------------------ */
/* El veredicto, con su razón entera                                   */
/* ------------------------------------------------------------------ */

function ElVeredicto({
  fila,
  onPedirTecho,
}: {
  fila: FilaBuyBox
  onPedirTecho: ((fila: FilaBuyBox) => void) | null
}) {
  const grupo = grupoDe(fila.veredicto)
  const prime = avisoPrime(fila)

  return (
    <section className={`${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup2} px-[10px] py-[9px]`}>
      <div className="mb-[5px] flex flex-wrap items-center gap-2">
        <EtiquetaVeredicto veredicto={fila.veredicto} fuerte />
        <span className={`${TIPO.s} ${TEXTO.t4}`}>
          diagnosticado {hace(fila.fecha)} · {fechaHora(fila.fecha)}
        </span>
        {fila.foep_estado === 'no_consultado' && onPedirTecho && (
          <button
            type="button"
            onClick={() => onPedirTecho(fila)}
            className={`${BOTON.base} ${BOTON.secundario} ml-auto`}
            title="Mete esta referencia en la cola para pedirle el techo a Amazon en el próximo barrido. NO se llama a Amazon ahora: esa operación admite una petición cada treinta segundos."
          >
            <Timer className="h-[13px] w-[13px]" />
            Pedir el techo
          </button>
        )}
      </div>

      {/* EL PORQUÉ, LITERAL. Es el texto que guardó el motor con sus números
          dentro, y es el que sale en la exportación que se le enseña al cliente. */}
      <p className={`${TIPO.s} ${TEXTO.t2} leading-[1.6]`}>{fila.motivo}</p>

      {fila.accion && (
        <p className={`${TIPO.s} ${TEXTO.t3} mt-[6px]`}>
          <span className={TITULO.rotulo}>Qué hacer </span>
          {fila.accion}
        </p>
      )}

      {/* LA PROPUESTA DE PRECIO, SIEMPRE EN SIMULACRO. Este módulo observa y
          diagnostica: no escribe ni un precio en Amazon. */}
      {(fila.precio_propuesto !== null || fila.precio_propuesto_motivo) && (
        <div className={`mt-[7px] border-t pt-[7px] ${LINEA.normal}`}>
          <p className={`${TIPO.s} ${TEXTO.t3} leading-[1.6]`}>
            <span className={TITULO.rotulo}>
              {grupo === 'nuestra' ? 'Precio que se podría probar ' : 'Precio propuesto '}
            </span>
            {fila.precio_propuesto !== null && (
              <strong className={`${TEXTO.t1} ${TIPO.num}`}>
                {dinero(fila.precio_propuesto, fila.moneda)}
              </strong>
            )}{' '}
            {fila.precio_propuesto_motivo}
          </p>
          <p className={`${TIPO.s} ${TEXTO.t4} mt-[3px]`}>
            Simulacro: desde esta pantalla no sale nada hacia Amazon. Los cambios de precio se hacen
            a mano en Amazon API · Catálogo y quedan registrados.
          </p>
        </div>
      )}

      {prime && <p className={`${TIPO.s} ${TEXTO.t4} mt-[7px] leading-[1.5]`}>{prime}</p>}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Los números con los que se decidió                                  */
/* ------------------------------------------------------------------ */

function LosNumeros({ fila }: { fila: FilaBuyBox }) {
  const d = datosDe(fila)
  const faltaba = Array.isArray(d.faltaba) ? d.faltaba : []

  return (
    <section>
      <h3 className={`${TITULO.rotulo} mb-[5px]`}>Con qué números se decidió</h3>
      <div className="grid gap-x-[14px] gap-y-[2px] [grid-template-columns:repeat(auto-fit,minmax(215px,1fr))]">
        <Dato rotulo="Nuestro precio" valor={dinero(fila.precio_propio, fila.moneda)} />
        <Dato
          rotulo="Nuestro precio con envío"
          valor={dinero(d.precioPropioLanded ?? null, fila.moneda)}
          pista="El FOEP es precio de listing SIN envío. Este importe se enseña, nunca se compara con el techo: sería comparar dos cosas distintas."
        />
        <Dato rotulo="Oferta destacada" valor={BUYBOX_LABELS[fila.buybox_estado]} />
        <Dato rotulo="Precio de la destacada" valor={dinero(d.precioBuybox ?? null, fila.moneda)} />
        <Dato
          rotulo="Canal de quien la tiene"
          valor={d.canalGanador ? CANAL_CORTO[d.canalGanador] : '—'}
        />
        <Dato rotulo="Nuestro canal" valor={d.canalPropio ? CANAL_CORTO[d.canalPropio] : '—'} />
        <Dato rotulo="Ofertas ajenas" valor={cifra(d.competidores ?? null)} />
        <Dato
          rotulo="…de ellas con Prime"
          valor={cifra(d.competidoresPrime ?? null)}
          pista="Cuenta FBA y Prime del vendedor (SFP). Son las que compiten de tú a tú por la oferta destacada."
        />
        <Dato
          rotulo="Precio más bajo de la competencia"
          valor={dinero(d.precioCompetidorMin ?? null, fila.moneda)}
        />
        <Dato
          rotulo="Techo de Amazon"
          valor={
            fila.foep !== null
              ? dinero(fila.foep, fila.moneda)
              : textoResultadoFoep(d.foepResultado ?? null)
          }
          pista={
            fila.foep_estado === 'no_consultado'
              ? 'No se le ha preguntado en esta ronda: el techo va por rotación porque es la llamada más cara que hay, una cada treinta segundos.'
              : undefined
          }
        />
        <Dato
          rotulo="Edad del techo"
          valor={
            typeof d.foepHoras === 'number'
              ? `${d.foepHoras.toLocaleString('es-ES', { maximumFractionDigits: 1 })} h`
              : '—'
          }
          pista="Amazon no dice cuándo recalcula el techo ni sella la respuesta con una hora. Esta es NUESTRA marca de lectura, y un veredicto tomado con un techo de seis días vale menos que uno de hace una hora."
        />
        <Dato
          rotulo="Existencias"
          valor={
            d.stock === 'conocido'
              ? cifra(d.stockUnidades ?? null)
              : d.stock === 'no_aplica'
                ? `lo envía el vendedor${d.stockUnidades !== null && d.stockUnidades !== undefined ? ` · ${cifra(d.stockUnidades)}` : ''}`
                : 'no se pudo leer'
          }
          pista="«No aplica» es un SKU que envía el vendedor: Amazon no tiene existencias suyas, y eso NO es cero. «No se pudo leer» tampoco lo es."
        />
      </div>

      <div className="mt-[6px] flex flex-wrap items-center gap-2">
        <span className={TITULO.rotulo}>Amazon en el ASIN</span>
        <AmazonEnAsin estado={fila.amazon_estado} />
        <span className={TITULO.rotulo}>Canal del listing</span>
        <Canal canal={d.canalPropio ?? null} />
      </div>

      {/* LO QUE FALTABA POR DECIDIR CUANDO SE DECIDIÓ. Va aquí y no en la
          configuración porque es lo que explica por qué este veredicto concreto
          no llega más lejos: un motor que calla lo que no sabe es
          indistinguible de uno que lo sabe todo. */}
      {faltaba.length > 0 && (
        <div className={`mt-[7px] ${RADIO.r2} border ${LINEA.normal} px-[9px] py-[7px]`}>
          <p className={`${TITULO.rotulo} mb-[3px]`}>Lo que faltaba por decidir</p>
          <ul className={`${TIPO.s} ${TEXTO.t3} ml-[14px] list-disc space-y-[2px] leading-[1.5]`}>
            {faltaba.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function Dato({ rotulo, valor, pista }: { rotulo: string; valor: string; pista?: string }) {
  return (
    <span className="flex items-baseline justify-between gap-2 min-w-0" title={pista}>
      <span className={`${TIPO.xs} ${TEXTO.t4} truncate`}>{rotulo}</span>
      <span className={`${TIPO.m} ${TEXTO.t2} ${TIPO.num} shrink-0`}>{valor}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* El histórico                                                        */
/* ------------------------------------------------------------------ */

function ElHistorico({
  datos,
  lecturasParaSerie,
  moneda,
}: {
  datos: HistoricoRespuesta
  lecturasParaSerie: number
  moneda: string | null
}) {
  const h = datos.historico

  const puntosCompetidores = useMemo<Punto[]>(
    () => h.serie.map((p) => ({ t: Date.parse(p.f), v: p.c })),
    [h.serie]
  )
  const puntosPrecio = useMemo<Punto[]>(
    () => h.serie.map((p) => ({ t: Date.parse(p.f), v: p.p })),
    [h.serie]
  )

  /**
   * NI UNA LECTURA. Es el estado normal de este módulo durante sus primeras
   * semanas y NO se pinta como un cero ni como un gráfico vacío: se dice.
   */
  if (h.lecturas === 0) {
    return (
      <Vacio icono={<History />} titulo="Todavía no hay ni una lectura guardada de esta referencia">
        El histórico de Buy Box no existe hasta que lo guardamos nosotros: Amazon no da ninguno. En
        cuanto el trabajo <strong>Precios y Buy Box</strong> corra sobre esta cuenta, cada noche deja
        aquí un punto y a partir de ahí se puede decir qué parte del tiempo tuvimos la oferta
        destacada y hasta dónde ha bajado cada competidor.
      </Vacio>
    )
  }

  const fiable = h.lecturas_con_juicio >= lecturasParaSerie
  const peso = h.lecturas_con_juicio > 0 ? 100 / h.lecturas_con_juicio : null

  return (
    <div className="space-y-[9px]">
      <div className={CIFRAS.tira}>
        <Cifra rotulo="lecturas" valor={cifra(h.lecturas)} />
        <Cifra
          rotulo="con juicio"
          valor={cifra(h.lecturas_con_juicio)}
          pista="Las lecturas en las que se pudo saber quién tenía la oferta destacada. Un fallo de red NO cuenta como perdida: contarlo bajaría el porcentaje que se le enseña al cliente."
        />
        <Cifra
          rotulo={h.porcentaje === null ? 'del tiempo · sin medir' : 'del tiempo con la destacada'}
          valor={
            h.porcentaje === null
              ? '—'
              : `${h.porcentaje.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`
          }
          urgente={h.porcentaje !== null && h.porcentaje < 50}
          pista={
            h.porcentaje === null
              ? 'Ninguna lectura pudo juzgarse, así que el porcentaje no existe. Cero por ciento y «no se sabe» no son lo mismo.'
              : undefined
          }
        />
        <Cifra rotulo="competidores hoy" valor={cifra(h.competidores_ultimo)} />
        <Cifra
          rotulo="competidores mín-máx"
          valor={`${cifra(h.competidores_min)}–${cifra(h.competidores_max)}`}
        />
      </div>

      {/* LA FIABILIDAD, EN UNA LÍNEA Y DERIVADA DEL PROPIO DATO. No es un aviso
          de colores: es la aritmética de lo que se está mirando. Con cuatro
          lecturas, una sola noche mueve el porcentaje veinticinco puntos. */}
      <p className={`${TIPO.s} ${TEXTO.t4} leading-[1.5]`}>
        {h.primera ? `Desde ${fechaHora(h.primera)}` : 'Sin primera lectura'} ·{' '}
        {h.ultima ? `última ${hace(h.ultima)}` : 'sin última'}.{' '}
        {peso === null
          ? 'Todavía no hay ninguna lectura con juicio.'
          : fiable
            ? `Cada lectura pesa ${peso.toLocaleString('es-ES', { maximumFractionDigits: 1 })} puntos del porcentaje.`
            : `Con ${h.lecturas_con_juicio} lectura${h.lecturas_con_juicio === 1 ? '' : 's'}, cada una pesa ${peso.toLocaleString('es-ES', { maximumFractionDigits: 1 })} puntos del porcentaje: esta cifra describe la última subasta, no el mes. A partir de ${lecturasParaSerie} lecturas se puede leer sola.`}
      </p>

      <Franja serie={h.serie} />

      {h.serie.length < 2 ? (
        <p className={`${TIPO.s} ${TEXTO.t4}`}>
          Una sola lectura: todavía no hay serie que dibujar. No se pinta un gráfico de un punto
          porque una línea plana de una observación se lee como estabilidad.
        </p>
      ) : (
        <div className="grid gap-[9px] [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
          <Grafico titulo="Ofertas ajenas">
            <Serie
              puntos={puntosCompetidores}
              desde={Date.parse(h.primera ?? h.serie[0].f)}
              hasta={Date.parse(h.ultima ?? h.serie[h.serie.length - 1].f)}
              tono="cian"
              etiqueta="Evolución del número de ofertas ajenas"
              formato={(v) => v.toLocaleString('es-ES')}
            />
          </Grafico>
          <Grafico titulo="Nuestro precio de listing">
            <Serie
              puntos={puntosPrecio}
              desde={Date.parse(h.primera ?? h.serie[0].f)}
              hasta={Date.parse(h.ultima ?? h.serie[h.serie.length - 1].f)}
              tono="azul"
              etiqueta="Evolución de nuestro precio de listing"
              formato={(v) => dinero(v, moneda)}
            />
          </Grafico>
        </div>
      )}

      {(h.foep_min !== null || h.foep_max !== null) && (
        <p className={`${TIPO.s} ${TEXTO.t4}`}>
          Techo de Amazon visto entre {dinero(h.foep_min, moneda)} y {dinero(h.foep_max, moneda)}. El
          techo va por rotación, así que su serie tiene muchos menos puntos que la de precios.
        </p>
      )}

      <Competidores
        competidores={datos.competidores}
        moneda={moneda}
        dias={datos.dias}
        precioMinVisto={h.precio_competidor_min_visto}
      />
    </div>
  )
}

function Cifra({
  rotulo,
  valor,
  pista,
  urgente,
}: {
  rotulo: string
  valor: string
  pista?: string
  urgente?: boolean
}) {
  return (
    <span className={CIFRAS.celda} title={pista}>
      <span className={`${CIFRAS.valor} ${urgente ? CIFRAS.urgente : ''}`}>{valor}</span>
      <span className={CIFRAS.rotulo}>{rotulo}</span>
    </span>
  )
}

function Grafico({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className={`${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup} px-[9px] py-[7px]`}>
      <p className={`${TITULO.rotulo} mb-[3px]`}>{titulo}</p>
      {children}
    </div>
  )
}

/**
 * LA FRANJA: una casilla por lectura, en orden.
 *
 * Contesta de un vistazo la pregunta que el porcentaje no contesta: ¿la perdimos
 * de golpe o la vamos perdiendo a ratos? Y los huecos de lectura salen en gris,
 * que es lo que impide leer un fallo de red como una pérdida.
 */
function Franja({ serie }: { serie: HistoricoRespuesta['historico']['serie'] }) {
  if (serie.length === 0) return null
  return (
    <div>
      <p className={`${TITULO.rotulo} mb-[3px]`}>Quién la tuvo, lectura a lectura</p>
      <div className="flex flex-wrap gap-[2px]">
        {serie.map((p, i) => (
          <span
            key={i}
            className="h-[14px] w-[7px] rounded-[2px]"
            style={{ backgroundColor: COLOR_ESTADO[TONO_BUYBOX[p.b] ?? 'gris'] }}
            title={`${fechaHora(p.f)} · ${BUYBOX_LABELS[p.b] ?? 'Sin dato'}`}
          />
        ))}
      </div>
      <div className="mt-[3px] flex flex-wrap gap-x-[10px] gap-y-[2px]">
        {(['nuestra', 'de_otro', 'nadie', 'desconocido'] as EstadoBuyBox[]).map((e) => (
          <span key={e} className="flex items-center gap-[4px]">
            <span
              className="h-[8px] w-[8px] rounded-[2px]"
              style={{ backgroundColor: COLOR_ESTADO[TONO_BUYBOX[e]] }}
              aria-hidden
            />
            <span className={`${TIPO.s} ${TEXTO.t4}`}>{BUYBOX_LABELS[e]}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Hasta dónde ha bajado cada competidor                               */
/* ------------------------------------------------------------------ */

function Competidores({
  competidores,
  moneda,
  dias,
  precioMinVisto,
}: {
  competidores: HistoricoRespuesta['competidores']
  moneda: string | null
  dias: number
  precioMinVisto: number | null
}) {
  if (competidores.length === 0) {
    return (
      <p className={`${TIPO.s} ${TEXTO.t4}`}>
        No se ha guardado ninguna oferta en estos {dias} días. Cuántas ofertas se guardan por lectura
        se configura por cliente.
      </p>
    )
  }

  return (
    <div>
      <p className={`${TITULO.rotulo} mb-[3px]`}>
        Hasta dónde ha bajado cada uno · {dias} días
        {precioMinVisto !== null && ` · el más bajo visto, ${dinero(precioMinVisto, moneda)}`}
      </p>
      <div className={`${TABLA.caja} max-h-[220px]`}>
        <table className={TABLA.tabla}>
          <thead>
            <tr>
              <th className={`${TABLA.cabecera} ${TABLA.cabeceraFija}`}>Vendedor</th>
              <th className={TABLA.cabecera}>Visto</th>
              <th className={TABLA.cabecera}>Con la destacada</th>
              <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Más bajo</th>
              <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Más alto</th>
              <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Último</th>
              <th className={TABLA.cabecera}>Canal</th>
              <th className={TABLA.cabecera}>Última vez</th>
            </tr>
          </thead>
          <tbody>
            {competidores.map((c) => (
              <tr key={c.vendedor} className={TABLA.fila}>
                <td className={`${TABLA.celda} ${TABLA.celdaFija}`}>
                  <span className={c.es_nuestro ? TEXTO.acento : TEXTO.t2}>
                    {c.es_nuestro ? 'Nosotros' : c.vendedor}
                  </span>
                </td>
                <td className={`${TABLA.celda} ${TABLA.numero}`}>{cifra(c.veces_visto)}</td>
                <td className={`${TABLA.celda} ${TABLA.numero}`}>{cifra(c.veces_destacada)}</td>
                <td className={`${TABLA.celda} ${TABLA.numero}`}>{dinero(c.precio_min, moneda)}</td>
                <td className={`${TABLA.celda} ${TABLA.numero}`}>{dinero(c.precio_max, moneda)}</td>
                <td className={`${TABLA.celda} ${TABLA.numero}`}>
                  {dinero(c.precio_ultimo, moneda)}
                </td>
                <td className={TABLA.celda}>{c.canal_ultimo ?? '—'}</td>
                <td className={TABLA.celda}>{hace(c.ultima)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={`${TIPO.s} ${TEXTO.t4} mt-[3px]`}>
        Los precios son de listing, sin envío. El identificador de vendedor es lo único que Amazon
        devuelve: en esta respuesta no viene el nombre de la tienda.
      </p>
    </div>
  )
}
