import express from 'express';
import dotenv from 'dotenv';
import createRoutes from './routes/create/createRoutes.js';
import biocbotRoutes from './routes/biocbot/biocbotRoutes.js';

// Load environment variables from .env file
dotenv.config();

const app = express();
const PORT = process.env.PORT || 7736;

// Middleware to parse JSON bodies
app.use(express.json());

// Mount the routers for each application
app.use('/api/create', createRoutes);
app.use('/api/biocbot', biocbotRoutes);

// Optional: A root route to confirm the server is up, if desired
app.get('/', (req, res) => {
  res.send('TLEF Web Server is running. Use /api/create or /api/biocbot for app-specific routes.');
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`CREATE app API available at http://localhost:${PORT}/api/create`);
  console.log(`BIOCBOT app API available at http://localhost:${PORT}/api/biocbot`);
});