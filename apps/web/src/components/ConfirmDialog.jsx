import { Modal } from './Modal';

// A yes/no question before something permanent. `pending` disables the confirm
// button while the request is in flight so a double click cannot send it twice.
export function ConfirmDialog({ title, confirmLabel, pendingLabel, pending, onConfirm, onClose, children }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-danger" onClick={onConfirm} disabled={pending}>
            {pending ? pendingLabel : confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
