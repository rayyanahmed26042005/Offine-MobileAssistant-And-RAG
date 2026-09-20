
// chat/utils/rag/embedder.ts

import { initLlama, LlamaContext } from 'llama.rn';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';

const MODELS_DIR = RNFS.ExternalDirectoryPath + '/models';
// Use profileManager key generation for embedding model
import { profileKey } from '../profileManager';

let embeddingContexts: Record<string, LlamaContext> = {};

/**
 * Initialize the embedding model context.
 * Call this once before embedding anything.
 */
export async function initEmbeddingModel(profileId: string): Promise<void> {
    if (embeddingContexts[profileId]) return; // already initialized

    let modelId = await AsyncStorage.getItem(profileKey(profileId, '_embedding_model'));
    if (!modelId) {
        modelId = 'all-minilm-l6-v2-q4_k_m';
        await AsyncStorage.setItem(profileKey(profileId, '_embedding_model'), modelId);
    }

    const modelPath = `${MODELS_DIR}/${modelId}.gguf`;
    const exists = await RNFS.exists(modelPath);
    if (!exists) {
        throw new Error(`Embedding model not found at ${modelPath}`);
    }

    // Bug #1 fix: assign to embeddingContexts[profileId] instead of undefined variable
    embeddingContexts[profileId] = await initLlama({
        model: `file://${modelPath}`,
        n_ctx: 512,
        n_gpu_layers: 0,
        n_threads: 4,
        embedding: true, // ← key flag for embedding mode
    });
}

/**
 * Release the embedding context (call on cleanup).
 */
export async function releaseEmbeddingModel(profileId: string): Promise<void> {
    if (embeddingContexts[profileId]) {
        await embeddingContexts[profileId]!.release();
        delete embeddingContexts[profileId];
    }
}

/**
 * Embed a single string into a Float32Array vector.
 */
export async function embedText(text: string, profileId: string): Promise<Float32Array> {
    if (!embeddingContexts[profileId]) {
        await initEmbeddingModel(profileId);
    }

    const result = await embeddingContexts[profileId]!.embedding(text);

    // Bug #2 fix: llama.rn's NativeEmbeddingResult has an `embedding` field (number[])
    // Handle both possible shapes from different llama.rn versions
    const values: number[] = Array.isArray(result)
        ? result
        : (result as any).embedding ?? (result as any).values ?? [];

    return new Float32Array(values);
}

/**
 * Embed multiple texts in sequence.
 * Returns array of Float32Array vectors in same order as input.
 */
export async function embedBatch(
    texts: string[],
    profileId: string,
    onProgress?: (done: number, total: number) => void
): Promise<Float32Array[]> {
    const vectors: Float32Array[] = [];

    for (let i = 0; i < texts.length; i++) {
        const vec = await embedText(texts[i], profileId);
        vectors.push(vec);
        if (onProgress) onProgress(i + 1, texts.length);
    }

    return vectors;
}