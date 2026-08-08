import { NEUTROS, MARCA, SEMANTICO, ESTADO_COLOR, DENSIDAD, RADIO, ALTO } from './tokens'

/**
 * La hoja de estilos de la propuesta, entera y encerrada en `.ctx-root`.
 *
 * POR QUÉ ES UNA CADENA Y NO UN .css NI CLASES DE TAILWIND:
 *
 *   a) app/globals.css tiene una capa de traducción que REINTERPRETA las clases de
 *      Tailwind bajo `html.light`: un `text-white/70` deja de ser blanco al 70 % y
 *      pasa a ser un gris concreto. Si esta propuesta usara utilidades de color de
 *      Tailwind, el tema claro del ERP le cambiaría los colores por debajo y no se
 *      podría juzgar lo que se está proponiendo.
 *   b) Hay otras dos propuestas construyéndose a la vez. Un fichero .css importado
 *      globalmente las pisaría.
 *
 * Y por eso también se apagan aquí dentro las transiciones globales: globals.css
 * declara `* { transition-property: ... transform, filter, backdrop-filter; 200ms }`
 * más `a { transition: all .3s }` más `button { transition: all .3s }`. En una tabla
 * de 400 filas eso son 400 filas animando. La regla `.ctx-root *` tiene más
 * especificidad que `*` y que `a`/`button`, así que gana sin un solo !important.
 */

function variables(tema: 'claro' | 'oscuro'): string {
  const n = NEUTROS[tema]
  const m = MARCA[tema]
  const s = SEMANTICO[tema]
  const e = ESTADO_COLOR[tema]
  return `
    --ctx-bg: ${n.bg};
    --ctx-surface: ${n.surface};
    --ctx-surface-2: ${n.surface2};
    --ctx-surface-3: ${n.surface3};
    --ctx-hover: ${n.hover};
    --ctx-line: ${n.line};
    --ctx-line-2: ${n.line2};
    --ctx-fg: ${n.fg};
    --ctx-fg-2: ${n.fg2};
    --ctx-fg-3: ${n.fg3};
    --ctx-mute: ${n.mute};

    --ctx-marca: ${m.fill};
    --ctx-sobre-marca: ${m.sobreFill};
    --ctx-marca-texto: ${m.texto};
    --ctx-marca-tenue: ${m.tenue};

    --ctx-ok: ${s.ok.fg};        --ctx-ok-bg: ${s.ok.bg};        --ctx-ok-line: ${s.ok.line};
    --ctx-aviso: ${s.aviso.fg};  --ctx-aviso-bg: ${s.aviso.bg};  --ctx-aviso-line: ${s.aviso.line};
    --ctx-error: ${s.error.fg};  --ctx-error-bg: ${s.error.bg};  --ctx-error-line: ${s.error.line};
    --ctx-neutro: ${s.neutro.fg};--ctx-neutro-bg: ${s.neutro.bg};--ctx-neutro-line: ${s.neutro.line};
    --ctx-info: ${s.info.fg};    --ctx-info-bg: ${s.info.bg};    --ctx-info-line: ${s.info.line};

    --ctx-e-pendiente: ${e.pendiente};
    --ctx-e-no_contesta: ${e.no_contesta};
    --ctx-e-programado: ${e.programado};
    --ctx-e-email_enviado: ${e.email_enviado};
    --ctx-e-seguimiento: ${e.seguimiento};
    --ctx-e-cita_cualificada: ${e.cita_cualificada};
    --ctx-e-no_interesa: ${e.no_interesa};

    --ctx-sombra: ${tema === 'claro' ? '0 6px 20px rgba(21,24,29,0.13), 0 1px 3px rgba(21,24,29,0.08)' : '0 6px 24px rgba(0,0,0,0.6), 0 1px 3px rgba(0,0,0,0.5)'};
  `
}

export const CSS = `
/* ================================================================== */
/* Raíz y temas                                                        */
/* ================================================================== */

.ctx-root[data-ctx-tema='claro']  { ${variables('claro')} }
.ctx-root[data-ctx-tema='oscuro'] { ${variables('oscuro')} }

.ctx-root {
  --ctx-r-chip: ${RADIO.chip};
  --ctx-r-control: ${RADIO.control};
  --ctx-r-panel: ${RADIO.panel};
  --ctx-fila: ${DENSIDAD.normal.fila}px;
  --ctx-fila-texto: ${DENSIDAD.normal.texto}px;
  --ctx-fila-interlineado: ${DENSIDAD.normal.interlineado}px;

  font-family: Inter, system-ui, -apple-system, sans-serif;
  background: var(--ctx-bg);
  color: var(--ctx-fg);
  font-size: 13px;
  line-height: 18px;
  -webkit-font-smoothing: antialiased;
  border-radius: var(--ctx-r-panel);
  overflow: hidden;
  isolation: isolate;
  border: 1px solid var(--ctx-line-2);
}

.ctx-root[data-ctx-densidad='compacta'] { --ctx-fila: ${DENSIDAD.compacta.fila}px; --ctx-fila-texto: ${DENSIDAD.compacta.texto}px; --ctx-fila-interlineado: ${DENSIDAD.compacta.interlineado}px; }
.ctx-root[data-ctx-densidad='normal']   { --ctx-fila: ${DENSIDAD.normal.fila}px;   --ctx-fila-texto: ${DENSIDAD.normal.texto}px;   --ctx-fila-interlineado: ${DENSIDAD.normal.interlineado}px; }
.ctx-root[data-ctx-densidad='comoda']   { --ctx-fila: ${DENSIDAD.comoda.fila}px;   --ctx-fila-texto: ${DENSIDAD.comoda.texto}px;   --ctx-fila-interlineado: ${DENSIDAD.comoda.interlineado}px; }

/* Se apagan las transiciones globales del ERP (ver cabecera del fichero) y se
   vuelven a encender solo donde hacen falta, con duraciones cortas. */
.ctx-root *, .ctx-root *::before, .ctx-root *::after {
  transition: none;
  border-color: var(--ctx-line);
  box-sizing: border-box;
}
.ctx-root .ctx-t { transition: background-color 90ms linear, border-color 90ms linear, color 90ms linear; }

/* El reset de controles va con :where() a propósito.
   El selector ".ctx-root button" puntúa (0,1,1) —una clase MÁS un elemento— y le
   ganaba a ".ctx-btn", que puntúa (0,1,0): los botones se quedaban sin borde, sin
   fondo y sin padding, y lo mismo los inputs y los chips. Con :where() el selector
   interior no suma nada, el bloque baja a (0,1,0) y gana el que va después, que es
   el que pinta. */
.ctx-root :where(button, input, select, textarea) {
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  margin: 0;
  padding: 0;
}
.ctx-root :where(button) { cursor: pointer; text-align: left; }
.ctx-root :focus-visible {
  outline: 2px solid var(--ctx-marca-texto);
  outline-offset: 1px;
  border-radius: 2px;
}
.ctx-root ::selection { background: var(--ctx-marca); color: var(--ctx-sobre-marca); }

/* ================================================================== */
/* Tipografía: cinco niveles                                           */
/* ================================================================== */

.ctx-xl { font-size: 19px; line-height: 26px; font-weight: 600; letter-spacing: -0.01em; color: var(--ctx-fg); }
.ctx-lg { font-size: 15px; line-height: 22px; font-weight: 600; letter-spacing: -0.005em; color: var(--ctx-fg); }
.ctx-md { font-size: 13px; line-height: 18px; font-weight: 400; color: var(--ctx-fg); }
.ctx-sm { font-size: 12px; line-height: 16px; font-weight: 400; color: var(--ctx-fg-3); }
.ctx-xs { font-size: 11px; line-height: 14px; font-weight: 600; letter-spacing: 0.02em; color: var(--ctx-fg-2); }

.ctx-fg2 { color: var(--ctx-fg-2); }
.ctx-fg3 { color: var(--ctx-fg-3); }
.ctx-mute { color: var(--ctx-mute); }
.ctx-num { font-variant-numeric: tabular-nums; }
.ctx-trunc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ================================================================== */
/* Armazón: barra superior + carril + navegación + contenido           */
/* ================================================================== */

.ctx-app {
  display: grid;
  grid-template-columns: ${ALTO.carril}px ${ALTO.navegacion}px 1fr;
  grid-template-rows: ${ALTO.barraSuperior}px 1fr;
  height: 100%;
  min-height: 0;
}

/* ---------- Barra superior: EL CONTEXTO VIVE AQUÍ ---------- */

.ctx-barra {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px 0 0;
  background: var(--ctx-surface);
  border-bottom: 1px solid var(--ctx-line-2);
  min-width: 0;
}

.ctx-marca-hueco {
  width: ${ALTO.carril}px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-right: 1px solid var(--ctx-line);
  flex: none;
}
.ctx-logo {
  width: 26px; height: 26px;
  border-radius: 7px;
  background: var(--ctx-marca);
  color: var(--ctx-sobre-marca);
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 600; letter-spacing: -0.02em;
}

/* El selector de cuenta. Permanente, siempre en el mismo sitio, y lo único
   naranja de toda la barra. */
.ctx-selector {
  display: flex; align-items: center; gap: 8px;
  height: 32px; padding: 0 8px 0 6px;
  border: 1px solid var(--ctx-line-2);
  border-radius: var(--ctx-r-control);
  background: var(--ctx-surface);
  flex: none; max-width: 300px;
}
.ctx-selector[data-ctx-activo='true'] {
  border-color: var(--ctx-marca);
  background: var(--ctx-marca-tenue);
}
.ctx-selector:hover { border-color: var(--ctx-mute); }
.ctx-selector-sigla {
  width: 20px; height: 20px; flex: none;
  border-radius: var(--ctx-r-chip);
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 600;
  background: var(--ctx-marca); color: var(--ctx-sobre-marca);
}
.ctx-selector-sigla[data-ctx-interno='true'] { background: var(--ctx-neutro-bg); color: var(--ctx-fg-2); border: 1px solid var(--ctx-line-2); }
.ctx-selector-txt { min-width: 0; display: flex; flex-direction: column; gap: 1px; }

.ctx-migas { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; }
.ctx-miga { font-size: 12px; line-height: 16px; color: var(--ctx-fg-3); white-space: nowrap; }
.ctx-miga[data-ctx-fin='true'] { color: var(--ctx-fg); font-weight: 600; }
/* fg3 y no mute: es un caracter que se lee, y «mute» esta medido contra 3:1.
   (Sin acentos graves aqui dentro: esto es una plantilla de cadena.) */
.ctx-miga-sep { color: var(--ctx-fg-3); font-size: 12px; }

.ctx-barra-acciones { display: flex; align-items: center; gap: 6px; flex: none; }

/* ---------- Carril de espacios (nivel 1) ---------- */

.ctx-carril {
  grid-row: 2;
  background: var(--ctx-surface-3);
  border-right: 1px solid var(--ctx-line-2);
  display: flex; flex-direction: column; align-items: center;
  padding: 8px 0; gap: 4px;
}
/* 53 px de ancho. El carril mide 60 y se come 1 con su borde derecho, o sea 59
   de contenido: (59 - 53) / 2 = 3 px exactos a cada lado, que es justo el hueco
   que necesita el filo del activo para caber entero y sin medios pixeles. */
.ctx-espacio {
  width: 53px; height: 40px;
  border-radius: var(--ctx-r-control);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  color: var(--ctx-fg-2);
  position: relative;
}
.ctx-espacio:hover { background: var(--ctx-surface-2); color: var(--ctx-fg); }
.ctx-espacio[data-ctx-activo='true'] {
  background: var(--ctx-surface); color: var(--ctx-fg);
  box-shadow: inset 0 0 0 1px var(--ctx-line-2);
}
/* Dónde estoy: naranja. Es el uso número uno del acento, y tenía dos problemas.
   Uno de color: 3 px de #FF6600 sobre el carril (surface3) dan 2,43:1 en claro,
   por debajo del 3:1 de WCAG 1.4.11 — y es exactamente el mismo 2,43 que la
   ficha señala como defecto del ERP de hoy. Va en --ctx-marca-texto: 4,56 en
   claro y 8,42 en oscuro, mismo tono.
   Y otro de geometria: con un desplazamiento de -8 px sobre un boton centrado en
   el carril, el filo caia en x = -2, y como .ctx-root lleva overflow hidden, de
   los 3 px se veia 1. Ahora sale a ras del borde del carril y se ven los tres. */
.ctx-espacio[data-ctx-activo='true']::before {
  content: ''; position: absolute; left: -3px; top: 8px; bottom: 8px;
  width: 3px; border-radius: 0 2px 2px 0; background: var(--ctx-marca-texto);
}
/* 11 px, que es el suelo que la propia escala de tokens.ts se impone, y heredando
   fg2. Iba a 9 px y a fg3, o sea 4,48:1 sobre el carril: el nivel 1 de navegación
   de la propuesta entera escrito con el texto más pequeño de las tres y por
   debajo del umbral. A 11 px sobre fg2 son 6,45:1. */
.ctx-espacio-txt { font-size: 11px; line-height: 14px; font-weight: 600; }

/* ---------- Navegación de módulos (nivel 2) ---------- */

.ctx-nav {
  grid-row: 2;
  background: var(--ctx-surface);
  border-right: 1px solid var(--ctx-line-2);
  display: flex; flex-direction: column;
  min-height: 0;
}
.ctx-nav-cabecera {
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--ctx-line);
}
.ctx-nav-lista { flex: 1; overflow-y: auto; padding: 6px; }
.ctx-nav-grupo {
  padding: 10px 6px 4px;
  font-size: 11px; line-height: 14px; font-weight: 600; letter-spacing: 0.02em;
  color: var(--ctx-fg-3);
}
.ctx-nav-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; height: 28px; padding: 0 8px;
  border-radius: var(--ctx-r-control);
  color: var(--ctx-fg-2);
  font-size: 13px; line-height: 18px;
  position: relative;
}
.ctx-nav-item:hover { background: var(--ctx-surface-2); color: var(--ctx-fg); }
.ctx-nav-item[data-ctx-activo='true'] {
  background: var(--ctx-surface-2); color: var(--ctx-fg); font-weight: 600;
}
/* Mismo criterio que el filo del carril: --ctx-marca-texto y no --ctx-marca.
   2 px de #FF6600 sobre surface2 dan 2,72:1 en claro; #B34700 da 5,09. */
.ctx-nav-item[data-ctx-activo='true']::before {
  content: ''; position: absolute; left: 0; top: 5px; bottom: 5px;
  width: 2px; border-radius: 0 2px 2px 0; background: var(--ctx-marca-texto);
}
.ctx-nav-item svg { flex: none; opacity: 0.85; }
.ctx-nav-cuenta {
  margin: 6px; padding: 8px;
  border: 1px solid var(--ctx-line);
  border-left: 3px solid var(--ctx-marca);
  border-radius: var(--ctx-r-control);
  background: var(--ctx-surface-2);
}

/* Contador que pide acción: el segundo y último uso del naranja */
.ctx-contador {
  margin-left: auto; flex: none;
  min-width: 18px; height: 16px; padding: 0 5px;
  border-radius: 8px;
  background: var(--ctx-marca); color: var(--ctx-sobre-marca);
  font-size: 10px; line-height: 16px; font-weight: 600; text-align: center;
  font-variant-numeric: tabular-nums;
}
.ctx-contador[data-ctx-tono='neutro'] {
  background: var(--ctx-neutro-bg); color: var(--ctx-fg-2);
  box-shadow: inset 0 0 0 1px var(--ctx-line-2);
}

/* ---------- Área de contenido ---------- */

.ctx-main {
  grid-row: 2;
  min-width: 0; min-height: 0;
  display: flex; flex-direction: column;
  padding: 12px;
  gap: 8px;
  overflow: hidden;
}

/* ================================================================== */
/* Piezas                                                              */
/* ================================================================== */

.ctx-panel {
  background: var(--ctx-surface);
  border: 1px solid var(--ctx-line-2);
  border-radius: var(--ctx-r-panel);
  min-width: 0;
}
.ctx-panel-cab {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--ctx-line);
}
.ctx-panel-cuerpo { padding: 10px; }

/* Botones. Uno primario por pantalla, y punto. */
.ctx-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: ${ALTO.control}px; padding: 0 10px;
  border-radius: var(--ctx-r-control);
  border: 1px solid var(--ctx-line-2);
  background: var(--ctx-surface);
  color: var(--ctx-fg-2);
  font-size: 12px; line-height: 16px; font-weight: 500;
  white-space: nowrap;
}
.ctx-btn:hover { background: var(--ctx-surface-2); color: var(--ctx-fg); border-color: var(--ctx-mute); }
.ctx-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.ctx-btn--primario {
  background: var(--ctx-marca);
  border-color: var(--ctx-marca);
  color: var(--ctx-sobre-marca);
  font-weight: 600;
}
.ctx-btn--primario:hover { background: #FF7A1F; border-color: #FF7A1F; color: var(--ctx-sobre-marca); }
.ctx-btn--peligro { color: var(--ctx-error); border-color: var(--ctx-error-line); background: var(--ctx-error-bg); }
.ctx-btn--peligro:hover { color: var(--ctx-error); background: var(--ctx-error-bg); border-color: var(--ctx-error); }
.ctx-btn--icono { width: ${ALTO.control}px; padding: 0; }
.ctx-btn--fino { height: 24px; padding: 0 8px; font-size: 11px; }

/* Chip de filtro */
.ctx-chip {
  display: inline-flex; align-items: center; gap: 5px;
  height: 24px; padding: 0 8px;
  border-radius: var(--ctx-r-chip);
  border: 1px solid var(--ctx-line-2);
  background: var(--ctx-surface);
  color: var(--ctx-fg-2);
  font-size: 12px; line-height: 16px;
  white-space: nowrap;
}
.ctx-chip:hover { background: var(--ctx-surface-2); color: var(--ctx-fg); }
/* Un chip encendido NO es naranja: el naranja es «dónde estoy», y un filtro no
   es un sitio. Se enciende invirtiendo el neutro, que se ve igual de bien y no
   compite con el estado «En seguimiento», que sí es naranja en el Excel. */
.ctx-chip[data-ctx-activo='true'] {
  background: var(--ctx-fg); color: var(--ctx-surface); border-color: var(--ctx-fg); font-weight: 600;
}
.ctx-chip-num { font-variant-numeric: tabular-nums; opacity: 0.75; }

/* Campos */
.ctx-campo { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ctx-etiqueta { font-size: 11px; line-height: 14px; font-weight: 600; letter-spacing: 0.02em; color: var(--ctx-fg-2); display: flex; align-items: center; gap: 6px; }
.ctx-nota { font-size: 12px; line-height: 16px; color: var(--ctx-fg-3); }
.ctx-input {
  width: 100%; height: ${ALTO.control}px; padding: 0 8px;
  border: 1px solid var(--ctx-mute);
  border-radius: var(--ctx-r-control);
  background: var(--ctx-surface);
  color: var(--ctx-fg);
  font-size: 13px; line-height: 18px;
}
/* El marcador de posición es TEXTO: «Vacío», «Automático», «Tienda o empresa…»,
   «Buscar cuenta…». Va en fg3 (5,72 claro / 5,79 oscuro). El token «mute» se
   queda solo en el borde de este mismo campo, que si es un grafico y si le basta
   el 3:1. */
.ctx-input::placeholder { color: var(--ctx-fg-3); }
.ctx-input:focus { outline: 2px solid var(--ctx-marca-texto); outline-offset: -1px; border-color: var(--ctx-marca-texto); }
.ctx-input--num { text-align: right; font-variant-numeric: tabular-nums; }

/* Cajas de aviso */
.ctx-caja {
  border-radius: var(--ctx-r-control);
  border: 1px solid;
  padding: 8px 10px;
  font-size: 12px; line-height: 17px;
  display: flex; gap: 8px; align-items: flex-start;
}
.ctx-caja svg { flex: none; margin-top: 1px; }
.ctx-caja--info  { background: var(--ctx-neutro-bg); border-color: var(--ctx-neutro-line); color: var(--ctx-fg-2); }
.ctx-caja--aviso { background: var(--ctx-aviso-bg);  border-color: var(--ctx-aviso-line);  color: var(--ctx-aviso); }
.ctx-caja--error { background: var(--ctx-error-bg);  border-color: var(--ctx-error-line);  color: var(--ctx-error); }
.ctx-caja--ok    { background: var(--ctx-ok-bg);     border-color: var(--ctx-ok-line);     color: var(--ctx-ok); }
.ctx-caja strong { font-weight: 600; }

/* Insignia de estado: icono + palabra. Nunca solo color. */
.ctx-estado {
  display: inline-flex; align-items: center; gap: 5px;
  height: 20px; padding: 0 7px 0 5px;
  border-radius: var(--ctx-r-chip);
  border: 1px solid;
  font-size: 11px; line-height: 14px; font-weight: 600;
  white-space: nowrap;
}
.ctx-estado svg { flex: none; }
.ctx-estado--desnudo { border: 0; background: none; padding: 0; height: auto; font-weight: 400; font-size: 13px; }

/* ================================================================== */
/* Tabla                                                               */
/* ================================================================== */

.ctx-tabla-caja {
  flex: 1; min-height: 0; min-width: 0;
  overflow: auto;
  background: var(--ctx-surface);
  border: 1px solid var(--ctx-line-2);
  border-radius: var(--ctx-r-panel);
}
.ctx-tabla { border-collapse: separate; border-spacing: 0; min-width: max-content; width: 100%; }

.ctx-tabla thead th {
  position: sticky; top: 0; z-index: 20;
  height: ${ALTO.cabeceraTabla}px;
  padding: 0 8px;
  background: var(--ctx-surface-2);
  border-bottom: 1px solid var(--ctx-line-2);
  font-size: 11px; line-height: 14px; font-weight: 600; letter-spacing: 0.02em;
  color: var(--ctx-fg-2);
  text-align: left; white-space: nowrap;
  text-transform: none;
}
.ctx-tabla thead th[data-ctx-num='true'] { text-align: right; }
/* La escalera de z-index del ERP, respetada: esquina 30 · cabecera 20 · primera
   columna 10 · resto 0. */
.ctx-tabla thead th.ctx-fija { z-index: 30; }
.ctx-tabla .ctx-fija {
  position: sticky; left: 0; z-index: 10;
  border-right: 1px solid var(--ctx-line-2);
  background: var(--ctx-surface);
}
.ctx-tabla thead th.ctx-fija { background: var(--ctx-surface-2); }

.ctx-tabla tbody tr { height: var(--ctx-fila); }
.ctx-tabla tbody tr:nth-child(even) > td { background: var(--ctx-surface-2); }
.ctx-tabla tbody tr:nth-child(even) > td.ctx-fija { background: var(--ctx-surface-2); }
/* «Estoy pasando por encima» y «esta es la que elegí» tienen que ser dos cosas
   distintas, y antes eran la misma: las dos pintaban surface3 y solo las
   separaban dos filetes de 1 px. En una tabla de 4.000 leads que se recorre con
   el ratón encima, apuntar a una fila la disfrazaba de seleccionada.
   Ahora el hover es un lavado propio (--ctx-hover) y la seleccionada se queda el
   hundido de verdad más dos filetes de 2 px. */
.ctx-tabla tbody tr:hover > td { background: var(--ctx-hover); }
.ctx-tabla tbody tr[data-ctx-sel='true'] > td,
.ctx-tabla tbody tr[data-ctx-sel='true']:hover > td { background: var(--ctx-surface-3); box-shadow: inset 0 2px 0 var(--ctx-fg-2), inset 0 -2px 0 var(--ctx-fg-2); }
.ctx-tabla tbody td {
  height: var(--ctx-fila);
  padding: 0 8px;
  border-bottom: 1px solid var(--ctx-line);
  font-size: var(--ctx-fila-texto);
  line-height: var(--ctx-fila-interlineado);
  color: var(--ctx-fg);
  background: var(--ctx-surface);
  white-space: nowrap;
  vertical-align: middle;
}
.ctx-tabla tbody td[data-ctx-num='true'] { text-align: right; font-variant-numeric: tabular-nums; }

/* El tinte de fila del Excel, opcional y APAGADO por defecto.
   Siete tonos al 8 % son el mismo beige con deuteranopía; el estado lo llevan el
   icono, la palabra y el filo de la izquierda. Se puede reencender por si el
   equipo lo echa de menos, y entonces suma, no sustituye. */
.ctx-root[data-ctx-tinte='si'] .ctx-tabla tbody tr[data-ctx-estado] > td { background-color: var(--ctx-tinte-fila, var(--ctx-surface)); }

/* El filo de color en la primera celda: el estado se ve al barrer la columna
   sin leer nada, que es lo que sustituye al tinte de fila. */
/* El botón que selecciona la fila desde el teclado. Se ve exactamente igual que
   el texto que sustituye —hereda tamaño, color y peso— y solo aparece cuando se
   le enfoca, con el anillo de siempre. */
.ctx-sel-fila { display: block; width: 100%; font: inherit; color: inherit; text-align: left; }

.ctx-filo { position: relative; padding-left: 12px !important; }
.ctx-filo::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
  background: var(--ctx-filo-color, transparent);
}

/* Celda editable: no parece un campo hasta que se pasa por encima.
   Se conserva de hoy tal cual, y el borde de foco se pinta con box-shadow por
   dentro para que la fila NO cambie de alto al entrar en edición. */
.ctx-celda {
  width: 100%; height: calc(var(--ctx-fila) - 8px); padding: 0 6px;
  border-radius: var(--ctx-r-chip);
  background: transparent; color: var(--ctx-fg);
  font-size: var(--ctx-fila-texto); line-height: var(--ctx-fila-interlineado);
  border: 0;
}
.ctx-celda:hover { background: var(--ctx-surface-3); }
.ctx-celda:focus { outline: 0; background: var(--ctx-surface); box-shadow: inset 0 0 0 2px var(--ctx-marca-texto); }
.ctx-celda--num { text-align: right; font-variant-numeric: tabular-nums; }
.ctx-celda--vacia { color: var(--ctx-fg-3); }

/* Barra de herramientas de pantalla */
.ctx-herramientas { display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; min-width: 0; }
.ctx-herramientas--envuelve { flex-wrap: wrap; }
.ctx-sep { width: 1px; height: 16px; background: var(--ctx-line-2); flex: none; }

/* Tira de cifras: cuatro tarjetas de 57 px pasan a una línea de 30 */
.ctx-cifras {
  display: flex; align-items: center; gap: 0;
  height: 30px;
  border: 1px solid var(--ctx-line-2);
  border-radius: var(--ctx-r-control);
  background: var(--ctx-surface);
  overflow: hidden; flex: none;
}
.ctx-cifra {
  display: flex; align-items: baseline; gap: 6px;
  padding: 0 12px; height: 100%;
  border-right: 1px solid var(--ctx-line);
}
.ctx-cifra:last-child { border-right: 0; }
.ctx-cifra-et { font-size: 11px; line-height: 30px; color: var(--ctx-fg-3); }
.ctx-cifra-v { font-size: 13px; line-height: 30px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--ctx-fg); }
.ctx-cifra-sub { font-size: 11px; line-height: 30px; color: var(--ctx-fg-3); font-variant-numeric: tabular-nums; }

/* Desplegable del selector de cuenta */
.ctx-pop {
  position: absolute; top: 40px; left: 0; z-index: 60;
  width: 320px; max-height: 420px; overflow: auto;
  background: var(--ctx-surface);
  border: 1px solid var(--ctx-line-2);
  border-radius: var(--ctx-r-panel);
  box-shadow: var(--ctx-sombra);
  padding: 6px;
}
.ctx-pop-grupo { padding: 8px 8px 4px; font-size: 11px; font-weight: 600; letter-spacing: 0.02em; color: var(--ctx-fg-3); }
.ctx-pop-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; height: 32px; padding: 0 8px;
  border-radius: var(--ctx-r-control);
  color: var(--ctx-fg); font-size: 13px;
}
.ctx-pop-item:hover { background: var(--ctx-surface-2); }
.ctx-pop-item[data-ctx-activo='true'] { background: var(--ctx-marca-tenue); box-shadow: inset 2px 0 0 var(--ctx-marca); }

/* Lista de cuentas de la portada */
.ctx-cuentas { display: flex; flex-direction: column; }
.ctx-cuenta-fila {
  display: grid;
  /* Seis columnas, no siete: se fue la de SKU. Ver la cabecera de
     PantallaInicio.tsx — el tamaño del catálogo es dato de Amazon del cliente y
     puesto en columna alineada a la derecha se compara de un vistazo, que es
     justo lo que la insignia de dos centímetros más arriba promete que no pasa.
     Vive ahora en la tarjeta de contexto de la cuenta activa (Armazon.tsx), que
     enseña una sola. */
  grid-template-columns: 22px minmax(150px, 1.4fr) repeat(3, minmax(120px, 1fr)) 20px;
  align-items: center; gap: 10px;
  height: 30px; padding: 0 10px;
  border-bottom: 1px solid var(--ctx-line);
  color: var(--ctx-fg);
  width: 100%;
}
.ctx-cuenta-fila:nth-child(even) { background: var(--ctx-surface-2); }
.ctx-cuenta-fila:hover { background: var(--ctx-hover); }
.ctx-cuenta-fila:last-child { border-bottom: 0; }
.ctx-sigla {
  width: 22px; height: 22px; flex: none;
  border-radius: var(--ctx-r-chip);
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 600;
  background: var(--ctx-surface-3); color: var(--ctx-fg-2);
  box-shadow: inset 0 0 0 1px var(--ctx-line-2);
}

/* Rejilla de accesos de la portada */
.ctx-accesos { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 12px; }
.ctx-acceso {
  display: flex; align-items: center; gap: 8px;
  height: 26px; padding: 0 8px;
  border-radius: var(--ctx-r-control);
  color: var(--ctx-fg-2); font-size: 13px;
}
.ctx-acceso:hover { background: var(--ctx-surface-2); color: var(--ctx-fg); }
.ctx-acceso svg { flex: none; opacity: 0.8; }

/* Índice lateral del formulario */
.ctx-indice { display: flex; flex-direction: column; gap: 1px; }
.ctx-indice-item {
  display: flex; align-items: center; gap: 8px;
  height: 26px; padding: 0 8px;
  border-radius: var(--ctx-r-control);
  font-size: 12px; color: var(--ctx-fg-2);
  width: 100%;
}
.ctx-indice-item:hover { background: var(--ctx-surface-2); color: var(--ctx-fg); }
.ctx-indice-item[data-ctx-activo='true'] { background: var(--ctx-surface-2); color: var(--ctx-fg); font-weight: 600; box-shadow: inset 2px 0 0 var(--ctx-marca); }

/* Interruptor */
.ctx-switch {
  width: 32px; height: 18px; flex: none;
  border-radius: 9px;
  background: var(--ctx-surface-3);
  box-shadow: inset 0 0 0 1px var(--ctx-mute);
  position: relative;
}
.ctx-switch::after {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 14px; height: 14px; border-radius: 7px;
  background: var(--ctx-fg-2);
}
.ctx-switch[data-ctx-on='true'] { background: var(--ctx-marca); box-shadow: inset 0 0 0 1px var(--ctx-marca); }
.ctx-switch[data-ctx-on='true']::after { left: 16px; background: var(--ctx-sobre-marca); }

/* Franja de guardado */
.ctx-guardado {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: var(--ctx-ok); font-weight: 600;
}

.ctx-scroll { overflow-y: auto; min-height: 0; }
.ctx-fila-flex { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ctx-crece { flex: 1; min-width: 0; }
`
