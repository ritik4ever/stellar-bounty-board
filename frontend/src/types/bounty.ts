export type BountyStatus = 'open' | 'in-progress' | 'completed' | 'cancelled';

export interface Bounty {
  id: string;
  title: string;
  description: string;
  amount: string;
  status: BountyStatus;
  creator: string;
  assignee?: string;
  createdAt: string;
  updatedAt: string;
  // Optional fields
  tags?: string[];
  deadline?: string;
  skills?: string[];
}

export interface BountyStatusUpdate {
  bountyId: string;
  status: BountyStatus;
  timestamp: string;
  previousStatus?: BountyStatus;
}
