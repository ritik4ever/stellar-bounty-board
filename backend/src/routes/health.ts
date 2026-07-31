import { Router } from 'express';
import { rpc, Contract, TransactionBuilder, Networks, xdr } from '@stellar/stellar-sdk';
import { logStructured } from '../logger';

const router = Router();

// Basic health check
router.get('/', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Deep health check — includes contract version via Soroban simulation
router.get('/deep', async (_req, res) => {
  const start = Date.now();
  const components: Record<string, unknown> = {
    api: 'ok',
    timestamp: new Date().toISOString(),
  };

  try {
    const contractVersion = await getContractVersion();
    components.contract = {
      status: 'ok',
      version: contractVersion,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logStructured('warn', 'health_deep_contract_version_failed', { error: message });
    components.contract = {
      status: 'error',
      version: null,
      error: message,
    };
  }

  const durationMs = Date.now() - start;
  components.durationMs = durationMs;

  res.json({ components });
});

export default router;

// ─── Helper: simulate get_version on the contract ───────────────────────────

async function getContractVersion(): Promise<string> {
  const rpcUrl = process.env.SOROBAN_RPC_URL;
  const contractId = process.env.CONTRACT_ID;
  const networkPassphrase = process.env.SOROBAN_NETWORK_PASSPHRASE || Networks.TESTNET;

  if (!rpcUrl || !contractId) {
    throw new Error('SOROBAN_RPC_URL and CONTRACT_ID must be configured');
  }

  const server = new rpc.Server(rpcUrl);
  const contract = new Contract(contractId);

  // Build a transaction that calls get_version (no args, no auth needed)
  const sourceKeypair = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'; // dummy account for simulation
  const account = await server.getAccount(sourceKeypair).catch(() => ({
    accountId: () => sourceKeypair,
    sequence: () => '0',
  }));

  const tx = new TransactionBuilder(account as any, {
    fee: '100000',
    networkPassphrase,
  })
    .addOperation(contract.call('get_version'))
    .setTimeout(30)
    .build();

  const simulated = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(`Simulation failed: ${JSON.stringify(simulated)}`);
  }

  // Extract the return value from the simulation result
  const result = simulated.result;
  if (!result) {
    throw new Error('Simulation returned no result');
  }

  // Parse ScVal string
  const scVal = xdr.ScVal.fromXDR(result.retval.toXDR(), 'base64');
  if (scVal.switch() !== xdr.ScValType.scvString()) {
    throw new Error(`Expected string return value, got ${scVal.switch().name}`);
  }

  return scVal.str().toString();
}