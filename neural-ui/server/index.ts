import express from 'express';
import cors from 'cors';
import prisma from './db.js';
import { dealsRouter } from './routes/deals.js';
import { trainingRouter } from './routes/training.js';
import { modelRouter } from './routes/model.js';
import { dashboardRouter } from './routes/dashboard.js';

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/dashboard', dashboardRouter);
app.use('/api/deals', dealsRouter);
app.use('/api/training', trainingRouter);
app.use('/api/model', modelRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Neural UI API server running at http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
