// Global test setup
global.THREE = require('./__mocks__/three.mock.js');

// Mock Socket.IO
global.io = jest.fn(() => ({
  emit: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
  disconnect: jest.fn(),
}));

// Mock localStorage and sessionStorage
const localStorageMock = {
  data: {},
  getItem(key) { return this.data[key] || null; },
  setItem(key, value) { this.data[key] = String(value); },
  removeItem(key) { delete this.data[key]; },
  clear() { this.data = {}; },
};

const sessionStorageMock = {
  data: {},
  getItem(key) { return this.data[key] || null; },
  setItem(key, value) { this.data[key] = String(value); },
  removeItem(key) { delete this.data[key]; },
  clear() { this.data = {}; },
};

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

Object.defineProperty(window, 'sessionStorage', {
  value: sessionStorageMock
});

// Mock fetch
global.fetch = jest.fn();

// Mock performance.now()
performance.now = jest.fn(() => Date.now());

// Mock requestAnimationFrame
global.requestAnimationFrame = jest.fn((cb) => setTimeout(cb, 0));
global.cancelAnimationFrame = jest.fn();

// Suppress console during tests unless needed
const originalError = console.error;
const originalWarn = console.warn;

console.error = jest.fn((...args) => {
  if (typeof args[0] === 'string' && args[0].includes('Not implemented')) {
    return; // Suppress Not implemented errors
  }
  originalError.call(console, ...args);
});

console.warn = jest.fn((...args) => {
  if (typeof args[0] === 'string' && args[0].includes('THREE.ImageUtils')) {
    return; // Suppress THREE warning
  }
  originalWarn.call(console, ...args);
});
