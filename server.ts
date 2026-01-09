import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { retrieveDoc, formatDocuments, graph, buildVectorStore } from "./rag-chain";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import * as os from "os";

const app = express();
const PORT = process.env.PORT || 3000;

// Cache vector stores by URL set (as a string key)
const vectorStoreCache = new Map<string, MemoryVectorStore>();

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// CPU usage monitoring endpoint
app.get("/api/cpu-usage", (req, res) => {
  const cpus = os.cpus();
  const totalIdle = cpus.reduce((acc, cpu) => acc + cpu.times.idle, 0);
  const totalTick = cpus.reduce((acc, cpu) => 
    acc + Object.values(cpu.times).reduce((sum: number, time: number) => sum + time, 0), 0
  );
  const idle = totalIdle / cpus.length;
  const total = totalTick / cpus.length;
  const usage = 100 - ~~(100 * idle / total);
  
  const memUsage = process.memoryUsage();
  
  res.json({
    cpu: {
      usage: usage,
      cores: cpus.length,
      model: cpus[0].model,
      speed: cpus[0].speed,
      loadAverage: os.loadavg(),
    },
    memory: {
      used: Math.round(memUsage.heapUsed / 1024 / 1024),
      total: Math.round(memUsage.heapTotal / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024),
      rss: Math.round(memUsage.rss / 1024 / 1024),
    },
    system: {
      freeMemory: Math.round(os.freemem() / 1024 / 1024),
      totalMemory: Math.round(os.totalmem() / 1024 / 1024),
      uptime: process.uptime(),
    },
    timestamp: new Date().toISOString(),
  });
});

// Endpoint to generate sample questions from documents
app.post("/api/sample-questions", async (req, res) => {
  try {
    const { urls } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: "Please provide at least one URL" });
    }

    if (urls.length > 3) {
      return res.status(400).json({ 
        error: "Too many URLs. Please provide a maximum of 3 URLs at a time." 
      });
    }

    // Get or create vector store
    const vectorStore = await getOrCreateVectorStore(urls);
    
    // Retrieve some sample documents to generate questions from
    const sampleDocs = await vectorStore
      .asRetriever({ k: 5 })
      .invoke("main topics and key information");

    if (sampleDocs.length === 0) {
      return res.json({ 
        success: true, 
        questions: [
          "What is the main topic of this document?",
          "Can you summarize the key points?",
          "What are the important details mentioned?",
        ]
      });
    }

    // Use LLM to generate sample questions based on document content
    const model = new ChatOpenAI({
      model: "gpt-4.1",
      temperature: 0.7,
      apiKey: process.env.OPENAI_API_KEY,
    });

    const context = sampleDocs.slice(0, 3).map(doc => doc.pageContent).join("\n\n");
    
    const prompt = ChatPromptTemplate.fromTemplate(
      `Based on the following document excerpts, generate 5 diverse and interesting questions that someone might ask about this content. 
      Make the questions specific and relevant to the content. Return only the questions, one per line, without numbering or bullets.

Document excerpts:
{context}

Generate 5 sample questions:`
    );

    const chain = prompt.pipe(model).pipe(new StringOutputParser());
    const questionsText = await chain.invoke({ context });
    
    // Parse questions (split by newlines and clean up)
    const questions = questionsText
      .split('\n')
      .map(q => q.trim())
      .filter(q => q.length > 0 && !q.match(/^\d+[\.\)]/)) // Remove numbering
      .slice(0, 5);

    res.json({ 
      success: true, 
      questions: questions.length > 0 ? questions : [
        "What is the main topic of this document?",
        "Can you summarize the key points?",
        "What are the important details mentioned?",
      ]
    });
  } catch (error: any) {
    console.error("[API] Error generating sample questions:", error);
    // Return default questions on error
    res.json({ 
      success: true, 
      questions: [
        "What is the main topic of this document?",
        "Can you summarize the key points?",
        "What are the important details mentioned?",
      ]
    });
  }
});

// Helper function to get or create vector store
async function getOrCreateVectorStore(urls: string[]): Promise<MemoryVectorStore> {
  const cacheKey = urls.sort().join("|");
  
  if (vectorStoreCache.has(cacheKey)) {
    console.log(`[Cache] Using cached vector store for ${urls.length} URL(s)`);
    return vectorStoreCache.get(cacheKey)!;
  }
  
  console.log(`[Cache] Building new vector store for ${urls.length} URL(s)`);
  console.log(`[CPU] ⚠️  This operation is CPU-intensive (embedding generation)`);
  const startTime = Date.now();
  const memBefore = process.memoryUsage();
  
  const vectorStore = await buildVectorStore(urls);
  
  const duration = Date.now() - startTime;
  const memAfter = process.memoryUsage();
  const memUsed = (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024;
  
  console.log(`[CPU] ✅ Vector store built in ${duration}ms, used ${memUsed.toFixed(2)} MB memory`);
  vectorStoreCache.set(cacheKey, vectorStore);
  return vectorStore;
}

// API endpoint to process chat messages
app.post("/api/chat", async (req, res) => {
  // Configurable timeout: longer for local dev, shorter for production (Render free tier)
  // First-time vector store building can take 30-90 seconds, cached queries are much faster
  const DEFAULT_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 25000 : 120000; // 2 minutes for dev, 25s for prod
  const FIRST_LOAD_TIMEOUT_MS = 180000; // 3 minutes for first-time vector store building
  
  let responseSent = false;
  let timeoutId: NodeJS.Timeout | null = null;
  
  const sendResponse = (status: number, data: any) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (!responseSent) {
      responseSent = true;
      res.status(status).json(data);
    }
  };

  const createTimeoutPromise = (timeoutMs: number) => {
    return new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        timeoutId = null;
        reject(new Error("Request timeout: The operation took too long. This usually happens on the first request when building the vector store. Please wait a bit longer or try again."));
      }, timeoutMs);
    });
  };

  try {
    const { urls, message, conversationHistory = [] } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      sendResponse(400, { error: "Please provide at least one URL" });
      return;
    }

    if (!message || message.trim() === "") {
      sendResponse(400, { error: "Please provide a message" });
      return;
    }

    // Limit URLs to prevent timeout
    if (urls.length > 3) {
      sendResponse(400, { 
        error: "Too many URLs. Please provide a maximum of 3 URLs at a time." 
      });
      return;
    }

    const normalizedMessage = message.trim().toLowerCase();
    
    // Handle greetings and simple conversational messages
    const greetings = ['hi', 'hello', 'hey', 'greetings', 'good morning', 'good afternoon', 'good evening'];
    const isGreeting = greetings.some(greeting => 
      normalizedMessage === greeting || 
      normalizedMessage.startsWith(greeting + ' ') ||
      normalizedMessage === greeting + '!'
    );

    if (isGreeting) {
      const greetingResponses = [
        "Hello! I'm here to help you with questions about the documents. What would you like to know?",
        "Hi! How can I assist you today? Feel free to ask me anything about the documents.",
        "Hello! I can help answer questions based on the documents you've provided. What would you like to know?",
        "Hi there! I'm ready to help. What questions do you have about the documents?",
      ];
      const randomResponse = greetingResponses[Math.floor(Math.random() * greetingResponses.length)];
      
      sendResponse(200, {
        success: true,
        message: randomResponse,
        documents: [],
      });
      return;
    }

    // Handle other simple conversational messages
    const simpleResponses: { [key: string]: string } = {
      'how are you': "I'm doing well, thank you! I'm here to help you with questions about the documents. What would you like to know?",
      'how are you doing': "I'm doing great! Ready to help you with any questions about the documents. What can I assist you with?",
      'thanks': "You're welcome! Is there anything else you'd like to know?",
      'thank you': "You're welcome! Feel free to ask if you have more questions.",
      'bye': "Goodbye! Feel free to come back if you have more questions.",
      'goodbye': "Goodbye! Have a great day!",
    };

    if (simpleResponses[normalizedMessage]) {
      sendResponse(200, {
        success: true,
        message: simpleResponses[normalizedMessage],
        documents: [],
      });
      return;
    }

    console.log(`[API] Processing chat message: "${message}" for ${urls.length} URL(s)`);
    console.log(`[API] Conversation history length: ${conversationHistory.length}`);
    console.log(`[API] Request received at: ${new Date().toISOString()}`);
    
    // Log initial CPU/memory stats
    const memBefore = process.memoryUsage();
    const cpuBefore = os.loadavg();

    const startTime = Date.now();
    
    // Check if vector store needs to be built (first time)
    const cacheKey = urls.sort().join("|");
    const isFirstLoad = !vectorStoreCache.has(cacheKey);
    const timeoutMs = isFirstLoad ? FIRST_LOAD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
    
    if (isFirstLoad) {
      console.log(`[API] First-time load detected - using extended timeout of ${timeoutMs / 1000}s`);
      console.log(`[API] This may take 30-90 seconds to build the vector store...`);
    }
    
    // Get or create vector store (cached) - this can take time on first load
    // Wrap in timeout to catch if vector store building takes too long
    const vectorStoreTimeoutPromise = createTimeoutPromise(timeoutMs);
    const vectorStore = await Promise.race([
      getOrCreateVectorStore(urls),
      vectorStoreTimeoutPromise,
    ]) as MemoryVectorStore;
    
    // Clear the first timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    
    // Execute graph with timeout
    const graphTimeoutMs = isFirstLoad ? 60000 : DEFAULT_TIMEOUT_MS; // 1 min for graph after vector store is ready
    const graphTimeoutPromise = createTimeoutPromise(graphTimeoutMs);
    
    const graphPromise = graph.invoke({ 
      question: message, 
      urls,
      vectorStore,
      conversationHistory: conversationHistory.map((msg: any) => ({
        role: msg.role,
        content: msg.content
      }))
    });
    
    // Race between graph execution and timeout
    const result = await Promise.race([
      graphPromise,
      graphTimeoutPromise,
    ]) as any;
    
    const duration = Date.now() - startTime;
    const memAfter = process.memoryUsage();
    const cpuAfter = os.loadavg();
    const memDelta = (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024;
    
    console.log(`[API] Graph execution completed in ${duration}ms`);
    console.log(`[CPU] Memory delta: ${memDelta > 0 ? '+' : ''}${memDelta.toFixed(2)} MB`);
    console.log(`[CPU] System load: ${cpuAfter[0].toFixed(2)} (1min avg)`);
    console.log("[API] Graph result:", {
      documentCount: result.documents?.length ?? 0,
      hasGeneratedAnswer: !!result.generatedAnswer,
    });

    const response = {
      success: true,
      message: result.generatedAnswer || "I couldn't find a relevant answer to your question. Can I assist you with anything else?",
      documents: result.documents ? formatDocuments(result.documents) : [],
    };

    console.log(`[API] Sending chat response`);
    sendResponse(200, response);
  } catch (error: any) {
    // Clear timeout if still active
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    
    console.error("[API] Error processing chat:", error);
    if (error.stack) {
      console.error("[API] Error stack:", error.stack);
    }
    
    // Check if it's a timeout error
    const isTimeout = error.message && error.message.includes("timeout");
    
    // Don't send response if already sent
    if (!responseSent) {
      sendResponse(isTimeout ? 408 : 500, {
        error: isTimeout 
          ? "Request Timeout" 
          : "Failed to process message",
        message: error.message || "Unknown error occurred",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }
});

// Keep old endpoint for backward compatibility
app.post("/api/query", async (req, res) => {
  try {
    const { urls, question } = req.body;
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: "Please provide at least one URL" });
    }
    if (!question || question.trim() === "") {
      return res.status(400).json({ error: "Please provide a question" });
    }
    const vectorStore = await getOrCreateVectorStore(urls);
    const result = await graph.invoke({ question, urls, vectorStore, conversationHistory: [] });
    const formattedDocs = formatDocuments(result.documents ?? []);
    res.json({
      success: true,
      question,
      documents: formattedDocs,
      documentCount: formattedDocs.length,
      generatedAnswer: result.generatedAnswer,
    });
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to process query",
      message: error.message,
    });
  }
});

// Serve static files (after API routes)
app.use(express.static(path.join(__dirname, "public")));

// Serve the HTML file for all other routes (SPA fallback)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 RAG Agent server running at http://localhost:${PORT}`);
  console.log(`📝 Open your browser and navigate to http://localhost:${PORT}`);
});

