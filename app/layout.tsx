import type { Metadata } from "next"
import localFont from "next/font/local"
import "./globals.css"

/**
 * LA FUENTE VA GUARDADA AQUÍ DENTRO, NO SE BAJA DE GOOGLE.
 *
 * Antes esto era `Inter` de `next/font/google`, que es más corto de escribir y
 * tiene un problema que no se ve hasta que muerde: `next/font/google` DESCARGA
 * la fuente EN TIEMPO DE COMPILACIÓN. O sea que cada `npm run build` —y aquí se
 * construye dentro de un contenedor, en cada despliegue— necesita salir a
 * fonts.googleapis.com y que conteste bien.
 *
 * El día que no contestó, el despliegue se cayó con esto:
 *
 *     An error occurred in `next/font`.
 *     TypeError: Cannot read properties of null (reading '1')
 *       at .../@next/font/dist/google/loader.js:112:78
 *
 * que no menciona la red por ningún lado: el cargador recibió algo que no era
 * el CSS que esperaba, lo pasó por una expresión regular, y reventó leyendo la
 * posición 1 de un `null`. Un fallo de red disfrazado de fallo de código, en un
 * fichero de node_modules, en un despliegue que no había tocado nada de esto.
 *
 * Con la fuente dentro del repositorio el build no sale a internet para nada.
 * Son 133 KB y compran que un corte de red en Google no pueda tumbar un
 * despliegue.
 *
 * SON DOS FICHEROS Y NO SEIS: Inter es una fuente VARIABLE, así que un solo
 * fichero cubre de 300 a 800 —de ahí `weight: "300 800"`—. Los dos son los dos
 * trozos del alfabeto latino: `latin` lleva lo de siempre (incluidas las
 * tildes, la ñ, las comillas « » y la raya —) y `latin-ext` el resto. Salen de
 * la misma versión que servía Google (v20), con licencia SIL Open Font.
 */
const inter = localFont({
  src: [
    { path: "./fonts/inter-latin.woff2", weight: "300 800", style: "normal" },
    { path: "./fonts/inter-latin-ext.woff2", weight: "300 800", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
  // El de reserva mientras carga. Sin esto el navegador cae en Times New Roman
  // y el salto al cambiar se ve desde la otra punta de la oficina.
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
})

export const metadata: Metadata = {
  title: "Liberty Seller Hub - ERP",
  description: "ERP interno para Liberty Seller",
  icons: {
    icon: '/logos/icon.png',
    apple: '/logos/icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es" className={inter.variable}>
      <body className="antialiased">
        {children}
      </body>
    </html>
  )
}
