#!/usr/bin/env node
/**
 * 构建浏览器侧产物：src/client/index.jsx → lib/client.js
 *
 * 为什么用 esbuild：产物就是一个文件，不需要 dev server 与 HMR（plan 决策 3）。
 * react / react-dom 与 @deepseek-ai/* 由宿主提供，打包时标记 external。
 */

import { build } from 'esbuild'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

const result = await build({
  entryPoints: [join(ROOT, 'src', 'client', 'index.jsx')],
  outfile: join(ROOT, 'lib', 'client.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  jsx: 'transform',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  external: ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/*'],
})

console.log(`构建完成：lib/client.js（${result.errors.length} 个错误）`)
