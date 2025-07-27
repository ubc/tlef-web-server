import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import createRoutes from './routes/create/createRoutes.js';
import biocbotRoutes from './routes/biocbot/biocbotRoutes.js';

// Load environment variables from .env file
dotenv.config();

const app = express();
const PORT = process.env.PORT || 7736;

// CORS configuration for frontend integration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.FRONTEND_URL 
    : ['http://localhost:3000', 'http://localhost:8080'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

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