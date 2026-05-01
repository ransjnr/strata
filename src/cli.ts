#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strata CLI — scaffolds agents, tools, and project setup.
 *
 *   strata init                — set up strata/ folder with provider config
 *   strata agent add <name>    — scaffold a new agent stratum
 *   strata tool add <name>     — scaffold a new tool definition
 */

import { promises as fs } from 'fs'
import { dirname, join, relative, resolve } from 'path'

const cwd = process.cwd()

interface Cmd {
  name: string
  description: string
  run(args: string[]): Promise<void>
}

const COMMANDS: Cmd[] = [
  {
    name: 'init',
    description: 'Scaffold strata/ folder with provider + formations',
    run: cmdInit,
  },
  {
    name: 'agent',
    description: 'Scaffold a new agent (e.g. `strata agent add summary`)',
    run: cmdAgent,
  },
  {
    name: 'tool',
    description: 'Scaffold a new tool (e.g. `strata tool add search`)',
    run: cmdTool,
  },
]

async function main() {
  const [, , command, ...rest] = process.argv

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    return
  }

  const cmd = COMMANDS.find((c) => c.name === command)
  if (!cmd) {
    console.error(`Unknown command: ${command}\n`)
    printHelp()
    process.exit(1)
  }

  try {
    await cmd.run(rest)
  } catch (err) {
    console.error(
      `\nstrata: ${err instanceof Error ? err.message : String(err)}`,
    )
    process.exit(1)
  }
}

function printHelp(): void {
  console.log('strata — agent + pipeline scaffolder\n')
  console.log('Usage:')
  console.log('  strata <command> [args]\n')
  console.log('Commands:')
  for (const c of COMMANDS) {
    console.log(`  ${c.name.padEnd(8)} ${c.description}`)
  }
  console.log('\nExamples:')
  console.log('  strata init')
  console.log('  strata agent add summary')
  console.log('  strata tool add search')
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toCamel(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^./, (c) => c.toLowerCase())
}

function toPascal(s: string): string {
  const c = toCamel(s)
  return c.charAt(0).toUpperCase() + c.slice(1)
}

function toKebab(s: string): string {
  return toCamel(s).replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

async function writeFile(path: string, content: string): Promise<void> {
  if (await exists(path)) {
    throw new Error(
      `File already exists: ${relative(cwd, path)} (refusing to overwrite)`,
    )
  }
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, content)
  console.log(`  created  ${relative(cwd, path)}`)
}

function findStrataRoot(): string {
  return resolve(cwd, 'strata')
}

// ─── strata init ─────────────────────────────────────────────────────────────

async function cmdInit(_args: string[]): Promise<void> {
  const root = findStrataRoot()
  console.log(`Scaffolding Strata project in ${relative(cwd, root) || '.'}\n`)

  await writeFile(join(root, 'provider.ts'), PROVIDER_TS)
  await writeFile(join(root, 'agents', '.gitkeep'), '')
  await writeFile(join(root, 'tools', '.gitkeep'), '')
  await writeFile(join(root, 'formations.ts'), FORMATIONS_TS)

  console.log('\nNext steps:')
  console.log('  1. npm install @anthropic-ai/sdk')
  console.log('  2. Set ANTHROPIC_API_KEY in your environment')
  console.log('  3. Import strata/provider once at app startup')
  console.log('  4. Run: strata agent add <name>')
}

// ─── strata agent add <name> ─────────────────────────────────────────────────

async function cmdAgent(args: string[]): Promise<void> {
  const [sub, rawName, ...rest] = args
  if (sub !== 'add' || !rawName) {
    throw new Error('Usage: strata agent add <name>')
  }
  const name = toCamel(rawName)
  const file = toKebab(rawName)
  const flags = parseFlags(rest)
  const model = flags.model ?? 'claude-sonnet-4-6'

  const path = join(findStrataRoot(), 'agents', `${file}.ts`)
  await writeFile(path, agentTemplate({ name, model }))
  console.log(`\nAgent "${name}" scaffolded.`)
  console.log(
    `Import it from "${relative(cwd, path).replace(/\.ts$/, '')}" and add it to a route's strata.`,
  )
}

// ─── strata tool add <name> ──────────────────────────────────────────────────

async function cmdTool(args: string[]): Promise<void> {
  const [sub, rawName] = args
  if (sub !== 'add' || !rawName) {
    throw new Error('Usage: strata tool add <name>')
  }
  const name = toCamel(rawName)
  const file = toKebab(rawName)

  const path = join(findStrataRoot(), 'tools', `${file}.ts`)
  await writeFile(path, toolTemplate({ name }))
  console.log(`\nTool "${name}" scaffolded.`)
}

// ─── Argument parsing ───────────────────────────────────────────────────────

function parseFlags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = args[i + 1]
      if (next && !next.startsWith('--')) {
        out[key] = next
        i++
      } else {
        out[key] = 'true'
      }
    }
  }
  return out
}

// ─── Templates ──────────────────────────────────────────────────────────────

const PROVIDER_TS = `/**
 * Configure the default agent provider.
 *
 * Import this file once at your app's entry point so every agent that
 * doesn't pass an explicit \`provider:\` falls back to it.
 */

import Anthropic from '@anthropic-ai/sdk'
import { setDefaultProvider } from '@ransjnr/strata'
import { anthropicProvider } from '@ransjnr/strata/anthropic'

setDefaultProvider(
  anthropicProvider({
    client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    defaultMaxTokens: 4096,
  }),
)
`

const FORMATIONS_TS = `import { formation } from '@ransjnr/strata'

/**
 * Add reusable strata combinations here. Example:
 *
 *   import { authStratum } from './auth'
 *   import { loggingStratum } from './logging'
 *
 *   export const apiFormation = formation([loggingStratum, authStratum])
 */

export const baseFormation = formation([])
`

function agentTemplate(opts: { name: string; model: string }): string {
  const { name, model } = opts
  const Pascal = toPascal(name)
  return `import { agent } from '@ransjnr/strata'
import { z } from 'zod'

/**
 * ${Pascal} agent.
 *
 * Edit \`provides\` to declare the structured output you want, and update
 * \`prompt\` / \`system\` to describe the task.
 */
export const ${name}Agent = agent({
  name: '${name}',
  provides: z.object({
    result: z.string(),
  }),
  requires: [],
  model: '${model}',
  system: 'You are a helpful assistant. Use the submit_output tool to return your final answer.',
  prompt: ({ req }) => {
    const url = new URL(req.url)
    return \`Handle the request to \${url.pathname}.\`
  },
  // tools: [/* import and list tools here */],
  maxTurns: 8,
})
`
}

function toolTemplate(opts: { name: string }): string {
  const { name } = opts
  const Pascal = toPascal(name)
  return `import { tool } from '@ransjnr/strata'
import { z } from 'zod'

/**
 * ${Pascal} tool.
 *
 * The \`description\` is shown to the LLM. The \`input\` schema is enforced
 * before \`run\` is called, so the body of \`run\` can rely on typed input.
 */
export const ${name}Tool = tool({
  name: '${name}',
  description: 'Describe what this tool does so the model knows when to call it.',
  input: z.object({
    query: z.string(),
  }),
  run: async ({ input }) => {
    return { ok: true, echoed: input.query }
  },
})
`
}

main()
