import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { randomUUID } from 'crypto';
import { resolveNexusStateDir } from './runtime-registry.js';

export interface RagCollectionSource {
    sourceId: string;
    kind: 'file' | 'url' | 'text';
    label: string;
    location?: string;
    addedAt: number;
    bytes: number;
}

export interface RagChunk {
    chunkId: string;
    sourceId: string;
    text: string;
    tokens: number;
    tags: string[];
    score?: number;
}

export interface RagCollection {
    collectionId: string;
    name: string;
    description?: string;
    createdAt: number;
    updatedAt: number;
    tags: string[];
    scope: 'session' | 'project';
    attachedRuntimeIds: string[];
    attachedSessionIds: string[];
    sources: RagCollectionSource[];
    chunks: RagChunk[];
}

export interface RagCollectionSummary {
    collectionId: string;
    name: string;
    description?: string;
    createdAt: number;
    updatedAt: number;
    tags: string[];
    scope: 'session' | 'project';
    attachedRuntimeIds: string[];
    attachedSessionIds: string[];
    sourceCount: number;
    chunkCount: number;
}

export interface RagCollectionInput {
    name: string;
    description?: string;
    tags?: string[];
    scope?: 'session' | 'project';
}

export interface RagIngestInput {
    filePath?: string;
    url?: string;
    text?: string;
    label?: string;
    tags?: string[];
}

export interface RagRetrievalHit {
    collectionId: string;
    collectionName: string;
    chunkId: string;
    sourceId: string;
    label: string;
    text: string;
    tokens: number;
    tags: string[];
    score: number;
}

const MAX_CHUNK_CHARS = 1200;
const DEFAULT_REMOTE_FETCH_TIMEOUT_MS = 15_000;
const COLLECTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface RagCollectionStoreOptions {
    requestTimeoutMs?: number;
}

export class RagCollectionStore {
    private readonly rootDir: string;
    private readonly requestTimeoutMs: number;

    constructor(stateRoot: string = resolveNexusStateDir(), options: RagCollectionStoreOptions = {}) {
        this.rootDir = path.join(stateRoot, 'rag-collections');
        this.requestTimeoutMs = Math.max(100, options.requestTimeoutMs ?? DEFAULT_REMOTE_FETCH_TIMEOUT_MS);
        fs.mkdirSync(this.rootDir, { recursive: true });
    }

    listCollections(): RagCollectionSummary[] {
        return fs.readdirSync(this.rootDir)
            .filter((entry) => entry.endsWith('.json'))
            .map((entry) => this.getCollection(entry.replace(/\.json$/, '')))
            .filter((collection): collection is RagCollection => Boolean(collection))
            .map((collection) => this.toSummary(collection))
            .sort((left, right) => right.updatedAt - left.updatedAt);
    }

    getCollection(collectionId: string): RagCollection | undefined {
        const target = this.collectionPath(collectionId);
        if (!target) return undefined;
        if (!fs.existsSync(target)) return undefined;
        try {
            const parsed = JSON.parse(fs.readFileSync(target, 'utf8')) as RagCollection;
            return {
                ...parsed,
                tags: parsed.tags ?? [],
                attachedRuntimeIds: parsed.attachedRuntimeIds ?? [],
                attachedSessionIds: parsed.attachedSessionIds ?? [],
                sources: parsed.sources ?? [],
                chunks: parsed.chunks ?? [],
            };
        } catch {
            return undefined;
        }
    }

    createCollection(input: RagCollectionInput): RagCollection {
        const now = Date.now();
        const collection: RagCollection = {
            collectionId: `rag_${randomUUID().slice(0, 8)}`,
            name: input.name.trim(),
            description: input.description?.trim(),
            createdAt: now,
            updatedAt: now,
            tags: dedupeStrings(input.tags ?? []),
            scope: input.scope ?? 'session',
            attachedRuntimeIds: [],
            attachedSessionIds: [],
            sources: [],
            chunks: [],
        };
        this.persist(collection);
        return collection;
    }

    async ingestCollection(collectionId: string, inputs: RagIngestInput[]): Promise<{ collection: RagCollection; sourcesAdded: number; chunksAdded: number }> {
        const collection = this.getRequiredCollection(collectionId);
        let sourcesAdded = 0;
        let chunksAdded = 0;

        for (const input of inputs) {
            const content = await this.readInputContent(input);
            if (!content.trim()) continue;
            const sourceId = `src_${randomUUID().slice(0, 8)}`;
            const source: RagCollectionSource = {
                sourceId,
                kind: input.filePath ? 'file' : input.url ? 'url' : 'text',
                label: input.label?.trim() || input.filePath || input.url || `note-${collection.sources.length + 1}`,
                location: input.filePath || input.url,
                addedAt: Date.now(),
                bytes: Buffer.byteLength(content, 'utf8'),
            };
            const chunks = chunkText(content, sourceId, dedupeStrings(input.tags ?? collection.tags));
            collection.sources.push(source);
            collection.chunks.push(...chunks);
            sourcesAdded += 1;
            chunksAdded += chunks.length;
        }

        collection.updatedAt = Date.now();
        this.persist(collection);
        return { collection, sourcesAdded, chunksAdded };
    }

    attachCollection(collectionId: string, runtimeId: string, sessionId?: string): RagCollection {
        const collection = this.getRequiredCollection(collectionId);
        collection.attachedRuntimeIds = dedupeStrings([...collection.attachedRuntimeIds, runtimeId]);
        if (sessionId) {
            collection.attachedSessionIds = dedupeStrings([...collection.attachedSessionIds, sessionId]);
        }
        collection.updatedAt = Date.now();
        this.persist(collection);
        return collection;
    }

    detachCollection(collectionId: string, runtimeId?: string, sessionId?: string): RagCollection {
        const collection = this.getRequiredCollection(collectionId);
        if (runtimeId) {
            collection.attachedRuntimeIds = collection.attachedRuntimeIds.filter((entry) => entry !== runtimeId);
        }
        if (sessionId) {
            collection.attachedSessionIds = collection.attachedSessionIds.filter((entry) => entry !== sessionId);
        }
        collection.updatedAt = Date.now();
        this.persist(collection);
        return collection;
    }

    deleteCollection(collectionId: string): boolean {
        const target = this.collectionPath(collectionId);
        if (!target) return false;
        if (!fs.existsSync(target)) return false;
        fs.unlinkSync(target);
        return true;
    }

    retrieve(query: string, options: { runtimeId?: string; sessionId?: string; limit?: number; collectionIds?: string[] } = {}): RagRetrievalHit[] {
        const limit = Math.max(1, Math.min(20, options.limit ?? 6));
        const keywords = extractKeywords(query);
        const collections = options.collectionIds?.length
            ? options.collectionIds.map((collectionId) => this.getCollection(collectionId)).filter((collection): collection is RagCollection => Boolean(collection))
            : this.listCollections()
                .map((summary) => this.getCollection(summary.collectionId))
                .filter((collection): collection is RagCollection => Boolean(collection))
                .filter((collection) => {
                    if (options.runtimeId && collection.attachedRuntimeIds.includes(options.runtimeId)) return true;
                    if (options.sessionId && collection.attachedSessionIds.includes(options.sessionId)) return true;
                    return !options.runtimeId && !options.sessionId;
                });

        return collections
            .flatMap((collection) => collection.chunks.map((chunk) => {
                const source = collection.sources.find((entry) => entry.sourceId === chunk.sourceId);
                const score = scoreText(chunk.text, keywords) + scoreText(source?.label ?? '', keywords);
                return {
                    collectionId: collection.collectionId,
                    collectionName: collection.name,
                    chunkId: chunk.chunkId,
                    sourceId: chunk.sourceId,
                    label: source?.label ?? chunk.chunkId,
                    text: chunk.text,
                    tokens: chunk.tokens,
                    tags: chunk.tags,
                    score,
                } satisfies RagRetrievalHit;
            }))
            .filter((hit) => hit.score > 0)
            .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
            .slice(0, limit);
    }

    private getRequiredCollection(collectionId: string): RagCollection {
        const collection = this.getCollection(collectionId);
        if (!collection) {
            throw new Error(`RAG collection not found: ${collectionId}`);
        }
        return collection;
    }

    private toSummary(collection: RagCollection): RagCollectionSummary {
        return {
            collectionId: collection.collectionId,
            name: collection.name,
            description: collection.description,
            createdAt: collection.createdAt,
            updatedAt: collection.updatedAt,
            tags: collection.tags,
            scope: collection.scope,
            attachedRuntimeIds: collection.attachedRuntimeIds,
            attachedSessionIds: collection.attachedSessionIds,
            sourceCount: collection.sources.length,
            chunkCount: collection.chunks.length,
        };
    }

    private persist(collection: RagCollection): void {
        fs.writeFileSync(this.collectionPath(collection.collectionId, true), JSON.stringify(collection, null, 2), 'utf8');
    }

    private collectionPath(collectionId: string, strict: boolean = false): string | undefined {
        const sanitizedCollectionId = this.sanitizeCollectionId(collectionId);
        if (!sanitizedCollectionId) {
            if (strict) {
                throw new Error(`Invalid RAG collection id: ${collectionId}`);
            }
            return undefined;
        }
        return path.join(this.rootDir, `${sanitizedCollectionId}.json`);
    }

    private sanitizeCollectionId(collectionId: string): string | undefined {
        const normalized = String(collectionId || '').trim();
        if (!COLLECTION_ID_PATTERN.test(normalized)) return undefined;
        return normalized;
    }

    private async readInputContent(input: RagIngestInput): Promise<string> {
        if (input.text) return String(input.text);
        if (input.filePath) {
            return fs.readFileSync(path.resolve(input.filePath), 'utf8');
        }
        if (input.url) {
            return fetchText(input.url, this.requestTimeoutMs);
        }
        return '';
    }
}

function dedupeStrings(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function chunkText(content: string, sourceId: string, tags: string[]): RagChunk[] {
    const normalized = content.replace(/\r\n/g, '\n').trim();
    if (!normalized) return [];

    const paragraphs = normalized.split(/\n{2,}/).map((segment) => segment.trim()).filter(Boolean);
    const chunks: RagChunk[] = [];
    let current = '';

    const flush = () => {
        const text = current.trim();
        if (!text) return;
        chunks.push({
            chunkId: `chunk_${randomUUID().slice(0, 8)}`,
            sourceId,
            text,
            tokens: estimateTokens(text),
            tags,
        });
        current = '';
    };

    for (const paragraph of paragraphs) {
        const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
        if (candidate.length <= MAX_CHUNK_CHARS) {
            current = candidate;
            continue;
        }
        flush();
        if (paragraph.length <= MAX_CHUNK_CHARS) {
            current = paragraph;
            continue;
        }
        for (let index = 0; index < paragraph.length; index += MAX_CHUNK_CHARS) {
            const slice = paragraph.slice(index, index + MAX_CHUNK_CHARS).trim();
            if (!slice) continue;
            chunks.push({
                chunkId: `chunk_${randomUUID().slice(0, 8)}`,
                sourceId,
                text: slice,
                tokens: estimateTokens(slice),
                tags,
            });
        }
    }
    flush();
    return chunks;
}

function fetchText(targetUrl: string, timeoutMs: number): Promise<string> {
    const url = new URL(targetUrl);
    const transport = url.protocol === 'https:' ? https : http;
    return new Promise<string>((resolve, reject) => {
        let settled = false;
        const finish = (handler: () => void) => {
            if (settled) return;
            settled = true;
            handler();
        };
        const req = transport.get(url, (res) => {
            const chunks: Buffer[] = [];
            res.on('aborted', () => finish(() => reject(new Error(`Remote RAG fetch aborted for ${targetUrl}`))));
            res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            res.on('end', () => {
                finish(() => resolve(Buffer.concat(chunks).toString('utf8')));
            });
            res.on('error', (error) => finish(() => reject(error)));
        });
        req.setTimeout(timeoutMs, () => {
            const error = new Error(`Timed out fetching RAG URL after ${timeoutMs}ms: ${targetUrl}`);
            finish(() => {
                req.destroy(error);
                reject(error);
            });
        });
        req.on('error', (error) => finish(() => reject(error)));
    });
}

function extractKeywords(value: string): string[] {
    return String(value || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3);
}

function scoreText(value: string, keywords: string[]): number {
    const lower = String(value || '').toLowerCase();
    return keywords.reduce((sum, keyword) => sum + (lower.includes(keyword) ? 3 : 0), 0);
}

function estimateTokens(value: string): number {
    return Math.max(1, Math.ceil(String(value || '').length / 4));
}
