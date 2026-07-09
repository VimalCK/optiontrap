import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type AccentTheme = 'indigo' | 'emerald' | 'amber' | 'rose' | 'cyan' | 'violet';

export const ACCENT_THEMES: { id: AccentTheme; label: string; color: string }[] = [
  { id: 'indigo', label: 'Indigo', color: '#6366f1' },
  { id: 'emerald', label: 'Emerald', color: '#10b981' },
  { id: 'amber', label: 'Amber', color: '#f59e0b' },
  { id: 'rose', label: 'Rose', color: '#f43f5e' },
  { id: 'cyan', label: 'Cyan', color: '#06b6d4' },
  { id: 'violet', label: 'Violet', color: '#8b5cf6' },
];

interface ThemeContextValue {
  accent: AccentTheme;
  setAccent: (accent: AccentTheme) => void;
}

const STORAGE_KEY = 'optiontrap_accent';

const ThemeContext = createContext<ThemeContextValue>({
  accent: 'indigo',
  setAccent: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [accent, setAccentState] = useState<AccentTheme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && ACCENT_THEMES.some((t) => t.id === stored)) return stored as AccentTheme;
    return 'indigo';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.setAttribute('data-accent', accent);
    localStorage.setItem(STORAGE_KEY, accent);
  }, [accent]);

  const setAccent = useCallback((a: AccentTheme) => {
    setAccentState(a);
  }, []);

  return (
    <ThemeContext.Provider value={{ accent, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
