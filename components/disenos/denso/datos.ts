/**
 * Contenido para las tres maquetas.
 *
 * Nombres de módulo, estados, etiquetas y textos de ayuda salen literalmente
 * del ERP (lib/config/apps.ts, lib/types/cold-leads.ts, lib/types/stock-sync.ts
 * y components/amazon/PerfilConfig.tsx). Las filas de leads y los importes son
 * inventados pero del tamaño y la forma de los reales: una maqueta con «Lorem
 * ipsum» no deja mirar la tabla y decir «así trabajo yo mejor o peor».
 */

import {
  Activity,
  AlertTriangle,
  Boxes,
  CalendarClock,
  CalendarDays,
  Calculator,
  CheckCircle2,
  Circle,
  Clock,
  FlaskConical,
  Globe,
  HandCoins,
  Landmark,
  Linkedin,
  Mail,
  Megaphone,
  Minus,
  Palmtree,
  PhoneCall,
  PhoneForwarded,
  PhoneMissed,
  Plug,
  Send,
  Timer,
  TrendingUp,
  Users,
  XCircle,
  type LucideIcon,
} from 'lucide-react'

/* ------------------------------------------------------------------ */
/* Los estados de Cold Calling                                         */
/* ------------------------------------------------------------------ */

export type EstadoFrio =
  | 'pendiente'
  | 'no_contesta'
  | 'programado'
  | 'email_enviado'
  | 'seguimiento'
  | 'cita_cualificada'
  | 'no_interesa'

export const ORDEN_ESTADOS: EstadoFrio[] = [
  'pendiente',
  'no_contesta',
  'programado',
  'email_enviado',
  'seguimiento',
  'cita_cualificada',
  'no_interesa',
]

/**
 * Cada estado con SU FORMA antes que su color.
 *
 * `icono` es la primera señal y no se repite entre estados; `etiqueta` es la
 * segunda y es la del ERP, en castellano; `varColor` es la tercera y solo
 * refuerza. Los tonos son los del Excel del equipo —amarillo = no contesta,
 * cian = programado, magenta = info enviada, naranja = seguimiento, verde =
 * cualificada, rojo = descartado— subidos hasta pasar 4,5:1 en los dos temas.
 */
export const ESTADOS: Record<
  EstadoFrio,
  { etiqueta: string; pista: string; icono: LucideIcon; varColor: string }
> = {
  pendiente: {
    etiqueta: 'Sin contactar',
    pista: 'Todavía no se ha llamado',
    icono: Circle,
    varColor: 'var(--dz-e-gris)',
  },
  no_contesta: {
    etiqueta: 'No contesta',
    pista: 'No coge, buzón o cuelga: hay que reintentar',
    icono: PhoneMissed,
    varColor: 'var(--dz-e-ama)',
  },
  programado: {
    etiqueta: 'Rellamada programada',
    pista: 'Nos ha dado día y hora para volver a llamar',
    icono: CalendarClock,
    varColor: 'var(--dz-e-cian)',
  },
  email_enviado: {
    etiqueta: 'Info enviada',
    pista: 'Pidió la información por correo y se la mandamos',
    icono: Mail,
    varColor: 'var(--dz-e-mag)',
  },
  seguimiento: {
    etiqueta: 'En seguimiento',
    pista: 'Muestra interés, hay que insistir',
    icono: TrendingUp,
    varColor: 'var(--dz-e-nar)',
  },
  cita_cualificada: {
    etiqueta: 'Cita cualificada',
    pista: 'Sesión de consultoría agendada',
    icono: CheckCircle2,
    varColor: 'var(--dz-e-verde)',
  },
  no_interesa: {
    etiqueta: 'No le interesa',
    pista: 'Descartado: no quiere, ya tiene agencia o no encaja',
    icono: XCircle,
    varColor: 'var(--dz-e-rojo)',
  },
}

/** Etiqueta corta para la columna, que la larga no cabe en 150 px */
export const ETIQUETA_CORTA: Record<EstadoFrio, string> = {
  pendiente: 'Sin contactar',
  no_contesta: 'No contesta',
  programado: 'Rellamada',
  email_enviado: 'Info enviada',
  seguimiento: 'Seguimiento',
  cita_cualificada: 'Cita cualificada',
  no_interesa: 'No le interesa',
}

export interface Lead {
  id: string
  tienda: string
  empresa: string
  facturacion: number | null
  estado: EstadoFrio
  telefono: string | null
  rellamar: string | null
  seguimiento: string
  email: string | null
  provincia: string
  categoria: string
  lista: string
}

const L = (
  id: string,
  tienda: string,
  empresa: string,
  facturacion: number | null,
  estado: EstadoFrio,
  telefono: string | null,
  rellamar: string | null,
  seguimiento: string,
  email: string | null,
  provincia: string,
  categoria: string,
  lista: string
): Lead => ({
  id,
  tienda,
  empresa,
  facturacion,
  estado,
  telefono,
  rellamar,
  seguimiento,
  email,
  provincia,
  categoria,
  lista,
})

/** 44 filas: las suficientes para que a 1080 px de alto la tabla siga por debajo del corte */
export const LEADS: Lead[] = [
  L('l01', 'Calzados Aurora', 'Calzados Aurora S.L.', 184200, 'cita_cualificada', '+34 963 41 22 08', null, 'Sesión el 12 ago con Marius. Vienen de Shopify, 2 marcas.', 'pedro@calzadosaurora.es', 'Valencia', 'Zapatos y complementos', '1a lista'),
  L('l02', 'Nordik Home', 'Nordik Home Iberia S.L.', 152800, 'seguimiento', '+34 932 08 71 44', '2026-08-11', 'Pide números de otra cuenta de deco antes de decidir.', 'compras@nordikhome.es', 'Barcelona', 'Hogar y jardín', '1a lista'),
  L('l03', 'BioNatura Shop', 'Bionatura Distribución S.L.', 141500, 'programado', '+34 954 33 90 17', '2026-08-08', 'Rellamar viernes 10:00. Habla el hijo, no el titular.', 'info@bionaturashop.com', 'Sevilla', 'Salud y cuidado personal', 'Alejandro V2'),
  L('l04', 'ToolPro Ibérica', 'Toolpro Ibérica S.A.', 138900, 'no_contesta', '+34 976 22 14 65', '2026-08-08', '3 intentos, siempre buzón. Probar por LinkedIn.', null, 'Zaragoza', 'Bricolaje y herramientas', '1a lista'),
  L('l05', 'Petit Coton', 'Petit Coton S.L.U.', 128400, 'email_enviado', '+34 917 65 30 21', null, 'Mandado dossier + caso Shoes F el 5 ago.', 'hola@petitcoton.es', 'Madrid', 'Bebé', 'Alejandro V2'),
  L('l06', 'Sport Fusion', 'Sport Fusion Levante S.L.', 119700, 'seguimiento', '+34 965 12 88 30', '2026-08-12', 'Le preocupa el stock: justo nuestro sincronismo.', 'gerencia@sportfusion.es', 'Alicante', 'Deportes', '1a lista'),
  L('l07', 'Casa Delgado', 'Delgado Hermanos S.L.', 112300, 'pendiente', '+34 957 40 55 12', null, '', 'admin@casadelgado.es', 'Córdoba', 'Hogar y jardín', '2a lista'),
  L('l08', 'Vinos del Duero', 'Bodegas del Duero S.L.', 108600, 'no_interesa', '+34 983 21 76 40', null, 'Tienen agencia desde enero. Revisar en 6 meses.', 'export@vinosduero.com', 'Valladolid', 'Alimentación y bebidas', '1a lista'),
  L('l09', 'Tech Andalucía', 'Tech Andalucía Distribución S.L.', 104100, 'cita_cualificada', '+34 952 60 19 03', null, 'Cita 14 ago 16:00. Facturan 60 % en DE.', 'dirección@techandalucia.es', 'Málaga', 'Electrónica', 'Alejandro V2'),
  L('l10', 'Mundo Mascota', 'Mundo Mascota Online S.L.', 98400, 'no_contesta', '+34 986 44 12 77', '2026-08-09', 'Centralita, no pasan. Buscar directo del director.', 'pedidos@mundomascota.es', 'Pontevedra', 'Mascotas', '2a lista'),
  L('l11', 'Ferretería Sanz', 'Sanz Suministros S.L.', 94200, 'programado', '+34 941 25 08 61', '2026-08-08', 'Rellamar hoy 12:30, después del reparto.', 'javier@ferreteriasanz.es', 'La Rioja', 'Bricolaje y herramientas', '1a lista'),
  L('l12', 'Aromas de Ronda', 'Aromas de Ronda S.L.U.', 91800, 'seguimiento', null, '2026-08-13', 'Marca propia, quiere Vine y A+ premium.', 'marta@aromasderonda.com', 'Málaga', 'Belleza', 'Alejandro V2'),
  L('l13', 'Kitchen Lab', 'Kitchen Lab Europe S.L.', 89300, 'email_enviado', '+34 938 71 40 25', null, 'Pidió tarifas por escrito. Enviado el 6 ago.', 'info@kitchenlab.eu', 'Barcelona', 'Cocina', '1a lista'),
  L('l14', 'Óptica Vistalia', 'Vistalia Retail S.L.', 84700, 'pendiente', '+34 928 33 61 09', null, '', 'compras@vistalia.es', 'Las Palmas', 'Salud y cuidado personal', '2a lista'),
  L('l15', 'La Textilera', 'La Textilera Manchega S.L.', 81200, 'no_contesta', '+34 926 50 22 18', '2026-08-10', '2 intentos. Mejor a primera hora.', 'ventas@latextilera.es', 'Ciudad Real', 'Textil hogar', '1a lista'),
  L('l16', 'GamerZone ES', 'Gamerzone Iberia S.L.', 78900, 'seguimiento', '+34 918 04 55 73', '2026-08-14', 'Quiere ver PPC antes. Pasar caso de Creative Toys.', 'ventas@gamerzone.es', 'Madrid', 'Videojuegos', 'Alejandro V2'),
  L('l17', 'Muebles Aitana', 'Muebles Aitana S.L.', 76100, 'no_interesa', '+34 965 77 30 12', null, 'Solo venden en su web, no quieren Amazon.', 'info@mueblesaitana.com', 'Alicante', 'Muebles', '2a lista'),
  L('l18', 'Naturcosmética', 'Naturcosmética Bio S.L.', 74300, 'programado', '+34 943 18 62 90', '2026-08-11', 'Rellamada lunes 09:30, la dueña.', 'ainhoa@naturcosmetica.es', 'Guipúzcoa', 'Belleza', '1a lista'),
  L('l19', 'Papelería Kraft', 'Kraft Papel y Regalo S.L.', 71500, 'pendiente', '+34 968 29 47 06', null, '', 'hola@papeleriakraft.es', 'Murcia', 'Oficina y papelería', '2a lista'),
  L('l20', 'Zapas Urban', 'Urban Sneakers S.L.', 69800, 'cita_cualificada', '+34 913 55 20 84', null, 'Cita 19 ago. Ya venden en FR, quieren IT y DE.', 'direccion@zapasurban.es', 'Madrid', 'Zapatos y complementos', '1a lista'),
  L('l21', 'Herbolario Vital', 'Vital Herbolarios S.L.', 67200, 'no_contesta', '+34 971 40 11 55', '2026-08-09', 'Solo cogen por las tardes.', 'pedidos@herbolariovital.es', 'Baleares', 'Salud y cuidado personal', 'Alejandro V2'),
  L('l22', 'Camper Store', 'Camper Store Outdoor S.L.', 64900, 'email_enviado', '+34 976 88 43 21', null, 'Dossier enviado el 4 ago, sin respuesta.', 'info@camperstore.es', 'Zaragoza', 'Deportes', '1a lista'),
  L('l23', 'Iluminia', 'Iluminia Lighting S.L.', 62400, 'seguimiento', '+34 934 62 07 19', '2026-08-15', 'Interesados en el sincronismo con su ERP (Sage).', 'compras@iluminia.com', 'Barcelona', 'Iluminación', '2a lista'),
  L('l24', 'Joyas Amaia', 'Amaia Joyeros S.L.', 60100, 'pendiente', '+34 944 12 88 07', null, '', 'amaia@joyasamaia.es', 'Vizcaya', 'Joyería', '1a lista'),
  L('l25', 'Pescados Ría', 'Pescados Ría de Arousa S.L.', 58700, 'no_interesa', '+34 986 91 33 40', null, 'Producto fresco, no encaja con FBA.', 'ventas@pescadosria.es', 'Pontevedra', 'Alimentación y bebidas', '2a lista'),
  L('l26', 'Bebé Nube', 'Bebé Nube Textil S.L.', 56300, 'programado', '+34 962 74 15 33', '2026-08-12', 'Rellamar martes. Están en plena temporada.', 'hola@bebenube.es', 'Valencia', 'Bebé', 'Alejandro V2'),
  L('l27', 'AutoParts Levante', 'Autoparts Levante S.L.U.', 54800, 'no_contesta', '+34 963 20 66 71', '2026-08-08', '4 intentos. Último aviso antes de descartar.', 'admin@autopartslevante.es', 'Valencia', 'Automoción', '1a lista'),
  L('l28', 'Té y Aromas', 'Té y Aromas Selección S.L.', 52100, 'seguimiento', '+34 918 33 02 47', '2026-08-18', 'Pide referencias de clientes de alimentación.', 'info@teyaromas.es', 'Madrid', 'Alimentación y bebidas', '2a lista'),
  L('l29', 'Mochilas Nomad', 'Nomad Bags S.L.', 49600, 'pendiente', '+34 972 51 44 90', null, '', 'ventas@nomadbags.es', 'Girona', 'Equipaje', '1a lista'),
  L('l30', 'Clean & Co', 'Clean and Co Suministros S.L.', 47300, 'email_enviado', '+34 925 60 18 22', null, 'Enviada propuesta de auditoría el 7 ago.', 'compras@cleanandco.es', 'Toledo', 'Droguería', '2a lista'),
  L('l31', 'Piscinas Delfín', 'Delfín Piscinas S.L.', 45900, 'no_contesta', '+34 950 27 30 66', '2026-08-11', 'Temporada alta, imposible localizar.', 'info@piscinasdelfin.es', 'Almería', 'Hogar y jardín', '1a lista'),
  L('l32', 'Libros del Sur', 'Ediciones del Sur S.L.', 43200, 'no_interesa', '+34 955 40 77 13', null, 'Margen de libro, no les salen los números.', 'edicion@librosdelsur.es', 'Sevilla', 'Libros', '2a lista'),
  L('l33', 'Fitness Rack', 'Fitness Rack Equipment S.L.', 41700, 'programado', '+34 947 22 55 08', '2026-08-13', 'Rellamada miércoles con el socio.', 'ventas@fitnessrack.es', 'Burgos', 'Deportes', 'Alejandro V2'),
  L('l34', 'Velas Aurora', 'Velas Aurora Artesanas S.L.', 39400, 'pendiente', '+34 921 30 12 74', null, '', 'hola@velasaurora.es', 'Segovia', 'Decoración', '1a lista'),
  L('l35', 'Drone Center', 'Drone Center España S.L.', 37800, 'seguimiento', '+34 916 71 09 35', '2026-08-16', 'Quiere entrar en UK. Explicar el tema aduanas.', 'info@dronecenter.es', 'Madrid', 'Electrónica', '2a lista'),
  L('l36', 'Cerámica Talavera', 'Cerámica de Talavera S.L.', 35600, 'no_contesta', '+34 925 81 23 40', '2026-08-09', '2 intentos, dejan recado y no devuelven.', 'taller@ceramicatalavera.es', 'Toledo', 'Decoración', '1a lista'),
  L('l37', 'Vape Store ES', 'Vape Store Iberia S.L.', 34100, 'no_interesa', '+34 933 41 60 28', null, 'Categoría restringida en Amazon.', 'info@vapestore.es', 'Barcelona', 'Otros', '2a lista'),
  L('l38', 'Kids Puzzle', 'Kids Puzzle Toys S.L.', 32700, 'email_enviado', '+34 986 30 55 12', null, 'Enviado el 6 ago. Recordatorio el lunes.', 'ventas@kidspuzzle.es', 'Pontevedra', 'Juguetes', 'Alejandro V2'),
  L('l39', 'Café Molienda', 'Molienda Coffee Roasters S.L.', 30900, 'pendiente', '+34 954 12 88 61', null, '', 'tueste@molienda.coffee', 'Sevilla', 'Alimentación y bebidas', '1a lista'),
  L('l40', 'Ortopedia Bienestar', 'Bienestar Ortopedia S.L.', 28400, 'programado', '+34 976 55 02 19', '2026-08-14', 'Rellamada jueves, después del inventario.', 'admin@ortobienestar.es', 'Zaragoza', 'Salud y cuidado personal', '2a lista'),
  L('l41', 'Surf Republic', 'Surf Republic Canarias S.L.', 26800, 'seguimiento', '+34 928 77 41 03', '2026-08-19', 'Quiere empezar por ES y crecer a PT.', 'info@surfrepublic.es', 'Las Palmas', 'Deportes', '1a lista'),
  L('l42', 'Reloj Clásico', 'Reloj Clásico Import S.L.', 24500, 'no_contesta', '+34 913 22 74 50', '2026-08-10', '3 intentos. Nº fijo, nadie coge.', null, 'Madrid', 'Joyería', '2a lista'),
  L('l43', 'Semillas Huerto', 'Semillas del Huerto S.L.', 21900, 'pendiente', '+34 968 41 30 27', null, '', 'ventas@semillashuerto.es', 'Murcia', 'Hogar y jardín', '1a lista'),
  L('l44', 'Tinta y Papel', 'Tinta y Papel Consumibles S.L.', 18300, 'no_interesa', '+34 918 60 22 41', null, 'Compiten con Amazon Basics, no ven hueco.', 'info@tintaypapel.es', 'Madrid', 'Oficina y papelería', '2a lista'),
]

export const RECUENTO_ESTADO: Record<EstadoFrio, number> = {
  pendiente: 1418,
  no_contesta: 902,
  programado: 214,
  email_enviado: 331,
  seguimiento: 268,
  cita_cualificada: 97,
  no_interesa: 617,
}

export const TOTAL_LEADS = 3847

/* ------------------------------------------------------------------ */
/* Inicio                                                              */
/* ------------------------------------------------------------------ */

export interface AppItem {
  id: string
  nombre: string
  descripcion: string
  icono: LucideIcon
  marca?: number
  soloAdmin?: boolean
}

/**
 * Los dieciocho módulos, agrupados por el trabajo que hacen.
 *
 * Hoy son dieciocho tarjetas iguales de 202 px con el mismo icono naranja: no
 * hay orden, ni peso, ni frecuencia. Agrupar no es decoración, es la única
 * jerarquía posible cuando todos los objetos son del mismo tipo.
 */
export const GRUPOS_APPS: { grupo: string; apps: AppItem[] }[] = [
  {
    grupo: 'Comercial',
    apps: [
      { id: 'web-leads', nombre: 'CRM Leads Web', descripcion: 'Leads desde tu sitio web', icono: Globe, marca: 23 },
      { id: 'cold-calling', nombre: 'Cold Calling', descripcion: 'Cartera de sellers a prospectar', icono: PhoneCall },
      { id: 'linkedin', nombre: 'LinkedIn Prospección', descripcion: 'Prospección ABM en LinkedIn', icono: Linkedin },
      { id: 'agenda', nombre: 'Agenda Comercial', descripcion: 'Citas del equipo, con Google Calendar', icono: CalendarDays },
    ],
  },
  {
    grupo: 'Cliente y catálogo',
    apps: [
      { id: 'amazon-api', nombre: 'Amazon API', descripcion: 'Catálogo, precios y stock, directo contra Amazon', icono: Plug, soloAdmin: true },
      { id: 'stock-sync', nombre: 'Sincronismo de stock', descripcion: 'Del volcado del cliente al fichero de Amazon', icono: Boxes, marca: 2 },
      { id: 'marketing-ads', nombre: 'Marketing', descripcion: 'Revisión semanal de las campañas de Ads', icono: Megaphone, marca: 4 },
    ],
  },
  {
    grupo: 'Dinero',
    apps: [
      { id: 'tesoreria', nombre: 'Tesorería', descripcion: 'Ingresos por cliente, gastos y beneficio', icono: Landmark },
      { id: 'commissions', nombre: 'Comisiones', descripcion: 'Calculadora de comisiones y liquidaciones', icono: Calculator },
      { id: 'commissions-shoes-f', nombre: 'Comisiones Shoes F', descripcion: 'Comparativa de años y desglose por país', icono: Calculator },
      { id: 'empleados', nombre: 'Control empleados', descripcion: 'Horas contratadas, sueldos y subidas', icono: HandCoins, soloAdmin: true },
    ],
  },
  {
    grupo: 'Equipo y tiempo',
    apps: [
      { id: 'horas', nombre: 'Mis Horas', descripcion: 'Tus horas, tu salario y tus comisiones en vivo', icono: Timer },
      { id: 'vacaciones', nombre: 'Mis vacaciones', descripcion: 'Días generados, cogidos y disponibles', icono: Palmtree, marca: 3 },
      { id: 'tracker', nombre: 'Employee Tracker', descripcion: 'Seguimiento de actividad del equipo', icono: Activity },
      { id: 'usos-horarios', nombre: 'Usos horarios', descripcion: 'México (4 zonas) y España (Madrid)', icono: Clock },
      { id: 'telefonos', nombre: 'Teléfonos', descripcion: 'Números que usamos y para qué es cada uno', icono: PhoneForwarded },
      { id: 'users', nombre: 'Gestión de Usuarios', descripcion: 'Crea y gestiona usuarios del sistema', icono: Users, soloAdmin: true },
    ],
  },
]

export interface LineaHoy {
  n: string
  texto: string
  icono: LucideIcon
  urgente?: boolean
  app: string
}

/**
 * «Hoy»: lo único que cambia de un día para otro.
 *
 * Es la jerarquía que hoy no existe. La insignia de leads sin leer es la única
 * información viva de toda la pantalla de inicio y compite en igualdad con
 * «Usos horarios»; aquí sube arriba del todo y se lleva el naranja.
 */
export const HOY: LineaHoy[] = [
  { n: '23', texto: 'leads web sin abrir', icono: Globe, urgente: true, app: 'web-leads' },
  { n: '2', texto: 'perfiles de stock frenados: Shoplamp, DIRU', icono: AlertTriangle, urgente: true, app: 'stock-sync' },
  { n: '12', texto: 'rellamadas programadas para hoy', icono: PhoneCall, app: 'cold-calling' },
  { n: '3', texto: 'citas comerciales en la agenda de mañana', icono: CalendarDays, app: 'agenda' },
  { n: '4', texto: 'campañas de Ads sin revisar esta semana', icono: Megaphone, app: 'marketing-ads' },
  { n: '3', texto: 'solicitudes de vacaciones por aprobar', icono: Palmtree, app: 'vacaciones' },
]

export interface Movimiento {
  cuando: string
  quien: string
  que: string
}

export const MOVIMIENTOS: Movimiento[] = [
  { cuando: 'hace 4 min', quien: 'Alejandro', que: 'Calzados Aurora → Cita cualificada' },
  { cuando: 'hace 18 min', quien: 'Sistema', que: 'Shoplamp: envío frenado, 34 % del catálogo a cero' },
  { cuando: 'hace 41 min', quien: 'Daniella', que: '18 precios enviados a Creative Toys (ES)' },
  { cuando: 'hace 1 hora', quien: 'Lissy', que: 'Revisada semana 32 de Zapaterías Basoco' },
  { cuando: 'hace 2 horas', quien: 'Carla', que: 'Nordik Home → En seguimiento' },
  { cuando: 'hace 3 horas', quien: 'Sistema', que: 'DIRU: simulacro, 1.204 líneas leídas' },
  { cuando: 'ayer, 18:40', quien: 'Marius', que: 'Cerrada la liquidación de julio' },
  { cuando: 'ayer, 17:02', quien: 'Yasury', que: '9 leads nuevos importados a «Alejandro V2»' },
]

/* ------------------------------------------------------------------ */
/* Perfil de lectura de stock                                          */
/* ------------------------------------------------------------------ */

export type EstadoEjecucion = 'sin_cambios' | 'simulacro' | 'frenado' | 'enviado' | 'error'

/**
 * Los cinco estados de una ejecución, con el matiz que ya estaba decidido y
 * que hay que respetar: `simulacro` va en GRIS y no en verde, porque es el
 * estado de un cliente que NO está mandando nada, y pintarlo de «todo bien» es
 * como se pasan tres semanas creyendo que la automatización está en marcha.
 *
 * Aquí `simulacro` y `sin_cambios` comparten color a propósito, igual que hoy —
 * y por eso mismo NO comparten glifo: matraz para el ensayo, raya para «no
 * había nada que cambiar». Con el color idéntico, la forma es lo único que los
 * separa, y es justo el caso que el criterio 5 pide resolver.
 */
export const EJECUCIONES: Record<
  EstadoEjecucion,
  { etiqueta: string; icono: LucideIcon; varColor: string; pista: string }
> = {
  sin_cambios: {
    etiqueta: 'Sin cambios',
    icono: Minus,
    varColor: 'var(--dz-e-gris)',
    pista: 'Se leyó el fichero y no había nada que actualizar',
  },
  simulacro: {
    etiqueta: 'Simulacro',
    icono: FlaskConical,
    varColor: 'var(--dz-e-gris)',
    pista: 'Se calculó todo pero NO se envió nada a Amazon',
  },
  frenado: {
    etiqueta: 'Frenado',
    icono: AlertTriangle,
    varColor: 'var(--dz-e-ama)',
    pista: 'Saltó un freno: no se ha mandado nada',
  },
  enviado: {
    etiqueta: 'Enviado',
    icono: Send,
    varColor: 'var(--dz-e-verde)',
    pista: 'Los cambios están en Amazon',
  },
  error: {
    etiqueta: 'Error',
    icono: XCircle,
    varColor: 'var(--dz-e-rojo)',
    pista: 'No se pudo leer o no se pudo enviar',
  },
}

export interface Ejecucion {
  cuando: string
  estado: EstadoEjecucion
  lineas: string
  cambios: string
  detalle: string
}

export const HISTORIAL: Ejecucion[] = [
  { cuando: '8 ago, 09:15', estado: 'frenado', lineas: '480', cambios: '163', detalle: '34 % del catálogo se iba a cero (límite 15 %)' },
  { cuando: '8 ago, 08:45', estado: 'sin_cambios', lineas: '480', cambios: '0', detalle: 'Mismo fichero que a las 08:30' },
  { cuando: '8 ago, 08:30', estado: 'enviado', lineas: '480', cambios: '27', detalle: '27 SKU de stock · 0 de precio' },
  { cuando: '7 ago, 19:00', estado: 'enviado', lineas: '479', cambios: '112', detalle: '109 de stock · 3 de precio' },
  { cuando: '7 ago, 18:45', estado: 'simulacro', lineas: '479', cambios: '112', detalle: 'Envío automático apagado' },
  { cuando: '7 ago, 12:10', estado: 'error', lineas: '—', cambios: '—', detalle: 'Drive: el fichero no está compartido con la cuenta de servicio' },
  { cuando: '7 ago, 09:00', estado: 'enviado', lineas: '481', cambios: '44', detalle: '44 de stock · 0 de precio' },
]

export interface Freno {
  etiqueta: string
  nota: string
  valor: string
  unidad: string
  /** Vacío = el freno está APAGADO, y eso hay que decirlo con todas las letras */
  puesto: boolean
}

export const FRENOS: Freno[] = [
  { etiqueta: 'Máximo del catálogo que puede irse a cero', nota: 'Un volcado a medias deja media tienda sin stock en quince minutos.', valor: '15', unidad: '%', puesto: true },
  { etiqueta: 'Variación máxima de precio de una línea', nota: 'Se mira la línea peor, no la media.', valor: '25', unidad: '%', puesto: true },
  { etiqueta: 'Caída máxima de líneas del fichero', nota: 'Un fichero con 8.000 líneas menos es un volcado a medias, no un almacén vacío.', valor: '20', unidad: '%', puesto: true },
  { etiqueta: 'Caída máxima de unidades publicadas', nota: 'Compara el total de unidades contra la última ejecución buena.', valor: '', unidad: '%', puesto: false },
  { etiqueta: 'Máximo de SKU que pueden cambiar de golpe', nota: 'Por encima de esto se para y se avisa, aunque todo lo demás cuadre.', valor: '', unidad: 'SKU', puesto: false },
  { etiqueta: 'Líneas que trae este fichero un día normal', nota: 'La referencia contra la que se miden las caídas.', valor: '480', unidad: 'líneas', puesto: true },
]

export interface Columna {
  etiqueta: string
  nota: string
  valor: string
  obligatoria?: boolean
  /** Qué columna real del fichero se ha llevado el campo en la última prueba */
  resuelta?: string
}

export const COLUMNAS: Columna[] = [
  { etiqueta: 'Referencia del artículo', nota: 'Es la identidad del artículo en el ERP del cliente.', valor: 'Codigo articulo, Cod. articulo, Referencia', obligatoria: true, resuelta: 'Codigo articulo' },
  { etiqueta: 'Unidades en stock', nota: 'Obligatoria en un perfil de stock.', valor: 'Stock real, Stock, Existencias', obligatoria: true, resuelta: 'Stock real' },
  { etiqueta: 'Precio', nota: 'Solo hace falta si el precio sale de una columna.', valor: 'PVP, Precio venta', resuelta: 'PVP' },
  { etiqueta: 'Precio de respaldo', nota: 'Se mira SOLO si la columna de precio viene vacía en esa fila.', valor: 'Tarifa', resuelta: 'Tarifa' },
  { etiqueta: 'Coste', nota: 'Solo hace falta si el precio se calcula por margen.', valor: '', resuelta: undefined },
  { etiqueta: 'Descripción', nota: 'Para reconocer la línea en pantalla. No se envía a Amazon.', valor: 'Descripcion', resuelta: 'Descripcion' },
  { etiqueta: 'Familia', nota: 'Hace falta para poder excluir familias enteras.', valor: 'Tipo, Familia', resuelta: 'Tipo' },
  { etiqueta: 'Código de barras', nota: 'Si el volcado de stock ya lo trae.', valor: 'Codigo barras, EAN', resuelta: 'Codigo barras' },
]

export interface FilaPrueba {
  ref: string
  descripcion: string
  familia: string
  stock: string
  precio: string
  sku: string
}

export const PRUEBA: FilaPrueba[] = [
  { ref: '2200145', descripcion: 'Lámpara de mesa Nordic roble', familia: 'Sobremesa', stock: '48', precio: '54,90 €', sku: '05-NDKE-740Z' },
  { ref: '2200146', descripcion: 'Lámpara de mesa Nordic nogal', familia: 'Sobremesa', stock: '12', precio: '54,90 €', sku: '06-CMX0-93ID' },
  { ref: '2200147', descripcion: 'Aplique pared Loft negro', familia: 'Pared', stock: '0', precio: '38,50 €', sku: '0G-IRKR-QDCK' },
  { ref: '2200151', descripcion: 'Plafón LED 24W blanco', familia: 'Techo', stock: '203', precio: '29,95 €', sku: '0J-P41M-KX2A' },
  { ref: '2200158', descripcion: 'Tira LED 5 m 6500K', familia: 'Decorativa', stock: '87', precio: '17,40 €', sku: '0N-8TQV-B3LE' },
  { ref: '2200162', descripcion: 'Foco orientable GU10 negro', familia: 'Techo', stock: '5', precio: '11,25 €', sku: '0R-2WY9-M7CF' },
]

export const CLIENTES = [
  'Creative Toys',
  'Zapaterías Basoco',
  'GFY Logistic',
  'World Tenda USA',
  'Ocio Global Import',
  'Shoplamp',
  'Yo By Yolanda',
  'Eduardo Gómez',
  'Naelpaa LLC',
  'Keslem',
  'Bodegas Valhalla',
  'Angely sunovia',
  'Cobo Family',
  'A SAUSIN',
  'DIRU',
  'MuayTax',
]
