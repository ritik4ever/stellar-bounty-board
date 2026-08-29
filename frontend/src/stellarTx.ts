/**
 * Client-side builder/submitter for the bounty contract's Soroban actions
 * (release_bounty, refund_bounty, dispute_bounty).
 *
 * The flow is: build an unsigned XDR here -> hand it to the connected wallet
 * for signing (useFreighter.signTransaction) -> submit the signed XDR with
 * submitSignedTransaction() -> surface the resulting transaction hash.
 */

import { Contract, TransactionBuilder, nativeToScVal, rpc } from '@stellar/stellar-sdk';

import { STELLAR_NETWORK_PASSPHRASE } from './hooks/useFreighter';

const SOROBAN_RPC_URL =
  import.meta.env.VITE_SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID ?? '';

const BASE_FEE = '1000000';
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 30000;

export type BountyContractFunction = 'release_bounty' | 'refund_bounty' | 'dispute_bounty';

export class ContractCallError extends Error {}

function getServer(): rpc.Server {
  return new rpc.Server(SOROBAN_RPC_URL);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Builds an unsigned Soroban transaction XDR invoking a bounty contract
 * method that takes `(bounty_id: u64, authorized_address: Address)`, ready
 * to be handed to the connected wallet's sign method.
 */
export async function buildBountyActionTransaction(
  functionName: BountyContractFunction,
  bountyId: string,
  signerAddress: string,
  authorizedAddress: string
): Promise<string> {
  if (!CONTRACT_ID) {
    throw new ContractCallError(
      'The Soroban contract address is not configured (VITE_CONTRACT_ID is missing).'
    );
  }

  const server = getServer();

  let account;
  try {
    account = await server.getAccount(signerAddress);
  } catch {
    throw new ContractCallError(
      'Could not load your Stellar account. Make sure it exists and is funded on this network.'
    );
  }

  const contract = new Contract(CONTRACT_ID);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        functionName,
        nativeToScVal(BigInt(bountyId), { type: 'u64' }),
        nativeToScVal(authorizedAddress, { type: 'address' })
      )
    )
    .setTimeout(60)
    .build();

  try {
    const prepared = await server.prepareTransaction(tx);
    return prepared.toXDR();
  } catch (err) {
    throw new ContractCallError(
      err instanceof Error ? `Failed to prepare transaction: ${err.message}` : 'Failed to prepare transaction.'
    );
  }
}

/**
 * Submits a wallet-signed transaction XDR to Soroban RPC and polls until it
 * finalizes, returning the transaction hash on success.
 */
export async function submitSignedTransaction(signedXdr: string): Promise<string> {
  const server = getServer();
  const tx = TransactionBuilder.fromXDR(signedXdr, STELLAR_NETWORK_PASSPHRASE);

  const sendResult = await server.sendTransaction(tx);

  if (sendResult.status === 'ERROR') {
    throw new ContractCallError('The network rejected the transaction submission.');
  }

  const hash = sendResult.hash;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const statusResult = await server.getTransaction(hash);

    if (statusResult.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return hash;
    }

    if (statusResult.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new ContractCallError('The transaction failed on-chain.');
    }

    await wait(POLL_INTERVAL_MS);
  }

  throw new ContractCallError(
    `Transaction submitted (hash ${hash}) but confirmation timed out. Check a Stellar explorer for its final status.`
  );
}
