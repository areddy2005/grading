import express, { Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import PQueue from 'p-queue';
import { gradeSubmission } from '../services/aiGrade';
import path from 'path';
import prisma from '../lib/db';
import { saveImage } from '../lib/storage';

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({ storage });

const aiGradeQueue = new PQueue({ concurrency: 2 });

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

router.post('/:id/bulk-ai-grade', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const { id: assignmentId } = req.params;
  try {
    // Fetch assignment, rubric, and ungraded submissions
    const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) {
      res.write(`event: error\ndata: {"error":"Assignment not found"}\n\n`);
      return res.end();
    }
    const rubric = await prisma.rubric.findFirst({ where: { assignmentId } });
    if (!rubric) {
      res.write(`event: error\ndata: {"error":"Rubric not found"}\n\n`);
      return res.end();
    }
    const ungraded = await prisma.submission.findMany({ where: { assignmentId, aiGraded: false } });
    if (!ungraded.length) {
      res.write(`event: done\ndata: {"message":"No ungraded submissions"}\n\n`);
      return res.end();
    }
    const solutionPath = path.join('uploads', assignment.id, assignment.solutionFile);
    const rubricCriteria = rubric.criteria;
    let completed = 0;
    await Promise.all(ungraded.map(submission => aiGradeQueue.add(async () => {
      try {
        const aiResult = await gradeSubmission(
          { ...submission, assignmentId: assignment.id },
          { criteria: rubricCriteria },
          solutionPath
        );
        const updated = await prisma.submission.update({
          where: { id: submission.id },
          data: {
            grade: aiResult.total,
            feedback: aiResult.overall,
            selectedRubricItems: aiResult.criterionScores,
            aiGraded: true,
          },
        });
        res.write(`event: progress\ndata: ${JSON.stringify({ id: updated.id, status: 'done', grade: updated.grade })}\n\n`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        res.write(`event: progress\ndata: ${JSON.stringify({ id: submission.id, status: 'error', error: errorMsg })}\n\n`);
      }
      completed++;
      if (completed === ungraded.length) {
        res.write('event: done\ndata: {}\n\n');
        res.end();
      }
    })));
  } catch (err: any) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    res.write(`event: error\ndata: {"error":"${errorMsg}"}\n\n`);
    res.end();
  }
});

export default router; 