import React from 'react';
import Modal from '@/components/Modal/Modal';

const DeleteScripDialog: React.FC<{ label: string; onCancel: () => void; onConfirm: () => void }> = ({ label, onCancel, onConfirm }) => (
  <Modal
    title="Delete Script Data"
    onClose={onCancel}
    footer={(
      <>
        <button type="button" className="app-btn app-btn--secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="app-btn app-btn--danger" onClick={onConfirm}>Delete</button>
      </>
    )}
  >
    <p className="oi-confirm-modal__text">
      Delete ALL OI history data for <strong>{label}</strong>? This cannot be undone.
    </p>
  </Modal>
);

export default DeleteScripDialog;
