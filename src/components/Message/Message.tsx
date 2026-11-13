import React from 'react';
import './Message.css';
import { MessageTone, type MessageToneId } from '@/utils/uiEnums';

export interface MessageProps {
  tone: MessageToneId;
  children: React.ReactNode;
  /** Spacing where the page places it (a margin); the look itself is the component's. */
  className?: string;
}

/** An error is announced to screen readers at once (alert); a notice when they are idle (status). */
const Message: React.FC<MessageProps> = ({ tone, children, className }) => (
  <div
    className={['message', `message--${tone.toLowerCase()}`, className].filter(Boolean).join(' ')}
    role={tone === MessageTone.Error ? 'alert' : 'status'}
  >
    {children}
  </div>
);

export default Message;
