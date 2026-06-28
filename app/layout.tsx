import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, ABeeZee } from "next/font/google";
import "./globals.css";
import 'leaflet/dist/leaflet.css';
import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider } from "@/lib/theme-context";
import ScrollBehavior from "./src/components/ScrollBehavior";

// Runs before first paint to set the `.dark` class from the stored choice (or
// the OS preference), preventing a flash of the wrong theme on load/reload.
const themeScript = `(function(){try{var t=localStorage.getItem('hydroscout_theme');if(t!=='dark'&&t!=='light'){t='light';}var r=document.documentElement;if(t==='dark'){r.classList.add('dark');}r.style.colorScheme=t;}catch(e){}})();`;
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const abeezee = ABeeZee({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-abeezee",
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: "Hydro-Scout",
  description: "Hydro-Scout hydrant monitoring platform",
  icons: {
    icon: "/Hydro-Scout-nobg.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${abeezee.variable} antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
     <body className="h-dvh w-screen flex flex-col bg-white text-neutral-900 dark:bg-[#0b0f14] dark:text-neutral-100" style={{ margin: 0 }}>
  <ThemeProvider>
    <ScrollBehavior />
    <AuthProvider>{children}</AuthProvider>
  </ThemeProvider>
</body>
    </html>
  );
}