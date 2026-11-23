import { createHash } from 'node:crypto';
import { ByteReader } from './byte-reader.ts';

// Independent metadata reader. Format references: docs/offline-resource-index.md.
// Only the observed inline-node EVB layout is supported; no PE loading/execution.
interface NodeBase {
  id: number;
  name: string;
  pathParts: string[];
  nodeOffset: number;
  metadataBytes: number;
  childCount: number;
  unsafeName: boolean;
}
export interface EvbDirectory extends NodeBase { kind: 'root' | 'folder' }
export interface EvbFile extends NodeBase {
  kind: 'file';
  payloadOffset: number;
  originalBytes: number;
  storedBytes: number;
  requiresDecompression: boolean;
}
export type EvbNode = EvbDirectory | EvbFile;
export interface EvbIndex {
  schemaVersion: 1;
  layout: 'evb-inline-node-payload';
  source: { path: string; bytes: number; mtimeMs: number };
  metadataSha256: string;
  nodes: EvbNode[];
  fileCount: number;
  payloadsDecoded: false;
  treeEnd: number;
  trailer: { bytes: number; prefixHex: string; interpreted: false };
  warnings: string[];
}
interface FolderFrame { pathParts: string[]; remaining: number }
const MAX_NODES = 100000;
const MAX_DEPTH = 64;
const MAX_METADATA_BYTES = 65536;
const FILE_OPTIONAL_BYTES = 49;

function unsafeComponent(name: string): boolean {
  if (name === '.' || name === '..' || name.includes('/') ||
      name.includes(String.fromCharCode(92)) || name.includes(':')) return true;
  for (const character of name) {
    if (character.charCodeAt(0) < 32) return true;
  }
  return false;
}

export async function indexInlineEvb(file: string): Promise<EvbIndex> {
  const reader = await ByteReader.open(file);
  try {
    const signature = await reader.read(0, 64);
    if (signature.toString('hex', 0, 4) !== '45564200') {
      throw new Error('Expected external EVB package, not an executable: ' + reader.source);
    }
    const digest = createHash('sha256');
    digest.update(signature);
    const nodes: EvbNode[] = [];
    const stack: FolderFrame[] = [];
    const warnings: string[] = [];
    const paths = new Set<string>();
    let cursor = 64;
    let fileCount = 0;

    while (true) {
      if (nodes.length > 0) {
        while (stack.length > 0 && stack[stack.length - 1].remaining === 0) stack.pop();
        if (stack.length === 0) break;
      }
      if (nodes.length >= MAX_NODES) throw new Error('EVB node limit exceeded');
      if (cursor + 16 > reader.size) throw new Error('EVB directory is truncated');
      const head = await reader.read(cursor, 16);
      const metadataBytes = head.readUInt32LE(0) + 4;
      const childCount = head.readUInt32LE(12);
      if (metadataBytes < 19 || metadataBytes > MAX_METADATA_BYTES ||
          cursor + metadataBytes > reader.size || childCount > MAX_NODES) {
        throw new Error('Unsupported EVB metadata extent/count at ' + cursor);
      }
      const metadata = await reader.read(cursor, metadataBytes);
      digest.update(metadata);
      let nameEnd = 16;
      while (nameEnd + 2 <= metadata.length && metadata.readUInt16LE(nameEnd) !== 0) {
        nameEnd += 2;
        if (nameEnd - 16 > 8192) throw new Error('EVB name length limit exceeded');
      }
      if (nameEnd + 3 > metadata.length) throw new Error('Unterminated EVB node name');
      const name = new TextDecoder('utf-16le', { fatal: true, ignoreBOM: true })
        .decode(metadata.subarray(16, nameEnd));
      const type = metadata[nameEnd + 2];
      const parent = stack[stack.length - 1];
      if (parent) {
        if (parent.remaining <= 0) throw new Error('EVB parent count is inconsistent');
        parent.remaining -= 1;
      }
      const pathParts = [...(parent?.pathParts ?? []), ...(name ? [name] : [])];
      const base: NodeBase = {
        id: nodes.length, name, pathParts, nodeOffset: cursor, metadataBytes,
        childCount, unsafeName: pathParts.some(unsafeComponent),
      };
      let node: EvbNode;
      if (type === 0 || type === 3) {
        if (type === 0 && (nodes.length !== 0 || metadataBytes !== 19 || name !== '')) {
          throw new Error('Only the empty inline EVB root layout is supported');
        }
        if (type === 3 && !parent) throw new Error('EVB folder has no root');
        if (stack.length >= MAX_DEPTH) throw new Error('EVB directory depth limit exceeded');
        node = { ...base, kind: type === 0 ? 'root' : 'folder' };
        stack.push({ pathParts, remaining: childCount });
        cursor += metadataBytes;
      } else if (type === 2) {
        if (!parent || name === '' || childCount !== 0) {
          throw new Error('Invalid inline EVB file node at ' + cursor);
        }
        const optional = metadataBytes - FILE_OPTIONAL_BYTES;
        if (optional < nameEnd + 3) throw new Error('EVB file metadata is too short');
        const originalBytes = metadata.readUInt32LE(optional + 2);
        const storedBytes = metadata.readUInt32LE(optional + 41);
        const payloadOffset = cursor + metadataBytes;
        if (payloadOffset + storedBytes > reader.size) {
          throw new Error('EVB payload exceeds package bounds at ' + cursor);
        }
        node = {
          ...base, kind: 'file', payloadOffset, originalBytes, storedBytes,
          requiresDecompression: originalBytes !== storedBytes,
        };
        cursor = payloadOffset + storedBytes;
        fileCount += 1;
      } else {
        throw new Error('Unknown EVB node type ' + type + ' at ' + cursor);
      }
      const key = pathParts.join('/').toLowerCase();
      if (node.kind !== 'root' && paths.has(key)) warnings.push('Duplicate case-folded path: ' + key);
      paths.add(key);
      if (base.unsafeName) warnings.push('Unsafe path component at node ' + base.id);
      nodes.push(node);
    }
    const trailerBytes = reader.size - cursor;
    const prefix = await reader.read(cursor, Math.min(32, trailerBytes));
    if (trailerBytes > 0) warnings.push('Uninterpreted EVB trailer: ' + trailerBytes + ' bytes');
    await reader.requireUnchanged();
    return {
      schemaVersion: 1, layout: 'evb-inline-node-payload',
      source: { path: reader.source, bytes: reader.size, mtimeMs: reader.mtimeMs },
      metadataSha256: digest.digest('hex'), nodes, fileCount, payloadsDecoded: false,
      treeEnd: cursor,
      trailer: { bytes: trailerBytes, prefixHex: prefix.toString('hex'), interpreted: false },
      warnings,
    };
  } finally {
    await reader.close();
  }
}
