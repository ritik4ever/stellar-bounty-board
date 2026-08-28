import type { Meta, StoryObj } from '@storybook/react';
import BountyDetailPage from './BountyDetailPage';
import { actionCopy, statusCopy } from './constants';
import type { Bounty } from './types';

const wallet = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const contributor = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBK';
const now = Math.floor(Date.now() / 1000);

const normalBounty: Bounty = {
  id: 'BNTY-850-detail',
  repo: 'ritik4ever/stellar-bounty-board',
  issueNumber: 850,
  title: 'Add Storybook coverage for bounty views',
  summary: 'Document the main bounty states so UI changes can be reviewed quickly.',
  maintainer: wallet,
  contributor,
  tokenSymbol: 'USDC',
  amount: 125,
  labels: [{ name: 'frontend', color: '1d76db' }],
  status: 'submitted',
  createdAt: now - 86_400 * 3,
  deadlineAt: now + 86_400 * 10,
  reservedAt: now - 86_400 * 2,
  submittedAt: now - 3_600,
  submissionUrl: 'https://github.com/ritik4ever/stellar-bounty-board/pull/850',
  version: 3,
  events: [
    { type: 'created', timestamp: now - 86_400 * 3, actor: wallet.slice(0, 8) },
    { type: 'reserved', timestamp: now - 86_400 * 2, actor: contributor.slice(0, 8) },
    { type: 'submitted', timestamp: now - 3_600, actor: contributor.slice(0, 8) },
  ],
};

const disputedBounty: Bounty = {
  ...normalBounty,
  id: 'BNTY-850-disputed',
  title: 'Resolve disputed submission review',
  status: 'disputed',
  notes: 'The contributor requested an independent review of the submitted work.',
  version: 4,
  events: [
    ...normalBounty.events,
    { type: 'disputed', timestamp: now - 1_800, actor: contributor.slice(0, 8) },
  ],
};

const meta: Meta<typeof BountyDetailPage> = {
  title: 'Pages/BountyDetailPage',
  component: BountyDetailPage,
  parameters: { layout: 'fullscreen' },
  args: {
    loading: false,
    onBack: () => undefined,
    owner: 'ritik4ever',
    avatarUrl: 'https://github.com/ritik4ever.png?size=72',
    statusCopy,
    actionCopy,
    renderActionButton: (bounty, action) => (
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
    formatTimestamp: (value) => (value ? new Date(value * 1000).toLocaleString() : '-'),
  },
};

export default meta;
type Story = StoryObj<typeof BountyDetailPage>;

export const Normal: Story = { args: { bounty: normalBounty } };
export const Disputed: Story = { args: { bounty: disputedBounty } };
