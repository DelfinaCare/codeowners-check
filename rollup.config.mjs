// See: https://rollupjs.org/introduction/
//
// The `tsc` plugin below compiles src/ to build/ with TypeScript 7 at the
// start of every build, then Rollup bundles the compiled JavaScript. The
// sourcemaps plugin chains tsc's source maps so dist/index.js.map still
// points at src/*.ts.

import { execFileSync } from 'node:child_process'
import { globSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import commonjs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import sourcemaps from 'rollup-plugin-sourcemaps2'

const tscBin = join(
  dirname(createRequire(import.meta.url).resolve('typescript/package.json')),
  'bin',
  'tsc'
)

/**
 * Compiles src/ with TypeScript 7 before each build. The sources are
 * registered as watch files so `rollup --watch` (`npm run package:watch`)
 * recompiles when a .ts file changes.
 */
function tsc() {
  return {
    name: 'tsc',
    buildStart() {
      for (const file of globSync('src/**/*.ts')) this.addWatchFile(file)
      execFileSync(
        process.execPath,
        [
          tscBin,
          '-p',
          'tsconfig.json',
          '--outDir',
          'build',
          '--sourceMap',
          '--inlineSources'
        ],
        { stdio: 'inherit' }
      )
    }
  }
}

const config = {
  input: 'build/index.js',
  output: {
    esModule: true,
    file: 'dist/index.js',
    format: 'es',
    sourcemap: true
  },
  plugins: [
    tsc(),
    // Only chain tsc's maps for our own code; leave dependencies as before.
    sourcemaps({ include: 'build/**' }),
    nodeResolve({ preferBuiltins: true }),
    commonjs()
  ]
}

export default config
