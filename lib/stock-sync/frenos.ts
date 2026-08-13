/**
 * LOS FRENOS.
 *
 * El envío automático va solo salvo que salte un freno; si salta, NO se manda
 * nada, el lote se queda en espera y se avisa. La razón de ser de todo este
 * fichero cabe en una frase:
 *
 *   UN FICHERO MAL EXPORTADO UN MARTES POR LA NOCHE NO PUEDE VACIAR EL
 *   INVENTARIO DE UN CLIENTE EN AMAZON QUINCE MINUTOS DESPUÉS SIN QUE NADIE LO
 *   VEA.
 *
 * Los umbrales son POR CLIENTE y no constantes del código: uno con 400
 * referencias y otro con 40.000 no toleran lo mismo, y un porcentaje que en uno
 * es una anomalía en el otro es martes.
 *
 * TODO ES PURO: entran lo que se iba a mandar, el estado del catálogo y la
 * fecha; sale si se puede enviar y, si no, cuál saltó y con qué números.
 *
 * Y CADA FRENO SE EXPLICA EN UNA FRASE QUE ENTIENDE UNA PERSONA. No es adorno:
 * esa frase es lo que aparece en la campana del ERP, lo que se guarda en la
 * fila de la ejecución y lo único que va a leer quien decida si desbloquea el
 * envío o llama al cliente. «BRAKE_THRESHOLD_EXCEEDED (0.87 > 0.20)» obliga a
 * abrir el código para saber qué ha pasado.
 */

import { type StockBrakeCode, type StockReadProfile, formatInt } from '@/lib/types/stock-sync'

// =====================================================
// Entradas
// =====================================================

export interface UmbralesFreno {
  /** Porcentaje máximo del catálogo que puede irse a 0 de una vez. null = no se evalúa */
  maxPctACero: number | null
  /** Variación máxima de precio de UNA línea, en tanto por ciento sobre lo publicado */
  maxVariacionPrecioPct: number | null
  /** Caída máxima de líneas del fichero respecto a lo habitual, en tanto por ciento */
  maxCaidaLineasPct: number | null
  /**
   * Caída máxima de UNIDADES publicadas, en tanto por ciento sobre lo que
   * Amazon tiene ahora en los SKU que este lote toca.
   *
   * Es el freno que faltaba y no lo cubría ninguno de los otros: un fichero que
   * trae TODAS sus líneas y TODOS sus SKU pero con las unidades hundidas —el
   * caso que produce un CSV mal interpretado— no mueve el porcentaje a cero, no
   * mueve el número de líneas y no toca ningún precio. La tienda se queda con
   * 200 unidades donde había 280.000 y la ejecución se registra en verde.
   */
  maxCaidaUnidadesPct: number | null
  /** Número máximo de SKU que pueden cambiar de golpe */
  maxCambios: number | null
  /**
   * EL FICHERO DE ESTE CLIENTE NO ES UN VOLCADO COMPLETO, ES UN DELTA.
   *
   * Trae solo las referencias cuyo stock ha cambiado, sacadas de un maestro
   * mucho mayor: hoy 100 líneas, mañana 500, pasado 300. Ese vaivén es su
   * funcionamiento NORMAL.
   *
   *
   * ============ POR QUÉ ESTO APAGA TRES FRENOS ============
   *
   * Porque los tres miden VOLUMEN contra «lo habitual», y con un delta «lo
   * habitual» no existe:
   *
   *   caída de líneas   -> 100 líneas donde ayer hubo 500 es un martes normal.
   *   % que se va a cero-> el denominador son los SKU que el fichero resuelve.
   *                        Con un delta de 3, dos a cero es el 67 %.
   *   caída de unidades -> lo mismo: se mide sobre lo que toca este lote, y un
   *                        lote de tres artículos no dice nada del catálogo.
   *
   * Los tres saltarían casi todos los días sin que pase nada malo. Y un freno
   * que salta cuando todo va bien no protege: enseña a ignorarlo, y el día que
   * salte de verdad nadie lo va a mirar. Eso es peor que no tenerlo.
   *
   *
   * ============ LO QUE SIGUE PROTEGIENDO ============
   *
   * Los otros dos NO dependen del tamaño del fichero y se quedan:
   *
   *   variación de precio -> un precio que se mueve un 90 % está mal venga en
   *                          un fichero de 3 líneas o de 3.000.
   *   máximo de cambios   -> es un número absoluto. Si el delta normal mueve 30
   *                          SKU y un día mueve 600, eso sí es una anomalía.
   *
   * Y el daño de un delta es pequeño por construcción: solo puede estropear las
   * referencias que trae. Un volcado completo mal exportado vacía el catálogo
   * entero; este, como mucho, se equivoca en las tres que menciona.
   */
  ficheroParcial: boolean
  /**
   * Cuántas líneas trae este fichero un día normal. Sin esto el freno de caída
   * no puede saltar, porque no hay contra qué comparar: un perfil recién creado
   * no sabe todavía qué es «lo habitual» para ese cliente.
   */
  lineasReferencia: number | null
}

/** Un cambio que se iba a mandar a Amazon, con el valor que hay publicado ahora */
export interface CambioPropuesto {
  sku: string
  campo: 'cantidad' | 'precio'
  valorNuevo: number
  /** Lo que Amazon tiene ahora mismo, del espejo del catálogo. null = SKU nuevo o sin dato */
  valorAnterior: number | null
}

/** Lo que Amazon tiene ahora mismo, resumido. Sale del espejo de amazon_listings */
export interface EstadoCatalogo {
  /** SKU que el espejo tiene para esta conexión y marketplace */
  totalSku: number
  /**
   * SKU QUE ESTE PERFIL GESTIONA DE VERDAD: los que el cruce ha resuelto y
   * además están en el espejo. ES EL DENOMINADOR DE LOS PORCENTAJES, y no
   * `totalSku`, porque el mapeo de un cliente casi nunca cubre su catálogo
   * entero.
   *
   * Con el catálogo entero de denominador el freno se diluye justo cuando más
   * falta hace: dejar a cero LAS 332 referencias que el perfil gestiona mide un
   * 84% si el espejo tiene 395 listings y un 17% si tiene 2.000 —el mismo daño,
   * el mismo fichero— y a partir de ahí el umbral del 20% deja de proteger sin
   * que nadie lo haya tocado.
   */
  gestionados: number
  /** De esos, cuántos tienen unidades ahora. Sirve para poner el porcentaje en contexto */
  conStock: number
}

/** Unidades: lo que se publicaría frente a lo que hay ahora, en los SKU tocados */
export interface EstadoUnidades {
  /** Suma de unidades que quedarían publicadas en los SKU que este lote toca */
  nuevas: number
  /** Lo que Amazon tiene ahora mismo en ESOS MISMOS SKU */
  ahora: number
}

export interface EntradaFrenos {
  cambios: CambioPropuesto[]
  catalogo: EstadoCatalogo
  unidades: EstadoUnidades
  /** Líneas con código de artículo que ha traído el fichero de hoy */
  lineasLeidas: number
  umbrales: UmbralesFreno
  /** Divisa, solo para redactar las frases. Sin ella los importes van sin símbolo */
  moneda?: string | null
  /**
   * Suelo y techo de precio del perfil. Los usa el freno de variación para
   * poder decir algo sobre los precios que ESTRENAN valor, que no tienen
   * anterior con el que compararse.
   */
  precioMinimo?: number | null
  precioMaximo?: number | null
  /**
   * EXIGIR QUE TODOS LOS FRENOS SE HAYAN PODIDO MEDIR.
   *
   * Se enciende cuando el envío es automático. Un freno sin umbral o sin datos
   * no es «no ha saltado»: es «no se ha mirado», y con el envío desatendido eso
   * no puede valer como permiso. Lo seguro por defecto en esta pieza es frenar.
   *
   * En simulacro va apagado a propósito: ahí no se manda nada, y bloquear la
   * pantalla de alta de un cliente porque todavía no se sabe cuántas líneas
   * trae su fichero un día normal no protegería de nada.
   */
  exigirCompletos?: boolean
  /** Entra por parámetro: una función que mira el reloj no se puede comprobar */
  ahora: Date
}

// =====================================================
// Salida
// =====================================================

/**
 * EN QUÉ SITUACIÓN HA QUEDADO UN FRENO, que no es lo mismo que si ha saltado.
 *
 * La distinción existe porque «no ha saltado» y «no se ha mirado» son cosas
 * muy distintas y hasta ahora las dos salían igual: en verde. Un perfil recién
 * creado, con el espejo del catálogo todavía vacío y sin saber cuántas líneas
 * trae su fichero un día normal, coronaba tres frenos sin evaluar con un tick y
 * la frase «Ningún freno salta», que es justo lo contrario de lo que pasaba. Y
 * es EL momento en el que alguien decide encender el envío automático.
 *
 *   medido      -> se ha podido medir y el número está ahí
 *   no_aplica   -> este lote no trae nada que este freno pueda mirar (no cambia
 *                  ningún precio, por ejemplo). No es un hueco: no hay riesgo
 *                  que vigilar.
 *   sin_umbral  -> el cliente no tiene puesto el límite. ES UN HUECO.
 *   sin_datos   -> hay límite pero falta el dato con el que medirlo. ES UN HUECO.
 */
export type EstadoFreno = 'medido' | 'no_aplica' | 'sin_umbral' | 'sin_datos'

/** Los dos estados que significan «aquí no ha mirado nadie» */
export function esHueco(f: FrenoEvaluado): boolean {
  return f.estado === 'sin_umbral' || f.estado === 'sin_datos'
}

export interface FrenoEvaluado {
  codigo: StockBrakeCode
  salta: boolean
  estado: EstadoFreno
  /** El límite de este cliente. null = no lo tiene puesto y el freno no se evalúa */
  umbral: number | null
  /** Lo medido en este lote. null = no se ha podido medir */
  medido: number | null
  /** La frase completa, con sus números, tal cual se le enseña a una persona */
  frase: string
}

export interface ResultadoFrenos {
  /** false = NO se manda nada. El lote se queda en espera y se avisa */
  puedeEnviar: boolean
  saltaron: FrenoEvaluado[]
  /** Los que no se han podido mirar. Con envío automático, también impiden mandar */
  huecos: FrenoEvaluado[]
  /** Todos los evaluados, saltaran o no: es lo que se guarda en la fila de la ejecución */
  todos: FrenoEvaluado[]
  /** Cuántos se han medido de verdad y cuántos venían al caso. Es lo que titula la pantalla */
  medidos: number
  aplicables: number
  /** La frase del primero que saltó, o la del primer hueco que impide enviar */
  resumen: string | null
  /** Código del primero que saltó, que es el que se guarda en stock_profile_runs.freno */
  primero: StockBrakeCode | null
  evaluadoEn: string
}

// =====================================================
// La evaluación
// =====================================================

/**
 * Evalúa los cuatro frenos y decide si se puede enviar.
 *
 * El ORDEN importa para el aviso, no para la decisión: basta con que salte uno
 * para no mandar nada. Se evalúa primero la caída de líneas porque, cuando
 * saltan varios a la vez, casi siempre es la CAUSA de los otros —un volcado a
 * medias deja media referencia sin línea y todas esas se irían a cero—, y el
 * aviso tiene que decir el problema, no su consecuencia.
 */
export function evaluarFrenos(entrada: EntradaFrenos): ResultadoFrenos {
  const todos: FrenoEvaluado[] = [
    frenoCaidaLineas(entrada),
    frenoPctACero(entrada),
    frenoCaidaUnidades(entrada),
    frenoVariacionPrecio(entrada),
    frenoMaxCambios(entrada),
  ]

  const saltaron = todos.filter((f) => f.salta)
  const huecos = todos.filter(esHueco)
  const aplicables = todos.filter((f) => f.estado !== 'no_aplica').length
  const medidos = todos.filter((f) => f.estado === 'medido').length

  // Con envío automático, un hueco pesa lo mismo que un freno saltado. Es la
  // única forma de que vaciar las casillas de la pantalla no sea la manera más
  // rápida de desactivar toda esta parte.
  const bloqueadoPorHueco = Boolean(entrada.exigirCompletos) && huecos.length > 0
  const puedeEnviar = saltaron.length === 0 && !bloqueadoPorHueco

  const resumen = saltaron[0]
    ? saltaron[0].frase
    : bloqueadoPorHueco
      ? `No se manda nada porque ${huecos.length === 1 ? 'un freno no se ha podido comprobar' : `${huecos.length} frenos no se han podido comprobar`}, ` +
        `y este cliente tiene el envío automático encendido: ${huecos.map((h) => h.frase).join(' ')}`
      : null

  return {
    puedeEnviar,
    saltaron,
    huecos,
    todos,
    medidos,
    aplicables,
    resumen,
    // El código que se guarda es el del primero que SALTÓ; si no saltó ninguno
    // y lo que bloquea es un hueco, se guarda el del primer hueco, porque la
    // tabla exige un código cuando la ejecución queda en 'frenado'.
    primero: saltaron[0]?.codigo ?? (bloqueadoPorHueco ? huecos[0].codigo : null),
    evaluadoEn: entrada.ahora.toISOString(),
  }
}

/**
 * «El fichero trae 12.400 líneas y lo habitual son 21.000 (-41%), y el límite
 * de caída de este cliente es el 15%.»
 *
 * Un fichero que trae 8.000 líneas menos es un volcado a medias, no un almacén
 * vacío. Es el caso que de verdad vacía el inventario de un cliente sin que
 * nadie haya hecho nada mal a la vista: el fichero se lee bien, el cruce casa
 * bien y todo lo que falta se publica a cero porque, sencillamente, no venía.
 */
function frenoCaidaLineas(entrada: EntradaFrenos): FrenoEvaluado {
  const codigo: StockBrakeCode = 'caida_lineas'
  const { maxCaidaLineasPct, lineasReferencia, ficheroParcial } = entrada.umbrales

  if (ficheroParcial) {
    return noAplica(
      codigo,
      'el fichero de este cliente trae solo las referencias que han cambiado, así que el número ' +
        'de líneas varía todos los días y no hay «lo habitual» contra lo que comparar'
    )
  }

  if (maxCaidaLineasPct === null) {
    return sinUmbral(codigo, 'este cliente no tiene puesto un límite de caída de líneas')
  }
  if (lineasReferencia === null || lineasReferencia <= 0) {
    return sinDatos(
      codigo,
      'todavía no se sabe cuántas líneas trae este fichero un día normal, así que no hay con qué comparar'
    )
  }

  const caida = ((lineasReferencia - entrada.lineasLeidas) / lineasReferencia) * 100
  const medido = Math.max(0, caida)
  const salta = medido > maxCaidaLineasPct

  const cuerpo =
    `el fichero trae ${formatInt(entrada.lineasLeidas)} líneas y lo habitual son ` +
    `${formatInt(lineasReferencia)} (${pct(-caida, true)})`

  return {
    codigo,
    salta,
    estado: 'medido',
    umbral: maxCaidaLineasPct,
    medido,
    frase: salta
      ? `${cuerpo}, y el límite de caída de este cliente es el ${pct(maxCaidaLineasPct)}.`
      : `${cuerpo}, por debajo del límite de caída del ${pct(maxCaidaLineasPct)}.`,
  }
}

/**
 * «Se irían a cero 3.412 de 3.900 referencias gestionadas (87%), y el límite de
 * este cliente es el 20%.»
 *
 * Solo cuentan las que se quedarían a cero VINIENDO DE TENER UNIDADES. Las que
 * ya estaban a cero y siguen a cero no son noticia, y meterlas en la cuenta
 * dispararía el freno todos los días en cualquier catálogo con cola larga.
 *
 * El denominador son las referencias QUE ESTE PERFIL GESTIONA, no el catálogo
 * entero de la cuenta: ver el comentario de EstadoCatalogo.gestionados.
 */
function frenoPctACero(entrada: EntradaFrenos): FrenoEvaluado {
  const codigo: StockBrakeCode = 'pct_a_cero'
  const { maxPctACero, ficheroParcial } = entrada.umbrales

  if (ficheroParcial) {
    return noAplica(
      codigo,
      'el fichero solo trae lo que ha cambiado, así que el porcentaje se calcularía sobre las pocas ' +
        'referencias de este lote y no sobre el catálogo: dos de tres serían el 67 %'
    )
  }

  if (maxPctACero === null) {
    return sinUmbral(codigo, 'este cliente no tiene puesto un límite de referencias a cero')
  }
  if (entrada.catalogo.gestionados <= 0) {
    return sinDatos(
      codigo,
      'no hay ninguna referencia gestionada contra la que calcular el porcentaje ' +
        '(el espejo del catálogo de Amazon está vacío, o ningún SKU del fichero está en él)'
    )
  }

  // El valor anterior desconocido CUENTA como que se va a cero. Un listing cuyo
  // quantity no vino en el refresco sigue siendo un listing editable, y ponerlo
  // a cero es exactamente el daño que este freno vigila. Ante la duda, contar:
  // lo contrario deja el registro afirmando «se irían a cero 0 de 200» mientras
  // se mandan 200 ceros.
  const aCero = entrada.cambios.filter(
    (c) =>
      c.campo === 'cantidad' &&
      c.valorNuevo === 0 &&
      (c.valorAnterior === null || c.valorAnterior > 0)
  ).length

  const medido = (aCero / entrada.catalogo.gestionados) * 100
  const salta = medido > maxPctACero

  const cuerpo =
    `se irían a cero ${formatInt(aCero)} de ${formatInt(entrada.catalogo.gestionados)} ` +
    `referencias gestionadas (${pct(medido)})` +
    (entrada.catalogo.totalSku > entrada.catalogo.gestionados
      ? `, de un catálogo de ${formatInt(entrada.catalogo.totalSku)} SKU`
      : '')

  return {
    codigo,
    salta,
    estado: 'medido',
    umbral: maxPctACero,
    medido,
    frase: salta
      ? `${cuerpo}, y el límite de este cliente es el ${pct(maxPctACero)}.`
      : `${cuerpo}, por debajo del límite del ${pct(maxPctACero)}.`,
  }
}

/**
 * «Se publicarían 200 unidades donde Amazon tiene 280.412 (-99,9%), y el límite
 * de caída de unidades de este cliente es el 40%.»
 *
 * EL FRENO QUE COGE EL DERRUMBE QUE NO LLEGA A CERO, que a los otros cuatro se
 * les escapa entero: un fichero con todas sus líneas, todos sus SKU y las
 * unidades divididas por mil no mueve el porcentaje a cero (nada llega a cero),
 * no mueve la caída de líneas (vienen todas) y no toca ningún precio. Es lo que
 * produce un CSV leído con el criterio decimal equivocado, y hasta ahora salía
 * en verde.
 *
 * Se compara SOLO contra los SKU que el lote toca: meter en la suma el catálogo
 * entero haría que un lote pequeño pareciera siempre un desplome.
 */
function frenoCaidaUnidades(entrada: EntradaFrenos): FrenoEvaluado {
  const codigo: StockBrakeCode = 'caida_unidades'
  const { maxCaidaUnidadesPct, ficheroParcial } = entrada.umbrales

  if (ficheroParcial) {
    return noAplica(
      codigo,
      'el fichero solo trae lo que ha cambiado, así que la caída se mediría sobre los pocos SKU de ' +
        'este lote y no dice nada del catálogo'
    )
  }

  if (maxCaidaUnidadesPct === null) {
    return sinUmbral(codigo, 'este cliente no tiene puesto un límite de caída de unidades')
  }

  const tocaCantidad = entrada.cambios.some((c) => c.campo === 'cantidad')
  if (!tocaCantidad) {
    return noAplica(codigo, 'este lote no cambia las unidades de ningún SKU')
  }
  if (entrada.unidades.ahora <= 0) {
    // Sin unidades publicadas no hay caída posible: se sube desde cero. No es un
    // hueco, es que no hay nada que perder.
    return noAplica(
      codigo,
      'Amazon no tiene unidades publicadas en los SKU de este lote, así que no hay caída posible'
    )
  }

  const caida = ((entrada.unidades.ahora - entrada.unidades.nuevas) / entrada.unidades.ahora) * 100
  const medido = Math.max(0, caida)
  const salta = medido > maxCaidaUnidadesPct

  const cuerpo =
    `se publicarían ${formatInt(entrada.unidades.nuevas)} unidades donde Amazon tiene ahora ` +
    `${formatInt(entrada.unidades.ahora)} (${pct(-caida, true)})`

  return {
    codigo,
    salta,
    estado: 'medido',
    umbral: maxCaidaUnidadesPct,
    medido,
    frase: salta
      ? `${cuerpo}, y el límite de caída de unidades de este cliente es el ${pct(maxCaidaUnidadesPct)}.`
      : `${cuerpo}, por debajo del límite de caída de unidades del ${pct(maxCaidaUnidadesPct)}.`,
  }
}

/**
 * «El SKU 05-NDKE-740Z pasaría de 24,90 a 2,49 (-90%), y el límite de
 * variación de este cliente es el 30%.»
 *
 * Se mira la línea PEOR, no la media: una media tranquila con un solo precio
 * dividido por diez es exactamente el caso que hay que parar, y promediando no
 * se ve. El SKU sale en la frase porque, con él, comprobarlo en el fichero del
 * cliente son diez segundos.
 */
function frenoVariacionPrecio(entrada: EntradaFrenos): FrenoEvaluado {
  const codigo: StockBrakeCode = 'variacion_precio'
  const { maxVariacionPrecioPct } = entrada.umbrales

  if (maxVariacionPrecioPct === null) {
    return sinUmbral(codigo, 'este cliente no tiene puesto un límite de variación de precio')
  }

  let peorSku: string | null = null
  let peorVariacion = 0
  let peorAntes = 0
  let peorDespues = 0
  let comparables = 0
  /** Los que ESTRENAN precio: no hay anterior contra el que medir la variación */
  let sinReferencia = 0
  let fueraDeRango: { sku: string; precio: number } | null = null

  for (const c of entrada.cambios) {
    if (c.campo !== 'precio') continue

    if (c.valorAnterior === null || c.valorAnterior <= 0) {
      // ANTES ESTO ERA UN `continue` A SECAS, Y AHÍ ESTABA EL AGUJERO: si TODO
      // el lote era de este tipo, el freno devolvía «no se ha evaluado» y dejaba
      // pasar cualquier cifra. Son además los listings más frágiles —los que
      // estrenan precio— y el único freno que caza un precio corrompido.
      sinReferencia++
      // Sin anterior no hay variación, pero sí hay suelo y techo del perfil, que
      // es una cota absoluta y sirve igual.
      if (!fueraDeRango) {
        const bajo = entrada.precioMinimo !== null && entrada.precioMinimo !== undefined
          ? c.valorNuevo < entrada.precioMinimo
          : false
        const alto = entrada.precioMaximo !== null && entrada.precioMaximo !== undefined
          ? c.valorNuevo > entrada.precioMaximo
          : false
        if (bajo || alto) fueraDeRango = { sku: c.sku, precio: c.valorNuevo }
      }
      continue
    }

    comparables++
    const variacion = ((c.valorNuevo - c.valorAnterior) / c.valorAnterior) * 100
    if (Math.abs(variacion) > Math.abs(peorVariacion)) {
      peorVariacion = variacion
      peorSku = c.sku
      peorAntes = c.valorAnterior
      peorDespues = c.valorNuevo
    }
  }

  if (comparables === 0 && sinReferencia === 0) {
    // No es un hueco: este lote sencillamente no cambia ningún precio, así que
    // no hay riesgo de precio que vigilar. Es el caso normal de un cliente que
    // solo manda stock, y tratarlo como hueco frenaría a todos ellos.
    return noAplica(codigo, 'este lote no cambia el precio de ningún SKU')
  }

  // Un precio que se estrena fuera del suelo o del techo del perfil frena, y
  // frena con nombre y apellidos.
  if (fueraDeRango) {
    return {
      codigo,
      salta: true,
      estado: 'medido',
      umbral: maxVariacionPrecioPct,
      medido: Math.abs(peorVariacion),
      frase:
        `el SKU ${fueraDeRango.sku} estrenaría precio con ` +
        `${importe(fueraDeRango.precio, entrada.moneda)}, fuera del suelo y el techo que tiene ` +
        `puesto este cliente. No hay precio anterior con el que comparar, así que se para.`,
    }
  }

  if (comparables === 0) {
    // Hay cambios de precio y NINGUNO se ha podido comparar. No puede salir
    // como «no se ha evaluado» en silencio: es la situación más frágil que hay.
    return sinDatos(
      codigo,
      `los ${formatInt(sinReferencia)} cambios de precio de este lote estrenan precio y ninguno ` +
        'tiene un valor anterior en Amazon con el que compararse. Pon un suelo y un techo de ' +
        'precio en el perfil para que haya algo que los mida'
    )
  }

  const medido = Math.abs(peorVariacion)
  const salta = medido > maxVariacionPrecioPct

  const cuerpo =
    `el SKU ${peorSku} pasaría de ${importe(peorAntes, entrada.moneda)} a ` +
    `${importe(peorDespues, entrada.moneda)} (${pct(peorVariacion, true)})`
  const cola =
    sinReferencia > 0
      ? ` Otros ${formatInt(sinReferencia)} estrenan precio y no se han podido comparar.`
      : ''

  return {
    codigo,
    salta,
    estado: 'medido',
    umbral: maxVariacionPrecioPct,
    medido,
    frase:
      (salta
        ? `${cuerpo}, y el límite de variación de este cliente es el ${pct(maxVariacionPrecioPct)}.`
        : `${cuerpo}, y es el mayor salto del lote; el límite de este cliente es el ${pct(maxVariacionPrecioPct)}.`) +
      cola,
  }
}

/**
 * «Cambiarían 3.780 SKU de golpe, y el límite de este cliente es 500.»
 *
 * Es el freno de red: no mira QUÉ cambia sino CUÁNTO se mueve a la vez. Coge lo
 * que a los otros tres se les escapa —un fichero con los precios en otra
 * divisa, un cambio de criterio en el ERP del cliente— porque cualquier cosa
 * rara acaba tocando muchas más líneas de las normales.
 */
function frenoMaxCambios(entrada: EntradaFrenos): FrenoEvaluado {
  const codigo: StockBrakeCode = 'max_cambios'
  const { maxCambios } = entrada.umbrales

  if (maxCambios === null) {
    return sinUmbral(codigo, 'este cliente no tiene puesto un límite de cambios por lote')
  }

  // Por SKU y no por cambio: tocarle el precio y la cantidad al mismo listing
  // es un producto que se mueve, no dos.
  const skus = new Set(entrada.cambios.map((c) => c.sku))
  const medido = skus.size
  const salta = medido > maxCambios

  const cuerpo = `cambiarían ${formatInt(medido)} SKU de golpe`

  return {
    codigo,
    salta,
    estado: 'medido',
    umbral: maxCambios,
    medido,
    frase: salta
      ? `${cuerpo}, y el límite de este cliente es ${formatInt(maxCambios)}.`
      : `${cuerpo}, por debajo del límite de ${formatInt(maxCambios)}.`,
  }
}

/**
 * EL FRENO NO TIENE UMBRAL: el cliente no lo ha puesto, o alguien vació la
 * casilla en la pantalla.
 *
 * Por sí solo no frena —en simulacro no hay nada que frenar— pero cuenta como
 * HUECO, y con el envío automático encendido un hueco impide mandar. Vaciar
 * una casilla no puede ser la forma más rápida de desactivar esta parte.
 */
function sinUmbral(codigo: StockBrakeCode, porque: string): FrenoEvaluado {
  return {
    codigo,
    salta: false,
    estado: 'sin_umbral',
    umbral: null,
    medido: null,
    frase: `No se ha podido comprobar: ${porque}.`,
  }
}

/** Hay umbral pero falta el dato con el que medirlo. También es un hueco */
function sinDatos(codigo: StockBrakeCode, porque: string): FrenoEvaluado {
  return {
    codigo,
    salta: false,
    estado: 'sin_datos',
    umbral: null,
    medido: null,
    frase: `No se ha podido comprobar: ${porque}.`,
  }
}

/**
 * Este lote no trae nada que este freno pueda mirar.
 *
 * NO es un hueco y la diferencia importa: un cliente que solo manda stock no
 * cambia ningún precio nunca, y contar el freno de variación como «sin mirar»
 * bloquearía su envío automático todos los días por una ausencia de riesgo.
 */
function noAplica(codigo: StockBrakeCode, porque: string): FrenoEvaluado {
  return {
    codigo,
    salta: false,
    estado: 'no_aplica',
    umbral: null,
    medido: null,
    frase: `No viene al caso: ${porque}.`,
  }
}

// =====================================================
// Formato de las frases
// =====================================================

/**
 * Porcentaje en castellano. Con un decimal por debajo de 10 porque «0%» y
 * «0,3%» dicen cosas distintas cuando el límite es el 1%, y sin decimales por
 * encima porque «86,7%» no aporta nada sobre «87%» en una frase de aviso.
 */
function pct(n: number, conSigno = false): string {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const decimales = abs < 10 && abs > 0 ? 1 : 0
  const texto = abs.toLocaleString('es-ES', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })
  if (!conSigno) return `${texto}%`
  const signo = n < 0 ? '-' : '+'
  return `${signo}${texto}%`
}

/** Importe en castellano, con la divisa del perfil si se sabe */
function importe(n: number, moneda: string | null | undefined): string {
  const texto = n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const simbolo = (moneda ?? '').trim().toUpperCase()
  if (!simbolo) return texto
  if (simbolo === 'EUR') return `${texto} €`
  if (simbolo === 'GBP') return `${texto} £`
  if (simbolo === 'USD') return `${texto} $`
  return `${texto} ${simbolo}`
}

// =====================================================
// De la fila de la base de datos a los umbrales
// =====================================================

/** Traduce el perfil guardado a los umbrales que consume evaluarFrenos() */
export function umbralesDesdeFila(fila: StockReadProfile): UmbralesFreno {
  return {
    maxPctACero: numeroONull(fila.freno_pct_a_cero),
    maxVariacionPrecioPct: numeroONull(fila.freno_variacion_precio_pct),
    maxCaidaLineasPct: numeroONull(fila.freno_caida_lineas_pct),
    maxCaidaUnidadesPct: numeroONull(fila.freno_caida_unidades_pct),
    maxCambios: numeroONull(fila.freno_max_cambios),
    lineasReferencia: numeroONull(fila.lineas_referencia),
    ficheroParcial: fila.fichero_parcial === true,
  }
}

/**
 * Los NUMERIC de Postgres llegan por PostgREST como número o como cadena según
 * la precisión. Una cadena aquí convertiría cada comparación en una comparación
 * de textos: '9' > '20' es cierto, y el freno dejaría pasar justo lo que tenía
 * que parar.
 */
function numeroONull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
