/**
 * Host half of the hongguo-drama bundle.
 *
 * Two sources feed the panel:
 *   - the public web pages, for browsing, ranking and search (one origin, no CORS);
 *   - the openhongguo SDK, for every episode's playback model, which the web pages only
 *     publish for the first few episodes.
 *
 * Protected episodes are CENC (cenc-aes-ctr) HEVC. They are decrypted here with the
 * content key the SDK resolves and cached as plain MP4, so the browser never needs a key
 * and the page only sees same-origin URLs.
 */
import { createReadStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createClient } from 'openhongguo'
import { decryptInPlace } from './cenc.js'

const ORIGIN = 'https://hongguoduanju.com'
const ROUTE = '/hongguo-drama/api'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export const inject = ['webServer']

/** Category listings the site exposes, and the page size it serves for each. */
const CATEGORY_TYPES = new Set(['real-drama', 'comic-drama', 'ai-drama', 'comic'])
const PER_CATEGORY_PAGE = 24

/**
 * Ranking boards. The site only renders `rankList` into its SSR payload for crawler user
 * agents, so these calls reuse a crawler identity; a normal browser UA gets `content: {}`.
 */
const RANK_SLUGS = new Set(['hot-drama', 'hot-real-drama', 'hot-comic-drama', 'hot-ai-drama'])
const CRAWLER_UA =
  'Mozilla/5.0 (compatible; Bingbot/2.0; +http://www.bing.com/bingbot.htm)'
const PER_RANK_PAGE = 20

/** Fetch one hongguo URL as text, with the headers its SSR endpoints expect. */
async function fetchText(path) {
  const response = await fetch(ORIGIN + path, {
    headers: { 'user-agent': UA, referer: ORIGIN + '/' },
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error(`hongguo ${path} answered ${response.status}`)
  return response.text()
}

/** Fetch one URL as text, keeping the status so a paged list can tell "no more" from a failure. */
async function fetchTextStatus(path, userAgent) {
  const response = await fetch(ORIGIN + path, {
    headers: { 'user-agent': userAgent ?? UA, referer: ORIGIN + '/' },
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) return { ok: false, status: response.status, text: '' }
  return { ok: true, status: response.status, text: await response.text() }
}

/**
 * Read one JSON value that follows `"key":` inside an SSR document.
 * The value is located by bracket matching, so it is independent of the surrounding
 * `window.X = {...}` assignment and of any unescaped `\u002F` in the payload.
 */
function extractJson(text, key) {
  const marker = '"' + key + '":'
  const at = text.indexOf(marker)
  if (at < 0) return undefined
  let start = at + marker.length
  while (start < text.length && text[start] !== '{' && text[start] !== '[') start += 1
  if (start >= text.length) return undefined

  const stack = []
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') {
      stack.pop()
      if (stack.length === 0) return JSON.parse(text.slice(start, i + 1))
    }
  }
  return undefined
}

/** The public 360p rendition players on the site build from a video id. */
const mp4Of = (vid) => ORIGIN + '/video/public/' + vid + '/360p.mp4'

/** True when the site will serve this episode's public rendition. */
async function isPlayable(vid) {
  try {
    const response = await fetch(mp4Of(vid), {
      method: 'HEAD',
      headers: { 'user-agent': UA, referer: ORIGIN + '/' },
      signal: AbortSignal.timeout(12000),
    })
    return response.ok
  } catch {
    return false
  }
}

/** How long each loader result stays warm; boards and listings move slowly. */
const TTL = {
  rank: 5 * 60 * 1000,
  list: 5 * 60 * 1000,
  search: 3 * 60 * 1000,
  detail: 10 * 60 * 1000,
  probe: 10 * 60 * 1000,
}

/** Mobile identity the media CDN accepts; the desktop UA is refused on some edges. */
const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 okhttp/3.12.13'

const DATA_DIR = join(homedir(), '.dsh', 'hongguo-drama')
const MEDIA_DIR = join(DATA_DIR, 'media')
const MEDIA_KEEP = 40

const CACHE_LIMIT = 240
const cache = new Map()
const inflight = new Map()

/** Drop the oldest entries once the table outgrows its limit. */
function pruneCache() {
  if (cache.size <= CACHE_LIMIT) return
  const ordered = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)
  for (let i = 0; i < ordered.length - CACHE_LIMIT; i += 1) cache.delete(ordered[i][0])
}

/**
 * Serve a loader result from memory for `ttlMs`, and share one pending promise between
 * concurrent callers so a burst of identical requests reaches the site once.
 */
async function cached(key, ttlMs, produce) {
  const entry = cache.get(key)
  if (entry) {
    if (Date.now() - entry.at < ttlMs) return entry.value
    cache.delete(key)
  }
  const pending = inflight.get(key)
  if (pending) return pending
  const promise = (async () => {
    try {
      const value = await produce()
      cache.set(key, { at: Date.now(), value })
      pruneCache()
      return value
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, promise)
  return promise
}

/** Project one series record onto what the panel renders. */
function shapeSeries(record) {
  if (!record) return null
  return {
    seriesId: String(record.series_id ?? ''),
    title: record.series_name ?? record.series_title ?? '',
    cover: record.series_cover ?? '',
    intro: record.series_intro ?? '',
    tags: Array.isArray(record.tags)
      ? record.tags
      : Array.isArray(record.category_list)
        ? record.category_list.map((entry) => entry.name)
        : [],
    episodeCount: Number(record.episode_cnt ?? 0),
    episodeLabel: record.episode_right_text ?? '',
    accessible: Number(record.accessible_episode_cnt ?? 0),
    hot: record.hot_score_data?.text ?? '',
    vids: Array.isArray(record.vid_list) ? record.vid_list.map(String) : [],
  }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** Homepage carousels: 热播短剧 / 热播真人剧 / 热播漫剧 / 热播AI剧. */
async function loadHome() {
  const html = await fetchText('/')
  const sections = extractJson(html, 'homeSections') ?? []
  return {
    sections: sections.map((section) => ({
      type: section.tab_type ?? '',
      name: section.tab_name ?? '',
      items: (section.video_list ?? []).map(shapeSeries).filter(Boolean),
    })),
  }
}

async function loadSearch(query, page) {
  const path =
    '/api/search/result/?query=' + encodeURIComponent(query) + '&page_num=' + page
  const payload = JSON.parse(await fetchText(path))
  const items = (payload.searchList ?? [])
    .map((entry) => entry.video_data)
    .filter(Boolean)
    .map(shapeSeries)
    .filter((series) => series && series.seriesId)
  return { items, hasMore: Boolean(payload.hasMore), total: payload.totalCount ?? items.length }
}

async function loadDetail(seriesId) {
  const html = await fetchText('/detail?series_id=' + encodeURIComponent(seriesId))
  const series = shapeSeries(extractJson(html, 'seriesDetail'))
  if (!series) throw new Error('series not found')
  return { series }
}

/**
 * One page of a category listing. The homepage only ships nine cards per ranking;
 * `/category/<type>?page=N` carries 24 per page and runs to roughly 800 series.
 */
async function loadBrowse(type, page) {
  if (!CATEGORY_TYPES.has(type)) throw new Error('unknown category ' + type)
  const result = await fetchTextStatus('/category/' + type + '?page=' + page)
  if (!result.ok) {
    if (result.status === 404) return { items: [], hasMore: false, page }
    throw new Error('hongguo category answered ' + result.status)
  }
  const list = extractJson(result.text, 'recommendList') ?? []
  const items = list.map(shapeSeries).filter((series) => series && series.seriesId)
  return { items, hasMore: items.length >= PER_CATEGORY_PAGE, page }
}

/** Project one ranking row onto what the panel renders. */
function shapeRankRow(row) {
  return {
    seriesId: String(row.seriesId ?? row.id ?? ''),
    title: row.title ?? '',
    cover: row.cover ?? '',
    intro: row.description ?? '',
    tags: Array.isArray(row.tags) ? row.tags : [],
    episodeCount: Number(row.episodeCount ?? 0),
    episodeLabel: row.episodeCount ? '全' + row.episodeCount + '集' : '',
    accessible: Number(row.openEpisodeCount ?? 0),
    hot: row.heatText || row.scoreText || row.favoriteText || '',
    vids: Array.isArray(row.episodeVids) ? row.episodeVids.map(String) : [],
    rank: Number(row.rank ?? 0),
  }
}

/** One page of a ranking board; each board runs five pages of twenty. */
async function loadRank(slug, page) {
  if (!RANK_SLUGS.has(slug)) throw new Error('unknown rank ' + slug)
  const result = await fetchTextStatus('/rank/' + slug + '?page=' + page, CRAWLER_UA)
  if (!result.ok) {
    if (result.status === 404) return { items: [], hasMore: false, page, totalPages: 0 }
    throw new Error('hongguo rank answered ' + result.status)
  }
  const loader = extractJson(result.text, 'loaderData') ?? {}
  const entry = Object.entries(loader).find(([key]) => key.includes('/page'))?.[1]
  const content = entry?.content ?? {}
  const rows = Array.isArray(content.rankList) ? content.rankList : []
  const totalPages = Number(content.pagination?.totalPages ?? 0)
  const items = rows.map(shapeRankRow).filter((series) => series.seriesId)
  return {
    items,
    hasMore: totalPages > page || items.length >= PER_RANK_PAGE,
    page,
    totalPages,
  }
}

/** Probe the first `count` episodes; the site locks the rest behind the app. */
async function probePlayable(seriesId, count) {  const html = await fetchText('/detail?series_id=' + encodeURIComponent(seriesId))
  const detail = extractJson(html, 'seriesDetail')
  const vids = (detail?.vid_list ?? []).slice(0, count).map(String)
  const verdicts = await Promise.all(vids.map(isPlayable))
  return {
    episodes: vids.map((vid, index) => ({ index: index + 1, vid, playable: verdicts[index] })),
  }
}

// ------------------------------------------------------------------ SDK playback

let sdkPromise = null

/** One anonymous device client for the whole Host process. */
function sdk() {
  if (!sdkPromise) {
    sdkPromise = createClient({
      profile: join(DATA_DIR, 'device.json'),
      log: () => {},
    }).catch((error) => {
      sdkPromise = null
      throw error
    })
  }
  return sdkPromise
}

/** Resolve a playback model, swapping the anonymous device when the service withholds it. */
async function resolvePlaybackModel(episodeId) {
  const client = await sdk()
  let result = null
  try {
    result = await client.resolvePlayback(episodeId)
  } catch (error) {
    if (error?.code !== 'ANONYMOUS_LIMITED') throw error
    await client.resetDevice()
    result = await client.resolvePlayback(episodeId)
  }
  if (!result?.playback?.streams?.length) {
    await client.resetDevice()
    result = await client.resolvePlayback(episodeId)
  }
  if (!result?.playback?.streams?.length) throw new Error('no playable stream')
  return result
}

/** Prefer 360p: it is the smallest rendition that stays readable at sidebar width. */
function pickStream(streams, definition) {
  return (
    streams.find((s) => s.definition === definition) ??
    streams.find((s) => s.definition === '360p') ??
    streams[0]
  )
}

/** Keep the newest N decrypted episodes and drop the rest. */
async function pruneMedia() {
  try {
    const names = await readdir(MEDIA_DIR)
    if (names.length <= MEDIA_KEEP) return
    const entries = []
    for (const name of names) {
      if (!name.endsWith('.mp4')) continue
      const info = await stat(join(MEDIA_DIR, name)).catch(() => null)
      if (info) entries.push({ name, at: info.mtimeMs })
    }
    entries.sort((a, b) => b.at - a.at)
    for (const entry of entries.slice(MEDIA_KEEP)) {
      await rm(join(MEDIA_DIR, entry.name), { force: true }).catch(() => {})
    }
  } catch {
    /* Nothing cached yet. */
  }
}

/**
 * Produce one decrypted, playable MP4 for an episode and return its path.
 * The content key stays in this process; the page only ever sees this Host's URL.
 */
async function ensureMedia(episodeId) {
  if (!/^[0-9]{1,32}$/.test(String(episodeId))) throw new Error('bad episode id')
  const file = join(MEDIA_DIR, episodeId + '.mp4')
  const existing = await stat(file).catch(() => null)
  if (existing && existing.size > 1024) return file

  return cached('media:' + episodeId, 30 * 60 * 1000, async () => {
    await mkdir(MEDIA_DIR, { recursive: true })
    const { playback, contentKey } = await resolvePlaybackModel(episodeId)
    const stream = pickStream(playback.streams, '360p')
    const response = await fetch(stream.url, {
      headers: { 'user-agent': MOBILE_UA },
      signal: AbortSignal.timeout(90000),
    })
    if (!response.ok) throw new Error('media fetch answered ' + response.status)
    const raw = Buffer.from(await response.arrayBuffer())

    let output = raw
    if (playback.protected) {
      if (!contentKey?.key) {
        throw new Error('content key unavailable: ' + (contentKey?.error?.code ?? 'unknown'))
      }
      output = decryptInPlace(raw, contentKey.key).buffer
    }

    const temp = file + '.part'
    await writeFile(temp, output)
    await rename(temp, file)
    pruneMedia().catch(() => {})
    return file
  })
}

/** Every episode of a series, with the ids the player needs. */
async function loadEpisodes(seriesId) {
  if (!/^[0-9]{1,32}$/.test(String(seriesId))) throw new Error('bad series id')
  const client = await sdk()
  const page = await client.listEpisodes(seriesId)
  const items = (page.items ?? []).map((episode, index) => ({
    index: index + 1,
    id: String(episode.id),
    title: episode.title || '第 ' + (index + 1) + ' 集',
    duration: Number(episode.duration ?? 0),
  }))
  return { items, total: items.length }
}

async function route(request, response) {
  const url = new URL(request.url ?? ROUTE, 'http://localhost')
  const path = url.pathname.slice(ROUTE.length)
  try {
    if (path === '/home') {
      return sendJson(response, 200, await cached('home', TTL.rank, loadHome))
    }
    if (path === '/search') {
      const query = (url.searchParams.get('q') ?? '').trim()
      if (query === '') return sendJson(response, 200, { items: [], hasMore: false, total: 0 })
      const page = Math.max(Number(url.searchParams.get('page') ?? 1) || 1, 1)
      return sendJson(
        response,
        200,
        await cached('search:' + query + ':' + page, TTL.search, () => loadSearch(query, page)),
      )
    }
    if (path === '/detail') {
      const seriesId = url.searchParams.get('series_id') ?? ''
      return sendJson(
        response,
        200,
        await cached('detail:' + seriesId, TTL.detail, () => loadDetail(seriesId)),
      )
    }
    if (path === '/browse') {
      const page = Math.max(Number(url.searchParams.get('page') ?? 1) || 1, 1)
      const type = url.searchParams.get('type') ?? ''
      return sendJson(
        response,
        200,
        await cached('browse:' + type + ':' + page, TTL.list, () => loadBrowse(type, page)),
      )
    }
    if (path === '/rank') {
      const page = Math.max(Number(url.searchParams.get('page') ?? 1) || 1, 1)
      const key = url.searchParams.get('key') ?? ''
      return sendJson(
        response,
        200,
        await cached('rank:' + key + ':' + page, TTL.list, () => loadRank(key, page)),
      )
    }
    if (path === '/playable') {
      const seriesId = url.searchParams.get('series_id') ?? ''
      const count = Math.min(Number(url.searchParams.get('count') ?? 12) || 12, 40)
      return sendJson(
        response,
        200,
        await cached('playable:' + seriesId + ':' + count, TTL.probe, () =>
          probePlayable(seriesId, count),
        ),
      )
    }
    if (path === '/episodes') {
      const seriesId = url.searchParams.get('series_id') ?? url.searchParams.get('seriesId') ?? ''
      return sendJson(
        response,
        200,
        await cached('episodes:' + seriesId, TTL.detail, () => loadEpisodes(seriesId)),
      )
    }
    if (path === '/media') {
      const episodeId = url.searchParams.get('episode_id') ?? url.searchParams.get('episodeId') ?? ''
      const file = await ensureMedia(episodeId)
      const info = await stat(file)
      const range = request.headers.range
      const headers = {
        'content-type': 'video/mp4',
        'accept-ranges': 'bytes',
        'cache-control': 'private, max-age=3600',
      }
      if (range) {
        const match = /bytes=(\d*)-(\d*)/.exec(range)
        const start = match && match[1] ? Number(match[1]) : 0
        const end = match && match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1
        if (start > end || start >= info.size) {
          response.writeHead(416, { 'content-range': 'bytes */' + info.size })
          response.end()
          return
        }
        response.writeHead(206, {
          ...headers,
          'content-length': end - start + 1,
          'content-range': 'bytes ' + start + '-' + end + '/' + info.size,
        })
        createReadStream(file, { start, end }).pipe(response)
        return
      }
      response.writeHead(200, { ...headers, 'content-length': info.size })
      createReadStream(file).pipe(response)
      return
    }
    return sendJson(response, 404, { error: 'unknown endpoint ' + path })
  } catch (error) {
    return sendJson(response, 502, { error: String(error?.message ?? error) })
  }
}

export function apply(ctx) {
  ctx.effect(() =>
    ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler: route }),
  )
}
