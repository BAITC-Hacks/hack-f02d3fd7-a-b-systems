import { initializeDatabase, pool } from './db.js';
import { seedLearningContent } from './learning.js';
import { seedDemoUsers } from './auth.js';
import { seedDemoChats } from './chats.js';

try {
  await initializeDatabase();
  await seedLearningContent();
  await seedDemoUsers();
  await seedDemoChats();
  console.log('Database migrations and demo seed completed.');
} catch (error) {
  console.error('Database migrations and demo seed failed:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
