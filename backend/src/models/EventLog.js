const mongoose = require('mongoose');

const eventLogSchema = new mongoose.Schema({
  bountyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bounty',
    required: true
  },
  type: {
    type: String,
    required: true,
    enum: ['created', 'updated', 'deleted', 'deadline_extended', 'claimed', 'completed']
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('EventLog', eventLogSchema);
