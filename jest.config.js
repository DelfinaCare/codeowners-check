// See: https://jestjs.io/docs/configuration

/** @type {import('jest').Config} **/
export default {
  clearMocks: true,
  collectCoverage: true,
  collectCoverageFrom: ['./src/**'],
  coverageDirectory: './coverage',
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  coverageReporters: ['json-summary', 'text', 'lcov'],
  // Uncomment the below lines if you would like to enforce a coverage threshold
  // for your action. This will fail the build if the coverage is below the
  // specified thresholds.
  // coverageThreshold: {
  //   global: {
  //     branches: 100,
  //     functions: 100,
  //     lines: 100,
  //     statements: 100
  //   }
  // },
  extensionsToTreatAsEsm: ['.ts'],
  moduleFileExtensions: ['ts', 'js'],
  // Sources import siblings with a `.js` extension (NodeNext resolution);
  // map those to the `.ts` files Jest actually loads.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  reporters: ['default'],
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/dist/', '/node_modules/'],
  // Type checking is done separately by `npm run typecheck` (TypeScript 7);
  // Jest only needs the types stripped.
  transform: {
    '^.+\\.ts$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript' },
          target: 'es2024'
        },
        module: { type: 'es6' },
        sourceMaps: 'inline'
      }
    ]
  },
  verbose: true
}
