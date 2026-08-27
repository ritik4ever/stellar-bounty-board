import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import QRCode from 'qrcode';
import WalletQrCodeModal from './WalletQrCodeModal';

// Wrap the real generator in a spy so tests can assert the exact address (and
// SVG output mode) that gets encoded, while still rendering a real QR code.
vi.mock('qrcode', async () => {
  const actual = await vi.importActual<typeof import('qrcode')>('qrcode');
  // Spy on the real generator so the exact address + output mode can be
  // asserted while still rendering a genuine QR code.
  const toString = vi.fn(actual.toString);
  return {
    default: { toString },
    toString,
  };
});

const ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

function renderModal(address: string = ADDRESS) {
  return render(<WalletQrCodeModal address={address} onClose={vi.fn()} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

describe('WalletQrCodeModal', () => {
  it('renders the exact address text alongside a scannable QR code', async () => {
    renderModal();

    expect(screen.getByText(ADDRESS)).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: `QR code for wallet address ${ADDRESS}` })
    ).toBeInTheDocument();
    // The code surface must contain the generated SVG markup.
    await waitFor(() => {
      expect(document.querySelector('.qr-modal__qr svg')).not.toBeNull();
    });
  });

  it('encodes the exact address string shown in the modal as an SVG', async () => {
    renderModal();

    await waitFor(() => {
      expect(QRCode.toString).toHaveBeenCalledWith(
        ADDRESS,
        expect.objectContaining({ type: 'svg' })
      );
    });
  });

  it('calls onClose when the close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<WalletQrCodeModal address={ADDRESS} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<WalletQrCodeModal address={ADDRESS} onClose={onClose} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('has no axe violations', async () => {
    const { container } = renderModal();
    expect(await axe(container)).toHaveNoViolations();
  });
});
