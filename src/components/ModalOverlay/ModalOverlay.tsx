import React from 'react';
import './ModalOverlay.css';

interface ModalOverlayProps {
  onClose: () => void;
  children: React.ReactNode;
}

// Closes only on a press that starts on the backdrop itself, so a drag that begins inside the popup
// (selecting text, moving a slider) and ends outside it doesn't close it.
const ModalOverlay: React.FC<ModalOverlayProps> = ({ onClose, children }) => (
  <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    {children}
  </div>
);

export default ModalOverlay;
