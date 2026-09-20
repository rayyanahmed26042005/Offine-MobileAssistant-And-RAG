# 🎯 Porting LLM to Mobile (Sundae) — Complete Interview Guide

> **A comprehensive preparation resource to confidently ace any technical interview about this project.**
> This guide covers the entire system: offline mobile architecture, local LLM runtimes (`llama.rn`), custom client-side RAG pipeline, custom Kotlin Native Modules, profile data security, and key architectural trade-offs.

---

## Table of Contents

1. [Project Overview & Elevator Pitch](#1-project-overview--elevator-pitch)
2. [High-Level System Architecture](#2-high-level-system-architecture)
3. [Technology Stack & Core Libraries](#3-technology-stack--core-libraries)
4. [Offline RAG Pipeline Deep Dive](#4-offline-rag-pipeline-deep-dive)
   - Chunker Strategy
   - Embedding Layer & Memory Controls
   - Custom Local Vector Store
   - Cosine Similarity & Threshold Filtering
5. [Native Android Integration (Kotlin)](#5-native-android-integration-kotlin)
   - Alarm Module (`RTNMyAlarm`)
   - Direct Calling (`DirectCall`)
   - Contacts Fetching (`ContactModule`)
   - App Launcher (`AppLauncherModule`)
6. [Offline Data Security & Profile Isolation](#6-offline-data-security--profile-isolation)
7. [Key Design Trade-offs & Bug Fixes](#7-key-design-trade-offs--bug-fixes)
8. [Comprehensive Q&A Bank (50+ Questions)](#8-comprehensive-qa-bank)

---

## 1. Project Overview & Elevator Pitch

### What is Sundae?
**Sundae** is a fully offline, private AI-powered personal assistant app built for Android and iOS using **React Native**. It brings Large Language Models (LLMs) to consumer devices, allowing users to talk to a local chatbot, index and query personal documents (using a custom Retrieval-Augmented Generation pipeline), and trigger mobile device actions (alarms, phone calls, app launching, calendar events) — **all with zero internet access**.

### The Core Value Proposition
- **100% Privacy**: All computations (inference, embeddings, vector search, database management) happen on-device. No data ever leaves the phone.
- **Zero-Latency Availability**: Works in airplane mode, remote locations, or under poor network conditions.
- **Device Agency**: Integrates with Android/iOS native APIs, enabling the LLM to control the phone (e.g. setting an alarm at a specific time, dialling a contact) through natural language parsing.
- **Personal Knowledge base**: Allows users to upload custom `.txt` or `.pdf` files, which are processed, embedded, and queried locally to feed contextual data to the chatbot.

---

## 2. High-Level System Architecture

Sundae consists of three main layers: **React Native (JS/TS Thread)**, **Local C++ AI Runtimes (bridged via JNI/ObjC)**, and **Native Platform APIs (Kotlin/Swift)**.

```
┌────────────────────────────────────────────────────────────────────────┐
│                          SUNDAE UI (React Native)                      │
│         Chat Screen  │  Documents Screen  │  Profile Selector          │
└───────────────────────────┬──────────────────┬─────────────────────────┘
                            │                  │
           User Prompt / File                  │ Profile Change / PIN
                            ▼                  ▼
┌──────────────────────────────────────┐ ┌───────────────────────────────┐
│         BUSINESS LOGIC (JS/TS)       │ │     PROFILE MANAGER (TS)      │
│  ┌────────────────────────────────┐  │ │  - Profile isolation storage │
│  │       Task Router (Regex)      │  │ │  - PIN verification (djb2)  │
│  └──────┬──────────────────┬──────┘  │ │  - Cache flusher             │
│         │ (Action)         │ (QA)    │ └───────────────────────────────┘
│         ▼                  ▼         │
│  ┌──────────────┐   ┌──────────────┐ │
│  │ Native Tasks │   │  QA Handler  │ │
│  └──────┬───────┘   └──────┬───────┘ │
│         │                  │         │
│         │                  ▼         │
│         │           ┌──────────────┐ │
│         │           │ RAG Pipeline │ │
│         │           │ (Cosine Sim) │ │
│         │           └──────┬───────┘ │
│         │                  │         │
└─────────┼──────────────────┼─────────┘
          │ (JSI Bridge)     │ (Native Bridge via llama.rn)
          ▼                  ▼
┌──────────────────┐ ┌───────────────────────────────────────────────────┐
│  KOTLIN MODULES  │ │              LOCAL AI ENGINE (C++ Core)           │
│  - RTNMyAlarm    │ │  ┌────────────────────────┐┌───────────────────┐  │
│  - DirectCall    │ │  │ Chat Model Context     ││ Embedding Context │  │
│  - ContactModule │ │  │ (TinyLlama GGUF - CPU) ││ (GGUF - CPU)      │  │
│  - AppLauncher   │ │  └────────────────────────┘└───────────────────┘  │
└──────────────────┘ └───────────────────────────────────────────────────┘
```

### Request Lifecycle Flow
1. **Input Submission**: The user sends a text message in the chatbot interface.
2. **Intent Parsing & Task Routing**: `taskRouter.ts` checks the query against custom regex patterns for action-specific keywords (e.g., "set alarm", "call", "open").
3. **Execution Path**:
   - **Action Route**: If an action is detected, the router maps the parameters (e.g., extracting days and time using a structured JSON LLM prompt) and invokes the respective Kotlin Native Module (e.g. `RTNMyAlarm.setAlarm`).
   - **QA Route (with local RAG)**: If it is a normal question, it routes to `qa.ts`. The QA handler queries the local Vector Store using the user's query vector. The top-3 relevant text chunks are extracted, formatted as context, and injected into the LLM prompt.
4. **Local LLM Inference**: The local GGUF model processes the final prompt and streams the response word-by-word back to the React Native UI.

---

## 3. Technology Stack & Core Libraries

- **React Native (v0.73+)**: Cross-platform framework chosen to share the UI layout, state management, and RAG logic between Android and iOS, while maintaining the capacity to call native system modules.
- **llama.rn**: React Native bindings wrapping **llama.cpp** written in C++. It compiles GGUF models directly to run on mobile hardware. It supports hardware acceleration (NEON on ARMv8) and allows running separate contexts for text completion and embeddings.
- **react-native-fs (RNFS)**: Used to perform local file read/write operations (needed to read uploaded documents, create profile directories, and persist vector indexes).
- **@react-native-async-storage/async-storage**: Lightweight key-value store used to hold metadata like active profile IDs, selected model paths, and document lists.

---

## 4. Offline RAG Pipeline Deep Dive

To enable question-answering over custom user documents, Sundae implements a complete, localized RAG pipeline.

### Chunker Strategy (`chunker.ts`)
1. **Normalization**: The raw text file is stripped of consecutive whitespace and newlines (`text.replace(/\s+/g, ' ')`).
2. **Sliding Window**: The text is split by spaces into individual words.
3. **Chunk Configuration**:
   - `CHUNK_SIZE = 100` words per chunk.
   - `CHUNK_OVERLAP = 20` overlapping words between successive chunks.
   - **Minimum Check**: Any tail chunk containing fewer than 10 words is skipped to prevent indexing meaningless fragment lines.
4. **Output**: Returns an array of `Chunk` objects containing `{ text, docId, chunkIndex, docName }`.

### Embedding Layer & Memory Controls (`embedder.ts`)
Converting text into vectors requires loading a GGUF embedding model (e.g. `nomic-embed-text` or `bge-small`) via `llama.rn`.
- **Initialization**:
  ```typescript
  embeddingContexts[profileId] = await initLlama({
      model: `file://${modelPath}`,
      n_ctx: 512,          // 512 token context window
      n_gpu_layers: 0,     // GPU disabled to avoid VRAM crashes on mid-range phones
      n_threads: 4,        // Quad-threaded CPU execution for balance
      embedding: true,     // Critical flag triggering embedding vector extraction
  });
  ```
- **Sequential Batching**: To prevent out-of-memory (OOM) exceptions on mobile devices, embeddings are processed sequentially:
  ```typescript
  for (let i = 0; i < texts.length; i++) {
      const vec = await embedText(texts[i], profileId);
      vectors.push(vec);
  }
  ```
  Instead of launching parallel embedding requests, a simple synchronous loop is used. This linearizes CPU usage and keeps the memory footprint under control.
- **Vector Formatting**: Resolves version differences in `llama.rn` by standardizing the output into a native JavaScript `Float32Array`.

### Custom Local Vector Store (`vectorStore.ts`)
Without heavy third-party C++ libraries like SQLite-VSS or HNSWLib, Sundae persists and queries vectors using a lightweight JSON database:
- **Persistence**: Embeddings (`Float32Array`) are serialized into regular JavaScript arrays (`Array.from(vec)`) and saved alongside text chunks in a profile-specific directory:
  `${RNFS.ExternalDirectoryPath}/profiles/${profileId}/rag_index.json`
- **Deserialization**: Upon loading, the application converts arrays back to `Float32Array` objects to leverage fast TypedArray processing.

### Cosine Similarity & Threshold Filtering (`vectorStore.ts` & `ragPipeline.ts`)
- **Mathematical Calculation**: Since vectors represent directions in high-dimensional space, the similarity is computed as the cosine of the angle between them:
  $$\text{Similarity}(A, B) = \frac{A \cdot B}{\|A\| \|B\|} = \frac{\sum_{i=1}^n A_i B_i}{\sqrt{\sum_{i=1}^n A_i^2} \sqrt{\sum_{i=1}^n B_i^2}}$$
  Implemented in TypeScript as:
  ```typescript
  function cosineSimilarity(a: Float32Array, b: Float32Array): number {
      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < a.length; i++) {
          dot += a[i] * b[i];
          normA += a[i] * a[i];
          normB += b[i] * b[i];
      }
      const denom = Math.sqrt(normA) * Math.sqrt(normB);
      return denom === 0 ? 0 : dot / denom;
  }
  ```
- **Filtering**:
  - **Top-K**: The app extracts the top `3` highest scoring chunks.
  - **Similarity Threshold**: Chunks with a score lower than `0.01` are discarded. This threshold ensures that if the query is unrelated to the indexed documents, the app drops the context injection entirely, allowing the model to fallback to its base parametric knowledge.

---

## 5. Native Android Integration (Kotlin)

Sundae integrates directly with Android native components. In addition to standard bridges, it uses custom packages to handle device actions.

### 1. Alarm Module (`RTNMyAlarm`)
- **Type**: Custom Native Module conforming to the React Native TurboModule specifications.
- **Action**: Binds React Native calls directly to the Android `AlarmClock` system intent.
- **Code Highlights** (`MyAlarmModule.kt`):
  - Validates `hour` (0–23) and `minute` (0–59) values.
  - Converts JS-side day strings to Android day-of-week constants (Sunday = 1, Saturday = 7).
  - Triggers the system intent:
    ```kotlin
    val intent = Intent(AlarmClock.ACTION_SET_ALARM).apply {
        putExtra(AlarmClock.EXTRA_HOUR, hour.toInt())
        putExtra(AlarmClock.EXTRA_MINUTES, minute.toInt())
        putExtra(AlarmClock.EXTRA_MESSAGE, "Wake up")
        putExtra(AlarmClock.EXTRA_DAYS, dayList)
        putExtra(AlarmClock.EXTRA_SKIP_UI, true) // Sets alarm without showing system UI
    }
    intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
    reactApplicationContext.startActivity(intent)
    ```
- **Error Handling**: Rejects with `NO_COMPATIBLE_APP` if the device has no stock clock application installed that handles alarm intents (common on customized ROMs/emulators).

### 2. Direct Calling (`DirectCall`)
- **Action**: Dials a number immediately without opening the dialer UI.
- **Core API**: Launches `Intent.ACTION_CALL`.
- **Permissions**: Requires the dangerous `android.permission.CALL_PHONE` permission.
  ```kotlin
  if (ActivityCompat.checkSelfPermission(reactContext, Manifest.permission.CALL_PHONE)
      == PackageManager.PERMISSION_GRANTED
  ) {
      val intent = Intent(Intent.ACTION_CALL).apply {
          data = Uri.parse("tel:$number")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactContext.startActivity(intent)
  }
  ```

### 3. Contacts Fetching (`ContactModule`)
- **Action**: Pulls names and phone numbers stored on the device.
- **Mechanism**: Queries the Android database using `ContentResolver` on `ContactsContract.CommonDataKinds.Phone.CONTENT_URI`.
  ```kotlin
  val cursor: Cursor? = resolver.query(
      ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
      null, null, null, null
  )
  cursor?.use {
      val nameIndex = it.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
      val numberIndex = it.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
      while (it.moveToNext()) {
          val contact = Arguments.createMap()
          contact.putString("name", it.getString(nameIndex))
          contact.putString("number", it.getString(numberIndex))
          contactList.pushMap(contact)
      }
  }
  ```

### 4. App Launcher (`AppLauncherModule`)
- **Action**: Launches third-party apps by package name (e.g. `"com.whatsapp"`).
- **Logic**:
  - `isAppInstalled`: Calls `pm.getLaunchIntentForPackage(packageName)`. If that returns null, falls back to `pm.getPackageInfo(packageName, 0)`.
  - `launchApp`: Fetches launch intent and calls `startActivity()`.

---

## 6. Offline Data Security & Profile Isolation

A key feature of Sundae is the ability to maintain completely isolated workspaces for different users (profiles) on the same device.

| Storage Component | Isolation Architecture |
|---|---|
| **Vector Index (Memory)** | Scoped to a record mapping: `inMemoryIndexes: Record<string, VectorEntry[]>` where keys are profile IDs. |
| **Vector Index (Disk)** | Persisted in discrete directories: `/profiles/{profileId}/rag_index.json`. |
| **Model Selection** | Stored under profile-scoped keys in AsyncStorage: `{profileId}_selected_model`. |
| **Text Messages & History** | Stored under profile-scoped keys in AsyncStorage: `{profileId}_chat_messages` and `{profileId}_task_history`. |
| **PIN Lock Security** | Stored as local metadata. Hashes user-inputted PINs using a local **djb2 hash** algorithm to prevent storing raw passcodes. |

### The Profile Lifecycle Flow
- **Switching Profile**:
  1. Old profile's in-memory index is deleted from RAM (`delete inMemoryIndexes[oldProfileId]`).
  2. The active `llama.rn` embedding context is released to free CPU memory (`releaseEmbeddingModel(oldProfileId)`).
  3. The active profile ID state updates.
  4. The app boots the new profile, loading the corresponding index from disk and re-initializing the new embedding model context.
- **Deletions**: Deleting a profile triggers a recursive deletion of the directory containing the local vectors (`RNFS.unlink`) along with the removal of all associated AsyncStorage records.

---

## 7. Key Design Trade-offs & Bug Fixes

### Trade-off 1: Pure JavaScript Vector Search vs. SQLite/C++ Vector DB
- **Decision**: Implemented cosine similarity in pure JavaScript.
- **Pros**: Zero native build issues; no extra third-party binary overhead; highly compatible across iOS and Android without native link errors.
- **Cons**: For extremely large documents (e.g., >10,000 chunks), vector scanning in single-threaded JS will cause frame-rate drops.
- **Justification**: Mobile users upload lightweight documents (PDFs, notes, receipts). For index sizes below 1,000 chunks, the JavaScript computation finishes in under 5ms, which is imperceptible to the user.

### Trade-off 2: CPU-Only Inference (No n_gpu_layers)
- **Decision**: Model contexts are loaded with `n_gpu_layers: 0`.
- **Justification**: Android phones have highly fragmented hardware specs (Mali, Adreno, PowerVR GPUs). Attempting to load models directly into Vulkan/OpenCL contexts often triggers catastrophic segment faults (crashes) on budget and mid-tier phones. CPU inference using 4 threads offers stable execution across almost all user devices.

### Critical Bug Fix: Task Routing Keyword Collisions
- **Issue**: RAG context used to be retrieved and injected *before* passing the prompt to the `taskRouter`. If an uploaded document contained words like "today" or "call", the task router would mistake a normal question for an action request and route the query incorrectly (e.g. trying to dial a number).
- **Fix**: Decoupled the pipeline. The `taskRouter` now parses the clean, original user input first. If no matching keywords are found, it defaults to the QA task. The RAG retrieval is executed **inside** the `handleQA` function, keeping action logic clean and free of document noise.

---

## 8. Comprehensive Q&A Bank

### 💡 Core Architecture Questions

#### Q1. Can you explain the high-level architecture of this mobile app?
"Sundae is an offline-first React Native application. The architecture has three main layers: The React Native UI/Business thread (written in TypeScript), the Native Platform layer (handling alarms, calls, and contacts via custom Kotlin Native Modules on Android), and the offline ML execution layer (which runs local LLM and embedding GGUF models on device hardware using `llama.rn`, a wrapper for `llama.cpp` written in C++). We use AsyncStorage for metadata and `react-native-fs` for storing local files and vector indexes."

#### Q2. Why did you choose React Native over Flutter or Native Development?
"React Native was selected because it allows us to share 100% of our complex business logic, local database interactions, and the custom RAG pipeline code between Android and iOS. Simultaneously, React Native's JSI (JavaScript Interface) and bridge support allow us to easily write custom Kotlin/Swift Native Modules for platform-level access, such as launching intents or querying Android's `ContentResolver`."

#### Q3. How does the application support fully offline operations?
"Everything is local. The LLM and embedding models are GGUF files downloaded to the device's storage. When a user asks a question, we run embedding generation on-device, calculate cosine similarity in JavaScript, reconstruct the prompt locally, and run inference using a multi-threaded CPU executor via `llama.rn`. No cloud servers or API endpoints are hit during chat execution."

#### Q4. What is the lifecycle of a message sent by the user?
"When the user hits send:
1. The text is captured in the UI and sent to `routeTask` in `taskRouter.ts`.
2. The router checks if the input matches patterns for device control commands (like alarms, calls, or app launches).
3. If it matches, the parameters are extracted (using regex or an LLM helper prompt) and sent to a native module.
4. If it doesn't match, it is treated as a QA query. The app embeds the input, fetches context from the local JSON index using cosine similarity, builds a system prompt, and calls `context.completion` on the local LLM.
5. The LLM streams the output text word-by-word back to the Chat Screen."

---

### 🧠 Local ML & LLM Questions

#### Q5. What model format do you use, and why?
"We use the **GGUF** (GPT-Generated Unified Format) model format. GGUF is optimized for CPU inference on consumer hardware. It supports quantization (compressing 16-bit floats to 4-bit or 5-bit integers), which significantly reduces the model's disk and memory footprint. This is essential for mobile devices, allowing us to load a 1.5–3 billion parameter model within 1–2 GB of RAM."

#### Q6. What is `llama.rn` and how does it interface with the React Native layer?
"`llama.rn` is a React Native wrapper around `llama.cpp`, the C++ engine for GGUF model execution. It uses native bridges (JNI for Android and Objective-C for iOS) to pass string prompts from JavaScript into compiled C++ code. It runs inference on native background threads to avoid blocking the React Native JavaScript UI thread, returning token outputs asynchronously."

#### Q7. What are the key parameters you pass to `initLlama` for the embedding model?
"For embedding models, we pass:
- `model`: the local file path prefix.
- `n_ctx: 512`: setting the context window size.
- `n_gpu_layers: 0`: ensuring execution stays on the CPU.
- `n_threads: 4`: allocating 4 CPU threads.
- `embedding: true`: this is the most critical parameter. It tells the engine to output the raw hidden layer activation states (the vector representation) instead of generating the next text token."

#### Q8. Why did you set `n_gpu_layers` to 0? Doesn't that slow down inference?
"Yes, CPU execution is slower than GPU execution. However, Android hardware is extremely fragmented. Attempting to allocate GPU layers using OpenCL or Vulkan on low-end or older GPUs often results in device-wide crashes or segmentation faults. Setting `n_gpu_layers: 0` ensures that the app runs stably on 100% of devices."

#### Q9. How do you handle LLM inference memory constraints? What happens if the app runs out of RAM?
"If the OS runs out of memory, it kills the app process. We prevent this by:
1. Using quantized models (typically Q4_K_M or Q5_K_M) to minimize the base model size.
2. Limiting the context window size (`n_ctx`) to 512 tokens.
3. Loading only one LLM context at a time per profile, and releasing contexts that are no longer in use."

---

### 📂 RAG Pipeline & Vector Search Questions

#### Q10. What is RAG, and why is it important in a mobile app?
"RAG stands for Retrieval-Augmented Generation. In mobile, local LLMs are small and lack comprehensive knowledge. They are also unaware of the user's personal documents. RAG allows us to extract text from a local file, split it into chunks, embed it, search for relevant context using cosine similarity, and inject that context into the LLM prompt. This enables the model to answer questions about specific local files accurately, without requiring fine-tuning."

#### Q11. Explain your text chunking strategy. Why did you choose it?
"We normalize whitespace and split the text into words. We use a sliding window of `100 words` per chunk with a `20-word overlap`. The overlap ensures that sentences crossing a chunk boundary aren't cut in half without context. We also discard chunks under 10 words to filter out trailing lines, page numbers, or isolated headers."

#### Q12. How are document embeddings generated locally?
"When a document is uploaded, we split it into chunks. We pass these chunks to the embedding model via `embedBatch` in `embedder.ts`. The model converts each chunk into a high-dimensional vector. To prevent memory issues (OOM) on mobile CPUs, we execute this process sequentially (batch size of 1) in a loop, rather than sending all chunks concurrently."

#### Q13. Where and how are the vectors stored?
"Vectors are stored locally as JSON files. When saving, we convert the `Float32Array` vectors into standard arrays and write them to a JSON file at `${RNFS.ExternalDirectoryPath}/profiles/{profileId}/rag_index.json`. When the profile is loaded, we read this JSON file and convert the arrays back into `Float32Array` objects for performance."

#### Q14. Why did you choose a pure JavaScript vector search instead of a database like SQLite?
"Using a native C++ database like SQLite-VSS would add complexity, build-time overhead, and file size to the app. Because mobile documents are generally small, our vector index usually contains fewer than 1,000 chunks. JavaScript can perform a linear cosine similarity scan across 1,000 vectors in less than 5ms, which is extremely fast and avoids the need for a complex database integration."

#### Q15. Can you write down or explain the mathematical formula for Cosine Similarity?
"Cosine similarity measures the cosine of the angle between two multi-dimensional vectors. It is calculated by dividing the dot product of the two vectors by the product of their magnitudes:
$$\text{Similarity}(A, B) = \frac{A \cdot B}{\|A\| \|B\|}$$
If the vectors are normalized, this is simply their dot product. The result ranges from -1 to 1, where 1 means identical direction, 0 means orthogonal (unrelated), and -1 means opposite direction."

#### Q16. What is the purpose of the similarity threshold filter in `retrieveContext`?
"We apply a minimum similarity threshold of `0.01`. When a user asks a question that has no relevance to the uploaded files, all calculated similarity scores will be low. By filtering out scores below `0.01`, we prevent irrelevant context from being injected into the prompt, ensuring the LLM does not hallucinate or get confused by unrelated text."

#### Q17. Why is RAG retrieval handled inside `handleQA` instead of the Chat Screen?
"This was a critical design choice. Previously, RAG retrieval was executed before task routing. If a document contained keywords like 'alarm' or 'call', the router would misinterpret a normal QA question as an action intent. By moving RAG retrieval inside `handleQA`, the router only evaluates the clean user query. The RAG pipeline is only triggered if the query is confirmed to be a QA task."

---

### 📱 React Native & Mobile-Native Integration Questions

#### Q18. How do you implement custom native modules in React Native?
"In this project, we write native code in Kotlin for Android. We define a Java/Kotlin class that extends `ReactContextBaseJavaModule`. We annotate the methods we want to expose to JavaScript with `@ReactMethod`. We then register this module in a `ReactPackage` and expose it to the JavaScript side, where it can be imported and called like a normal asynchronous function."

#### Q19. Walk me through the implementation of your Alarm Native Module.
"The `RTNMyAlarm` module exposes a `setAlarm` method. On the JavaScript side, the LLM extracts the target day and time into JSON. The app normalized the day string to a number matching Android's `Calendar` constants (e.g. Sunday = 1). The Native Module validates the hour and minutes, sets up an `AlarmClock.ACTION_SET_ALARM` intent, attaches the parameters as extras, and calls `startActivity` with `FLAG_ACTIVITY_NEW_TASK`."

#### Q20. What is an Android Intent? How does it differ from directly invoking native code?
"An Intent is an asynchronous messaging object used to request an action from another app component (like starting an activity or setting an alarm in the system clock app). Directly invoking native code runs logic within our own process, whereas launching an intent passes the request to the Android OS to launch a system component or a third-party app."

#### Q21. Why is `FLAG_ACTIVITY_NEW_TASK` needed when launching intents from Native Modules?
"In Android, activities are grouped into a stack called a task. Because a React Native Native Module runs in a service context or a non-activity context, it does not have an active activity stack. Adding `FLAG_ACTIVITY_NEW_TASK` tells the Android system to initialize a new task history stack for the launched app, preventing the app from crashing due to a missing context."

#### Q22. How does the app fetch contacts, and what Android APIs does it use?
"We use a custom Kotlin module called `ContactModule`. It accesses the device's contacts list by querying `ContactsContract.CommonDataKinds.Phone.CONTENT_URI` using Android's `ContentResolver`. It reads the name and phone number columns from the database cursor, packages them into a React Native `WritableArray`, and resolves the promise back to the JavaScript thread."

#### Q23. What permission constraints apply to your contact and calling features?
"Both features require runtime permissions. Querying contacts requires `android.permission.READ_CONTACTS`, and making direct calls requires `android.permission.CALL_PHONE`. Because these are classified as 'dangerous' permissions by Android, the app must request consent from the user at runtime before accessing the native APIs. If the permission is missing, the module aborts the operation safely."

#### Q24. How does the `AppLauncherModule` verify if a package is installed?
"The module uses the Android `PackageManager` to check for the package. First, it tries to get a launch intent using `pm.getLaunchIntentForPackage(packageName)`. If that succeeds, the app is installed and launchable. If it returns null, we fallback to checking `pm.getPackageInfo(packageName, 0)`. If a `NameNotFoundException` is caught, we know the app is not installed."

---

### 🔒 Security, Isolation, & State Questions

#### Q25. How do you implement data isolation between multiple profiles on the same device?
"All user data is partitioned using the `profileId`. We scope AsyncStorage metadata keys by prefixing them with the profile ID (e.g., `${profileId}_chat_messages`). Vector indexes are saved in separate subdirectories on the filesystem: `${RNFS.ExternalDirectoryPath}/profiles/${profileId}/rag_index.json`. This ensures that one profile cannot access another's data."

#### Q26. What happens behind the scenes when a user switches profiles?
"When the user switches profiles:
1. We flush the in-memory vector index for the old profile to free RAM.
2. We call `release()` on the old profile's embedding model context to free memory.
3. We set the new active profile ID in AsyncStorage.
4. The React Context triggers an initialization of the new profile, loading its vector index from disk and creating a new embedding context."

#### Q27. How does the PIN security system work without an internet connection?
"We secure profiles locally. When a user sets a 4-digit PIN, we hash it using a local implementation of the **djb2 hashing algorithm** and store the hash. When they try to log in, we hash the input PIN and compare it with the stored hash. This ensures that the raw PIN is never saved in plaintext on the device."

#### Q28. Why is it important to explicitly release model contexts?
"Large Language Models occupy significant RAM (often 1–2 GB). If we switch profiles without releasing the old context, the app will attempt to load the new model alongside the old one. This will exceed the device's memory limits, causing the OS to terminate the app. Calling `context.release()` frees the underlying C++ memory buffers."

#### Q29. How do you prevent cross-profile data leaks in the JavaScript layer?
"We manage in-memory variables using a record dictionary indexed by profile ID: `inMemoryIndexes: Record<string, VectorEntry[]>`. When a profile is deselected or logged out, we delete the key from the dictionary using `delete inMemoryIndexes[profileId]`, clearing the references so the garbage collector can reclaim the memory."

---

### 🛠️ Troubleshooting, Performance, & Systems Questions

#### Q30. What thread-related issues can occur when running an LLM in React Native?
"React Native runs JavaScript on a single thread. If we run model inference or vector operations directly on the JS thread, the UI will freeze. We prevent this by ensuring that `llama.rn` runs its heavy computations on native background threads. The JS thread is only updated when a new text token or progress event is emitted."

#### Q31. What is JNI, and how does it relate to your project?
"JNI stands for Java Native Interface. It allows Java/Kotlin code running in the Android JVM to call native C++ applications (and vice-versa). It is the bridge that enables the React Native Android wrapper to communicate with `llama.cpp` (which is written in C++), allowing us to execute GGUF models on the device."

#### Q32. How do you handle cases where the LLM produces random characters or fails to stop?
"Local models can sometimes hallucinate or fail to emit end-of-text tokens. We resolve this by:
1. Setting the temperature to a low value (`0.1`) to ensure deterministic outputs.
2. Passing an explicit array of stop tokens, such as `<end_of_turn>`, `<eos>`, and `<|im_end|>`.
3. Cleaning the final string output using regular expressions to strip out any residual tags before displaying the text."

#### Q33. Why did you use `moment.js` in your task files instead of native JS Date objects?
"`moment.js` simplifies complex date parsing and formatting operations. For example, when setting alarms or calendar events, we need to parse terms like 'tomorrow' or 'next Monday' and format times reliably across different locales. Moment handles this logic cleanly with minimal code."

#### Q34. How would you debug an issue where a native module is not working?
"To debug native modules:
1. Check the Android Studio Logcat output for native errors.
2. Verify that the module is properly registered in the application's React Package.
3. Ensure that all required Android permissions are declared in the `AndroidManifest.xml` and requested at runtime."

#### Q35. What is the difference between a synchronous bridge and an asynchronous bridge in React Native?
"The classic React Native bridge is asynchronous; calls are serialized and passed across a message queue, which can introduce latency. Modern React Native uses JSI (JavaScript Interface), which allows JavaScript to call native C++ methods directly. This provides synchronous execution and faster data transfer, which is crucial for high-performance applications like on-device AI."

---

### 🌟 Advanced Scenario & Design Questions

#### Q36. Suppose a user uploads a 500-page book. How will your app handle it?
"A 500-page book would create thousands of chunks. Since we process embeddings sequentially, this would take a long time on a mobile device and might drain the battery. In a real-world scenario, we would implement a chunk limit (e.g., maximum 50 pages) or notify the user of the expected ingestion time. We would also run the embedding process inside a background service to ensure the app doesn't close."

#### Q37. How would you modify the RAG pipeline to run faster on large documents?
"To scale the vector store:
1. We could implement hierarchical clustering (e.g., using an IVFFlat index pattern) to avoid checking every single vector.
2. We could write the cosine similarity logic in C++ and expose it via a JSI module, which would run significantly faster than JavaScript.
3. We could save the index in a binary format instead of JSON to reduce load times."

#### Q38. How does the app handle multi-day alarms or complex schedules?
"The `taskRouter` uses regex and prompt matching to identify day inputs. If the user requests multiple days (e.g., 'every Monday and Friday'), our mapping helper identifies both days and passes them as an array (`[2, 6]`) to the `RTNMyAlarm` module. The module then schedules the repeating alarm across those days."

#### Q39. What are the security risks of allowing a local LLM to execute code on a phone?
"Allowing an AI model to execute code directly poses security risks. We mitigate this by restricting the model to predefined, parameterized intents (such as calling a contact or setting an alarm) rather than giving it raw command-line access. The app acts as an intermediary, validating all parameters before triggering system actions."

#### Q40. If a user complains that the chatbot responses are slow, what settings would you check?
"I would verify:
1. The size of the selected model; larger models require more computation.
2. The number of active threads (`n_threads`); this should match the device's CPU architecture.
3. Whether other heavy background apps are running on the phone.
4. The context window size; a larger context increases processing latency."

---

## Conclusion

By presenting these architectural details, code workflows, and technical design justifications, you will demonstrate a strong understanding of mobile system design, local machine learning optimization, and native platform integration. Good luck with your interview!
