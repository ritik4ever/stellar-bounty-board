import type { Meta, StoryObj } from '@storybook/react';
import BountyCard from './BountyCard';
import { actionCopy } from './constants';
import type { Bounty, BountyStatus } from './types';
import type { BountyCardProps } from './BountyCard';

const wallet = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const contributor = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBK';
const now = Math.floor(Date.now() / 1000);

const baseBounty: Bounty = {
  id: 'BNTY-850',
  repo: 'ritik4ever/stellar-bounty-board',
  issueNumber: 850,
  title: 'Improve bounty workflow feedback',
  summary: 'Make status changes and payout progress easier to understand.',
  maintainer: wallet,
  tokenSymbol: 'XLM',
  amount: 250,
  labels: [
    { name: 'frontend', color: '1d76db' },
    { name: 'testing', color: '0e8a16' },
  ],
  status: 'open',
  createdAt: now - 86_400,
  deadlineAt: now + 86_400 * 14,
  version: 1,
  events: [],
};

function bountyFor(status: BountyStatus): Bounty {
  return {
    ...baseBounty,
    id: `BNTY-850-${status}`,
    status,
    contributor: status === 'open' ? undefined : contributor,
    reservedAt: ['reserved', 'submitted', 'disputed', 'released'].includes(status)
      ? now - 43_200
      : undefined,
    submittedAt: ['submitted', 'disputed', 'released'].includes(status) ? now - 21_600 : undefined,
    submissionUrl: ['submitted', 'disputed'].includes(status)
      ? 'https://github.com/ritik4ever/stellar-bounty-board/pull/850'
      : undefined,
    notes:
      status === 'disputed'
        ? 'Maintainer review is paused while the dispute is resolved.'
        : undefined,
  };
}

const meta: Meta<typeof BountyCard> = {
  title: 'Components/BountyCard',
  component: BountyCard,
  parameters: { layout: 'centered' },
  render: (args) => (
    <div style={{ maxWidth: 560 }}>
      <BountyCard {...args} />
    </div>
  ),
};

export default meta;
type Story = StoryObj<typeof BountyCard>;

function cardArgs(status: BountyStatus) {
  return {
    bounty: bountyFor(status),
    onOpen: () => undefined,
    renderActionButton: (
      bounty: Bounty,
      action: Parameters<BountyCardProps['renderActionButton']>[1]
    ) => (
      <button
        key={action.action}
        type="button"
        className={action.action === 'refund' ? 'ghost-button' : 'secondary-button'}
        title={action.title}
        onClick={(event) => event.stopPropagation()}
      >
        {action.label}
      </button>
    ),
  };
}

export const Open: Story = { args: cardArgs('open') };
export const Reserved: Story = { args: cardArgs('reserved') };
export const Submitted: Story = { args: cardArgs('submitted') };
export const Disputed: Story = { args: cardArgs('disputed') };
export const Released: Story = { args: cardArgs('released') };
