import express from 'express';
import AuthService from '../services/authService.js';
// import { validateLogin, validateRegister } from '../middleware/validator.js';
import { authenticateToken } from '../middleware/auth.js';
import { successResponse, errorResponse, unauthorizedResponse } from '../utils/responseFormatter.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS } from '../config/constants.js';

const router = express.Router();

/**
 * POST /api/auth/login
 * Authenticate user with CWL credentials
 */
router.post('/login', asyncHandler(async (req, res) => {
  const { cwlId, password } = req.body;

  const result = await AuthService.authenticate(cwlId, password);

  if (result.success) {
    // Set refresh token as httpOnly cookie
    res.cookie('refreshToken', result.tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    return successResponse(res, {
      user: result.user,
      accessToken: result.tokens.accessToken
    }, 'Login successful');
  } else {
    return unauthorizedResponse(res, result.message);
  }
}));

/**
 * POST /api/auth/register
 * Register a new user with CWL credentials
 */
router.post('/register', asyncHandler(async (req, res) => {
  const { cwlId, password } = req.body;

  const result = await AuthService.register(cwlId, password);

  if (result.success) {
    // Set refresh token as httpOnly cookie
    res.cookie('refreshToken', result.tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    return successResponse(res, {
      user: result.user,
      accessToken: result.tokens.accessToken
    }, 'Registration successful', HTTP_STATUS.CREATED);
  } else {
    return errorResponse(res, result.message, 'REGISTRATION_ERROR', HTTP_STATUS.BAD_REQUEST);
  }
}));

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh', asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

  if (!refreshToken) {
    return unauthorizedResponse(res, 'Refresh token required');
  }

  const result = await AuthService.refreshToken(refreshToken);

  if (result.success) {
    return successResponse(res, {
      accessToken: result.accessToken
    }, 'Token refreshed successfully');
  } else {
    // Clear invalid refresh token cookie
    res.clearCookie('refreshToken');
    return unauthorizedResponse(res, result.message);
  }
}));

/**
 * POST /api/auth/logout
 * Logout user and invalidate tokens
 */
router.post('/logout', authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const result = await AuthService.logout(userId);

  // Clear refresh token cookie
  res.clearCookie('refreshToken');

  if (result.success) {
    return successResponse(res, null, 'Logout successful');
  } else {
    return errorResponse(res, result.message, 'LOGOUT_ERROR');
  }
}));

/**
 * GET /api/auth/me
 * Get current user profile
 */
router.get('/me', authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  
  // Get full user details (attachUser middleware could be used here too)
  const User = (await import('../models/User.js')).default;
  const user = await User.findById(userId).select('-password');

  if (!user) {
    return unauthorizedResponse(res, 'User not found');
  }

  // Update last activity
  await user.updateLastActivity();

  return successResponse(res, {
    user: {
      id: user._id,
      cwlId: user.cwlId,
      stats: user.stats,
      lastLogin: user.lastLogin,
      createdAt: user.createdAt
    }
  }, 'User profile retrieved');
}));

/**
 * POST /api/auth/validate
 * Validate current session/token
 */
router.post('/validate', authenticateToken, asyncHandler(async (req, res) => {
  // If we reach here, the token is valid (authenticateToken middleware passed)
  return successResponse(res, {
    valid: true,
    user: {
      id: req.user.id,
      cwlId: req.user.cwlId
    }
  }, 'Token is valid');
}));

export default router;