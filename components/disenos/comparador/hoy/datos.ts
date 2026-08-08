/**
 * Contenido para la réplica de «como está hoy».
 *
 * Los módulos, los estados, sus etiquetas y sus pistas NO se copian: se importan
 * de donde vive el ERP de verdad (lib/config/apps.ts y lib/types/cold-leads.ts).
 * Si mañana se añade un módulo o se cambia una etiqueta, la referencia cambia
 * sola y sigue siendo una referencia.
 *
 * Las CIFRAS, los estados y las notas son inventados, pero del tamaño y la forma
 * de los reales: importes de cinco y seis cifras, nombres largos que hay que
 * truncar, teléfonos con formato español, notas de seguimiento de una frase. Una
 * maqueta con «Lorem ipsum» no deja mirar una tabla y decir si se trabaja mejor o
 * peor con ella.
 *
 * Los NOMBRES, en cambio, son de cuentas y clientes reales de la agencia. Por eso
 * la pantalla está cerrada a admin: ver app/dashboard/disenos/page.tsx.
 */

import { apps } from '@/lib/config/apps'
import type { ColdLeadStatus } from '@/lib/types/cold-leads'

/* ------------------------------------------------------------------ */
/* Pantalla 1 — la rejilla de inicio                                   */
/* ------------------------------------------------------------------ */

/**
 * Los 18 módulos, en el orden en que están hoy en la barra lateral y en la
 * rejilla: el orden en que se fueron escribiendo, no el de uso.
 *
 * Se EXCLUYE 'disenos' a propósito. Este comparador se dio de alta en
 * lib/config/apps.ts para poder abrirse, y eso subió la lista viva de 18 a 19
 * entradas. Si no se filtrara, la referencia «como está hoy» pintaría 19
 * tarjetas —una de ellas, esta misma app— y la comparación de la portada
 * dejaría de ser de manzanas con manzanas: la referencia con 19 y las tres
 * propuestas con 18. El comparador no es un módulo del ERP de antes.
 */
export const MODULOS_HOY = apps.filter((a) => a.id !== 'disenos')

/** La única información viva de toda la pantalla de inicio */
export const LEADS_SIN_LEER = 7

/* ------------------------------------------------------------------ */
/* Pantalla 2 — Cold Calling                                           */
/* ------------------------------------------------------------------ */

export interface LeadHoy {
  id: string
  tienda: string
  empresa: string
  facturacion: number | null
  estado: ColdLeadStatus
  telefono: string | null
  rellamar: string | null
  seguimiento: string
  email: string | null
  provincia: string
  categoria: string
  lista: string
}

function L(
  id: string,
  tienda: string,
  empresa: string,
  facturacion: number | null,
  estado: ColdLeadStatus,
  telefono: string | null,
  rellamar: string | null,
  seguimiento: string,
  email: string | null,
  provincia: string,
  categoria: string,
  lista: string
): LeadHoy {
  return { id, tienda, empresa, facturacion, estado, telefono, rellamar, seguimiento, email, provincia, categoria, lista }
}

export const LEADS_HOY: LeadHoy[] = [
  L('h01', 'Calzados Aurora', 'Calzados Aurora S.L.', 184200, 'cita_cualificada', '+34 963 41 22 08', null, 'Sesión el 12 ago con Marius. Vienen de Shopify, 2 marcas.', 'pedro@calzadosaurora.es', 'Valencia', 'Zapatos y complementos', '1a lista'),
  L('h02', 'Nordik Home', 'Nordik Home Iberia S.L.', 152800, 'seguimiento', '+34 932 08 71 44', '2026-08-11', 'Pide números de otra cuenta de deco antes de decidir.', 'compras@nordikhome.es', 'Barcelona', 'Hogar y jardín', '1a lista'),
  L('h03', 'BioNatura Shop', 'Bionatura Distribución S.L.', 141500, 'programado', '+34 954 33 90 17', '2026-08-08', 'Rellamar viernes 10:00. Habla el hijo, no el titular.', 'info@bionaturashop.com', 'Sevilla', 'Salud y cuidado personal', 'Alejandro V2'),
  L('h04', 'ToolPro Ibérica', 'Toolpro Ibérica S.A.', 138900, 'no_contesta', '+34 976 22 14 65', '2026-08-08', '3 intentos, siempre buzón. Probar por LinkedIn.', null, 'Zaragoza', 'Bricolaje y herramientas', '1a lista'),
  L('h05', 'Petit Coton', 'Petit Coton S.L.U.', 128400, 'email_enviado', '+34 917 65 30 21', null, 'Mandado dossier + caso Shoes F el 5 ago.', 'hola@petitcoton.es', 'Madrid', 'Bebé', 'Alejandro V2'),
  L('h06', 'Sport Fusion', 'Sport Fusion Levante S.L.', 119700, 'seguimiento', '+34 965 12 88 30', '2026-08-12', 'Le preocupa el stock: justo nuestro sincronismo.', 'gerencia@sportfusion.es', 'Alicante', 'Deportes', '1a lista'),
  L('h07', 'Casa Delgado', 'Delgado Hermanos S.L.', 112300, 'pendiente', '+34 957 40 55 12', null, '', 'admin@casadelgado.es', 'Córdoba', 'Hogar y jardín', '2a lista'),
  L('h08', 'Vinos del Duero', 'Bodegas del Duero S.L.', 108600, 'no_interesa', '+34 983 21 76 40', null, 'Tienen agencia desde enero. Revisar en 6 meses.', 'export@vinosduero.com', 'Valladolid', 'Alimentación y bebidas', '1a lista'),
  L('h09', 'Tech Andalucía', 'Tech Andalucía Distribución S.L.', 104100, 'cita_cualificada', '+34 952 60 19 03', null, 'Cita 14 ago 16:00. Facturan 60 % en DE.', 'direccion@techandalucia.es', 'Málaga', 'Electrónica', 'Alejandro V2'),
  L('h10', 'Mundo Mascota', 'Mundo Mascota Online S.L.', 98400, 'no_contesta', '+34 986 44 12 77', '2026-08-09', 'Centralita, no pasan. Buscar directo del director.', 'pedidos@mundomascota.es', 'Pontevedra', 'Mascotas', '2a lista'),
  L('h11', 'Ferretería Sanz', 'Sanz Suministros S.L.', 94200, 'programado', '+34 941 25 08 61', '2026-08-08', 'Rellamar hoy 12:30, después del reparto.', 'javier@ferreteriasanz.es', 'La Rioja', 'Bricolaje y herramientas', '1a lista'),
  L('h12', 'Aromas de Ronda', 'Aromas de Ronda S.L.U.', 91800, 'seguimiento', null, '2026-08-13', 'Marca propia, quiere Vine y A+ premium.', 'marta@aromasderonda.com', 'Málaga', 'Belleza', 'Alejandro V2'),
  L('h13', 'Kitchen Lab', 'Kitchen Lab Europe S.L.', 89300, 'email_enviado', '+34 938 71 40 25', null, 'Pidió tarifas por escrito. Enviado el 6 ago.', 'info@kitchenlab.eu', 'Barcelona', 'Cocina', '1a lista'),
  L('h14', 'Óptica Vistalia', 'Vistalia Retail S.L.', 84700, 'pendiente', '+34 928 33 61 09', null, '', 'compras@vistalia.es', 'Las Palmas', 'Salud y cuidado personal', '2a lista'),
  L('h15', 'La Textilera', 'La Textilera Manchega S.L.', 81200, 'no_contesta', '+34 926 50 22 18', '2026-08-10', '2 intentos. Mejor a primera hora.', 'ventas@latextilera.es', 'Ciudad Real', 'Textil hogar', '1a lista'),
  L('h16', 'GamerZone ES', 'Gamerzone Iberia S.L.', 78900, 'seguimiento', '+34 918 04 55 73', '2026-08-14', 'Quiere ver PPC antes. Pasar caso de Creative Toys.', 'ventas@gamerzone.es', 'Madrid', 'Videojuegos', 'Alejandro V2'),
  L('h17', 'Muebles Aitana', 'Muebles Aitana S.L.', 76100, 'no_interesa', '+34 965 77 30 12', null, 'Solo venden en su web, no quieren Amazon.', 'info@mueblesaitana.com', 'Alicante', 'Muebles', '2a lista'),
  L('h18', 'Naturcosmética', 'Naturcosmética Bio S.L.', 74300, 'programado', '+34 943 18 62 90', '2026-08-11', 'Rellamada lunes 09:30, la dueña.', 'ainhoa@naturcosmetica.es', 'Guipúzcoa', 'Belleza', '1a lista'),
  L('h19', 'Papelería Kraft', 'Kraft Papel y Regalo S.L.', 71500, 'pendiente', '+34 968 29 47 06', null, '', 'hola@papeleriakraft.es', 'Murcia', 'Oficina y papelería', '2a lista'),
  L('h20', 'Zapas Urban', 'Urban Sneakers S.L.', 69800, 'cita_cualificada', '+34 913 55 20 84', null, 'Cita 19 ago. Ya venden en FR, quieren IT y DE.', 'direccion@zapasurban.es', 'Madrid', 'Zapatos y complementos', '1a lista'),
  L('h21', 'Herbolario Vital', 'Vital Herbolarios S.L.', 67200, 'no_contesta', '+34 971 40 11 55', '2026-08-09', 'Solo cogen por las tardes.', 'pedidos@herbolariovital.es', 'Baleares', 'Salud y cuidado personal', 'Alejandro V2'),
  L('h22', 'Camper Store', 'Camper Store Outdoor S.L.', 64900, 'email_enviado', '+34 976 88 43 21', null, 'Dossier enviado el 4 ago, sin respuesta.', 'info@camperstore.es', 'Zaragoza', 'Deportes', '1a lista'),
  L('h23', 'Iluminia', 'Iluminia Lighting S.L.', 62400, 'seguimiento', '+34 934 62 07 19', '2026-08-15', 'Interesados en el sincronismo con su ERP (Sage).', 'compras@iluminia.com', 'Barcelona', 'Iluminación', '2a lista'),
  L('h24', 'Joyas Amaia', 'Amaia Joyeros S.L.', 60100, 'pendiente', '+34 944 12 88 07', null, '', 'amaia@joyasamaia.es', 'Vizcaya', 'Joyería', '1a lista'),
  L('h25', 'Pescados Ría', 'Pescados Ría de Arousa S.L.', 58700, 'no_interesa', '+34 986 91 33 40', null, 'Producto fresco, no encaja con FBA.', 'ventas@pescadosria.es', 'Pontevedra', 'Alimentación y bebidas', '2a lista'),
  L('h26', 'Bebé Nube', 'Bebé Nube Textil S.L.', 56300, 'programado', '+34 962 74 15 33', '2026-08-12', 'Rellamar martes. Están en plena temporada.', 'hola@bebenube.es', 'Valencia', 'Bebé', 'Alejandro V2'),
  L('h27', 'AutoParts Levante', 'Autoparts Levante S.L.U.', 54800, 'no_contesta', '+34 963 20 66 71', '2026-08-08', '4 intentos. Último aviso antes de descartar.', 'admin@autopartslevante.es', 'Valencia', 'Automoción', '1a lista'),
  L('h28', 'Té y Aromas', 'Té y Aromas Selección S.L.', 52100, 'seguimiento', '+34 918 33 02 47', '2026-08-18', 'Pide referencias de clientes de alimentación.', 'info@teyaromas.es', 'Madrid', 'Alimentación y bebidas', '2a lista'),
  L('h29', 'Mochilas Nomad', 'Nomad Bags S.L.', 49600, 'pendiente', '+34 972 51 44 90', null, '', 'ventas@nomadbags.es', 'Girona', 'Equipaje', '1a lista'),
  L('h30', 'Cerámica Talavera', 'Cerámicas de Talavera S.L.', 47300, 'programado', '+34 925 80 17 62', '2026-08-13', 'Rellamar el jueves, están de inventario.', null, 'Toledo', 'Hogar y jardín', '2a lista'),
]

/** Lo que dice literalmente app/dashboard/cold-calling/page.tsx: «Con casi 4.000 leads…» */
export const TOTAL_LEADS_HOY = 3847

/** Los cuatro indicadores de arriba, con sus textos reales */
export const KPIS_HOY = [
  { etiqueta: 'Leads en cartera', valor: '3.847', pie: null as string | null },
  { etiqueta: 'Trabajados', valor: '1.264', pie: 'de 3.847' },
  { etiqueta: 'Citas cualificadas', valor: '38', pie: '3,0 % de conversión' },
  { etiqueta: 'Rellamadas para hoy', valor: '12', pie: null },
]

export const LISTAS_HOY = ['1a lista', '2a lista', 'Alejandro V2']

/** El color de la píldora de lista sale de un hash del nombre */
export function colorDeLista(nombre: string): string {
  const paleta = ['#60A5FA', '#F472B6', '#34D399', '#FBBF24', '#A78BFA', '#22D3EE']
  let h = 0
  for (let i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) >>> 0
  return paleta[h % paleta.length]
}

/* ------------------------------------------------------------------ */
/* Pantalla 3 — el perfil de lectura de stock                          */
/* ------------------------------------------------------------------ */

export interface CampoHoy {
  etiqueta: string
  valor: string
  marcador?: string
  nota?: string
  obligatorio?: boolean
}

export const SECCIONES_HOY: {
  titulo: string
  hint: string
  campos: CampoHoy[]
  info?: string
}[] = [
  {
    titulo: 'El perfil',
    hint: 'Qué fichero es y de qué cliente',
    campos: [
      { etiqueta: 'Nombre', valor: 'Shoplamp · stock diario', nota: 'Sale en el historial y en los avisos.' },
      { etiqueta: 'Qué trae este fichero', valor: 'Stock (y precio)', nota: 'La otra opción es códigos de barras.' },
      { etiqueta: 'Perfil activo', valor: 'Sí', nota: 'Apagado, ni se lee ni se procesa. El historial se conserva.' },
    ],
  },
  {
    titulo: 'Dónde están los datos dentro del fichero',
    hint: 'Hoja, cabecera y formato',
    campos: [
      { etiqueta: 'Hoja (por nombre)', valor: '', marcador: 'Stock', nota: 'Vacío = la primera hoja del libro.' },
      { etiqueta: 'Hoja (por posición)', valor: '1', nota: 'Solo se mira si el nombre está vacío.' },
      { etiqueta: 'Fila de la cabecera', valor: '', marcador: 'automática', nota: 'Vacío = se busca en las primeras 20 filas la primera con dos celdas llenas.' },
      { etiqueta: 'Primera fila de datos', valor: '', marcador: 'la siguiente', nota: 'Vacío = justo debajo de la cabecera.' },
      { etiqueta: 'Separador del CSV', valor: 'Automático', nota: 'Punto y coma en los exports españoles, coma en los ingleses.' },
      { etiqueta: 'Codificación del CSV', valor: 'Automática (utf-8)', nota: 'Si las tildes salen como símbolos raros en la prueba, es latin1 o windows-1252.' },
    ],
  },
  {
    titulo: 'Las columnas',
    hint: 'Por nombre, nunca por posición',
    info: 'Se aceptan varios nombres separados por comas: se usa el primero que aparezca. No distingue tildes ni mayúsculas.',
    campos: [
      { etiqueta: 'Referencia del artículo', valor: 'Codigo articulo, Referencia', obligatorio: true, nota: 'Es la columna con la que se casa contra el SKU de Amazon.' },
      { etiqueta: 'Unidades en stock', valor: 'Stock real, Disponible', obligatorio: true, nota: 'Si trae decimales se redondea hacia abajo.' },
      { etiqueta: 'Precio', valor: 'PVP', nota: 'Vacío = no se toca el precio en Amazon.' },
      { etiqueta: 'Precio de respaldo', valor: '', marcador: 'sin columna', nota: 'Se usa solo si el precio principal viene vacío en esa línea.' },
      { etiqueta: 'Coste', valor: 'Coste medio', nota: 'No se envía a Amazon: sirve para el margen del informe.' },
    ],
  },
]

/** Los seis frenos, con tres apagados: es el caso que hay que ver */
export const FRENOS_HOY = [
  { etiqueta: 'Máximo del catálogo que puede irse a cero (%)', valor: '', nota: 'Si el volcado deja a cero más de este porcentaje, no se manda nada.' },
  { etiqueta: 'Variación máxima de precio de una línea (%)', valor: '', nota: 'Se mira la línea peor, no la media.' },
  { etiqueta: 'Caída máxima de líneas del fichero (%)', valor: '30', nota: 'Un fichero con 8.000 líneas menos es un volcado a medias, no un almacén vacío.' },
  { etiqueta: 'Caída máxima de unidades publicadas (%)', valor: '40', nota: 'Contra la media de los últimos siete días.' },
  { etiqueta: 'Máximo de cambios', valor: '', nota: 'El número de líneas que como mucho puede tocar una ejecución.' },
  { etiqueta: 'Líneas de un día normal', valor: '4.800', nota: 'La referencia contra la que se miden las caídas.' },
]

export const FRENOS_APAGADOS = 'Hay 3 frenos sin límite puesto, así que están apagados: referencias a cero, variación de precio, máximo de cambios'

/** Los cinco estados de una ejecución, con el matiz de simulacro en gris */
export const EJECUCIONES_HOY: { cuando: string; estado: string; tono: 'zinc' | 'ambar' | 'verde' | 'rojo'; detalle: string }[] = [
  { cuando: 'Hoy 06:30', estado: 'Enviado', tono: 'verde', detalle: '412 líneas cambiadas · 4.812 leídas' },
  { cuando: 'Ayer 06:30', estado: 'Frenado', tono: 'ambar', detalle: 'Caída de líneas del 38 % sobre el límite del 30 %' },
  { cuando: '6 ago 06:30', estado: 'Sin cambios', tono: 'zinc', detalle: '4.796 líneas leídas, ninguna distinta' },
  { cuando: '5 ago 06:30', estado: 'Simulacro', tono: 'zinc', detalle: 'No se envió nada: el perfil estaba en pruebas' },
  { cuando: '4 ago 06:31', estado: 'Error', tono: 'rojo', detalle: 'No se encuentra la columna «Stock real» en la hoja 1' },
]

/** Lo que devuelve el botón «Probar»: qué columna real se llevó cada campo */
export const PRUEBA_HOY = [
  { campo: 'Referencia del artículo', columna: 'Codigo articulo', ejemplo: '05-NDKE-740Z' },
  { campo: 'Unidades en stock', columna: 'Stock real', ejemplo: '128' },
  { campo: 'Precio', columna: 'PVP', ejemplo: '24,90' },
  { campo: 'Coste', columna: 'Coste medio', ejemplo: '11,35' },
]
