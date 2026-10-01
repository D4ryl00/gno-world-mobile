module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/e2e/**/*.e2e.test.ts'],
  testTimeout: 180000,
  transform: { '^.+\\.(t|j)sx?$': ['babel-jest', { presets: ['babel-preset-expo'] }] },
  transformIgnorePatterns: ['/node_modules/(?!(@gnolang|@bufbuild|@connectrpc)/)'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
};
