import { THEMES, useTheme } from '../contexts/ThemeContext'

export default function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="theme-switcher" aria-label="Switch theme">
      {THEMES.map(t => (
        <button
          key={t.id}
          type="button"
          className={`theme-btn${theme === t.id ? ' active' : ''}`}
          title={t.label}
          onClick={() => setTheme(t.id)}
        >
          {t.emoji}
        </button>
      ))}
    </div>
  )
}
