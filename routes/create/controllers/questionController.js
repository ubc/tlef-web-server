import express from 'express';
import Question from '../models/Question.js';
import Quiz from '../models/Quiz.js';
import LearningObjective from '../models/LearningObjective.js';
import GenerationPlan from '../models/GenerationPlan.js';
import { authenticateToken, attachUser } from '../middleware/auth.js';
import { validateCreateQuestion, validateGenerateQuestions, validateReorderQuestions, validateMongoId } from '../middleware/validator.js';
import { successResponse, errorResponse, notFoundResponse } from '../utils/responseFormatter.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS, QUESTION_TYPES, DIFFICULTY_LEVELS, REVIEW_STATUS } from '../config/constants.js';

const router = express.Router();

/**
 * GET /api/questions/quiz/:quizId
 * Get quiz questions
 */
router.get('/quiz/:quizId', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const quizId = req.params.quizId;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  const questions = await Question.find({ quiz: quizId })
    .populate('learningObjective', 'text order')
    .populate('generationPlan', 'approach')
    .populate('createdBy', 'cwlId')
    .sort({ order: 1 });

  return successResponse(res, { questions }, 'Questions retrieved successfully');
}));

/**
 * POST /api/questions/generate-from-plan
 * Generate questions from approved plan
 */
router.post('/generate-from-plan', authenticateToken, attachUser, validateGenerateQuestions, asyncHandler(async (req, res) => {
  const { quizId, planId } = req.body;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  // Verify plan exists and is approved
  const plan = await GenerationPlan.findOne({ 
    _id: planId, 
    quiz: quizId, 
    status: 'approved',
    createdBy: userId 
  }).populate('breakdown.learningObjective');

  if (!plan) {
    return notFoundResponse(res, 'Approved generation plan');
  }

  try {
    const questions = [];
    let questionOrder = 0;

    // Generate questions according to plan
    for (const breakdownItem of plan.breakdown) {
      const learningObjective = breakdownItem.learningObjective;

      for (const questionTypeConfig of breakdownItem.questionTypes) {
        for (let i = 0; i < questionTypeConfig.count; i++) {
          const question = await generateQuestion(
            quizId,
            learningObjective._id,
            questionTypeConfig.type,
            planId,
            questionOrder++,
            userId
          );
          
          questions.push(question);
          await quiz.addQuestion(question._id);
        }
      }
    }

    // Mark plan as used
    await plan.markAsUsed();

    // Update user stats
    if (req.user.fullUser) {
      await req.user.fullUser.incrementStats('questionsCreated');
    }

    // Add generation record to quiz
    await quiz.addGenerationRecord({
      approach: plan.approach,
      questionsGenerated: questions.length,
      processingTime: 5000,
      llmModel: 'llama3.1:8b',
      success: true
    });

    return successResponse(res, { 
      questions,
      metadata: {
        generatedCount: questions.length,
        planUsed: plan.approach,
        totalObjectives: plan.breakdown.length
      }
    }, 'Questions generated successfully', HTTP_STATUS.CREATED);

  } catch (error) {
    console.error('Question generation error:', error);
    
    // Add failed generation record
    await quiz.addGenerationRecord({
      approach: plan.approach,
      questionsGenerated: 0,
      processingTime: 2000,
      llmModel: 'llama3.1:8b',
      success: false,
      errorMessage: error.message
    });

    return errorResponse(res, 'Failed to generate questions', 'QUESTION_GENERATION_ERROR', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
}));

/**
 * POST /api/questions
 * Create manual question
 */
router.post('/', authenticateToken, validateCreateQuestion, asyncHandler(async (req, res) => {
  const { quizId, learningObjectiveId, type, difficulty, questionText, content, correctAnswer, explanation } = req.body;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  // Verify learning objective exists and belongs to quiz
  const objective = await LearningObjective.findOne({ 
    _id: learningObjectiveId, 
    quiz: quizId 
  });
  if (!objective) {
    return notFoundResponse(res, 'Learning objective');
  }

  // Get next order number
  const lastQuestion = await Question.findOne({ quiz: quizId }).sort({ order: -1 });
  const order = lastQuestion ? lastQuestion.order + 1 : 0;

  const question = new Question({
    quiz: quizId,
    learningObjective: learningObjectiveId,
    type,
    difficulty,
    questionText,
    content: content || {},
    correctAnswer,
    explanation,
    order,
    createdBy: userId
  });

  await question.save();
  await quiz.addQuestion(question._id);

  return successResponse(res, { question }, 'Question created successfully', HTTP_STATUS.CREATED);
}));

/**
 * PUT /api/questions/:id
 * Update question
 */
router.put('/:id', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const questionId = req.params.id;
  const userId = req.user.id;
  const updates = req.body;

  const question = await Question.findOne({ _id: questionId, createdBy: userId });
  if (!question) {
    return notFoundResponse(res, 'Question');
  }

  // Track changes for edit history
  const previousData = {
    questionText: question.questionText,
    content: question.content,
    correctAnswer: question.correctAnswer
  };

  // Update allowed fields
  const allowedUpdates = ['questionText', 'content', 'correctAnswer', 'explanation', 'difficulty'];
  allowedUpdates.forEach(field => {
    if (updates[field] !== undefined) {
      question[field] = updates[field];
    }
  });

  // Add to edit history
  await question.addEdit(userId, 'Manual update', previousData);

  return successResponse(res, { question }, 'Question updated successfully');
}));

/**
 * DELETE /api/questions/:id
 * Delete question
 */
router.delete('/:id', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const questionId = req.params.id;
  const userId = req.user.id;

  const question = await Question.findOne({ _id: questionId, createdBy: userId });
  if (!question) {
    return notFoundResponse(res, 'Question');
  }

  // Remove from quiz
  const quiz = await Quiz.findById(question.quiz);
  if (quiz) {
    await quiz.removeQuestion(questionId);
  }

  await Question.findByIdAndDelete(questionId);

  return successResponse(res, null, 'Question deleted successfully');
}));

/**
 * POST /api/questions/:id/regenerate
 * Regenerate specific question
 */
router.post('/:id/regenerate', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const questionId = req.params.id;
  const userId = req.user.id;

  const question = await Question.findOne({ _id: questionId, createdBy: userId })
    .populate('learningObjective');

  if (!question) {
    return notFoundResponse(res, 'Question');
  }

  try {
    // Generate new question content
    const newQuestionData = await generateQuestionContent(
      question.type,
      question.learningObjective.text,
      question.difficulty
    );

    // Store previous version
    const previousData = {
      questionText: question.questionText,
      content: question.content,
      correctAnswer: question.correctAnswer
    };

    // Update question
    question.questionText = newQuestionData.questionText;
    question.content = newQuestionData.content;
    question.correctAnswer = newQuestionData.correctAnswer;
    question.explanation = newQuestionData.explanation;

    // Add to edit history
    await question.addEdit(userId, 'AI regeneration', previousData);

    return successResponse(res, { question }, 'Question regenerated successfully');

  } catch (error) {
    console.error('Question regeneration error:', error);
    return errorResponse(res, 'Failed to regenerate question', 'REGENERATION_ERROR', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
}));

/**
 * PUT /api/questions/reorder
 * Reorder questions
 */
router.put('/reorder', authenticateToken, validateReorderQuestions, asyncHandler(async (req, res) => {
  const { quizId, questionIds } = req.body;
  const userId = req.user.id;

  // Verify quiz exists and user owns it
  const quiz = await Quiz.findOne({ _id: quizId, createdBy: userId });
  if (!quiz) {
    return notFoundResponse(res, 'Quiz');
  }

  // Verify all questions belong to this quiz and user
  const questions = await Question.find({ 
    _id: { $in: questionIds },
    quiz: quizId,
    createdBy: userId 
  });

  if (questions.length !== questionIds.length) {
    return errorResponse(
      res, 
      'Some questions not found or not owned by user', 
      'INVALID_QUESTIONS', 
      HTTP_STATUS.BAD_REQUEST
    );
  }

  // Update order
  await Question.reorderQuestions(quizId, questionIds);

  const reorderedQuestions = await Question.find({ quiz: quizId })
    .populate('learningObjective', 'text')
    .sort({ order: 1 });

  return successResponse(res, { questions: reorderedQuestions }, 'Questions reordered successfully');
}));

/**
 * PUT /api/questions/:id/review
 * Update question review status
 */
router.put('/:id/review', authenticateToken, validateMongoId, asyncHandler(async (req, res) => {
  const questionId = req.params.id;
  const userId = req.user.id;
  const { status } = req.body;

  if (!Object.values(REVIEW_STATUS).includes(status)) {
    return errorResponse(res, 'Invalid review status', 'VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST);
  }

  const question = await Question.findOne({ _id: questionId, createdBy: userId });
  if (!question) {
    return notFoundResponse(res, 'Question');
  }

  await question.markAsReviewed(status);

  return successResponse(res, { question }, 'Question review status updated');
}));

// Helper functions
async function generateQuestion(quizId, learningObjectiveId, type, planId, order, userId) {
  const objective = await LearningObjective.findById(learningObjectiveId);
  const questionData = await generateQuestionContent(type, objective.text, 'moderate');

  const question = new Question({
    quiz: quizId,
    learningObjective: learningObjectiveId,
    generationPlan: planId,
    type,
    difficulty: 'moderate',
    questionText: questionData.questionText,
    content: questionData.content,
    correctAnswer: questionData.correctAnswer,
    explanation: questionData.explanation,
    order,
    generationMetadata: {
      llmModel: 'llama3.1:8b',
      generationPrompt: `Generate ${type} question for: ${objective.text}`,
      confidence: 0.8,
      processingTime: 1500
    },
    createdBy: userId
  });

  await question.save();
  return question;
}

async function generateQuestionContent(type, objectiveText, difficulty) {
  // TODO: Implement AI question generation
  // This would call the UBC GenAI Toolkit
  // For now, return placeholder content

  const templates = {
    [QUESTION_TYPES.MULTIPLE_CHOICE]: {
      questionText: `Which of the following best demonstrates understanding of: ${objectiveText}?`,
      content: {
        options: [
          { text: "Option A - Correct understanding", isCorrect: true, order: 0 },
          { text: "Option B - Common misconception", isCorrect: false, order: 1 },
          { text: "Option C - Partial understanding", isCorrect: false, order: 2 },
          { text: "Option D - Incorrect approach", isCorrect: false, order: 3 }
        ]
      },
      correctAnswer: "Option A",
      explanation: "This option correctly demonstrates the key concept."
    },
    [QUESTION_TYPES.TRUE_FALSE]: {
      questionText: `True or False: ${objectiveText} is essential for understanding this topic.`,
      content: {
        options: [
          { text: "True", isCorrect: true, order: 0 },
          { text: "False", isCorrect: false, order: 1 }
        ]
      },
      correctAnswer: "True",
      explanation: "This statement is true because it aligns with the learning objective."
    },
    [QUESTION_TYPES.FLASHCARD]: {
      questionText: "Review this concept",
      content: {
        front: `What does this learning objective focus on?`,
        back: objectiveText
      },
      correctAnswer: objectiveText,
      explanation: "This flashcard helps reinforce the key learning objective."
    }
  };

  return templates[type] || templates[QUESTION_TYPES.MULTIPLE_CHOICE];
}

export default router;