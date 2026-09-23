import React from 'react';

interface BountyCardProps {
  bounty: {
    id: string;
    title: string;
    description: string;
    amount: number;
  };
  onView: () => void;
}

export default function BountyCard({ bounty, onView }: BountyCardProps) {
  return (
    <div className="p-4 border rounded shadow-sm">
      <h3 className="text-lg font-semibold">{bounty.title}</h3>
      <p className="text-sm text-gray-600">{bounty.description}</p>
      <p className="mt-2 font-medium">${bounty.amount}</p>
      <button
        type="button"
        className="mt-4 text-blue-600 hover:underline"
        onClick={onView}
      >
        View
      </button>
    </div>
  );
}
