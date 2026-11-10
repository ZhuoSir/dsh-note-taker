#!/usr/bin/env node
/**
 * 构建浏览器侧产物：src/client/index.jsx → lib/client.js
 *
 * 关键：DSH 的 web 壳不是用原生 ESM 加载客户端插件，而是走自己的模块加载器：
 *
 *   window.__ModuleLoader__.load({
 *     id: '<包名>',
 *     factory: (require) => { var module = { exports: {} }; ... return module.exports },
 *   })
 *
 * 直接产出 ESM 会在页面里报 `import failed`。所以这里用 esbuild 打成 CJS，
 * 再用 banner/footer 套上那层 factory；react / react-dom / @deepseek-ai/* 交给 require。
 */

import { build } from 'esbuild'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const ID = 'dsh-note-taker'

const banner = `window.__ModuleLoader__.load({
	id: ${JSON.stringify(ID)},
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });`

const footer = `		return module.exports;
	}
});`

const result = await build({
  entryPoints: [join(ROOT, 'src', 'client', 'index.jsx')],
  outfile: join(ROOT, 'lib', 'client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2022'],
  jsx: 'transform',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  banner: { js: banner },
  footer: { js: footer },
  external: ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/*'],
})

console.log(`构建完成：lib/client.js（${result.errors.length} 个错误）`)
