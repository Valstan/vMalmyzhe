#!/usr/bin/env node
/**
 * Font cache-busting script — adds content hash to font filenames.
 * Runs before `next build`. Reads fonts from src/fonts/, writes hashed
 * copies to public/fonts/, updates globals.css with hashed URLs.
 *
 * Usage: node scripts/hash-fonts.mjs
 */

import { createHash } from 'crypto'
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const srcFontsDir = join(projectRoot, 'src', 'fonts')
const publicFontsDir = join(projectRoot, 'public', 'fonts')
const globalsCssPath = join(projectRoot, 'src', 'app', '(frontend)', 'globals.css')

// Font files to process (relative to srcFontsDir)
const FONTS = [
  'commissioner-400.ttf',
  'commissioner-700.ttf',
  'prata.ttf',
]

// License files to copy as-is (no hashing)
const LICENSE_FILES = [
  'OFL-Commissioner.txt',
  'OFL-Prata.txt',
]

function computeHash(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 8)
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function main() {
  console.log('[hash-fonts] Starting font cache-busting...')

  // Ensure source fonts exist
  for (const font of FONTS) {
    const srcPath = join(srcFontsDir, font)
    if (!existsSync(srcPath)) {
      console.error(`[hash-fonts] ERROR: Source font not found: ${srcPath}`)
      process.exit(1)
    }
  }

  // Read globals.css
  let css = readFileSync(globalsCssPath, 'utf8')

  // Process each font
  for (const font of FONTS) {
    const srcPath = join(srcFontsDir, font)
    const content = readFileSync(srcPath)
    const hash = computeHash(content)
    const ext = font.slice(font.lastIndexOf('.'))
    const baseName = font.slice(0, font.lastIndexOf('.'))
    const hashedName = `${baseName}.${hash}${ext}`
    const destPath = join(publicFontsDir, hashedName)

    // Copy to public/fonts/ with hash
    ensureDir(publicFontsDir)
    copyFileSync(srcPath, destPath)
    console.log(`[hash-fonts] ${font} -> ${hashedName} (hash: ${hash})`)

    // Update CSS: replace /fonts/{font} with /fonts/{hashedName}
    const oldUrl = `/fonts/${font}`
    const newUrl = `/fonts/${hashedName}`
    if (css.includes(oldUrl)) {
      css = css.replace(new RegExp(oldUrl.replace('.', '\\.'), 'g'), newUrl)
      console.log(`[hash-fonts] Updated CSS: ${oldUrl} -> ${newUrl}`)
    } else {
      console.warn(`[hash-fonts] WARNING: ${oldUrl} not found in CSS`)
    }
  }

  // Write updated CSS
  writeFileSync(globalsCssPath, css, 'utf8')
  console.log('[hash-fonts] Done. globals.css updated.')

  // Copy license files as-is (no hashing)
  for (const license of LICENSE_FILES) {
    const srcPath = join(srcFontsDir, license)
    const destPath = join(publicFontsDir, license)
    if (existsSync(srcPath)) {
      ensureDir(publicFontsDir)
      copyFileSync(srcPath, destPath)
      console.log(`[hash-fonts] Copied license: ${license}`)
    }
  }
}

main()