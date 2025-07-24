import express, { Request, Response } from 'express';
import multer from 'multer';
import prisma from '../lib/db';
import { saveImage } from '../lib/storage';
import { gradeSubmission } from '../services/aiGrade';
import path from 'path';

const router = express.Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage() });

router.post('/', upload.single('submission'), async (req: Request, res: Response) => {
  try {
    const { id: assignmentId } = req.params;
    const { studentName, studentEmail } = req.body;
    const file = req.file;

    // Validation
    if (!studentName || !studentEmail) {
      return res.status(400).json({ error: 'studentName and studentEmail are required.' });
    }
    if (!file) {
      return res.status(400).json({ error: 'Submission image is required.' });
    }
    if (file.mimetype !== 'image/png') {
      return res.status(400).json({ error: 'Submission must be a PNG image.' });
    }

    // Check assignment exists
    const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found.' });
    }

    // Save image
    const saved = await saveImage(file.buffer, 'png', assignmentId);

    // Create submission
    const submission = await prisma.submission.create({
      data: {
        assignmentId,
        studentName,
        studentEmail,
        imageFile: saved.filename,
        aiGraded: false,
        grade: null,
        feedback: null,
        selectedRubricItems: {},
      },
    });

    return res.status(201).json({ submission });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

router.post('/:id/ai-grade', async (req, res) => {
  try {
    const { id } = req.params;
    // Fetch submission
    const submission = await prisma.submission.findUnique({ where: { id } });
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found.' });
    }
    if (submission.aiGraded) {
      return res.status(400).json({ error: 'Submission already graded.' });
    }
    // Fetch assignment and rubric
    const assignment = await prisma.assignment.findUnique({ where: { id: submission.assignmentId } });
    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found.' });
    }
    const rubric = await prisma.rubric.findFirst({ where: { assignmentId: assignment.id } });
    if (!rubric) {
      return res.status(404).json({ error: 'Rubric not found.' });
    }
    // Call gradeSubmission
    const solutionPath = path.join('uploads', assignment.id, assignment.solutionFile);
    const rubricCriteria = rubric.criteria;
    const aiResult = await gradeSubmission(
      { ...submission, assignmentId: assignment.id },
      { criteria: rubricCriteria },
      solutionPath
    );
    // Warn if GPT total ≠ sum(earned)
    const sumEarned = aiResult.criterionScores.reduce((sum: number, c: any) => sum + c.earned, 0);
    if (aiResult.total !== sumEarned) {
      console.warn(`GPT total (${aiResult.total}) does not match sum of earned points (${sumEarned})`);
    }
    // Update submission
    const updated = await prisma.submission.update({
      where: { id },
      data: {
        grade: aiResult.total,
        feedback: aiResult.overall,
        selectedRubricItems: aiResult.criterionScores,
        aiGraded: true,
      },
    });
    return res.json({ submission: updated });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router; 