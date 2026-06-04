// Existing validation utilities...

/**
 * Validates a deadline extension request
 * @param {Date|string} currentDeadline - The current deadline
 * @param {Date|string} newDeadline - The proposed new deadline
 * @returns {string|null} Error message if invalid, null if valid
 */
exports.validateDeadlineExtension = (currentDeadline, newDeadline) => {
  const current = new Date(currentDeadline);
  const proposed = new Date(newDeadline);

  if (isNaN(proposed.getTime())) {
    return 'Invalid newDeadline format';
  }

  if (proposed <= new Date()) {
    return 'New deadline must be in the future';
  }

  if (proposed <= current) {
    return 'New deadline must be later than the current deadline';
  }

  return null;
};
