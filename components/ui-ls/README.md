# Kit visual común (`components/ui-ls`)

Las piezas con las que se rehacen los módulos administrativos. Muestrario en vivo, solo para administradores: **`/dashboard/kit`** (no está en el menú).

```ts
import { CabeceraDeModulo, Tarjeta, Kpi, FilaDeKpis, Pestanas, Segmentado, TablaAdaptable, PanelLateral } from '@/components/ui-ls'
```

## Lenguaje visual

- **Oscuro primero**, y el claro sale solo: todo usa los tokens `--ls-*` de `app/globals.css`. **Ningún color suelto**: estados desde `COLOR_ESTADO` (`lib/estilo/denso`), gráficos desde `VIZ` (`--viz-1..6`) y el acento del módulo desde `ACENTO`.
- **Acento por módulo**: `marketing` naranja, `seo` azul eléctrico, `cumplimiento` ámbar (y rojo), `remesas` cian, `personas` violeta, `cuentas` verde, `marca` (el naranja de siempre). Va en el icono de la cabecera, en el filo de las tarjetas, en los indicadores y en los gráficos. **Nunca en texto largo**.
- **Densidad: aire moderado.** Texto de trabajo de 13–14 px, rótulos de 12, cifras grandes de 24–26. Radios: **14** las tarjetas y paneles, 10 los botones y campos, `full` las insignias. No uses `rounded-lg` ni `rounded-md`: en este repo valen 24 y 12 px. Usa `rounded-[14px]` y `rounded-[10px]`.
- **Tarjetas con capas**: superficie `--ls-sup` + velo de luz arriba (`--ls-velo`) + sombra `--ls-sombra-1`. Al levantarse, `--ls-sombra-2`; los modales, `--ls-sombra-3`.
- **Movimiento con gusto y que se pueda quitar**: entrada escalonada (`indice` en Tarjeta y Kpi, o la clase `.ls-aparecer` con `--ls-i`), hover que levanta (`.ls-elevar`), cifras que cuentan e indicadores con `layoutId`. Todo respeta *reducir movimiento* (CSS bajo `prefers-reduced-motion` y `MotionConfig reducedMotion="user"`). **No animes listas largas fila a fila**: pagina (TablaAdaptable lo hace) y el escalonado se corta a 12 pasos.
- **Móvil**: nada desborda a 375 px; las tablas pasan a tarjetas; los controles miden **44 px** con el dedo (`TACTIL`); los paneles pasan a hoja inferior. La decisión es por CSS (`lg:`), no con `useIsMobile`, para que no salte al hidratar.
- **Cargando = esqueletos** con la forma de lo que va a llegar, nunca un spinner a pantalla completa. **Vacío = qué pasa + qué hacer** (siempre con acción si la hay).

## Piezas

| Pieza | Para qué | Lo esencial |
|---|---|---|
| `CabeceraDeModulo` | Arriba de cada pantalla | `icono`, `titulo`, `subtitulo`, `acento`, `acciones`, `migas`, `debajo` (pestañas), `junto` (insignia). Pegajosa y compacta en el móvil. |
| `Tarjeta` | La caja de todo | `variante` `normal` · `interactiva` (levanta, foco de luz; con `onClick`/`href` es accesible) · `destacada` (filo y halo del acento; una o dos por pantalla). `titulo`, `subtitulo`, `icono`, `acciones`, `pie`, `sinRelleno`, `indice`. |
| `Kpi` / `FilaDeKpis` | Cifras clave | `valor` (número), `formato`, `anterior` + `mejor` (`sube`/`baja`/`neutro`) para la variación, `serie` para la sparkline, `cargando`. La fila es rejilla en el PC y carrusel con imán en el móvil. Sueltas: `CifraAnimada`, `Variacion`, `Chispa`. |
| `Pestanas` | Secciones de una pantalla | `opciones` (`id`, `texto`, `icono`, `cuenta`), `valor`, `onCambio`, `etiqueta`, `acento`, `idPanel`. Flechas, Inicio y Fin. Con `PanelDePestana id key={tab}`. |
| `Segmentado` | Opciones excluyentes (periodo, vista) | La misma API que `Pestanas`; `tamano`, `anchoCompleto`. |
| `TablaAdaptable` | Listados | `columnas` declarativas (`celda`, `ordenar`, `alinear`, `movil`: `titulo`/`subtitulo`/`insignia`/`dato`/`oculto`), `filas`, `claveDe`, `alPulsarFila`, `filaActiva`, `ordenInicial`, `porPagina` (25), `acciones`, `vacio`, `cargando`. |
| `PanelLateral` | Detalle o edición sin cambiar de pantalla | Radix Dialog en portal: derecha en el PC, hoja inferior en el móvil. `abierto`, `onCambio`, `titulo`, `descripcion`, `icono`, `acento`, `pie`, `ancho`. |
| `Confirmacion` | Lo irreversible | Hay que escribir `palabra` («BORRAR»; `null` = confirmación simple). `onConfirmar` puede ser asíncrona: el botón espera y solo cierra si no falla. |
| `BarraCambiosSinGuardar` | Formularios largos | `visible`, `cuantos`, `onGuardar`, `onDescartar`, `guardando`. En portal; avisa al cerrar la pestaña; Ctrl/Cmd + S guarda. |
| `EstadoVacio` | Sin datos | `icono`, `titulo`, `descripcion`, `accion`/`accionSecundaria` (`onClick` o `href`), `acento`, `compacto`. |
| `Esqueleto`, `EsqueletoTexto`, `EsqueletoTarjeta`, `EsqueletoTabla` | Cargando | Con la forma real. |
| `Insignia` / `InsigniaDeEstado` | Estados | `tono` de `COLOR_ESTADO`, `variante` `suave`/`solida`/`contorno`, `vivo` (punto que late). `InsigniaDeEstado estado="en_curso"` usa la paleta común `TONO_DE_ESTADO`. |
| `BarraDeProgreso` | Avance, capacidad, presupuesto | `valor`/`maximo`, `etiqueta`, `mostrarPorcentaje`, `umbrales` (`{ ambar, rojo }`), `tono` o `acento`. |
| `LineaDeTiempo` | Historiales | `eventos` (`titulo`, `cuando`, `tono`, `icono`, `autor`, `descripcion`); corta a `maximo` (25). |
| `Avatar` / `GrupoDeAvatares` | Personas | Iniciales con **color estable** por nombre; `src` opcional, `estado` (punto). |
| `Boton` | Acciones | `variante` `primario` (uno por pantalla) · `secundario` · `fantasma` · `peligro`; `icono`, `soloIcono` (+ `aria-label`), `cargando`, `asChild` para `Link`. |

Lógica pura (con pruebas en `utilidades.prueba.ts`, `npx tsx components/ui-ls/utilidades.prueba.ts`): `leerVariacion`, `ordenarFilas`, `paginar`, `haceCuanto`, `iniciales`, `tonoEstable`, `palabraCoincide`, `formatoEuros`, `formatoPorcentaje`, `formatoEntero`, `mezcla(color, %)`.

## Esqueleto de una pantalla

```tsx
<div className="mx-auto w-full max-w-[1280px]">
  <CabeceraDeModulo icono={Truck} acento="remesas" titulo="Remesas" subtitulo="…" acciones={<Boton variante="primario" icono={Plus}>Nueva</Boton>}
    debajo={<Pestanas etiqueta="Secciones" acento="remesas" opciones={…} valor={tab} onCambio={setTab} idPanel="panel" />} />
  <PanelDePestana id="panel" key={tab}>
    <FilaDeKpis>{/* 3-5 Kpi con indice={i} */}</FilaDeKpis>
    <div className="mt-5 grid gap-4 lg:grid-cols-3">{/* Tarjetas */}</div>
    <TablaAdaptable className="mt-5" … />
  </PanelDePestana>
</div>
```

## Reglas para no romper nada

- Los `fixed` propios van en **portal** (`createPortal` o Radix): `.pagina-de-ruta` deja un `transform` puesto y un `fixed` dentro se coloca respecto a ella.
- Los tokens nuevos están al final de `app/globals.css` (bloque «KIT VISUAL COMÚN»): solo añaden; no cambian los de arriba ni la capa de traducción.
- No importes piezas de otro módulo (`marketing-test/piezas`, `remesas/comun/ui`…): lo común vive aquí.
