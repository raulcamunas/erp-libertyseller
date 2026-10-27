import type { ContextoMcp } from '../contexto'
import type { Herramienta } from '../protocolo'
import { HERRAMIENTAS_DE_APUNTES } from './apuntes'
import { HERRAMIENTAS_DE_CORREOS } from './correos'
import { HERRAMIENTAS_DE_LEADS } from './leads'
import { HERRAMIENTAS_DE_LLAMADAS } from './llamadas'
import { HERRAMIENTAS_DE_RENDIMIENTO } from './rendimiento'
import { HERRAMIENTAS_DE_SECUENCIAS } from './secuencias'

/**
 * LAS HERRAMIENTAS DEL EQUIPO COMERCIAL, TODAS JUNTAS: Mi rendimiento, Cold Calling, la Agenda y el correo con sus secuencias.
 * SOLO LECTURA. Las reúne lib/mcp/herramientas.ts detrás de las de las cuentas de Amazon y con ellas forman el conector «ERP Liberty Seller».
 */

export const HERRAMIENTAS_COMERCIALES: readonly Herramienta<ContextoMcp>[] = [
  ...HERRAMIENTAS_DE_RENDIMIENTO,
  ...HERRAMIENTAS_DE_LEADS,
  ...HERRAMIENTAS_DE_LLAMADAS,
  ...HERRAMIENTAS_DE_APUNTES,
  ...HERRAMIENTAS_DE_SECUENCIAS,
  ...HERRAMIENTAS_DE_CORREOS,
]

export const INSTRUCCIONES_COMERCIALES = [
  'EL EQUIPO COMERCIAL. Además de las cuentas de Amazon, el ERP guarda el trabajo del equipo de ventas. Aquí NO hay «cliente»: se trabaja con las personas del equipo y con los leads (tiendas a las que se llama en frío), y sí se puede mirar a todo el equipo a la vez o comparar comerciales. Por dónde empezar:',
  '· MI RENDIMIENTO — `rendimiento_equipo` (cifras de todos los comerciales en un día, semana o mes, con la comparación y los avisos) y `rendimiento_comercial` (el detalle de uno: su jornada, con quién habló y qué escribió).',
  '· COLD CALLING — `cold_resumen` (el embudo y las rellamadas), `cold_buscar_leads`, `cold_ficha_lead` (un lead entero), `cold_llamadas` (las llamadas de Rinkel), `cold_transcripcion` (lo que se dijo en una), `cold_notas` (lo apuntado con los leads) y `agenda_citas`.',
  '· CORREO — `correo_envios` (qué se está enviando y cuántos quedan en cola, la salud), `correo_cola` (las secuencias de seguimiento una a una), `correos_enviados`, `correo_hilos` y `correo_hilo` (leer una conversación).',
  'Cómo se cuentan las cifras de Mi rendimiento (las mismas que ve el equipo en pantalla): una llamada «hecha» es un CLIENTE distinto al que se llamó ese día, aunque se le llamara tres veces (los `intentos` son las salientes sin agrupar); «contestada» = el cliente descolgó y duró 10 s o más; «conversación» = contestada de un minuto o más; WhatsApp y correos cuentan clientes distintos; «respuestas» = clientes que contestaron; «citas» = las que ese comercial AGENDÓ ese día. Los días y las horas son de Madrid.',
  'Antes de afirmar que alguien «no ha hecho nada», mira los avisos de `rendimiento_equipo`: si su Rinkel no está vinculado o lleva horas sin leerse, sus llamadas pueden faltar. Y los envíos automáticos pueden estar en ENSAYO (deciden pero no envían): `correo_envios` lo dice.',
  'Las listas llevan `total` y `hay_mas`: si hay más de lo que cabe, pide la `siguiente_pagina` o acota con fechas y filtros en vez de suponer que lo devuelto es todo.',
  'Todo lo del equipo comercial es de uso interno: llamadas, transcripciones, apuntes y correos son datos de personas y de empresas a las que se llama. Resume y cita lo necesario, no copies conversaciones enteras sin motivo y no lo compartas fuera del equipo. Leer el buzón de otra persona (`correos_enviados`, `correo_hilos`, `correo_hilo`) queda anotado en el rastro de Correo, que ven los administradores.',
].join('\n\n')
