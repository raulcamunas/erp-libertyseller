/**
 * EL FLUJO DE UN ENVÍO A FBA: QUIÉN PUEDE HACER QUÉ Y CUÁNDO.
 * ==========================================================
 *
 * Función pura, sin base de datos ni red. Todo lo que decide está aquí y se
 * prueba sin montar nada — que es lo que hace falta cuando un paso en falso
 * imprime etiquetas equivocadas o crea un envío real en la cuenta de un cliente.
 *
 *
 * ============ DOS ACTORES QUE SE VAN PASANDO EL TURNO ============
 *
 *   borrador    LA AGENCIA monta qué se va a mandar. El cliente lo ve pero no
 *               lo toca: todavía es una propuesta.
 *   aprobada    EL CLIENTE ha dado el OK. Aquí y no antes se imprimen las
 *               etiquetas de producto: imprimir algo sin aprobar es tirar papel
 *               y, peor, pegar etiquetas de algo que luego no se manda.
 *   encajando   EL CLIENTE mete la mercancía en cajas y sube medidas y pesos.
 *               Es quien tiene la báscula.
 *   lista       El cliente ha terminado. Vuelve el turno a la agencia.
 *   en_amazon   LA AGENCIA ha creado el plan. Hay etiquetas de caja que
 *               devolverle al cliente.
 *   enviada     La mercancía ha salido, con sus seguimientos.
 *   cerrada     Amazon lo ha cerrado. Ya no cambia nada.
 *
 *
 * ============ SE PUEDE VOLVER ATRÁS, Y ES IMPORTANTE ============
 *
 * De `aprobada` se vuelve a `borrador` y de `lista` a `encajando`. Porque pasa:
 * el cliente aprueba y a los diez minutos dice «espera, quita las del 44». Sin
 * marcha atrás la única salida sería borrar la remesa y rehacerla, perdiendo lo
 * ya encajado.
 *
 * Lo que NO tiene vuelta es `en_amazon`: a partir de ahí el envío existe en
 * Amazon, con su identificador y sus etiquetas, y deshacerlo es cancelarlo allí.
 */

export type EstadoRemesa =
  | 'borrador'
  | 'aprobada'
  | 'encajando'
  | 'lista'
  | 'en_amazon'
  | 'enviada'
  | 'cerrada'

/** Quién intenta mover el envío */
export type Actor = 'agencia' | 'cliente'

export interface Transicion {
  desde: EstadoRemesa
  hasta: EstadoRemesa
  /** Quién puede hacerla. Los dos significa cualquiera de ellos */
  quien: Actor[]
  /** El texto del botón, en el imperativo de quien lo pulsa */
  boton: string
  /** Qué pasa después. Se enseña antes de pulsar, no después */
  consecuencia: string
  /** ¿Hace falta que las cajas cuadren? */
  exigeCuadre?: boolean
  /** ¿Hace falta que cada caja tenga medidas y peso? */
  exigeMedidas?: boolean
  /** ¿Es irreversible? Se pide confirmación */
  irreversible?: boolean
}

export const TRANSICIONES: Transicion[] = [
  {
    desde: 'borrador',
    hasta: 'aprobada',
    // El cliente aprueba lo suyo; la agencia también puede, para los casos en
    // que el OK llega por teléfono y lo registra quien lo recibe.
    quien: ['cliente', 'agencia'],
    boton: 'Aprobar el envío',
    consecuencia: 'Se podrán imprimir las etiquetas de producto para empezar a etiquetar.',
  },
  {
    desde: 'aprobada',
    hasta: 'borrador',
    quien: ['agencia'],
    boton: 'Volver a borrador',
    consecuencia: 'Se podrá volver a cambiar qué se manda. Las etiquetas impresas dejarán de valer.',
  },
  {
    desde: 'aprobada',
    hasta: 'encajando',
    quien: ['cliente', 'agencia'],
    boton: 'Empezar a encajar',
    consecuencia: 'Se abren las cajas para meter medidas, pesos y qué va en cada una.',
  },
  {
    desde: 'encajando',
    hasta: 'lista',
    quien: ['cliente', 'agencia'],
    boton: 'He terminado de encajar',
    consecuencia: 'La agencia preparará el envío en Amazon con estas cajas.',
    exigeCuadre: true,
    exigeMedidas: true,
  },
  {
    desde: 'lista',
    hasta: 'encajando',
    quien: ['cliente', 'agencia'],
    boton: 'Volver a las cajas',
    consecuencia: 'Se podrán corregir las cajas antes de que la agencia lo mande.',
  },
  {
    desde: 'lista',
    hasta: 'en_amazon',
    quien: ['agencia'],
    boton: 'Crear el envío en Amazon',
    consecuencia:
      'Se crea el envío en la cuenta de Amazon del cliente y nacen sus identificadores. Esto NO se deshace desde aquí.',
    exigeCuadre: true,
    exigeMedidas: true,
    irreversible: true,
  },
  {
    desde: 'en_amazon',
    hasta: 'enviada',
    quien: ['agencia'],
    boton: 'Marcar como enviada',
    consecuencia: 'La mercancía ha salido. Se mandan los seguimientos a Amazon.',
  },
  {
    desde: 'enviada',
    hasta: 'cerrada',
    quien: ['agencia'],
    boton: 'Cerrar',
    consecuencia: 'Amazon ha terminado de recibir. La remesa deja de moverse.',
  },
]

/** Cómo se llama cada estado en pantalla, y de qué color va */
export const ESTADOS: Record<
  EstadoRemesa,
  { texto: string; tono: 'borrador' | 'espera' | 'trabajo' | 'camino' | 'hecho'; pista: string }
> = {
  borrador: {
    texto: 'Borrador',
    tono: 'borrador',
    pista: 'Montando qué se va a mandar. El cliente todavía no lo ha aprobado.',
  },
  aprobada: {
    texto: 'Aprobada',
    tono: 'espera',
    pista: 'El cliente ha dado el OK. Toca imprimir etiquetas y empezar a etiquetar.',
  },
  encajando: {
    texto: 'Encajando',
    tono: 'trabajo',
    pista: 'El cliente está metiendo la mercancía en cajas y subiendo medidas y pesos.',
  },
  lista: {
    texto: 'Lista para enviar',
    tono: 'espera',
    pista: 'Las cajas están. Le toca a la agencia crear el envío en Amazon.',
  },
  en_amazon: {
    texto: 'Creada en Amazon',
    tono: 'camino',
    pista: 'El envío existe en Amazon. Hay etiquetas de caja que imprimir.',
  },
  enviada: { texto: 'Enviada', tono: 'camino', pista: 'La mercancía ha salido hacia Amazon.' },
  cerrada: { texto: 'Cerrada', tono: 'hecho', pista: 'Amazon ha terminado de recibir.' },
}

export interface Cuadre {
  /** Suma de lo declarado menos lo encajado, por SKU. 0 = cuadra */
  descuadres: Array<{ sku: string; declaradas: number; encajadas: number; diferencia: number }>
  cuadra: boolean
}

export interface EstadoDeCajas {
  cajas: number
  /** Cuántas no tienen las cuatro medidas o el peso */
  sinMedidas: number
  /** Cuántas están vacías: una caja sin contenido no es una caja */
  vacias: number
}

export interface Motivo {
  /** Qué falta, en una frase que se pueda enseñar tal cual */
  texto: string
}

export interface Permiso {
  puede: boolean
  /** Por qué no. Vacío si puede */
  motivos: Motivo[]
}

/**
 * ¿Puede este actor hacer este paso, y si no, por qué exactamente?
 *
 * Devuelve TODOS los motivos, no el primero: si a una remesa le faltan los pesos
 * de dos cajas Y no cuadra, decir solo lo primero obliga a arreglar, reintentar,
 * y descubrir lo segundo. Se dice todo de una vez.
 */
export function puedeAvanzar(
  desde: EstadoRemesa,
  hasta: EstadoRemesa,
  actor: Actor,
  contexto: { cuadre?: Cuadre; cajas?: EstadoDeCajas; lineas?: number }
): Permiso {
  const t = TRANSICIONES.find((x) => x.desde === desde && x.hasta === hasta)
  if (!t) {
    return { puede: false, motivos: [{ texto: `No se puede pasar de «${desde}» a «${hasta}»` }] }
  }
  if (!t.quien.includes(actor)) {
    return {
      puede: false,
      motivos: [
        {
          texto:
            actor === 'cliente'
              ? 'Este paso lo tiene que dar Liberty Seller'
              : 'Este paso lo tiene que dar el cliente',
        },
      ],
    }
  }

  const motivos: Motivo[] = []

  // Una remesa sin referencias no se aprueba ni se manda
  if (desde === 'borrador' && (contexto.lineas ?? 0) === 0) {
    motivos.push({ texto: 'La remesa no tiene ninguna referencia' })
  }

  if (t.exigeMedidas) {
    const c = contexto.cajas
    if (!c || c.cajas === 0) {
      motivos.push({ texto: 'No hay ninguna caja' })
    } else {
      if (c.vacias > 0) {
        motivos.push({
          texto: `${c.vacias} caja${c.vacias === 1 ? ' está vacía' : 's están vacías'}: hay que decir qué va dentro o quitarla${c.vacias === 1 ? '' : 's'}`,
        })
      }
      if (c.sinMedidas > 0) {
        motivos.push({
          texto: `A ${c.sinMedidas} caja${c.sinMedidas === 1 ? ' le faltan' : 's les faltan'} las medidas o el peso`,
        })
      }
    }
  }

  if (t.exigeCuadre && contexto.cuadre && !contexto.cuadre.cuadra) {
    for (const d of contexto.cuadre.descuadres.filter((x) => x.diferencia !== 0)) {
      motivos.push({
        texto:
          d.diferencia > 0
            ? `${d.sku}: faltan ${d.diferencia} unidades por encajar de las ${d.declaradas} declaradas`
            : `${d.sku}: hay ${-d.diferencia} unidades de más en las cajas (declaradas ${d.declaradas})`,
      })
    }
  }

  return { puede: motivos.length === 0, motivos }
}

/** Los pasos que este actor puede dar ahora mismo desde este estado */
export function siguientesPasos(estado: EstadoRemesa, actor: Actor): Transicion[] {
  return TRANSICIONES.filter((t) => t.desde === estado && t.quien.includes(actor))
}

/**
 * ¿Se pueden imprimir ya las etiquetas de producto?
 *
 * Desde que el cliente aprueba y hasta el final. NO en borrador: lo que se está
 * mirando todavía puede cambiar, y una etiqueta pegada en la caja equivocada
 * cuesta más de quitar que de imprimir.
 */
export function puedeImprimirEtiquetas(estado: EstadoRemesa): boolean {
  return estado !== 'borrador'
}

/** ¿Se pueden tocar las cajas? Solo mientras se encaja */
export function puedeEditarCajas(estado: EstadoRemesa): boolean {
  return estado === 'encajando'
}

/** ¿Se puede cambiar QUÉ se manda? Solo mientras es una propuesta */
export function puedeEditarLineas(estado: EstadoRemesa): boolean {
  return estado === 'borrador'
}

/** El orden para pintar la barra de progreso. `cerrada` no entra: es el final */
export const PASOS_VISIBLES: EstadoRemesa[] = [
  'borrador',
  'aprobada',
  'encajando',
  'lista',
  'en_amazon',
  'enviada',
]

export function indiceDePaso(estado: EstadoRemesa): number {
  const i = PASOS_VISIBLES.indexOf(estado)
  return i >= 0 ? i : PASOS_VISIBLES.length
}
