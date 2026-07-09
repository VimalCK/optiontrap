import React, { createContext, useContext, useEffect } from 'react';

interface ThemeContextValue {
  theme: 'dark';
}

const ThemeContext = createContext<ThemeContextValue>({ theme: 'dark' });

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  }, []);

  return (
    <ThemeContext.Provider value={{ theme: 'dark' }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextValue => {
  return useContext(ThemeContext);
};
