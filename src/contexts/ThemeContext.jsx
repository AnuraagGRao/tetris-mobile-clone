import { createContext, useContext, useEffect, useState } from 'react'

export const THEMES = [
  { id: 'neon',   label: 'Neon Glass',     emoji: '💫' },
  { id: 'nebula', label: 'Nebula Drift',   emoji: '🌌' },
  { id: 'arcade', label: 'Arcade Voltage', emoji: '⚡' },
  { id: 'frost',  label: 'Frostbyte',      emoji: '🧊' },
  { id: 'cyber',  label: 'Cyber Grid',     emoji: '🌆' },
  { id: 'zen',    label: 'Zen',            emoji: '🧘' },
]

const ThemeContext = createContext({ theme: 'neon', setTheme: () => {} })

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(
    () => localStorage.getItem('tetris-theme') ?? 'neon'
  )

  useEffect(() => {
    if (theme === 'neon') {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.setAttribute('data-theme', theme)
    }
    localStorage.setItem('tetris-theme', theme)
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
