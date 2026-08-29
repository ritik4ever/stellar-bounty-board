import { Router, type Request, type Response } from 'express';

import {
  getNotificationPreferences,
  normalizeNotificationPreferencesInput,
  setNotificationPreferences,
} from '../services/notificationPreferences';

const router = Router();

router.get('/:address/notification-preferences', (req: Request, res: Response) => {
  try {
    const address = req.params.address?.trim();
    if (!address) {
      res.status(400).json({ error: 'Address is required.' });
      return;
    }

    res.json({ data: getNotificationPreferences(address) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    res.status(400).json({ error: message });
  }
});

router.put('/:address/notification-preferences', (req: Request, res: Response) => {
  try {
    const address = req.params.address?.trim();
    if (!address) {
      res.status(400).json({ error: 'Address is required.' });
      return;
    }

    const normalized = normalizeNotificationPreferencesInput(req.body);
    const preferences = setNotificationPreferences(address, normalized);
    res.json({ data: preferences });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    res.status(400).json({ error: message });
  }
});

export default router;
