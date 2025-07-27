import express from 'express';
import GenerationPlan from '../models/GenerationPlan.js';
import Quiz from '../models/Quiz.js';
import LearningObjective from '../models/LearningObjective.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateGeneratePlan, validateMongoId } from '../middleware/validator.js';
import { successResponse, errorResponse, notFoundResponse } from '../utils/responseFormatter.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS, PEDAGOGICAL_APPROACHES, QUESTION_TYPES } from '../config/constants.js';

const router = express.Router();

/**
 * POST /api/plans/generate
 * Generate AI plan for quiz
 */
router.post('/generate', authenticateToken, validateGeneratePlan, asyncHandler(async (req, res) => {
  const { quizId, approach, questionsPerLO = 3 } = req.body;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  // Get learning objectives
  const objectives = await LearningObjective.find({ quiz: quizId }).sort({ order: 1 });
  if (objectives.length === 0) {
    return errorResponse(res, 'Quiz must have learning objectives before generating a plan', 'NO_OBJECTIVES', HTTP_STATUS.BAD_REQUEST);
  }

  try {
    // Generate plan based on pedagogical approach
    const breakdown = [];
    const questionTypeDistribution = getQuestionTypeDistribution(approach);

    for (const objective of objectives) {
      const questionTypes = [];
      let totalForObjective = questionsPerLO;
      
      // Distribute question types for this objective
      for (const [type, percentage] of Object.entries(questionTypeDistribution)) {
        const count = Math.round((percentage / 100) * totalForObjective);
        if (count > 0) {
          questionTypes.push({
            type,
            count,
            reasoning: getReasoningForQuestionType(type, approach)
          });
        }
      }

      breakdown.push({
        learningObjective: objective._id,
        questionTypes
      });
    }

    const totalQuestions = objectives.length * questionsPerLO;

    // Calculate overall distribution
    const distribution = [];
    const typeCounts = {};

    breakdown.forEach(lo => {
      lo.questionTypes.forEach(qt => {
        typeCounts[qt.type] = (typeCounts[qt.type] || 0) + qt.count;
      });
    });

    Object.entries(typeCounts).forEach(([type, count]) => {
      distribution.push({
        type,
        totalCount: count,
        percentage: Math.round((count / totalQuestions) * 100)
      });
    });

    const plan = new GenerationPlan({
      quiz: quizId,
      approach,
      questionsPerLO,
      totalQuestions,
      breakdown,
      distribution,
      generationMetadata: {
        llmModel: 'llama3.1:8b',
        generationPrompt: `Generate ${approach} pedagogy plan`,
        processingTime: 1500,
        confidence: 0.9,
        reasoning: `Generated plan using ${approach} pedagogical approach with ${questionsPerLO} questions per learning objective`
      },
      createdBy: userId
    });

    await plan.save();
    await quiz.addGenerationPlan(plan._id);

    return successResponse(res, { plan }, 'Generation plan created successfully', HTTP_STATUS.CREATED);

  } catch (error) {
    console.error('Plan generation error:', error);
    return errorResponse(res, 'Failed to generate plan', 'PLAN_GENERATION_ERROR', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
}));

/**
 * GET /api/plans/quiz/:quizId
 * Get plans for quiz
 */
router.get('/quiz/:quizId', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const quizId = req.params.quizId;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  const plans = await GenerationPlan.find({ quiz: quizId })
    .populate({
      path: 'breakdown.learningObjective',
      select: 'text order'
    })
    .sort({ createdAt: -1 });

  return successResponse(res, { plans }, 'Generation plans retrieved successfully');
}));

/**
 * GET /api/plans/:id
 * Get specific plan details
 */
router.get('/:id', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const planId = req.params.id;
  const userId = req.user.id;

  const plan = await GenerationPlan.findOne({ _id: planId, createdBy: userId })
    .populate({
      path: 'quiz',
      select: 'name status'
    })
    .populate({
      path: 'breakdown.learningObjective',
      select: 'text order'
    });

  if (!plan) {
    return notFoundResponse(res, 'Generation plan');
  }

  return successResponse(res, { plan }, 'Generation plan retrieved successfully');
}));

/**
 * PUT /api/plans/:id
 * Modify plan breakdown
 */
router.put('/:id', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const planId = req.params.id;
  const userId = req.user.id;
  const { breakdown } = req.body;

  const plan = await GenerationPlan.findOne({ _id: planId, createdBy: userId });
  if (!plan) {
    return notFoundResponse(res, 'Generation plan');
  }

  if (breakdown) {
    await plan.updateBreakdown(breakdown, userId);
  }

  const updatedPlan = await GenerationPlan.findById(planId)
    .populate({
      path: 'breakdown.learningObjective',
      select: 'text order'
    });

  return successResponse(res, { plan: updatedPlan }, 'Generation plan updated successfully');
}));

/**
 * POST /api/plans/:id/approve
 * Approve plan (set as active)
 */
router.post('/:id/approve', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const planId = req.params.id;
  const userId = req.user.id;

  const plan = await GenerationPlan.findOne({ _id: planId, createdBy: userId });
  if (!plan) {
    return notFoundResponse(res, 'Generation plan');
  }

  await plan.approve();

  // Set as active plan in quiz
  const quiz = await Quiz.findById(plan.quiz);
  if (quiz) {
    await quiz.setActivePlan(planId);
  }

  return successResponse(res, { plan }, 'Generation plan approved successfully');
}));

/**
 * DELETE /api/plans/:id
 * Delete plan
 */
router.delete('/:id', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const planId = req.params.id;
  const userId = req.user.id;

  const plan = await GenerationPlan.findOne({ _id: planId, createdBy: userId });
  if (!plan) {
    return notFoundResponse(res, 'Generation plan');
  }

  // Check if plan is active
  const quiz = await Quiz.findById(plan.quiz);
  if (quiz && quiz.activePlan && quiz.activePlan.equals(planId)) {
    return errorResponse(res, 'Cannot delete active plan', 'ACTIVE_PLAN_DELETE', HTTP_STATUS.BAD_REQUEST);
  }

  await GenerationPlan.findByIdAndDelete(planId);

  return successResponse(res, null, 'Generation plan deleted successfully');
}));

// Helper functions
function getQuestionTypeDistribution(approach) {
  const distributions = {
    [PEDAGOGICAL_APPROACHES.SUPPORT]: {
      [QUESTION_TYPES.MULTIPLE_CHOICE]: 40,
      [QUESTION_TYPES.TRUE_FALSE]: 20,
      [QUESTION_TYPES.FLASHCARD]: 30,
      [QUESTION_TYPES.SUMMARY]: 10
    },
    [PEDAGOGICAL_APPROACHES.ASSESS]: {
      [QUESTION_TYPES.MULTIPLE_CHOICE]: 50,
      [QUESTION_TYPES.TRUE_FALSE]: 20,
      [QUESTION_TYPES.DISCUSSION]: 20,
      [QUESTION_TYPES.SUMMARY]: 10
    },
    [PEDAGOGICAL_APPROACHES.GAMIFY]: {
      [QUESTION_TYPES.MATCHING]: 30,
      [QUESTION_TYPES.ORDERING]: 25,
      [QUESTION_TYPES.MULTIPLE_CHOICE]: 25,
      [QUESTION_TYPES.FLASHCARD]: 20
    },
    [PEDAGOGICAL_APPROACHES.CUSTOM]: {
      [QUESTION_TYPES.MULTIPLE_CHOICE]: 35,
      [QUESTION_TYPES.TRUE_FALSE]: 15,
      [QUESTION_TYPES.FLASHCARD]: 15,
      [QUESTION_TYPES.DISCUSSION]: 15,
      [QUESTION_TYPES.SUMMARY]: 10,
      [QUESTION_TYPES.MATCHING]: 10
    }
  };

  return distributions[approach] || distributions[PEDAGOGICAL_APPROACHES.SUPPORT];
}

function getReasoningForQuestionType(type, approach) {
  const reasonings = {
    [QUESTION_TYPES.MULTIPLE_CHOICE]: `Multiple choice questions provide clear assessment with immediate feedback, suitable for ${approach} approach`,
    [QUESTION_TYPES.TRUE_FALSE]: `True/false questions test basic understanding and work well for quick comprehension checks`,
    [QUESTION_TYPES.FLASHCARD]: `Flashcards support active recall and spaced repetition learning`,
    [QUESTION_TYPES.SUMMARY]: `Summary questions encourage synthesis and deeper understanding`,
    [QUESTION_TYPES.DISCUSSION]: `Discussion prompts foster critical thinking and analysis`,
    [QUESTION_TYPES.MATCHING]: `Matching exercises help connect related concepts in an engaging way`,
    [QUESTION_TYPES.ORDERING]: `Ordering questions test understanding of sequences and relationships`,
    [QUESTION_TYPES.CLOZE]: `Fill-in-the-blank questions test specific knowledge retention`
  };

  return reasonings[type] || 'Selected to support learning objectives';
}

export default router;