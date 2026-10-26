/**
 * LO NUEVO DESDE EL JUEVES 22 DE OCTUBRE DE 2026 — PARA ENSEÑARLO EN EL BRIEFING DEL LUNES 26.
 * ============================================================================================
 * Lo que se ve en la pestaña «Novedades» de la demostración de Secuencias. Está escrito para el EQUIPO (qué cambia para quien llama, escribe y supervisa), así que deja fuera lo que no
 * es de su incumbencia o no se ha decidido contarles: el registro de actividad del equipo, el cierre de sesión por inactividad y el rastro de quién lee qué buzón (decisiones de Raúl:
 * sin aviso a los empleados). El desglose completo, con eso también, se cuenta aparte a quien administra.
 *
 * Solo datos: se comprueba con desde-el-jueves.prueba.ts (que no falte nada, que nada se repita, que no se cuele lo que no se cuenta).
 */

export type EtiquetaDeNovedad = 'Nuevo' | 'Mejora' | 'Arreglo'

export interface Novedad {
  id: string
  etiqueta: EtiquetaDeNovedad
  titulo: string
  /** Cuándo se hizo */
  cuando: string
  /** Una frase: qué es, dicho como se lo contarías a alguien del equipo */
  queEs: string
  /** Lo que cambia o lo que hace, en frases cortas */
  puntos: readonly string[]
  /** Dónde se ve en el ERP */
  donde: string
}

export const NOVEDADES: readonly Novedad[] = [
  {
    id: 'secuencias',
    etiqueta: 'Nuevo',
    titulo: 'Seguimientos automáticos de correo (Secuencias)',
    cuando: 'Sáb 24 – lun 26',
    queEs: 'Escribes el primer correo y el ERP se encarga de los seguimientos: salen solos, a su hora, desde tu buzón y en el mismo hilo.',
    puntos: [
      'Desde el cuadro de Correo programas dos seguimientos (a los 3 y a los 7 días hábiles). La IA los escribe y tú los puedes editar.',
      'Salen repartidos entre las 9:00 y las 18:00, con un tope diario por buzón que sube poco a poco para cuidar la reputación del correo.',
      'Se paran solos cuando el lead contesta (también si contesta otra persona de su empresa), si el correo rebota o si tú le escribes a mano.',
      'Si nadie contesta a ninguno, 7 días hábiles después del último correo el lead pasa solo a «No contesta» (si nadie lo ha tocado entretanto) y queda una nota en su ficha.',
      'Cada persona ve solo lo suyo; quien supervisa lo ve todo, y un administrador puede pausar, saltar o adelantar un correo.',
    ],
    donde: 'Correo → Secuencias (lo que estás viendo en esta demostración)',
  },
  {
    id: 'a-medida',
    etiqueta: 'Nuevo',
    titulo: 'La IA escribe cada seguimiento justo antes de enviarlo',
    cuando: 'Dom 25',
    queEs: 'El texto programado hace una semana ya no sirve si desde entonces has llamado o has apuntado algo: ahora la IA lo escribe de nuevo con todo lo que consta del lead.',
    puntos: [
      'Lee las llamadas (y lo que se habló, si hay transcripción), las notas, lo que ya se envió y lo que haya contestado.',
      'Si ve algo que lo desaconseja —«escríbeme después de Reyes», una queja, un «no»—, pausa el seguimiento y te lo deja para que decidas tú, en vez de enviarlo.',
      'En el detalle de cada correo se ve el borrador original, lo que escribió la IA y por qué lo escribió así.',
      'Nunca habla de dinero ni de facturación, y nunca ve teléfonos ni direcciones de correo.',
    ],
    donde: 'Secuencias → pulsa una persona → «Los correos»',
  },
  {
    id: 'respuestas',
    etiqueta: 'Nuevo',
    titulo: 'La IA lee las respuestas de los leads',
    cuando: 'Sáb 24',
    queEs: 'Cuando un lead contesta, la IA entiende qué quiere decir y deja hecho lo que toca en su ficha.',
    puntos: [
      'Distingue: interesado, pide información, no le interesa, pide la baja, más adelante, te deriva a otra persona y fuera de oficina.',
      'Un «no» claro cierra el lead; «escríbeme en enero» o «llámame el jueves» programan la rellamada para esa fecha; un interesado o una petición de información queda como aviso para que llames o contestes.',
      'No pisa el trabajo de nadie: un lead en seguimiento o con cita no se toca, solo se deja una nota.',
      'Un correo que rebota deja una nota en la ficha y esa dirección no se vuelve a usar.',
    ],
    donde: 'Secuencias → Flujo, y en la ficha del lead',
  },
  {
    id: 'rellamadas-solas',
    etiqueta: 'Nuevo',
    titulo: 'Las rellamadas se programan solas',
    cuando: 'Lun 26',
    queEs: 'Si un cliente pide que le vuelvas a llamar otro día, por teléfono o por correo, la rellamada queda puesta sin que nadie la apunte.',
    puntos: [
      'Por teléfono: al transcribir la llamada, si dijo «llámame el jueves» o «llámame mañana», el lead pasa a «Rellamada programada» con ese día y una nota explica de dónde sale.',
      'Por correo: «llámame mañana» o «contáctame después de Reyes» dejan la misma rellamada, con la fecha que pide.',
      'Si ya tenía otra rellamada puesta, si el lead es de otra persona o tiene una cita, no se toca: solo queda una nota para que lo mires.',
      'Si no contesta a ninguno de los dos seguimientos, el lead pasa a «No contesta».',
    ],
    donde: 'Ficha del lead (Cold Calling) y Correo → Secuencias',
  },
  {
    id: 'salud',
    etiqueta: 'Nuevo',
    titulo: 'Salud de los buzones y avisos',
    cuando: 'Dom 25 – lun 26',
    queEs: 'Un panel que dice si todo va bien y avisa por la campana si algo se estropea.',
    puntos: [
      'Por buzón: si está conectado, cuántos correos lleva hoy y la tasa de rebotes (en rojo solo cuando hay datos suficientes para fiarse).',
      'Del motor: cuándo pasó por última vez y si hay correos atrasados o fallidos.',
      'Si un buzón o el motor se estropean, le llega un aviso a quien administra.',
      'Antes de programar un seguimiento se comprueba que la dirección esté bien escrita y que el dominio exista.',
    ],
    donde: 'Secuencias → Salud',
  },
  {
    id: 'redactar',
    etiqueta: 'Nuevo',
    titulo: '«Redactar con IA» el correo a un lead',
    cuando: 'Vie 23',
    queEs: 'Un botón en el cuadro de correo que redacta el correo a un lead con sus datos y su historial.',
    puntos: [
      'Usa el sector, si ya vende en Amazon, lo que se habló por teléfono y las notas; nunca la facturación estimada.',
      'Escribe con principios de persuasión: empezar por ellos, despertar curiosidad, pedir un paso fácil y no mentir.',
      'Puedes pedirle «más corto» o «menciona la llamada», y escribir al lead en una ventana encima de la ficha sin salir de Cold Calling.',
      'Cuesta menos de un céntimo por correo.',
    ],
    donde: 'Cold Calling → ficha del lead → Correo',
  },
  {
    id: 'whatsapp',
    etiqueta: 'Nuevo',
    titulo: 'WhatsApp desde la ficha',
    cuando: 'Dom 25 – lun 26',
    queEs: 'Un botón que abre el chat de WhatsApp con el mensaje ya escrito y lo apunta en el historial del lead.',
    puntos: [
      'Mensajes según la situación (primer contacto, no contesta, después de hablar), editables y con varias variantes para no mandar siempre el mismo texto.',
      '«Generar con IA»: un mensaje a medida para ese momento, leyendo el historial. Tarda unos dos segundos.',
      'Queda apuntado como «WhatsApp abierto con este mensaje»: el ERP no puede saber si lo enviaste.',
    ],
    donde: 'Cold Calling → ficha del lead → WhatsApp',
  },
  {
    id: 'configuracion-ia',
    etiqueta: 'Nuevo',
    titulo: 'Configuración de la IA: afinar lo que escribe',
    cuando: 'Vie 23 – lun 26',
    queEs: 'La pantalla donde quien supervisa ajusta lo que escribe la IA (correo y WhatsApp) sin tocar código: ajustar, probar con casos sin enviar nada y publicar.',
    puntos: [
      'Versiones de las instrucciones con su reparto, y los resultados para saber cuál consigue más respuestas.',
      'Diez personas de prueba inventadas para comparar versiones en igualdad de condiciones, también con sus seguimientos.',
      'Cada mensaje enseña lo que recibió la IA, palabra por palabra.',
      'Lo que se publica lo usa todo el equipo, y la versión anterior se queda guardada por si hay que volver atrás.',
    ],
    donde: 'Mi rendimiento → Configuración de la IA (quien supervisa)',
  },
  {
    id: 'cold-calling',
    etiqueta: 'Mejora',
    titulo: 'Cold Calling: más rápido y con todo apuntado solo',
    cuando: 'Jue 22 – vie 23',
    queEs: 'Menos clics y menos cosas que apuntar a mano.',
    puntos: [
      'Las llamadas de Rinkel se apuntan solas en el lead: suman un intento, actualizan el último contacto y marcan «No contesta» si no cogieron.',
      'Pantalla más compacta y cartera que carga rápido.',
      'Teléfonos sin el «.0» del Excel, botón «+ Añadir» para teléfonos y correos extra, y el teléfono es un enlace de llamada para la extensión de Rinkel.',
      'Cold Calling y Correo se quedan abiertas al cambiar de app: no se recargan ni pierdes lo que estabas haciendo.',
    ],
    donde: 'Cold Calling',
  },
  {
    id: 'transcripcion',
    etiqueta: 'Nuevo',
    titulo: 'Transcripción de las llamadas',
    cuando: 'Vie 23',
    queEs: 'Cada llamada con conversación se transcribe sola: queda un resumen, la línea de lo hablado y el siguiente paso.',
    puntos: [
      'Aparece en la ficha del lead y es lo que lee la IA para escribir el correo, el seguimiento o el WhatsApp con lo que se habló de verdad.',
      'La transcripción completa se lee como una conversación, con «Comercial» y «Cliente»: lo deduce la IA por lo que se dice, así que puede equivocarse alguna vez.',
      'Cuesta unas cinco milésimas de dólar por una llamada de un minuto.',
    ],
    donde: 'Ficha del lead → llamadas',
  },
  {
    id: 'rendimiento',
    etiqueta: 'Nuevo',
    titulo: 'Mi rendimiento',
    cuando: 'Jue 22',
    queEs: 'Cada comercial ve su propio día con las llamadas de Rinkel, y quien supervisa ve el del equipo.',
    puntos: [
      'Calendario del mes con las llamadas y sus grabaciones, y las cifras del día con su comparativa.',
      'Barra de periodo (hoy, ayer, semana, mes) y tabla del equipo con su tendencia.',
      'Línea del día —quién hizo qué y a qué hora— y detalle cliente a cliente.',
      'WhatsApp, correos y llamadas cuentan clientes distintos por día, no apuntes ni intentos: llamar tres veces a un cliente es una llamada, y otro día vuelve a contar. Las de menos de 10 segundos cuentan como no contestadas.',
      'Informe semanal a pantalla completa para la reunión del lunes.',
    ],
    donde: 'Mi rendimiento',
  },
  {
    id: 'correo',
    etiqueta: 'Nuevo',
    titulo: 'El correo dentro del ERP',
    cuando: 'Jue 22',
    queEs: 'El buzón de cada persona, dentro del ERP: lees y escribes sin salir.',
    puntos: ['Cada persona conecta su buzón y ve su bandeja con los correos agrupados en hilos.', 'Responder, reenviar, enviar con adjuntos y buscar; plantillas para los correos que repites.', 'Fondo oscuro, sin franjas blancas.'],
    donde: 'Correo',
  },
  {
    id: 'avisos',
    etiqueta: 'Mejora',
    titulo: 'Avisos en vivo y barra lateral',
    cuando: 'Jue 22',
    queEs: 'El ERP te avisa de lo que pasa sin que tengas que ir a mirarlo.',
    puntos: ['Abajo a la derecha: correo nuevo, hitos de llamadas (20, 40, 60, 80 y 100) y citas.', 'Campana y cambio de tema (claro u oscuro) en la barra lateral.'],
    donde: 'En cualquier pantalla',
  },
  {
    id: 'inicio',
    etiqueta: 'Mejora',
    titulo: 'Nuevo inicio de sesión y pantalla de Inicio',
    cuando: 'Vie 23',
    queEs: 'La entrada al ERP, rehecha.',
    puntos: ['Acceso directo al formulario, o al ERP si ya tienes la sesión abierta.', 'Inicio con saludo según la hora y tarjetas con foco en lo que más usas.'],
    donde: 'Inicio',
  },
  {
    id: 'por-debajo',
    etiqueta: 'Arreglo',
    titulo: 'Por debajo: modelos de IA, costes y fiabilidad',
    cuando: 'Vie 23 – lun 26',
    queEs: 'Lo que no se ve pero evita sustos.',
    puntos: [
      'Las pantallas que usaban gpt-4o pasan a gpt-6-luna antes de que OpenAI lo apague (14 de enero de 2027); la transcripción de las citas usa gpt-transcribe.',
      'La IA de WhatsApp usa gpt-6-luna sin razonar: unos dos segundos y entre 0,01 y 0,03 céntimos por mensaje.',
      'Stock a Amazon: un fallo de la base de datos se disfrazaba de «fallo de Amazon» y dejó sin enviarse el stock de un cliente durante dos días. Corregido: ahora los errores se cuentan como son.',
      'Un tablero en Sistema con lo que cobra OpenAI por toda la IA del ERP.',
      'En Salud, un solo rebote entre pocos envíos ya no se pinta de rojo.',
    ],
    donde: 'Sistema y por debajo',
  },
]

/** Cómo recorrer la demostración, para quien la enseña */
export const GUION_DE_LA_DEMO: readonly { titulo: string; texto: string }[] = [
  { titulo: 'Hoy', texto: 'Lo que ya ha salido y lo que sale esta tarde, por buzón, con el tope del día.' },
  { titulo: 'Cola', texto: 'Las doce personas de la demostración. Pulsa una para ver sus correos y todo lo que ha pasado: quién contestó, quién rebotó, a quién pausó la IA.' },
  { titulo: 'Reloj de la demostración', texto: 'Avanza uno, tres o siete días hábiles y mira cómo el motor sigue trabajando: salen seguimientos, contestan, se cierran leads.' },
  { titulo: 'Flujo y Salud', texto: 'Qué lleva cada paso y qué entendió la IA de las respuestas; y cómo están los buzones y el motor.' },
]
