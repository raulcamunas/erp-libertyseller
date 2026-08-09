'use client'

import {
  ArrowDown,
  ArrowUp,
  Ban,
  CircleAlert,
  CircleDashed,
  CircleHelp,
  CircleSlash,
  CircleX,
  Equal,
  EyeOff,
  PackageX,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import { COLOR_ESTADO, ESTADO, TEXTO, TIPO } from '@/lib/estilo/denso'
import type { FilaBuyBox } from '@/lib/plataforma/buybox/cliente'
import {
  CANAL_CORTO,
  CANAL_LABELS,
  VEREDICTOS_SIN_JUICIO,
  VEREDICTO_LABELS,
  VEREDICTO_TONO,
  tieneBuyBox,
  type CanalOferta,
  type DatosDelVeredicto,
  type EstadoAmazonRetail,
  type Veredicto,
} from '@/lib/plataforma/buybox/tipos'
import { dinero } from '@/components/plataforma/comun'

/**
 * LAS PIEZAS DE LA PANTALLA DE BUY BOX.
 *
 * =====================================================================
 *  ██  LO ÚNICO QUE HAY QUE ENTENDER ANTES DE TOCAR ESTE FICHERO  ██
 * =====================================================================
 *
 * EL TECHO QUE DA AMAZON (FOEP) SIGNIFICA DOS COSAS OPUESTAS SEGÚN QUIÉN TENGA
 * HOY LA OFERTA DESTACADA, Y NO HAY NINGÚN CAMPO QUE LAS DISTINGA:
 *
 *   · NO la tenemos → OFENSIVO: es el techo AL QUE HABRÍA QUE BAJAR para
 *     conquistarla. Eso sí es «qué nos haría falta».
 *   · SÍ la tenemos → DEFENSIVO: es el techo hasta el que se puede SUBIR sin
 *     perderla, y normalmente está POR ENCIMA del precio actual. Eso NO es un
 *     problema: es margen que estamos dejando sobre la mesa.
 *
 * La regla ingenua «precio > techo, luego bajar» RECORTA PRECIO EN LAS
 * REFERENCIAS QUE YA VAN BIEN, y es el fallo más caro que puede tener esto.
 *
 * Por eso en esta pantalla NO EXISTE NINGUNA CELDA QUE PINTE EL TECHO SIN SU
 * SENTIDO AL LADO —flecha, palabra y color—, y por eso las perdidas y las
 * ganadas son DOS TABLAS DISTINTAS con DOS JUEGOS DE CABECERAS DISTINTOS, no un
 * filtro sobre la misma. Mezclarlas en una tabla con una columna «FOEP» es
 * exactamente lo que hay que no hacer: la columna se lee de una sola manera y la
 * mitad de las filas significan la contraria.
 */

/* ------------------------------------------------------------------ */
/* 1. Los tres grupos: la separación que lo decide todo                */
/* ------------------------------------------------------------------ */

/**
 *   perdida    -> no la tenemos. El techo es OFENSIVO.
 *   nuestra    -> la tenemos. El techo es DEFENSIVO.
 *   sin_juicio -> no se ha podido leer. NO cuenta como perdida.
 *
 * El corte lo manda EL VEREDICTO y no el estado crudo de la Buy Box, porque el
 * veredicto es lo que decidió por qué rama del motor pasó la referencia, y por
 * tanto qué significa el techo que lleva guardado esa fila. Si algún día los dos
 * discreparan, el veredicto es el que va con el número.
 */
export type Grupo = 'perdida' | 'nuestra' | 'sin_juicio'

export function grupoDe(veredicto: Veredicto): Grupo {
  if (tieneBuyBox(veredicto)) return 'nuestra'
  if (VEREDICTOS_SIN_JUICIO.includes(veredicto)) return 'sin_juicio'
  return 'perdida'
}

/** Los veredictos de cada grupo, para pedirle al servidor solo los de la vista */
export function veredictosDe(grupo: Grupo, todos: Veredicto[]): Veredicto[] {
  return todos.filter((v) => grupoDe(v) === grupo)
}

export const GRUPO_TITULO: Record<Grupo, string> = {
  perdida: 'No la tenemos',
  nuestra: 'La tenemos',
  sin_juicio: 'Sin poder juzgar',
}

/**
 * La frase que encabeza cada lista. UNA línea, y está aquí y no en un párrafo en
 * medio de la pantalla: es lo único que no se puede quitar sin que la tabla de
 * al lado se lea al revés.
 */
export const GRUPO_PISTA: Record<Grupo, string> = {
  perdida: 'El techo de Amazon es el precio AL QUE HABRÍA QUE BAJAR para conquistarla',
  nuestra: 'El techo de Amazon es hasta dónde se puede SUBIR sin perderla',
  sin_juicio: 'No se ha podido leer. No es que la hayamos perdido: es que no se sabe',
}

/* ------------------------------------------------------------------ */
/* 2. El veredicto: glifo, palabra y DESPUÉS color                     */
/* ------------------------------------------------------------------ */

/**
 * Un icono distinto por veredicto, no el mismo círculo de nueve colores.
 *
 * Tapando el color con la mano la tabla se sigue leyendo, que es lo que necesita
 * el 8 % de los hombres que no distingue rojo de verde. Y las dos flechas —abajo
 * para bajar, arriba para subir— son la señal que impide leer una fila de la
 * lista defensiva como si fuera de la ofensiva.
 */
export const ICONO_VEREDICTO: Record<Veredicto, LucideIcon> = {
  sin_datos: CircleDashed,
  sin_oferta_propia: EyeOff,
  con_buybox_margen_arriba: ArrowUp,
  con_buybox_al_limite: Equal,
  con_buybox_incoherente: CircleAlert,
  con_buybox_sin_foep: CircleHelp,
  no_competible: Ban,
  sin_stock: PackageX,
  nadie_la_tiene: CircleSlash,
  sin_foep: CircleHelp,
  deberiamos_tenerla: CircleAlert,
  recuperable_bajando: ArrowDown,
  bajable_sin_criterio: ArrowDown,
  problema_logistico: TrendingUp,
  no_recuperable: CircleX,
}

export function EtiquetaVeredicto({
  veredicto,
  fuerte,
}: {
  veredicto: Veredicto
  fuerte?: boolean
}) {
  const Icono = ICONO_VEREDICTO[veredicto]
  const color = COLOR_ESTADO[VEREDICTO_TONO[veredicto]]
  return (
    <span className={ESTADO.linea}>
      <Icono className={ESTADO.icono} style={{ color }} aria-hidden />
      <span className={fuerte ? ESTADO.fuerte : ESTADO.palabra}>{VEREDICTO_LABELS[veredicto]}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* 3. Amazon en el ASIN — TERNARIO, nunca dos valores                  */
/* ------------------------------------------------------------------ */

/**
 * `IsFulfilledByAmazon: true` significa FBA, NO Amazon: un tercero que envía por
 * FBA devuelve exactamente lo mismo. Y la lista de identificadores de vendedor
 * de Amazon Retail no está publicada.
 *
 * Así que solo hay un «sí» honesto —uno de los vendedores está en la lista que
 * se haya rellenado a mano— y un «no» honesto —no hay ninguna oferta ajena—.
 * TODO LO DEMÁS ES «no se puede saber», que es el caso normal, y se pinta como
 * tal en vez de colapsarse a «no».
 */
export function AmazonEnAsin({ estado }: { estado: EstadoAmazonRetail }) {
  if (estado === 'si') {
    return (
      <span className={ESTADO.linea} title="Uno de los vendedores está en la lista de identificadores de Amazon Retail configurada a mano.">
        <Ban className={ESTADO.icono} style={{ color: COLOR_ESTADO.rojo }} aria-hidden />
        Sí
      </span>
    )
  }
  if (estado === 'no') {
    return (
      <span className={ESTADO.linea} title="No hay ninguna oferta ajena en el ASIN. Si no vende nadie más, tampoco vende Amazon.">
        <span className={TEXTO.t3}>No</span>
      </span>
    )
  }
  return (
    <span
      className={ESTADO.linea}
      title="Amazon no publica ningún campo que identifique su propia oferta, y la marca de FBA no sirve. Solo se puede afirmar que Amazon está aquí si uno de los vendedores está en la lista rellenada a mano."
    >
      <CircleHelp className={ESTADO.icono} style={{ color: COLOR_ESTADO.gris }} aria-hidden />
      <span className={TEXTO.t4}>No se sabe</span>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* 4. Canal: FBA / SFP / FBM / desconocido — cuatro, no dos            */
/* ------------------------------------------------------------------ */

export function Canal({ canal }: { canal: CanalOferta | null | undefined }) {
  if (!canal) return <span className={TEXTO.t4}>—</span>
  return (
    <span className={TEXTO.t2} title={CANAL_LABELS[canal]}>
      {CANAL_CORTO[canal]}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* 5. Los números con los que se decidió                               */
/* ------------------------------------------------------------------ */

/**
 * La foto de datos del veredicto llega como JSONB suelto. Se lee con `Partial`
 * y no con un cast a secas: una fila diagnosticada por una versión anterior del
 * motor puede no traer un campo, y un `undefined` que se pinte como número es
 * exactamente el cero falso que este módulo existe para no cometer.
 */
export function datosDe(fila: FilaBuyBox): Partial<DatosDelVeredicto> {
  return (fila.datos ?? {}) as Partial<DatosDelVeredicto>
}

/* ------------------------------------------------------------------ */
/* 6. El techo, SIEMPRE con su sentido                                 */
/* ------------------------------------------------------------------ */

/**
 * El techo de una fila PERDIDA: el precio al que habría que bajar.
 *
 * Cuando no hay número no se pinta un guion a secas: se dice si es que Amazon no
 * lo da o si es que no se le ha preguntado en esta ronda. Con la rotación
 * semanal, la mayoría de las referencias de una noche están en el segundo caso,
 * y confundirlo con el primero hace pensar que Amazon no contesta.
 */
export function TechoOfensivo({ fila }: { fila: FilaBuyBox }) {
  if (fila.foep === null) return <SinTecho fila={fila} />
  return (
    <span className="inline-flex items-baseline gap-[5px] whitespace-nowrap">
      <ArrowDown
        className="h-[11px] w-[11px] shrink-0 translate-y-[1px]"
        style={{ color: COLOR_ESTADO.azul }}
        aria-hidden
      />
      <span className={`${TIPO.m} ${TIPO.num} ${TEXTO.t1} font-medium`}>
        {dinero(fila.foep, fila.moneda)}
      </span>
      <EdadTecho fila={fila} />
    </span>
  )
}

/**
 * El techo de una fila que YA TIENE la oferta destacada: hasta dónde se puede
 * SUBIR. La flecha va hacia arriba y el color es el de una oportunidad, no el de
 * una incidencia.
 */
export function TechoDefensivo({ fila }: { fila: FilaBuyBox }) {
  if (fila.foep === null) return <SinTecho fila={fila} />
  return (
    <span className="inline-flex items-baseline gap-[5px] whitespace-nowrap">
      <ArrowUp
        className="h-[11px] w-[11px] shrink-0 translate-y-[1px]"
        style={{ color: COLOR_ESTADO.verde }}
        aria-hidden
      />
      <span className={`${TIPO.m} ${TIPO.num} ${TEXTO.t1} font-medium`}>
        {dinero(fila.foep, fila.moneda)}
      </span>
      <EdadTecho fila={fila} />
    </span>
  )
}

function SinTecho({ fila }: { fila: FilaBuyBox }) {
  if (fila.foep_estado === 'no_consultado') {
    return (
      <span
        className={`${TIPO.s} ${TEXTO.t4}`}
        title="El techo va por rotación: es la llamada más cara que hay, una cada treinta segundos, así que a cada referencia le toca cada pocas noches. No es que Amazon no lo dé: es que no se le ha preguntado en esta ronda."
      >
        sin preguntar
      </span>
    )
  }
  return (
    <span
      className={`${TIPO.s} ${TEXTO.t4}`}
      title="Amazon ha contestado y no ha dado precio. El motivo exacto está en la ficha de la referencia. No es un cero."
    >
      no lo da
    </span>
  )
}

/**
 * Cuántas horas tiene el techo con el que se decidió.
 *
 * Con la rotación semanal puede tener seis días, y un veredicto tomado con un
 * techo de hace seis días vale menos que uno de hace una hora. Solo se pinta
 * cuando pasa de un día: por debajo es ruido.
 */
function EdadTecho({ fila }: { fila: FilaBuyBox }) {
  const horas = datosDe(fila).foepHoras
  if (typeof horas !== 'number' || horas < 24) return null
  return (
    <span
      className={`${TIPO.s} ${TEXTO.t4}`}
      title="Cuántos días tenía el techo cuando se tomó este veredicto. Amazon no dice cuándo lo recalcula ni sella la respuesta con una hora: esta es NUESTRA marca de lectura."
    >
      {Math.round(horas / 24)} d
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* 7. «Qué haría falta» y «cuánto sobra»                               */
/* ------------------------------------------------------------------ */

/**
 * QUÉ HARÍA FALTA PARA GANARLA, en una línea.
 *
 * Es la columna que pidió el usuario con esas palabras. La frase larga con los
 * números —la que se puede enseñar a un cliente— es el `motivo` del motor y está
 * a un clic, en la ficha, y entera en la exportación. Aquí va lo que cabe en una
 * celda de 28 píxeles sin convertir la tabla en un texto.
 *
 * OJO: esta función SOLO vale para el grupo `perdida`. Llamarla con una fila que
 * ya tiene la oferta destacada devolvería «bajar X», que es justo el error de
 * los caros. Por eso empieza comprobándolo.
 */
export function queHariaFalta(fila: FilaBuyBox): { texto: string; tono: 'accion' | 'apagado' } {
  if (grupoDe(fila.veredicto) !== 'perdida') {
    return { texto: '—', tono: 'apagado' }
  }

  switch (fila.veredicto) {
    case 'sin_stock':
      return { texto: 'Reponer: el precio no es el problema', tono: 'accion' }
    case 'no_competible':
      return { texto: 'Nada: Amazon vende en este ASIN', tono: 'apagado' }
    case 'sin_oferta_propia':
      return { texto: 'Reactivar el listing, no bajar precio', tono: 'accion' }
    case 'deberiamos_tenerla':
      return { texto: 'No es precio: métricas, plazo o elegibilidad', tono: 'accion' }
    case 'problema_logistico':
      return { texto: 'Logística: evaluar el paso a FBA', tono: 'accion' }
    case 'no_recuperable':
      return { texto: 'Ni precio ni logística: revisar el coste', tono: 'apagado' }
    case 'sin_foep':
      return {
        texto:
          fila.foep_estado === 'no_consultado'
            ? 'Pedir el techo para poder decidir'
            : 'Amazon no da techo: revisar a mano',
        tono: 'accion',
      }
    default:
      break
  }

  // Los que sí se arreglan con precio: cuánto habría que bajar, en dinero.
  if (fila.foep !== null && fila.precio_propio !== null) {
    const bajada = fila.precio_propio - fila.foep
    if (bajada > 0) {
      const falta = fila.veredicto === 'bajable_sin_criterio' ? ' · falta criterio' : ''
      return { texto: `Bajar ${dinero(bajada, fila.moneda)}${falta}`, tono: 'accion' }
    }
  }
  return { texto: fila.accion || '—', tono: 'apagado' }
}

/**
 * CUÁNTO MARGEN ESTAMOS DEJANDO SOBRE LA MESA, en una línea.
 *
 * Es el gemelo del anterior para las referencias que YA tienen la oferta
 * destacada, y su existencia separada es el punto entero de esta pantalla: aquí
 * el número no es una tarea pendiente, es una oportunidad. El repricer nativo de
 * Amazon nunca la ve porque no sube precios.
 */
export function margenSinUsar(fila: FilaBuyBox): { texto: string; hay: boolean } {
  if (grupoDe(fila.veredicto) !== 'nuestra') return { texto: '—', hay: false }
  if (fila.foep === null || fila.precio_propio === null) return { texto: '—', hay: false }

  const holgura = fila.foep - fila.precio_propio
  if (holgura <= 0) {
    return {
      texto: fila.veredicto === 'con_buybox_incoherente' ? 'dato incoherente' : 'sin recorrido',
      hay: false,
    }
  }
  const pct = fila.precio_propio > 0 ? (holgura / fila.precio_propio) * 100 : null
  return {
    texto: `${dinero(holgura, fila.moneda)}${pct === null ? '' : ` · ${pct.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`}`,
    hay: true,
  }
}

/* ------------------------------------------------------------------ */
/* 8. El aviso de Prime, donde de verdad importa                        */
/* ------------------------------------------------------------------ */

/**
 * EL TECHO NO SE PUEDE PEDIR SEGMENTADO POR PRIME Y NO PRIME (incidencia de
 * Amazon #5072, abierta). En un cliente con Prime propio (SFP) en parte del
 * catálogo, UN SOLO NÚMERO MEZCLA DOS REALIDADES COMPETITIVAS.
 *
 * Esto no es un aviso general de pantalla —ahí sería ruido y acabaría sin
 * leerse—: se cuelga como pista de la celda del techo SOLO en las filas donde
 * hay un SFP de por medio, que son en las que el número puede estar mezclando.
 */
export function avisoPrime(fila: FilaBuyBox): string | undefined {
  const d = datosDe(fila)
  if (d.canalPropio !== 'SFP' && d.canalGanador !== 'SFP') return undefined
  return (
    'Aquí hay Prime del vendedor (SFP) de por medio. El techo que da Amazon NO se puede pedir ' +
    'separado para Prime y no Prime, así que este único número mezcla las dos competiciones: la de ' +
    'las ofertas con insignia Prime y la del resto.'
  )
}
