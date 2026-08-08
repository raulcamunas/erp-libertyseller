/**
 * Contenido para la maqueta. Los módulos, los estados, las listas de origen y
 * los nombres del equipo salen del ERP de verdad (lib/config/apps.ts,
 * lib/types/cold-leads.ts, lib/types/stock-sync.ts). Los leads son inventados
 * pero con la forma de los reales: sellers españoles con facturación mensual,
 * provincia, categoría y la pestaña del Excel de la que salieron.
 *
 * Sin datos de relleno a propósito: con «Lorem ipsum» no se puede mirar una
 * tabla y decir «así trabajo yo mejor o peor».
 */

import {
  Activity, Boxes, CalendarDays, Calculator, Clock, Globe, HandCoins, Home,
  Landmark, Linkedin, Megaphone, Palmtree, PhoneCall, PhoneForwarded, Plug,
  Timer, Users, type LucideIcon,
} from 'lucide-react'

/* ================================================================== */
/* Los 18 módulos, agrupados por trabajo                              */
/* ================================================================== */

export interface AppMaqueta {
  id: string
  nombre: string
  descripcion: string
  icono: LucideIcon
  soloAdmin?: boolean
  /** Lo que hay pendiente ahí dentro ahora mismo */
  vivo?: number
}

export interface GrupoApps {
  titulo: string
  apps: AppMaqueta[]
}

/**
 * Hoy son 18 objetos idénticos en una rejilla sin orden. Agruparlos por trabajo
 * es lo que permite que un comercial encuentre lo suyo sin leer los 18 nombres:
 * los grupos van en el orden en que se usan, no alfabético.
 */
export const GRUPOS_APPS: GrupoApps[] = [
  {
    titulo: 'Comercial',
    apps: [
      { id: 'web-leads', nombre: 'CRM Leads Web', descripcion: 'Leads desde tu sitio web', icono: Globe, vivo: 7 },
      { id: 'cold-calling', nombre: 'Cold Calling', descripcion: 'Cartera de sellers a prospectar, con estado e historial', icono: PhoneCall, vivo: 23 },
      { id: 'agenda', nombre: 'Agenda Comercial', descripcion: 'Calendario del equipo, sincronizado con Google Calendar', icono: CalendarDays },
      { id: 'linkedin', nombre: 'LinkedIn Prospección', descripcion: 'Gestión de prospección ABM en LinkedIn', icono: Linkedin },
    ],
  },
  {
    titulo: 'Cuentas de Amazon',
    apps: [
      { id: 'amazon-api', nombre: 'Amazon API', descripcion: 'Catálogo, precios y stock, directo contra Amazon', icono: Plug, soloAdmin: true, vivo: 2 },
      { id: 'stock-sync', nombre: 'Sincronismo de stock', descripcion: 'Del volcado del ERP del cliente al fichero de Amazon', icono: Boxes, vivo: 1 },
      { id: 'marketing-ads', nombre: 'Marketing', descripcion: 'Revisión semanal de las campañas de Amazon Ads', icono: Megaphone, vivo: 4 },
    ],
  },
  {
    titulo: 'Dinero',
    apps: [
      { id: 'tesoreria', nombre: 'Tesorería', descripcion: 'Ingresos por cliente, gastos y beneficio mes a mes', icono: Landmark },
      { id: 'commissions', nombre: 'Comisiones', descripcion: 'Calculadora de comisiones y liquidaciones', icono: Calculator },
      { id: 'commissions-shoes-f', nombre: 'Comisiones Shoes F', descripcion: 'Comparativa de años, % manual y desglose por país', icono: Calculator },
    ],
  },
  {
    titulo: 'Equipo',
    apps: [
      { id: 'horas', nombre: 'Mis Horas', descripcion: 'Apunta tus horas y mira en vivo tu salario y comisiones', icono: Timer },
      { id: 'vacaciones', nombre: 'Mis vacaciones', descripcion: 'Días generados, los que has cogido y los que puedes pedir', icono: Palmtree },
      { id: 'empleados', nombre: 'Control empleados', descripcion: 'Horas contratadas, sueldos y subidas mes a mes', icono: HandCoins, soloAdmin: true },
      { id: 'tracker', nombre: 'Employee Tracker', descripcion: 'Seguimiento de actividad de empleados', icono: Activity },
      { id: 'users', nombre: 'Gestión de Usuarios', descripcion: 'Crea y gestiona usuarios del sistema', icono: Users, soloAdmin: true },
    ],
  },
  {
    titulo: 'Utilidades',
    apps: [
      { id: 'telefonos', nombre: 'Teléfonos', descripcion: 'Números que usamos y para qué es cada uno', icono: PhoneForwarded },
      { id: 'usos-horarios', nombre: 'Usos horarios', descripcion: 'México (4 zonas) y España (Madrid)', icono: Clock },
    ],
  },
]

/** El menú lateral: los 18, en el mismo orden que los grupos. Inicio el primero. */
export const MENU: AppMaqueta[] = [
  { id: 'home', nombre: 'Inicio', descripcion: 'Dashboard principal', icono: Home },
  ...GRUPOS_APPS.flatMap((g) => g.apps),
]

/* ================================================================== */
/* Cold Calling                                                        */
/* ================================================================== */

export type EstadoLead =
  | 'pendiente' | 'no_contesta' | 'programado'
  | 'email_enviado' | 'seguimiento' | 'cita_cualificada' | 'no_interesa'

export interface Lead {
  id: string
  tienda: string
  empresa: string | null
  facturacion: number | null
  estado: EstadoLead
  telefono: string | null
  rellamar: string | null
  seguimiento: string | null
  email: string | null
  provincia: string | null
  categoria: string | null
  lista: string
  comercial: string
}

export const LEADS: Lead[] = [
  { id: 'l01', tienda: 'Hogar Deluxe Store', empresa: 'Deluxe Home Trading S.L.', facturacion: 184300, estado: 'cita_cualificada', telefono: '+34 961 22 84 10', rellamar: '2026-08-11', seguimiento: 'Consultoría el martes 11 a las 16:00. Le interesa FBA en DE e IT.', email: 'compras@hogardeluxe.es', provincia: 'Valencia', categoria: 'Hogar y cocina', lista: '1a lista', comercial: 'Alejandro' },
  { id: 'l02', tienda: 'NutriVida Suplementos', empresa: 'Nutrivida Iberia S.L.', facturacion: 142800, estado: 'seguimiento', telefono: '+34 917 43 09 22', rellamar: '2026-08-10', seguimiento: 'Pide caso de éxito en nutrición antes de sentarse. Enviado el 6.', email: 'direccion@nutrivida.com', provincia: 'Madrid', categoria: 'Salud y cuidado personal', lista: '1a lista', comercial: 'Carla' },
  { id: 'l03', tienda: 'Basoco Shoes', empresa: 'Zapaterías Basoco S.L.', facturacion: 128400, estado: 'programado', telefono: '+34 944 15 60 03', rellamar: '2026-08-12', seguimiento: 'Rellamar el miércoles a las 10:00, pregunta por Iñaki.', email: 'info@basoco.es', provincia: 'Bizkaia', categoria: 'Zapatos y complementos', lista: '1a lista', comercial: 'Alejandro' },
  { id: 'l04', tienda: 'TecnoPlus Online', empresa: 'Tecnoplus Distribución S.L.', facturacion: 119600, estado: 'no_contesta', telefono: '+34 932 88 41 75', rellamar: '2026-08-10', seguimiento: 'Tercer intento. Siempre salta el buzón por la mañana; probar a las 17:00.', email: 'ventas@tecnoplus.es', provincia: 'Barcelona', categoria: 'Electrónica', lista: '1a lista', comercial: 'Carla' },
  { id: 'l05', tienda: 'Bodegas Valhalla', empresa: 'Bodegas Valhalla S.L.', facturacion: 98200, estado: 'email_enviado', telefono: '+34 941 30 22 18', rellamar: null, seguimiento: 'Pidió la propuesta por correo. Enviada el 5 de agosto, sin respuesta.', email: 'gerencia@bodegasvalhalla.com', provincia: 'La Rioja', categoria: 'Alimentación y bebidas', lista: 'Alejandro V2', comercial: 'Alejandro' },
  { id: 'l06', tienda: 'Keslem Outdoor', empresa: 'Keslem Sport S.L.', facturacion: 94500, estado: 'seguimiento', telefono: '+34 968 21 77 40', rellamar: '2026-08-13', seguimiento: 'Muy interesado en publicidad. Quiere ver números de TACOS de otro cliente.', email: 'marketing@keslem.com', provincia: 'Murcia', categoria: 'Deportes y aire libre', lista: 'Alejandro V2', comercial: 'Daniella' },
  { id: 'l07', tienda: 'PetLovers España', empresa: 'Petlovers Ibérica S.L.U.', facturacion: 87900, estado: 'pendiente', telefono: '+34 954 62 13 90', rellamar: null, seguimiento: null, email: 'hola@petlovers.es', provincia: 'Sevilla', categoria: 'Productos para mascotas', lista: '1a lista', comercial: 'Yasury' },
  { id: 'l08', tienda: 'Cobo Family Home', empresa: 'Cobo Family S.L.', facturacion: 81300, estado: 'cita_cualificada', telefono: '+34 983 40 55 21', rellamar: '2026-08-14', seguimiento: 'Sesión el jueves 14. Vienen los dos socios. Preparar cuentas de DE.', email: 'admin@cobofamily.es', provincia: 'Valladolid', categoria: 'Hogar y cocina', lista: 'Alejandro V2', comercial: 'Alejandro' },
  { id: 'l09', tienda: 'Naelpaa Cosmetics', empresa: 'Naelpaa LLC', facturacion: 76400, estado: 'no_interesa', telefono: '+34 971 33 08 64', rellamar: null, seguimiento: 'Ya trabaja con otra agencia desde enero. Volver a llamar en 2027.', email: 'contacto@naelpaa.com', provincia: 'Illes Balears', categoria: 'Belleza', lista: '1a lista', comercial: 'Carla' },
  { id: 'l10', tienda: 'Ocio Global Import', empresa: 'Ocio Global Import S.L.', facturacion: 72100, estado: 'programado', telefono: '+34 925 71 46 32', rellamar: '2026-08-11', seguimiento: 'Lunes 11 a las 12:30. Preguntar por el catálogo de juguetería.', email: 'compras@ocioglobal.es', provincia: 'Toledo', categoria: 'Juguetes y juegos', lista: '1a lista', comercial: 'Jose' },
  { id: 'l11', tienda: 'MuayTax Equipment', empresa: 'MuayTax S.L.', facturacion: 68800, estado: 'no_contesta', telefono: '+34 963 55 12 07', rellamar: '2026-08-10', seguimiento: 'Cuelgan al oír «agencia». Probar por LinkedIn con el gerente.', email: 'info@muaytax.com', provincia: 'Valencia', categoria: 'Deportes y aire libre', lista: 'Alejandro V2', comercial: 'Yasury' },
  { id: 'l12', tienda: 'Creative Toys Store', empresa: 'Creative Toys S.L.', facturacion: 64200, estado: 'seguimiento', telefono: '+34 976 29 83 51', rellamar: '2026-08-18', seguimiento: 'De vacaciones hasta el 17. Retomar la semana del 18.', email: 'pedidos@creativetoys.es', provincia: 'Zaragoza', categoria: 'Juguetes y juegos', lista: '1a lista', comercial: 'Betty' },
  { id: 'l13', tienda: 'Yo By Yolanda', empresa: 'Yo By Yolanda S.L.', facturacion: 58700, estado: 'email_enviado', telefono: '+34 958 18 74 26', rellamar: null, seguimiento: 'Mandada la info de gestión de cuenta. Dijo que la ve esta semana.', email: 'yolanda@yobyyolanda.com', provincia: 'Granada', categoria: 'Moda', lista: 'Alejandro V2', comercial: 'Maoli' },
  { id: 'l14', tienda: 'GFY Logistic', empresa: 'GFY Logistic S.L.', facturacion: 54900, estado: 'pendiente', telefono: '+34 934 07 61 88', rellamar: null, seguimiento: null, email: 'operaciones@gfylogistic.com', provincia: 'Barcelona', categoria: 'Industria y ciencia', lista: '1a lista', comercial: 'Jose' },
  { id: 'l15', tienda: 'Angely Sunovia', empresa: 'Angely Sunovia S.L.', facturacion: 51200, estado: 'no_contesta', telefono: '+34 928 44 19 05', rellamar: '2026-08-10', seguimiento: 'Segundo intento, buzón lleno.', email: 'angely@sunovia.es', provincia: 'Las Palmas', categoria: 'Belleza', lista: 'Alejandro V2', comercial: 'Yamila' },
  { id: 'l16', tienda: 'DIRU Herramientas', empresa: 'DIRU Suministros S.L.', facturacion: 48600, estado: 'cita_cualificada', telefono: '+34 943 62 30 17', rellamar: '2026-08-12', seguimiento: 'Miércoles 12 a las 9:30. Catálogo de 13.700 referencias, ojo al stock.', email: 'compras@diru.es', provincia: 'Gipuzkoa', categoria: 'Bricolaje y herramientas', lista: '1a lista', comercial: 'Alejandro' },
  { id: 'l17', tienda: 'World Tenda', empresa: 'World Tenda USA', facturacion: 45300, estado: 'seguimiento', telefono: '+34 912 05 38 74', rellamar: '2026-08-15', seguimiento: 'Quiere entrar en amazon.com. Pasarle el caso de Shoplamp.', email: 'sales@worldtenda.com', provincia: 'Madrid', categoria: 'Hogar y cocina', lista: 'Alejandro V2', comercial: 'Daniella' },
  { id: 'l18', tienda: 'Shoplamp Iluminación', empresa: 'Shoplamp S.L.', facturacion: 42800, estado: 'no_interesa', telefono: '+34 965 77 20 43', rellamar: null, seguimiento: 'Lo lleva el sobrino internamente. No quiere externalizar.', email: 'info@shoplamp.es', provincia: 'Alicante', categoria: 'Iluminación', lista: '1a lista', comercial: 'Betty' },
  { id: 'l19', tienda: 'Eduardo Gómez Gourmet', empresa: null, facturacion: 39400, estado: 'pendiente', telefono: '+34 957 84 11 62', rellamar: null, seguimiento: null, email: 'eduardo@egourmet.es', provincia: 'Córdoba', categoria: 'Alimentación y bebidas', lista: 'Alejandro V2', comercial: 'Maoli' },
  { id: 'l20', tienda: 'BabyCare Premium', empresa: 'Babycare Premium S.L.', facturacion: 36700, estado: 'programado', telefono: '+34 986 33 57 19', rellamar: '2026-08-11', seguimiento: 'Lunes a las 15:00. Ojo: hablan gallego, prefieren castellano por teléfono.', email: 'direccion@babycarepremium.es', provincia: 'Pontevedra', categoria: 'Bebé', lista: '1a lista', comercial: 'Yasury' },
  { id: 'l21', tienda: 'A SAUSIN París', empresa: 'A SAUSIN SARL', facturacion: 34100, estado: 'email_enviado', telefono: '+33 1 42 60 88 90', rellamar: null, seguimiento: 'Propuesta en francés enviada el 4. Confirmó recepción.', email: 'contact@asausin.fr', provincia: 'Francia', categoria: 'Papelería y oficina', lista: 'Alejandro V2', comercial: 'Carla' },
  { id: 'l22', tienda: 'ElectroHogar 24', empresa: 'Electrohogar 24 S.L.U.', facturacion: 31900, estado: 'no_contesta', telefono: '+34 950 26 90 33', rellamar: '2026-08-12', seguimiento: 'Cuarto intento. Si no coge el miércoles, a descartados.', email: 'ventas@electrohogar24.es', provincia: 'Almería', categoria: 'Electrónica', lista: '1a lista', comercial: 'Jose' },
  { id: 'l23', tienda: 'Verde Natura', empresa: 'Verde Natura Bio S.L.', facturacion: 28500, estado: 'seguimiento', telefono: '+34 973 45 62 80', rellamar: '2026-08-13', seguimiento: 'Interesada pero el presupuesto lo cierran en septiembre.', email: 'laura@verdenatura.bio', provincia: 'Lleida', categoria: 'Alimentación y bebidas', lista: 'Alejandro V2', comercial: 'Yamila' },
  { id: 'l24', tienda: 'Móvil Repuestos Pro', empresa: 'MRP Componentes S.L.', facturacion: 26200, estado: 'pendiente', telefono: '+34 924 18 05 47', rellamar: null, seguimiento: null, email: 'info@mrpcomponentes.es', provincia: 'Badajoz', categoria: 'Electrónica', lista: '1a lista', comercial: 'Betty' },
  { id: 'l25', tienda: 'Textil Sur Home', empresa: 'Textil Sur S.C.A.', facturacion: 23800, estado: 'no_interesa', telefono: '+34 952 71 34 09', rellamar: null, seguimiento: 'Facturan casi todo en tienda física. No encaja.', email: 'gerencia@textilsur.es', provincia: 'Málaga', categoria: 'Hogar y cocina', lista: 'Alejandro V2', comercial: 'Maoli' },
  { id: 'l26', tienda: 'AutoParts Ibérica', empresa: 'Autoparts Ibérica S.L.', facturacion: 21400, estado: 'programado', telefono: '+34 987 22 68 15', rellamar: '2026-08-14', seguimiento: 'Jueves a las 11:00. Preguntar por el stock de recambios en FBM.', email: 'compras@autopartsiberica.es', provincia: 'León', categoria: 'Coche y moto', lista: '1a lista', comercial: 'Yasury' },
  { id: 'l27', tienda: 'La Librería del Sur', empresa: null, facturacion: 18900, estado: 'no_contesta', telefono: '+34 956 30 74 22', rellamar: '2026-08-11', seguimiento: 'Número de la tienda, no del responsable. Buscar el directo.', email: null, provincia: 'Cádiz', categoria: 'Libros', lista: 'Alejandro V2', comercial: 'Yamila' },
  { id: 'l28', tienda: 'Kids Fashion Store', empresa: 'Kids Fashion Retail S.L.', facturacion: 16300, estado: 'pendiente', telefono: '+34 964 51 88 07', rellamar: null, seguimiento: null, email: 'hola@kidsfashion.es', provincia: 'Castellón', categoria: 'Moda', lista: '1a lista', comercial: 'Betty' },
  { id: 'l29', tienda: 'Oficina Total', empresa: 'Oficina Total Suministros S.L.', facturacion: 14700, estado: 'email_enviado', telefono: '+34 979 12 45 63', rellamar: null, seguimiento: 'Pidió tarifas por escrito. Enviadas el 7.', email: 'pedidos@oficinatotal.es', provincia: 'Palencia', categoria: 'Papelería y oficina', lista: 'Alejandro V2', comercial: 'Jose' },
  { id: 'l30', tienda: 'Camping Aventura', empresa: 'Camping Aventura S.L.', facturacion: 11200, estado: 'pendiente', telefono: null, rellamar: null, seguimiento: null, email: 'info@campingaventura.es', provincia: 'Huesca', categoria: 'Deportes y aire libre', lista: '1a lista', comercial: 'Maoli' },
]

export const LISTAS_ORIGEN = ['1a lista', 'Alejandro V2']
export const COMERCIALES = ['Alejandro', 'Carla', 'Daniella', 'Jose', 'Yasury', 'Betty', 'Maoli', 'Yamila']

/** Del ERP: lib/types/cold-leads.ts */
export const ORDENES: { valor: string; etiqueta: string }[] = [
  { valor: 'revenue_desc', etiqueta: 'Más facturación' },
  { valor: 'revenue_asc', etiqueta: 'Menos facturación' },
  { valor: 'due_first', etiqueta: 'Rellamadas primero' },
  { valor: 'name', etiqueta: 'Nombre A-Z' },
]

/* ================================================================== */
/* Amazon API — perfil de lectura                                      */
/* ================================================================== */

export const CLIENTES = [
  'Creative Toys', 'Zapaterías Basoco S.L', 'GFY Logistic S.L', 'World Tenda USA',
  'Ocio Global Import S.L', 'Shoplamp', 'Yo By Yolanda', 'Eduardo Gómez',
  'Naelpaa LLC', 'Keslem', 'Bodegas Valhalla', 'Angely sunovia',
  'Cobo Family', 'A SAUSIN', 'DIRU', 'MuayTax',
]

export interface Alias {
  campo: string
  etiqueta: string
  obligatorio?: boolean
  nota: string
  valores: string[]
}

/** Los nombres de columna son los reales de la semilla de Shoplamp. */
export const ALIAS: Alias[] = [
  { campo: 'col_referencia', etiqueta: 'Referencia del artículo', obligatorio: true, nota: 'Obligatoria siempre. Es la identidad del artículo en el ERP del cliente.', valores: ['Codigo articulo', 'Cod. Articulo', 'Referencia'] },
  { campo: 'col_stock', etiqueta: 'Unidades en stock', obligatorio: true, nota: 'Obligatoria en un perfil de stock.', valores: ['Stock real', 'Stock'] },
  { campo: 'col_precio', etiqueta: 'Precio', nota: 'Solo hace falta si el precio sale de una columna.', valores: ['PVP'] },
  { campo: 'col_precio_respaldo', etiqueta: 'Precio de respaldo', nota: 'Se mira SOLO si la columna de precio viene vacía en esa fila.', valores: [] },
  { campo: 'col_coste', etiqueta: 'Coste', nota: 'Solo hace falta si el precio se calcula por margen.', valores: ['Coste medio'] },
  { campo: 'col_descripcion', etiqueta: 'Descripción', nota: 'Para reconocer la línea en pantalla. No se envía a Amazon.', valores: ['Descripcion'] },
  { campo: 'col_familia', etiqueta: 'Familia', nota: 'Hace falta para poder excluir familias enteras.', valores: ['Tipo'] },
  { campo: 'col_ean', etiqueta: 'Código de barras', nota: 'Si el volcado de stock ya lo trae.', valores: ['Codigo barras'] },
]

export interface Freno {
  clave: string
  etiqueta: string
  valor: string
  unidad: string
  nota?: string
}

/**
 * Tres de los seis vienen vacíos a propósito: es el caso que hoy solo se
 * distingue por un marcador de posición gris, y el que esta propuesta tiene
 * que resolver de forma que se vea de un golpe.
 */
export const FRENOS: Freno[] = [
  { clave: 'pct_a_cero', etiqueta: 'Máximo del catálogo que puede irse a cero', valor: '30', unidad: '%' },
  { clave: 'variacion_precio', etiqueta: 'Variación máxima de precio de una línea', valor: '', unidad: '%', nota: 'Se mira la línea peor, no la media.' },
  { clave: 'caida_lineas', etiqueta: 'Caída máxima de líneas del fichero', valor: '25', unidad: '%', nota: 'Un fichero con 8.000 líneas menos es un volcado a medias, no un almacén vacío.' },
  { clave: 'caida_unidades', etiqueta: 'Caída máxima de unidades publicadas', valor: '40', unidad: '%', nota: 'El único que ve un derrumbe de stock que NO llega a cero: un fichero con todas sus líneas y las cantidades divididas por mil no mueve ninguno de los otros.' },
  { clave: 'max_cambios', etiqueta: 'Máximo de SKU que pueden cambiar de golpe', valor: '', unidad: 'SKU' },
  { clave: 'lineas_referencia', etiqueta: 'Líneas que trae este fichero un día normal', valor: '', unidad: 'líneas', nota: 'Es la referencia del freno de caída. Mientras esté vacío, ese freno queda declarado pero NO PUEDE SALTAR: no hay con qué comparar.' },
]

/** Resultado de «Probar»: qué columna se ha llevado cada campo. */
export interface ColumnaCasada {
  campo: string
  columna: string | null
  /** exacta · empieza igual · no aparece */
  como: 'exacta' | 'parcial' | 'falta'
}

export const PRUEBA_COLUMNAS: ColumnaCasada[] = [
  { campo: 'Referencia del artículo', columna: 'Codigo articulo', como: 'exacta' },
  { campo: 'Unidades en stock', columna: 'Stock real', como: 'exacta' },
  { campo: 'Precio', columna: 'PVP unitario', como: 'parcial' },
  { campo: 'Precio de respaldo', columna: null, como: 'falta' },
  { campo: 'Coste', columna: 'Coste medio', como: 'exacta' },
  { campo: 'Descripción', columna: 'Descripcion', como: 'exacta' },
  { campo: 'Familia', columna: 'Tipo', como: 'exacta' },
  { campo: 'Código de barras', columna: 'Codigo barras', como: 'exacta' },
]

export interface FilaPrueba {
  referencia: string
  descripcion: string
  stock: number
  precio: number | null
  familia: string
}

export const PRUEBA_FILAS: FilaPrueba[] = [
  { referencia: '05-NDKE-740Z', descripcion: 'Lámpara de pie Nordic roble 150 cm', stock: 42, precio: 89.95, familia: 'Iluminación' },
  { referencia: '06-CMX0-93ID', descripcion: 'Aplique pared latón mate E27', stock: 0, precio: 34.5, familia: 'Iluminación' },
  { referencia: '0G-IRKR-QDCK', descripcion: 'Plafón LED 24W regulable blanco', stock: 187, precio: 52.0, familia: 'LED' },
  { referencia: '0G-IRKR-QDCL', descripcion: 'Plafón LED 36W regulable blanco', stock: 96, precio: 68.9, familia: 'LED' },
  { referencia: '11-TQVB-5X2M', descripcion: 'Foco empotrable orientable GU10', stock: 1240, precio: null, familia: 'LED' },
  { referencia: '18-PLZA-66RT', descripcion: 'Sobremesa cerámica azul pantalla lino', stock: 8, precio: 74.25, familia: 'Iluminación' },
]

/** Estados de ejecución, de lib/types/stock-sync.ts */
export interface Ejecucion {
  cuando: string
  estado: 'sin_cambios' | 'simulacro' | 'frenado' | 'enviado' | 'error'
  lineas: number
  cambios: number
  detalle: string
}

export const EJECUCIONES: Ejecucion[] = [
  { cuando: 'hace 12 min', estado: 'frenado', lineas: 8420, cambios: 1206, detalle: 'Demasiadas referencias se irían a cero: 34 % contra un límite del 30 %.' },
  { cuando: 'hace 3 horas', estado: 'enviado', lineas: 8431, cambios: 214, detalle: '214 SKU actualizados en amazon.es.' },
  { cuando: 'ayer, 23:15', estado: 'simulacro', lineas: 8429, cambios: 198, detalle: 'Envío automático apagado: no se ha mandado nada.' },
  { cuando: 'ayer, 19:15', estado: 'sin_cambios', lineas: 8429, cambios: 0, detalle: 'El fichero es idéntico al de la ejecución anterior.' },
  { cuando: 'ayer, 15:15', estado: 'error', lineas: 0, cambios: 0, detalle: 'La carpeta de Drive no contiene ningún fichero .xlsx desde el 6 de agosto.' },
]

/* ================================================================== */
/* Formato español, como en todo el ERP                                */
/* ================================================================== */

export function euros(n: number | null): string {
  if (n == null) return '—'
  return `${Math.round(n).toLocaleString('es-ES')} €`
}

export function importe(n: number | null): string {
  if (n == null) return '—'
  return `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}

export function entero(n: number): string {
  return n.toLocaleString('es-ES')
}

export function fechaCorta(iso: string | null): string {
  if (!iso) return '—'
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a.slice(2)}`
}
