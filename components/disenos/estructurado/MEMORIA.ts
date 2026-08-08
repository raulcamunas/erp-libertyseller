/**
 * MEMORIA DE LA PROPUESTA «ESTRUCTURADA POR CONTEXTO».
 *
 * Los mismos datos que el README, pero tipados, para que se puedan pintar dentro del
 * ERP en la app de comparación de diseños sin volver a teclearlos.
 *
 * Todos los ratios están MEDIDOS con la fórmula de luminancia relativa de WCAG 2.1
 * sobre los colores finales compuestos, no estimados ni copiados de un generador.
 */

import { tablaDensidad, CROMO_PROPUESTA, HOY } from './metricas'

export const IDEA =
  'El cliente deja de ser un filtro dentro de cada módulo y pasa a ser el contexto del ERP: se elige una cuenta arriba, se queda a la vista, y las herramientas se reorganizan alrededor — con «lo mío» y «la agencia» en un espacio aparte que nunca se mezcla con el trabajo de cliente.'

export const MODO_PRINCIPAL = 'claro' as const

export const POR_QUE_CLARO = [
  'Se trabaja con luz de oficina y sobre tablas de texto pequeño ocho horas al día. Con luz ambiente normal, el texto oscuro sobre fondo claro se lee mejor y cansa menos que el inverso: la pupila se cierra, la profundidad de campo crece y el desenfoque de los bordes de letra baja. Es la diferencia entre la hora primera y la hora séptima.',
  'El tema claro es HOY el caso difícil y está sin resolver: la glass-card no tiene traducción (188 tarjetas en 55 ficheros que en claro se quedan sin borde ni superficie, 1,09:1), la barra lateral tampoco (1,00:1), el naranja de marca no llega ni al 3:1, y el ítem activo del menú da 2,43:1 — o sea que en tema claro no se lee en qué módulo estás. Diseñar primero el caso difícil obliga a que los estados y el acento funcionen; al revés no.',
  'El oscuro NO es una traducción: está diseñado con sus propios valores y medido aparte, y se cambia con un botón en la barra superior. Quien lo prefiera lo tiene entero, no una capa de reinterpretación de clases.',
]

/* ------------------------------------------------------------------ */
/* Escala tipográfica                                                  */
/* ------------------------------------------------------------------ */

export const ESCALA = [
  { nivel: 'ctx-xl', px: 19, grosor: 600, para: 'El contexto: el nombre de la cuenta. Uno por pantalla.' },
  { nivel: 'ctx-lg', px: 15, grosor: 600, para: 'Título de panel o de sección.' },
  { nivel: 'ctx-md', px: 13, grosor: 400, para: 'El nivel de trabajo: celda de tabla, valor de campo, cuerpo.' },
  { nivel: 'ctx-sm', px: 12, grosor: 400, para: 'La nota que explica un campo, el dato de apoyo.' },
  { nivel: 'ctx-xs', px: 11, grosor: 600, para: 'Etiqueta de campo y cabecera de columna.' },
]

export const TIPOGRAFIA_ANTES_DESPUES = {
  tamanos: { hoy: 28, propuesta: 5, nota: 'Hoy conviven dos sistemas: text-sm/text-xs en los módulos viejos y text-[11px]/[10px] en los nuevos. La frontera es cronológica, no semántica.' },
  grosores: { hoy: 6, propuesta: 3, nota: 'Se descargan seis pesos de Inter y dos (300 y 800) tienen cero usos.' },
  minimo: { hoy: '8 px (text-[8px], 5 usos) y 9 px (25 usos)', propuesta: '11 px' },
  interlineado: { hoy: '1,5 heredado en el 96 % del texto, incluidas las celdas de 10 px', propuesta: '18/13 en tabla (1,38), 16/12 en notas (1,33), explícito en los cinco niveles' },
}

/* ------------------------------------------------------------------ */
/* Paleta                                                              */
/* ------------------------------------------------------------------ */

export const PALETA = [
  { rol: 'Fondo de página', claro: '#EFF1F4', oscuro: '#0E1014', para: 'El suelo. No lleva texto encima nunca.' },
  { rol: 'Superficie', claro: '#FFFFFF', oscuro: '#15181D', para: 'Paneles, tablas, tarjetas. Donde vive el dato.' },
  { rol: 'Superficie 2', claro: '#F5F6F8', oscuro: '#1B1F26', para: 'Cebra de la tabla y cabecera de columna. Sirve para seguir la fila con la vista.' },
  { rol: 'Superficie 3', claro: '#E7EAEE', oscuro: '#0A0C0F', para: 'Hundido: el carril de espacios, la fila SELECCIONADA y la celda editable bajo el ratón.' },
  { rol: 'Fila bajo el ratón', claro: '#F0F2F5', oscuro: '#1F242C', para: 'Solo el hover. Existe para que apuntar una fila no la disfrace de seleccionada.' },
  { rol: 'Filete', claro: '#DDE1E6', oscuro: '#262B33', para: 'Separador de fila y de celda.' },
  { rol: 'Filete estructural', claro: '#C4CAD2', oscuro: '#363D47', para: 'Contorno de panel y de la caja de la tabla. Sustituye al backdrop-filter.' },
  { rol: 'Texto 1', claro: '#15181D', oscuro: '#EDEFF2', para: 'EL DATO. Lo que se lee.' },
  { rol: 'Texto 2', claro: '#4B535E', oscuro: '#A5AEBA', para: 'Etiqueta de campo y cabecera de columna. Lo que orienta.' },
  { rol: 'Texto 3', claro: '#5E6774', oscuro: '#8A94A1', para: 'La nota que explica. Lo que se lee una vez.' },
  { rol: 'Apagado (NO texto)', claro: '#7E8794', oscuro: '#727C8A', para: 'El borde de los campos y el guion de «sin dato». Nunca lleva una palabra encima: está medido contra 3:1, no contra 4,5.' },
  { rol: 'Naranja de relleno', claro: '#FF6600', oscuro: '#FF6600', para: 'El de marca, sin tocar, SIEMPRE con etiqueta oscura (#1A1206) encima.' },
  { rol: 'Naranja de texto', claro: '#B34700', oscuro: '#FF8B45', para: 'Cuando el naranja tiene que ser texto o un icono fino. Mismo tono, otra luz.' },
  { rol: 'Correcto', claro: '#10703C', oscuro: '#5DDC98', para: 'Enviado, conectado, cita cualificada. Siempre con icono ✓.' },
  { rol: 'Aviso', claro: '#8A5A00', oscuro: '#F2C14E', para: 'Frenado, caducado, freno apagado. Siempre con triángulo.' },
  { rol: 'Error', claro: '#B3261E', oscuro: '#FF8A80', para: 'Error de lectura, conexión revocada. Siempre con aspa.' },
  { rol: 'Neutro', claro: '#4B535E', oscuro: '#A5AEBA', para: 'Sin cambios, simulacro, sin perfil. Nunca verde.' },
]

/**
 * DÓNDE SÍ Y DÓNDE NO VA EL NARANJA.
 *
 * Hoy hay 720 apariciones literales de #FF6600 y no hay un solo módulo sin él. Un
 * acento que sale 720 veces no acentúa nada. Aquí el naranja significa DOS cosas:
 * dónde estoy y qué tengo que hacer.
 */
export const NARANJA = {
  si: [
    'El selector de cuenta cuando hay una cuenta activa: el filo, el fondo tenue y la sigla.',
    'El filo de 3 px del espacio activo en el carril y del módulo activo en la navegación. «Dónde estoy».',
    'El botón de acción principal de la pantalla. Uno por pantalla, y ninguno más.',
    'Los contadores que piden acción: 7 leads web sin leer, 14 cambios sin enviar, 14 rellamadas para hoy.',
    'El asterisco de campo obligatorio y el anillo de foco del teclado.',
  ],
  no: [
    'Los iconos de la portada. Hoy son 18 iconos naranjas idénticos: es la prueba más clara de que el acento dejó de significar algo.',
    'El chip de filtro encendido. Un filtro no es un sitio: se enciende invirtiendo el neutro.',
    'La fila seleccionada de una tabla. Hoy compite con el naranja del estado «En seguimiento» y con el del chip activo.',
    'El cuerpo de la tabla, entero. Así «En seguimiento» vuelve a ser el único naranja de la tabla.',
    'Los bordes, los hover, los enlaces, los títulos, los KPI y las insignias de rol.',
  ],
  cuenta: {
    hoy: 720,
    portadaHoy: 18,
    portadaPropuesta: 3,
    coldCallingPropuesta: 4,
    nota: 'Contando elementos naranjas visibles a la vez en cada pantalla: hoy en la portada son 18 iconos + insignias; aquí son el espacio activo, el módulo activo y los contadores de acción.',
  },
}

/* ------------------------------------------------------------------ */
/* Contraste MEDIDO                                                    */
/* ------------------------------------------------------------------ */

export interface Medicion {
  par: string
  claro: number
  oscuro: number
  umbral: number
  ok: boolean
  donde: string
}

/** Sobre la superficie de trabajo: #FFFFFF en claro, #15181D en oscuro */
export const CONTRASTE: Medicion[] = [
  { par: 'Texto 1 sobre superficie', claro: 17.79, oscuro: 15.45, umbral: 4.5, ok: true, donde: 'El dato de la celda, el nombre de la cuenta' },
  { par: 'Texto 2 sobre superficie', claro: 7.78, oscuro: 7.93, umbral: 4.5, ok: true, donde: 'Cabecera de columna y etiqueta de campo' },
  { par: 'Texto 3 sobre superficie', claro: 5.72, oscuro: 5.79, umbral: 4.5, ok: true, donde: 'La nota que explica cada campo, el marcador de posición, la celda vacía' },
  { par: 'Texto 1 sobre cebra', claro: 16.45, oscuro: 14.35, umbral: 4.5, ok: true, donde: 'Filas pares de la tabla' },
  { par: 'Texto 2 sobre cebra', claro: 7.2, oscuro: 7.37, umbral: 4.5, ok: true, donde: 'Cabecera de columna (va sobre la cebra)' },
  { par: 'Texto 3 sobre cebra', claro: 5.29, oscuro: 5.38, umbral: 4.5, ok: true, donde: 'Dato secundario en fila par' },
  { par: 'Texto 3 sobre la fila bajo el ratón', claro: 5.1, oscuro: 5.07, umbral: 4.5, ok: true, donde: 'Cualquier nota de la fila que estás apuntando' },
  { par: 'Texto 3 sobre el hundido', claro: 4.74, oscuro: 6.37, umbral: 4.5, ok: true, donde: 'EL PEOR PAR DE TEXTO DE LA PROPUESTA: la fila seleccionada y el carril de espacios' },
  { par: 'Apagado sobre superficie (NO texto)', claro: 3.63, oscuro: 4.21, umbral: 3.0, ok: true, donde: 'SOLO el borde de los campos y el guion de «sin dato». Todo lo que se lee va en Texto 3' },
  { par: 'Naranja de texto sobre superficie', claro: 5.5, oscuro: 7.65, umbral: 4.5, ok: true, donde: 'Contador de acción, asterisco de obligatorio, anillo de foco' },
  { par: 'Etiqueta oscura sobre naranja de relleno', claro: 6.31, oscuro: 6.31, umbral: 4.5, ok: true, donde: 'El botón principal. Hoy es blanco sobre naranja: 2,94:1' },
  { par: 'Correcto sobre superficie', claro: 6.17, oscuro: 10.3, umbral: 4.5, ok: true, donde: 'Enviado, conectada, cita cualificada' },
  { par: 'Aviso sobre superficie', claro: 5.93, oscuro: 10.6, umbral: 4.5, ok: true, donde: 'Frenado, caducada, freno apagado' },
  { par: 'Error sobre superficie', claro: 6.54, oscuro: 7.79, umbral: 4.5, ok: true, donde: 'Error de lectura, conexión revocada' },
  { par: 'Correcto sobre su tinte', claro: 5.38, oscuro: 9.15, umbral: 4.5, ok: true, donde: 'Caja de confirmación' },
  { par: 'Aviso sobre su tinte', claro: 5.23, oscuro: 9.46, umbral: 4.5, ok: true, donde: 'Caja de «hay frenos apagados» y fila del freno apagado' },
  { par: 'Error sobre su tinte', claro: 5.58, oscuro: 7.52, umbral: 4.5, ok: true, donde: 'Caja de error' },
]

/** Los siete estados de Cold Calling, con el tono del Excel y la luz ajustada */
export const CONTRASTE_ESTADOS = [
  { estado: 'Sin contactar', claroHex: '#5E6774', claro: 5.72, oscuroHex: '#8A94A1', oscuro: 5.79 },
  { estado: 'No contesta', claroHex: '#8A6300', claro: 5.43, oscuroHex: '#EAB308', oscuro: 9.28 },
  { estado: 'Rellamada programada', claroHex: '#0B6F82', claro: 5.82, oscuroHex: '#22C8E4', oscuro: 8.85 },
  { estado: 'Info enviada', claroHex: '#9A28AE', claro: 6.39, oscuroHex: '#E86BF7', oscuro: 6.67 },
  { estado: 'En seguimiento', claroHex: '#A84F09', claro: 5.54, oscuroHex: '#FB8C3C', oscuro: 7.56 },
  { estado: 'Cita cualificada', claroHex: '#157A3B', claro: 5.41, oscuroHex: '#3ADD79', oscuro: 10.0 },
  { estado: 'No le interesa', claroHex: '#B51E18', claro: 6.64, oscuroHex: '#FF6B6B', oscuro: 6.41 },
]

/** Lo que se arregla, con el número de usos que tiene hoy cada fallo */
export const CONTRASTE_HOY = [
  { par: 'text-white/40 sobre tarjeta', usos: 251, claro: 4.05, oscuro: 3.8, donde: 'LA CABECERA DE TODAS LAS TABLAS DEL ERP, a 10 px' },
  { par: 'text-white/35 sobre tarjeta', usos: 129, claro: 4.05, oscuro: 3.17, donde: 'Las ~50 etiquetas y notas de la pantalla de perfiles; los KPI de Cold Calling' },
  { par: 'text-white/30 sobre tarjeta', usos: 142, claro: 2.44, oscuro: 2.63, donde: 'El precio de un listing FBA que no se puede editar' },
  { par: 'text-white/25 sobre tarjeta', usos: 95, claro: 2.44, oscuro: 2.18, donde: 'Marcadores de posición de campo' },
  { par: 'text-white/20 sobre tarjeta', usos: 63, claro: 2.44, oscuro: 1.8, donde: 'El guion de «no hay dato»' },
  { par: 'blanco sobre botón #FF6600', usos: 192, claro: 2.94, oscuro: 2.94, donde: 'El botón principal del ERP, en los dos temas' },
  { par: '#FF6600 sobre su píldora, en claro', usos: 1, claro: 2.43, oscuro: 6.62, donde: 'El ítem activo de la barra lateral: en tema claro no se lee dónde estás' },
  { par: 'glass-card en tema claro', usos: 188, claro: 1.09, oscuro: 1.0, donde: 'Blanco sobre blanco: 188 tarjetas sin borde ni superficie' },
]

export const RECUENTO_CONTRASTE = {
  hoy: {
    nivelesDeTexto: 16,
    declaraciones: 3118,
    fallanOscuro: 682,
    fallanClaro: 804,
    porcentajeOscuro: '31 %',
    porcentajeClaro: '37 %',
  },
  propuesta: {
    nivelesDeTexto: 3,
    fallan: 0,
    minimo: 4.74,
    nota:
      'El peor par de texto de toda la propuesta es Texto 3 sobre el hundido (surface3) en tema claro: 4,74:1. Ese par sale en dos sitios reales —la fila seleccionada de una tabla y el carril de espacios—, y por eso es el que se publica. ' +
      'Antes aquí decía 4,78, que es Texto 3 sobre el FONDO DE PÁGINA: un par más suave y, sobre todo, uno donde casi no va texto. El de verdad daba 4,48 y suspendía. Se corrigió bajando la luz de Texto 3 en claro de #616B78 a #5E6774, mismo tono: ahora el peor par pasa, y «fallan: 0» es cierto.',
  },
}

/* ------------------------------------------------------------------ */
/* Densidad                                                            */
/* ------------------------------------------------------------------ */

export const DENSIDAD_MEDIDA = {
  cromoHoy: HOY,
  cromoPropuesta: CROMO_PROPUESTA,
  desglosePropuesta:
    'barra superior 48 + padding 24 + tira de cifras 30 + herramientas 28 + pie 26 + tres huecos de 8 + bordes 2 + cabecera de tabla 26 = 208 px',
  tabla: tablaDensidad(),
  alturaFila: { hoyColdCalling: 35.5, hoyCatalogo: 33, compacta: 24, normal: 28, comoda: 32 },
  nota: 'El alto de fila es un ajuste del usuario, no una decisión de diseño cerrada: Daniella quiere ver catálogo y los comerciales quieren ver cartera, pero Marius entra dos veces al día y prefiere leer. Se cambia en la barra superior y se recuerda por usuario.',
}

/* ------------------------------------------------------------------ */
/* Navegación                                                          */
/* ------------------------------------------------------------------ */

export const NAVEGACION_MEDIDA = {
  hoy: {
    niveles: 1,
    modulos: 18,
    altoBarraLateral: 1049,
    visiblesA780: 11,
    nota: 'Lista plana de 18 módulos ordenados por el día en que se escribieron. Por debajo de 1.049 px de ventana la barra scrollea sola.',
  },
  propuesta: {
    niveles: 2,
    espacios: 3,
    /* 144 y no 132: 8 de padding + tres botones de 40 + dos huecos de 4 + 8 de
       padding. El 132 se quedó de cuando el botón medía 36 px. */
    altoCarril: 144,
    anchoCarril: 60,
    maxModulosNivel2: 11,
    visiblesA780: 11,
    nota: 'Tres espacios siempre visibles en 144 px de alto y 60 de ancho, y como mucho once módulos en el nivel 2. A 780 px caben los tres espacios y los once módulos del espacio más largo.',
  },
}

/* ------------------------------------------------------------------ */
/* Qué se gana y qué se pierde                                         */
/* ------------------------------------------------------------------ */

export const GANO = [
  'Se sabe siempre sobre qué cuenta se trabaja. Hoy no aparece en ninguna pantalla del ERP salvo el botón encendido de una tira que scrollea dentro de sí misma.',
  'Cambiar de cuenta es un clic desde donde estés, y no te mueve de pantalla: del catálogo de Creative Toys al de Shoplamp sin volver a la portada ni volver a filtrar.',
  '12 filas más por pantalla en Cold Calling (31 frente a 19 a 1080 px) y 15 más en el catálogo (31 frente a 16), sin bajar de 13 px de texto ni de 4,5:1 de contraste.',
  'Tres niveles de texto en vez de dieciséis, todos por encima de 4,5:1 en los dos temas. Hoy fallan 682 usos en oscuro y 804 en claro.',
  'El botón principal se puede leer: 6,31:1 frente a 2,94:1 de hoy. Y el naranja se sigue viendo, porque es el mismo naranja.',
  'Los siete estados de Cold Calling se leen en blanco y negro: icono + palabra + tono. Hoy son un punto de 8 px y un tinte al 8 % de alfa.',
  'Un freno apagado LO DICE, con interruptor, icono y la palabra APAGADO. Hoy es una casilla vacía con un marcador de posición gris.',
  'Los cambios se confirman: «Guardado 09:14» por campo y una franja de últimos cambios con deshacer. El patrón de guardar al salir del campo se conserva.',
  'El tema claro es un tema, no una capa de traducción de 140 líneas que reinterpreta clases de Tailwind.',
  'Se van 188 backdrop-filter, la animación infinita de 25 s del fondo, el blur de 500 ms de cada navegación y las transiciones sobre `*`. En la portada hoy hay 20 capas de desenfoque simultáneas.',
]

export const PIERDO = [
  'ES LA PROPUESTA MÁS CARA DE LAS TRES. No es un cambio de CSS: mueve el armazón, el menú y el modelo mental. Sin el plan por pasos del README, no se adopta.',
  'Se pierde el tinte de fila del Excel como estado por defecto en Cold Calling. Está devuelto detrás de un botón —y entonces suma al filo y al icono, no los sustituye—, pero de salida la tabla ya no se ve como el Excel del que vienen, y eso el primer día molesta.',
  'Los filtros de lista, facturación y comercial se van a un desplegable. Se ganan 89 px de alto y se pierde un clic cada vez que se cambian. Es la apuesta a que se tocan una vez al día y no cada minuto; si resulta que no, hay que devolverlos a la vista.',
  'Se pierde el glass. El desenfoque y la translucidez son lo que hoy hace que el ERP parezca caro en una captura; esta propuesta es deliberadamente plana. Gana el que trabaja ocho horas y pierde la primera impresión.',
  'Los módulos que no cuelgan de un cliente y los que sí quedan en sitios distintos, y hay gente que hoy los usa seguidos. Un comercial que salta de Cold Calling a la Agenda cruza dos espacios; hoy están a un ítem de distancia en la misma lista.',
  'Decidir de qué espacio cuelga cada módulo obliga a decisiones que hoy nadie ha tomado. Tesorería enseña ingresos por cliente: está en Agencia, pero alguien pedirá verla dentro de la cuenta. Marketing es de cliente pero la revisión semanal es de agencia. Habrá que arbitrar.',
  'La barra superior de 48 px es alto fijo que antes no existía. Se paga con creces —quita entre 76 y 79 px de título por pantalla—, pero es un compromiso: ninguna pantalla podrá recuperar esos 48 px.',
  'Tres niveles de texto obligan a decidir, en cada uno de los ~4.000 sitios donde hoy hay un `text-white/XX`, cuál de los tres es. No es mecánico y no lo puede hacer un find-and-replace.',
  'El alto de fila configurable es una preferencia más que mantener, y significa que dos personas del equipo ven pantallas distintas: al describir un problema por teléfono, «la fila de abajo del todo» deja de significar lo mismo.',
]

/* ------------------------------------------------------------------ */
/* Cumplimiento                                                        */
/* ------------------------------------------------------------------ */

export const CUMPLIMIENTO = {
  regla:
    'Lo firmado ante Amazon prohíbe agregar o comparar datos ENTRE clientes. Una vista de varias cuentas puede enseñar cada una por separado, nunca medias ni comparativas.',
  comoSeResuelve: [
    'La vista de las 16 cuentas no tiene fila de totales, ni medias, ni «top», ni gráficas agregadas.',
    'No se puede ordenar por ningún dato de negocio del cliente: ni facturación, ni unidades, ni ACOS. Solo por nombre y por si NOSOTROS tenemos algo pendiente ahí.',
    'Lo que se enseña por cuenta es el estado de NUESTROS procesos —¿se envió el stock?, ¿hay cambios sin mandar?, ¿está revisada la semana de campañas?—, no el rendimiento del cliente.',
    'La lista NO lleva columna de SKU. La llevó, y era la única casilla que se salía de esta misma regla: el tamaño del catálogo no es estado de un proceso nuestro, es dato de catálogo de Amazon del cliente, y dieciséis de ellos en columna alineada a la derecha se comparan de un vistazo sin necesidad de ordenar. El dato sigue estando, pero en la tarjeta de contexto de la cuenta ACTIVA, donde se ve una sola y donde sí significa «el tamaño del catálogo que vas a abrir».',
    'La regla está escrita EN LA PANTALLA, junto a la cabecera de la lista, no solo en un comentario del código. El día que alguien pida «una columnita de facturación aquí» hay que poder señalar dónde pone que no.',
  ],
  riesgoResidual:
    'Poner las 16 cuentas en una misma lista es, por su forma, una invitación a compararlas. El diseño lo desactiva quitando lo comparable, pero la tentación no desaparece: esta pantalla necesita un dueño que diga que no.',
}

/* ------------------------------------------------------------------ */
/* Adopción por pasos                                                  */
/* ------------------------------------------------------------------ */

export const PASOS = [
  {
    paso: 1,
    titulo: 'La barra superior, sobre el ERP de hoy',
    que: 'Se añade la barra de 48 px con el selector de cuenta y las migas. Nada más. Ni un módulo se mueve, ni una ruta cambia, ni se toca globals.css. El selector escribe el cliente elegido en un contexto de React y en localStorage; los módulos que ya tienen tira de clientes (Amazon API, stock-sync, marketing) leen de ahí en vez de su estado local.',
    coste: 'Un componente nuevo y tres líneas en cada uno de esos tres módulos.',
    seNota: 'Se sabe sobre qué cuenta trabajas, y cambiar de cuenta deja de sacarte de la pantalla. Es el 70 % del valor de la propuesta.',
  },
  {
    paso: 2,
    titulo: 'Los dos niveles de menú',
    que: 'La barra lateral se parte en carril de espacios + lista del espacio. Las rutas siguen siendo las mismas: solo cambia lib/config/apps.ts, que pasa de una lista plana a tres listas con grupo.',
    coste: 'Un fichero de configuración y AppSidebar.tsx.',
    seNota: 'De 18 ítems en una lista de 1.049 px a 11 como mucho. Y queda dicho qué es de cliente y qué no.',
  },
  {
    paso: 3,
    titulo: 'Los tokens, centralizados y con los nombres de hoy',
    que: 'Los cinco shared.ts (amazon, stock-sync, marketing, empleados, vacaciones) pasan a uno solo CONSERVANDO LOS NOMBRES: primaryButton, ghostButton, fieldInput, cardShell, warnBox, TH, tableShell, STICKY_BG, cellShell… Cambia el valor, no el nombre, así que los módulos no se tocan. Ahí dentro entran los tres niveles de texto, los cinco tamaños y los tres radios.',
    coste: 'Un fichero nuevo y cinco reemplazos de import.',
    seNota: 'Todo el ERP cambia de aspecto de golpe y sin tocar 3.000 líneas. Aquí se arreglan de una vez la cabecera de tabla a 3,80:1 y el botón blanco sobre naranja.',
  },
  {
    paso: 4,
    titulo: 'La densidad y los estados, tabla a tabla',
    que: 'Alto de fila configurable y el patrón de estado con icono + palabra, empezando por Cold Calling y el catálogo de Amazon, que son las dos que se miran ocho horas.',
    coste: 'Dos componentes de tabla.',
    seNota: '12 filas más por pantalla y los estados legibles en blanco y negro.',
  },
  {
    paso: 5,
    titulo: 'La portada y la retirada del glass',
    que: 'Se rehace /dashboard como parte, y se quitan glass-card, el fondo animado y las transiciones sobre `*`. Es lo último porque es lo más visible y lo que menos trabajo diario arregla.',
    coste: '55 ficheros usan glass-card, pero casi todos son la misma tarjeta.',
    seNota: 'El tema claro deja de tener 188 tarjetas invisibles.',
  },
]

export const FICHEROS = [
  'components/disenos/estructurado/tokens.ts — colores, tipografía, densidad, radios',
  'components/disenos/estructurado/estilos.ts — la hoja de estilos entera, encerrada en .ctx-root',
  'components/disenos/estructurado/navegacion.ts — LA PROPUESTA ESTRUCTURAL: tres espacios y 21 entradas sobre las rutas de hoy',
  'components/disenos/estructurado/metricas.ts — el presupuesto de píxeles y el cálculo de filas por pantalla',
  'components/disenos/estructurado/datos.ts — contenido real: 16 cuentas, 32 leads, el perfil de Shoplamp',
  'components/disenos/estructurado/piezas.tsx — insignias de estado, chips, cajas, interruptor',
  'components/disenos/estructurado/Armazon.tsx — barra superior, selector de cuenta, carril y navegación',
  'components/disenos/estructurado/PantallaInicio.tsx — pantalla 1',
  'components/disenos/estructurado/PantallaColdCalling.tsx — pantalla 2',
  'components/disenos/estructurado/PantallaPerfil.tsx — pantalla 3',
  'components/disenos/estructurado/PropuestaEstructurada.tsx — el punto de entrada',
  'components/disenos/estructurado/MEMORIA.ts — este fichero',
  'components/disenos/estructurado/README.md — la memoria en prosa',
]
