// Application constants for TLEF-CREATE
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
};

export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTH_ERROR: 'AUTH_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  DUPLICATE_RESOURCE: 'DUPLICATE_RESOURCE',
  FILE_UPLOAD_ERROR: 'FILE_UPLOAD_ERROR',
  AI_SERVICE_ERROR: 'AI_SERVICE_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR'
};

export const MATERIAL_TYPES = {
  PDF: 'pdf',
  DOCX: 'docx',
  URL: 'url',
  TEXT: 'text'
};

export const PROCESSING_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

export const QUESTION_TYPES = {
  MULTIPLE_CHOICE: 'multiple-choice',
  TRUE_FALSE: 'true-false',
  FLASHCARD: 'flashcard',
  SUMMARY: 'summary',
  DISCUSSION: 'discussion',
  MATCHING: 'matching',
  ORDERING: 'ordering',
  CLOZE: 'cloze'
};

export const DIFFICULTY_LEVELS = {
  EASY: 'easy',
  MODERATE: 'moderate',
  HARD: 'hard'
};

export const PEDAGOGICAL_APPROACHES = {
  SUPPORT: 'support',
  ASSESS: 'assess',
  GAMIFY: 'gamify',
  CUSTOM: 'custom'
};

export const QUIZ_STATUS = {
  DRAFT: 'draft',
  MATERIALS_ASSIGNED: 'materials-assigned',
  OBJECTIVES_SET: 'objectives-set',
  PLAN_GENERATED: 'plan-generated',
  PLAN_APPROVED: 'plan-approved',
  GENERATING: 'generating',
  GENERATED: 'generated',
  REVIEWING: 'reviewing',
  COMPLETED: 'completed'
};

export const REVIEW_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  NEEDS_REVIEW: 'needs-review',
  REJECTED: 'rejected'
};

export const PLAN_STATUS = {
  DRAFT: 'draft',
  APPROVED: 'approved',
  MODIFIED: 'modified',
  USED: 'used'
};

export const JWT_CONFIG = {
  ACCESS_TOKEN_EXPIRY: '15m',
  REFRESH_TOKEN_EXPIRY: '7d',
  SECRET: process.env.JWT_SECRET || 'tlef-create-secret-key-2024'
};

export const FILE_CONFIG = {
  MAX_FILE_SIZE: 100 * 1024 * 1024, // 100MB
  ALLOWED_MIME_TYPES: {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/msword': 'doc',
    'text/plain': 'txt'
  },
  UPLOAD_PATH: './routes/create/uploads/'
};

export const RATE_LIMITS = {
  AUTH: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5 // limit each IP to 5 requests per windowMs
  },
  API: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
  },
  UPLOAD: {
    windowMs: 60 * 1000, // 1 minute
    max: 10 // limit each IP to 10 uploads per minute
  }
};

export const QDRANT_CONFIG = {
  URL: process.env.QDRANT_URL || 'http://localhost:6333',
  API_KEY: process.env.QDRANT_API_KEY || 'tlef-qdrant-2024',
  COLLECTION_NAME: 'course-materials',
  VECTOR_SIZE: 384, // sentence-transformers/all-MiniLM-L6-v2 dimension
  DISTANCE: 'Cosine'
};

export const AI_CONFIG = {
  LLM_MODEL: process.env.LLM_MODEL || 'llama3.1:8b',
  OLLAMA_ENDPOINT: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434',
  TEMPERATURE: 0.7,
  MAX_TOKENS: 2000,
  CHUNK_SIZE: 512,
  CHUNK_OVERLAP: 50,
  TOP_K: 5
};