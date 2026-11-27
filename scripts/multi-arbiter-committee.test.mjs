import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #727: Add multi-arbiter committee voting (2-of-3) for disputes
// Acceptance criteria:
// 1. Introduce an ArbiterCommittee storage type holding up to three arbiter addresses
// 2. Add a vote_resolve_dispute(bounty_id, decision) function requiring require_auth from a committee member
// 3. Tally votes per bounty and only execute the transfer once 2 of 3 matching votes are recorded
// 4. Add admin functions to configure the committee membership
// 5. Emit a DisputeVoteCast event per vote and a DisputeResolved event once quorum is reached
// 6. A single committee vote does not release funds
// 7. Two matching votes from distinct committee members triggers resolution
// 8. Two conflicting votes followed by a third tie-breaking vote resolves correctly to the majority decision

test('ISSUE-727: contracts/src/lib.rs implements ArbiterCommittee and dispute resolution voting types', () => {
  const contractPath = join(process.cwd(), 'contracts', 'src', 'lib.rs');
  assert.ok(existsSync(contractPath), 'contracts/src/lib.rs must exist');

  const content = readFileSync(contractPath, 'utf8');

  // Types & DataKeys
  assert.match(
    content,
    /pub struct ArbiterCommittee\s*\{[\s\S]*pub members:\s*Vec<Address>/,
    'Must define ArbiterCommittee with members'
  );
  assert.match(
    content,
    /pub struct DisputeVote\s*\{[\s\S]*pub arbiter:\s*Address[\s\S]*pub decision:\s*bool/,
    'Must define DisputeVote'
  );
  assert.match(
    content,
    /pub struct DisputeVoteCast\s*\{[\s\S]*pub bounty_id:\s*u64[\s\S]*pub arbiter:\s*Address[\s\S]*pub decision:\s*bool/,
    'Must define DisputeVoteCast event'
  );
  assert.match(
    content,
    /pub struct DisputeResolved\s*\{[\s\S]*pub bounty_id:\s*u64[\s\S]*pub decision:\s*bool/,
    'Must define DisputeResolved event'
  );
  assert.match(content, /ArbiterCommittee,/, 'DataKey must include ArbiterCommittee');
  assert.match(content, /DisputeVotes\(u64\),/, 'DataKey must include DisputeVotes');

  // Contract Methods
  assert.match(
    content,
    /pub fn set_arbiter_committee\(/,
    'Must expose set_arbiter_committee admin function'
  );
  assert.match(
    content,
    /pub fn get_arbiter_committee\(/,
    'Must expose get_arbiter_committee query function'
  );
  assert.match(
    content,
    /pub fn get_dispute_votes\(/,
    'Must expose get_dispute_votes query function'
  );
  assert.match(
    content,
    /pub fn vote_resolve_dispute\(/,
    'Must expose vote_resolve_dispute function'
  );

  // Logic checks
  assert.match(
    content,
    /panic_error\(\s*&env,\s*ContractError::CommitteeSizeExceeded\)/,
    'Must enforce max 3 committee members'
  );
  assert.match(
    content,
    /panic_error\(\s*&env,\s*ContractError::DuplicateCommitteeMember\)/,
    'Must reject duplicate committee addresses'
  );
  assert.match(
    content,
    /panic_error\(\s*&env,\s*ContractError::NotCommitteeMember\)/,
    'Must reject votes from non-committee members'
  );
  assert.match(
    content,
    /panic_error\(\s*&env,\s*ContractError::DuplicateCommitteeVote\)/,
    'Must reject duplicate votes from same arbiter'
  );
  assert.match(content, /release_votes >= 2/, 'Must check 2-of-3 quorum for release');
  assert.match(content, /refund_votes >= 2/, 'Must check 2-of-3 quorum for refund');
});

test('ISSUE-727: contracts/tests/arbiter_committee.rs contains comprehensive integration test coverage', () => {
  const testPath = join(process.cwd(), 'contracts', 'tests', 'arbiter_committee.rs');
  assert.ok(existsSync(testPath), 'contracts/tests/arbiter_committee.rs must exist');

  const content = readFileSync(testPath, 'utf8');

  assert.match(
    content,
    /test_single_vote_does_not_release_funds/,
    'Must test single vote does not release'
  );
  assert.match(
    content,
    /test_two_matching_votes_release_funds_to_contributor/,
    'Must test two matching votes release'
  );
  assert.match(
    content,
    /test_two_matching_votes_refund_to_maintainer/,
    'Must test two matching votes refund'
  );
  assert.match(
    content,
    /test_conflicting_votes_with_tie_breaker_resolves_to_majority/,
    'Must test tie-breaker resolution'
  );
  assert.match(content, /test_duplicate_vote_rejected/, 'Must test duplicate vote rejected');
  assert.match(
    content,
    /test_non_committee_member_cannot_vote/,
    'Must test non-member cannot vote'
  );
});

test('ISSUE-727: Pure logic simulation of 2-of-3 committee voting resolution algorithm', () => {
  class MockDisputeCommittee {
    constructor(members) {
      if (members.length > 3) throw new Error('CommitteeSizeExceeded');
      if (new Set(members).size !== members.length) throw new Error('DuplicateCommitteeMember');
      this.members = members;
      this.votes = new Map(); // bountyId -> Map(arbiter -> decision)
      this.status = new Map(); // bountyId -> status
    }

    voteResolveDispute(bountyId, arbiter, decision) {
      if (!this.members.includes(arbiter)) throw new Error('NotCommitteeMember');

      if (!this.votes.has(bountyId)) {
        this.votes.set(bountyId, new Map());
        this.status.set(bountyId, 'Disputed');
      }

      const bountyVotes = this.votes.get(bountyId);
      if (bountyVotes.has(arbiter)) throw new Error('DuplicateCommitteeVote');

      bountyVotes.set(arbiter, decision);

      let releaseCount = 0;
      let refundCount = 0;
      for (const val of bountyVotes.values()) {
        if (val) releaseCount++;
        else refundCount++;
      }

      if (releaseCount >= 2) {
        this.status.set(bountyId, 'Released');
        return true;
      } else if (refundCount >= 2) {
        this.status.set(bountyId, 'Refunded');
        return true;
      }
      return false;
    }
  }

  const committee = new MockDisputeCommittee(['arbiter1', 'arbiter2', 'arbiter3']);

  // Case 1: 1 vote does not resolve
  assert.equal(committee.voteResolveDispute(1, 'arbiter1', true), false);
  assert.equal(committee.status.get(1), 'Disputed');

  // Case 2: 2 matching votes resolve
  assert.equal(committee.voteResolveDispute(1, 'arbiter2', true), true);
  assert.equal(committee.status.get(1), 'Released');

  // Case 3: Conflicting votes + tie-breaker
  assert.equal(committee.voteResolveDispute(2, 'arbiter1', true), false);
  assert.equal(committee.voteResolveDispute(2, 'arbiter2', false), false);
  assert.equal(committee.status.get(2), 'Disputed');
  assert.equal(committee.voteResolveDispute(2, 'arbiter3', false), true);
  assert.equal(committee.status.get(2), 'Refunded');

  // Case 4: Duplicate vote fails
  assert.throws(() => committee.voteResolveDispute(2, 'arbiter3', false), /DuplicateCommitteeVote/);

  // Case 5: Non-member fails
  assert.throws(() => committee.voteResolveDispute(2, 'intruder', true), /NotCommitteeMember/);
});
