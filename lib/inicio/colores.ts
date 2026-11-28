/** El color de cada sección del Inicio (en orden: Tus apps, y luego cada grupo del menú). El mismo en el móvil y en el ordenador */
export const COLORES_DE_SECCION = ['#FF8A3D', '#38BDF8', '#A78BFA', '#34D399', '#F5B942', '#FF5C8A', '#2DD4BF', '#818CF8'] as const
export const colorDeSeccion = (n: number) => COLORES_DE_SECCION[n % COLORES_DE_SECCION.length]
