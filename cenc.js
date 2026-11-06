/**
 * Minimal CENC (cenc-aes-ctr) un-wrapper for Hongguo episodes.
 *
 * Hongguo ships faststart MP4s whose video entry is `encv` and audio entry is `enca`,
 * each with its own `senc` and content key. Decryption happens in place; afterwards the
 * entry types are flipped to `hvc1`/`mp4a` so a decoder reads `hvcC`/`esds` and ignores
 * the leftover `sinf`. No box is resized, so the byte layout stays as the site shipped it.
 */
import { createCipheriv } from 'node:crypto'

const CONTAINERS = new Set([
  'moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'mvex', 'moof', 'traf',
  'sinf', 'schi',
])

/** Fixed prefix inside a sample entry before its child boxes begin. */
const SAMPLE_ENTRY_PREFIX = { visual: 78, audio: 28 }

function parseBoxes(buf, start, end, depth = 0) {
  const out = []
  let off = start
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off)
    const type = buf.toString('latin1', off + 4, off + 8)
    let header = 8
    if (size === 1) {
      if (off + 16 > end) break
      size = Number(buf.readBigUInt64BE(off + 8))
      header = 16
    } else if (size === 0) {
      size = end - off
    }
    if (size < header || off + size > end) break
    const box = { type, start: off, size, header, end: off + size, children: null }
    if (CONTAINERS.has(type) && depth < 10) {
      box.children = parseBoxes(buf, off + header, off + size, depth + 1)
    }
    out.push(box)
    off += size
  }
  return out
}

function findAll(boxes, type, acc = []) {
  for (const box of boxes) {
    if (!box) continue
    if (box.type === type) acc.push(box)
    if (box.children) findAll(box.children, type, acc)
  }
  return acc
}

/** AES-128-CTR over one range; the 16-byte counter advances one block per 16 bytes. */
function xorRange(data, key, counter) {
  const total = data.length
  if (total === 0) return
  const blocks = Math.ceil(total / 16)
  const ctrs = Buffer.alloc(blocks * 16)
  const c = Buffer.from(counter)
  for (let i = 0; i < blocks; i += 1) {
    c.copy(ctrs, i * 16)
    for (let j = 15; j >= 0; j -= 1) {
      c[j] = (c[j] + 1) & 0xff
      if (c[j] !== 0) break
    }
  }
  const cipher = createCipheriv('aes-128-ecb', key, null)
  cipher.setAutoPadding(false)
  const ks = Buffer.concat([cipher.update(ctrs), cipher.final()])
  for (let i = 0; i < total; i += 1) data[i] ^= ks[i]
  c.copy(counter, 0)
}

function readTencIvSize(buf, tenc) {
  const version = buf.readUInt8(tenc.start + tenc.header)
  // The header carries a 16-bit reserved field before isProtected/IV size.
  const ivAt = tenc.start + tenc.header + (version === 0 ? 7 : 8)
  return buf.readUInt8(ivAt)
}

function readSenc(buf, box, ivSize) {
  const versionAndFlags = buf.readUInt32BE(box.start + box.header)
  let off = box.start + box.header + 4
  const count = buf.readUInt32BE(off)
  off += 4
  const hasSubs = (versionAndFlags & 0x000002) !== 0
  const samples = []
  for (let i = 0; i < count; i += 1) {
    const iv = Buffer.from(buf.subarray(off, off + ivSize))
    off += ivSize
    let subs = null
    if (hasSubs) {
      const n = buf.readUInt16BE(off)
      off += 2
      subs = []
      for (let s = 0; s < n; s += 1) {
        subs.push({ clear: buf.readUInt16BE(off), prot: buf.readUInt32BE(off + 2) })
        off += 6
      }
    }
    samples.push({ iv, subs })
  }
  return samples
}

function readSizes(buf, stsz) {
  const off = stsz.start + stsz.header + 4
  const uniform = buf.readUInt32BE(off)
  const count = buf.readUInt32BE(off + 4)
  const sizes = []
  for (let i = 0; i < count; i += 1) {
    sizes.push(uniform !== 0 ? uniform : buf.readUInt32BE(off + 8 + i * 4))
  }
  return sizes
}

function readChunks(buf, box) {
  const off = box.start + box.header + 4
  const n = buf.readUInt32BE(off)
  const chunks = []
  const wide = box.type === 'co64'
  for (let i = 0; i < n; i += 1) {
    chunks.push(wide ? Number(buf.readBigUInt64BE(off + 4 + i * 8)) : buf.readUInt32BE(off + 4 + i * 4))
  }
  return chunks
}

function readRuns(buf, stsc) {
  const off = stsc.start + stsc.header + 4
  const n = buf.readUInt32BE(off)
  const runs = []
  for (let i = 0; i < n; i += 1) {
    runs.push({ firstChunk: buf.readUInt32BE(off + 4 + i * 12), perChunk: buf.readUInt32BE(off + 8 + i * 12) })
  }
  return runs
}

function sampleOffsets(chunks, runs, sizes) {
  const offsets = []
  let sample = 0
  for (let ci = 0; ci < chunks.length; ci += 1) {
    const chunkNo = ci + 1
    let perChunk = 0
    for (const run of runs) if (run.firstChunk <= chunkNo) perChunk = run.perChunk
    let cursor = chunks[ci]
    for (let k = 0; k < perChunk; k += 1) {
      if (sample >= sizes.length) break
      offsets.push({ at: cursor, size: sizes[sample] })
      cursor += sizes[sample]
      sample += 1
    }
  }
  return offsets
}

/**
 * Decrypt every encrypted track in place.
 * `keyHex` is the CENC content key the SDK resolved for this episode.
 */
export function decryptInPlace(input, keyHex) {
  const buf = Buffer.from(input)
  const top = parseBoxes(buf, 0, buf.length)
  const moov = top.find((b) => b.type === 'moov')
  if (!moov) throw new Error('no moov box')

  const key = Buffer.from(keyHex, 'hex')
  const tracks = []
  let changed = false

  for (const trak of findAll(moov.children, 'trak')) {
    const stbl = findAll([trak], 'stbl')[0]
    if (!stbl) continue
    const stsd = findAll([stbl], 'stsd')[0]
    if (!stsd) continue

    const entryStart = stsd.start + stsd.header + 8
    const entrySize = buf.readUInt32BE(entryStart)
    const entryType = buf.toString('latin1', entryStart + 4, entryStart + 8)
    if (entryType !== 'encv' && entryType !== 'enca') continue

    const kind = entryType === 'encv' ? 'visual' : 'audio'
    const childStart = entryStart + 8 + SAMPLE_ENTRY_PREFIX[kind]
    const entryChildren = parseBoxes(buf, childStart, entryStart + entrySize)
    const tenc = findAll(entryChildren, 'tenc')[0] ?? findAll([trak], 'tenc')[0]
    const senc = findAll([trak], 'senc')[0]
    if (!tenc || !senc) throw new Error(`${entryType} without tenc/senc`)

    const ivSize = readTencIvSize(buf, tenc)
    const samples = readSenc(buf, senc, ivSize)
    const sizes = readSizes(buf, findAll([stbl], 'stsz')[0])
    const stco = findAll([stbl], 'stco')[0]
    const co64 = findAll([stbl], 'co64')[0]
    const offsets = sampleOffsets(
      readChunks(buf, stco ?? co64),
      readRuns(buf, findAll([stbl], 'stsc')[0]),
      sizes,
    )

    let decrypted = 0
    const pairs = Math.min(offsets.length, samples.length)
    for (let i = 0; i < pairs; i += 1) {
      const { at, size } = offsets[i]
      const { iv, subs } = samples[i]
      // This service builds the CTR block with the per-sample IV in the high bytes.
      const counter = Buffer.alloc(16)
      iv.copy(counter, 0)
      if (subs && subs.length) {
        let cursor = at
        for (const { clear, prot } of subs) {
          cursor += clear
          xorRange(buf.subarray(cursor, cursor + prot), key, counter)
          cursor += prot
        }
      } else {
        xorRange(buf.subarray(at, at + size), key, counter)
      }
      decrypted += 1
    }

    buf.write(kind === 'visual' ? 'hvc1' : 'mp4a', entryStart + 4, 'latin1')
    tracks.push({ kind, ivSize, samples: decrypted, expected: offsets.length })
    changed = true
  }

  if (!changed) throw new Error('no encrypted track found')
  return { buffer: buf, report: { tracks } }
}
