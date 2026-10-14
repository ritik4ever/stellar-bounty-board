import { Request, Response } from 'express';
import { updateBountyMetadata } from '../services/bountyStore';
import { sendError } from '../app';

export const updateBountyMetadataHandler = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { maintainer, newTitle } = req.body;

    if (!maintainer || !newTitle) {
      res.status(400).json({ error: 'Maintainer address and newTitle are required.' });
      return;
    }

    const updatedBounty = await updateBountyMetadata(id, maintainer, newTitle);
    res.json({ data: updatedBounty });
  } catch (error) {
    sendError(res, req, error);
  }
};
