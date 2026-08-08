import {
  Activity,
  Boxes,
  CalendarDays,
  Calculator,
  Clock,
  Globe,
  HandCoins,
  Home,
  Landmark,
  Linkedin,
  Megaphone,
  Palmtree,
  PhoneCall,
  PhoneForwarded,
  Plug,
  Send,
  Settings2,
  Tags,
  Timer,
  Users,
  Briefcase,
  Building2,
  type LucideIcon,
} from 'lucide-react'

/**
 * LA PROPUESTA ESTRUCTURAL, que es de lo que va esta dirección.
 *
 * El ERP tiene hoy dieciocho módulos colgando de una sola lista plana, ordenados
 * por el día en que se escribieron. Pero no son dieciocho cosas del mismo tipo:
 * son TRES naturalezas distintas metidas en el mismo cajón.
 *
 *   1. LO MÍO      — mis horas, mis vacaciones, mi agenda. Habla de una persona.
 *   2. MIS CLIENTES — catálogo, precios, stock, campañas. Habla de UNA cuenta de
 *                     Amazon, y no significa nada hasta que se dice cuál.
 *   3. LA AGENCIA  — leads, cold calling, comisiones, tesorería, empleados. Habla
 *                     de la empresa entera.
 *
 * Hoy, para pasar del catálogo de Creative Toys al de Shoplamp hay que volver a la
 * pantalla, buscar el cliente en una tira de botones topada a 128 px que scrollea
 * dentro de sí misma, y volver a filtrar. Y en ningún sitio de la pantalla pone
 * sobre qué cuenta se está trabajando, salvo ese botón encendido.
 *
 * Aquí el cliente es CONTEXTO: se elige arriba, se queda, y todo lo que hay debajo
 * pertenece a esa cuenta. Cambiar de cuenta es un clic desde cualquier pantalla y
 * no te saca de donde estás: si estabas en el catálogo, sigues en el catálogo, con
 * otro cliente.
 *
 * ADOPCIÓN: ninguna ruta del ERP cambia de sitio. Cada `ruta` de aquí abajo es una
 * ruta que YA EXISTE. La reestructuración es de navegación, no de código: el paso 1
 * es esta barra sobre las rutas actuales. El plan por pasos está en el README.
 */

export type EspacioId = 'mio' | 'clientes' | 'agencia'

export interface Espacio {
  id: EspacioId
  nombre: string
  /** Nombre corto para el carril de 60 px */
  corto: string
  icono: LucideIcon
  /** Si es true, todo lo de dentro se lee sobre la cuenta elegida */
  conCuenta: boolean
  descripcion: string
}

export const ESPACIOS: Espacio[] = [
  {
    id: 'mio',
    nombre: 'Mi trabajo',
    corto: 'Mío',
    icono: Briefcase,
    conCuenta: false,
    descripcion: 'Lo que es tuyo y de nadie más: tus horas, tus días, tu agenda.',
  },
  {
    id: 'clientes',
    nombre: 'Mis clientes',
    corto: 'Clientes',
    icono: Building2,
    conCuenta: true,
    descripcion: 'El trabajo sobre una cuenta de Amazon. Elige la cuenta y todo lo de aquí habla de ella.',
  },
  {
    id: 'agencia',
    nombre: 'Agencia',
    corto: 'Agencia',
    icono: Landmark,
    conCuenta: false,
    descripcion: 'La empresa: captación, dinero y equipo. No cuelga de ningún cliente.',
  },
]

export interface Modulo {
  id: string
  nombre: string
  icono: LucideIcon
  /** La ruta real del ERP de hoy. Ninguna cambia */
  ruta: string
  grupo: string
  /** Contador que pide acción. Es de los dos únicos sitios donde hay naranja */
  contador?: number
  contadorTono?: 'accion' | 'neutro'
  soloAdmin?: boolean
}

export const MODULOS: Record<EspacioId, Modulo[]> = {
  mio: [
    { id: 'mi-dia', nombre: 'Mi día', icono: Home, ruta: '/dashboard', grupo: 'Hoy' },
    { id: 'agenda', nombre: 'Agenda Comercial', icono: CalendarDays, ruta: '/dashboard/agenda', grupo: 'Hoy', contador: 3, contadorTono: 'neutro' },
    { id: 'horas', nombre: 'Mis Horas', icono: Timer, ruta: '/dashboard/horas', grupo: 'Mis cosas' },
    { id: 'vacaciones', nombre: 'Mis vacaciones', icono: Palmtree, ruta: '/dashboard/vacaciones', grupo: 'Mis cosas' },
  ],
  clientes: [
    { id: 'resumen', nombre: 'Resumen de la cuenta', icono: Home, ruta: '/dashboard/amazon-api', grupo: 'La cuenta' },
    { id: 'catalogo', nombre: 'Catálogo y precios', icono: Tags, ruta: '/dashboard/amazon-api', grupo: 'La cuenta' },
    { id: 'ads', nombre: 'Amazon Ads', icono: Megaphone, ruta: '/dashboard/marketing-ads', grupo: 'La cuenta' },
    { id: 'stock', nombre: 'Sincronismo de stock', icono: Boxes, ruta: '/dashboard/stock-sync', grupo: 'Automatización' },
    { id: 'perfiles', nombre: 'Perfiles de lectura', icono: Settings2, ruta: '/dashboard/amazon-api', grupo: 'Automatización' },
    { id: 'envios', nombre: 'Cambios enviados', icono: Send, ruta: '/dashboard/amazon-api', grupo: 'Automatización', contador: 14, contadorTono: 'accion' },
    { id: 'conexion', nombre: 'Conexión con Amazon', icono: Plug, ruta: '/dashboard/amazon-api', grupo: 'Automatización', soloAdmin: true },
  ],
  agencia: [
    { id: 'web-leads', nombre: 'CRM Leads Web', icono: Globe, ruta: '/dashboard/web-leads', grupo: 'Captación', contador: 7, contadorTono: 'accion' },
    { id: 'linkedin', nombre: 'LinkedIn Prospección', icono: Linkedin, ruta: '/dashboard/linkedin', grupo: 'Captación' },
    { id: 'cold-calling', nombre: 'Cold Calling', icono: PhoneCall, ruta: '/dashboard/cold-calling', grupo: 'Captación', contador: 14, contadorTono: 'accion' },
    { id: 'commissions', nombre: 'Comisiones', icono: Calculator, ruta: '/dashboard/commissions', grupo: 'Dinero' },
    { id: 'commissions-sf', nombre: 'Comisiones Shoes F', icono: Calculator, ruta: '/dashboard/commissions-shoes-f', grupo: 'Dinero' },
    { id: 'tesoreria', nombre: 'Tesorería', icono: Landmark, ruta: '/dashboard/tesoreria', grupo: 'Dinero' },
    { id: 'empleados', nombre: 'Control empleados', icono: HandCoins, ruta: '/dashboard/empleados', grupo: 'Equipo', soloAdmin: true },
    { id: 'tracker', nombre: 'Employee Tracker', icono: Activity, ruta: '/dashboard/tracker', grupo: 'Equipo' },
    { id: 'users', nombre: 'Gestión de Usuarios', icono: Users, ruta: '/dashboard/users', grupo: 'Equipo', soloAdmin: true },
    { id: 'telefonos', nombre: 'Teléfonos', icono: PhoneForwarded, ruta: '/dashboard/telefonos', grupo: 'Utilidades' },
    { id: 'usos-horarios', nombre: 'Usos horarios', icono: Clock, ruta: '/dashboard/usos-horarios', grupo: 'Utilidades' },
  ],
}

/** Los grupos en el orden en que se pintan, por espacio */
export const ORDEN_GRUPOS: Record<EspacioId, string[]> = {
  mio: ['Hoy', 'Mis cosas'],
  clientes: ['La cuenta', 'Automatización'],
  agencia: ['Captación', 'Dinero', 'Equipo', 'Utilidades'],
}

/**
 * Cuántos módulos se ven a la vez.
 *
 * Hoy la barra lateral mide 1.049 px con los 18 módulos, así que por debajo de esa
 * altura de ventana scrollea sola: con 780 px (portátil de 1440×900 con Chrome) se
 * ven 11 de 18. Aquí el nivel 2 enseña como mucho los 11 de «Agencia», y los tres
 * espacios están siempre a la vista en el carril, que mide 3 × 44 px.
 */
export const MAX_ITEMS_NIVEL_2 = Math.max(...Object.values(MODULOS).map((m) => m.length))
