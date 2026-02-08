import { useAppStore } from '../store/useAppStore'

export function AppModal() {
  const modal = useAppStore((state) => state.modal)
  const setModal = useAppStore((state) => state.setModal)

  if (!modal) {
    return null
  }

  return (
    <div className="modal-overlay" onClick={() => setModal(null)}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-title">{modal.title}</div>
        <div className="modal-text">{modal.text}</div>
        <div className="modal-actions">
          {modal.actions?.map((action, index) => (
            <button
              key={`${action.label}-${index}`}
              className={action.primary ? 'btn-primary' : 'btn-secondary'}
              onClick={() => {
                action.onClick?.()
                setModal(null)
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
