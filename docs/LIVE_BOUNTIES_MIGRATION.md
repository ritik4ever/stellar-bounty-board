# Migration Guide: usePolling → useLiveBounties

## Overview

`useLiveBounties` is a drop-in replacement for `usePolling` that adds real-time updates via SSE/WebSocket with automatic fallback to polling.

## Quick Start

### Before (usePolling):

````tsx
function BountyList() {
  const [bounties, setBounties] = useState([]);
  const fetchBounties = async () => {
    const data = await bountyService.getAllBounties();
    setBounties(data);
  };
  usePolling(fetchBounties, 30000);
  return <BountyList data={bounties} />;
}

### After (useLiveBounties):
```tsx
function BountyList() {
  const { bounties, isLoading, isLive, isPolling, refetch } = useLiveBounties({
    enabled: true,
    fallbackInterval: 30000,
  });
  return (
    <div>
      {isLive && <span> Live</span>}
      {isPolling && <span> Polling</span>}
      {isLoading ? <Loader /> : <BountyList data={bounties} />}
    </div>
  );
}

### API Reference
## Options
Option	Type	Default	Description
enabled	boolean	true	Enable live updates
fallbackInterval	number	30000	Polling interval when live fails
maxRetries	number	5	Max reconnection attempts
initialBackoff	number	1000	Initial backoff (ms)
maxBackoff	number	30000	Max backoff (ms)

## Returns
Property	Type	Description
bounties	Bounty[]	Array of bounties
isLoading	boolean	Loading state
error	Error | null	Error state
isLive	boolean	Live connection active
isPolling	boolean	Fallback polling active
refetch	() => Promise<void>	Manual refresh

### Environment Variables
env
VITE_API_URL=http://localhost:3000
VITE_POLL_INTERVAL_MS=30000

## Browser Support
- Chrome, Firefox, Safari, Edge

- EventSource API (SSE)

- WebSocket API

- Automatic fallback for unsupported browsers

## Troubleshooting
Live connection not working
Check if VITE_API_URL is correct

Verify backend SSE/WebSocket endpoint exists

Check browser console for errors

Fallback to polling
The hook automatically falls back to polling after maxRetries attempts

Polling interval is controlled by fallbackInterval

Reconnection
Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s (capped at maxBackoff)

Reconnects automatically when tab becomes visible
````
