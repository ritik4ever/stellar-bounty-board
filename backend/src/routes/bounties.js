const express = require('express');
const router = express.Router();
const bountyController = require('../controllers/bountyController');
const authMiddleware = require('../middleware/auth');

// Existing routes
router.get('/', bountyController.getAllBounties);
router.get('/:id', bountyController.getBountyById);
router.post('/', authMiddleware.verifyStellarSignature, bountyController.createBounty);
router.put('/:id', authMiddleware.verifyStellarSignature, bountyController.updateBounty);
router.delete('/:id', authMiddleware.verifyStellarSignature, bountyController.deleteBounty);

// New extend deadline route
router.post('/:id/extend-deadline', authMiddleware.verifyStellarSignature, bountyController.extendDeadline);

module.exports = router;
