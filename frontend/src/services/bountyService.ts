import { Bounty, BountyStatus } from '../types/bounty';

// Base API URL from environment
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export interface BountyResponse {
  id: string;
  title: string;
  description: string;
  amount: string;
  status: BountyStatus;
  creator: string;
  assignee?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BountyStatusUpdate {
  bountyId: string;
  status: BountyStatus;
  timestamp: string;
}

export const bountyService = {
  // Fetch all bounties
  async getAllBounties(): Promise<Bounty[]> {
    const response = await fetch(`${API_URL}/api/bounties`);
    if (!response.ok) {
      throw new Error(`Failed to fetch bounties: ${response.statusText}`);
    }
    const data = await response.json();
    return data.data || data;
  },

  // Fetch a single bounty
  async getBounty(id: string): Promise<Bounty> {
    const response = await fetch(`${API_URL}/api/bounties/${id}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch bounty: ${response.statusText}`);
    }
    const data = await response.json();
    return data.data || data;
  },

  // Subscribe to bounty status updates via SSE
  subscribeToStatusUpdates(
    onUpdate: (update: BountyStatusUpdate) => void,
    onError?: (error: Event) => void
  ): EventSource {
    const eventSource = new EventSource(`${API_URL}/api/bounties/stream`);

    eventSource.addEventListener('bounty-status', (event) => {
      try {
        const data = JSON.parse(event.data);
        onUpdate(data);
      } catch (error) {
        console.error('Failed to parse SSE event:', error);
      }
    });

    eventSource.addEventListener('error', (event) => {
      if (onError) {
        onError(event);
      }
      // EventSource will automatically reconnect
    });

    return eventSource;
  },

  // WebSocket connection for real-time updates
  connectWebSocket(
    onMessage: (data: any) => void,
    onError?: (error: Event) => void,
    onClose?: () => void
  ): WebSocket {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/bounties`;
    const socket = new WebSocket(wsUrl);

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    socket.onerror = (event) => {
      if (onError) onError(event);
    };

    socket.onclose = () => {
      if (onClose) onClose();
    };

    return socket;
  },
};
