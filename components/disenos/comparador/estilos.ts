/**
 * El cromo del comparador: la barra de mandos, la ficha y la tabla comparativa.
 *
 * NO es ninguna de las cuatro estéticas que se comparan. Es deliberadamente
 * neutro y callado, porque si el marco tuviera opinión, la primera cosa que se
 * compararía sería el marco.
 *
 * Va con prefijo `cmp-` y colgando de `.cmp-raiz`, igual que las maquetas
 * cuelgan de `.hoy-raiz`, `.dz-raiz`, `.lsd-raiz` y `.ctx-root`. Las cinco hojas
 * conviven sin pisarse.
 *
 * Los colores del cromo van escritos aquí y no en clases de Tailwind por un
 * motivo concreto: la capa de traducción de app/globals.css (líneas 292-433)
 * reinterpreta `text-white/XX` y `bg-white/XX` cuando `html.light` está puesto,
 * y eso metería en el comparador exactamente el problema que el comparador viene
 * a enseñar. El cromo sí sigue el tema del ERP —con `html.light .cmp-raiz`—,
 * porque es una pantalla del ERP; las maquetas de dentro no, porque cada una
 * lleva su propio interruptor.
 */

export const ESTILOS_COMPARADOR = `
.cmp-raiz{
  --cmp-fondo:#0B0D10;
  --cmp-sup:#14171C;
  --cmp-sup2:#1B1F26;
  --cmp-linea:#262B33;
  --cmp-linea2:#39404A;
  --cmp-t1:#EDEFF2;
  --cmp-t2:#A9B2BE;
  --cmp-t3:#8892A0;
  --cmp-acc:#FF6600;
  --cmp-acc-suave:rgba(255,102,0,0.12);
  --cmp-acc-tinta:#14161A;
  --cmp-mal:#FF8A80;
  --cmp-bien:#5DDC98;
  --cmp-r:10px;
  color:var(--cmp-t1);
  font-size:13px;
  line-height:1.5;
}
html.light .cmp-raiz{
  --cmp-fondo:#EFF1F4;
  --cmp-sup:#FFFFFF;
  --cmp-sup2:#F5F6F8;
  --cmp-linea:#DDE1E6;
  --cmp-linea2:#C4CAD2;
  --cmp-t1:#15181D;
  --cmp-t2:#4B535E;
  --cmp-t3:#616B78;
  --cmp-acc:#B34700;
  --cmp-acc-suave:rgba(255,102,0,0.14);
  --cmp-mal:#B3261E;
  --cmp-bien:#10703C;
}

.cmp-raiz *,.cmp-raiz *::before,.cmp-raiz *::after{box-sizing:border-box;}
.cmp-raiz :where(button){font:inherit;color:inherit;background:none;border:none;padding:0;cursor:pointer;text-align:left;}
.cmp-raiz :where(p,h1,h2,h3,h4,ul,ol,li){margin:0;padding:0;list-style:none;}
.cmp-raiz :where(table){border-collapse:collapse;}
.cmp-raiz :focus-visible{outline:2px solid var(--cmp-acc);outline-offset:2px;border-radius:4px;}
.cmp-num{font-variant-numeric:tabular-nums;}

/* ---------------- Tipografía del cromo: tres niveles ---------------- */
.cmp-t1{color:var(--cmp-t1);}
.cmp-t2{color:var(--cmp-t2);}
.cmp-t3{color:var(--cmp-t3);}
.cmp-h1{font-size:20px;font-weight:600;letter-spacing:-0.01em;color:var(--cmp-t1);}
.cmp-h2{font-size:15px;font-weight:600;color:var(--cmp-t1);}
.cmp-h3{font-size:12px;font-weight:600;color:var(--cmp-t2);text-transform:none;}
.cmp-p{font-size:13px;color:var(--cmp-t2);}
.cmp-s{font-size:12px;color:var(--cmp-t3);line-height:1.45;}

/* ---------------- Aviso de que esto no cambia el ERP ---------------- */
.cmp-aviso{
  display:flex;gap:10px;align-items:flex-start;
  border:1px solid var(--cmp-linea2);
  border-left:3px solid var(--cmp-acc);
  background:var(--cmp-sup);
  border-radius:var(--cmp-r);
  padding:10px 12px;
}
.cmp-aviso svg{width:16px;height:16px;flex:0 0 16px;color:var(--cmp-acc);margin-top:1px;}

/* ---------------- Mandos ---------------- */
.cmp-mandos{
  position:sticky;top:0;z-index:30;
  display:flex;flex-direction:column;gap:8px;
  padding:10px;
  background:var(--cmp-sup);
  border:1px solid var(--cmp-linea);
  border-radius:var(--cmp-r);
}
.cmp-fila{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;}
.cmp-et{font-size:11px;font-weight:600;color:var(--cmp-t3);white-space:nowrap;}
.cmp-crece{flex:1;}
.cmp-sep{width:1px;align-self:stretch;background:var(--cmp-linea);margin:0 2px;}

.cmp-grupo{display:flex;gap:4px;flex-wrap:wrap;background:var(--cmp-sup2);border:1px solid var(--cmp-linea);border-radius:8px;padding:3px;}
.cmp-op{
  display:inline-flex;align-items:center;gap:6px;
  height:28px;padding:0 10px;border-radius:6px;
  font-size:12px;font-weight:500;color:var(--cmp-t2);
  white-space:nowrap;
  border:1px solid transparent;
}
.cmp-op:hover{background:var(--cmp-sup);color:var(--cmp-t1);}
.cmp-op[data-on='1']{background:var(--cmp-acc);color:var(--cmp-acc-tinta);font-weight:600;}
html.light .cmp-op[data-on='1']{background:#FF6600;color:#17140F;}
.cmp-op svg{width:13px;height:13px;flex:0 0 13px;}
.cmp-tecla{
  font-size:10px;font-weight:600;
  padding:0 4px;border-radius:3px;
  border:1px solid currentColor;opacity:.55;
  line-height:15px;
  font-variant-numeric:tabular-nums;
}

.cmp-btn{
  display:inline-flex;align-items:center;gap:6px;
  height:28px;padding:0 10px;border-radius:8px;
  border:1px solid var(--cmp-linea2);background:var(--cmp-sup2);
  font-size:12px;font-weight:500;color:var(--cmp-t2);white-space:nowrap;
}
.cmp-btn:hover{color:var(--cmp-t1);border-color:var(--cmp-t3);}
.cmp-btn[data-on='1']{background:var(--cmp-acc-suave);border-color:var(--cmp-acc);color:var(--cmp-acc);}
.cmp-btn svg{width:13px;height:13px;flex:0 0 13px;}

/* La marca de "este es el modo que defiende esta propuesta" */
.cmp-marca-modo{
  display:inline-flex;align-items:center;gap:5px;
  font-size:11px;color:var(--cmp-t3);
  border:1px dashed var(--cmp-linea2);border-radius:6px;
  padding:2px 7px;white-space:nowrap;
}
.cmp-marca-modo[data-fuera='1']{color:var(--cmp-acc);border-color:var(--cmp-acc);border-style:solid;}

/* ---------------- El lienzo de la maqueta ---------------- */
.cmp-obra{display:flex;gap:12px;align-items:flex-start;min-width:0;}
.cmp-lienzo-caja{
  flex:1;min-width:0;
  border:1px solid var(--cmp-linea2);
  border-radius:var(--cmp-r);
  background:var(--cmp-sup2);
  overflow:hidden;
  position:relative;
}
.cmp-lienzo-pie{
  display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  padding:6px 10px;
  border-top:1px solid var(--cmp-linea);
  background:var(--cmp-sup);
  font-size:11px;color:var(--cmp-t3);
}
/* La ventana simulada: se escala entera para que quepa, conservando la
   proporción. Así las cuatro maquetas se ven al MISMO tamaño lógico y la
   comparación de densidad es honesta. */
.cmp-escala{position:relative;overflow:hidden;}
/* transition:none NO sobra. app/globals.css declara la transición sobre el
   selector universal —200 ms, con «transform» entre las propiedades—, así que
   sin esto cada cambio de tamaño de ventana anima la escala de una pantalla
   entera del ERP durante 200 ms. Comprobado en el navegador: la transición
   estaba ahí y estaba corriendo. Es, de paso, un ejemplo de lo que hace ese
   selector universal del CSS de hoy en sitios donde nadie lo pidió. */
.cmp-ventana{transform-origin:top left;position:absolute;top:0;left:0;transition:none;}
/* OJO AL EDITAR: esto es una plantilla de cadena de JavaScript. Ni comillas
   invertidas ni la secuencia dólar-llave dentro del CSS, o el fichero deja de
   compilar con un error de sintaxis que no señala al CSS.

   Las variantes que no se están mirando siguen montadas pero ocultas: cambiar
   de propuesta es un cambio de «display», no un montaje. Por eso el salto es
   instantáneo y cada maqueta conserva su scroll, su fila elegida y sus filtros. */
.cmp-ventana[data-visible='no']{display:none;}
/* EL CRITERIO 5, COMPROBABLE.
   «Los estados se distinguen sin color» es el único de los siete criterios que
   solo se puede juzgar apagando el color, y era justo el que no se podía apagar
   desde aquí: la propuesta clara traía su interruptor, pero el comparador la
   montaba con sinColor fijo en false, y las otras tres no tenían equivalente.
   Se aplica en el envoltorio de la ventana simulada, que es lo que garantiza que
   las CUATRO reciban exactamente el mismo tratamiento y la comparación valga. Se
   pinta entera y no solo los iconos: medio gris deja el texto del estado en color
   y ese es justo el canal que se está poniendo a prueba. */
.cmp-ventana[data-sincolor='si']{filter:grayscale(1);}

/* ---------------- La ficha ---------------- */
.cmp-ficha{
  width:396px;flex:0 0 396px;
  border:1px solid var(--cmp-linea);
  border-radius:var(--cmp-r);
  background:var(--cmp-sup);
  overflow:hidden;
  align-self:stretch;
}
.cmp-ficha-cab{padding:12px;border-bottom:1px solid var(--cmp-linea);background:var(--cmp-sup2);}
.cmp-ficha-cuerpo{padding:12px;display:flex;flex-direction:column;gap:14px;}
.cmp-bloque{display:flex;flex-direction:column;gap:6px;}
.cmp-bloque-tit{
  font-size:11px;font-weight:600;color:var(--cmp-t3);
  display:flex;align-items:center;gap:6px;
}
.cmp-bloque-tit::after{content:'';flex:1;height:1px;background:var(--cmp-linea);}

.cmp-lista{display:flex;flex-direction:column;gap:5px;}
.cmp-lista li{display:flex;gap:7px;font-size:12px;color:var(--cmp-t2);line-height:1.45;}
.cmp-lista li::before{content:'';width:5px;height:5px;border-radius:50%;background:var(--cmp-linea2);flex:0 0 5px;margin-top:6px;}
.cmp-lista[data-tono='bien'] li::before{background:var(--cmp-bien);}
.cmp-lista[data-tono='mal'] li::before{background:var(--cmp-mal);}

/* Los pasos de adopción: numerados y sin viñeta, porque el orden importa */
.cmp-pasos{display:flex;flex-direction:column;gap:8px;}
.cmp-pasos li{display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--cmp-t2);line-height:1.45;
  border-left:2px solid var(--cmp-linea2);padding-left:8px;}
.cmp-pasos li strong{color:var(--cmp-t1);font-size:12px;}

/* Muestras de tipografía y color */
.cmp-tipo{display:flex;align-items:baseline;gap:8px;padding:4px 0;border-bottom:1px solid var(--cmp-linea);}
.cmp-tipo:last-child{border-bottom:none;}
.cmp-tipo-px{font-size:11px;color:var(--cmp-t3);width:52px;flex:0 0 52px;font-variant-numeric:tabular-nums;}
.cmp-tipo-muestra{color:var(--cmp-t1);line-height:1.2;white-space:nowrap;}
.cmp-tipo-para{font-size:11px;color:var(--cmp-t3);flex:1;min-width:0;}

.cmp-colores{display:flex;flex-direction:column;gap:3px;}
.cmp-color{display:flex;align-items:center;gap:8px;font-size:11px;}
.cmp-muestra{width:26px;height:16px;border-radius:4px;border:1px solid var(--cmp-linea2);flex:0 0 26px;}
.cmp-color-rol{color:var(--cmp-t2);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}
.cmp-color-hex{color:var(--cmp-t3);font-variant-numeric:tabular-nums;font-size:10px;}

/* Tablas de la ficha y la comparativa */
.cmp-tabla{width:100%;font-size:12px;}
.cmp-tabla th{
  text-align:left;font-size:11px;font-weight:600;color:var(--cmp-t2);
  padding:5px 8px;border-bottom:1px solid var(--cmp-linea2);
  vertical-align:bottom;
}
.cmp-tabla td{padding:5px 8px;border-bottom:1px solid var(--cmp-linea);color:var(--cmp-t2);vertical-align:top;}
.cmp-tabla tbody tr:last-child td{border-bottom:none;}
.cmp-tabla tr[data-zebra='si'] td{background:var(--cmp-sup2);}
.cmp-tabla .cmp-cifra{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--cmp-t1);}
.cmp-tabla-caja{border:1px solid var(--cmp-linea);border-radius:var(--cmp-r);background:var(--cmp-sup);overflow:auto;}

/* Un ratio que no llega al umbral se dice con palabra e icono, no solo con
   color: el 8 % de los hombres no distingue rojo de verde, y esa es
   exactamente una de las cosas que se están juzgando aquí. */
.cmp-ratio{display:inline-flex;align-items:center;gap:4px;font-variant-numeric:tabular-nums;white-space:nowrap;}
.cmp-ratio[data-ok='no']{color:var(--cmp-mal);font-weight:600;}
.cmp-ratio[data-ok='si']{color:var(--cmp-t1);}
.cmp-ratio svg{width:12px;height:12px;flex:0 0 12px;}
.cmp-td-hoy{color:var(--cmp-t3);}
.cmp-td-hoy[data-falla='si']{color:var(--cmp-mal);}

.cmp-col-prop{width:150px;}
.cmp-col-prop[data-on='1']{background:var(--cmp-acc-suave);}

/* ---------------- Pestañas de la ficha ---------------- */
.cmp-pestanas{display:flex;gap:2px;padding:0 12px;background:var(--cmp-sup2);border-bottom:1px solid var(--cmp-linea);overflow-x:auto;}
.cmp-pestana{
  padding:7px 9px;font-size:12px;font-weight:500;color:var(--cmp-t3);
  border-bottom:2px solid transparent;white-space:nowrap;
}
.cmp-pestana:hover{color:var(--cmp-t1);}
.cmp-pestana[data-on='1']{color:var(--cmp-t1);border-bottom-color:var(--cmp-acc);font-weight:600;}

/* ---------------- Móvil ---------------- *
 * Por debajo de 1100 px la ficha deja de ir al lado y pasa debajo: la maqueta
 * necesita el ancho entero para que la escala no la deje ilegible. Por debajo
 * de 700, los mandos se apilan y se puede seguir saltando de una propuesta a
 * otra, que es lo mínimo que tiene que funcionar en un móvil.
 */
@media (max-width: 1100px){
  .cmp-obra{flex-direction:column;}
  .cmp-ficha{width:100%;flex:1 1 auto;}
}
@media (max-width: 700px){
  .cmp-mandos{position:static;}
  .cmp-fila{gap:6px;}
  .cmp-grupo{width:100%;}
  .cmp-op{flex:1;justify-content:center;padding:0 6px;}
  .cmp-tecla{display:none;}
  .cmp-h1{font-size:17px;}
  .cmp-ficha{flex:1 1 auto;}
  /* Sin esto, el aviso de «modo principal» va en una línea de 374 px y empuja
     la página entera de lado. Medido: scrollWidth 409 contra un ancho de 375. */
  .cmp-marca-modo{white-space:normal;width:100%;}
  .cmp-et{width:100%;}
  .cmp-crece{display:none;}
  .cmp-btn{width:100%;justify-content:center;}
}
`
