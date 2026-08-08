/**
 * PROPUESTA «DENSO Y SOBRIO» — la hoja de estilo.
 *
 * Todo lo de aquí vive bajo el prefijo `.dz-` y bajo `.dz-raiz`, y se inyecta
 * en un `<style>` desde Marco.tsx. NO se toca app/globals.css, ni el layout, ni
 * ningún componente del ERP: hay dos propuestas más construyéndose a la vez y
 * cualquier cosa global las pisaría.
 *
 * Tres cosas que este fichero hace a propósito y conviene no deshacer:
 *
 * 1. NEUTRALIZA EL CSS GLOBAL DEL ERP DENTRO DE SU RAÍZ. globals.css declara
 *    `* { transition-property: ... transform, filter, backdrop-filter; 200ms }`
 *    más `a { transition: all .3s }` y `button { transition: all .3s }`. En una
 *    tabla de treinta filas eso son treinta filas animando `filter` a cada
 *    movimiento del ratón. Aquí se apaga todo y se vuelve a encender solo lo
 *    que se ha decidido: color de fondo y de borde, 90 ms.
 *
 * 2. TAPA EL FONDO ANIMADO. `body::before` es un elemento fijo a pantalla
 *    completa con `blur(120px)` y una animación infinita de 25 s. Sube el suelo
 *    de la página de #080808 a #231207 en los picos, así que dos celdas
 *    idénticas no tienen el mismo contraste según dónde caigan ni a qué
 *    segundo. `.dz-raiz` es opaca y se pone encima: los ratios de más abajo son
 *    los que se ven, no una aproximación.
 *
 * 3. NO USA LA ESCALA DE RADIOS DE tailwind.config.ts, que está rota:
 *    `rounded-lg` son 24 px y `rounded-xl` 12, así que los 242 usos de
 *    `rounded-lg` del ERP pintan esquinas del doble de lo que esperaba quien
 *    las escribió. Aquí hay tres radios y son monótonos: 4 · 6 · 10.
 */

export const ESTILOS_DENSO = `
/* ==================================================================
   1. TEMA OSCURO — el principal de esta dirección
   ================================================================== */
.dz-raiz{
  /* Superficies. Fondo neutro frío, nunca negro puro: el negro puro contra
     texto casi blanco es el par de más halo, y aquí se miran ocho horas. */
  --dz-fondo:#0F1114;      /* la página */
  --dz-sup:#15171B;        /* la tabla, la tarjeta, el panel */
  --dz-sup2:#1A1D22;       /* elevación: cabecera de tabla, columna congelada, barra lateral */
  --dz-hover:#1F232A;      /* la fila bajo el ratón */
  --dz-sel:#2A1F14;        /* la fila en la que estás */
  --dz-linea:#262A31;      /* el separador de siempre */
  --dz-linea2:#343941;     /* el separador que sí tiene que verse */

  /* Texto. CUATRO niveles. Ni uno más. */
  --dz-t1:#F4F5F7;         /* el dato */
  --dz-t2:#CBD0D8;         /* el dato de al lado */
  --dz-t3:#A2A9B4;         /* el contexto */
  --dz-t4:#8A929E;         /* el rótulo */

  /* Marca. En oscuro el naranja de siempre sirve tal cual: 6,11:1. */
  --dz-acc:#FF6600;        /* naranja de TEXTO y de línea */
  --dz-acc-graf:#FF6600;   /* naranja de barra, raíl y foco */
  --dz-acc-relleno:#FF6600;/* naranja de RELLENO del botón primario */
  --dz-acc-tinta:#14161A;  /* lo que se escribe encima de ese relleno */
  --dz-acc-borde:transparent;
  --dz-acc-suave:rgba(255,102,0,0.14);

  /* Estados. Los mismos tonos del Excel, subidos hasta pasar 4,5:1.
     El color es el TERCER canal: primero va el glifo, segundo la palabra. */
  --dz-e-gris:#9AA2AE;
  --dz-e-ama:#E0B341;
  --dz-e-cian:#3AC8DE;
  --dz-e-mag:#E879F9;
  --dz-e-nar:#FB923C;
  --dz-e-verde:#4ADE80;
  --dz-e-rojo:#F87171;

  /* Ritmo. Una sola fuente de verdad para la densidad. */
  --dz-fila:28px;
  --dz-cabecera:26px;
  --dz-r1:4px; --dz-r2:6px; --dz-r3:10px;

  color-scheme:dark;
  background:var(--dz-fondo);
  color:var(--dz-t2);
  font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  font-size:12.5px;
  line-height:1.45;
  -webkit-font-smoothing:antialiased;
  font-feature-settings:'cv05' 1,'ss03' 1;
  position:relative;
  z-index:1;
  isolation:isolate;
}

/* ==================================================================
   2. TEMA CLARO — diseñado, no traducido
   ==================================================================
   No es una inversión del oscuro. Los grises de texto son otros valores
   elegidos uno a uno, y el naranja cambia de papel: como RELLENO sigue
   siendo #FF6600 exacto (con tinta oscura encima, 6,17:1), y solo cuando
   hace de TEXTO baja a #B84900, porque #FF6600 sobre blanco da 2,94:1 y no
   pasa ni el umbral de texto grande.
   ================================================================== */
.dz-raiz[data-dz-tema="claro"]{
  --dz-fondo:#F3F4F6;
  --dz-sup:#FFFFFF;
  --dz-sup2:#F7F8FA;
  --dz-hover:#EFF1F4;
  --dz-sel:#FFF1E5;
  --dz-linea:#E3E6EA;
  --dz-linea2:#CDD2D9;

  --dz-t1:#14161A;
  --dz-t2:#383E48;
  --dz-t3:#525A67;
  --dz-t4:#666D79;

  --dz-acc:#B84900;
  --dz-acc-graf:#D25400;
  --dz-acc-relleno:#FF6600;
  --dz-acc-tinta:#14161A;
  --dz-acc-borde:#D25400;   /* el relleno naranja sobre blanco da 2,94:1 de
                               borde: sin este filo el botón no se recorta */
  --dz-acc-suave:rgba(210,84,0,0.10);

  --dz-e-gris:#5B6270;
  --dz-e-ama:#7A5A00;
  --dz-e-cian:#0E6E80;
  --dz-e-mag:#A21CAF;
  --dz-e-nar:#9A4A00;
  --dz-e-verde:#116B36;
  --dz-e-rojo:#B3261E;

  color-scheme:light;
}

/* ==================================================================
   3. Higiene: apagar lo global y volver a encender lo elegido
   ================================================================== */
.dz-raiz *,.dz-raiz *::before,.dz-raiz *::after{
  box-sizing:border-box;
  transition:none;
  animation:none;
  backdrop-filter:none;
  -webkit-backdrop-filter:none;
}
.dz-raiz a,.dz-raiz button{transition:background-color 90ms linear,border-color 90ms linear,color 90ms linear;}
/* :where() NO es cosmético aquí. Sin él, «.dz-raiz button» pesa (0,2,1) y gana
   a «.dz-chip», «.dz-nav» y «.dz-iconbtn», que pesan (0,1,0): el «color:inherit»
   del reseteo se imponía y TODO botón salía pintado del nivel de texto del
   contenedor. Medido en el navegador: un «.dz-chip» que dice var(--dz-t3) se
   estaba pintando de --dz-t2, y los iconos de acción de la tabla, que deben ser
   el nivel más bajo, salían dos escalones por encima. Los ratios seguían
   pasando —salía más claro, no menos— pero la jerarquía se aplanaba sola, que
   es exactamente el defecto que esta propuesta viene a arreglar.
   :where() no suma especificidad: el reseteo queda en (0,1,0) y lo gana
   cualquier clase de componente declarada después.

   AVISO PARA QUIEN EDITE ESTE FICHERO: aquí dentro NO puede haber acentos
   graves. Todo esto es un template literal, y un acento grave en un comentario
   de CSS lo cierra: la hoja se queda cortada en ese punto y el resto del
   fichero se parsea como TypeScript. Se usan comillas angulares. */
.dz-raiz :where(button){font:inherit;color:inherit;background:none;border:none;padding:0;cursor:pointer;text-align:left;}
.dz-raiz :where(input,select,textarea){font:inherit;color:inherit;}
.dz-raiz :focus-visible{outline:2px solid var(--dz-acc-graf);outline-offset:1px;border-radius:var(--dz-r1);}
.dz-raiz ::selection{background:var(--dz-acc-suave);}
.dz-raiz :where(p,h1,h2,h3,ul,li){margin:0;padding:0;list-style:none;font-weight:inherit;font-size:inherit;}

/* ==================================================================
   4. Tipografía: CINCO tamaños, TRES grosores, CUATRO colores
   ================================================================== */
/* Van prefijadas con .dz-raiz a propósito, no por costumbre: sin ese segundo
   nivel de especificidad, «.dz-t3» (0,1,0) pierde contra «.dz-tabla tbody td»
   (0,1,2) y las celdas de contexto de la tabla se pintan del nivel de arriba.
   Medido en el navegador: un td con clase dz-t3 salía #CBD0D8 en vez de
   #A2A9B4. Con cuatro niveles de texto y no dieciséis, que cada uno sea el que
   dice ser es justo lo que hay que garantizar. */
.dz-raiz .dz-xl{font-size:15px;font-weight:600;letter-spacing:-0.012em;color:var(--dz-t1);}
.dz-raiz .dz-l {font-size:13px;font-weight:600;letter-spacing:-0.006em;color:var(--dz-t1);}
.dz-raiz .dz-m {font-size:12.5px;font-weight:400;color:var(--dz-t2);}
.dz-raiz .dz-s {font-size:11.5px;font-weight:400;color:var(--dz-t3);line-height:1.5;}
.dz-raiz .dz-xs{font-size:11px;font-weight:600;color:var(--dz-t4);letter-spacing:0.005em;}
.dz-raiz .dz-t1{color:var(--dz-t1);} .dz-raiz .dz-t2{color:var(--dz-t2);}
.dz-raiz .dz-t3{color:var(--dz-t3);} .dz-raiz .dz-t4{color:var(--dz-t4);}
.dz-raiz .dz-num{font-variant-numeric:tabular-nums;font-feature-settings:'tnum' 1;}

/* ==================================================================
   5. El armazón
   ================================================================== */
.dz-marco{border:1px solid var(--dz-linea2);border-radius:var(--dz-r3);overflow:hidden;background:var(--dz-fondo);}
.dz-app{display:flex;height:100%;min-height:0;background:var(--dz-fondo);}

/* --- Barra lateral: 208 px y 26 px por módulo. Hoy son 256 y 41, y con los
       dieciocho módulos mide 1.049 px, o sea que por debajo de esa altura de
       ventana la propia barra scrollea. Esta mide 604 y cabe entera en un
       portátil. --- */
.dz-side{width:208px;flex:0 0 208px;background:var(--dz-sup2);border-right:1px solid var(--dz-linea);display:flex;flex-direction:column;min-height:0;}
.dz-side-cab{height:38px;display:flex;align-items:center;gap:7px;padding:0 10px;border-bottom:1px solid var(--dz-linea);flex:0 0 38px;}
.dz-logo{width:16px;height:16px;border-radius:var(--dz-r1);background:var(--dz-acc-relleno);flex:0 0 16px;}
.dz-side-nav{flex:1;min-height:0;overflow:auto;padding:6px 6px 10px;}
.dz-grupo{font-size:10.5px;font-weight:600;color:var(--dz-t4);padding:9px 6px 3px;letter-spacing:0.02em;}
.dz-nav{display:flex;align-items:center;gap:7px;height:26px;padding:0 7px;border-radius:var(--dz-r2);color:var(--dz-t3);font-size:12.5px;width:100%;}
.dz-nav svg{width:14px;height:14px;flex:0 0 14px;stroke-width:1.75;}
.dz-nav span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dz-nav:hover{background:var(--dz-hover);color:var(--dz-t1);}
/* El módulo en el que estás: la barra naranja de 2 px es la única marca de
   sitio de todo el ERP. En tema claro el ítem activo de hoy es naranja al 10 %
   con texto naranja encima: 2,43:1, es decir, no se lee en qué módulo estás. */
.dz-nav[data-on="1"]{background:var(--dz-hover);color:var(--dz-t1);font-weight:500;position:relative;}
.dz-nav[data-on="1"]::before{content:'';position:absolute;left:-6px;top:5px;bottom:5px;width:2px;border-radius:0 2px 2px 0;background:var(--dz-acc-graf);}
.dz-side-pie{border-top:1px solid var(--dz-linea);padding:6px;flex:0 0 auto;}

/* --- Contenido --- */
.dz-main{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0;}
/* min-width:0 aquí y en .dz-tablabox son dos de los tres eslabones que
   mantienen el scroll horizontal DENTRO de la tabla. El tercero es el
   min-w-0 del <main> del layout. Quitar uno arrastra la página entera de
   lado y se lleva la barra lateral por delante. */
.dz-top{height:38px;flex:0 0 38px;display:flex;align-items:center;gap:10px;padding:0 12px;border-bottom:1px solid var(--dz-linea);background:var(--dz-sup2);}
.dz-cuerpo{flex:1;min-height:0;min-width:0;display:flex;flex-direction:column;gap:8px;padding:10px 12px;}

/* ==================================================================
   6. Tira de cifras — 28 px en vez de cuatro tarjetas de 57,5
   ================================================================== */
.dz-cifras{height:28px;flex:0 0 28px;display:flex;align-items:center;gap:0;border:1px solid var(--dz-linea);border-radius:var(--dz-r2);background:var(--dz-sup);overflow:hidden;}
.dz-cifra{display:flex;align-items:baseline;gap:5px;padding:0 11px;height:100%;border-right:1px solid var(--dz-linea);white-space:nowrap;}
.dz-cifra:last-child{border-right:none;}
.dz-cifra b{font-size:12.5px;font-weight:600;color:var(--dz-t1);font-variant-numeric:tabular-nums;line-height:28px;}
.dz-cifra span{font-size:11px;color:var(--dz-t4);}
.dz-cifra[data-urg="1"] b{color:var(--dz-acc);}

/* ==================================================================
   7. Barra de filtros — 32 px, una sola fila
   ================================================================== */
.dz-filtros{height:32px;flex:0 0 32px;display:flex;align-items:center;gap:6px;min-width:0;}
.dz-chip{height:24px;padding:0 8px;border-radius:var(--dz-r2);border:1px solid var(--dz-linea);background:var(--dz-sup);color:var(--dz-t3);font-size:11.5px;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;}
.dz-chip:hover{background:var(--dz-hover);color:var(--dz-t1);}
.dz-chip b{font-variant-numeric:tabular-nums;font-weight:600;color:var(--dz-t4);font-size:11px;}
.dz-chip[data-on="1"]{border-color:var(--dz-acc-graf);color:var(--dz-t1);background:var(--dz-acc-suave);}
.dz-chip[data-on="1"] b{color:var(--dz-t1);}
.dz-chip svg{width:12px;height:12px;stroke-width:2;}
.dz-buscar{height:24px;display:flex;align-items:center;gap:6px;padding:0 8px;border:1px solid var(--dz-linea);border-radius:var(--dz-r2);background:var(--dz-sup);min-width:150px;}
.dz-buscar input{background:none;border:none;outline:none;width:100%;font-size:11.5px;color:var(--dz-t1);}
.dz-buscar input::placeholder{color:var(--dz-t4);}
.dz-buscar svg{width:12px;height:12px;color:var(--dz-t4);flex:0 0 12px;}
.dz-sep{width:1px;height:16px;background:var(--dz-linea2);flex:0 0 1px;}

/* ==================================================================
   8. Botones — DOS. Hoy hay dos sistemas conviviendo: <Button> de 48 px en
   mayúsculas y primaryButton de 32 px en caja normal, a veces a 20 px uno
   del otro en la misma pantalla.
   ================================================================== */
.dz-btn{height:24px;padding:0 9px;border-radius:var(--dz-r2);border:1px solid var(--dz-linea);background:var(--dz-sup);color:var(--dz-t2);font-size:11.5px;font-weight:500;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;}
.dz-btn:hover{background:var(--dz-hover);color:var(--dz-t1);border-color:var(--dz-linea2);}
.dz-btn svg{width:12px;height:12px;stroke-width:2;}
.dz-btn--pri{background:var(--dz-acc-relleno);color:var(--dz-acc-tinta);border-color:var(--dz-acc-borde);font-weight:600;}
.dz-btn--pri:hover{background:var(--dz-acc-relleno);color:var(--dz-acc-tinta);filter:brightness(1.08);}
.dz-btn[disabled]{opacity:.45;cursor:default;}
.dz-btn--alto{height:28px;padding:0 11px;}

/* ==================================================================
   9. LA TABLA. El corazón.
   ==================================================================
   28 px de fila contra los 35,5 de hoy. Y los 7,5 px que se van no son
   texto: son el cromo de dentro de la celda. Hoy la altura de la fila la
   manda un <select> de 26,5 px metido en un td con py-1; aquí el control
   mide 20 y sale del flujo hasta que se usa.
   ================================================================== */
.dz-tablabox{flex:1;min-height:0;min-width:0;overflow:auto;border:1px solid var(--dz-linea);border-radius:var(--dz-r2);background:var(--dz-sup);}
.dz-tabla{border-collapse:separate;border-spacing:0;min-width:max-content;width:100%;font-size:12.5px;}
.dz-tabla thead th{
  position:sticky;top:0;z-index:20;
  height:var(--dz-cabecera);padding:0 8px;
  background:var(--dz-sup2);
  /* Rótulo de columna: 11 px, caja normal, --dz-t4 → 5,71:1 en oscuro y
     5,21:1 en claro. Hoy es 10 px MAYÚSCULAS con tracking a text-white/40:
     3,80:1 en oscuro y 4,05:1 en claro, o sea el texto más pequeño y de
     menos contraste del ERP puesto justo en el nombre de las columnas de
     un catálogo de miles de líneas. Las mayúsculas se van con él: a 10-11
     px son la forma más lenta de leer una palabra. */
  font-size:11px;font-weight:600;color:var(--dz-t4);text-align:left;white-space:nowrap;
  border-bottom:1px solid var(--dz-linea2);
}
.dz-tabla tbody td{
  height:var(--dz-fila);padding:0 8px;
  border-bottom:1px solid var(--dz-linea);
  color:var(--dz-t2);white-space:nowrap;vertical-align:middle;
}
.dz-tabla tbody tr:last-child td{border-bottom:none;}
.dz-tabla tbody tr:hover td{background:var(--dz-hover);}
.dz-der{text-align:right;}
.dz-corta{overflow:hidden;text-overflow:ellipsis;display:block;}

/* Congelar la primera columna. Escalonado de z-index igual que en todo el
   ERP: esquina 30 · cabecera 20 · primera columna 10 · resto 0. Y fondo
   OPACO, porque una celda translúcida que se queda quieta deja ver el
   texto de las otras columnas cruzándola. */
.dz-tabla th.dz-fija{left:0;z-index:30;border-right:1px solid var(--dz-linea2);}
.dz-tabla td.dz-fija{position:sticky;left:0;z-index:10;background:var(--dz-sup);border-right:1px solid var(--dz-linea2);}
.dz-tabla tbody tr:hover td.dz-fija{background:var(--dz-hover);}

/* La fila en la que estás. ES EL ÚNICO NARANJA DE LA TABLA: raíl de 2 px a
   la izquierda del todo, fondo cálido y el nombre a --dz-t1. Hoy el naranja
   de la fila seleccionada compite con el naranja del estado «En seguimiento»
   y con el del chip de filtro encendido; aquí el estado vive en su columna
   con glifo y palabra, y el naranja solo dice «estás aquí». */
.dz-tabla tbody tr[data-sel="1"] td{background:var(--dz-sel);}
.dz-tabla tbody tr[data-sel="1"] td.dz-fija{background:var(--dz-sel);box-shadow:inset 2px 0 0 var(--dz-acc-graf);}
.dz-tabla tbody tr[data-sel="1"] td:first-child{color:var(--dz-t1);}

/* Celda editable: no parece un campo hasta que pasas por encima. Es lo único
   que impide que doce columnas editables se lean como un formulario, y por
   eso se conserva tal cual del ERP de hoy. */
.dz-celda{width:100%;height:20px;padding:0 5px;border-radius:var(--dz-r1);border:1px solid transparent;background:transparent;color:var(--dz-t2);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;}
.dz-celda:hover{background:var(--dz-sup2);border-color:var(--dz-linea);}
/* SIN outline:none. Lo tenía, y como este selector puntúa lo mismo que
   «.dz-raiz :focus-visible» (0,2,0) pero va después, ganaba: la celda editable
   —el control que Cold Calling repite seis veces por fila y veintidos filas por
   pantalla— era el UNICO sitio del diseño sin anillo de foco de 2 px. Quedaba
   1 px de borde, la mitad de grosor justo donde mas se necesita.
   El aviso se refuerza por dentro con box-shadow y no por fuera con otro
   outline, para que no se recorte contra la celda de al lado ni cambie el alto
   de la fila. Es lo mismo que hace la propuesta estructurada. */
.dz-celda:focus{background:var(--dz-sup2);border-color:var(--dz-acc-graf);box-shadow:inset 0 0 0 1px var(--dz-acc-graf);}
.dz-celda[data-vacia="1"]{color:var(--dz-t4);}
.dz-celda--num{text-align:right;font-variant-numeric:tabular-nums;}
.dz-iconbtn{width:20px;height:20px;border-radius:var(--dz-r1);display:inline-flex;align-items:center;justify-content:center;color:var(--dz-t4);}
.dz-iconbtn:hover{background:var(--dz-sup2);color:var(--dz-t1);}
.dz-iconbtn svg{width:13px;height:13px;stroke-width:1.75;}

/* ==================================================================
   10. ESTADOS SIN COLOR (criterio 5)
   ==================================================================
   Un 8 % de los hombres no distingue rojo de verde, y hoy hay tres sitios
   del ERP donde el estado es SOLO color: el punto de 6 px de CeldaEditable,
   el de 8 px de Cold Calling y el tinte de fila al 8 % con siete tonos.
   Aquí el orden es: GLIFO (forma) → PALABRA (texto) → COLOR (refuerzo).
   Tapa el color con la mano y la pantalla sigue funcionando.
   ================================================================== */
.dz-est{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--dz-t2);white-space:nowrap;}
.dz-est svg{width:13px;height:13px;flex:0 0 13px;stroke-width:2;color:var(--dz-c);}
.dz-est b{font-weight:400;}
.dz-est--fuerte b{font-weight:500;color:var(--dz-t1);}
/* Píldora, solo donde el estado es el dato principal (historial, cabecera) */
.dz-pil{display:inline-flex;align-items:center;gap:5px;height:19px;padding:0 7px 0 6px;border-radius:var(--dz-r2);border:1px solid var(--dz-linea2);background:var(--dz-sup2);font-size:11px;font-weight:500;color:var(--dz-t2);white-space:nowrap;}
.dz-pil svg{width:12px;height:12px;flex:0 0 12px;stroke-width:2;color:var(--dz-c);}

/* ==================================================================
   11. Panel, sección y formulario
   ================================================================== */
.dz-panel{border:1px solid var(--dz-linea);border-radius:var(--dz-r2);background:var(--dz-sup);min-width:0;}
.dz-panel-cab{height:30px;display:flex;align-items:center;gap:8px;padding:0 10px;border-bottom:1px solid var(--dz-linea);}
.dz-panel-cuerpo{padding:9px 10px;}
.dz-rejilla{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:9px 14px;}
.dz-campo{min-width:0;}
/* Etiqueta de campo: 11 px, caja normal, --dz-t4. Hoy es
   text-[10px] uppercase tracking-wider text-white/35 → 3,17:1 en oscuro.
   Son los nombres de los ~50 campos que hay que configurar para que a un
   cliente no se le vacíe el inventario. */
.dz-label{display:block;font-size:11px;font-weight:600;color:var(--dz-t4);margin-bottom:3px;}
.dz-input{width:100%;height:26px;padding:0 8px;border:1px solid var(--dz-linea);border-radius:var(--dz-r2);background:var(--dz-sup2);color:var(--dz-t1);font-size:12.5px;outline:none;}
.dz-input:hover{border-color:var(--dz-linea2);}
.dz-input:focus{border-color:var(--dz-acc-graf);box-shadow:inset 0 0 0 1px var(--dz-acc-graf);}
.dz-input::placeholder{color:var(--dz-t4);}
.dz-input--num{text-align:right;font-variant-numeric:tabular-nums;}
/* Nota al pie del campo: 11 px a --dz-t3 → 7,58:1 en oscuro, 6,96:1 en
   claro. Hoy va a text-white/35, 3,17:1, y es el texto que EXPLICA lo que
   hace cada campo: si no se lee, la pantalla no se puede usar. */
.dz-nota{font-size:11px;color:var(--dz-t3);line-height:1.5;margin-top:3px;}
.dz-aviso{display:flex;gap:7px;padding:7px 9px;border-radius:var(--dz-r2);border:1px solid var(--dz-linea2);background:var(--dz-sup2);font-size:11.5px;color:var(--dz-t2);line-height:1.5;}
.dz-aviso svg{width:13px;height:13px;flex:0 0 13px;margin-top:2px;stroke-width:2;color:var(--dz-c,var(--dz-t3));}
.dz-aviso b{font-weight:600;color:var(--dz-t1);}
/* El aviso que sí pide acción lleva además un filo de color a la izquierda:
   segunda señal, no solo el tono del icono. */
.dz-aviso[data-tipo]{border-left:2px solid var(--dz-c);}

/* Interruptor: la posición ya dice el estado, y encima va la palabra. */
.dz-sw{display:inline-flex;align-items:center;gap:7px;}
.dz-sw i{width:26px;height:15px;border-radius:8px;border:1px solid var(--dz-linea2);background:var(--dz-sup2);position:relative;flex:0 0 26px;}
.dz-sw i::after{content:'';position:absolute;top:2px;left:2px;width:9px;height:9px;border-radius:50%;background:var(--dz-t4);}
.dz-sw[data-on="1"] i{background:var(--dz-acc-relleno);border-color:var(--dz-acc-borde);}
.dz-sw[data-on="1"] i::after{left:13px;background:var(--dz-acc-tinta);}
.dz-sw span{font-size:11.5px;color:var(--dz-t2);}

/* Opciones excluyentes de dos o tres: botones, no un select */
.dz-ops{display:inline-flex;border:1px solid var(--dz-linea);border-radius:var(--dz-r2);overflow:hidden;background:var(--dz-sup2);}
.dz-ops button{height:26px;padding:0 10px;font-size:11.5px;color:var(--dz-t3);border-right:1px solid var(--dz-linea);}
.dz-ops button:last-child{border-right:none;}
.dz-ops button:hover{background:var(--dz-hover);color:var(--dz-t1);}
.dz-ops button[data-on="1"]{background:var(--dz-hover);color:var(--dz-t1);font-weight:600;box-shadow:inset 0 -2px 0 var(--dz-acc-graf);}

/* ==================================================================
   12. Inicio
   ================================================================== */
.dz-hoy{display:flex;flex-direction:column;}
.dz-hoy-li{display:flex;align-items:center;gap:9px;height:30px;padding:0 10px;border-bottom:1px solid var(--dz-linea);width:100%;}
.dz-hoy-li:last-child{border-bottom:none;}
.dz-hoy-li:hover{background:var(--dz-hover);}
.dz-hoy-li svg{width:14px;height:14px;flex:0 0 14px;stroke-width:1.75;color:var(--dz-t4);}
.dz-hoy-n{font-size:12.5px;font-weight:600;color:var(--dz-t1);font-variant-numeric:tabular-nums;min-width:26px;text-align:right;}
.dz-hoy-li[data-urg="1"] .dz-hoy-n{color:var(--dz-acc);}
.dz-hoy-li[data-urg="1"] svg{color:var(--dz-acc-graf);}
.dz-hoy-txt{font-size:12.5px;color:var(--dz-t2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

.dz-apps{display:grid;grid-template-columns:1fr 1fr;gap:0 14px;}
.dz-app-li{display:flex;align-items:center;gap:8px;height:30px;padding:0 8px;border-radius:var(--dz-r2);width:100%;min-width:0;}
.dz-app-li:hover{background:var(--dz-hover);}
.dz-app-li > svg{width:14px;height:14px;flex:0 0 14px;stroke-width:1.75;color:var(--dz-t4);}
.dz-app-li:hover > svg{color:var(--dz-t2);}
.dz-app-n{font-size:12.5px;font-weight:500;color:var(--dz-t1);white-space:nowrap;}
.dz-app-d{font-size:11.5px;color:var(--dz-t3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;}
.dz-marca{display:inline-flex;align-items:center;justify-content:center;min-width:17px;height:16px;padding:0 4px;border-radius:var(--dz-r1);background:var(--dz-acc-relleno);color:var(--dz-acc-tinta);font-size:10.5px;font-weight:700;font-variant-numeric:tabular-nums;border:1px solid var(--dz-acc-borde);}

.dz-fila-flex{display:flex;align-items:center;gap:8px;min-width:0;}
.dz-crece{flex:1;min-width:0;}
.dz-scroll{overflow:auto;min-height:0;}

/* ==================================================================
   13. El regulador de la maqueta (no forma parte de la propuesta)
   ================================================================== */
.dz-regla{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;font-size:11.5px;color:var(--dz-t3);}
.dz-regla-tag{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 7px;border-radius:var(--dz-r2);border:1px solid var(--dz-linea);background:var(--dz-sup);color:var(--dz-t3);font-size:11px;}
.dz-regla-tag b{color:var(--dz-t1);font-weight:600;font-variant-numeric:tabular-nums;}
`
