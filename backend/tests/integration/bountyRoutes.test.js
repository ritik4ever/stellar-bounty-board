const request = require('supertest');
const app = require('../../src/app');
const Bounty = require('../../src/models/Bounty');
const EventLog = require('../../src/models/EventLog');

// Mock dependencies
jest.mock('../../src/models/Bounty');
jest.mock('../../src/models/EventLog');
jest.mock('../../src/middleware/auth', () => ({
  verifyStellarSignature: (req, res, next) => {
    req.user = { publicKey: 'GB...' };
    next();
  }
}));

describe('POST /api/bounties/:id/extend-deadline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should extend deadline successfully', async () => {
    const mockBounty = {
      _id: 'bounty123',
      deadlineAt: new Date('2024-01-01'),
      save: jest.fn().mockResolvedValue()
    };
    Bounty.findById.mockResolvedValue(mockBounty);
    EventLog.prototype.save = jest.fn().mockResolvedValue();

    const response = await request(app)
      .post('/api/bounties/bounty123/extend-deadline')
      .send({
        maintainer: 'GB...',
        newDeadline: '2025-12-31T23:59:59Z'
      })
      .set('x-stellar-signature', 'valid-signature')
      .set('x-stellar-public-key', 'GB...');

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Deadline extended successfully');
    expect(response.body.bounty.deadlineAt).toBeDefined();
  });

  it('should return 404 for non-existent bounty', async () => {
    Bounty.findById.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/bounties/nonexistent/extend-deadline')
      .send({
        maintainer: 'GB...',
        newDeadline: '2025-12-31T23:59:59Z'
      })
      .set('x-stellar-signature', 'valid-signature')
      .set('x-stellar-public-key', 'GB...');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Bounty not found');
  });

  it('should return 400 for invalid deadline', async () => {
    const mockBounty = {
      _id: 'bounty123',
      deadlineAt: new Date('2025-12-31'),
      save: jest.fn()
    };
    Bounty.findById.mockResolvedValue(mockBounty);

    const response = await request(app)
      .post('/api/bounties/bounty123/extend-deadline')
      .send({
        maintainer: 'GB...',
        newDeadline: '2020-01-01' // Past date
      })
      .set('x-stellar-signature', 'valid-signature')
      .set('x-stellar-public-key', 'GB...');

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it('should return 401 without auth headers', async () => {
    const response = await request(app)
      .post('/api/bounties/bounty123/extend-deadline')
      .send({
        maintainer: 'GB...',
        newDeadline: '2025-12-31T23:59:59Z'
      });

    expect(response.status).toBe(401);
  });
});
