'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

/**
 * Theme: dark by default, with a light toggle. The `dark` class on <html> drives
 * Tailwind's `dark:` variants. A tiny inline script in app/layout.js applies the
 * saved (or default-dark) theme BEFORE paint to avoid a flash; this provider then
 * keeps React state in sync and persists changes to localStorage.
 */
const ThemeContext = createContext({ theme: 'dark', toggle: () => {}, setTheme: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState('dark');

  // Read whatever the no-flash script already applied to <html>.
  useEffect(() => {
    setThemeState(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  }, []);

  const setTheme = useCallback((t) => {
    const el = document.documentElement;
    el.classList.toggle('dark', t === 'dark');
    el.style.colorScheme = t;
    try { localStorage.setItem('theme', t); } catch { /* ignore */ }
    setThemeState(t);
  }, []);

  const toggle = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, toggle, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
