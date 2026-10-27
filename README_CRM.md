# CRM de clientes · el hub

El CRM deja de ser una lista con una ficha larga y pasa a ser **el hub de cada cliente**: en qué fase está (con la línea visual), lo que se habló en la reunión (las notas de Gemini, leídas de Gmail y desglosadas por la IA), la propuesta que se le va a hacer, la actividad, los documentos y los datos.

Es la **base de lo que viene después**: generar la propuesta sola a partir de lo hablado y un editor visual para sacarla en PDF. Por eso lo que se guarda tiene la forma de las páginas de la propuesta (ver «El plan de propuesta»).

- Pantalla: `/dashboard/crm` (app `crm` en el menú lateral; `?cliente=<id>` abre una ficha concreta). Antes vivía dentro de Agenda; `/dashboard/agenda/crm` redirige.
- Acceso: dirección (admin/partner) y quien tenga el permiso suelto `equipo-comercial` (supervisión, **solo lectura**).
- Migración: `supabase/migrations/258_crm_hub_fases_y_notas_de_reunion.sql` (se lanza a mano en el editor SQL de Supabase; el código funciona sin ella, sin historial ni notas, y lo dice).

---

## 1. Qué hay en la pantalla

| Pieza | Dónde | Qué hace |
|---|---|---|
| Cifras del embudo | `HubCrm.tsx` | clientes, abiertos, cerrados y % de los decididos, ciclo medio, acciones vencidas, set up del mes, coste del equipo (solo dirección) |
| Filtros | `HubCrm.tsx` | por fase (con «Abiertos»), responsable, «acción vencida» y orden |
| Lista | `ListaClientes.tsx` | por cliente: fase, días en ella, próxima acción (en rojo si venció), interés de la última reunión, nº de reuniones |
| **Línea de fases** | `LineaDeFases.tsx` | los 6 pasos con fecha y días; lo saltado, lo pendiente y «Perdido» aparte. Quien edita mueve al cliente pulsando un nodo (con «Deshacer») |
| Pestaña Resumen | `PestanaResumen.tsx` | siguiente paso, lo último de la reunión, dolores, estado de la propuesta, cita y dinero |
| Pestaña Reunión | `PestanaReunion.tsx` + `DesgloseDeLaIA.tsx` + `GuionDeLaReunion.tsx` | el desglose de la IA, el guion de preguntas («Pasar al guion») y las notas originales de Gemini (resumen, detalle, transcripción) |
| Pestaña Propuesta | `PestanaPropuesta.tsx` | el plan editable, importes y PDFs enviados |
| Pestaña Actividad | `PestanaActividad.tsx` | tomas de contacto, historial de fases y reuniones |
| Pestaña Documentos | `PestanaDocumentos.tsx` | propuestas y contratos (PDF) |
| Pestaña Datos | `PestanaDatos.tsx` | contacto, empresa, cita (cualificada o no), responsable, próxima acción, notas internas |
| Bandeja «Notas de reunión» | `BandejaDeNotas.tsx` | las reuniones sin cliente (asignarlas), las que fallaron y el botón «Sincronizar ahora» |

Estilo: el denso del ERP (`lib/estilo/denso.ts`, tokens `--ls-*`), claro y oscuro.

## 2. Las fases

`crm_clients.stage`: `nuevo → seguimiento → propuesta_enviada → revision_propuesta → negociacion → ganado`, y `perdido` como **salida** (no es un paso del camino).

Hasta la 258 solo se guardaba la fase de hoy. Ahora un disparador (`trg_crm_registra_etapa`) anota cada cambio en `crm_etapas_historial` (qué fase, desde cuándo, quién, `origen`: `alta` | `manual` | `recuperado`). `lib/crm/fases.ts` (puro) saca de ahí la línea:

- **Saltada** solo donde el historial es de fiar (una ficha nacida con la 258). De lo anterior a la migración no consta nada y se pinta como recorrida, sin fecha.
- Una fecha **recuperada** (ficha anterior a la 258) es aproximada y la pantalla lo dice («~14 oct»).
- «Lleva X días» cuenta desde la **última** vez que entró en la fase (si se devolvió a «Nuevo», desde que volvió).

## 3. Las notas de Gemini: de Gmail a la ficha

Al acabar una reunión de Meet con las notas de Gemini encendidas, Google manda **un correo** a `business@` (de `gemini-notes@google.com`) y deja un **documento «Notas de Gemini»** en Drive (pestañas «Notas» y «Transcripción»). El correo trae resumen, temas y pasos; el documento, además, las decisiones, el detalle, la transcripción con quién habla, el correo del invitado y el enlace al evento del calendario.

```
Gmail ──► correo.ts / gmail.ts ──┐
                                  ├─► sincronizar.ts ──► crm_notas_reunion ──► analisis.ts (IA) ──► desglose
Drive/Docs ─► documento.ts ───────┘        │
                                       casar.ts  (a qué cliente)
```

| Módulo (`lib/crm/gemini/`) | Qué hace |
|---|---|
| `correo.ts`, `gmail.ts` | lee el correo (asunto, cuerpo en texto plano partido a 80 columnas, enlace al documento) |
| `documento.ts` | lee el documento de la API de Docs (árbol de pestañas) y el nombre `<título> - 2026/10/20 10:02 CEST - Notas de Gemini` (hora de inicio) |
| `casar.ts` | a qué cliente pertenece (ver abajo) |
| `analisis.ts` | el desglose con IA (esquema estricto; modelo `CRM_MODELO_ANALISIS`, por defecto `gpt-5.6-terra`) |
| `sincronizar.ts` | una pasada: correos nuevos → documento → casar → guardar → analizar. Idempotente |
| `google.ts`, `errores-google.ts` | conexión de **solo lectura** a Gmail y Docs y mensajes que dicen qué hay que activar |
| `almacen.ts`, `servidor.ts`, `rutas.ts` | la cara de Supabase y las rutas |

**Solo entran las reuniones con clientes** (título `Consultoría Estratégica Amazon · Liberty Seller · <nombre>`). Las internas («Reunión Semanal | Comerciales», «Onboarding de…») solo dejan apuntados el id y el título con estado `ignorada` para no releerlas: de cada correo se pide **primero solo el asunto y el remitente** (`format=metadata`, sin cuerpo), y si es interno **ni el correo ni su documento se abren**: su texto no sale de Gmail. Una reunión sin título («Reunión del 23 oct a las 12:03») sí abre el documento para ver si enlaza una cita del ERP o trae el correo de un lead; si no, se ignora.

### A qué cliente va una nota (`casar.ts`)
De más a menos fiable, parando en la primera pista que da **un** cliente:
1. **Evento**: el enlace `calendar/event?eid=` del documento, decodificado (base64 de «idDelEvento calendario»), es exactamente `appointments.google_event_id`.
2. **Invitado**: el correo del invitado = `lead_email` (si hay varias fichas del mismo lead, gana la cita más cercana a la reunión).
3. **Nombre**: el del título se parece al del lead **y** la cita cae en las 48 h de la reunión (con un solo nombre de pila, el mismo día).

Si ninguna pista da un cliente, la nota queda `sin_cita` y se asigna a mano en la bandeja (`metodo_cita = 'manual'`, que la sincronización ya no toca). **Equivocarse de cliente es peor que no casar.**

### Estados de una nota (`crm_notas_reunion.estado`)
`pendiente` (con cliente, falta el análisis) · `procesada` · `sin_cita` · `error` (el análisis falló 4 veces) · `ignorada` (reunión interna).

## 4. El análisis con IA

Una sola llamada por reunión, JSON de esquema estricto. La forma sigue lo que la guía `propuesta-amazon-liberty-seller` manda extraer de una llamada: cliente, negocio, facturación, mercados, **3–4 dolores**, oportunidades, alcance, pasos acordados; más lo que hace falta para trabajar la ficha (interés, objeciones, respuestas del guion, fase sugerida) y para la propuesta (servicios, plan en dos fases, riesgos).

Reglas que no se rompen:
- **No inventa**: un campo vacío vale más que uno inventado; todo se limpia y se acota antes de guardar (`leerAnalisis`).
- **Sin importes de propuesta.** Lo dicho sobre dinero se guarda aparte, tal cual (`cifras_dichas`). Setup, cuota base y % los pone una persona.
- Las respuestas del guion solo llevan claves de `PREGUNTAS_REUNION` y **nunca pisan** lo que una persona ya escribió (`respuestasParaElGuion`).
- La fase sugerida es una **sugerencia**: la fase la cambia una persona.
- Coste: ~20.000 tokens de entrada y ~3.000 de salida por reunión de 40 min → **~0,08 $** con `gpt-5.6-terra`.

## 5. El plan de propuesta (la base del PDF)

`crm_clients.propuesta_plan` (JSONB; forma en `lib/crm/propuesta.ts`). Sigue las páginas de la propuesta comercial:

| Página del PDF | Campo del plan |
|---|---|
| Portada | `servicios` (3–4, con motivo y prioridad) y `enfoque` |
| 01 · Diagnóstico | los `dolores` del análisis + `datos_clave` (3) |
| 02 · Plan de ejecución | `fase_setup` (meses 1–3, 4 pasos) y `fase_crecimiento` (mes 4+, 4 pasos) |
| 04 · Económica | `setup_budget`, `maintenance_budget` (columnas de la ficha) y `variable_pct` (3 % por defecto) |
| 05 · Siguiente paso | `riesgos` y los próximos pasos |

«Usar esta propuesta» copia la sugerida por la IA al plan (sin importes) para retocarla. `avanceDeLaPropuesta` dice qué piezas faltan: cuando están las seis, se podrá generar el PDF.

**Lo que viene (no está hecho):** generar el PDF solo desde este plan con la plantilla maestra y un editor visual. El contrato de datos ya existe; falta el generador.

## 6. Permisos
- Ver el CRM: dirección y `equipo-comercial`. Las tablas nuevas se leen con `puede_ver_equipo_comercial(uid)` (RLS de la 258).
- **Escribir** las tablas nuevas: solo el servidor (no tienen políticas de escritura). Sincronizar, analizar y asignar son rutas de **dirección**.
- Cambiar la ficha, la fase, los importes o la cita: dirección (la RLS de `crm_clients` de la 080). Quien supervisa lee y apunta tomas de contacto.
- El coste del equipo comercial: solo dirección.

## 7. Puesta en marcha

1. **SQL**: lanzar `258_crm_hub_fases_y_notas_de_reunion.sql` en el editor SQL de Supabase (idempotente).
2. **Google Workspace** (administrador): *Seguridad → Control de acceso y de datos → Controles de API → Delegación en todo el dominio*. El ID de cliente de la cuenta de servicio **ya está** (lo usa la Agenda con el permiso de Calendar): se **edita** esa entrada y se **añaden** los dos permisos nuevos **conservando el de Calendar** (si se quita, la Agenda deja de sincronizar):
   `https://www.googleapis.com/auth/calendar,https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/documents.readonly`.
   Se pide `documents.readonly` y no `drive.readonly` a propósito: lo justo para leer el documento de Gemini, sin lectura sobre el resto del Drive del buzón.
3. **Google Cloud** (proyecto de la cuenta de servicio): activar las APIs **Gmail** y **Google Docs**.
4. Variables (ya están las de la Agenda): `GOOGLE_SA_CLIENT_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, `GOOGLE_IMPERSONATE_SUBJECT` (`business@`, el buzón que recibe las notas), `OPENAI_API_KEY`. Opcional: `CRM_MODELO_ANALISIS`.
5. En la pantalla: *Notas de reunión → Sincronizar ahora*. Si falta algo, lo dice con la frase de qué hacer.

Mientras falten los permisos, cada pasada sale en rojo en **Sistema** con esa frase y no hace nada más. Las notas ya guardadas se siguen analizando.

## 8. Operación
- Proceso `notas-gemini` (Sistema → procesos): cada 3 min (`scripts/notas-gemini.sh` → `/api/crm/notas-gemini/cron`). Apagarlo lo detiene todo (ni lee ni gasta).
- Una pasada mira los últimos 30 días, procesa hasta 20 correos nuevos y analiza hasta 2 notas. Se salta lo ya guardado (índice único por correo y por documento).
- Un análisis que falla reintenta (cada 10 min, hasta 4 veces) y luego queda en `error`; «Reintentar» en la bandeja lo relanza.
- Una nota guardada solo con el correo (porque el documento no se pudo abrir) se completa sola cuando se puede, y si ya se había analizado, vuelve a la cola.

## 9. Pruebas
`lib/crm/**/*.prueba.ts` (puras, con `tsx`): `fases`, `lista`, `propuesta`, `gemini/{correo,gmail,documento,casar,analisis,errores-google,sincronizar}`. La sincronización se prueba entera con un Google y una base de mentira. Ningún texto de un cliente real vive en el repositorio: todos los ejemplos están inventados.

## 10. Para ampliar
- Un campo nuevo en el desglose: `tipos.ts` (forma) → `analisis.ts` (esquema, prompt y `leerAnalisis`) → `DesgloseDeLaIA.tsx`.
- Otra fuente de notas (p. ej. una llamada de Rinkel): produce una `NotaLeida` y entra por `sincronizar.ts`.
- El generador de PDF: lee `propuesta_plan`, `setup_budget`, `maintenance_budget` y el análisis; no debe inventar importes.
