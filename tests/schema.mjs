// What columns the shipped SQL actually declares.
//
// Read by two suites that ask the same question from opposite ends — one
// compares it against what the makers produce, the other against the rows the
// running app leaves behind — so it lives here rather than being written twice
// and drifting.
//
// Deliberately simple, and deliberately not a SQL parser: it reads the two
// files this repository ships, whose shape is known. A line inside a CREATE
// TABLE that starts with a word is a column; one that starts with a constraint
// keyword is not. ALTER TABLE ... ADD COLUMN adds to whatever is already there.
// Anything relying on it should assert a few columns it knows are there, since
// a parser that quietly finds nothing makes every check downstream pass.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const CONSTRAINT = /^(primary|unique|check|foreign|constraint|exclude)\b/i

// A commented-out column is not a column.
//
// The CREATE TABLE pass strips `--` line by line; the ALTER and DO-block passes
// used to run over the raw file, so an `alter table ... add column` sitting
// behind a comment marker was still read as a column that exists. That is the
// worst kind of hole in a checker — it does not report anything missing, it
// reports something present that is not, and the suite that depends on it goes
// green either way. Found by commenting a column out and watching nothing fail.
//
// Single-quoted strings are honoured so a default like '--' would survive;
// dollar-quoted function bodies are left alone, because the loop pass has to
// read inside them and no comment in this file hides an ALTER there.
export function stripComments(text) {
  let out = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (quoted) {
      out += c
      if (c === "'") quoted = false
      continue
    }
    if (c === "'") { quoted = true; out += c; continue }
    if (c === '-' && text[i + 1] === '-') {
      while (i < text.length && text[i] !== '\n') i += 1
      out += '\n'
      continue
    }
    out += c
  }
  return out
}

export function columnsFromSql(text) {
  const tables = new Map()
  const add = (table, column) => {
    if (!tables.has(table)) tables.set(table, new Set())
    tables.get(table).add(column)
  }

  const creates = text.matchAll(/create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\);/gi)
  for (const [, table, body] of creates) {
    let depth = 0
    for (const raw of body.split('\n')) {
      const line = raw.replace(/--.*$/, '').trim()
      if (!line) continue
      // A column whose type carries its own parentheses — numeric(14,2), or a
      // check constraint spanning lines — must not be read as a new column.
      const before = depth
      depth += (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length
      if (before > 0) continue
      if (CONSTRAINT.test(line)) continue
      const name = line.match(/^(\w+)/)?.[1]
      if (name) add(table, name)
    }
  }

  const live = stripComments(text)
  const alters = live.matchAll(/alter table (?:if exists )?public\.(\w+)\s+add column (?:if not exists )?(\w+)/gi)
  for (const [, table, column] of alters) add(table, column)

  // `updated_at` and `deleted_at` are added to twenty-odd tables at once by a
  // DO block looping over an array of names. Reading only the literal ALTERs
  // would report every one of those columns as missing, which is the sort of
  // false alarm that gets a check switched off.
  const loops = live.matchAll(/do \$\$[\s\S]*?foreach \w+ in array array\[([\s\S]*?)\]([\s\S]*?)end \$\$;/gi)
  for (const [, list, body] of loops) {
    const names = [...list.matchAll(/'(\w+)'/g)].map((m) => m[1])
    for (const [, column] of body.matchAll(/add column (?:if not exists )?(\w+)/gi)) {
      for (const t of names) add(t, column)
    }
  }

  return tables
}

// What type each column is, which is the question a name-only check cannot ask.
//
// A column that exists is not a column that accepts what is being sent. Every
// maker in this app defaults an unfilled optional date to the empty string, and
// PostgreSQL refuses `''` for a date, a timestamp, a number or a uuid — so a
// work order with no due date is not a row with a blank field, it is a row the
// server rejects whole. The names all matched; the types never had to.
export function columnTypes(text) {
  const tables = new Map()
  const set = (table, column, type) => {
    if (!tables.has(table)) tables.set(table, new Map())
    tables.get(table).set(column, type)
  }
  const live = stripComments(text)
  const typeOf = (rest) => (rest.trim().match(/^([a-z][a-z0-9 ]*(?:\(\d+(?:,\s*\d+)?\))?)/i)?.[1] || '').trim().toLowerCase()

  for (const [, table, body] of live.matchAll(/create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
    let depth = 0
    for (const raw of body.split('\n')) {
      const line = raw.trim()
      if (!line) continue
      const before = depth
      depth += (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length
      if (before > 0) continue
      if (CONSTRAINT.test(line)) continue
      const m = line.match(/^(\w+)\s+(.*)$/)
      if (m) set(table, m[1], typeOf(m[2]))
    }
  }
  for (const [, table, column, rest] of live.matchAll(/alter table (?:if exists )?public\.(\w+)\s+add column (?:if not exists )?(\w+)\s+([^;]*)/gi)) {
    set(table, column, typeOf(rest))
  }
  for (const [, list, body] of live.matchAll(/do \$\$[\s\S]*?foreach \w+ in array array\[([\s\S]*?)\]([\s\S]*?)end \$\$;/gi)) {
    const names = [...list.matchAll(/'(\w+)'/g)].map((m) => m[1])
    for (const [, column, rest] of body.matchAll(/add column (?:if not exists )?(\w+)\s+([a-z][^'%,]*)/gi)) {
      for (const t of names) set(t, column, typeOf(rest))
    }
  }
  return tables
}

// Types that refuse an empty string. Text and its relatives accept one, so an
// unfilled optional text field is fine; everything here is not.
export const REFUSES_BLANK = /^(date|timestamp|time|numeric|integer|bigint|smallint|serial|uuid|boolean|decimal|real|double|jsonb?)/

// Columns declared NOT NULL with no default: the ones the client must fill,
// because the database will not fill them for it.
export function requiredColumns(text, table) {
  const body = text.match(new RegExp(`create table (?:if not exists )?public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i'))?.[1]
  if (!body) return []
  const out = []
  for (const raw of body.split('\n')) {
    const line = raw.replace(/--.*$/, '').trim().replace(/,$/, '')
    if (!line || CONSTRAINT.test(line)) continue
    const name = line.match(/^(\w+)/)?.[1]
    if (!name) continue
    if (/\bnot null\b/i.test(line) && !/\bdefault\b/i.test(line)) out.push(name)
  }
  return out
}

// Resolved from this file rather than from the caller's, so a suite in
// tests/logic and one in tests/browser read the same two files.
export function readSql() {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
  return ['schema.sql', 'corporate.sql']
    .map((f) => readFileSync(join(repo, 'supabase', f), 'utf8'))
    .join('\n')
}
