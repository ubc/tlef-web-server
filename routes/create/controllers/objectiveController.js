import express from 'express';
import LearningObjective from '../models/LearningObjective.js';
import Quiz from '../models/Quiz.js';
import Material from '../models/Material.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateCreateObjective, validateGenerateObjectives, validateClassifyObjectives, validateMongoId } from '../middleware/validator.js';
import { successResponse, errorResponse, notFoundResponse } from '../utils/responseFormatter.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS } from '../config/constants.js';

const router = express.Router();

/**
 * GET /api/objectives/quiz/:quizId
 * Get quiz objectives
 */
router.get('/quiz/:quizId', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const quizId = req.params.quizId;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  const objectives = await LearningObjective.find({ quiz: quizId })
    .populate('generatedFrom', 'name type')
    .populate('createdBy', 'cwlId')
    .sort({ order: 1 });

  return successResponse(res, { objectives }, 'Learning objectives retrieved successfully');
}));

/**
 * POST /api/objectives/generate
 * AI generate from materials
 */
router.post('/generate', authenticateToken, validateGenerateObjectives, asyncHandler(async (req, res) => {
  const { quizId, materialIds } = req.body;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  // Verify materials exist and are in the same folder
  const materials = await Material.find({ 
    _id: { $in: materialIds },
    folder: quiz.folder 
  });

  if (materials.length !== materialIds.length) {
    return errorResponse(
      res, 
      'Some materials not found or not in the same folder', 
      'INVALID_MATERIALS', 
      HTTP_STATUS.BAD_REQUEST
    );
  }

  // Check if materials are processed
  const unprocessedMaterials = materials.filter(m => m.processingStatus !== 'completed');
  if (unprocessedMaterials.length > 0) {
    return errorResponse(
      res, 
      'Some materials are not yet processed. Please wait for processing to complete.', 
      'MATERIALS_NOT_READY', 
      HTTP_STATUS.BAD_REQUEST
    );
  }

  try {
    // TODO: Implement AI generation service
    // This would call the UBC GenAI Toolkit to generate learning objectives
    // For now, we'll return a placeholder response
    
    // Simulate AI generation
    const generatedObjectives = [
      "Students will understand the fundamental concepts presented in the materials",
      "Students will be able to analyze key relationships between different topics",
      "Students will demonstrate critical thinking skills in problem-solving scenarios"
    ];

    const objectives = [];
    for (let i = 0; i < generatedObjectives.length; i++) {
      const objective = new LearningObjective({
        text: generatedObjectives[i],
        quiz: quizId,
        order: i,
        generatedFrom: materialIds,
        generationMetadata: {
          isAIGenerated: true,
          llmModel: 'llama3.1:8b',
          generationPrompt: 'Generate learning objectives from provided materials',
          confidence: 0.85,
          processingTime: 2500
        },
        createdBy: userId
      });

      await objective.save();
      objectives.push(objective);

      // Add to quiz
      await quiz.addLearningObjective(objective._id);
    }

    return successResponse(res, { 
      objectives,
      metadata: {
        generatedCount: objectives.length,
        materialsUsed: materials.length,
        generationModel: 'llama3.1:8b'
      }
    }, 'Learning objectives generated successfully', HTTP_STATUS.CREATED);

  } catch (error) {
    console.error('AI generation error:', error);
    return errorResponse(
      res, 
      'Failed to generate learning objectives', 
      'AI_GENERATION_ERROR', 
      HTTP_STATUS.SERVICE_UNAVAILABLE
    );
  }
}));

/**
 * POST /api/objectives/classify
 * AI classify user text into LOs
 */
router.post('/classify', authenticateToken, validateClassifyObjectives, asyncHandler(async (req, res) => {
  const { quizId, text } = req.body;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  try {
    // TODO: Implement AI classification service
    // This would call the UBC GenAI Toolkit to classify text into learning objectives
    // For now, we'll simulate the classification
    
    // Simple classification based on sentence splitting and filtering
    const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
    const classifiedObjectives = sentences
      .filter(sentence => 
        sentence.toLowerCase().includes('student') || 
        sentence.toLowerCase().includes('learn') ||
        sentence.toLowerCase().includes('understand') ||
        sentence.toLowerCase().includes('demonstrate')
      )
      .slice(0, 10) // Limit to 10 objectives
      .map(sentence => sentence.replace(/^(students?|learners?)\s+(will\s+)?(be\s+able\s+to\s+)?/i, '').trim());

    if (classifiedObjectives.length === 0) {
      return errorResponse(
        res, 
        'No learning objectives could be identified in the provided text', 
        'NO_OBJECTIVES_FOUND', 
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const objectives = [];
    for (let i = 0; i < classifiedObjectives.length; i++) {
      const objective = new LearningObjective({
        text: classifiedObjectives[i],
        quiz: quizId,
        order: i,
        generationMetadata: {
          isAIGenerated: true,
          llmModel: 'text-classification',
          generationPrompt: 'Classify text into learning objectives',
          confidence: 0.75,
          processingTime: 1200
        },
        createdBy: userId
      });

      await objective.save();
      objectives.push(objective);

      // Add to quiz
      await quiz.addLearningObjective(objective._id);
    }

    return successResponse(res, { 
      objectives,
      metadata: {
        originalText: text.substring(0, 200) + (text.length > 200 ? '...' : ''),
        classifiedCount: objectives.length,
        totalSentences: sentences.length
      }
    }, 'Text classified into learning objectives successfully', HTTP_STATUS.CREATED);

  } catch (error) {
    console.error('Classification error:', error);
    return errorResponse(
      res, 
      'Failed to classify text into learning objectives', 
      'AI_CLASSIFICATION_ERROR', 
      HTTP_STATUS.SERVICE_UNAVAILABLE
    );
  }
}));

/**
 * POST /api/objectives
 * Add single LO or save batch
 */
router.post('/', authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  // Handle batch creation
  if (Array.isArray(req.body)) {
    const objectivesData = req.body;
    const objectives = [];
    const errors = [];

    for (const objData of objectivesData) {
      try {
        if (!objData.text || !objData.quizId) {
          errors.push({ data: objData, error: 'Text and quizId are required' });
          continue;
        }

        // Verify quiz exists and user owns it
        const quiz = await Quiz.findOne({ _id: objData.quizId, createdBy: userId });
        if (!quiz) {
          errors.push({ data: objData, error: 'Quiz not found' });
          continue;
        }

        const objective = new LearningObjective({
          text: objData.text.trim(),
          quiz: objData.quizId,
          order: objData.order || objectives.length,
          createdBy: userId
        });

        await objective.save();
        await quiz.addLearningObjective(objective._id);
        objectives.push(objective);

      } catch (error) {
        errors.push({ data: objData, error: error.message });
      }
    }

    const response = {
      objectives,
      summary: {
        total: objectivesData.length,
        successful: objectives.length,
        failed: errors.length
      }
    };

    if (errors.length > 0) {
      response.errors = errors;
    }

    const statusCode = objectives.length > 0 ? HTTP_STATUS.CREATED : HTTP_STATUS.BAD_REQUEST;
    const message = objectives.length > 0 ? 
      `${objectives.length} learning objectives created successfully` : 
      'No learning objectives were created';

    return successResponse(res, response, message, statusCode);
  }

  // Handle single creation
  const { text, quizId, order } = req.body;

  if (!text || !quizId) {
    return errorResponse(res, 'Text and quizId are required', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
  }

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  const objective = new LearningObjective({
    text: text.trim(),
    quiz: quizId,
    order: order || 0,
    createdBy: userId
  });

  await objective.save();
  await quiz.addLearningObjective(objective._id);

  return successResponse(res, { objective }, 'Learning objective created successfully', HTTP_STATUS.CREATED);
}));

/**
 * PUT /api/objectives/:id
 * Update objective
 */
router.put('/:id', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const objectiveId = req.params.id;
  const userId = req.user.id;
  const { text, order } = req.body;

  const objective = await LearningObjective.findOne({ _id: objectiveId, createdBy: userId });
  if (!objective) {
    return notFoundResponse(res, 'Learning objective');
  }

  if (text && text.trim() !== objective.text) {
    await objective.updateText(text.trim(), userId);
  }

  if (order !== undefined && order !== objective.order) {
    await objective.reorder(order);
  }

  return successResponse(res, { objective }, 'Learning objective updated successfully');
}));

/**
 * DELETE /api/objectives/:id
 * Delete objective
 */
router.delete('/:id', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const objectiveId = req.params.id;
  const userId = req.user.id;

  const objective = await LearningObjective.findOne({ _id: objectiveId, createdBy: userId });
  if (!objective) {
    return notFoundResponse(res, 'Learning objective');
  }

  // Remove from quiz
  const quiz = await Quiz.findById(objective.quiz);
  if (quiz) {
    await quiz.removeLearningObjective(objectiveId);
  }

  // Delete associated questions
  const Question = (await import('../models/Question.js')).default;
  await Question.deleteMany({ learningObjective: objectiveId });

  // Delete objective
  await LearningObjective.findByIdAndDelete(objectiveId);

  return successResponse(res, null, 'Learning objective deleted successfully');
}));

/**
 * PUT /api/objectives/reorder
 * Reorder objectives
 */
router.put('/reorder', authenticateToken, asyncHandler(async (req, res) => {
  const { quizId, objectiveIds } = req.body;
  const userId = req.user.id;

  if (!quizId || !Array.isArray(objectiveIds)) {
    return errorResponse(res, 'QuizId and objectiveIds array are required', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
  }

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  // Verify all objectives belong to this quiz and user
  const objectives = await LearningObjective.find({ 
    _id: { $in: objectiveIds },
    quiz: quizId,
    createdBy: userId 
  });

  if (objectives.length !== objectiveIds.length) {
    return errorResponse(
      res, 
      'Some objectives not found or not owned by user', 
      'INVALID_OBJECTIVES', 
      HTTP_STATUS.BAD_REQUEST
    );
  }

  // Update order
  await LearningObjective.reorderObjectives(quizId, objectiveIds);

  const reorderedObjectives = await LearningObjective.find({ quiz: quizId })
    .sort({ order: 1 });

  return successResponse(res, { objectives: reorderedObjectives }, 'Learning objectives reordered successfully');
}));

export default router;