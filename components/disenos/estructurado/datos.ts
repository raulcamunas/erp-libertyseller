/**
 * Contenido REAL del ERP para poder juzgar la propuesta.
 *
 * Los nombres de cliente, los módulos, los estados, los SKU y los textos de ayuda
 * están copiados del repositorio (lib/config/apps.ts, lib/types/cold-leads.ts,
 * lib/types/stock-sync.ts, components/amazon/PerfilConfig.tsx). Las cifras son
 * plausibles y del orden de magnitud del negocio: casi 4.000 leads en cartera,
 * catálogos de miles de SKU, 480 mapeos de Shoplamp con 88 sin referencia.
 *
 * Nada de esto pega a la base de datos: es una maqueta para decidir.
 */

import type { ColdLeadStatus } from '@/lib/types/cold-leads'

/* ================================================================== */
/* Las 16 cuentas                                                      */
/* ================================================================== */

export type EstadoStock = 'enviado' | 'frenado' | 'simulacro' | 'sin_cambios' | 'error' | 'sin_perfil'

export interface Cuenta {
  id: string
  nombre: string
  sigla: string
  /** Mercado principal donde vende */
  mercado: string
  /** Conexión SP-API */
  conexion: 'activa' | 'caducada' | 'revocada' | 'sin_conectar'
  /** Cómo acabó la última lectura de stock de HOY */
  stock: EstadoStock
  stockCuando: string
  /** Cambios de precio o stock tecleados y todavía sin enviar */
  sinEnviar: number
  /** Semana de campañas de Amazon Ads todavía sin revisar */
  adsPendiente: boolean
  /** Tamaño del catálogo. Es un dato de la cuenta, no una comparativa */
  sku: number
}

export const CUENTAS: Cuenta[] = [
  { id: 'creative-toys', nombre: 'Creative Toys', sigla: 'CT', mercado: 'Amazon ES', conexion: 'activa', stock: 'enviado', stockCuando: 'hoy 06:15', sinEnviar: 0, adsPendiente: false, sku: 3412 },
  { id: 'shoplamp', nombre: 'Shoplamp', sigla: 'SL', mercado: 'Amazon ES', conexion: 'activa', stock: 'frenado', stockCuando: 'hoy 06:20', sinEnviar: 14, adsPendiente: true, sku: 480 },
  { id: 'diru', nombre: 'DIRU', sigla: 'DI', mercado: 'Amazon ES', conexion: 'activa', stock: 'enviado', stockCuando: 'hoy 06:22', sinEnviar: 0, adsPendiente: false, sku: 1877 },
  { id: 'a-sausin', nombre: 'A SAUSIN', sigla: 'AS', mercado: 'Amazon FR', conexion: 'activa', stock: 'simulacro', stockCuando: 'hoy 06:31', sinEnviar: 0, adsPendiente: false, sku: 906 },
  { id: 'zapaterias-basoco', nombre: 'Zapaterías Basoco S.L', sigla: 'ZB', mercado: 'Amazon ES', conexion: 'activa', stock: 'sin_perfil', stockCuando: '—', sinEnviar: 6, adsPendiente: true, sku: 13712 },
  { id: 'gfy-logistic', nombre: 'GFY Logistic S.L', sigla: 'GF', mercado: 'Amazon ES', conexion: 'activa', stock: 'sin_perfil', stockCuando: '—', sinEnviar: 0, adsPendiente: false, sku: 2140 },
  { id: 'world-tenda', nombre: 'World Tenda USA', sigla: 'WT', mercado: 'Amazon US', conexion: 'caducada', stock: 'error', stockCuando: 'ayer 22:40', sinEnviar: 0, adsPendiente: true, sku: 744 },
  { id: 'ocio-global', nombre: 'Ocio Global Import S.L', sigla: 'OG', mercado: 'Amazon ES', conexion: 'activa', stock: 'sin_cambios', stockCuando: 'hoy 06:18', sinEnviar: 0, adsPendiente: false, sku: 5290 },
  { id: 'yo-by-yolanda', nombre: 'Yo By Yolanda', sigla: 'YY', mercado: 'Amazon ES', conexion: 'activa', stock: 'sin_perfil', stockCuando: '—', sinEnviar: 2, adsPendiente: false, sku: 318 },
  { id: 'eduardo-gomez', nombre: 'Eduardo Gómez', sigla: 'EG', mercado: 'Amazon ES', conexion: 'activa', stock: 'sin_perfil', stockCuando: '—', sinEnviar: 0, adsPendiente: true, sku: 129 },
  { id: 'naelpaa', nombre: 'Naelpaa LLC', sigla: 'NA', mercado: 'Amazon US', conexion: 'activa', stock: 'sin_perfil', stockCuando: '—', sinEnviar: 0, adsPendiente: false, sku: 402 },
  { id: 'keslem', nombre: 'Keslem', sigla: 'KE', mercado: 'Amazon ES', conexion: 'activa', stock: 'sin_perfil', stockCuando: '—', sinEnviar: 0, adsPendiente: false, sku: 1063 },
  { id: 'bodegas-valhalla', nombre: 'Bodegas Valhalla', sigla: 'BV', mercado: 'Amazon ES', conexion: 'sin_conectar', stock: 'sin_perfil', stockCuando: '—', sinEnviar: 0, adsPendiente: false, sku: 0 },
  { id: 'angely-sunovia', nombre: 'Angely sunovia', sigla: 'AN', mercado: 'Amazon IT', conexion: 'activa', stock: 'sin_perfil', stockCuando: '—', sinEnviar: 0, adsPendiente: false, sku: 267 },
  { id: 'cobo-family', nombre: 'Cobo Family', sigla: 'CF', mercado: 'Amazon ES', conexion: 'activa', stock: 'sin_perfil', stockCuando: '—', sinEnviar: 0, adsPendiente: true, sku: 588 },
  { id: 'muaytax', nombre: 'MuayTax', sigla: 'MT', mercado: 'Amazon ES', conexion: 'revocada', stock: 'sin_perfil', stockCuando: '—', sinEnviar: 0, adsPendiente: false, sku: 91 },
]

/* ================================================================== */
/* Cold Calling: la cartera                                            */
/* ================================================================== */

export interface Lead {
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
  comercial: string
}

export const LEADS: Lead[] = [
  { id: 'l01', tienda: 'MundoBaby Store', empresa: 'Puericultura del Norte S.L', facturacion: 184300, estado: 'cita_cualificada', telefono: '944 21 88 30', rellamar: null, seguimiento: 'Sesión el jueves 14 a las 16:00 con el gerente', email: 'info@mundobaby.es', provincia: 'Bizkaia', categoria: 'Bebé', lista: '1a lista', comercial: 'Alejandro' },
  { id: 'l02', tienda: 'TecnoHogar24', empresa: 'Distribuciones Levante S.A', facturacion: 142800, estado: 'seguimiento', telefono: '963 45 12 09', rellamar: '2026-08-11', seguimiento: 'Le interesa PPC pero quiere ver un caso de su categoría', email: 'compras@tecnohogar24.com', provincia: 'Valencia', categoria: 'Hogar', lista: '1a lista', comercial: 'Carla' },
  { id: 'l03', tienda: 'Deportes Aritz', empresa: 'Aritz Sport S.L', facturacion: 128400, estado: 'no_contesta', telefono: '948 30 77 41', rellamar: '2026-08-08', seguimiento: 'Tercer intento, siempre salta buzón por la mañana', email: null, provincia: 'Navarra', categoria: 'Deporte', lista: 'Alejandro V2', comercial: 'Alejandro' },
  { id: 'l04', tienda: 'La Botica Natural', empresa: 'Herbolarios Ruiz S.L', facturacion: 96200, estado: 'email_enviado', telefono: '957 22 40 18', rellamar: '2026-08-12', seguimiento: 'Mandada la propuesta de auditoría el 5/8', email: 'pedidos@laboticanatural.es', provincia: 'Córdoba', categoria: 'Salud', lista: '1a lista', comercial: 'Carla' },
  { id: 'l05', tienda: 'ElectroPunto', empresa: 'Electro Punto Ibérica S.L', facturacion: 213500, estado: 'programado', telefono: '917 55 60 23', rellamar: '2026-08-09', seguimiento: 'Rellamar el lunes a las 10:00, pidió él la hora', email: 'direccion@electropunto.es', provincia: 'Madrid', categoria: 'Electrónica', lista: '1a lista', comercial: 'Alejandro' },
  { id: 'l06', tienda: 'Kids & Co', empresa: 'Comercial Infantil Sur S.L', facturacion: 74900, estado: 'pendiente', telefono: '954 18 92 66', rellamar: null, seguimiento: '', email: 'hola@kidsandco.es', provincia: 'Sevilla', categoria: 'Bebé', lista: 'Alejandro V2', comercial: 'Alejandro' },
  { id: 'l07', tienda: 'Zapatos Marbella', empresa: 'Calzados MB S.L', facturacion: 58300, estado: 'no_interesa', telefono: '952 77 31 05', rellamar: null, seguimiento: 'Ya tiene agencia con contrato hasta enero', email: null, provincia: 'Málaga', categoria: 'Calzado', lista: '1a lista', comercial: 'Carla' },
  { id: 'l08', tienda: 'Bricolaje Mayor', empresa: 'Suministros Mayor S.A', facturacion: 305100, estado: 'seguimiento', telefono: '983 40 15 72', rellamar: '2026-08-13', seguimiento: 'Quiere números de ACOS antes de sentarse', email: 'jefe.ventas@brimayor.es', provincia: 'Valladolid', categoria: 'Bricolaje', lista: '1a lista', comercial: 'Alejandro' },
  { id: 'l09', tienda: 'Petit Gourmet', empresa: 'Gourmet Delicatessen S.L', facturacion: 41700, estado: 'no_contesta', telefono: '972 60 84 19', rellamar: '2026-08-08', seguimiento: 'Cuelga en cuanto oye «agencia»', email: 'info@petitgourmet.cat', provincia: 'Girona', categoria: 'Alimentación', lista: 'Alejandro V2', comercial: 'Carla' },
  { id: 'l10', tienda: 'Óptica Vistalux', empresa: 'Vistalux Retail S.L', facturacion: 87600, estado: 'pendiente', telefono: '976 33 21 47', rellamar: null, seguimiento: '', email: null, provincia: 'Zaragoza', categoria: 'Salud', lista: '1a lista', comercial: 'Alejandro' },
  { id: 'l11', tienda: 'Mascotas Feliz', empresa: 'Animalia Distribución S.L', facturacion: 119200, estado: 'cita_cualificada', telefono: '928 47 55 90', rellamar: null, seguimiento: 'Consultoría cerrada para el 18, viene con su socio', email: 'admin@mascotasfeliz.es', provincia: 'Las Palmas', categoria: 'Mascotas', lista: '1a lista', comercial: 'Carla' },
  { id: 'l12', tienda: 'Moto Racing Store', empresa: 'MRS Componentes S.L', facturacion: 165400, estado: 'email_enviado', telefono: '961 20 78 34', rellamar: '2026-08-14', seguimiento: 'Enviado el dossier, dijo que lo mira esta semana', email: 'ventas@motoracingstore.com', provincia: 'Valencia', categoria: 'Automoción', lista: 'Alejandro V2', comercial: 'Alejandro' },
  { id: 'l13', tienda: 'Casa Textil', empresa: 'Textiles del Segura S.L', facturacion: 92800, estado: 'programado', telefono: '968 51 09 62', rellamar: '2026-08-08', seguimiento: 'Rellamada HOY a las 12:30', email: 'compras@casatextil.es', provincia: 'Murcia', categoria: 'Hogar', lista: '1a lista', comercial: 'Carla' },
  { id: 'l14', tienda: 'Jardinova', empresa: 'Jardín y Riego Norte S.L', facturacion: 63100, estado: 'seguimiento', telefono: '985 12 66 08', rellamar: '2026-08-19', seguimiento: 'Temporada alta, vuelve a llamar en septiembre', email: null, provincia: 'Asturias', categoria: 'Jardín', lista: 'Alejandro V2', comercial: 'Alejandro' },
  { id: 'l15', tienda: 'Belleza Prime', empresa: 'Cosmética Atlántica S.L', facturacion: 227900, estado: 'pendiente', telefono: '981 44 70 25', rellamar: null, seguimiento: '', email: 'info@bellezaprime.es', provincia: 'A Coruña', categoria: 'Belleza', lista: '1a lista', comercial: 'Carla' },
  { id: 'l16', tienda: 'ToolMaster ES', empresa: 'Herramientas Profesionales S.A', facturacion: 411600, estado: 'programado', telefono: '934 88 12 51', rellamar: '2026-08-10', seguimiento: 'Habla con el director el viernes, pide propuesta cerrada', email: 'direccion@toolmaster.es', provincia: 'Barcelona', categoria: 'Herramientas', lista: '1a lista', comercial: 'Alejandro' },
  { id: 'l17', tienda: 'Vinos del Duero', empresa: 'Bodegas Reunidas S.L', facturacion: 78400, estado: 'no_interesa', telefono: '980 62 33 17', rellamar: null, seguimiento: 'No vende en Amazon y no quiere empezar', email: null, provincia: 'Zamora', categoria: 'Alimentación', lista: 'Alejandro V2', comercial: 'Carla' },
  { id: 'l18', tienda: 'Papelería Lumen', empresa: 'Lumen Oficina S.L', facturacion: 34900, estado: 'no_contesta', telefono: '925 71 04 88', rellamar: '2026-08-08', seguimiento: 'Segundo intento', email: 'pedidos@lumen.es', provincia: 'Toledo', categoria: 'Oficina', lista: '1a lista', comercial: 'Alejandro' },
  { id: 'l19', tienda: 'Camping Aventura', empresa: 'Outdoor Ibérica S.L', facturacion: 156700, estado: 'seguimiento', telefono: '941 25 90 36', rellamar: '2026-08-11', seguimiento: 'Interesado en el sincronismo de stock, no en PPC', email: 'info@campingaventura.es', provincia: 'La Rioja', categoria: 'Deporte', lista: '1a lista', comercial: 'Carla' },
  { id: 'l20', tienda: 'MueblesYa', empresa: 'Muebles Rápidos S.L', facturacion: 198200, estado: 'pendiente', telefono: '967 30 41 29', rellamar: null, seguimiento: '', email: null, provincia: 'Albacete', categoria: 'Hogar', lista: 'Alejandro V2', comercial: 'Alejandro' },
  { id: 'l21', tienda: 'Farmacia Online Plus', empresa: 'Parafarmacia Digital S.L', facturacion: 103500, estado: 'email_enviado', telefono: '958 26 71 40', rellamar: '2026-08-12', seguimiento: 'Pidió el caso de Creative Toys por correo', email: 'gestion@farmaciaplus.es', provincia: 'Granada', categoria: 'Salud', lista: '1a lista', comercial: 'Carla' },
  { id: 'l22', tienda: 'GamerZone', empresa: 'GZ Retail S.L', facturacion: 271300, estado: 'cita_cualificada', telefono: '912 04 55 77', rellamar: null, seguimiento: 'Cita el 20 a las 11:00, quiere hablar de marca privada', email: 'ceo@gamerzone.es', provincia: 'Madrid', categoria: 'Videojuegos', lista: '1a lista', comercial: 'Alejandro' },
  { id: 'l23', tienda: 'Cocina Pro', empresa: 'Menaje Profesional S.L', facturacion: 88100, estado: 'no_contesta', telefono: '986 33 12 64', rellamar: '2026-08-09', seguimiento: 'Buzón lleno', email: null, provincia: 'Pontevedra', categoria: 'Hogar', lista: 'Alejandro V2', comercial: 'Carla' },
  { id: 'l24', tienda: 'Libros del Sur', empresa: 'Ediciones Andaluzas S.L', facturacion: 26400, estado: 'pendiente', telefono: '950 18 33 92', rellamar: null, seguimiento: '', email: 'info@librosdelsur.es', provincia: 'Almería', categoria: 'Libros', lista: '1a lista', comercial: 'Alejandro' },
  { id: 'l25', tienda: 'Auto Repuestos MG', empresa: 'MG Recambios S.A', facturacion: 342000, estado: 'seguimiento', telefono: '947 55 20 13', rellamar: '2026-08-15', seguimiento: 'Reunión interna el 14, nos dice algo después', email: 'compras@mgrecambios.es', provincia: 'Burgos', categoria: 'Automoción', lista: '1a lista', comercial: 'Carla' },
  { id: 'l26', tienda: 'Nutrisport Direct', empresa: 'Nutrición Deportiva S.L', facturacion: 174800, estado: 'programado', telefono: '937 12 48 05', rellamar: '2026-08-08', seguimiento: 'Rellamada HOY a las 17:00', email: 'hola@nutrisportdirect.com', provincia: 'Barcelona', categoria: 'Salud', lista: 'Alejandro V2', comercial: 'Alejandro' },
  { id: 'l27', tienda: 'Joyería Aurum', empresa: 'Aurum Selección S.L', facturacion: 49600, estado: 'no_interesa', telefono: '924 40 66 71', rellamar: null, seguimiento: 'Margen bajo, no le compensa la comisión', email: null, provincia: 'Badajoz', categoria: 'Joyería', lista: '1a lista', comercial: 'Carla' },
  { id: 'l28', tienda: 'Piscinas Delta', empresa: 'Delta Wellness S.L', facturacion: 137200, estado: 'pendiente', telefono: '977 63 90 44', rellamar: null, seguimiento: '', email: 'ventas@piscinasdelta.es', provincia: 'Tarragona', categoria: 'Jardín', lista: 'Alejandro V2', comercial: 'Alejandro' },
  { id: 'l29', tienda: 'Smart Office ES', empresa: 'Equipamiento Digital S.L', facturacion: 66300, estado: 'email_enviado', telefono: '923 21 07 58', rellamar: '2026-08-13', seguimiento: 'Le mandé tarifas, dice que caro', email: 'admin@smartoffice.es', provincia: 'Salamanca', categoria: 'Oficina', lista: '1a lista', comercial: 'Carla' },
  { id: 'l30', tienda: 'EcoLimpieza', empresa: 'Productos Verdes S.L', facturacion: 31800, estado: 'no_contesta', telefono: '969 44 82 30', rellamar: '2026-08-10', seguimiento: 'Cuarto intento', email: null, provincia: 'Cuenca', categoria: 'Droguería', lista: 'Alejandro V2', comercial: 'Alejandro' },
  { id: 'l31', tienda: 'Náutica Sur', empresa: 'Marina Comercial S.L', facturacion: 208700, estado: 'seguimiento', telefono: '956 30 11 92', rellamar: '2026-08-18', seguimiento: 'Vuelve de vacaciones el 18', email: 'info@nauticasur.es', provincia: 'Cádiz', categoria: 'Náutica', lista: '1a lista', comercial: 'Carla' },
  { id: 'l32', tienda: 'Instrumentos Vega', empresa: 'Vega Música S.L', facturacion: 54200, estado: 'pendiente', telefono: '987 26 74 11', rellamar: null, seguimiento: '', email: 'tienda@instrumentosvega.es', provincia: 'León', categoria: 'Música', lista: 'Alejandro V2', comercial: 'Alejandro' },
]

/** Los cuatro números de la cabecera de Cold Calling, con la cartera real */
export const CIFRAS_COLD = {
  cartera: 3847,
  trabajados: 1126,
  citas: 78,
  conversion: '2,0 %',
  rellamadasHoy: 14,
}

/* ================================================================== */
/* Pantalla 3: el perfil de lectura de Shoplamp                        */
/* ================================================================== */

export interface Freno {
  codigo: string
  etiqueta: string
  valor: string
  unidad: string
  puesto: boolean
  nota?: string
}

export const FRENOS: Freno[] = [
  {
    codigo: 'pct_a_cero',
    etiqueta: 'Máximo del catálogo que puede irse a cero',
    valor: '15',
    unidad: '%',
    puesto: true,
  },
  {
    codigo: 'variacion_precio',
    etiqueta: 'Variación máxima de precio de una línea',
    valor: '',
    unidad: '%',
    puesto: false,
    nota: 'Se mira la línea peor, no la media.',
  },
  {
    codigo: 'caida_lineas',
    etiqueta: 'Caída máxima de líneas del fichero',
    valor: '25',
    unidad: '%',
    puesto: true,
    nota: 'Un fichero con 8.000 líneas menos es un volcado a medias, no un almacén vacío.',
  },
  {
    codigo: 'caida_unidades',
    etiqueta: 'Caída máxima de unidades publicadas',
    valor: '40',
    unidad: '%',
    puesto: true,
    nota: 'El único que ve un derrumbe de stock que NO llega a cero: un fichero con todas sus líneas y las cantidades divididas por mil no mueve ninguno de los otros.',
  },
  {
    codigo: 'max_cambios',
    etiqueta: 'Máximo de SKU que pueden cambiar de golpe',
    valor: '',
    unidad: 'SKU',
    puesto: false,
  },
  {
    codigo: 'lineas_referencia',
    etiqueta: 'Líneas que trae este fichero un día normal',
    valor: '480',
    unidad: 'líneas',
    puesto: true,
    nota: 'Es la referencia del freno de caída. Mientras esté vacío, ese freno queda declarado pero NO PUEDE SALTAR: no hay con qué comparar.',
  },
]

export interface FilaPrueba {
  sku: string
  referencia: string
  descripcion: string
  stock: number
  precio: number | null
  aviso?: string
}

export const PRUEBA: FilaPrueba[] = [
  { sku: '05-NDKE-740Z', referencia: '0050119247', descripcion: 'Lámpara de pie trípode madera natural', stock: 34, precio: 78.9 },
  { sku: '06-CMX0-93ID', referencia: '0050119310', descripcion: 'Aplique de pared latón mate E14', stock: 0, precio: 24.5 },
  { sku: '0G-IRKR-QDCK', referencia: '0050120044', descripcion: 'Plafón LED 24W regulable 40 cm', stock: 112, precio: 45.0 },
  { sku: '1H-8PLQ-M2VB', referencia: '0050120051', descripcion: 'Lámpara colgante mimbre 45 cm', stock: 7, precio: 62.3 },
  { sku: '2K-QW3E-77TR', referencia: '50120118', descripcion: 'Flexo escritorio USB blanco', stock: 240, precio: 19.9, aviso: 'La referencia viene sin los ceros de la izquierda' },
  { sku: '3M-ZX9C-04LP', referencia: '0050120233', descripcion: 'Lámpara sobremesa cerámica azul', stock: 18, precio: null, aviso: 'Sin precio en el fichero: se usaría el de respaldo' },
  { sku: '4N-VB6N-81QA', referencia: '0050120290', descripcion: 'Tira LED 5 m 6500K con adaptador', stock: 96, precio: 15.75 },
  { sku: '5P-JH2K-33WE', referencia: '0050120344', descripcion: 'Lámpara exterior solar acero inox', stock: 0, precio: 38.2 },
]

export const COLUMNAS_DETECTADAS = [
  { campo: 'Referencia del artículo', alias: 'Codigo articulo, Referencia, Ref', columna: 'Codigo articulo', obligatorio: true },
  { campo: 'Unidades en stock', alias: 'Stock real, Stock, Existencias', columna: 'Stock real', obligatorio: true },
  { campo: 'Precio', alias: 'PVP, Precio venta', columna: 'PVP', obligatorio: false },
  { campo: 'Precio de respaldo', alias: 'Tarifa, Precio tarifa', columna: '— no encontrada —', obligatorio: false },
  { campo: 'Coste', alias: 'Coste, Precio coste', columna: '— no encontrada —', obligatorio: false },
]

export interface Ejecucion {
  fecha: string
  estado: 'enviado' | 'frenado' | 'simulacro' | 'sin_cambios' | 'error'
  lineas: number
  cambios: number
  detalle: string
}

export const EJECUCIONES: Ejecucion[] = [
  { fecha: 'hoy 06:20', estado: 'frenado', lineas: 392, cambios: 0, detalle: 'El fichero trae muchas menos líneas de lo habitual: 392 frente a 480 (−18,3 %), límite 25 %… no, saltó el de referencias a cero' },
  { fecha: 'ayer 06:19', estado: 'enviado', lineas: 480, cambios: 63, detalle: '63 SKU actualizados en Amazon ES' },
  { fecha: '6 ago 06:18', estado: 'sin_cambios', lineas: 480, cambios: 0, detalle: 'El fichero es idéntico al de ayer' },
  { fecha: '5 ago 06:21', estado: 'enviado', lineas: 479, cambios: 12, detalle: '12 SKU actualizados en Amazon ES' },
  { fecha: '4 ago 18:02', estado: 'simulacro', lineas: 480, cambios: 41, detalle: 'Perfil en simulacro: NO se envió nada a Amazon' },
  { fecha: '4 ago 06:20', estado: 'error', lineas: 0, cambios: 0, detalle: 'El conector de Drive no encontró el fichero del día' },
]

/* ================================================================== */
/* Pantalla 1: mi día                                                  */
/* ================================================================== */

export const MI_DIA = {
  nombre: 'Raúl',
  horasHoy: '5 h 20 min',
  horasSemana: '31 h 15 min',
  vacaciones: { disponibles: 11, pedidos: 12, generados: 23 },
  citasHoy: [
    { hora: '12:30', que: 'Rellamada · Casa Textil', donde: 'Cold Calling' },
    { hora: '16:00', que: 'Consultoría · MundoBaby Store', donde: 'Agenda' },
    { hora: '17:00', que: 'Rellamada · Nutrisport Direct', donde: 'Cold Calling' },
  ],
  leadsWebSinLeer: 7,
}
