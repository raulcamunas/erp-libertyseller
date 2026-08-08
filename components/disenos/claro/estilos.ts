/**
 * PROPUESTA DE DISEÑO «CLARO Y NÍTIDO» — hoja de estilo.
 *
 * Todo lo de aquí vive bajo `.lsd-raiz` y lleva prefijo `lsd-`. No hay ni un
 * selector de elemento suelto (`body`, `*`, `a`, `button`) ni una sola clase de
 * las que ya usa el ERP: esta propuesta se monta a la vez que otras dos y no
 * puede pisar a nadie. Se inyecta con un <style> desde Marco.tsx.
 *
 * Los dos modos se declaran ENTEROS y por separado, cada uno con sus valores
 * elegidos: `[data-modo="claro"]` y `[data-modo="oscuro"]`. NO hay capa de
 * traducción de uno a otro —que es lo que hace hoy globals.css y por lo que
 * `glass-card` acaba siendo blanco sobre blanco—. El principal es el CLARO.
 */

export const CSS = `
/* ================================================================
   1. LOS DOS MODOS
   ================================================================ */

.lsd-raiz[data-modo="claro"] {
  /* Fondo papel, no blanco puro: el blanco puro a pantalla completa y a ocho
     horas es un foco. El papel es cálido a propósito — comparte familia con el
     naranja de la marca y evita el gris azulado de cualquier panel genérico. */
  --lsd-lienzo: #F2EEE7;
  --lsd-papel: #FFFFFF;
  --lsd-papel2: #FAF7F2;
  --lsd-selec: #EFE7DA;

  /* TRES niveles de tinta. Ni uno más: entre 4,5:1 y 18:1 no caben cuatro
     grises que alguien pueda distinguir de verdad. Lo que hoy hace la opacidad
     número catorce, aquí lo hacen el tamaño y el grosor. */
  --lsd-t1: #17140F;
  --lsd-t2: #554E45;
  --lsd-t3: #6B6357;

  /* El naranja, partido en dos usos. #FF6600 se queda intacto como RELLENO
     (donde es un área con texto oscuro encima). Para TEXTO sobre claro se baja
     la luminosidad manteniendo el tono exacto (24°, saturación 100 %). */
  --lsd-marca: #FF6600;
  --lsd-marca-texto: #A84300;
  --lsd-sobre-marca: #17140F;
  --lsd-lavado: #FFE2CC;

  --lsd-regla: #E6DFD3;
  --lsd-regla5: #D6CDBD;
  --lsd-borde: #D8D0C1;

  --lsd-aviso: #7E5C00;   --lsd-aviso-bg: #FFF3D6;  --lsd-aviso-bd: #E7CF95;
  --lsd-error: #AB211A;   --lsd-error-bg: #FDE4E1;  --lsd-error-bd: #EFB3AD;
  --lsd-ok:    #0E6B39;   --lsd-ok-bg:    #DCF2E5;  --lsd-ok-bd:    #A8D8BE;
  --lsd-info-bg: #EDEAE3;

  --lsd-sombra-menu: 0 8px 24px rgba(35, 28, 18, 0.14);
  color-scheme: light;
}

.lsd-raiz[data-modo="oscuro"] {
  --lsd-lienzo: #131110;
  --lsd-papel: #1C1917;
  --lsd-papel2: #232019;
  --lsd-selec: #33291C;

  --lsd-t1: #F7F3ED;
  --lsd-t2: #B7AEA2;
  --lsd-t3: #A0978B;

  --lsd-marca: #FF6600;
  --lsd-marca-texto: #FF9552;
  --lsd-sobre-marca: #17140F;
  --lsd-lavado: #3A2410;

  --lsd-regla: #292521;
  --lsd-regla5: #38322B;
  --lsd-borde: #35302A;

  --lsd-aviso: #F2C33C;   --lsd-aviso-bg: #2E2508;  --lsd-aviso-bd: #5C4A12;
  --lsd-error: #FF9089;   --lsd-error-bg: #33191A;  --lsd-error-bd: #6B2B28;
  --lsd-ok:    #54DC91;   --lsd-ok-bg:    #132A1E;  --lsd-ok-bd:    #245C3C;
  --lsd-info-bg: #232019;

  --lsd-sombra-menu: 0 8px 24px rgba(0, 0, 0, 0.5);
  color-scheme: dark;
}

/* ================================================================
   2. LA ESCALA TIPOGRÁFICA — cinco tamaños, tres grosores
   ================================================================ */

.lsd-raiz {
  --lsd-fuente: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;

  --lsd-titulo: 20px;     /* el h1 de la pantalla. Uno por pantalla. */
  --lsd-cifra: 17px;      /* el número de un indicador */
  --lsd-cuerpo: 13px;     /* el dato: celdas, valores, campos */
  --lsd-apoyo: 12px;      /* contexto: descripciones, notas, ayudas */
  --lsd-etiqueta: 11px;   /* cabecera de columna, etiqueta de campo */

  /* Alto TOTAL de una fila, regla incluida. La celda mide uno menos porque en
     una tabla el borde se suma por fuera: si se pone 32 aquí, la fila mide 33
     y la cuenta de «cuántas caben» sale mal. Medido en navegador, no supuesto. */
  --lsd-fila: 32px;
  --lsd-fila-celda: 31px;

  font-family: var(--lsd-fuente);
  background: var(--lsd-lienzo);
  color: var(--lsd-t1);
  font-size: var(--lsd-cuerpo);
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}

.lsd-raiz *, .lsd-raiz *::before, .lsd-raiz *::after { box-sizing: border-box; }
.lsd-raiz button, .lsd-raiz input, .lsd-raiz select, .lsd-raiz textarea {
  font: inherit; color: inherit; margin: 0;
}

.lsd-titulo   { font-size: var(--lsd-titulo); font-weight: 600; letter-spacing: -0.012em; color: var(--lsd-t1); margin: 0; }
.lsd-cifra    { font-size: var(--lsd-cifra); font-weight: 600; font-variant-numeric: tabular-nums; color: var(--lsd-t1); letter-spacing: -0.01em; }
.lsd-apoyo    { font-size: var(--lsd-apoyo); color: var(--lsd-t2); }
.lsd-tenue    { font-size: var(--lsd-apoyo); color: var(--lsd-t3); }
.lsd-etiqueta {
  font-size: var(--lsd-etiqueta); font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.045em; color: var(--lsd-t3);
}
/* Todo número que se compare en columna. 177 usos en el ERP de hoy: intocable. */
.lsd-num { font-variant-numeric: tabular-nums; }

/* ================================================================
   3. EL ARMAZÓN
   ================================================================ */

.lsd-raiz { display: flex; flex-direction: column; height: 100%; min-height: 0; }

/* --- Barra superior: 48 px. Hoy no hay cabecera; hay dos iconos flotando.
   Cuesta 48 px fijos y a cambio quita el bloque de título de 76-79 px de CADA
   pantalla, y mete el buscador global que hoy no existe. --- */
.lsd-barra {
  height: 48px; flex: 0 0 48px; display: flex; align-items: center; gap: 12px;
  padding: 0 14px; background: var(--lsd-papel);
  border-bottom: 1px solid var(--lsd-borde);
}
.lsd-marca-logo {
  display: flex; align-items: center; gap: 8px; font-weight: 600;
  font-size: var(--lsd-cuerpo); color: var(--lsd-t1); letter-spacing: -0.01em;
}
/* La barra de la marca: el naranja como GRÁFICO, sin texto encima. */
/* ÚNICO filo que sigue en #FF6600 sobre claro, y a propósito: es el distintivo de
   marca que va pegado al nombre «Liberty Seller», no un indicador de estado. Va
   con aria-hidden y no comunica nada, así que le aplica la excepción de logotipo
   de WCAG. Todos los demás filos naranjas de esta hoja —módulo activo, sección
   activa, tarjeta que urge, foco— usan --lsd-marca-texto, que sí llega a 3:1. */
.lsd-marca-barra { width: 4px; height: 18px; border-radius: 2px; background: var(--lsd-marca); }

.lsd-buscador {
  flex: 1; max-width: 420px; height: 30px; display: flex; align-items: center; gap: 7px;
  padding: 0 10px; border-radius: 7px; border: 1px solid var(--lsd-borde);
  background: var(--lsd-lienzo); color: var(--lsd-t3); font-size: var(--lsd-apoyo);
  cursor: text;
}
.lsd-buscador:hover { border-color: var(--lsd-t3); }
.lsd-tecla {
  margin-left: auto; font-size: 10px; font-weight: 600; color: var(--lsd-t3);
  border: 1px solid var(--lsd-borde); border-radius: 4px; padding: 1px 5px;
  background: var(--lsd-papel);
}

/* --- Cuerpo: menú + pantalla --- */
.lsd-cuerpo { flex: 1; display: flex; min-height: 0; min-width: 0; }

.lsd-menu {
  width: 194px; flex: 0 0 194px; background: var(--lsd-papel);
  border-right: 1px solid var(--lsd-borde);
  overflow-y: auto; padding: 8px 0 10px;
}
.lsd-menu-grupo {
  font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--lsd-t3); padding: 10px 12px 4px;
}
.lsd-menu-item {
  display: flex; align-items: center; gap: 9px; width: 100%;
  /* 28 px de alto contra los 41 de hoy: los 18 módulos caben en 900 px de alto
     sin que el propio menú tenga que scrollear. */
  height: 28px; padding: 0 12px 0 9px;
  border: 0; background: none; cursor: pointer; text-align: left;
  font-size: var(--lsd-apoyo); color: var(--lsd-t2);
  border-left: 3px solid transparent;
}
.lsd-menu-item:hover { background: var(--lsd-lienzo); color: var(--lsd-t1); }
/* «Dónde estoy» se dice con TRES canales y los tres tienen que verse. El filo va
   en --lsd-marca-texto, no en --lsd-marca: 3 px de #FF6600 sobre el fondo lavado
   dan 2,38:1 y no llegan al 3:1 de WCAG 1.4.11; #A84300 sobre ese mismo fondo da
   4,90, igual que la etiqueta. El fondo lavado se queda, pero como decoración: a
   1,24:1 contra el papel del menú no es un canal, y por eso no se cuenta como
   tal. Los canales medidos son el filo, el color de la etiqueta y la negrita. */
.lsd-menu-item[data-activo="si"] {
  background: var(--lsd-lavado); color: var(--lsd-marca-texto); font-weight: 600;
  border-left-color: var(--lsd-marca-texto);
}
/* El icono NO va en naranja. En la rejilla de hoy hay 18 iconos naranjas
   idénticos: es la prueba más clara de que el acento dejó de significar nada. */
.lsd-menu-item svg { flex: 0 0 auto; opacity: 0.85; }
.lsd-menu-item[data-activo="si"] svg { opacity: 1; }
.lsd-menu-texto { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lsd-menu-cuenta {
  margin-left: auto; min-width: 18px; height: 16px; padding: 0 5px; border-radius: 8px;
  background: var(--lsd-marca); color: var(--lsd-sobre-marca);
  font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center;
  font-variant-numeric: tabular-nums;
}

/* min-w-0 en la cadena: sin esto una tabla de doce columnas estira el panel y
   arrastra la página entera en horizontal, menú incluido. */
.lsd-pantalla {
  flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column;
  padding: 14px 16px; gap: 10px; overflow: hidden;
}

/* --- Cabecera de pantalla: título e indicadores en la MISMA banda ---
   Hoy son dos bloques: 76-79 px de título + 69,5 px de indicadores. */
.lsd-cabecera {
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  flex: 0 0 auto; min-height: 40px;
}
.lsd-cabecera-txt { min-width: 0; }
.lsd-cabecera-sub { font-size: var(--lsd-apoyo); color: var(--lsd-t3); margin: 1px 0 0; }
.lsd-cabecera-fin { margin-left: auto; display: flex; align-items: center; gap: 8px; }

/* --- Indicadores en línea, sin tarjeta: el dato pesa, el envoltorio no --- */
.lsd-kpis { display: flex; align-items: stretch; gap: 0; flex-wrap: wrap; }
.lsd-kpi { padding: 0 16px; border-left: 1px solid var(--lsd-borde); line-height: 1.25; }
.lsd-kpi:first-child { border-left: 0; padding-left: 0; }
.lsd-kpi-et { font-size: var(--lsd-etiqueta); font-weight: 600; text-transform: uppercase; letter-spacing: 0.045em; color: var(--lsd-t3); }
.lsd-kpi-val { font-size: var(--lsd-cifra); font-weight: 600; font-variant-numeric: tabular-nums; color: var(--lsd-t1); }
.lsd-kpi-pie { font-size: var(--lsd-apoyo); color: var(--lsd-t2); font-variant-numeric: tabular-nums; }
/* Un solo indicador puede llevar el acento, y solo si pide acción hoy. */
.lsd-kpi[data-acento="si"] .lsd-kpi-val { color: var(--lsd-marca-texto); }

/* ================================================================
   4. CONTROLES
   ================================================================ */

.lsd-btn {
  height: 30px; padding: 0 11px; border-radius: 7px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  font-size: var(--lsd-apoyo); font-weight: 500; white-space: nowrap;
  border: 1px solid var(--lsd-borde); background: var(--lsd-papel); color: var(--lsd-t2);
}
.lsd-btn:hover { background: var(--lsd-lienzo); color: var(--lsd-t1); border-color: var(--lsd-t3); }
.lsd-btn:disabled { opacity: 0.45; cursor: not-allowed; }

/* EL botón de la pantalla. Uno. Relleno #FF6600 con etiqueta OSCURA: el naranja
   de marca a plena saturación no admite texto blanco (2,94:1) y sí texto
   oscuro (6,26:1). Es el mismo botón en claro y en oscuro. */
.lsd-btn[data-tipo="primario"] {
  background: var(--lsd-marca); border-color: var(--lsd-marca);
  color: var(--lsd-sobre-marca); font-weight: 600;
}
.lsd-btn[data-tipo="primario"]:hover { background: #F25E00; border-color: #F25E00; color: var(--lsd-sobre-marca); }
.lsd-btn[data-tipo="peligro"] { color: var(--lsd-error); border-color: var(--lsd-error-bd); background: var(--lsd-error-bg); }

.lsd-icono-btn {
  width: 26px; height: 26px; border-radius: 6px; border: 1px solid transparent;
  background: none; color: var(--lsd-t3); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.lsd-icono-btn:hover { background: var(--lsd-lienzo); color: var(--lsd-t1); border-color: var(--lsd-borde); }

.lsd-chip {
  height: 26px; padding: 0 9px; border-radius: 13px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
  font-size: var(--lsd-apoyo); font-weight: 500;
  border: 1px solid var(--lsd-borde); background: var(--lsd-papel); color: var(--lsd-t2);
}
.lsd-chip:hover { border-color: var(--lsd-t3); color: var(--lsd-t1); }
/* Un filtro encendido NO es naranja: el naranja está reservado a lo que pide
   acción, y un filtro es un estado tuyo, no un aviso. Va en tinta llena. */
.lsd-chip[data-on="si"] { background: var(--lsd-t1); border-color: var(--lsd-t1); color: var(--lsd-papel); font-weight: 600; }
.lsd-chip-n { font-variant-numeric: tabular-nums; opacity: 0.75; }

.lsd-campo {
  width: 100%; height: 30px; padding: 0 9px; border-radius: 7px;
  border: 1px solid var(--lsd-borde); background: var(--lsd-papel); color: var(--lsd-t1);
  font-size: var(--lsd-cuerpo); outline: none;
}
.lsd-campo::placeholder { color: var(--lsd-t3); opacity: 1; }
.lsd-campo:hover { border-color: var(--lsd-t3); }
/* El campo enfocado usa --lsd-marca-texto, no --lsd-marca. Es la misma regla que
   ya gobierna toda la propuesta —#FF6600 solo como RELLENO— aplicada al sitio
   donde estaba sin aplicar: #FF6600 da 2,94:1 sobre papel y 2,54 sobre lienzo, o
   sea que el aviso de foco no llegaba al 3:1 que pide WCAG 1.4.11 justo en el
   tema que esta propuesta declara principal. #A84300 da 6,06 y 5,24.
   Y se va el halo de 3 px de --lsd-lavado: #FFE2CC contra papel blanco es
   1,24:1, o sea que no se veía. Quedan dos canales y los dos medidos: el borde
   de 1 px y el anillo de 2 px de :focus-visible, los dos del mismo color. */
.lsd-campo:focus { border-color: var(--lsd-marca-texto); }
.lsd-campo[data-num="si"] { text-align: right; font-variant-numeric: tabular-nums; }
select.lsd-campo { cursor: pointer; }

/* El foco es siempre el mismo y siempre naranja: es el único sitio donde el
   acento no compite con nada. Va en --lsd-marca-texto y no en --lsd-marca porque
   un anillo de 2 px es un GRÁFICO fino, no un relleno: el umbral que le aplica es
   el 3:1 de WCAG 1.4.11 y #FF6600 no lo pasa sobre claro (2,94 sobre papel, 2,54
   sobre lienzo). En claro #A84300 da 6,06 / 5,24 / 4,90 según la superficie; en
   oscuro #FF9552 da entre 6,56 y 8,67. */
.lsd-raiz :focus-visible { outline: 2px solid var(--lsd-marca-texto); outline-offset: 1px; border-radius: 4px; }

/* ================================================================
   5. SUPERFICIES — se separan por TONO Y BORDE, nunca por sombra
   ================================================================ */

.lsd-caja {
  background: var(--lsd-papel); border: 1px solid var(--lsd-borde);
  border-radius: 10px; min-width: 0;
}
.lsd-caja-cab {
  display: flex; align-items: baseline; gap: 8px; padding: 9px 12px;
  border-bottom: 1px solid var(--lsd-regla);
}
.lsd-caja-tit { font-size: var(--lsd-cuerpo); font-weight: 600; color: var(--lsd-t1); margin: 0; }
.lsd-caja-hint { font-size: var(--lsd-apoyo); color: var(--lsd-t3); }
.lsd-caja-cpo { padding: 12px; }

.lsd-nota {
  font-size: var(--lsd-apoyo); color: var(--lsd-t2); line-height: 1.5; margin: 5px 0 0;
}
.lsd-aviso-caja, .lsd-error-caja, .lsd-info-caja, .lsd-ok-caja {
  border-radius: 8px; border: 1px solid; padding: 8px 10px;
  font-size: var(--lsd-apoyo); line-height: 1.5; white-space: pre-line;
}
.lsd-aviso-caja { background: var(--lsd-aviso-bg); border-color: var(--lsd-aviso-bd); color: var(--lsd-aviso); }
.lsd-error-caja { background: var(--lsd-error-bg); border-color: var(--lsd-error-bd); color: var(--lsd-error); }
.lsd-ok-caja    { background: var(--lsd-ok-bg);    border-color: var(--lsd-ok-bd);    color: var(--lsd-ok); }
.lsd-info-caja  { background: var(--lsd-info-bg);  border-color: var(--lsd-borde);    color: var(--lsd-t2); }
.lsd-aviso-caja strong, .lsd-error-caja strong, .lsd-info-caja strong { font-weight: 600; }

/* ================================================================
   6. LA TABLA
   ================================================================
   Aquí es donde claro y oscuro NO pueden ser el mismo diseño:

   · En CLARO una regla oscura RESTA luz y el ojo la ve enseguida. Con
     ΔL* 10,9 ya es una línea firme; si además se raya el fondo, la tabla se
     convierte en pana. Por eso en claro: reglas sí, rayado NO.
   · En OSCURO una regla clara SUMA luz y se pierde: la misma separación
     percibida exige subir a ΔL* 6 y aun así queda floja. Por eso en oscuro:
     reglas más el rayado al 2 %, que ahí sí ayuda a seguir la fila.
   · En los dos modos, una regla más marcada CADA CINCO FILAS. Da anclas al
     ojo para recorrer miles de líneas sin el ruido del rayado.
*/

.lsd-tabla-caja {
  flex: 1; min-height: 0; min-width: 0; overflow: auto;
  border: 1px solid var(--lsd-borde); border-radius: 10px; background: var(--lsd-papel);
}
.lsd-tabla { border-collapse: separate; border-spacing: 0; min-width: max-content; font-size: var(--lsd-cuerpo); }

.lsd-tabla thead th {
  position: sticky; top: 0; z-index: 20;
  background: var(--lsd-papel2); color: var(--lsd-t3);
  font-size: var(--lsd-etiqueta); font-weight: 600; text-transform: uppercase; letter-spacing: 0.045em;
  text-align: left; white-space: nowrap; padding: 7px 10px; height: 30px;
  border-bottom: 1px solid var(--lsd-borde);
}
.lsd-tabla thead th[data-fija="si"] { left: 0; z-index: 30; border-right: 1px solid var(--lsd-borde); }
.lsd-tabla th[data-der="si"], .lsd-tabla td[data-der="si"] { text-align: right; }

.lsd-tabla tbody td {
  padding: 0 10px; height: var(--lsd-fila-celda);
  border-bottom: 1px solid var(--lsd-regla);
  color: var(--lsd-t1); vertical-align: middle; white-space: nowrap;
}
.lsd-tabla tbody td[data-2="si"] { color: var(--lsd-t2); }
.lsd-tabla tbody td[data-3="si"] { color: var(--lsd-t3); }

/* La regla de cada cinco filas */
.lsd-tabla tbody tr:nth-child(5n) td { border-bottom-color: var(--lsd-regla5); }

/* Rayado: SOLO en oscuro */
.lsd-raiz[data-modo="oscuro"] .lsd-tabla tbody tr:nth-child(even) td { background: var(--lsd-papel2); }

.lsd-tabla tbody tr:hover td { background: var(--lsd-papel2); }
.lsd-raiz[data-modo="oscuro"] .lsd-tabla tbody tr:hover td { background: #2A2620; }

/* Celda congelada: fondo OPACO obligatorio. Una celda translúcida que se queda
   quieta deja ver el texto de las demás columnas cruzándola. */
.lsd-tabla tbody td[data-fija="si"] {
  position: sticky; left: 0; z-index: 10;
  background: var(--lsd-papel); border-right: 1px solid var(--lsd-borde);
  font-weight: 500; padding-left: 0;
}
.lsd-raiz[data-modo="oscuro"] .lsd-tabla tbody tr:nth-child(even) td[data-fija="si"] { background: var(--lsd-papel2); }
.lsd-tabla tbody tr:hover td[data-fija="si"] { background: var(--lsd-papel2); }
.lsd-raiz[data-modo="oscuro"] .lsd-tabla tbody tr:hover td[data-fija="si"] { background: #2A2620; }

/* Fila seleccionada. NO se tiñe de naranja: hoy el naranja de la fila elegida
   compite con el naranja de «En seguimiento» y con el del chip de filtro. Aquí
   es un tono neutro más el nombre en naranja de texto. */
.lsd-tabla tbody tr[data-sel="si"] td,
.lsd-tabla tbody tr[data-sel="si"]:hover td { background: var(--lsd-selec); }
.lsd-tabla tbody tr[data-sel="si"] td[data-fija="si"] { color: var(--lsd-marca-texto); font-weight: 600; }

/* El raíl de estado: 3 px pegados al borde izquierdo de la fila. Se lleva el
   color aprendido del Excel y deja de teñir la fila entera. */
.lsd-rail { display: flex; align-items: center; gap: 8px; height: var(--lsd-fila-celda); padding-right: 10px; }
.lsd-rail-b { width: 3px; align-self: stretch; flex: 0 0 3px; background: var(--lsd-est-rail, transparent); }
/* «Sin contactar» no lleva raíl: todavía no ha pasado nada, y no pintar es la
   forma más honesta de decirlo. Las otras seis sí, con el color del Excel. */
.lsd-rail-b[data-vacio="si"] { background: transparent; }
.lsd-rail-txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* El botón que selecciona la fila desde el teclado. Se ve igual que el texto que
   sustituye: hereda tipo, color y peso, y solo se distingue al enfocarlo. */
.lsd-sel-fila { border: 0; background: none; padding: 0; cursor: pointer; font: inherit; color: inherit; text-align: left; }

/* Pie de tabla: paginación incremental, como hoy. Nada de virtualización: Ctrl+F,
   el scroll y la impresión se comportan igual en todas las tablas del ERP. */
.lsd-tabla-pie {
  flex: 0 0 auto; height: 34px; display: flex; align-items: center; gap: 10px;
  font-size: var(--lsd-apoyo); color: var(--lsd-t2);
}

/* --- Celda editable: no parece un campo hasta que pasas por encima ---
   Es lo único que impide que doce columnas editables se lean como un
   formulario. Se conserva tal cual del ERP de hoy. */
.lsd-celda {
  width: 100%; height: 26px; padding: 0 7px; border-radius: 5px;
  border: 1px solid transparent; background: transparent; color: var(--lsd-t1);
  font-size: var(--lsd-cuerpo); text-align: left; outline: none; cursor: text;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lsd-celda[data-vacia="si"] { color: var(--lsd-t3); }
.lsd-celda:hover:not(:disabled) { background: var(--lsd-lienzo); border-color: var(--lsd-borde); }
.lsd-raiz[data-modo="oscuro"] .lsd-celda:hover:not(:disabled) { background: #2E2A24; }
/* Mismo criterio que .lsd-campo:focus: el filo pasa a --lsd-marca-texto y se
   retira el halo de --lsd-lavado, que sobre papel blanco era 1,24:1. El fondo
   opaco se queda: es lo que despega la celda en edición del tinte de su fila. */
.lsd-celda:focus { background: var(--lsd-papel); border-color: var(--lsd-marca-texto); }
.lsd-celda:disabled { cursor: default; }
.lsd-celda[data-num="si"] { text-align: right; font-variant-numeric: tabular-nums; }

/* ================================================================
   7. ESTADOS — forma + palabra + color, en ese orden
   ================================================================
   El color es el TERCER canal, nunca el único. Cada estado tiene su icono
   (forma distinta) y su palabra en español. Con el interruptor «sin color» de
   la barra se ve que la tabla se sigue leyendo entera en escala de grises.
*/

.lsd-estado {
  display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
  font-size: var(--lsd-apoyo); font-weight: 500; color: var(--lsd-est, var(--lsd-t2));
}
.lsd-estado svg { flex: 0 0 auto; }

.lsd-pastilla {
  display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;
  height: 20px; padding: 0 8px 0 6px; border-radius: 10px;
  font-size: var(--lsd-etiqueta); font-weight: 600;
  border: 1px solid var(--lsd-est-bd, var(--lsd-borde));
  background: var(--lsd-est-bg, var(--lsd-info-bg));
  color: var(--lsd-est, var(--lsd-t2));
}

/* LA DEMOSTRACIÓN DEL CRITERIO 5.
   Se pinta en gris la pantalla ENTERA, no solo los iconos: greyscale a medias
   es hacerse trampas al solitario, porque deja el texto del estado en color y
   ese es justo el canal que se está poniendo a prueba. Si con esto puesto se
   sigue sabiendo qué es cada fila, el color no era el único canal.
   La clase .lsd-sincolor se queda como marca de «esto lleva color con
   significado», que es lo que hay que revisar cuando se toque la paleta. */
.lsd-raiz[data-sincolor="si"] { filter: grayscale(1); }

/* --- Los siete estados de Cold Calling ---
   En OSCURO el raíl usa el hue CRUDO del Excel: los siete pasan de 3:1 sobre
   el papel oscuro, así que el código de color aprendido se conserva entero.
   En CLARO no se puede: los mismos tonos sobre papel dan 1,92:1 el amarillo,
   2,28:1 el verde y 2,43:1 el cian. Se baja la luminosidad conservando el tono
   —el hue no se mueve más de 7°— hasta pasar de 3:1. Es la misma pelea que ya
   tiene hoy globals.css con el ámbar, resuelta para los siete de golpe. */

.lsd-raiz[data-modo="claro"] .lsd-e-pendiente        { --lsd-est: #4E5560; --lsd-est-rail: #6B7280; --lsd-est-bg: #EDEEF0; --lsd-est-bd: #CFD3D9; }
.lsd-raiz[data-modo="claro"] .lsd-e-no_contesta      { --lsd-est: #7E5C00; --lsd-est-rail: #A87C00; --lsd-est-bg: #FCF1D2; --lsd-est-bd: #E3CE8E; }
.lsd-raiz[data-modo="claro"] .lsd-e-programado       { --lsd-est: #04606F; --lsd-est-rail: #0A7F96; --lsd-est-bg: #DCF0F5; --lsd-est-bd: #9CCEDA; }
.lsd-raiz[data-modo="claro"] .lsd-e-email_enviado    { --lsd-est: #8E1BA0; --lsd-est-rail: #B02BC6; --lsd-est-bg: #F8E4FB; --lsd-est-bd: #DFAFE8; }
.lsd-raiz[data-modo="claro"] .lsd-e-seguimiento      { --lsd-est: #94400A; --lsd-est-rail: #C05000; --lsd-est-bg: #FCE8D8; --lsd-est-bd: #E7BB94; }
.lsd-raiz[data-modo="claro"] .lsd-e-cita_cualificada { --lsd-est: #0E6B39; --lsd-est-rail: #12874A; --lsd-est-bg: #DCF2E5; --lsd-est-bd: #A0D5BA; }
.lsd-raiz[data-modo="claro"] .lsd-e-no_interesa      { --lsd-est: #AB211A; --lsd-est-rail: #CE2A22; --lsd-est-bg: #FCE3E1; --lsd-est-bd: #EEB0AB; }

.lsd-raiz[data-modo="oscuro"] .lsd-e-pendiente        { --lsd-est: #A9B0BC; --lsd-est-rail: #6B7280; --lsd-est-bg: #23262B; --lsd-est-bd: #3C4149; }
.lsd-raiz[data-modo="oscuro"] .lsd-e-no_contesta      { --lsd-est: #F2C33C; --lsd-est-rail: #EAB308; --lsd-est-bg: #2E2508; --lsd-est-bd: #5C4A12; }
.lsd-raiz[data-modo="oscuro"] .lsd-e-programado       { --lsd-est: #3FD6EE; --lsd-est-rail: #06B6D4; --lsd-est-bg: #0C2A31; --lsd-est-bd: #17545F; }
.lsd-raiz[data-modo="oscuro"] .lsd-e-email_enviado    { --lsd-est: #EE8CF7; --lsd-est-rail: #D946EF; --lsd-est-bg: #2C1030; --lsd-est-bd: #57215E; }
.lsd-raiz[data-modo="oscuro"] .lsd-e-seguimiento      { --lsd-est: #FFA05C; --lsd-est-rail: #F97316; --lsd-est-bg: #331C0A; --lsd-est-bd: #63381A; }
.lsd-raiz[data-modo="oscuro"] .lsd-e-cita_cualificada { --lsd-est: #54DC91; --lsd-est-rail: #22C55E; --lsd-est-bg: #132A1E; --lsd-est-bd: #245C3C; }
.lsd-raiz[data-modo="oscuro"] .lsd-e-no_interesa      { --lsd-est: #FF9089; --lsd-est-rail: #EF4444; --lsd-est-bg: #33191A; --lsd-est-bd: #6B2B28; }

/* --- Los cinco estados de una ejecución de stock ---
   «simulacro» comparte el gris de «sin cambios» A PROPÓSITO: es el estado de
   un cliente que NO está mandando nada, y pintarlo de «todo bien» es cómo se
   pasan tres semanas creyendo que la automatización está en marcha. Lo que
   hoy NO tiene es forma propia: aquí el icono los separa —una raya contra un
   matraz— sin tocar el color. */
.lsd-raiz[data-modo="claro"] .lsd-r-sin_cambios { --lsd-est: #4E5560; --lsd-est-bg: #EDEEF0; --lsd-est-bd: #CFD3D9; }
.lsd-raiz[data-modo="claro"] .lsd-r-simulacro   { --lsd-est: #4E5560; --lsd-est-bg: #EDEEF0; --lsd-est-bd: #CFD3D9; }
.lsd-raiz[data-modo="claro"] .lsd-r-frenado     { --lsd-est: #7E5C00; --lsd-est-bg: #FFF3D6; --lsd-est-bd: #E7CF95; }
.lsd-raiz[data-modo="claro"] .lsd-r-enviado     { --lsd-est: #0E6B39; --lsd-est-bg: #DCF2E5; --lsd-est-bd: #A8D8BE; }
.lsd-raiz[data-modo="claro"] .lsd-r-error       { --lsd-est: #AB211A; --lsd-est-bg: #FDE4E1; --lsd-est-bd: #EFB3AD; }

.lsd-raiz[data-modo="oscuro"] .lsd-r-sin_cambios { --lsd-est: #A9B0BC; --lsd-est-bg: #23262B; --lsd-est-bd: #3C4149; }
.lsd-raiz[data-modo="oscuro"] .lsd-r-simulacro   { --lsd-est: #A9B0BC; --lsd-est-bg: #23262B; --lsd-est-bd: #3C4149; }
.lsd-raiz[data-modo="oscuro"] .lsd-r-frenado     { --lsd-est: #F2C33C; --lsd-est-bg: #2E2508; --lsd-est-bd: #5C4A12; }
.lsd-raiz[data-modo="oscuro"] .lsd-r-enviado     { --lsd-est: #54DC91; --lsd-est-bg: #132A1E; --lsd-est-bd: #245C3C; }
.lsd-raiz[data-modo="oscuro"] .lsd-r-error       { --lsd-est: #FF9089; --lsd-est-bg: #33191A; --lsd-est-bd: #6B2B28; }

/* ================================================================
   8. INICIO — un directorio silencioso bajo lo que está vivo hoy
   ================================================================ */

.lsd-inicio { overflow: auto; display: flex; flex-direction: column; gap: 14px; min-height: 0; }

.lsd-hoy { display: flex; gap: 10px; flex-wrap: wrap; }
.lsd-hoy-t {
  flex: 1 1 190px; min-width: 175px; background: var(--lsd-papel);
  border: 1px solid var(--lsd-borde); border-radius: 10px; padding: 9px 11px;
  display: flex; align-items: center; gap: 10px; text-align: left; cursor: pointer;
}
.lsd-hoy-t:hover { border-color: var(--lsd-t3); }
/* SOLO la tarjeta que pide acción hoy lleva el acento, y lo lleva en el borde
   izquierdo, no en el icono. */
.lsd-hoy-t[data-urge="si"] { border-left: 3px solid var(--lsd-marca-texto); padding-left: 9px; }
.lsd-hoy-ico {
  width: 30px; height: 30px; border-radius: 8px; flex: 0 0 30px;
  display: flex; align-items: center; justify-content: center;
  background: var(--lsd-lienzo); color: var(--lsd-t2); border: 1px solid var(--lsd-borde);
}
.lsd-hoy-t[data-urge="si"] .lsd-hoy-ico { background: var(--lsd-lavado); color: var(--lsd-marca-texto); border-color: transparent; }

.lsd-secciones { display: flex; flex-direction: column; gap: 12px; }
.lsd-seccion-tit {
  display: flex; align-items: center; gap: 9px; margin-bottom: 6px;
  font-size: var(--lsd-etiqueta); font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.045em; color: var(--lsd-t3);
}
.lsd-seccion-tit::after { content: ''; flex: 1; height: 1px; background: var(--lsd-borde); }

.lsd-apps { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 4px 10px; }
.lsd-app {
  display: flex; align-items: center; gap: 9px; padding: 0 9px;
  /* 38 px por aplicación contra los 202 px de la tarjeta de hoy. */
  height: 38px; border-radius: 8px; border: 1px solid transparent;
  background: none; cursor: pointer; text-align: left; width: 100%; min-width: 0;
}
.lsd-app:hover { background: var(--lsd-papel); border-color: var(--lsd-borde); }
.lsd-app-ico { flex: 0 0 auto; color: var(--lsd-t2); }
.lsd-app:hover .lsd-app-ico { color: var(--lsd-marca-texto); }
.lsd-app-txt { min-width: 0; flex: 1; display: block; }
.lsd-app-n { display: block; font-size: var(--lsd-cuerpo); font-weight: 500; color: var(--lsd-t1); line-height: 1.2;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lsd-app-d { display: block; font-size: var(--lsd-apoyo); color: var(--lsd-t3); line-height: 1.25;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lsd-app-solo {
  flex: 0 0 auto; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--lsd-t3); border: 1px solid var(--lsd-borde); border-radius: 4px; padding: 0 4px;
  line-height: 15px;
}

/* ================================================================
   9. PERFIL — formulario largo sin botón de guardar
   ================================================================ */

.lsd-perfil { display: flex; gap: 14px; min-height: 0; flex: 1; overflow: hidden; }
.lsd-indice { width: 190px; flex: 0 0 190px; overflow: auto; }
.lsd-indice-i {
  display: flex; align-items: center; gap: 8px; width: 100%; height: 27px; padding: 0 9px;
  border: 0; border-left: 2px solid transparent; background: none; cursor: pointer;
  font-size: var(--lsd-apoyo); color: var(--lsd-t2); text-align: left;
}
.lsd-indice-i:hover { background: var(--lsd-papel); color: var(--lsd-t1); }
.lsd-indice-i[data-activo="si"] { border-left-color: var(--lsd-marca-texto); color: var(--lsd-t1); font-weight: 600; background: var(--lsd-papel); }
.lsd-indice-n { margin-left: auto; font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums; }

.lsd-form { flex: 1; min-width: 0; overflow: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 2px; }
/* align-items: start — sin esto, la rejilla estira cada caja hasta la más alta
   de su fila y una casilla sin nota se queda con un palmo de hueco debajo. En
   una pantalla de ~50 campos eso son cientos de píxeles de nada.
   (Ojo: en este fichero no puede haber acentos graves. Todo el CSS vive dentro
   de una plantilla de cadena y un acento grave la corta en seco.) */
.lsd-rejilla { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px 14px; align-items: start; }
.lsd-etiq { display: block; font-size: var(--lsd-apoyo); font-weight: 500; color: var(--lsd-t2); margin-bottom: 3px; }

/* «Guardado» por campo: no hay botón de guardar, así que la confirmación tiene
   que ser visible o nadie sabe si lo que tecleó llegó a escribirse. */
/* 12 px y no 10: esta es la ÚNICA confirmación de escritura que tiene un
   formulario sin botón de guardar. Escribirla con la letra más pequeña de la
   pantalla es contradecir para qué está. Cuesta 2 px de alto en una vista que no
   declara la vertical como restricción. */
.lsd-guardado {
  display: inline-flex; align-items: center; gap: 4px; margin-left: 6px;
  font-size: 12px; font-weight: 600; color: var(--lsd-ok);
}

/* Un freno PUESTO o APAGADO: escudo lleno contra escudo partido, más la
   palabra. Hoy la única diferencia es un marcador de posición gris. */
.lsd-freno { border: 1px solid var(--lsd-borde); border-radius: 8px; padding: 9px 10px; background: var(--lsd-papel); }
.lsd-freno[data-off="si"] { border-style: dashed; background: var(--lsd-lienzo); }
.lsd-freno-cab { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.lsd-freno-et { font-size: var(--lsd-apoyo); font-weight: 500; color: var(--lsd-t2); flex: 1; min-width: 0; }
/* ENCENDIDO / APAGADO decide si a un cliente se le vacía el inventario. Iba a
   10 px y en versales, que es la forma más lenta de leer una palabra y encima el
   texto más pequeño de la pantalla. Sube a 12 px y se le quita el uppercase: la
   palabra sigue siendo la misma y ahora se lee de un vistazo. El grosor 700 se
   queda, que es lo que la separa de la etiqueta de al lado. */
.lsd-freno-est {
  display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto;
  font-size: 12px; font-weight: 700; letter-spacing: 0.01em;
  color: var(--lsd-t3);
}
.lsd-freno[data-off="no"] .lsd-freno-est { color: var(--lsd-ok); }

/* Los alias son una LISTA, y hoy se editan como una cadena con comas. */
.lsd-alias { display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
  border: 1px solid var(--lsd-borde); border-radius: 7px; padding: 4px 5px; background: var(--lsd-papel); min-height: 30px; }
.lsd-alias-c {
  display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 4px 0 7px;
  border-radius: 4px; background: var(--lsd-lienzo); border: 1px solid var(--lsd-borde);
  font-size: var(--lsd-apoyo); color: var(--lsd-t1); font-variant-numeric: tabular-nums;
}
.lsd-alias-x { border: 0; background: none; cursor: pointer; color: var(--lsd-t3); display: flex; padding: 0; }
.lsd-alias-x:hover { color: var(--lsd-error); }
.lsd-alias-in { flex: 1; min-width: 70px; border: 0; background: none; outline: none; font-size: var(--lsd-cuerpo); height: 20px; }
.lsd-alias-in::placeholder { color: var(--lsd-t3); }

/* ================================================================
   10. LA BARRA DE LA PROPUESTA (no es parte del diseño; es el mando)
   ================================================================ */
.lsd-mando {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 12px; background: var(--lsd-papel2); border-bottom: 1px solid var(--lsd-borde);
}
.lsd-mando-et { font-size: var(--lsd-etiqueta); font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.045em; color: var(--lsd-t3); }
.lsd-mando-sep { width: 1px; height: 20px; background: var(--lsd-borde); }

.lsd-ficha { overflow: auto; padding: 4px 2px 16px; display: flex; flex-direction: column; gap: 14px; }
.lsd-ficha table { border-collapse: collapse; width: 100%; font-size: var(--lsd-apoyo); }
.lsd-ficha th { text-align: left; font-size: var(--lsd-etiqueta); font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.045em; color: var(--lsd-t3); padding: 6px 10px; border-bottom: 1px solid var(--lsd-borde); }
.lsd-ficha td { padding: 6px 10px; border-bottom: 1px solid var(--lsd-regla); color: var(--lsd-t2); vertical-align: top; }
.lsd-ficha td:first-child { color: var(--lsd-t1); }
.lsd-ficha .lsd-ok-t { color: var(--lsd-ok); font-weight: 600; }
.lsd-ficha .lsd-mal-t { color: var(--lsd-error); font-weight: 600; }
.lsd-muestra { display: inline-block; width: 11px; height: 11px; border-radius: 3px;
  border: 1px solid var(--lsd-borde); vertical-align: -1px; margin-right: 6px; }

@media (max-width: 900px) {
  .lsd-menu { display: none; }
  .lsd-indice { display: none; }
  .lsd-perfil { flex-direction: column; }
}
`
