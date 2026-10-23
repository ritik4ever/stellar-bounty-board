import { describe, expect, it } from 'vitest';
import { Keypair, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { normalizeEvent } from '../worker/indexer.js';

describe('Soroban indexer event normalization', () => {
  it('normalizes a Bounty/Refund event with its complete payload', () => {
    const maintainer = Keypair.random().publicKey();
    const topic = (name: string) => xdr.ScVal.scvSymbol(name).toXDR('base64');
    const value = nativeToScVal(
      { bounty_id: 12n, maintainer, amount: 500n },
      {
        type: {
          bounty_id: ['symbol', 'u64'],
          maintainer: ['symbol', 'address'],
          amount: ['symbol', 'i128'],
        },
      }
    ).toXDR('base64');

    expect(
      normalizeEvent({
        id: 'event-12',
        topic: [topic('Bounty'), topic('Refund')],
        value,
        ledger_closed_at: '2026-10-21T12:00:00Z',
      })
    ).toMatchObject({
      id: 'event-12',
      type: 'refund',
      bountyId: '12',
      actor: maintainer,
      maintainer,
      amount: '500',
      timestamp: '2026-10-21T12:00:00Z',
    });
  });

  it('normalizes a Bounty/Dispt event with its complete payload', () => {
    const contributor = Keypair.random().publicKey();
    const arbiter = Keypair.random().publicKey();
    const topic = (name: string) => xdr.ScVal.scvSymbol(name).toXDR('base64');
    const value = nativeToScVal(
      { bounty_id: 15n, contributor, arbiter },
      {
        type: {
          bounty_id: ['symbol', 'u64'],
          contributor: ['symbol', 'address'],
          arbiter: ['symbol', 'address'],
        },
      }
    ).toXDR('base64');

    expect(
      normalizeEvent({
        id: 'event-15',
        topic: [topic('Bounty'), topic('Dispt')],
        value,
        ledger_closed_at: '2026-10-22T05:00:00Z',
      })
    ).toMatchObject({
      id: 'event-15',
      type: 'disputed',
      bountyId: '15',
      actor: contributor,
      contributor,
      arbiter,
      timestamp: '2026-10-22T05:00:00Z',
    });
  });

  it('normalizes a Bounty/Submit event with its complete payload', () => {
    const contributor = Keypair.random().publicKey();
    const topic = (name: string) => xdr.ScVal.scvSymbol(name).toXDR('base64');
    const value = nativeToScVal(
      { bounty_id: 14n, contributor },
      {
        type: {
          bounty_id: ['symbol', 'u64'],
          contributor: ['symbol', 'address'],
        },
      }
    ).toXDR('base64');

    expect(
      normalizeEvent({
        id: 'event-14',
        topic: [topic('Bounty'), topic('Submit')],
        value,
        ledger_closed_at: '2026-10-22T06:00:00Z',
      })
    ).toMatchObject({
      id: 'event-14',
      type: 'submit',
      bountyId: '14',
      actor: contributor,
      contributor,
      timestamp: '2026-10-22T06:00:00Z',
    });
  });

  it('consumes a Bounty/Queried event without a follow-up contract read', () => {
    const maintainer = Keypair.random().publicKey();
    const contributor = Keypair.random().publicKey();
    const topic = (name: string) => xdr.ScVal.scvSymbol(name).toXDR('base64');
    const entry = (key: string, val: xdr.ScVal) =>
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });
    const value = xdr.ScVal.scvMap([
      entry('bounty_id', nativeToScVal(42n, { type: 'u64' })),
      entry('maintainer', nativeToScVal(maintainer, { type: 'address' })),
      entry('contributor', nativeToScVal(contributor, { type: 'address' })),
      entry('amount', nativeToScVal(500n, { type: 'i128' })),
      entry('status', xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Expired')])),
      entry('deadline', nativeToScVal(1_700_000_000n, { type: 'u64' })),
    ]).toXDR('base64');

    const record = normalizeEvent({
      id: 'event-42',
      topic: [topic('Bounty'), topic('Queried')],
      value,
      ledger_closed_at: '2026-10-22T07:00:00Z',
    });

    expect(record).toMatchObject({
      id: 'event-42',
      type: 'queried',
      bountyId: '42',
      // `actor` keeps the worker's existing maintainer-first precedence.
      actor: maintainer,
      status: 'Expired',
      deadline: '1700000000',
      timestamp: '2026-10-22T07:00:00Z',
    });
    // The whole mutable projection is available, with the unit-variant status
    // flattened, so no follow-up read is needed to learn the visit state.
    expect(record.state).toMatchObject({
      bounty_id: '42',
      maintainer,
      contributor,
      amount: '500',
      status: 'Expired',
      deadline: '1700000000',
    });
    // The worker persists records with JSON.stringify, which rejects BigInt.
    expect(() => JSON.stringify(record)).not.toThrow();
  });
});
