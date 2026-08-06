import './globals.css';
import { Inter } from 'next/font/google';
import { ThemeProvider } from '@/lib/theme';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata = {
  title: 'ISP Console & Store',
  description: 'Self-service onboarding, operator dashboard, and Wi-Fi storefront',
};

// Applied before paint so there's no light flash on first load. Defaults to dark.
const noFlashTheme = `
try {
  var t = localStorage.getItem('theme') || 'dark';
  var d = document.documentElement;
  d.classList.toggle('dark', t === 'dark');
  d.style.colorScheme = t;
} catch (e) {}
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} dark`} style={{ colorScheme: 'dark' }} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashTheme }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
