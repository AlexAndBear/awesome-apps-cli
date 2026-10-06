#!/usr/bin/env node
import { lchown, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { unzipSync } from 'fflate'

const DEFAULT_SOURCE =
  'https://raw.githubusercontent.com/opencloud-eu/awesome-apps/main/webApps/apps.json'
// development boilerplate, not an installable app
const DEFAULT_EXCLUDE = ['com.github.opencloud-eu.web-app-skeleton']

const HELP = `Usage: awesome-apps <dest> [options]

Downloads the web apps listed in apps.json and unpacks them into <dest>.

Options:
  -c, --clean                     Delete the contents of <dest> before unpacking
  -o, --opencloud-version <ver>   Pick the newest app version compatible with this OpenCloud version
                                  (default: newest version of every app)
      --official                  Only install apps marked as official in apps.json
  -i, --include <id>              Only install this app id (repeatable)
  -e, --exclude <id>              Skip this app id (repeatable, default: ${DEFAULT_EXCLUDE.join(', ')})
  -u, --owner <uid[:gid]>         chown the unpacked apps, e.g. 1000:1000 (gid defaults to uid)
  -s, --source <url|file>         apps.json location (default: ${DEFAULT_SOURCE})
  -h, --help                      Show this help
`

const parseVersion = (v) => v.split('.').map((n) => parseInt(n, 10) || 0)
const compareVersions = (a, b) => {
  const [pa, pb] = [parseVersion(a), parseVersion(b)]
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

const pickVersion = (app, ocVersion) => {
  const versions = [...app.versions].sort((a, b) => compareVersions(b.version, a.version))
  if (!ocVersion) return versions[0]
  return versions.find(
    (v) =>
      (!v.minOpenCloud || compareVersions(ocVersion, v.minOpenCloud) >= 0) &&
      (!v.maxOpenCloud || compareVersions(ocVersion, v.maxOpenCloud) <= 0)
  )
}

const loadAppsJson = async (source) => {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source)
    if (!res.ok) throw new Error(`fetching ${source} failed: ${res.status} ${res.statusText}`)
    return res.json()
  }
  return JSON.parse(await readFile(source, 'utf8'))
}

const parseOwner = (owner) => {
  const match = /^(\d+)(?::(\d+))?$/.exec(owner)
  if (!match) throw new Error(`invalid --owner "${owner}", expected uid[:gid] like 1000:1000`)
  const uid = Number(match[1])
  return { uid, gid: match[2] === undefined ? uid : Number(match[2]) }
}

const chownRecursive = async (target, { uid, gid }) => {
  await lchown(target, uid, gid)
  for (const entry of await readdir(target, { withFileTypes: true, recursive: true })) {
    await lchown(path.join(entry.parentPath ?? entry.path, entry.name), uid, gid)
  }
}

// returns the folder the app was unpacked into
const extractZip = async (buffer, dest, fallbackDir) => {
  const entries = Object.entries(unzipSync(new Uint8Array(buffer))).filter(
    ([name]) => !name.startsWith('__MACOSX/')
  )
  // apps without a single top-level folder get their own one, so they don't clash
  const topLevel = new Set(entries.map(([name]) => name.split('/')[0]))
  const hasRootDir = topLevel.size === 1 && entries.some(([name]) => name.includes('/'))
  const root = path.resolve(dest, hasRootDir ? '' : fallbackDir)
  for (const [name, data] of entries) {
    const target = path.resolve(root, name)
    // guard against zip slip
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`refusing to extract "${name}" outside of ${root}`)
    }
    if (name.endsWith('/')) {
      await mkdir(target, { recursive: true })
      continue
    }
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, data)
  }
  return hasRootDir ? path.join(root, [...topLevel][0]) : root
}

const cleanDir = async (dir) => {
  const entries = await readdir(dir)
  await Promise.all(entries.map((e) => rm(path.join(dir, e), { recursive: true, force: true })))
}

const main = async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      clean: { type: 'boolean', short: 'c', default: false },
      'opencloud-version': { type: 'string', short: 'o' },
      official: { type: 'boolean', default: false },
      owner: { type: 'string', short: 'u' },
      include: { type: 'string', short: 'i', multiple: true },
      exclude: { type: 'string', short: 'e', multiple: true },
      source: { type: 'string', short: 's', default: DEFAULT_SOURCE },
      help: { type: 'boolean', short: 'h', default: false }
    }
  })

  if (values.help) {
    console.log(HELP)
    return
  }
  if (positionals.length !== 1) {
    console.error(HELP)
    process.exitCode = 1
    return
  }

  const dest = path.resolve(positionals[0])
  const exclude = values.exclude ?? DEFAULT_EXCLUDE
  const ocVersion = values['opencloud-version']
  const owner = values.owner && parseOwner(values.owner)

  const { apps } = await loadAppsJson(values.source)
  const selected = apps.filter(
    (app) =>
      (!values.official || app.official === true) &&
      (!values.include || values.include.includes(app.id)) &&
      !exclude.includes(app.id)
  )

  const createdDest = await mkdir(dest, { recursive: true })
  if (owner && createdDest) await chownRecursive(createdDest, owner)
  if (values.clean) {
    console.log(`Cleaning ${dest}`)
    await cleanDir(dest)
  }

  let failed = 0
  for (const app of selected) {
    const version = pickVersion(app, ocVersion)
    if (!version) {
      console.warn(`- ${app.id}: no version compatible with OpenCloud ${ocVersion}, skipping`)
      continue
    }
    try {
      const res = await fetch(version.url)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const zipName = path.basename(new URL(version.url).pathname, '.zip')
      const appDir = await extractZip(await res.arrayBuffer(), dest, zipName)
      if (owner) await chownRecursive(appDir, owner)
      console.log(`✓ ${app.id}@${version.version}`)
    } catch (err) {
      failed++
      console.error(`✗ ${app.id}@${version.version}: ${err.message}`)
    }
  }

  if (failed) process.exitCode = 1
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
