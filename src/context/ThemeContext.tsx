import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AccentTheme, type AccentThemeId } from '@/utils/uiEnums';

export const ACCENT_THEMES: { id: AccentThemeId; label: string; color: string }[] = [
  { id: AccentTheme.Indigo, label: 'Indigo', color: 'var(--indigo)' },
  { id: AccentTheme.Emerald, label: 'Emerald', color: 'var(--emerald)' },
  { id: AccentTheme.Amber, label: 'Amber', color: 'var(--warn)' },
  { id: AccentTheme.Rose, label: 'Rose', color: 'var(--rose)' },
  { id: AccentTheme.Cyan, label: 'Cyan', color: 'var(--cyan)' },
  { id: AccentTheme.Violet, label: 'Violet', color: 'var(--violet)' },
];

interface ThemeContextValue {
  accent: AccentThemeId;
  setAccent: (accent: AccentThemeId) => void;
}

const STORAGE_KEY = 'optiontrap_accent';

/**
 * The stylesheet ([data-accent='emerald']) and the saved choice use the
 * accent's lower-case word, so choices saved before the enum still load.
 */
const accentWord = (accent: AccentThemeId) => accent.toLowerCase();

const storedAccent = (stored: string | null): AccentThemeId =>
  ACCENT_THEMES.find((t) => accentWord(t.id) === stored?.toLowerCase())?.id ?? AccentTheme.Indigo;

const ThemeContext = createContext<ThemeContextValue>({
  accent: AccentTheme.Indigo,
  setAccent: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [accent, setAccentState] = useState<AccentThemeId>(() => storedAccent(localStorage.getItem(STORAGE_KEY)));

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.setAttribute('data-accent', accentWord(accent));
    localStorage.setItem(STORAGE_KEY, accentWord(accent));
  }, [accent]);

  const setAccent = useCallback((a: AccentThemeId) => {
    setAccentState(a);
  }, []);

  return (
    <ThemeContext.Provider value={{ accent, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
