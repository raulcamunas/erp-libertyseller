'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CircleAlert, Hand } from 'lucide-react'
import { getAmazon } from '@/lib/amazon/client'
import type { ClienteConIngesta, SkuRespuesta } from '@/lib/plataforma/cliente'
import {
  BOTON,
  CIFRAS,
  COLOR_ESTADO,
  LINEA,
  RADIO,
  SUPERFICIE,
  TEXTO,
  TIPO,
  TITULO,
} from '@/lib/estilo/denso'
import { Aviso, Cargando, Dialogo, cifra, dinero, fechaHora, hace, nombreMarketplace } from './comun'
import type { SkuAbierto } from './PlataformaBoard'
import { Serie, type Punto } from './Serie'

/**
 * LA FICHA DE UN SKU — LA VERSIÓN DE A1.
 *
 * Es la pantalla que describe la especificación así: «la que va a usar el equipo
 * cuando un cliente pregunte "¿qué pasa con este producto?"». Aquí está lo que
 * A1 sabe hoy: los datos del listing y las dos series que la ingesta llena
 * —ranking de ventas e inventario—.
 *
 *
 * ============ LAS SERIES SE PINTAN COMO EVOLUCIÓN, NO COMO TABLA ============
 *
 * Una columna de noventa números no contesta «¿esto va a mejor o a peor?», que
 * es la única pregunta que se hace quien abre esta ficha. Y hay dos detalles del
 * dibujo que no son estéticos:
 *
 *   · EL EJE DEL RANKING VA AL REVÉS: un número más bajo es un puesto mejor, así
 *     que el 400 va por encima del 90.000. Con el eje normal, el gráfico contaría
 *     lo contrario de lo que pasa.
 *   · LOS DÍAS SIN LEER SE VEN COMO HUECOS. Unir los extremos dibujaría una
 *     interpolación que nadie observó.
 *
 *
 * ============ LO QUE FALTA, Y SE DICE EN VEZ DE DEJARLO EN BLANCO ============
 *
 * Precio histórico, Buy Box, competidores y tarifas son de A2 y A4. La tabla
 * existe (amazon_snapshots_precio, de la migración 123) y está vacía. Un hueco en
 * blanco parece un fallo; una frase que dice «esto lo llena el módulo siguiente»
 * no.
 */

const VENTANAS = [30, 90, 365]

export function FichaSku({
  cliente,
  abierto,
  onCerrar,
}: {
  cliente: ClienteConIngesta
  abierto: SkuAbierto
  onCerrar: () => void
}) {
  const [dias, setDias] = useState(90)
  const [datos, setDatos] = useState<SkuRespuesta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    setCargando(true)
    const query = new URLSearchParams({
      clientId: cliente.id,
      connectionId: abierto.connectionId,
      marketplaceId: abierto.marketplaceId,
      sku: abierto.sku,
      dias: String(dias),
    })
    const res = await getAmazon<SkuRespuesta>(`/api/plataforma/sku?${query.toString()}`)
    setCargando(false)
    if (!res.ok) {
      setError(res.error)
      setDatos(null)
      return
    }
    setError(null)
    setDatos(res.data)
  }, [cliente.id, abierto.connectionId, abierto.marketplaceId, abierto.sku, dias])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return (
    <Dialogo
      titulo={abierto.sku}
      ancho="max-w-[860px]"
      entradilla={
        <>
          {cliente.name} · {nombreMarketplace(abierto.marketplaceId)}
          {datos?.listing.title ? ` · ${datos.listing.title}` : ''}
        </>
      }
      onCerrar={onCerrar}
    >
      {error ? (
        <Aviso tono="rojo" icono={AlertTriangle}>
          {error}
        </Aviso>
      ) : cargando && !datos ? (
        <Cargando texto="Leyendo la ficha…" />
      ) : datos ? (
        <Contenido datos={datos} dias={dias} onDias={setDias} />
      ) : null}
    </Dialogo>
  )
}

/* ------------------------------------------------------------------ */

function Contenido({
  datos,
  dias,
  onDias,
}: {
  datos: SkuRespuesta
  dias: number
  onDias: (d: number) => void
}) {
  const l = datos.listing
  const dentro = l.activo_manual ?? l.activo_calculado
  const manual = l.activo_manual !== null

  const hasta = Date.now()
  const desde = hasta - dias * 86400000

  /**
   * Los rankings van SEPARADOS por tipo y categoría, no juntos en un gráfico.
   *
   * «#113 en Televisores QLED» y «#72.855 en Electrónica» son los dos el ranking
   * del mismo producto y no se pueden dibujar en el mismo eje: el pequeño queda
   * aplastado contra el borde y la línea del grande tapa cualquier movimiento.
   */
  const seriesBsr = useMemo(() => {
    const grupos = new Map<string, { tipo: string; categoria: string; puntos: Punto[] }>()
    for (const s of datos.bsr) {
      const clave = `${s.tipo}|${s.categoria}`
      const g = grupos.get(clave) ?? { tipo: s.tipo, categoria: s.categoria, puntos: [] }
      g.puntos.push({
        t: new Date(s.fecha).getTime(),
        v: s.rank,
        nota: `Puesto ${s.rank.toLocaleString('es-ES')} en ${s.categoria} · ${new Date(s.fecha).toLocaleString('es-ES')}`,
      })
      grupos.set(clave, g)
    }
    return [...grupos.values()].sort((a, b) => (a.tipo === 'grupo' ? -1 : 1) - (b.tipo === 'grupo' ? -1 : 1))
  }, [datos.bsr])

  /**
   * El inventario, con los estados convertidos en huecos.
   *
   * `estado_dato` distinto de 'conocido' NO es un cero: es «este SKU es de FBM y
   * Amazon no devuelve sus existencias» o «se intentó leer y no se pudo». Un cero
   * ahí dispararía una alerta de reposición que no existe, que es el fallo
   * concreto que los tres estados de la migración 123 vienen a impedir.
   */
  const serieInventario = useMemo<Punto[]>(
    () =>
      datos.inventario.map((s) => ({
        t: new Date(s.fecha).getTime(),
        v: s.estado_dato === 'conocido' ? (s.disponible ?? s.total ?? 0) : null,
        nota:
          s.estado_dato === 'conocido'
            ? `${cifra(s.disponible)} disponibles · ${cifra(s.reservado)} reservados · ${new Date(s.fecha).toLocaleString('es-ES')}`
            : s.estado_dato === 'no_aplica'
              ? `Gestionado por el vendedor: Amazon no tiene existencias de este SKU. Su stock propio era ${cifra(s.stock_propio)}`
              : 'No se pudo leer el inventario en esta pasada. No es cero: es que no lo sabemos',
      })),
    [datos.inventario]
  )

  const ultimoInventario = datos.inventario.length > 0 ? datos.inventario[datos.inventario.length - 1] : null

  return (
    <div className="space-y-2">
      {/* -------- Lo que hay que saber de un vistazo --------
          La tira lleva `overflow-hidden` por contrato, así que en un móvil las
          dos últimas celdas —«a la venta» y «en seguimiento», que son de lo más
          importante que hay aquí— se recortaban y no había forma de verlas.
          El envoltorio con scroll y el `min-w-max` las dejan alcanzables sin
          tocar los 28 px de alto ni el contrato. */}
      <div className="overflow-x-auto">
      <div className={`${CIFRAS.tira} min-w-max`}>
        <span className={CIFRAS.celda}>
          <span className={CIFRAS.valor}>{l.is_fba ? 'FBA' : 'FBM'}</span>
          <span className={CIFRAS.rotulo}>canal</span>
        </span>
        <span className={CIFRAS.celda}>
          <span className={CIFRAS.valor}>{dinero(l.price, l.currency)}</span>
          <span className={CIFRAS.rotulo}>precio</span>
        </span>
        <span className={CIFRAS.celda}>
          <span className={CIFRAS.valor}>
            {l.is_fba ? cifra(l.fba_fulfillable_quantity ?? l.fba_quantity) : cifra(l.quantity)}
          </span>
          <span className={CIFRAS.rotulo}>{l.is_fba ? 'en Amazon' : 'stock propio'}</span>
        </span>
        <span className={CIFRAS.celda}>
          <span className={CIFRAS.valor}>{l.listing_status.includes('BUYABLE') ? 'sí' : 'no'}</span>
          <span className={CIFRAS.rotulo}>a la venta</span>
        </span>
        <span className={CIFRAS.celda}>
          <span className={`${CIFRAS.valor} ${dentro ? '' : TEXTO.t3}`}>{dentro ? 'sí' : 'no'}</span>
          <span className={CIFRAS.rotulo}>en seguimiento</span>
        </span>
      </div>
      </div>

      {/* -------- Por qué se sigue o no -------- */}
      <div className={`${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup2} px-[9px] py-[7px]`}>
        <p className={`${TIPO.xs} ${TEXTO.t4} mb-[2px] flex items-center gap-[5px]`}>
          {manual ? (
            <>
              <Hand className="h-3 w-3" style={{ color: COLOR_ESTADO.naranja }} />
              Lo decidió una persona
            </>
          ) : (
            <>Lo decidió la regla del cliente</>
          )}
          {l.activo_evaluado_at && !manual && (
            <span className={TEXTO.t4}>· evaluado {hace(l.activo_evaluado_at)}</span>
          )}
        </p>
        <p className={`${TIPO.m} ${TEXTO.t2}`}>{l.activo_motivo ?? 'Todavía no se ha evaluado.'}</p>
      </div>

      {/* -------- La ventana -------- */}
      <div className="flex items-center gap-[6px]">
        <span className={`${TIPO.xs} ${TEXTO.t4}`}>Histórico</span>
        {VENTANAS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onDias(d)}
            className={`${BOTON.chip} ${dias === d ? BOTON.chipEncendido : ''}`}
          >
            {d === 365 ? 'un año' : `${d} días`}
          </button>
        ))}
      </div>

      {/* -------- Ranking de ventas -------- */}
      <section className={`${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup} px-[10px] py-[9px]`}>
        <h3 className={`${TITULO.seccion} mb-[3px]`}>Ranking de ventas</h3>
        {seriesBsr.length === 0 ? (
          /* Empty state: dice QUÉ FALTA y de qué depende, que es lo que separa
             «esto está roto» de «esto todavía no ha corrido». Lo que se ha ido
             al botón de información es el porqué —que el ranking no se puede
             reconstruir hacia atrás—, que no cambia nada de lo que hay que hacer. */
          <p className={`${TIPO.s} ${TEXTO.t3}`}>
            Ninguna observación en esta ventana. Lo guarda el trabajo «Ranking de ventas (BSR)», que
            solo pasa por los SKU en seguimiento.
          </p>
        ) : (
          <div className="space-y-[9px]">
            {seriesBsr.map((s) => (
              <div key={`${s.tipo}|${s.categoria}`}>
                <p className={`${TIPO.xs} ${TEXTO.t4} flex items-baseline gap-[5px]`}>
                  {s.categoria}
                  <span className={TEXTO.t4}>
                    · {s.tipo === 'grupo' ? 'categoría raíz' : 'subcategoría'} · arriba es mejor
                  </span>
                  <span className={`${TEXTO.t2} ml-auto tabular-nums`}>
                    último: #{cifra(s.puntos[s.puntos.length - 1]?.v)}
                  </span>
                </p>
                <Serie
                  puntos={s.puntos}
                  desde={desde}
                  hasta={hasta}
                  tono="violeta"
                  invertido
                  formato={(v) => `#${Math.round(v).toLocaleString('es-ES')}`}
                  etiqueta={`Ranking de ventas en ${s.categoria}`}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* -------- Inventario -------- */}
      <section className={`${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup} px-[10px] py-[9px]`}>
        <h3 className={`${TITULO.seccion} mb-[3px]`}>Existencias en Amazon</h3>
        {datos.inventario.length === 0 ? (
          <p className={`${TIPO.s} ${TEXTO.t3}`}>
            Ninguna lectura en esta ventana.{' '}
            {l.is_fba
              ? 'Lo llena el trabajo «Inventario en Amazon», que corre de madrugada sobre los SKU en seguimiento.'
              : 'Este SKU lo gestiona el vendedor, así que Amazon no devuelve existencias suyas: su stock es el del propio listing, que se ve arriba.'}
          </p>
        ) : (
          <>
            <p className={`${TIPO.xs} ${TEXTO.t4} flex items-baseline gap-[5px]`}>
              Unidades disponibles
              {ultimoInventario && (
                <span className={`${TEXTO.t2} ml-auto tabular-nums`}>
                  último: {estadoInventario(ultimoInventario.estado_dato)} ·{' '}
                  {hace(ultimoInventario.fecha)}
                </span>
              )}
            </p>
            <Serie
              puntos={serieInventario}
              desde={desde}
              hasta={hasta}
              tono="cian"
              formato={(v) => Math.round(v).toLocaleString('es-ES')}
              etiqueta="Unidades disponibles en Amazon"
            />
            {serieInventario.some((p) => p.v === null) && (
              <p className={`${TIPO.s} ${TEXTO.t4} mt-[3px]`}>
                Los cortes de la línea son lecturas sin dato, no ceros: o el SKU estaba en FBM —y
                Amazon no devuelve existencias de esos— o no se pudo leer. Un cero ahí dispararía una
                alerta de reposición que no existe.
              </p>
            )}
          </>
        )}
      </section>

      {/* Aquí vivía un aviso azul permanente explicando que el precio histórico y
          la Buy Box todavía no se guardan. No era accionable —no había nada que
          hacer al respecto— y ocupaba el mismo sitio todos los días: se ha ido al
          botón de información de la cabecera, en InfoIngesta. */}

      {/* -------- Los datos del listing -------- */}
      <section className={`${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup} px-[10px] py-[9px]`}>
        <h3 className={`${TITULO.seccion} mb-[5px]`}>Datos del catálogo</h3>
        <dl className="grid gap-x-[14px] gap-y-[3px] [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
          <Dato nombre="ASIN" valor={l.asin} />
          <Dato nombre="Marca" valor={l.marca} />
          <Dato nombre="Categoría" valor={l.categoria} />
          <Dato nombre="Clasificación" valor={l.clasificacion_item} />
          <Dato nombre="Marca propia" valor={l.es_marca_propia ? 'sí' : 'no'} />
          <Dato
            nombre={l.codigo_externo_tipo ? `Código ${l.codigo_externo_tipo}` : 'Código externo'}
            valor={l.codigo_externo}
          />
          <Dato nombre="Tipo de producto" valor={l.product_type} />
          <Dato nombre="Canal de logística" valor={l.fulfillment_channel_code} />
          <Dato nombre="Estado del listing" valor={l.listing_status.join(', ') || null} />
          <Dato nombre="Medidas del producto" valor={medidas(l.largo, l.ancho, l.alto, l.dims_unidad, l.peso, l.peso_unidad)} />
          <Dato
            nombre="Medidas del embalaje"
            valor={medidas(
              l.largo_paquete,
              l.ancho_paquete,
              l.alto_paquete,
              l.dims_paquete_unidad,
              l.peso_paquete,
              l.peso_paquete_unidad
            )}
            nota="Es la que usa Amazon para calcular la tarifa de FBA."
          />
          <Dato
            nombre="Origen de las medidas"
            valor={l.dims_origen}
            nota={
              l.dims_origen === 'amazon'
                ? 'Certificadas por Amazon.'
                : l.dims_origen
                  ? 'No las dio Amazon: la tarifa de FBA que salga de aquí es una estimación menos fiable.'
                  : 'Sin medidas todavía.'
            }
          />
          <Dato nombre="Visto en el catálogo" valor={fechaHora(l.catalogo_visto_at)} />
          <Dato nombre="Visto en el barrido" valor={fechaHora(l.last_seen_at)} />
        </dl>
      </section>

      {/* -------- Incidencias de este SKU -------- */}
      {datos.eventos.length > 0 && (
        <section className={`${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup} px-[10px] py-[9px]`}>
          <h3 className={`${TITULO.seccion} mb-[3px]`}>Incidencias abiertas de este SKU</h3>
          <ul className="space-y-[3px]">
            {datos.eventos.map((e) => (
              <li key={e.id} className="flex items-start gap-[6px]">
                <CircleAlert
                  className="mt-[2px] h-3 w-3 shrink-0"
                  style={{
                    color:
                      e.severidad === 'critico' || e.severidad === 'error'
                        ? COLOR_ESTADO.rojo
                        : COLOR_ESTADO.ambar,
                  }}
                />
                <span className={`${TIPO.s} ${TEXTO.t2}`}>
                  {e.mensaje} <span className={TEXTO.t4}>· {fechaHora(e.created_at)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Aquí iba una nota al pie explicando que las series se buscan por
          vendedor, país y SKU y no por el identificador de la fila. Es una
          decisión de diseño de la base, no algo que quien mira una ficha pueda
          hacer nada al respecto: está en el botón de información. */}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Dato({
  nombre,
  valor,
  nota,
}: {
  nombre: string
  valor: string | null
  nota?: string
}) {
  return (
    <div className="min-w-0">
      <dt className={`${TIPO.xs} ${TEXTO.t4}`}>{nombre}</dt>
      <dd className={`${TIPO.m} ${TEXTO.t2} break-words`}>
        {valor ?? <span className={TEXTO.t4}>—</span>}
        {nota && <span className={`${TIPO.s} ${TEXTO.t4} block leading-[1.4]`}>{nota}</span>}
      </dd>
    </div>
  )
}

/**
 * Las medidas SIEMPRE con su unidad.
 *
 * Amazon devuelve libras en Norteamérica y kilos en Europa, y en su propio
 * ejemplo oficial el mismo paquete viene en pulgadas y kilogramos. Un número sin
 * unidad en esta ficha es un número que alguien va a leer como el que espera.
 */
function medidas(
  largo: number | null,
  ancho: number | null,
  alto: number | null,
  unidad: string | null,
  peso: number | null,
  pesoUnidad: string | null
): string | null {
  const partes: string[] = []
  if (largo !== null && ancho !== null && alto !== null) {
    partes.push(`${largo} × ${ancho} × ${alto} ${unidad ?? ''}`.trim())
  }
  if (peso !== null) partes.push(`${peso} ${pesoUnidad ?? ''}`.trim())
  return partes.length > 0 ? partes.join(' · ') : null
}

function estadoInventario(estado: string): string {
  switch (estado) {
    case 'conocido':
      return 'leído'
    case 'no_aplica':
      return 'no aplica (FBM)'
    default:
      return 'no se pudo leer'
  }
}
