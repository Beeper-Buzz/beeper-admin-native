const path = require('node:path');

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@distribution$': path.resolve(__dirname, '../../distributions/default/index.ts'),
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // Workspace packages ship TypeScript source; let babel-jest compile them.
  transformIgnorePatterns: [
    'node_modules/(?!(?:.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@instincts/spree-.*|@trpc/.*|@tanstack/.*|zod|@spree/.*))',
  ],
};
