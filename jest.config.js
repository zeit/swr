module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  testRegex: '/test/.*\\.test\\.tsx$',
  modulePathIgnorePatterns: ['<rootDir>/examples/'],
  setupFilesAfterEnv: ['<rootDir>/jest-setup.ts'],
  moduleNameMapper: {
    '^swr$': '<rootDir>/src',
    '^swr/infinite$': '<rootDir>/infinite/index.ts',
    '^swr/immutable$': '<rootDir>/immutable/index.ts',
    '^swr/subscribe$': '<rootDir>/subscribe/index.ts',
  },
  globals: {
    'ts-jest': {
      tsconfig: 'test/tsconfig.json'
    }
  }
}
