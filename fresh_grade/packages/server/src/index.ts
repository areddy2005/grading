import express, { Request, Response } from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import assignmentsRouter from './routes/assignments';

// Load environment variables
dotenv.config();

const app = express();

app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use('/api/assignments', assignmentsRouter);

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
}); 