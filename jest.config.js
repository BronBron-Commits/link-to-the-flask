module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/tests/js'],
  testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],
  collectCoverageFrom: [
    'static/**/*.js',
    '!static/three*.js',
    '!static/*Loader.js',
    '!static/postprocessing/**',
    '!static/shaders/**',
  ],
  setupFiles: ['<rootDir>/tests/js/setup.js'],
  moduleNameMapper: {
    '^THREE$': '<rootDir>/tests/js/__mocks__/three.mock.js',
  },
  reporters: [
    'default',
    '<rootDir>/tests/js/verificationMatrixReporter.js',
  ],
  testLocationInResults: true,
  testTimeout: 10000,
  verbose: true,
};
