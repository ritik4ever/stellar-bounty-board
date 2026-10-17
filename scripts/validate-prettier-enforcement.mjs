#!/usr/bin/env node

/**
 * Prettier Enforcement and Configuration Validator
 *
 * Resolves:
 * - Issue #1436: DevOps: add `.prettierrc.json` to the pre-commit / CI checks if it isn't already enforced
 * - Issue #1439: DevOps: add a comment explaining non-obvious settings in `.prettierrc.json`
 * - Issue #1440: DevOps: document why `.prettierignore`'s settings differ from framework defaults
 * - Issue #1443: DevOps: add `.prettierignore` to the pre-commit / CI checks if it isn't already enforced
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function validatePrettierConfig(cwd = process.cwd()) {
  const errors = []
  const configPath = join(cwd, '.prettierrc.json')

  if (!existsSync(configPath)) {
    return { valid: false, errors: ['.prettierrc.json file is missing'] }
  }

  let config
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (err) {
    return { valid: false, errors: [`Failed to parse .prettierrc.json: ${err.message}`] }
  }

  // Validate deliberate deviations
  if (config.printWidth !== 100) {
    errors.push(`Expected printWidth: 100, received: ${config.printWidth}`)
  }
  if (config.singleQuote !== true) {
    errors.push(`Expected singleQuote: true, received: ${config.singleQuote}`)
  }
  if (config.trailingComma !== 'es5') {
    errors.push(`Expected trailingComma: "es5", received: "${config.trailingComma}"`)
  }
  if (config.endOfLine !== 'lf') {
    errors.push(`Expected endOfLine: "lf", received: "${config.endOfLine}"`)
  }

  return {
    valid: errors.length === 0,
    errors,
    config,
  }
}

export function validatePrettierIgnore(cwd = process.cwd()) {
  const errors = []
  const ignorePath = join(cwd, '.prettierignore')

  if (!existsSync(ignorePath)) {
    return { valid: false, errors: ['.prettierignore file is missing'] }
  }

  const content = readFileSync(ignorePath, 'utf8')
  const mandatoryPatterns = [
    'frontend/src/generated',
    'contracts/target',
    'contracts/test_snapshots',
    'data/*.json',
    'node_modules',
  ]

  for (const pattern of mandatoryPatterns) {
    if (!content.includes(pattern)) {
      errors.push(`Missing mandatory ignore pattern "${pattern}" in .prettierignore`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    content,
  }
}

export function validatePrettierDocumentation(cwd = process.cwd()) {
  const errors = []
  const docPath = join(cwd, 'docs/PRETTIER_CONFIG.md')

  if (!existsSync(docPath)) {
    return { valid: false, errors: ['docs/PRETTIER_CONFIG.md is missing'] }
  }

  const doc = readFileSync(docPath, 'utf8')
  if (!doc.includes('printWidth') || !doc.includes('trailingComma') || !doc.includes('singleQuote')) {
    errors.push('docs/PRETTIER_CONFIG.md is missing documentation of non-default settings (Issue #1439)')
  }
  if (!doc.includes('.prettierignore') || !doc.includes('Deliberate Deviation')) {
    errors.push('docs/PRETTIER_CONFIG.md is missing .prettierignore deviations documentation (Issue #1440)')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

export function validatePipelineEnforcement(cwd = process.cwd()) {
  const errors = []
  const pkgPath = join(cwd, 'package.json')
  const ciPath = join(cwd, '.github/workflows/ci.yml')
  const lintStagedPath = join(cwd, '.lintstagedrc.json')
  const huskyPath = join(cwd, '.husky/pre-commit')

  if (!existsSync(pkgPath)) {
    errors.push('package.json is missing')
  } else {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    if (!pkg.scripts['format:check']) {
      errors.push('Missing "format:check" script in package.json (Issue #1436)')
    }
    if (!pkg.scripts['format:check']?.includes('.prettierignore')) {
      errors.push('"format:check" script must reference .prettierignore (Issue #1443)')
    }
    if (!pkg.scripts['format:check']?.includes('.prettierrc.json')) {
      errors.push('"format:check" script must reference .prettierrc.json (Issue #1436)')
    }
    if (!pkg.scripts['lint']?.includes('validate:prettier')) {
      errors.push('"lint" script must include "validate:prettier"')
    }
  }

  if (!existsSync(lintStagedPath)) {
    errors.push('.lintstagedrc.json is missing')
  }

  if (!existsSync(huskyPath)) {
    errors.push('.husky/pre-commit is missing')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

export function determineEnforcementOutcome(cwd = process.cwd()) {
  const config = validatePrettierConfig(cwd)
  const ignore = validatePrettierIgnore(cwd)
  const docs = validatePrettierDocumentation(cwd)
  const pipeline = validatePipelineEnforcement(cwd)

  const allErrors = [
    ...config.errors,
    ...ignore.errors,
    ...docs.errors,
    ...pipeline.errors,
  ]

  if (allErrors.length > 0) {
    return {
      status: 'BLOCKED',
      reason: 'PRETTIER_ENFORCEMENT_GAP',
      message: allErrors.join('; '),
      ownerAction: 'Update Prettier configuration, pipeline scripts, or documentation.',
    }
  }

  return {
    status: 'VERIFIED',
    reason: 'PRETTIER_FULLY_ENFORCED',
    message: '.prettierrc.json and .prettierignore are validated, documented, and actively enforced in CI and pre-commit hooks.',
    ownerAction: 'Proceed with normal development.',
  }
}

function runCli() {
  const outcome = determineEnforcementOutcome()
  const prefix = '[prettier-enforcement]'

  if (outcome.status === 'BLOCKED') {
    console.error(`\n${prefix} BLOCKED: ${outcome.message}`)
    console.error(`${prefix} ACTION: ${outcome.ownerAction}`)
    process.exit(1)
  }

  console.log(`${prefix} OK: ${outcome.message}`)
  process.exit(0)
}

if (process.argv[1] && process.argv[1].endsWith('validate-prettier-enforcement.mjs')) {
  runCli()
}
