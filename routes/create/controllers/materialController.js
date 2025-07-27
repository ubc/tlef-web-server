import express from 'express';
import Material from '../models/Material.js';
import Folder from '../models/Folder.js';
import FileService from '../services/fileService.js';
import { authenticateToken, attachUser } from '../middleware/auth.js';
import { validateCreateMaterial } from '../middleware/validator.js';
import { successResponse, errorResponse, notFoundResponse } from '../utils/responseFormatter.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS, MATERIAL_TYPES, PROCESSING_STATUS } from '../config/constants.js';

const router = express.Router();

// Configure multer for file uploads
const upload = FileService.configureUpload();

/**
 * POST /api/materials/upload
 * Upload files (PDF, DOCX)
 */
router.post('/upload', authenticateToken, upload.array('files', 10), asyncHandler(async (req, res) => {
  const { folderId, names } = req.body;
  const files = req.files;
  const userId = req.user.id;

  if (!files || files.length === 0) {
    return errorResponse(res, 'No files uploaded', 'NO_FILES', HTTP_STATUS.BAD_REQUEST);
  }

  if (!folderId) {
    return errorResponse(res, 'Folder ID is required', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
  }

  // Verify folder exists and user owns it
  const folder = await Folder.findOne({ _id: folderId, instructor: userId });
  if (!folder) {
    return notFoundResponse(res, 'Folder');
  }

  const materials = [];
  const errors = [];

  // Process each uploaded file
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      // Use custom name if provided
      const customNames = Array.isArray(names) ? names : (names ? [names] : []);
      const customName = customNames[i];

      const fileData = await FileService.processUploadedFile(file, {
        name: customName,
        folder: folderId,
        uploadedBy: userId
      });

      // Check for duplicate files
      const existingMaterial = await Material.findOne({ 
        checksum: fileData.checksum, 
        folder: folderId 
      });

      if (existingMaterial) {
        await FileService.deleteFile(file.path);
        errors.push({
          filename: file.originalname,
          error: 'File already exists in this folder'
        });
        continue;
      }

      const material = new Material(fileData);
      await material.save();

      // Add to folder
      await folder.addMaterial(material._id);

      materials.push(material);
    } catch (error) {
      errors.push({
        filename: file.originalname,
        error: error.message
      });
    }
  }

  const response = {
    materials,
    summary: {
      total: files.length,
      successful: materials.length,
      failed: errors.length
    }
  };

  if (errors.length > 0) {
    response.errors = errors;
  }

  const statusCode = materials.length > 0 ? HTTP_STATUS.CREATED : HTTP_STATUS.BAD_REQUEST;
  const message = materials.length > 0 ? 
    `${materials.length} materials uploaded successfully` : 
    'No materials were uploaded';

  return successResponse(res, response, message, statusCode);
}));

/**
 * POST /api/materials/url
 * Add URL material
 */
router.post('/url', authenticateToken, asyncHandler(async (req, res) => {
  const { name, url, folderId } = req.body;
  const userId = req.user.id;

  // Validate required fields
  if (!name || !url || !folderId) {
    return errorResponse(res, 'Name, URL, and folder ID are required', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
  }

  // Validate URL
  const urlValidation = FileService.validateUrl(url);
  if (!urlValidation.isValid) {
    return errorResponse(res, urlValidation.error, 'INVALID_URL', HTTP_STATUS.BAD_REQUEST);
  }

  // Verify folder exists and user owns it
  const folder = await Folder.findOne({ _id: folderId, instructor: userId });
  if (!folder) {
    return notFoundResponse(res, 'Folder');
  }

  // Check for duplicate URL in folder
  const existingMaterial = await Material.findOne({ 
    url: urlValidation.normalizedUrl, 
    folder: folderId 
  });

  if (existingMaterial) {
    return errorResponse(res, 'URL already exists in this folder', 'DUPLICATE_URL', HTTP_STATUS.CONFLICT);
  }

  const material = new Material({
    name: name.trim(),
    type: MATERIAL_TYPES.URL,
    url: urlValidation.normalizedUrl,
    folder: folderId,
    uploadedBy: userId,
    processingStatus: PROCESSING_STATUS.PENDING
  });

  await material.save();
  await folder.addMaterial(material._id);

  return successResponse(res, { material }, 'URL material created successfully', HTTP_STATUS.CREATED);
}));

/**
 * POST /api/materials/text
 * Add text material
 */
router.post('/text', authenticateToken, asyncHandler(async (req, res) => {
  const { name, content, folderId } = req.body;
  const userId = req.user.id;

  // Validate required fields
  if (!name || !content || !folderId) {
    return errorResponse(res, 'Name, content, and folder ID are required', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
  }

  // Verify folder exists and user owns it
  const folder = await Folder.findOne({ _id: folderId, instructor: userId });
  if (!folder) {
    return notFoundResponse(res, 'Folder');
  }

  // Generate checksum for text content
  const crypto = await import('crypto');
  const checksum = crypto.createHash('md5').update(content).digest('hex');

  // Check for duplicate content in folder
  const existingMaterial = await Material.findOne({ 
    checksum, 
    folder: folderId 
  });

  if (existingMaterial) {
    return errorResponse(res, 'Text content already exists in this folder', 'DUPLICATE_CONTENT', HTTP_STATUS.CONFLICT);
  }

  const material = new Material({
    name: name.trim(),
    type: MATERIAL_TYPES.TEXT,
    content: content.trim(),
    folder: folderId,
    uploadedBy: userId,
    fileSize: Buffer.byteLength(content, 'utf8'),
    checksum,
    processingStatus: PROCESSING_STATUS.COMPLETED // Text is immediately available
  });

  await material.save();
  await folder.addMaterial(material._id);

  return successResponse(res, { material }, 'Text material created successfully', HTTP_STATUS.CREATED);
}));

/**
 * GET /api/materials/folder/:folderId
 * Get folder's materials
 */
router.get('/folder/:folderId', authenticateToken, asyncHandler(async (req, res) => {
  const folderId = req.params.folderId;
  const userId = req.user.id;

  // Verify folder exists and user owns it
  const folder = await Folder.findOne({ _id: folderId, instructor: userId });
  if (!folder) {
    return notFoundResponse(res, 'Folder');
  }

  const materials = await Material.find({ folder: folderId })
    .populate('uploadedBy', 'cwlId')
    .sort({ createdAt: -1 });

  return successResponse(res, { materials }, 'Materials retrieved successfully');
}));

/**
 * DELETE /api/materials/:id
 * Delete material
 */
router.delete('/:id', authenticateToken, asyncHandler(async (req, res) => {
  const materialId = req.params.id;
  const userId = req.user.id;

  const material = await Material.findOne({ _id: materialId, uploadedBy: userId });
  if (!material) {
    return notFoundResponse(res, 'Material');
  }

  // Delete file if it exists
  if (material.filePath) {
    await FileService.deleteFile(material.filePath);
  }

  // Remove from folder
  const folder = await Folder.findById(material.folder);
  if (folder) {
    await folder.removeMaterial(materialId);
  }

  // Delete material
  await Material.findByIdAndDelete(materialId);

  return successResponse(res, null, 'Material deleted successfully');
}));

/**
 * GET /api/materials/:id/status
 * Get processing status
 */
router.get('/:id/status', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const materialId = req.params.id;
  const userId = req.user.id;

  const material = await Material.findOne({ _id: materialId, uploadedBy: userId })
    .select('name processingStatus processingError createdAt updatedAt');

  if (!material) {
    return notFoundResponse(res, 'Material');
  }

  return successResponse(res, { 
    material: {
      id: material._id,
      name: material.name,
      processingStatus: material.processingStatus,
      processingError: material.processingError,
      createdAt: material.createdAt,
      updatedAt: material.updatedAt
    }
  }, 'Processing status retrieved');
}));

/**
 * PUT /api/materials/:id
 * Update material (name only)
 */
router.put('/:id', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const materialId = req.params.id;
  const userId = req.user.id;
  const { name } = req.body;

  if (!name || name.trim().length === 0) {
    return errorResponse(res, 'Name is required', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
  }

  const material = await Material.findOne({ _id: materialId, uploadedBy: userId });
  if (!material) {
    return notFoundResponse(res, 'Material');
  }

  material.name = name.trim();
  await material.save();

  return successResponse(res, { material }, 'Material updated successfully');
}));

/**
 * POST /api/materials/:id/reprocess
 * Trigger reprocessing of material
 */
router.post('/:id/reprocess', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const materialId = req.params.id;
  const userId = req.user.id;

  const material = await Material.findOne({ _id: materialId, uploadedBy: userId });
  if (!material) {
    return notFoundResponse(res, 'Material');
  }

  // Reset processing status
  await material.updateProcessingStatus(PROCESSING_STATUS.PENDING);

  // Here you would trigger the actual processing job
  // This could be a queue job, webhook, etc.

  return successResponse(res, { material }, 'Material reprocessing triggered');
}));

export default router;