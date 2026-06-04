const Bounty = require('../models/Bounty');
const EventLog = require('../models/EventLog');
const { validateDeadlineExtension } = require('../utils/validation');

// Existing controller methods...

exports.extendDeadline = async (req, res) => {
  try {
    const { id } = req.params;
    const { maintainer, newDeadline } = req.body;

    // Validate input
    if (!maintainer || !newDeadline) {
      return res.status(400).json({ error: 'maintainer and newDeadline are required' });
    }

    const bounty = await Bounty.findById(id);
    if (!bounty) {
      return res.status(404).json({ error: 'Bounty not found' });
    }

    // Validate the new deadline
    const validationError = validateDeadlineExtension(bounty.deadlineAt, newDeadline);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    // Update the bounty deadline
    bounty.deadlineAt = new Date(newDeadline);
    await bounty.save();

    // Record the event
    const event = new EventLog({
      bountyId: id,
      type: 'deadline_extended',
      data: {
        maintainer,
        previousDeadline: bounty.deadlineAt,
        newDeadline: new Date(newDeadline),
        timestamp: new Date()
      }
    });
    await event.save();

    res.json({
      message: 'Deadline extended successfully',
      bounty: {
        id: bounty._id,
        deadlineAt: bounty.deadlineAt
      }
    });
  } catch (error) {
    console.error('Error extending deadline:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
