import { OpenAI } from 'openai';
import fs from 'fs';
import path from 'path';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function imageToBase64(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return data.toString('base64');
}

export async function gradeSubmission(submission: any, rubric: any, solutionPath: string) {
  if (!submission.assignmentId || typeof submission.assignmentId !== 'string') {
    throw new Error('submission.assignmentId is required and must be a string');
  }
  if (!submission.imageFile || typeof submission.imageFile !== 'string') {
    throw new Error('submission.imageFile is required and must be a string');
  }
  if (!solutionPath || typeof solutionPath !== 'string') {
    throw new Error('solutionPath is required and must be a string');
  }
  // Build prompt
  const criteria = Array.isArray(rubric.criteria) ? rubric.criteria : [];
  const prompt = [
    'You are an expert grader. Grade the student submission image using the provided solution image and rubric criteria.',
    'For each criterion, provide the earned points and a brief comment.',
    'Rubric criteria:',
    ...criteria.map((c: any) => `- id: ${c.id}, description: ${c.description}, maxPoints: ${c.maxPoints}`),
    'Respond ONLY in the following JSON format:',
    '{ "criterionScores":[{"id":"...", "earned":#, "comment":""}], "total":#, "overall":"" }',
    'Do not include any extra text.'
  ].join('\n');

  // Prepare images as base64
  const submissionImagePath = submission.imageFilePath || path.join('uploads', submission.assignmentId, submission.imageFile);
  if (typeof submissionImagePath !== 'string') {
    throw new Error('submissionImagePath must be a string');
  }
  if (typeof solutionPath !== 'string') {
    throw new Error('solutionPath must be a string');
  }
  const submissionImageBase64 = imageToBase64(submissionImagePath);
  const solutionImageBase64 = imageToBase64(solutionPath);

  // Call GPT-4o Vision with images as base64
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: [
        { type: 'text', text: 'Submission image:' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${submissionImageBase64}` } },
        { type: 'text', text: 'Solution image:' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${solutionImageBase64}` } }
      ] }
    ],
    max_tokens: 512,
    response_format: { type: 'json_object' }
  });

  // Parse and validate response
  const content = response.choices[0].message.content;
  if (typeof content !== 'string') {
    throw new Error('GPT response content is missing or not a string');
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error('Failed to parse GPT response as JSON');
  }
  // Cross-check criterion IDs
  const rubricIds = new Set(criteria.map((c: any) => c.id));
  for (const score of parsed.criterionScores) {
    if (!rubricIds.has(score.id)) {
      throw new Error(`Invalid criterion id in GPT response: ${score.id}`);
    }
  }
  return parsed;
} 