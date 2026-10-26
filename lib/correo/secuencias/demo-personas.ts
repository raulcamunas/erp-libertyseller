/**
 * LAS PERSONAS INVENTADAS DE LA DEMOSTRACIÓN DE SECUENCIAS — SOLO DATOS.
 * ======================================================================
 * Doce tiendas que no existen, con los mismos datos que tendría su ficha (los campos que lee la IA) y la dirección a la que se les escribiría. Las direcciones llevan «-demo» en el dominio
 * (ceramicamediterranea-demo.es): se ve que son de mentira y, aun así, nada de lo que sale de la demostración puede llegar a nadie, porque no sale de la memoria del servidor. Los textos de sus correos están en demo-textos.ts (los escribió la IA de verdad,
 * una vez, con los mismos prompts que usa el ERP) y lo que les pasa día a día, en demo.ts.
 */

export type BuzonDeDemo = 'A' | 'B'

export interface PersonaDeDemo {
  /** Clave corta y estable: la usan los textos y la historia */
  id: string
  /** 1 a 12: de aquí salen sus identificadores */
  n: number
  buzon: BuzonDeDemo
  /** Lo que se sabe de la tienda, con los campos de la ficha que lee la IA */
  lead: Record<string, unknown>
  email: string
  /** Día hábil, contado desde hoy (0), en que su comercial le escribió el primer correo */
  inscrita: number
  /** A qué hora (minutos desde las 00:00, hora de Madrid) */
  hora: number
}

/** Los dos comerciales de mentira: nombre de pila, el del buzón y su firma */
export const COMERCIALES_DE_DEMO: Record<BuzonDeDemo, { nombre: string; buzon: string; direccion: string; firma: string }> = {
  A: { nombre: 'Lucía', buzon: 'Lucía Ortiz', direccion: 'lucia@demo.libertyseller.example', firma: 'Lucía Ortiz\nLiberty Seller' },
  B: { nombre: 'Marcos', buzon: 'Marcos Vidal', direccion: 'marcos@demo.libertyseller.example', firma: 'Marcos Vidal\nLiberty Seller' },
}

export const PERSONAS_DE_DEMO: readonly PersonaDeDemo[] = [
  {
    id: 'ceramica',
    n: 1,
    buzon: 'A',
    email: 'hola@ceramicamediterranea-demo.es',
    inscrita: -8,
    hora: 9 * 60 + 50,
    lead: { store_name: 'Cerámica Mediterránea', company: 'CERAMICA MEDITERRANEA SL', category: 'Hogar', subcategory: 'Cerámica artesanal', ciudad: 'Valencia', vende_en_amazon: 'no_vende', plataforma: 'Shopify', n_productos: 85, status: 'email_enviado' },
  },
  {
    id: 'audiomax',
    n: 2,
    buzon: 'B',
    email: 'tienda@audiomax-demo.es',
    inscrita: -7,
    hora: 10 * 60 + 15,
    lead: { store_name: 'Audiomax', company: 'AUDIOMAX COMERCIAL SL', category: 'Electrónica', subcategory: 'Audio', ciudad: 'Madrid', vende_en_amazon: 'vende', tipo_lead: 'seller_amazon', n_productos: 240, status: 'email_enviado' },
  },
  {
    id: 'casaluz',
    n: 3,
    buzon: 'A',
    email: 'contacto@casaluzdecoracion-demo.es',
    inscrita: -6,
    hora: 11 * 60 + 5,
    lead: { store_name: 'Casa Luz Decoración', company: 'CASA LUZ DECORACION SL', category: 'Hogar', subcategory: 'Decoración', ciudad: 'Valencia', vende_en_amazon: 'no_vende', plataforma: 'Shopify', n_productos: 24, status: 'email_enviado' },
  },
  {
    id: 'penya',
    n: 4,
    buzon: 'B',
    email: 'info@deportespenya-demo.es',
    inscrita: -6,
    hora: 12 * 60 + 20,
    lead: { store_name: 'Deportes Peña', company: 'DEPORTES PEÑA SL', category: 'Deporte', subcategory: 'Ciclismo', ciudad: 'Zaragoza', vende_en_amazon: 'no_consta', n_productos: 120, status: 'email_enviado' },
  },
  {
    id: 'ortega',
    n: 5,
    buzon: 'A',
    email: 'pedidos@ferreteriaortega-demo.es',
    inscrita: -5,
    hora: 9 * 60 + 40,
    lead: { store_name: 'Ferretería Ortega', company: 'FERRETERIA ORTEGA E HIJOS SL', category: 'Bricolaje', subcategory: 'Herramientas', ciudad: 'Sevilla', vende_en_amazon: 'vende', tipo_lead: 'seller_amazon', n_productos: 600, status: 'email_enviado' },
  },
  {
    id: 'clip',
    n: 6,
    buzon: 'B',
    email: 'hola@papeleriaclip-demo.es',
    inscrita: -4,
    hora: 15 * 60 + 10,
    lead: { store_name: 'Papelería Clip', company: 'PAPELERIA CLIP SL', category: 'Oficina', subcategory: 'Papelería', ciudad: 'Bilbao', vende_en_amazon: 'no_vende', n_productos: 300, status: 'email_enviado' },
  },
  {
    id: 'bicisnorte',
    n: 7,
    buzon: 'A',
    email: 'ventas@bicisnorte-demo.es',
    inscrita: -4,
    hora: 10 * 60 + 30,
    lead: { store_name: 'Bicis Norte', company: 'BICIS NORTE SL', category: 'Deporte', subcategory: 'Bicicletas', ciudad: 'Oviedo', vende_en_amazon: 'no_vende', plataforma: 'WooCommerce', n_productos: 180, status: 'email_enviado' },
  },
  {
    id: 'atlas',
    n: 8,
    buzon: 'B',
    email: 'libreria@libreriaatlas-demo.es',
    inscrita: -3,
    hora: 11 * 60 + 45,
    lead: { store_name: 'Librería Atlas', company: 'LIBRERIA ATLAS SL', category: 'Libros', subcategory: 'Librería generalista', ciudad: 'Salamanca', vende_en_amazon: 'no_vende', plataforma: 'WooCommerce', n_productos: 3000, status: 'email_enviado' },
  },
  {
    id: 'papelpintado',
    n: 9,
    buzon: 'A',
    email: 'info@mundodelpapelpintado-demo.es',
    inscrita: -2,
    hora: 14 * 60 + 25,
    lead: { store_name: 'Mundo del Papel Pintado', company: 'MUNDO DEL PAPEL PINTADO SL', category: 'Hogar', subcategory: 'Decoración', ciudad: 'Málaga', vende_en_amazon: 'no_consta', plataforma: 'PrestaShop', n_productos: 450, status: 'email_enviado' },
  },
  {
    id: 'cosmetica',
    n: 10,
    buzon: 'B',
    email: 'pedidos@cosmeticanatural-demo.es',
    inscrita: 0,
    hora: 9 * 60 + 35,
    lead: { store_name: 'Cosmética Natural', company: 'COSMETICA NATURAL SL', category: 'Belleza', subcategory: 'Cosmética natural', ciudad: 'Granada', vende_en_amazon: 'no_vende', plataforma: 'Shopify', n_productos: 60, status: 'email_enviado' },
  },
  {
    id: 'aurora',
    n: 11,
    buzon: 'A',
    email: 'hola@joyeriaaurora-demo.es',
    inscrita: -7,
    hora: 16 * 60 + 5,
    lead: { store_name: 'Joyería Aurora', company: 'JOYERIA AURORA SL', category: 'Joyería', subcategory: 'Joyería de autor', ciudad: 'Córdoba', vende_en_amazon: 'no_vende', plataforma: 'Shopify', n_productos: 150, status: 'email_enviado' },
  },
  {
    id: 'mascotas',
    n: 12,
    buzon: 'B',
    email: 'tienda@mascotasdelnorte-demo.es',
    inscrita: -1,
    hora: 13 * 60 + 15,
    lead: { store_name: 'Mascotas del Norte', company: 'MASCOTAS DEL NORTE SL', category: 'Mascotas', subcategory: 'Accesorios y alimentación', ciudad: 'Santander', vende_en_amazon: 'vende', tipo_lead: 'seller_amazon', n_productos: 400, status: 'email_enviado' },
  },
]
