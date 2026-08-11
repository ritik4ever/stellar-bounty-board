const { extendDeadline } = require('../../src/controllers/bountyController');
const Bounty = require('../../src/models/Bounty');
const EventLog = require('../../src/models/EventLog');
const { validateDeadlineExtension } = require('../../src/utils/validation');

// Mock dependencies
jest.mock('../../src/models/Bounty');
jest.mock('../../src/models/EventLog');
jest.mock('../../src/utils/validation');

describe('extendDeadline', () => {
  let req, res;

  beforeEach(() => {
    req = {
      params: { id: 'bounty123' },
      body: {
        maintainer: 'GB...',
        newDeadline: '2025-12-31T23:59:59Z'
      }
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    jest.clearAllMocks();
  });

  it('should extend deadline successfully', async () => {
    const mockBounty = {
      _id: 'bounty123',
      deadlineAt: new Date('2024-01-01'),
      save: jest.fn()
    };
    Bounty.findById.mockResolvedValue(mockBounty);
    validateDeadlineExtension.mockReturnValue(null);
    EventLog.prototype.save = jest.fn().mockResolvedValue();

    await extendDeadline(req, res);

    expect(Bounty.findById).toHaveBeenCalledWith('bounty123');
    expect(mockBounty.deadlineAt).toEqual(new Date('2025-12-31T23:59:59Z'));
    expect(mockBounty.save).toHaveBeenCalled();
    expect(EventLog).toHaveBeenCalledWith({
      bountyId: 'bounty123',
      type: 'deadline_extended',
      data: expect.objectContaining({
        maintainer: 'GB...',
        newDeadline: new Date('2025-12-31T23:59:59Z')
      })
    });
    expect(res.json).toHaveBeenCalledWith({
      message: 'Deadline extended successfully',
      bounty: {
        id: 'bounty123',
        deadlineAt: new Date('2025-12-31T23:59:59Z')
      }
    });
  });

  it('should return 404 if bounty not found', async () => {
    Bounty.findById.mockResolvedValue(null);

    await extendDeadline(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Bounty not found' });
  });

  it('should return 400 if validation fails', async () => {
    const mockBounty = {
      _id: 'bounty123',
      deadlineAt: new Date('2024-01-01'),
      save: jest.fn()
    };
    Bounty.findById.mockResolvedValue(mockBounty);
    validateDeadlineExtension.mockReturnValue('New deadline must be in the future');

    await extendDeadline(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'New deadline must be in the future' });
  });

  it('should return 400 if maintainer or newDeadline missing', async () => {
    req.body = {};

    await extendDeadline(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'maintainer and newDeadline are required' });
  });
});
