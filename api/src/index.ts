/**
 * @specboard/api
 * Backend API server using Hono.
 */

import { serve } from '@hono/node-server';
import { Redis } from 'ioredis';
import { installErrorHandlers } from '@specboard/core';
import { createApp } from './app.ts';

// Install global error handlers for uncaught exceptions
installErrorHandlers('api');

// Redis connection
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl);

redis.on('error', (error) => {
	console.error('Redis connection error:', error);
});

redis.on('connect', () => {
	console.log('Connected to Redis');
});

const app = createApp(redis);

// Start server
const PORT = Number(process.env.PORT) || 3001;

serve({ fetch: app.fetch, port: PORT }, () => {
	console.log(`API server running on http://localhost:${PORT}`);
});
