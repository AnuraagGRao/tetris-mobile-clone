export default function SettingsPage({ config, onConfig, onClose }) {
  const set = (key, val) => onConfig(prev => ({ ...prev, [key]: val }))

  return (
    <div className="about-overlay" onClick={onClose}>
      <div className="about-modal settings-modal" onClick={e => e.stopPropagation()}>
        <button type="button" className="about-close" onClick={onClose} aria-label="Close">✕</button>

        <div className="settings-title">⚙ Settings</div>

        {/* Sound section */}
        <div className="settings-section">
          <div className="settings-section-title">Sound</div>

          <div className="settings-row">
            <span className="settings-label">Music Volume</span>
            <div className="settings-slider-wrap">
              <input
                type="range" min="0" max="1" step="0.05"
                value={config.musicVolume}
                onChange={e => set('musicVolume', +e.target.value)}
                className="settings-slider"
              />
              <span className="settings-val">{Math.round(config.musicVolume * 100)}%</span>
            </div>
          </div>

          <div className="settings-row">
            <span className="settings-label">Sound Effects</span>
            <button
              type="button"
              className={`settings-toggle${config.sfxEnabled ? ' on' : ''}`}
              onClick={() => set('sfxEnabled', !config.sfxEnabled)}
            >
              {config.sfxEnabled ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="settings-row">
            <span className="settings-label">Haptic Feedback</span>
            <button
              type="button"
              className={`settings-toggle${config.hapticEnabled ? ' on' : ''}`}
              onClick={() => set('hapticEnabled', !config.hapticEnabled)}
            >
              {config.hapticEnabled ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        {/* Controls section */}
        <div className="settings-section">
          <div className="settings-section-title">Controls</div>

          <div className="settings-row">
            <span className="settings-label">DAS <span className="settings-val">{config.das}ms</span></span>
            <div className="settings-slider-wrap">
              <input
                type="range" min="30" max="220" step="5"
                value={config.das}
                onChange={e => set('das', +e.target.value)}
                className="settings-slider"
              />
            </div>
          </div>

          <div className="settings-row">
            <span className="settings-label">ARR <span className="settings-val">{config.arr}ms</span></span>
            <div className="settings-slider-wrap">
              <input
                type="range" min="0" max="80" step="5"
                value={config.arr}
                onChange={e => set('arr', +e.target.value)}
                className="settings-slider"
              />
            </div>
          </div>
        </div>

        <button type="button" className="about-install-btn" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}
