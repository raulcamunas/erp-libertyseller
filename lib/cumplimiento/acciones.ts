import { motivoMenor, nivelDe } from './incidencias'
import { NIVELES, type Gravedad, type Incidencia, type Nivel, type Tema } from './tipos'

/**
 * QUÉ HAY QUE HACER CON CADA INCIDENCIA, EN CRISTIANO.
 * PURO: sin red ni base de datos. Lo importan igual el servidor que la pantalla. Se prueba en acciones.prueba.ts.
 *
 * Amazon habla en códigos (18299, 100530…) y en mensajes largos que cambian de una ficha a otra. Quien lo arregla en el
 * día a día necesita otra cosa: «pide la aprobación de la marca», «registra la RAP», «cambia la imagen principal», con
 * los pasos en Seller Central. Aquí se traduce cada código a UNA ACCIÓN, y varias incidencias distintas que se arreglan
 * igual (las tres de «necesitas autorización para esta marca», las cuatro de la RAP…) se juntan en una sola tarea.
 *
 * Los códigos salen de lo que había el 14 nov 2026 en las 11 cuentas (146 códigos distintos). Uno nuevo no se pierde:
 * cae en una acción genérica por su tema y su importancia, y su mensaje original se sigue viendo al lado.
 */

export type IdAccion =
  | 'aprobacion-marca'
  | 'restringido'
  | 'transparency'
  | 'precio'
  | 'rap'
  | 'gpsr-responsable'
  | 'gpsr-seguridad'
  | 'documento-cumplimiento'
  | 'etiqueta-energetica'
  | 'ley-de-datos'
  | 'equipos-radio'
  | 'info-alimentaria'
  | 'seguridad-retirada'
  | 'propiedad-intelectual'
  | 'dato-ficha'
  | 'imagen-principal'
  | 'imagenes-no-se-ven'
  | 'texto-retirado'
  | 'variantes'
  | 'codigo-de-barras'
  | 'oferta-en-pausa'
  | 'peligrosas'
  | 'marca'
  | 'oculto-otros'
  | 'normativa-otros'
  | 'menor-recomendacion'
  | 'menor-envio-rechazado'
  | 'menor-error-de-amazon'
  | 'menor-imagen-no-descargada'

/** Dónde se arregla: una ruta de Seller Central (el dominio lo pone el país) */
export type DondeSellerCentral = 'inventario' | 'salud' | 'anadir'

export const RUTA_SELLER_CENTRAL: Record<DondeSellerCentral, { ruta: string; texto: string }> = {
  inventario: { ruta: '/myinventory/inventory', texto: 'Gestionar todo el inventario' },
  salud: { ruta: '/performance/dashboard', texto: 'Salud de la cuenta' },
  anadir: { ruta: '/product-search', texto: 'Añadir productos' },
}

export interface Accion {
  id: IdAccion
  /** En imperativo y corto: lo que se lee en la tarjeta */
  titulo: string
  /** Qué está pasando, en una frase y sin jerga */
  porque: string
  /** Los pasos, en Seller Central */
  pasos: string[]
  /** Quién puede arreglarlo: la agencia sola, o hace falta algo del cliente (documentos, registros, permisos) */
  quien: 'agencia' | 'cliente'
  /** Se arregla UNA vez para todos los listings afectados (un registro, una aprobación de marca): una tarea, no cien */
  deGolpe?: boolean
  donde?: DondeSellerCentral
}

const A = (a: Accion) => a

export const ACCIONES: Record<IdAccion, Accion> = {
  'aprobacion-marca': A({
    id: 'aprobacion-marca',
    titulo: 'Pedir la aprobación de la marca',
    porque: 'Amazon no deja vender esta marca sin permiso: el listing está oculto y no se puede comprar.',
    pasos: [
      'En Seller Central › Catálogo › Añadir productos, busca el ASIN y pulsa «Mostrar limitaciones» › «Solicitar aprobación».',
      'Suele pedir facturas recientes del proveedor o una autorización del titular de la marca: pídeselas al cliente.',
      'Cuando Amazon la aprueba, se reactivan a la vez todos los listings de esa marca.',
    ],
    quien: 'cliente',
    deGolpe: true,
    donde: 'anadir',
  }),
  restringido: A({
    id: 'restringido',
    titulo: 'Desbloquear un producto restringido',
    porque: 'Amazon limita este producto (categoría restringida u otras restricciones) y lo tiene oculto.',
    pasos: [
      'En Seller Central › Catálogo › Añadir productos, busca el ASIN y abre «Mostrar limitaciones»: dice exactamente qué pide.',
      'Normalmente es una aprobación de categoría o un documento; sin eso no se puede vender.',
    ],
    quien: 'cliente',
    donde: 'anadir',
  }),
  transparency: A({
    id: 'transparency',
    titulo: 'Poner los códigos Transparency',
    porque: 'El producto está en el programa Transparency de la marca: sin los códigos «T» en cada unidad, Amazon no deja venderlo.',
    pasos: [
      'Los códigos los da el titular de la marca: pídeselos al cliente (o su autorización).',
      'Cada unidad que entre en Amazon tiene que llevar su etiqueta con el código «T».',
    ],
    quien: 'cliente',
  }),
  precio: A({
    id: 'precio',
    titulo: 'Corregir el precio',
    porque: 'El precio está fuera de los límites de la cuenta (mínimo o máximo) o Amazon lo ve anómalo, y ha desactivado la oferta.',
    pasos: [
      'En Inventario › Gestionar todo el inventario, busca el SKU y revisa el precio.',
      'Si es correcto, confírmalo o amplía el «precio mínimo / máximo permitido» del listing.',
      'Si el precio lo pone un repricer o el motor de precios del ERP, cambia allí el límite: si no, lo volverá a poner.',
    ],
    quien: 'agencia',
    donde: 'inventario',
  }),
  rap: A({
    id: 'rap',
    titulo: 'Registrar la RAP (responsabilidad ampliada del productor)',
    porque: 'Para vender en Francia, Alemania y otros países hay que dar el número de registro RAP de cada categoría (envases, textil, calzado, aparatos eléctricos…). Amazon avisa de que retirará la oferta.',
    pasos: [
      'Pide al cliente su número de registro RAP del país (en Francia, el identificador único de cada categoría; en Alemania, LUCID para envases).',
      'En Seller Central escribe «responsabilidad ampliada» en el buscador y añade el número en la categoría y el país que toca.',
      'Se hace una vez por categoría y país: arregla de golpe todos los listings afectados. Si el cliente no está registrado, no puede vender allí hasta que lo esté.',
    ],
    quien: 'cliente',
    deGolpe: true,
  }),
  'gpsr-responsable': A({
    id: 'gpsr-responsable',
    titulo: 'Poner el fabricante y la persona responsable (GPSR)',
    porque: 'La normativa de seguridad de productos de la UE obliga a enseñar quién fabrica el producto y, si no está en la UE, quién responde por él aquí.',
    pasos: [
      'Datos que hacen falta: nombre, dirección postal y correo del fabricante; y los de la persona responsable en la UE si el fabricante es de fuera.',
      'En Seller Central busca «Gestionar su cumplimiento» y asígnalos a todos los ASIN de la marca de una vez (o en cada ficha: Editar › Seguridad y cumplimiento).',
    ],
    quien: 'agencia',
    deGolpe: true,
  }),
  'gpsr-seguridad': A({
    id: 'gpsr-seguridad',
    titulo: 'Añadir las advertencias de seguridad (GPSR)',
    porque: 'La normativa de seguridad de la UE pide las advertencias y la información de seguridad del producto en la ficha.',
    pasos: [
      'En la ficha: Editar › Seguridad y cumplimiento, añade las advertencias en texto o sube las imágenes o el PDF de la etiqueta y las instrucciones.',
      'El texto suele estar en el embalaje o en el manual: pídeselo al cliente si no lo tenemos.',
    ],
    quien: 'agencia',
  }),
  'documento-cumplimiento': A({
    id: 'documento-cumplimiento',
    titulo: 'Subir el documento de cumplimiento que pide Amazon',
    porque: 'Amazon pide un documento (certificado, informe de ensayo, declaración de conformidad…) o ha rechazado el que se envió.',
    pasos: [
      'En Rendimiento › Salud de la cuenta, abre el requisito de ese producto: dice qué documento quiere.',
      'Sube uno nuevo y legible, del modelo exacto. Si el requisito no aplica, se puede apelar desde ahí mismo.',
    ],
    quien: 'cliente',
    donde: 'salud',
  }),
  'etiqueta-energetica': A({
    id: 'etiqueta-energetica',
    titulo: 'Poner la etiqueta energética (EPREL)',
    porque: 'Los aparatos con etiqueta energética necesitan su número de registro EPREL y la etiqueta en la ficha.',
    pasos: [
      'Pide al cliente el número EPREL del modelo (lo da el fabricante) y la etiqueta y la ficha de información del producto.',
      'En la ficha: Editar › Seguridad y cumplimiento, rellena el número y sube los dos documentos.',
    ],
    quien: 'cliente',
  }),
  'ley-de-datos': A({
    id: 'ley-de-datos',
    titulo: 'Subir la declaración de la Ley de Datos de la UE',
    porque: 'Los productos conectados que generan datos necesitan una «declaración de transparencia» según la Ley de Datos de la UE.',
    pasos: [
      'La redacta el fabricante: pídesela al cliente.',
      'Súbela en la ficha: Editar › Seguridad y cumplimiento (documentos).',
    ],
    quien: 'cliente',
  }),
  'equipos-radio': A({
    id: 'equipos-radio',
    titulo: 'Indicar si incluye cargador (equipos de radio)',
    porque: 'La Directiva de equipos radioeléctricos obliga a decir si el aparato trae cargador y cómo se carga.',
    pasos: [
      'En la ficha, rellena «incluye cargador», «capacidades de carga» y, si no lo trae, la referencia del modelo sin cargador.',
    ],
    quien: 'agencia',
  }),
  'info-alimentaria': A({
    id: 'info-alimentaria',
    titulo: 'Completar la información alimentaria (FIC)',
    porque: 'Los alimentos tienen que enseñar el nombre y la dirección del operador y la información obligatoria al consumidor.',
    pasos: ['En la ficha, rellena el operador alimentario (nombre y dirección) y los datos FIC que pide el mensaje.'],
    quien: 'agencia',
  }),
  'seguridad-retirada': A({
    id: 'seguridad-retirada',
    titulo: 'Revisar una retirada por seguridad',
    porque: 'Amazon ha quitado el producto por un problema de seguridad o por una retirada del mercado.',
    pasos: [
      'En Rendimiento › Salud de la cuenta está el motivo concreto.',
      'Si el producto es seguro, se apela con documentos (certificados, ensayos) del cliente. Si es una retirada real, no vuelve a la venta.',
    ],
    quien: 'cliente',
    donde: 'salud',
  }),
  'propiedad-intelectual': A({
    id: 'propiedad-intelectual',
    titulo: 'Resolver una queja de marca, copyright o autenticidad',
    porque: 'Alguien ha denunciado el listing (uso de una marca o un logo, imágenes o textos con copyright, falsificación, importación paralela).',
    pasos: [
      'En Rendimiento › Salud de la cuenta, en las quejas de propiedad intelectual, mira qué se denuncia y quién.',
      'Si es contenido (logo, imagen, texto), quítalo de la ficha. Si es de autenticidad, hacen falta facturas del proveedor; o que el denunciante retire la queja.',
      'Cuidado: estas quejas pesan en la salud de la cuenta.',
    ],
    quien: 'cliente',
    donde: 'salud',
  }),
  'dato-ficha': A({
    id: 'dato-ficha',
    titulo: 'Rellenar el dato que falta en la ficha',
    porque: 'Falta un dato obligatorio o el que hay no vale (color, talla, nombre…). Mientras tanto, Amazon lo esconde de las búsquedas.',
    pasos: [
      'El mensaje dice qué dato es. En Inventario › Gestionar todo el inventario › Editar, rellénalo y guarda.',
      'Si son muchos listings con el mismo dato, mejor con una plantilla de inventario.',
    ],
    quien: 'agencia',
    donde: 'inventario',
  }),
  'imagen-principal': A({
    id: 'imagen-principal',
    titulo: 'Cambiar la imagen principal',
    porque: 'La imagen principal falta o no cumple las normas, y Amazon ha quitado el producto de las búsquedas.',
    pasos: [
      'La principal tiene que ser el producto sobre fondo blanco puro, sin texto, logos ni marcos, y ocupando casi toda la imagen.',
      'Súbela en Gestionar todo el inventario › Editar › Imágenes.',
    ],
    quien: 'agencia',
    donde: 'inventario',
  }),
  'imagenes-no-se-ven': A({
    id: 'imagenes-no-se-ven',
    titulo: 'Sustituir imágenes que Amazon no enseña',
    porque: 'El producto se vende, pero Amazon ha descartado una o varias imágenes (no representan el producto, llevan texto, el fondo o el tamaño no valen).',
    pasos: [
      'El mensaje dice cuál es (MAIN, PT01, SWCH…) y por qué.',
      'Sube otra que cumpla en Gestionar todo el inventario › Editar › Imágenes.',
    ],
    quien: 'agencia',
    donde: 'inventario',
  }),
  'texto-retirado': A({
    id: 'texto-retirado',
    titulo: 'Reescribir un texto que Amazon ha quitado',
    porque: 'Amazon ha retirado viñetas o la descripción por afirmaciones promocionales, enlaces o datos no permitidos.',
    pasos: ['Reescribe ese texto sin superlativos («el mejor»), garantías, enlaces ni precios, y vuelve a enviarlo desde Editar.'],
    quien: 'agencia',
    donde: 'inventario',
  }),
  variantes: A({
    id: 'variantes',
    titulo: 'Unir la talla o el color a su familia',
    porque: 'Se vende suelto, pero no sale en el desplegable de tallas o colores del producto: el comprador no lo encuentra.',
    pasos: [
      'El mensaje dice qué falla: la marca no es la del padre, la talla o el color están repetidos o vacíos, o el padre tiene un error.',
      'Corrige ese dato en el hijo (o el error del padre) y vuelve a enviar la relación con la plantilla de variaciones.',
    ],
    quien: 'agencia',
    donde: 'inventario',
  }),
  'codigo-de-barras': A({
    id: 'codigo-de-barras',
    titulo: 'Revisar el código de barras o el ASIN',
    porque: 'El EAN o el ASIN no casan con el catálogo de Amazon (código de otra marca, ASIN de otro producto, duplicado).',
    pasos: [
      'Comprueba el EAN en GS1: tiene que ser del fabricante de ese producto.',
      'Si el producto no tiene EAN propio, pide la exención de GTIN; si el ASIN es de otro producto, hay que crear uno nuevo.',
    ],
    quien: 'cliente',
    donde: 'inventario',
  }),
  'oferta-en-pausa': A({
    id: 'oferta-en-pausa',
    titulo: 'Reactivar la oferta en pausa',
    porque: 'Amazon ha pausado la oferta por cancelaciones de pedidos y espera a que confirmes que sigues vendiendo.',
    pasos: ['En Gestionar todo el inventario › Editar, revisa los datos y pulsa «Guardar y finalizar»: se reactiva sola.'],
    quien: 'agencia',
    donde: 'inventario',
  }),
  peligrosas: A({
    id: 'peligrosas',
    titulo: 'Completar los datos de baterías o mercancías peligrosas',
    porque: 'Faltan o no valen los datos de las baterías o de mercancías peligrosas; con ellos mal, Amazon puede bloquear el envío a sus almacenes.',
    pasos: ['Rellena los datos de la batería (tipo, composición, cuántas) y, si lo pide, sube la hoja de datos de seguridad (SDS) del fabricante.'],
    quien: 'cliente',
    donde: 'inventario',
  }),
  marca: A({
    id: 'marca',
    titulo: 'Revisar la marca de la ficha',
    porque: 'La marca no coincide con la del catálogo o no está conectada a la cuenta.',
    pasos: ['Usa el nombre de marca que ya tiene el ASIN, o conecta la marca a la cuenta si es del cliente (Registro de marcas).'],
    quien: 'cliente',
  }),
  'oculto-otros': A({
    id: 'oculto-otros',
    titulo: 'Desbloquear un listing oculto',
    porque: 'Amazon lo tiene oculto por un motivo que no es de los habituales: el mensaje original explica qué pide.',
    pasos: ['Lee el mensaje de Amazon, corrige lo que diga en la ficha y pulsa «Revisar de nuevo» en el listing.'],
    quien: 'agencia',
    donde: 'inventario',
  }),
  'normativa-otros': A({
    id: 'normativa-otros',
    titulo: 'Cumplir otra obligación legal',
    porque: 'Amazon pide un dato o un documento obligatorio por ley para este producto.',
    pasos: ['El mensaje dice cuál. Suele resolverse en la ficha (Editar › Seguridad y cumplimiento) o en Salud de la cuenta.'],
    quien: 'cliente',
    donde: 'salud',
  }),
  'menor-recomendacion': A({
    id: 'menor-recomendacion',
    titulo: 'Recomendaciones de Amazon',
    porque: 'Atributos «recomendados», sugerencias de FBA y avisos informativos. Amazon dice que no impiden vender.',
    pasos: ['Nada urgente. Se puede aprovechar cuando se mejore la ficha.'],
    quien: 'agencia',
  }),
  'menor-envio-rechazado': A({
    id: 'menor-envio-rechazado',
    titulo: 'Cambios rechazados (la ficha sigue como estaba)',
    porque: 'Amazon no aceptó algún dato de un envío (un valor fuera de lista, una marca distinta a la del catálogo…) y se quedó con lo que ya tenía.',
    pasos: ['Nada urgente: el listing sigue igual. Solo hay que mirarlo si ese cambio era importante.'],
    quien: 'agencia',
  }),
  'menor-error-de-amazon': A({
    id: 'menor-error-de-amazon',
    titulo: 'Errores internos de Amazon',
    porque: 'Un envío falló por un error de Amazon, o no pudo traducir la ficha para otro país.',
    pasos: ['Nada que arreglar en la ficha. Si el cambio hacía falta, se vuelve a enviar.'],
    quien: 'agencia',
  }),
  'menor-imagen-no-descargada': A({
    id: 'menor-imagen-no-descargada',
    titulo: 'Imágenes que Amazon no pudo descargar',
    porque: 'El enlace de una imagen enviada falló (servidor caído, 404, formato): la ficha conserva las imágenes que tenía.',
    pasos: ['Solo si faltan imágenes en la ficha: súbelas directamente en Seller Central.'],
    quien: 'agencia',
  }),
}

/** Los códigos que se sabe a qué acción van (14 nov 2026). Los menores no están: van por su motivo (ver MENORES) */
const POR_CODIGO: Readonly<Record<string, IdAccion>> = {}
const asignar = (accion: IdAccion, codigos: string[]) => {
  for (const c of codigos) (POR_CODIGO as Record<string, IdAccion>)[c] = accion
}
// «Necesitas autorización para publicar productos de esta marca» y su formulario de aprobación
asignar('aprobacion-marca', ['18299', '18304', '18570', '18749', '18623', '6024', '5665'])
// «La publicación de este producto está sujeta a otras restricciones»
asignar('restringido', ['19084', '18503', '18971', '18076', '18369', '100332', '18769', '100330'])
asignar('transparency', ['18669'])
// Precio por debajo del mínimo, por encima del máximo, o «posible error de precio»
asignar('precio', ['18155', '19038', '18555', '100019', '18639', '18701'])
asignar('rap', ['100530', '100529', '100632', '100551'])
// GPSR: información del fabricante y persona responsable
asignar('gpsr-responsable', ['100527', '100623', '100528', '100594'])
// GPSR: advertencias e información de seguridad
asignar('gpsr-seguridad', ['100526', '100622'])
// Documento en el panel de la cuenta, documento rechazado, documentación de juguetes, guía de usuario que no abre
asignar('documento-cumplimiento', ['18616', '100540', '100390', '100923'])
asignar('etiqueta-energetica', ['100885', '101074', '100792'])
asignar('ley-de-datos', ['100914', '101073'])
asignar('equipos-radio', ['100525', '100791'])
asignar('info-alimentaria', ['100793'])
// «Problema de seguridad del producto», «Retirada de productos / del mercado»
asignar('seguridad-retirada', ['18967', '18479', '18026', '18373', '18229', '18599', '18622', '19040', '19045'])
// Marca registrada, copyright, logotipo protegido, falsificación, importación paralela
asignar('propiedad-intelectual', ['18146', '19122', '18099', '100227', '18685', '18516', '18370', '18653', '18893', '100452', '18977', '18647', '18676'])
// «'Color' es obligatorio y no está», nombre demasiado largo, falta el nombre, estado de la oferta no válido
asignar('dato-ficha', ['90220', '90225', '8058', '8115'])
asignar('imagen-principal', ['18320', '18644', '18027', '18625', '18254'])
asignar('imagenes-no-se-ven', ['100560', '100588', '100589', '100238', '100581', '990003', '20017', '100239'])
asignar('texto-retirado', ['99300'])
// La talla o el color no entran en la familia (marca distinta, atributos repetidos o que faltan, nombre incoherente, padre con errores)
asignar('variantes', ['100898', '100899', '100893', '101245', '101248', '8801', '18429', '8016', '8007', '18559'])
// Oferta sin producto en el catálogo, EAN que no casa, ASIN de otro producto, duplicados
asignar('codigo-de-barras', ['13013', '8566', '8572', '19098', '18296', '18109', '18374', '100362'])
asignar('oferta-en-pausa', ['18940'])
asignar('peligrosas', ['90248'])
asignar('marca', ['100550', '5461'])

const MENOR_A_ACCION: Record<string, IdAccion> = {
  recomendacion: 'menor-recomendacion',
  'envio-rechazado': 'menor-envio-rechazado',
  'error-de-amazon': 'menor-error-de-amazon',
  'imagen-no-descargada': 'menor-imagen-no-descargada',
}

/**
 * La acción de una incidencia, sabiendo ya su importancia. Primero el código; si no se conoce, el tema.
 * Un aviso menor va siempre a su grupo de menores, aunque su código tenga acción: si no oculta ni pone plazo, no es tarea.
 */
export function accionDe(i: { codigo: string; tema: Tema }, nivel: Nivel): IdAccion {
  if (nivel === 'menor') return MENOR_A_ACCION[motivoMenor(i.codigo) ?? ''] ?? 'menor-recomendacion'
  const conocida = POR_CODIGO[i.codigo]
  if (conocida) return conocida
  switch (i.tema) {
    case 'normativa':
      return nivel === 'bloquea' ? 'documento-cumplimiento' : 'normativa-otros'
    case 'peligrosas':
      return 'peligrosas'
    case 'aprobacion':
      return 'restringido'
    case 'precio':
      return 'precio'
    case 'identificadores':
    case 'duplicado':
      return 'codigo-de-barras'
    case 'imagenes':
      return nivel === 'bloquea' ? 'imagen-principal' : 'imagenes-no-se-ven'
    case 'marca':
      return 'marca'
    default:
      return nivel === 'bloquea' ? 'oculto-otros' : 'dato-ficha'
  }
}

/** Importancia y acción de una incidencia guardada */
export function clasificar(i: Pick<Incidencia, 'codigo' | 'gravedad' | 'mensaje' | 'acciones' | 'exencion' | 'tema'>, ahora: Date): { nivel: Nivel; accion: IdAccion } {
  const nivel = nivelDe(i, ahora)
  return { nivel, accion: accionDe(i, nivel) }
}

/* ------------------------------------------------------------------ */
/* Lo que se saca del mensaje                                          */
/* ------------------------------------------------------------------ */

/**
 * El plazo que da Amazon en el mensaje («si no facilitas esta información antes del 2026-08-12T00:00:00.000Z»), o null.
 * Muchas veces ya ha pasado y Amazon no ha retirado nada todavía: se enseña igual, porque puede hacerlo cualquier día.
 */
export function plazoDe(mensaje: string): string | null {
  const m = /(?:antes del?|como m[aá]ximo el|antes de)\s+(\d{4}-\d{2}-\d{2})T/i.exec(mensaje)
  if (!m) return null
  return Number.isFinite(Date.parse(`${m[1]}T00:00:00Z`)) ? m[1] : null
}

/**
 * El enlace de ayuda que trae el mensaje, SOLO si es de Seller Central (el mensaje es texto de un tercero: no se
 * enlaza a ningún otro sitio). Los mensajes guardados pueden venir recortados: un enlace partido se descarta.
 */
export function ayudaDe(mensaje: string): string | null {
  const m = /https:\/\/sellercentral(?:-europe)?\.amazon\.(?:[a-z]{2,3}|co\.uk|com\.[a-z]{2})\/[^\s"'<>)\]]+/i.exec(mensaje)
  if (!m) return null
  const url = m[0].replace(/[.,;:]+$/, '')
  if (m.index + m[0].length >= mensaje.length && mensaje.length >= 590) return null
  return /\/(help|gp\/help|hz\/approvalrequest|gp\/errorcode)/.test(url) ? url : null
}

/* ------------------------------------------------------------------ */
/* La pestaña «Hoy»: las incidencias agrupadas por lo que hay que hacer */
/* ------------------------------------------------------------------ */

/** Una fila de cumplimiento_codigos (lo que ya lee el panel), con lo que oculta con stock si la migración 306 está */
export interface CodigoAgrupable {
  codigo: string
  gravedad: Gravedad
  tema: Tema
  mensaje: string
  listings: number
  conStock: number
  ocultan: number
  /** De los que oculta, cuántos tienen stock. Sin la 306 no se sabe: se supone lo peor razonable (ver abajo) */
  ocultanConStock?: number | null
  desde: string | null
}

export interface TareaDeHoy {
  accion: IdAccion
  nivel: Nivel
  /** Suma por código: un listing con dos códigos de la misma acción cuenta dos veces (pasa poco: ver acciones.prueba.ts) */
  listings: number
  conStock: number
  codigos: string[]
  /** El mensaje de Amazon del código con más listings, para enseñarlo al lado */
  mensaje: string
  desde: string | null
  plazo: string | null
  ayuda: string | null
}

const PESO_NIVEL: Record<Nivel, number> = Object.fromEntries(NIVELES.map((n, i) => [n, i])) as Record<Nivel, number>

/**
 * Agrupa las incidencias de un cliente (por código, como las da la base) en tareas: una por acción e importancia.
 *
 * Un código que oculta a unos listings y a otros no se parte en dos: la parte que oculta va a «bloquea» y el resto a su
 * importancia normal. Sin la 306 no se sabe cuántos de los ocultos tienen stock: se toma min(con stock, ocultos), que
 * es exacto cuando oculta a todos (casi siempre: 140 de los 146 códigos del 14 nov) y una cota en el resto.
 *
 * Orden: por importancia, y dentro por lo que tiene stock (lo que se deja de vender hoy), luego por tamaño.
 */
export function agruparEnTareas(codigos: readonly CodigoAgrupable[], ahora: Date): TareaDeHoy[] {
  const tareas = new Map<string, TareaDeHoy & { _max: number }>()
  const sumar = (k: CodigoAgrupable, nivel: Nivel, listings: number, conStock: number) => {
    if (listings <= 0) return
    const accion = accionDe(k, nivel)
    const clave = `${nivel}|${accion}`
    const t = tareas.get(clave) ?? { accion, nivel, listings: 0, conStock: 0, codigos: [], mensaje: '', desde: null, plazo: null, ayuda: null, _max: -1 }
    t.listings += listings
    t.conStock += conStock
    if (!t.codigos.includes(k.codigo)) t.codigos.push(k.codigo)
    if (listings > t._max) {
      t._max = listings
      t.mensaje = k.mensaje
    }
    if (k.desde && (!t.desde || k.desde < t.desde)) t.desde = k.desde
    const plazo = plazoDe(k.mensaje)
    // El plazo más cercano de los que haya
    if (plazo && (!t.plazo || plazo < t.plazo)) t.plazo = plazo
    t.ayuda = t.ayuda ?? ayudaDe(k.mensaje)
    tareas.set(clave, t)
  }

  for (const k of codigos) {
    const ocultan = Math.max(0, Math.min(k.ocultan, k.listings))
    const ocultanConStock = Math.min(ocultan, k.conStock, k.ocultanConStock ?? Infinity)
    sumar(k, 'bloquea', ocultan, ocultanConStock)
    // El resto, por lo que es el código sin ocultar (sin acciones: lo que oculta ya se ha contado arriba)
    const nivel = nivelDe({ codigo: k.codigo, gravedad: k.gravedad, mensaje: k.mensaje, tema: k.tema, acciones: [], exencion: null }, ahora)
    sumar(k, nivel, k.listings - ocultan, Math.max(0, k.conStock - ocultanConStock))
  }

  return [...tareas.values()]
    .map((t): TareaDeHoy => ({ accion: t.accion, nivel: t.nivel, listings: t.listings, conStock: t.conStock, codigos: t.codigos, mensaje: t.mensaje, desde: t.desde, plazo: t.plazo, ayuda: t.ayuda }))
    .sort((a, b) => PESO_NIVEL[a.nivel] - PESO_NIVEL[b.nivel] || b.conStock - a.conStock || b.listings - a.listings)
}

/* ------------------------------------------------------------------ */
/* Con la migración 306: cifras exactas por tarea                      */
/* ------------------------------------------------------------------ */

const claveDeTarea = (nivel: Nivel, accion: IdAccion) => `${nivel}|${accion}`

/**
 * El mapa código → tarea que se le pasa a cumplimiento_tareas (306): «b» para cuando la incidencia oculta el listing
 * ahora, «n» para cuando no. Es la misma clasificación que agruparEnTareas, hecha una vez por código.
 */
export function mapaDeTareas(codigos: readonly Pick<CodigoAgrupable, 'codigo' | 'gravedad' | 'tema' | 'mensaje'>[], ahora: Date): Record<string, { b: string; n: string }> {
  const mapa: Record<string, { b: string; n: string }> = {}
  for (const k of codigos) {
    const nivel = nivelDe({ codigo: k.codigo, gravedad: k.gravedad, mensaje: k.mensaje, tema: k.tema, acciones: [], exencion: null }, ahora)
    mapa[k.codigo] = { b: claveDeTarea('bloquea', accionDe(k, 'bloquea')), n: claveDeTarea(nivel, accionDe(k, nivel)) }
  }
  return mapa
}

/**
 * Las tareas con las cifras EXACTAS de cumplimiento_tareas (listings distintos), y el resto de datos (mensaje, plazo,
 * desde, códigos) de agruparEnTareas. Una tarea que la base trae y la agrupación no (un código fuera del límite) se
 * añade con lo que se sabe; una clave «?|código» va a «Rellenar el dato…» como afecta.
 */
export function tareasConRecuentos(
  codigos: readonly CodigoAgrupable[],
  recuentos: ReadonlyArray<{ tarea: string; listings: number; conStock: number }>,
  ahora: Date
): TareaDeHoy[] {
  const base = new Map(agruparEnTareas(codigos, ahora).map((t) => [claveDeTarea(t.nivel, t.accion), t]))
  const salida = new Map<string, TareaDeHoy>()
  for (const r of recuentos) {
    let [nivel, accion] = r.tarea.split('|') as [Nivel, IdAccion]
    if (!(NIVELES as readonly string[]).includes(nivel) || !(accion in ACCIONES)) {
      nivel = 'afecta'
      accion = 'dato-ficha'
    }
    const clave = claveDeTarea(nivel, accion)
    const previa = salida.get(clave) ?? base.get(clave)
    const t: TareaDeHoy = previa
      ? { ...previa, listings: salida.has(clave) ? previa.listings + r.listings : r.listings, conStock: salida.has(clave) ? previa.conStock + r.conStock : r.conStock }
      : { accion, nivel, listings: r.listings, conStock: r.conStock, codigos: [], mensaje: '', desde: null, plazo: null, ayuda: null }
    salida.set(clave, t)
  }
  return [...salida.values()].filter((t) => t.listings > 0).sort((a, b) => PESO_NIVEL[a.nivel] - PESO_NIVEL[b.nivel] || b.conStock - a.conStock || b.listings - a.listings)
}
