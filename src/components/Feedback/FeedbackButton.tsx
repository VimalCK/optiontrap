import React, { useState } from 'react';
import { FeedbackType, submitFeedback } from '@/services/feedback';
import '@/styles/feedback.css';

const feedbackTypes: Array<{ id: FeedbackType; label: string }> = [
  { id: 'bug', label: 'Bug' },
  { id: 'feature', label: 'Feature Request' },
  { id: 'general', label: 'General Feedback' },
  { id: 'subscription', label: 'Subscription / Billing' },
];

const FeedbackButton: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>('general');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const close = () => {
    setOpen(false);
    setError(null);
    setSubmitted(false);
  };

  const handleSubmit = async () => {
    const trimmed = message.trim();

    if (trimmed.length < 5) {
      setError('Please enter at least 5 characters.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await submitFeedback({
        type,
        message: trimmed,
        pageUrl: `${window.location.pathname}${window.location.search}`,
        userAgent: navigator.userAgent,
      });
      setSubmitted(true);
      setMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit feedback.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button type="button" className="feedback-fab" onClick={() => setOpen(true)}>
        Feedback
      </button>

      {open && (
        <div className="feedback-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
          <button type="button" className="feedback-modal__backdrop" onClick={close} aria-label="Close feedback" />
          <div className="feedback-modal__card">
            <div className="feedback-modal__header">
              <div>
                <span className="feedback-modal__eyebrow">Help improve OptionTrap</span>
                <h2 id="feedback-title">Send feedback</h2>
              </div>
            </div>

            {submitted ? (
              <div className="feedback-modal__success">
                <strong>Thanks for the feedback.</strong>
                <span>We have received it and will review it.</span>
              </div>
            ) : (
              <>
                <div className="feedback-types">
                  {feedbackTypes.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className={`feedback-type ${type === item.id ? 'feedback-type--active' : ''}`}
                      onClick={() => setType(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <label className="feedback-field">
                  <span>What should we know?</span>
                  <textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="Share the issue, idea, or improvement you have in mind."
                    rows={5}
                  />
                </label>

                {error && <div className="feedback-modal__error">{error}</div>}

                <div className="feedback-modal__actions">
                  <button type="button" className="feedback-secondary" onClick={close}>Cancel</button>
                  <button type="button" className="feedback-primary" onClick={handleSubmit} disabled={submitting}>
                    {submitting ? 'Sending...' : 'Send Feedback'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default FeedbackButton;
