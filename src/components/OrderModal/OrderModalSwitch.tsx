import React from 'react';

export interface OrderModalSwitchProps<T extends string | number> {
  /** Names the group for screen readers (e.g. "Order type"). */
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

const OrderModalSwitch = <T extends string | number>({ label, options, value, onChange }: OrderModalSwitchProps<T>): React.ReactElement => (
  <div className="order-modal__mode" role="group" aria-label={label}>
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        className={`order-modal__mode-btn ${value === option.value ? 'active' : ''}`}
        aria-pressed={value === option.value}
        onClick={() => onChange(option.value)}
      >
        {option.label}
      </button>
    ))}
  </div>
);

export default OrderModalSwitch;
