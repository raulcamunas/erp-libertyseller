/**
 * UN BRIEFING DE EJEMPLO, INVENTADO, CON LA FORMA EXACTA DEL QUE PUBLICA LA RUTINA.
 * Sirve para las pruebas del validador y para ver la pantalla sin esperar a la rutina (la vista previa de Vite y la demostración del propio ERP). Ni un nombre,
 * una cifra ni un enlace son de verdad.
 */

export const BRIEFING_DE_EJEMPLO = {
  fecha_label: 'Martes 27 de octubre de 2026',
  actualizado: '27/10 · 07:40',
  titular: 'Tres clientes esperan respuesta y no hay citas esta semana',
  agenda: [
    { hora: '9:00', titulo: 'Reunión con Dora (Acme)', nota: 'Meet · confirmada' },
    { hora: 'Mañana 10:00', titulo: 'Seguimiento semanal Brisa', nota: 'Meet · 3 sin confirmar' },
  ],
  revisar: [
    { nivel: 'alta', area: 'Comercial', titulo: 'Nadie registra recap desde el jueves', texto: 'Faltan los recaps del 23 y 26/10; la semana va sin ninguna cita.', fuente: 'Briefings comerciales', url: 'https://app.notion.com/p/ejemplo-1' },
    { nivel: 'alta', area: 'Brisa', titulo: 'Unos 180 listings bloqueados por precio', texto: 'Se dieron pautas en Notion; el cliente sigue sin contestar por correo.', fuente: 'Gmail · Brisa, 25/10', url: 'https://mail.google.com/mail/#all/ejemplo-2' },
    { nivel: 'media', area: 'Acme', titulo: 'Asesoría espera respuesta a cinco dudas', texto: 'Preguntó por liquidaciones e IVA el 23/10; sigue sin respuesta.', fuente: 'Gmail · Acme, 23/10', url: 'https://mail.google.com/mail/#all/ejemplo-3' },
    { nivel: 'media', area: 'Raúl y Marius', titulo: 'Tareas propias paradas al 0 %', texto: 'Cinco tareas de Brisa sin avance desde septiembre.', fuente: 'Tableros de clientes', url: 'https://app.notion.com/p/ejemplo-4' },
  ],
  comerciales: {
    periodo: 'Lunes 26/10 (sin recaps; últimos del 21-22/10)',
    totales: { llamadas: 90, whatsapps: 23, respuestas: 17, citas: 0 },
    kpi_nota_llamadas: '0 de 5 con registro del lunes',
    kpi_nota_citas: 'Ninguna esta semana',
    lectura: 'Dos días laborables seguidos sin recaps y ninguna cita agendada esta semana.',
    alertas: [
      { quien: 'Todos', texto: 'sin recap del 23/10 ni del 26/10.' },
      { quien: 'Lucía', texto: 'último recap (22/10) vacío.' },
    ],
    personas: [
      { nombre: 'Lucía', url: 'https://app.notion.com/p/ejemplo-5', llamadas: null, whatsapps: null, respuestas: null, citas: null, resumen: 'Último recap (22/10) creado sin rellenar.' },
      { nombre: 'Mateo', url: 'https://app.notion.com/p/ejemplo-6', llamadas: 37, whatsapps: 15, respuestas: 7, citas: null, resumen: 'Datos del 21/10; siete respuestas sin cita.' },
      { nombre: 'Irene', url: null, llamadas: 15, whatsapps: 5, respuestas: 2, citas: 0, resumen: 'Datos del 22/10; volumen más bajo y sin notas.' },
    ],
  },
  equipo: {
    periodo: 'Lunes 26/10',
    personas: [
      { nombre: 'Clara', rol: 'Publicidad', fecha_label: '26/10', url: 'https://app.notion.com/p/ejemplo-7', hecho: ['Brisa: optimización semanal, ACOS 38,6 %', 'Acme: revisión SEO'], en_curso: ['Acme: revisar campaña amplia'], bloqueos: ['Nube: sin stock'] },
      { nombre: 'Daniel', rol: 'Catálogo y listings', fecha_label: '26/10', url: null, hecho: ['Brisa: nueve referencias cargadas'], en_curso: [], bloqueos: [] },
    ],
    sin_briefing: [{ nombre: 'Nuria', ultimo: '2026-09-11' }],
  },
  tareas: {
    nota: '16 tableros de cliente leídos',
    totales: { en_progreso: 60, en_revision: 4, sin_responsable: 12, clientes: 16 },
    comentarios: [{ tarea: 'Error de precios', cliente: 'Brisa', autor: 'Marius', fecha: '26/10 21:10', texto: 'Activos bajan de 1.900 a 1.668; unos 180 bloqueados.', pide: false, url: 'https://app.notion.com/p/ejemplo-8' }],
    en_revision: [{ tarea: 'Cumplimiento normativo Italia', cliente: 'Nube', responsable: 'Daniel', checklist: '5/8', url: 'https://app.notion.com/p/ejemplo-9' }],
    destacadas: [{ tarea: 'Preparar 5 productos para la primera campaña', cliente: 'Acme', responsable: 'Raúl', checklist: '0/3', texto: 'Asignada desde el 22/09, sin avance.', url: 'https://app.notion.com/p/ejemplo-10' }],
    por_cliente: [
      { cliente: 'Nube', pendientes: 10, en_revision: 2 },
      { cliente: 'Acme', pendientes: 9, en_revision: 1 },
      { cliente: 'Brisa', pendientes: 4, en_revision: 0 },
    ],
  },
  correo: [
    { nivel: 'alta', titulo: 'Brisa: listings desactivados por precio', de: 'Ana · Brisa', fecha: '25/10 07:23', texto: 'Reenvía el aviso de Amazon; sin respuesta por correo.', url: 'https://mail.google.com/mail/#all/ejemplo-2' },
    { nivel: 'media', titulo: 'Amazon: verificar roles antes de 2027', de: 'Amazon Solution Provider Portal', fecha: '26/10 21:50', texto: 'Revisar roles aprobados antes de la reautorización.', url: 'https://mail.google.com/mail/#all/ejemplo-11' },
  ],
  pie: 'Fuentes: briefings y tableros en Notion, Gmail y Google Calendar. Se actualiza de lunes a viernes antes de las 8:00.',
}
