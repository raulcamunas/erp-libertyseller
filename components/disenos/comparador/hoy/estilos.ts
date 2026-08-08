/**
 * «COMO ESTÁ HOY» — la referencia contra la que se comparan las tres propuestas.
 *
 * Esto NO es una propuesta: es una réplica del ERP tal y como se ve ahora mismo,
 * y está aquí porque sin ella el comparador sería un concurso entre tres cosas
 * nuevas sin nada que decir sobre si mejoran algo.
 *
 * POR QUÉ ES UNA RÉPLICA Y NO LA PANTALLA DE VERDAD
 * Las pantallas reales son componentes de servidor que leen de Supabase: no se
 * pueden montar cuatro veces dentro de una misma vista, ni cambiarles el tema sin
 * tocar la clase `html.light` de todo el ERP. Las tres propuestas también son
 * réplicas, así que la única comparación honesta es réplica contra réplica, todas
 * con el mismo marcado y las mismas filas.
 *
 * POR QUÉ LOS COLORES VAN ESCRITOS A MANO Y NO EN CLASES DE TAILWIND
 * Porque el tema claro del ERP no se elige por componente: se elige poniendo
 * `html.light`, y eso cambiaría también el comparador y las otras tres maquetas.
 * Aquí los dos temas están congelados en variables, con los valores EXACTOS que
 * salen hoy:
 *
 *   · el oscuro, con los alfas literales del código (`text-white/40` es
 *     rgba(255,255,255,0.4), sin más);
 *   · el claro, con los colores a los que la capa de traducción de
 *     app/globals.css (líneas 292-433) convierte cada uno de esos alfas.
 *
 * O sea que `--hoy-t45`, `--hoy-t40` y `--hoy-t35` son tres variables distintas
 * en oscuro y EL MISMO #74747e en claro. No es un descuido de esta réplica: es
 * lo que hace hoy el ERP, y es una de las cosas que hay que ver.
 *
 * LOS TRES FALLOS QUE SE REPRODUCEN A PROPÓSITO
 *   1. `glass-card` no tiene traducción a claro. Su `brightness(1.1)` sobre
 *      #F5F5F7 satura a blanco puro y su borde es blanco sobre blanco: la tarjeta
 *      se queda sin superficie y sin borde (1,09:1 y 1,01:1). Aquí se reproduce
 *      con el mismo backdrop-filter, no imitándolo, para que se vea de verdad.
 *   2. `glass-card-light` (la barra lateral) tampoco: 1,00:1 sobre claro.
 *   3. `text-white/15` no está en la tabla de traducción, así que en claro sigue
 *      siendo blanco sobre blanco.
 *
 * Todo cuelga de `.hoy-raiz` y lleva prefijo `hoy-`, igual que las tres
 * propuestas cuelgan de `.dz-raiz`, `.lsd-raiz` y `.ctx-root`. Las cuatro pueden
 * estar montadas a la vez sin pisarse.
 */

export const ESTILOS_HOY = `
/* ================================================================== *
 * Variables: los dos temas, con los valores reales de cada uno         *
 * ================================================================== */

.hoy-raiz{
  /* --- Superficies (informe §3, columna "oscuro") --- */
  --hoy-bg:#080808;
  --hoy-sup:#0d0d0d;          /* bg-white/[0.02] compuesto sobre la página */
  --hoy-sup-hover:#0f0f0f;    /* bg-white/[0.03] */
  --hoy-sup-fuerte:#1a1a1a;
  --hoy-sticky:#0d0d0d;       /* el fondo OPACO de la columna congelada */
  --hoy-cristal-fondo:rgba(255,255,255,0.02);
  --hoy-cristal-borde:rgba(255,255,255,0.15);
  --hoy-cristal-claro:rgba(255,255,255,0.03);

  /* --- Bordes: 16 niveles en el ERP, aquí los cuatro que se usan de verdad --- */
  --hoy-linea:rgba(255,255,255,0.1);
  --hoy-linea-07:rgba(255,255,255,0.07);
  --hoy-linea-05:rgba(255,255,255,0.05);
  --hoy-linea-20:rgba(255,255,255,0.2);

  /* --- LOS DIECISÉIS NIVELES DE TEXTO. Esto es el diagnóstico, en variables --- */
  --hoy-t100:#ffffff;
  --hoy-t90:rgba(255,255,255,0.90);
  --hoy-t85:rgba(255,255,255,0.85);
  --hoy-t80:rgba(255,255,255,0.80);
  --hoy-t75:rgba(255,255,255,0.75);
  --hoy-t70:rgba(255,255,255,0.70);
  --hoy-t65:rgba(255,255,255,0.65);
  --hoy-t60:rgba(255,255,255,0.60);
  --hoy-t55:rgba(255,255,255,0.55);
  --hoy-t50:rgba(255,255,255,0.50);
  --hoy-t45:rgba(255,255,255,0.45);
  --hoy-t40:rgba(255,255,255,0.40);
  --hoy-t35:rgba(255,255,255,0.35);
  --hoy-t30:rgba(255,255,255,0.30);
  --hoy-t25:rgba(255,255,255,0.25);
  --hoy-t20:rgba(255,255,255,0.20);
  --hoy-t15:rgba(255,255,255,0.15);

  --hoy-marca:#FF6600;
  --hoy-marca-texto:#FF6600;
  --hoy-marca-tinta:#ffffff;     /* el texto del botón primario: 2,94:1 */
  --hoy-marca-suave:rgba(255,102,0,0.10);
  --hoy-marca-borde:rgba(255,102,0,0.30);
  --hoy-sel-fila:rgba(255,102,0,0.14);

  /* Avisos: los tonos 300/400, que son los que hay escritos en el código */
  --hoy-verde:#86EFAC;   --hoy-verde-fondo:rgba(34,197,94,0.08);  --hoy-verde-borde:rgba(34,197,94,0.25);
  --hoy-ambar:#FDE047;   --hoy-ambar-fondo:rgba(250,204,21,0.06); --hoy-ambar-borde:rgba(234,179,8,0.25);
  --hoy-rojo:#FCA5A5;    --hoy-rojo-fondo:rgba(239,68,68,0.08);   --hoy-rojo-borde:rgba(239,68,68,0.30);
  --hoy-zinc:#D4D4D8;    --hoy-zinc-fondo:rgba(113,113,122,0.15); --hoy-zinc-borde:rgba(113,113,122,0.30);

  --hoy-esquema:dark;
}

/* --------------------------------------------------------------------
   TEMA CLARO. No es una paleta: es lo que devuelve la capa de traducción
   de app/globals.css. Los tres bloques colapsados están marcados.
   -------------------------------------------------------------------- */
.hoy-raiz[data-hoy-tema="claro"]{
  --hoy-bg:#F5F5F7;
  --hoy-sup:#F0F0F2;
  --hoy-sup-hover:#EDEDEF;
  --hoy-sup-fuerte:#FFFFFF;
  --hoy-sticky:#FFFFFF;
  /* glass-card y glass-card-light NO tienen traducción: se dejan tal cual */

  --hoy-linea:rgba(0,0,0,0.1);
  --hoy-linea-07:rgba(0,0,0,0.08);
  --hoy-linea-05:rgba(0,0,0,0.06);
  --hoy-linea-20:rgba(0,0,0,0.18);

  --hoy-t100:#101014;
  /* 90 · 85 · 80 · 75 -> UN SOLO color */
  --hoy-t90:#232329;  --hoy-t85:#232329;  --hoy-t80:#232329;  --hoy-t75:#232329;
  /* 70 · 65 -> uno */
  --hoy-t70:#55555f;  --hoy-t65:#55555f;
  /* 60 · 55 · 50 -> uno */
  --hoy-t60:#5f5f6a;  --hoy-t55:#5f5f6a;  --hoy-t50:#5f5f6a;
  /* 45 · 40 · 35 -> uno, y a 4,05:1 los tres */
  --hoy-t45:#74747e;  --hoy-t40:#74747e;  --hoy-t35:#74747e;
  /* 30 · 25 · 20 -> uno, y a 2,44:1 los tres */
  --hoy-t30:#9a9aa4;  --hoy-t25:#9a9aa4;  --hoy-t20:#9a9aa4;
  /* 15 -> NO ESTÁ EN LA TABLA. Sigue siendo blanco, sobre fondo claro. */
  --hoy-t15:rgba(255,255,255,0.9);

  --hoy-marca-tinta:#ffffff;   /* sigue siendo blanco: 2,94:1 también en claro */

  --hoy-verde:#15803D;   --hoy-verde-fondo:rgba(21,128,61,0.10);  --hoy-verde-borde:rgba(21,128,61,0.35);
  --hoy-ambar:#A16207;   --hoy-ambar-fondo:rgba(202,138,4,0.14);  --hoy-ambar-borde:rgba(161,98,7,0.30);
  --hoy-rojo:#B91C1C;    --hoy-rojo-fondo:rgba(185,28,28,0.08);   --hoy-rojo-borde:rgba(185,28,28,0.28);
  --hoy-zinc:#3F3F46;    --hoy-zinc-fondo:rgba(63,63,70,0.10);    --hoy-zinc-borde:rgba(63,63,70,0.25);

  --hoy-esquema:light;
}

/* ================================================================== *
 * Armazón                                                             *
 * ================================================================== */

.hoy-raiz{
  position:relative;
  display:flex;
  height:100%;
  min-height:0;
  overflow:hidden;
  background:var(--hoy-bg);
  color:var(--hoy-t100);
  font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  font-size:14px;
  line-height:1.5;          /* el 1,5 heredado del preflight, en el 96 % del texto */
  -webkit-font-smoothing:antialiased;
  color-scheme:var(--hoy-esquema);
}
.hoy-raiz *,.hoy-raiz *::before,.hoy-raiz *::after{box-sizing:border-box;}
.hoy-raiz :where(button){font:inherit;color:inherit;background:none;border:none;padding:0;cursor:pointer;text-align:left;}
.hoy-raiz :where(input,select,textarea){font:inherit;color:inherit;}
.hoy-raiz :where(p,h1,h2,h3,ul,li){margin:0;padding:0;list-style:none;}
.hoy-raiz :where(a){color:inherit;text-decoration:none;}

/* El fondo animado de body::before: gradientes naranjas y azules con
   blur(120px) y una animación infinita de 25 s. Está en TODAS las pantallas y
   en las ocho horas. Sube el suelo de la página de #080808 a #231207 en los
   picos, así que dos celdas idénticas no tienen el mismo contraste según dónde
   caigan ni según el segundo. */
.hoy-raiz::before{
  content:'';
  position:absolute;
  inset:0;
  background:
    radial-gradient(circle at 20% 30%, rgba(255,102,0,0.12) 0%, transparent 50%),
    radial-gradient(circle at 80% 70%, rgba(0,115,255,0.08) 0%, transparent 50%),
    radial-gradient(circle at 50% 50%, rgba(255,102,0,0.06) 0%, transparent 50%),
    radial-gradient(circle at 40% 80%, rgba(0,115,255,0.05) 0%, transparent 50%);
  filter:blur(120px);
  z-index:0;
  pointer-events:none;
  animation:hoy-liquid 25s ease-in-out infinite alternate;
}
.hoy-raiz[data-hoy-tema="claro"]::before{
  background:
    radial-gradient(circle at 20% 30%, rgba(255,102,0,0.10) 0%, transparent 50%),
    radial-gradient(circle at 80% 70%, rgba(0,115,255,0.08) 0%, transparent 50%),
    radial-gradient(circle at 50% 50%, rgba(255,102,0,0.04) 0%, transparent 50%),
    radial-gradient(circle at 40% 80%, rgba(0,115,255,0.05) 0%, transparent 50%);
}
@keyframes hoy-liquid{
  0%{transform:translate(0,0) scale(1) rotate(0deg);opacity:.7;}
  33%{transform:translate(-3%,3%) scale(1.05) rotate(2deg);opacity:.9;}
  66%{transform:translate(3%,-3%) scale(.95) rotate(-2deg);opacity:.8;}
  100%{transform:translate(0,0) scale(1) rotate(0deg);opacity:.7;}
}
/* Quien tenga puesto "reducir movimiento" en el sistema no ve la animación; el
   ERP de hoy tampoco la respeta, pero una maqueta no es sitio para mareas. */
@media (prefers-reduced-motion: reduce){
  .hoy-raiz::before{animation:none;}
}

/* ---------------- Barra lateral: 256 px, ítems de 41 ---------------- */
.hoy-side{
  position:relative;
  z-index:1;
  width:256px;
  flex:0 0 256px;
  display:flex;
  flex-direction:column;
  /* glass-card-light. En claro: rgba(255,255,255,0.03) sobre #F5F5F7 = 1,00:1.
     Lo único que separa la barra del contenido es su borde derecho. */
  background:var(--hoy-cristal-claro);
  backdrop-filter:blur(10px);
  -webkit-backdrop-filter:blur(10px);
  border-right:1px solid var(--hoy-linea);
  overflow:hidden;
}
.hoy-side-cab{display:flex;align-items:center;gap:10px;padding:16px;height:73px;flex:0 0 73px;}
.hoy-logo{width:32px;height:32px;border-radius:8px;background:var(--hoy-marca);flex:0 0 32px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:13px;}
.hoy-side-nav{flex:1;min-height:0;overflow-y:auto;padding:16px 12px;display:flex;flex-direction:column;gap:4px;}
.hoy-nav{
  display:flex;align-items:center;gap:12px;
  padding:10px 12px;                 /* px-3 py-2.5 -> 41 px de alto */
  border-radius:12px;
  font-size:14px;font-weight:500;
  color:var(--hoy-t70);
  border:1px solid transparent;
  white-space:nowrap;
}
.hoy-nav > svg{width:20px;height:20px;flex:0 0 20px;}
.hoy-nav:hover{background:rgba(255,255,255,0.05);color:var(--hoy-t100);}
.hoy-raiz[data-hoy-tema="claro"] .hoy-nav:hover{background:rgba(0,0,0,0.05);}
.hoy-nav[data-on]{
  /* El único indicador de en qué módulo estás. En claro: naranja sobre naranja
     al 10 % sobre blanco = 2,43:1. */
  background:var(--hoy-marca-suave);
  color:var(--hoy-marca-texto);
  border-color:var(--hoy-marca-borde);
}
.hoy-nav-texto{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;}
.hoy-insignia{background:var(--hoy-marca);color:#fff;font-size:11px;font-weight:700;border-radius:9999px;padding:1px 7px;line-height:1.4;}
.hoy-side-pie{flex:0 0 auto;padding:12px;border-top:1px solid var(--hoy-linea);display:flex;flex-direction:column;gap:4px;}

/* ---------------- Main: p-8 y dos iconos flotando ---------------- */
.hoy-main{position:relative;z-index:1;flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden;}
.hoy-flotantes{position:absolute;top:24px;right:24px;z-index:50;display:flex;align-items:center;gap:8px;}
.hoy-flotante{width:39px;height:39px;border-radius:9999px;display:flex;align-items:center;justify-content:center;color:var(--hoy-t70);}
.hoy-flotante > svg{width:18px;height:18px;}
.hoy-lienzo{flex:1;min-height:0;min-width:0;padding:32px;display:flex;flex-direction:column;overflow:auto;}
.hoy-lienzo[data-scroll="no"]{overflow:hidden;}

/* Bloque de título: 36 px + párrafo. 76-79 px en CADA pantalla. */
.hoy-h1{font-size:36px;font-weight:700;letter-spacing:-1px;line-height:1.1;color:var(--hoy-t100);}
.hoy-sub{font-size:14px;color:var(--hoy-t50);margin-top:8px;}

/* ================================================================== *
 * Piezas                                                              *
 * ================================================================== */

/* glass-card, tal cual: 191 usos en 54 ficheros. En claro el brightness(1.1)
   satura el fondo a blanco puro y el borde blanco al 15 % desaparece. */
.hoy-cristal{
  background:var(--hoy-cristal-fondo);
  backdrop-filter:blur(50px) saturate(180%) brightness(1.1);
  -webkit-backdrop-filter:blur(50px) saturate(180%) brightness(1.1);
  border:1px solid var(--hoy-cristal-borde);
  border-radius:24px;
}
.hoy-tarjeta{background:rgba(255,255,255,0.02);border:1px solid var(--hoy-linea);border-radius:12px;}
.hoy-raiz[data-hoy-tema="claro"] .hoy-tarjeta{background:rgba(0,0,0,0.022);}

/* Los dos sistemas de botón, conviviendo. */
.hoy-btn-viejo{
  height:48px;padding:0 24px;border-radius:12px;
  background:var(--hoy-marca);color:var(--hoy-marca-tinta);
  font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;
  display:inline-flex;align-items:center;gap:8px;
  box-shadow:0 4px 14px rgba(255,102,0,0.25);
}
.hoy-btn-nuevo{
  height:32px;padding:0 14px;border-radius:9999px;
  background:linear-gradient(to bottom,#FF7A1F,#FF6600);color:var(--hoy-marca-tinta);
  font-size:12px;font-weight:600;
  display:inline-flex;align-items:center;gap:6px;
}
.hoy-btn-fantasma{
  height:32px;padding:0 14px;border-radius:9999px;
  border:1px solid var(--hoy-linea);background:rgba(255,255,255,0.03);
  color:var(--hoy-t75);font-size:12px;font-weight:500;
  display:inline-flex;align-items:center;gap:6px;
}
.hoy-raiz[data-hoy-tema="claro"] .hoy-btn-fantasma{background:rgba(0,0,0,0.032);}

.hoy-chip{
  height:26px;padding:0 10px;border-radius:9999px;
  border:1px solid var(--hoy-linea);background:rgba(255,255,255,0.03);
  color:var(--hoy-t60);font-size:11px;font-weight:500;
  display:inline-flex;align-items:center;gap:6px;white-space:nowrap;
}
.hoy-raiz[data-hoy-tema="claro"] .hoy-chip{background:rgba(0,0,0,0.032);}
.hoy-chip[data-on]{background:var(--hoy-marca-suave);border-color:var(--hoy-marca-borde);color:var(--hoy-marca-texto);}

/* La etiqueta de campo y la cabecera de columna: el texto más pequeño y el de
   menos contraste del ERP, y encima en mayúsculas con tracking. */
.hoy-rotulo{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--hoy-t35);}
.hoy-nota{font-size:10px;color:var(--hoy-t35);line-height:1.5;}

.hoy-campo{
  width:100%;
  background:rgba(255,255,255,0.04);
  border:1px solid var(--hoy-linea);
  border-radius:8px;
  padding:6px 10px;
  font-size:12px;
  color:var(--hoy-t100);
  outline:none;
}
.hoy-raiz[data-hoy-tema="claro"] .hoy-campo{background:rgba(0,0,0,0.042);}
.hoy-campo:focus{border-color:var(--hoy-marca);}
.hoy-campo::placeholder{color:var(--hoy-t25);}

.hoy-caja{border-radius:8px;padding:8px 10px;font-size:11px;line-height:1.5;border:1px solid;}
.hoy-caja[data-tipo="info"]{border-color:var(--hoy-linea);background:rgba(255,255,255,0.03);color:var(--hoy-t55);}
.hoy-raiz[data-hoy-tema="claro"] .hoy-caja[data-tipo="info"]{background:rgba(0,0,0,0.032);}
.hoy-caja[data-tipo="aviso"]{border-color:var(--hoy-ambar-borde);background:var(--hoy-ambar-fondo);color:var(--hoy-ambar);}
.hoy-caja[data-tipo="error"]{border-color:var(--hoy-rojo-borde);background:var(--hoy-rojo-fondo);color:var(--hoy-rojo);}

/* Píldora de estado: bg-{color}-500/20 text-{color}-300 border-{color}-500/30 */
.hoy-pildora{
  display:inline-flex;align-items:center;
  font-size:10px;font-weight:600;
  padding:2px 8px;border-radius:9999px;border:1px solid;
  white-space:nowrap;
}

/* ================================================================== *
 * Tabla: fila de 35,5 px, cabecera de 27,5                            *
 * ================================================================== */

.hoy-caja-tabla{
  flex:1;min-height:0;min-width:0;
  overflow:auto;
  border-radius:16px;
  border:1px solid var(--hoy-linea);
  background:rgba(255,255,255,0.02);
}
.hoy-raiz[data-hoy-tema="claro"] .hoy-caja-tabla{background:rgba(0,0,0,0.022);}
.hoy-tabla{border-collapse:collapse;font-size:12px;min-width:max-content;}
.hoy-tabla th{
  padding:6px 8px;text-align:left;
  font-size:10px;font-weight:600;
  color:var(--hoy-t40);                 /* 3,80:1 en oscuro · 4,05:1 en claro */
  text-transform:uppercase;letter-spacing:0.05em;
  white-space:nowrap;
  border-bottom:1px solid var(--hoy-linea);
}
.hoy-tabla thead{position:sticky;top:0;z-index:20;background:var(--hoy-sticky);}
.hoy-tabla th[data-fija]{position:sticky;left:0;z-index:30;background:var(--hoy-sticky);border-right:1px solid var(--hoy-linea-07);}
.hoy-tabla tbody tr{border-bottom:1px solid var(--hoy-linea-05);cursor:pointer;transition:filter 200ms cubic-bezier(.4,0,.2,1);}
.hoy-tabla tbody tr:hover{filter:brightness(1.25);}
.hoy-raiz[data-hoy-tema="claro"] .hoy-tabla tbody tr:hover{filter:brightness(0.96);}
.hoy-tabla td{padding:4px 8px;vertical-align:middle;}
.hoy-tabla td[data-fija]{position:sticky;left:0;z-index:10;border-right:1px solid var(--hoy-linea-07);font-weight:600;color:var(--hoy-t100);white-space:nowrap;}
.hoy-tabla td[data-estrecha]{padding-left:4px;padding-right:4px;}
.hoy-num{font-variant-numeric:tabular-nums;}
.hoy-punto{width:8px;height:8px;border-radius:9999px;flex:0 0 8px;}

/* La celda editable: no parece un campo hasta que pasas por encima. */
.hoy-celda{
  width:100%;background:transparent;
  border:1px solid transparent;border-radius:4px;
  padding:4px 6px;font-size:12px;color:var(--hoy-t100);
  outline:none;
}
.hoy-celda:hover{background:rgba(255,255,255,0.05);}
.hoy-celda:focus{background:rgba(255,255,255,0.08);border-color:var(--hoy-marca);}
.hoy-raiz[data-hoy-tema="claro"] .hoy-celda:hover{background:rgba(0,0,0,0.05);}
.hoy-raiz[data-hoy-tema="claro"] .hoy-celda:focus{background:rgba(0,0,0,0.08);}
.hoy-celda::placeholder{color:var(--hoy-t20);}
.hoy-select{
  width:100%;border-radius:4px;padding:4px 6px;
  font-size:11px;font-weight:500;color:var(--hoy-t100);
  border:1px solid;outline:none;cursor:pointer;
  appearance:none;
}

/* ================================================================== *
 * Rejilla de inicio                                                   *
 * ================================================================== */

.hoy-rejilla{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px;}
.hoy-app{padding:24px;height:100%;position:relative;overflow:hidden;}
.hoy-app-icono{
  width:48px;height:48px;border-radius:12px;
  display:flex;align-items:center;justify-content:center;
  margin-bottom:16px;
  background:var(--hoy-marca-suave);
  color:var(--hoy-marca-texto);
}
.hoy-app-icono > svg{width:24px;height:24px;}
.hoy-app-tit{font-size:18px;font-weight:600;color:var(--hoy-t100);margin-bottom:4px;}
.hoy-app-desc{font-size:14px;color:var(--hoy-t50);margin-bottom:12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}

/* ================================================================== *
 * Secciones del perfil                                                *
 * ================================================================== */

.hoy-seccion{border-radius:16px;border:1px solid var(--hoy-linea);background:rgba(255,255,255,0.02);padding:12px;}
.hoy-raiz[data-hoy-tema="claro"] .hoy-seccion{background:rgba(0,0,0,0.022);}
.hoy-seccion-tit{font-size:12px;font-weight:600;color:var(--hoy-t100);}
.hoy-seccion-hint{font-size:10px;color:var(--hoy-t35);margin-top:2px;}
.hoy-rejilla-campos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;}
`
