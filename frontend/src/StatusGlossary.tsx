import React, { useEffect, useRef } from 'react';
import {
  X,
  HelpCircle,
  CheckCircle,
  Clock,
  AlertTriangle,
  XCircle,
  DollarSign,
  Scale,
} from 'lucide-react';
import { statusCopy } from './constants';
import { BountyStatus } from './types';

interface StatusGlossaryProps {
  isOpen: boolean;
  onClose: () => void;
}

const statusIcons: Record<BountyStatus, React.ElementType> = {
  open: DollarSign,
  reserved: Clock,
  submitted: Clock,
  released: CheckCircle,
  refunded: XCircle,
  expired: AlertTriangle,
  disputed: Scale,
};

const actionHelp = [
  {
    action: 'Reserve',
    role: 'Contributor',
    description:
      'Claim an available bounty to begin working. Sets an exclusivity deadline preventing others from claiming.',
  },
  {
    action: 'Submit',
    role: 'Contributor',
    description:
      'Submit your solution by attaching a GitHub Pull Request URL or demo link for maintainer review.',
  },
  {
    action: 'Release',
    role: 'Maintainer',
    description:
      'Approve the completed contribution and automatically release on-chain escrow funds to the contributor.',
  },
  {
    action: 'Refund',
    role: 'Maintainer',
    description:
      'Reclaim escrowed funds if a bounty expired or the reservation timed out without a satisfactory solution.',
  },
];

/**
 * Status and Action Glossary component explaining lifecycle states and actions (#14).
 */
export default function StatusGlossary({ isOpen, onClose }: StatusGlossaryProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal();
        closeBtnRef.current?.focus();
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="status-glossary-dialog"
      onKeyDown={handleKeyDown}
      onClick={handleBackdropClick}
      data-testid="status-glossary-dialog"
      aria-labelledby="glossary-dialog-title"
      style={{
        maxWidth: '680px',
        width: '92%',
        borderRadius: '16px',
        border: '1px solid var(--border, #e5e7eb)',
        padding: '24px',
        background: 'var(--surface, #ffffff)',
        color: 'var(--text, #111827)',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
          borderBottom: '1px solid var(--border, #e5e7eb)',
          paddingBottom: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <HelpCircle size={22} style={{ color: 'var(--primary, #1ebd93)' }} />
          <h2
            id="glossary-dialog-title"
            style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}
          >
            Bounty Status & Actions Guide
          </h2>
        </div>
        <button
          ref={closeBtnRef}
          type="button"
          onClick={onClose}
          aria-label="Close glossary"
          className="icon-button"
          data-testid="close-glossary-btn"
          style={{
            cursor: 'pointer',
            padding: '6px',
            borderRadius: '8px',
            border: 'none',
            background: 'transparent',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <X size={20} />
        </button>
      </div>

      <div style={{ maxHeight: '65vh', overflowY: 'auto', paddingRight: '4px' }}>
        <section aria-labelledby="statuses-section-title" style={{ marginBottom: '24px' }}>
          <h3
            id="statuses-section-title"
            style={{
              fontSize: '1rem',
              fontWeight: 600,
              marginBottom: '12px',
              color: 'var(--muted, #6b7280)',
            }}
          >
            Bounty Lifecycle Statuses
          </h3>
          <div style={{ display: 'grid', gap: '10px' }}>
            {(Object.keys(statusCopy) as BountyStatus[]).map((status) => {
              const info = statusCopy[status];
              const Icon = statusIcons[status] || HelpCircle;
              return (
                <div
                  key={status}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--surface-raised, #f9fafb)',
                    border: '1px solid var(--border-light, #f3f4f6)',
                  }}
                  data-testid={`glossary-item-${status}`}
                >
                  <span
                    className={`status-pill status-pill--${status}`}
                    style={{ flexShrink: 0, marginTop: '2px' }}
                  >
                    <Icon size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    {info.label}
                  </span>
                  <div>
                    <strong style={{ display: 'block', fontSize: '0.875rem', marginBottom: '2px' }}>
                      {info.label}
                    </strong>
                    <span
                      style={{
                        fontSize: '0.8125rem',
                        color: 'var(--muted, #4b5563)',
                        lineHeight: 1.4,
                      }}
                    >
                      {info.description}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="actions-section-title">
          <h3
            id="actions-section-title"
            style={{
              fontSize: '1rem',
              fontWeight: 600,
              marginBottom: '12px',
              color: 'var(--muted, #6b7280)',
            }}
          >
            Action Explanations
          </h3>
          <div style={{ display: 'grid', gap: '10px' }}>
            {actionHelp.map((item) => (
              <div
                key={item.action}
                style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--surface-raised, #f9fafb)',
                  border: '1px solid var(--border-light, #f3f4f6)',
                }}
                data-testid={`glossary-action-${item.action.toLowerCase()}`}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}
                >
                  <strong style={{ fontSize: '0.875rem' }}>{item.action}</strong>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(30, 189, 147, 0.1)',
                      color: '#1ebd93',
                      fontWeight: 500,
                    }}
                  >
                    {item.role} Action
                  </span>
                </div>
                <span
                  style={{ fontSize: '0.8125rem', color: 'var(--muted, #4b5563)', lineHeight: 1.4 }}
                >
                  {item.description}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div
        style={{
          marginTop: '20px',
          display: 'flex',
          justifyContent: 'flex-end',
          borderTop: '1px solid var(--border, #e5e7eb)',
          paddingTop: '16px',
        }}
      >
        <button
          type="button"
          className="secondary-button"
          onClick={onClose}
          style={{ minWidth: '100px' }}
        >
          Got it
        </button>
      </div>
    </dialog>
  );
}
