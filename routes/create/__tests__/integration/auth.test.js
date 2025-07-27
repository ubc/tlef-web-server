import { describe, test, expect, beforeEach, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import User from '../../models/User.js';
import authController from '../../controllers/authController.js';

const app = express();
app.use(express.json());
app.use('/api/auth', authController);

describe('Authentication API Integration Tests', () => {
  beforeEach(async () => {
    // Clean users collection before each test
    await User.deleteMany({});
  });

  describe('POST /api/auth/register', () => {
    test('should register a new user successfully', async () => {
      const userData = {
        cwlId: 'testuser',
        password: 'TestPass123'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.cwlId).toBe(userData.cwlId);
      expect(response.body.data.accessToken).toBeDefined();
      expect(response.body.data.user.password).toBeUndefined();

      // Verify user was created in database
      const userInDb = await User.findOne({ cwlId: userData.cwlId });
      expect(userInDb).toBeTruthy();
      expect(userInDb.cwlId).toBe(userData.cwlId);
    });

    test('should reject registration with duplicate cwlId', async () => {
      const userData = {
        cwlId: 'duplicate',
        password: 'TestPass123'
      };

      // Create first user
      await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      // Try to create duplicate
      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('already exists');
    });

    test('should reject registration with missing fields', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ cwlId: 'testuser' }) // Missing password
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    test('should reject registration with weak password', async () => {
      const userData = {
        cwlId: 'testuser',
        password: '123' // Too weak
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      // Create a test user for login tests
      await request(app)
        .post('/api/auth/register')
        .send({
          cwlId: 'logintest',
          password: 'TestPass123'
        });
    });

    test('should login successfully with correct credentials', async () => {
      const credentials = {
        cwlId: 'logintest',
        password: 'TestPass123'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(credentials)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.cwlId).toBe(credentials.cwlId);
      expect(response.body.data.accessToken).toBeDefined();
      expect(response.body.data.user.password).toBeUndefined();

      // Check for refresh token cookie
      const cookies = response.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies.some(cookie => cookie.includes('refreshToken'))).toBe(true);
    });

    test('should reject login with incorrect password', async () => {
      const credentials = {
        cwlId: 'logintest',
        password: 'wrongpassword'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(credentials)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('Invalid');
    });

    test('should reject login with non-existent user', async () => {
      const credentials = {
        cwlId: 'nonexistent',
        password: 'TestPass123'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(credentials)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('Invalid');
    });

    test('should reject login with missing fields', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ cwlId: 'logintest' }) // Missing password
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/auth/me', () => {
    let authToken;

    beforeEach(async () => {
      // Register and login to get auth token
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          cwlId: 'profiletest',
          password: 'TestPass123'
        });

      authToken = registerResponse.body.data.accessToken;
    });

    test('should get user profile with valid token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.cwlId).toBe('profiletest');
      expect(response.body.data.user.id).toBeDefined();
      expect(response.body.data.user.password).toBeUndefined();
    });

    test('should reject request without token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('token');
    });

    test('should reject request with invalid token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalidtoken')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/auth/validate', () => {
    let authToken;

    beforeEach(async () => {
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          cwlId: 'validatetest',
          password: 'TestPass123'
        });

      authToken = registerResponse.body.data.accessToken;
    });

    test('should validate token successfully', async () => {
      const response = await request(app)
        .post('/api/auth/validate')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.valid).toBe(true);
      expect(response.body.data.user.cwlId).toBe('validatetest');
    });

    test('should reject invalid token', async () => {
      const response = await request(app)
        .post('/api/auth/validate')
        .set('Authorization', 'Bearer invalidtoken')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/auth/logout', () => {
    let authToken;

    beforeEach(async () => {
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          cwlId: 'logouttest',
          password: 'TestPass123'
        });

      authToken = registerResponse.body.data.accessToken;
    });

    test('should logout successfully', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Logout successful');

      // Check that refresh token cookie is cleared
      const cookies = response.headers['set-cookie'];
      if (cookies) {
        const refreshTokenCookie = cookies.find(cookie => cookie.includes('refreshToken'));
        if (refreshTokenCookie) {
          expect(refreshTokenCookie).toContain('Max-Age=0');
        }
      }
    });

    test('should reject logout without token', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });
});