import express, { Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import prisma from '../lib/db';
import { saveImage } from '../lib/storage';

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({ storage });

router.post('/', upload.fields([
  { name: 'solution', maxCount: 1 },
  { name: 'samples', maxCount: 5 },
]), async (req: Request, res: Response) => {
  try {
    const { title, description, totalPoints } = req.body;
    const assignmentId = uuidv4();

    // Validate required fields
    if (!title || !description || !totalPoints) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }
    const totalPointsInt = parseInt(totalPoints, 10);
    if (isNaN(totalPointsInt) || totalPointsInt <= 0) {
      return res.status(400).json({ error: 'totalPoints must be a positive integer.' });
    }

    // Validate and save solution image
    const files = req.files as Record<string, Express.Multer.File[]>;
    const solutionFile = files?.['solution']?.[0];
    if (!solutionFile) {
      return res.status(400).json({ error: 'Solution image is required.' });
    }
    if (solutionFile.mimetype !== 'image/png') {
      return res.status(400).json({ error: 'Solution image must be a PNG.' });
    }
    const solutionSave = await saveImage(solutionFile.buffer, 'png', assignmentId);

    // Save sample images if present
    const samples = files?.['samples'] || [];
    const samplePaths: string[] = [];
    for (const sample of samples) {
      if (sample.mimetype === 'image/png') {
        const saved = await saveImage(sample.buffer, 'png', assignmentId);
        samplePaths.push(saved.fullPath);
      }
    }
    const samplesDir = path.join('uploads', assignmentId);

    // Debug info
    console.info('Saved solution:', solutionSave.fullPath);
    console.info('Saved samples:', samplePaths);

    // Create Assignment row
    const assignment = await prisma.assignment.create({
      data: {
        id: assignmentId,
        title,
        description,
        totalPoints: totalPointsInt,
        solutionFile: solutionSave.filename,
        samplesDir,
      },
    });
    console.info('Prisma payload:', assignment);
    return res.status(201).json({ assignment });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router; 