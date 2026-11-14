import React from 'react';
import ModalOverlay from '@/components/ModalOverlay/ModalOverlay';

const DeleteScripDialog: React.FC<{ label: string; onCancel: () => void; onConfirm: () => void }> = ({ label, onCancel, onConfirm }) => (
  <ModalOverlay onClose={onCancel}>
    <div className="oi-confirm-modal">
      <h4 className="oi-confirm-modal__title">Delete Script Data</h4>
      <p className="oi-confirm-modal__text">
        Delete ALL OI history data for <strong>{label}</strong>? This cannot be undone.
      </p>
      <div className="oi-confirm-modal__actions">
        <button className="app-btn app-btn--secondary" onClick={onCancel}>Cancel</button>
        <button className="app-btn app-btn--danger" onClick={onConfirm}>Delete</button>
      </div>
    </div>
  </ModalOverlay>
);

export default DeleteScripDialog;
