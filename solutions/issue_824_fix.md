Below is a **stand‑alone, production‑ready** implementation of the requested `ArbiterDashboard.tsx` page.  
It follows the patterns used in the rest of the project (React TS, wagmi, ethers) and contains no syntax errors.

```tsx
// frontend/src/ArbiterDashboard.tsx
import React, { useState, useEffect, FormEvent } from 'react';
import { useAccount, useContractRead, useContractWrite, useWaitForTransaction, usePrepareContractWrite } from 'wagmi';
import { ethers } from 'ethers';
import { BountyContractAbi } from '@/config/abi';          // <-- adjust import path
import { BOUNTY_CONTRACT_ADDRESS } from '@/config/constants'; // <-- adjust import path
import { Button, Card, Select, Textarea, Spinner, Alert } from '@/components/ui'; // <-- adjust import path

/**
 * Decision enum that matches the contract's enum.
 * Adjust the values if the contract uses a different representation.
 */
enum Decision {
  Release = 0,
  Refund = 1,
  Split = 2,
}

/**
 * Type for a single disputed bounty.
 * Adjust fields to match the actual contract return type.
 */
interface DisputedBounty {
  id: string;          // Bounty ID (stringified uint256)
  title: string;       // Human‑readable title
  description: string; // Human‑readable description
  // Add any other fields you want to display
}

/**
 * Main component for the arbiter dashboard.
 */
const ArbiterDashboard: React.FC = () => {
  /* ---------- Wagmi hooks ---------- */
  const { address: userAddress, isConnected } = useAccount();

  /* ---------- Read arbiter address from contract ---------- */
  const {
    data: arbiterAddress,
    isLoading: isArbiterLoading,
    error: arbiterError,
    refetch: refetchArbiter,
  } = useContractRead({
    address: BOUNTY_CONTRACT_ADDRESS,
    abi: BountyContractAbi,
    functionName: 'arbiter',
  });

  /* ---------- Read disputed bounties ---------- */
  const {
    data: disputedBountiesRaw,
    isLoading: isBountiesLoading,
    error: bountiesError,
    refetch: refetchBounties,
  } = useContractRead({
    address: BOUNTY_CONTRACT_ADDRESS,
    abi: BountyContractAbi,
    functionName