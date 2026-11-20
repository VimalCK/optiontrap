import { Tone, type ToneId } from '@/utils/uiEnums';
import './SegmentedControl.css';

export interface SegmentOption<T extends string> {
  id: T;
  label: string;
  /** The active option's colour: Positive (green), Negative (red), Accent (default) or Neutral. */
  tone?: ToneId;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Names the group for screen readers. */
  label: string;
  className?: string;
}

/** A row of joined buttons choosing one of a few options, as wide as its buttons. */
function SegmentedControl<T extends string>({ options, value, onChange, label, className }: SegmentedControlProps<T>) {
  return (
    <div className={['segmented', className].filter(Boolean).join(' ')} role="group" aria-label={label}>
      {options.map(({ id, label: optionLabel, tone = Tone.Accent }) => (
        <button
          key={id}
          type="button"
          className={`segmented__option${id === value ? ` segmented__option--active segmented__option--${tone.toLowerCase()}` : ''}`}
          aria-pressed={id === value}
          onClick={() => onChange(id)}
        >
          {optionLabel}
        </button>
      ))}
    </div>
  );
}

export default SegmentedControl;
