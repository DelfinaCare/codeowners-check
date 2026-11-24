// See: https://rollupjs.org/introduction/
//
// `npm run package` first compiles src/ to build/ with TypeScript 7 (`tsc`),
// then this config bundles the compiled JavaScript. The sourcemaps plugin
// chains tsc's source maps so dist/index.js.map still points at src/*.ts.

import commonjs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import sourcemaps from 'rollup-plugin-sourcemaps2'

const config = {
  input: 'build/index.js',
  output: {
    esModule: true,
    file: 'dist/index.js',
    format: 'es',
    sourcemap: true
  },
  plugins: [
    // Only chain tsc's maps for our own code; leave dependencies as before.
    sourcemaps({ include: 'build/**' }),
    nodeResolve({ preferBuiltins: true }),
    commonjs()
  ]
}

export default config
