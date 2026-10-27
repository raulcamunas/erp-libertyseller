/**
 * LO QUE HAY QUE AÑADIRLE A LA RUTINA «BRIEFING DIARIO LIBERTY SELLER» PARA QUE PUBLIQUE EN EL ERP.
 * ================================================================================================
 * Es el paso que se pega en el texto de la rutina, después de publicar el artefacto. Vive aquí, en un solo sitio, porque lo enseña la pantalla Briefing (con un botón
 * de copiar, para quien conecte el conector sin nadie al lado) y es EXACTAMENTE el texto que se escribe en la rutina.
 *
 * Tres decisiones están dentro del texto:
 *   · El mismo JSON del artefacto, sin tocarlo: no hay un formato aparte que mantener.
 *   · `dia` va siempre (la fecha de hoy en Madrid): así una rutina que se retrasa pasada la medianoche no publica en el día equivocado.
 *   · Si el ERP falla, la rutina NO se para: el artefacto es lo principal y el ERP es una copia. Lo dice en el cierre y listo.
 */

/** El nombre con el que se añade el conector en Claude. Solo es una etiqueta: el texto de la rutina lo nombra */
export const NOMBRE_DEL_CONECTOR = 'ERP Briefing'

export const PASO_DE_LA_RUTINA = [
  `PASO 4b — Copia en el ERP (no bloquea nada). Justo después de publicar el artefacto, llama a la herramienta \`publicar_briefing\` del conector «${NOMBRE_DEL_CONECTOR}» con`,
  '`briefing` = el MISMO JSON que acabas de inyectar en la plantilla (el contenido de data.json, sin cambiarle nada) y `dia` = la fecha de hoy en Madrid (AAAA-MM-DD).',
  'Si la respuesta trae «Avisos», cópialos en tu cierre. Si el conector no está o la herramienta falla, no reintentes más de una vez ni pares: dilo en una línea del cierre',
  '(«ERP: no se ha podido publicar — motivo») y termina como siempre. El artefacto es lo principal; el ERP es una copia.',
].join(' ')
