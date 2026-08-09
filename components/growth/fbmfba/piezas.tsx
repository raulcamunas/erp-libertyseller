'use client'

import {
  Ban,
  CheckCircle2,
  CircleDashed,
  HelpCircle,
  Info,
  PackageCheck,
  Ruler,
  TrendingDown,
  Truck,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { COLOR_ESTADO, ESTADO, TEXTO, TIPO } from '@/lib/estilo/denso'
import { dinero } from '@/components/plataforma/comun'
import type {
  AnalisisSku,
  CanalA4,
  ConfianzaDims,
  ProcedenciaDims,
  ResultadoMargen,
  Rotacion,
  VeredictoA4,
} from '@/lib/plataforma/fbmfba/cliente'

/**
 * LAS PIEZAS DE LA TABLA DE FBM → FBA.
 *
 * Regla que atraviesa todas: PRIMERO EL GLIFO, DESPUÉS LA PALABRA Y SOLO AL
 * FINAL EL COLOR. Tapando el color con la mano la tabla se sigue leyendo, que es
 * lo que necesita el 8 % de los hombres que no distingue rojo de verde. El color
 * va en el icono y no en el texto.
 *
 * Y la otra: UN HUECO NO ES UN CERO. Donde no hay dato se pinta una raya y, al
 * pasar el ratón, por qué no lo hay. Un cero donde en realidad no sabemos el
 * coste convierte un margen imposible en un margen buenísimo.
 */

/* ------------------------------------------------------------------ */
/* El veredicto                                                        */
/* ------------------------------------------------------------------ */

export const ICONO_VEREDICTO: Record<VeredictoA4, LucideIcon> = {
  candidato: CheckCircle2,
  revisar: HelpCircle,
  informa_sin_umbral: Info,
  no_compensa: XCircle,
  sin_rotacion: TrendingDown,
  no_evaluable: CircleDashed,
  descartado_amazon: Ban,
  canal_desconocido: HelpCircle,
  ya_en_fba: PackageCheck,
  sin_datos: CircleDashed,
}

export const TONO_VEREDICTO: Record<
  VeredictoA4,
  'verde' | 'ambar' | 'rojo' | 'gris' | 'azul' | 'violeta'
> = {
  candidato: 'verde',
  revisar: 'ambar',
  informa_sin_umbral: 'azul',
  no_compensa: 'rojo',
  sin_rotacion: 'rojo',
  no_evaluable: 'gris',
  descartado_amazon: 'violeta',
  canal_desconocido: 'gris',
  ya_en_fba: 'gris',
  sin_datos: 'gris',
}

export function EtiquetaVeredicto({
  veredicto,
  etiqueta,
  fuerte,
}: {
  veredicto: VeredictoA4
  etiqueta: string
  fuerte?: boolean
}) {
  const Icono = ICONO_VEREDICTO[veredicto]
  return (
    <span className={ESTADO.linea}>
      <Icono className={ESTADO.icono} style={{ color: COLOR_ESTADO[TONO_VEREDICTO[veredicto]] }} />
      <span className={fuerte ? ESTADO.fuerte : ESTADO.palabra}>{etiqueta}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* El canal — cinco estados, no dos                                    */
/* ------------------------------------------------------------------ */

const PISTA_CANAL: Record<CanalA4, string> = {
  FBA: 'Lo guarda y lo envía Amazon. Aquí no hay migración que evaluar.',
  SFP: 'Prime del vendedor: ya llega con insignia Prime enviándolo el cliente. Migrar no gana visibilidad, cambia quién hace el trabajo.',
  FBM: 'Lo envía el cliente y sin Prime.',
  propio_prime_desconocido:
    'Sale del almacén del cliente y NO sabemos si lleva insignia Prime: el informe de listings dice lo mismo para un envío normal que para Prime del vendedor. Se sabrá en cuanto el monitor de Buy Box lea sus ofertas.',
  desconocido: 'No consta por dónde sale el paquete. No es lo mismo que «lo envía el cliente».',
}

const CORTO_CANAL: Record<CanalA4, string> = {
  FBA: 'FBA',
  SFP: 'SFP',
  FBM: 'FBM',
  propio_prime_desconocido: 'Propio',
  desconocido: '—',
}

export function Canal({ canal }: { canal: CanalA4 }) {
  const dudoso = canal === 'propio_prime_desconocido' || canal === 'desconocido'
  return (
    <span className={ESTADO.linea} title={PISTA_CANAL[canal]}>
      <Truck
        className={ESTADO.icono}
        style={{ color: COLOR_ESTADO[canal === 'FBA' ? 'azul' : dudoso ? 'gris' : 'cian'] }}
      />
      <span className={dudoso ? TEXTO.t3 : ESTADO.palabra}>{CORTO_CANAL[canal]}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* El margen                                                           */
/* ------------------------------------------------------------------ */

/**
 * Un margen, o el hueco con su porqué.
 *
 * El hueco NO se rellena con cero ni siquiera visualmente: se pinta una raya y
 * el motivo entero va en el `title`. Un 0 % en esta columna se lee como «no gana
 * nada» cuando lo que pasa es que no sabemos lo que le costó el producto, y esas
 * dos cosas llevan a decisiones opuestas.
 */
export function CeldaMargen({
  margen,
  moneda,
}: {
  margen: ResultadoMargen
  moneda: string | null
}) {
  if (margen.estado !== 'calculado' || margen.importe === null) {
    return (
      <span className={`${TEXTO.t4} cursor-help`} title={margen.motivo}>
        sin dato
      </span>
    )
  }
  return (
    <span className="whitespace-nowrap" title={margen.motivo}>
      <span className={`${TIPO.num} ${TEXTO.t2}`}>{dinero(margen.importe, moneda)}</span>{' '}
      <span className={`${TIPO.num} ${TEXTO.t4}`}>{porcentaje(margen.porcentaje)}</span>
    </span>
  )
}

/** La diferencia entre los dos mundos, en PUNTOS y con su signo */
export function Diferencia({ puntos }: { puntos: number | null }) {
  if (puntos === null || !Number.isFinite(puntos)) {
    return <span className={TEXTO.t4}>—</span>
  }
  const tono = puntos > 0 ? 'verde' : puntos < 0 ? 'rojo' : 'gris'
  return (
    <span
      className={`${TIPO.num} font-medium`}
      style={{ color: COLOR_ESTADO[tono] }}
      title="Puntos porcentuales que gana (o pierde) el margen si lo guarda Amazon. En puntos y no en «mejora un X %»: pasar del 4 % al 9 % son cinco puntos y se entiende; «mejora un 125 %» es lo mismo dicho de forma que parezca enorme."
    >
      {puntos > 0 ? '+' : ''}
      {puntos.toLocaleString('es-ES', { maximumFractionDigits: 1 })}
    </span>
  )
}

export function porcentaje(valor: number | null): string {
  if (valor === null || !Number.isFinite(valor)) return '—'
  return `${valor.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`
}

/* ------------------------------------------------------------------ */
/* El techo de Amazon, con su sentido                                  */
/* ------------------------------------------------------------------ */

/**
 * EL PRECIO DE REFERENCIA Y LO QUE SIGNIFICA EN ESTA FILA.
 *
 * Es un TECHO y significa DOS COSAS OPUESTAS según quién tenga hoy la oferta
 * destacada. Por eso aquí no se pinta el número solo: al lado va siempre una
 * flecha que dice en qué sentido se lee, y el `title` lo explica entero.
 */
export function Techo({ fila }: { fila: AnalisisSku }) {
  if (fila.foep === null) {
    return (
      <span
        className={`${TEXTO.t4} cursor-help`}
        title={
          fila.foepEstado === 'no_consultado'
            ? 'No se le ha preguntado en esta ronda: el precio de referencia va por rotación porque es la llamada más cara de la API (una cada treinta segundos).'
            : 'Amazon no ha dado precio de referencia para esta referencia. Es la AUSENCIA del dato, no un cero.'
        }
      >
        —
      </span>
    )
  }

  // Tres sentidos, no dos. La flecha AFIRMA quién tiene la oferta destacada, así
  // que cuando no se sabe no puede apuntar ni arriba ni abajo: con `desconocido`
  // metido en el lado «ofensivo» esta celda pintaba flecha ámbar hacia abajo y
  // recomendaba bajar el precio contra una competencia que nadie había mirado.
  const sentido = fila.sentidoFoep
  const glifo = sentido === 'defensivo' ? '↑' : sentido === 'sin_juicio' ? '·' : '↓'
  const tono = sentido === 'defensivo' ? 'verde' : sentido === 'sin_juicio' ? 'gris' : 'ambar'
  const explicacion =
    sentido === 'defensivo'
      ? 'La oferta destacada YA ES NUESTRA, así que este número es el techo hasta el que se podría SUBIR sin perderla: normalmente está por encima del precio de hoy. Por eso el margen se ha calculado al precio de hoy y no aquí — contarlo al techo sería sumar un ingreso que nadie ha decidido cobrar.'
      : sentido === 'sin_juicio'
        ? 'NO SE SABE de quién es la oferta destacada de esta referencia, así que no se puede decir si este techo es el precio AL QUE BAJAR para conquistarla o el techo HASTA EL QUE SUBIR porque ya es nuestra. El margen se ha calculado al menor de los dos precios, que es lo prudente. Antes de mover el precio, mírala en el monitor de Buy Box.'
        : 'La oferta destacada no es nuestra: este número es el techo AL QUE HABRÍA QUE BAJAR para conquistarla, y por eso es el precio con el que se ha calculado el margen.'

  return (
    <span className={`${TIPO.num} cursor-help whitespace-nowrap`} title={explicacion}>
      <span style={{ color: COLOR_ESTADO[tono] }}>{glifo}</span>{' '}
      {fila.foep.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* La rotación — ternaria                                              */
/* ------------------------------------------------------------------ */

export function CeldaRotacion({ rotacion }: { rotacion: Rotacion }) {
  if (rotacion.estado === 'medida') {
    return (
      <span
        className={`${TIPO.num} ${TEXTO.t2}`}
        title={`${rotacion.unidades ?? 0} unidades en ${rotacion.ventanaDias} días, con dato de ${rotacion.diasConDato} días. Las unidades entran por CSV: los roles concedidos no incluyen el informe de ventas de Amazon.`}
      >
        {(rotacion.unidades ?? 0).toLocaleString('es-ES')} u.
      </span>
    )
  }

  if (rotacion.estado === 'senal_bsr') {
    return (
      <span
        className={`${TIPO.num} ${TEXTO.t3} cursor-help`}
        title={`No hay unidades vendidas de esta referencia: lo único que hay es su ranking (${(rotacion.bsr ?? 0).toLocaleString('es-ES')}${rotacion.bsrCategoria ? ` en ${rotacion.bsrCategoria}` : ''}). EL RANKING ORDENA, NO MIDE: dice que se vende más o menos que otros productos de su categoría, no cuántas unidades.`}
      >
        #{(rotacion.bsr ?? 0).toLocaleString('es-ES')}
      </span>
    )
  }

  return (
    <span
      className={`${TEXTO.t4} cursor-help`}
      title="Ni unidades ni ranking. «Sin datos» NO es «no rota»: descartar una referencia por esto sería tirar catálogo bueno porque nadie importó un fichero."
    >
      sin datos
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Las medidas — la regla 4                                            */
/* ------------------------------------------------------------------ */

const PISTA_DIMS: Record<ProcedenciaDims, string> = {
  fee_preview:
    'Amazon ha cobrado con estas medidas (informe Fee Preview). Es la única evidencia posible de que el producto ha pasado por un centro logístico, y solo se da en referencias que YA están en FBA.',
  catalogo:
    'Del catálogo de Amazon. Es el dato del que Amazon parte para estimar, pero quien lo puso en la ficha fue un vendedor. Para un candidato de verdad, es lo mejor a lo que se puede aspirar.',
  manual: 'Las ha medido alguien de la agencia y consta.',
  estimado: 'Alguien las puso a ojo, o nadie apuntó de dónde salieron.',
  ausente: 'No hay medidas. Que no es lo mismo que cero.',
}

const CORTO_DIMS: Record<ProcedenciaDims, string> = {
  fee_preview: 'Amazon',
  catalogo: 'Catálogo',
  manual: 'Nuestras',
  estimado: 'A ojo',
  ausente: 'Sin medidas',
}

const TONO_DIMS: Record<ConfianzaDims, 'verde' | 'cian' | 'ambar' | 'rojo'> = {
  alta: 'verde',
  media: 'cian',
  baja: 'ambar',
  ninguna: 'rojo',
}

export function Medidas({
  procedencia,
  confianza,
}: {
  procedencia: ProcedenciaDims
  confianza: ConfianzaDims
}) {
  return (
    <span className={`${ESTADO.linea} cursor-help`} title={PISTA_DIMS[procedencia]}>
      <Ruler className={ESTADO.icono} style={{ color: COLOR_ESTADO[TONO_DIMS[confianza]] }} />
      <span className={confianza === 'ninguna' ? TEXTO.t4 : ESTADO.palabra}>
        {CORTO_DIMS[procedencia]}
      </span>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Amazon en el ASIN — TERNARIO                                        */
/* ------------------------------------------------------------------ */

export function AmazonEnAsin({ estado }: { estado: AnalisisSku['amazon'] }) {
  if (estado === 'si') {
    return (
      <span className={ESTADO.linea} title="Uno de los vendedores de este ASIN está en la lista de identificadores de Amazon Retail que se rellenó a mano.">
        <Ban className={ESTADO.icono} style={{ color: COLOR_ESTADO.violeta }} />
        <span className={ESTADO.palabra}>Sí</span>
      </span>
    )
  }
  if (estado === 'no') {
    return <span className={TEXTO.t3}>No</span>
  }
  return (
    <span
      className={`${TEXTO.t4} cursor-help`}
      title="NO SE PUEDE SABER. No hay ningún campo de la API que identifique la oferta de Amazon —la marca de FBA no vale, un tercero con FBA devuelve lo mismo— y la lista de sus identificadores de vendedor no está publicada. Se rellena a mano en el monitor de Buy Box."
    >
      no se sabe
    </span>
  )
}
