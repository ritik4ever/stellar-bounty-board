export async function getRecommendedBounties() {
  const response = await fetch('/api/recommended-bounties');
  if (!response.ok) {
    throw new Error('Failed to fetch recommended bounties');
  }
  return response.json();
}
