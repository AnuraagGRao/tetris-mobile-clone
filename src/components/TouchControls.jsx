const BUTTONS = [
  { key: 'left', label: '◀', hold: true },
  { key: 'right', label: '▶', hold: true },
  { key: 'softDrop', label: '▼', hold: true },
  { key: 'hardDrop', label: '⤓' },
  { key: 'rotateCW', label: '↻' },
  { key: 'hold', label: 'HOLD' },
]

export default function TouchControls({ onPress, onRelease }) {
  return (
    <div className="touch-controls">
      {BUTTONS.map((button) => (
        <button
          key={button.key}
          type="button"
          className="control-button"
          onPointerDown={() => onPress(button.key, button.hold)}
          onPointerUp={() => onRelease(button.key, button.hold)}
          onPointerCancel={() => onRelease(button.key, button.hold)}
        >
          {button.label}
        </button>
      ))}
    </div>
  )
}
