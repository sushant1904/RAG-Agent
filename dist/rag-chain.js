"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.graph = void 0;
exports.buildVectorStore = buildVectorStore;
exports.retrieveDoc = retrieveDoc;
exports.formatDocuments = formatDocuments;
const prompts_1 = require("@langchain/core/prompts");
const openai_1 = require("@langchain/openai");
const cheerio_1 = require("@langchain/community/document_loaders/web/cheerio");
const textsplitters_1 = require("@langchain/textsplitters");
const memory_1 = require("langchain/vectorstores/memory");
const hf_transformers_1 = require("@langchain/community/embeddings/hf_transformers");
const output_parsers_1 = require("@langchain/core/output_parsers");
const langgraph_1 = require("@langchain/langgraph");
const createModel = async () => {
    return new openai_1.ChatOpenAI({
        model: "gpt-4.1",
        temperature: 0,
        apiKey: process.env.OPENAI_API_KEY,
    });
};
const gradeGeneratedAnswer = async (state) => {
    const model = state.model ?? (await createModel());
    // Only grade if we have a generated answer
    if (!state.generatedAnswer || state.generatedAnswer.trim() === "") {
        return { gradeGeneratedAnswer: "I couldn't find a relevant answer to your question. Can I assist you with anything else?" };
    }
    const gradePrompter = prompts_1.ChatPromptTemplate.fromTemplate(`You are a grader deciding if a generated answer is relevant and helpful for a question.
Consider an answer relevant if it:
- Directly answers the question
- Provides related information that could be useful
- Mentions the topic even if incomplete

Question: {question}

Generated Answer: {generatedAnswer}

Answer with a single word: 'yes' or 'no'.`);
    const graderChain = gradePrompter.pipe(model).pipe(new output_parsers_1.StringOutputParser());
    try {
        const result = await graderChain.invoke({
            question: state.question,
            generatedAnswer: state.generatedAnswer ?? "",
        });
        // Only reject if explicitly "no" - be more lenient
        if (String(result).toLowerCase().trim() === "no") {
            console.log(`[gradeGeneratedAnswer] Answer rejected, but returning it anyway with a note`);
            // Return the answer anyway, but with a note
            return {
                ...state,
                generatedAnswer: state.generatedAnswer + " (Note: This information may be incomplete based on available documents.)"
            };
        }
    }
    catch (error) {
        console.warn(`[gradeGeneratedAnswer] Error grading answer, returning it anyway:`, error);
        // If grading fails, return the answer anyway
    }
    return state;
};
const generateAnswer = async (state) => {
    const model = state.model ?? (await createModel());
    const documents = (state.documents ?? []);
    const conversationHistory = state.conversationHistory ?? [];
    // Format conversation history for context
    const historyContext = conversationHistory.length > 0
        ? conversationHistory
            .slice(-6) // Keep last 6 messages for context
            .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
            .join("\n")
        : "";
    // Create RAG prompt template with conversation history
    const ragPrompt = prompts_1.ChatPromptTemplate.fromTemplate(`You are an assistant for question-answering tasks. Use the following pieces of retrieved context to answer the question accurately and comprehensively.

Instructions:
- Extract relevant information from the context to answer the question
- If the context contains the answer, provide it clearly
- If the context doesn't contain enough information, say what you can determine from the available context
- Be specific and cite information from the context when possible
- Keep the answer informative but concise (2-4 sentences)

${historyContext ? `Previous conversation:\n${historyContext}\n\n` : ""}Context from documents:\n{context}

Question: {question}

Answer:`);
    // Format documents as context string
    const context = documents.map(doc => doc.pageContent).join("\n\n");
    console.log(`[generateAnswer] Using ${documents.length} document(s) with total context length: ${context.length} chars`);
    if (documents.length === 0) {
        console.warn(`[generateAnswer] WARNING: No documents provided for answer generation`);
    }
    const ragChain = ragPrompt.pipe(model).pipe(new output_parsers_1.StringOutputParser());
    const generatedAnswer = await ragChain.invoke({
        question: state.question,
        context: context
    });
    console.log(`[generateAnswer] Generated answer length: ${generatedAnswer.length} chars`);
    return { generatedAnswer };
};
const hasRelevantDocs = (state) => {
    const relevantDocs = (state.documents ?? []);
    if (relevantDocs.length == 0) {
        return "no";
    }
    return "yes";
};
const documentGrader = async (state) => {
    const docs = (state.documents ?? []);
    const model = state.model ?? (await createModel());
    console.log(`[documentGrader] Grading ${docs.length} document(s) for relevance`);
    // Improved prompt to be less strict - consider partial relevance
    const gradePrompter = prompts_1.ChatPromptTemplate.fromTemplate(`You are a grader deciding if a document is relevant to a question. 
A document is relevant if it contains information that could help answer the question, even partially.
Consider documents relevant if they mention the topic, location, or related concepts.

Question: {question}

Document: {document}

Answer with a single word: 'yes' or 'no'. Do not return any other text.`);
    const docGrader = gradePrompter.pipe(model).pipe(new output_parsers_1.StringOutputParser());
    const relevantDocs = [];
    for (const doc of docs) {
        try {
            const result = await docGrader.invoke({
                question: state.question,
                document: doc.pageContent.substring(0, 1000), // Limit document size for grading to avoid token limits
            });
            if (String(result).toLowerCase().includes("yes")) {
                relevantDocs.push(doc);
            }
        }
        catch (error) {
            // If grading fails, include the document anyway to avoid losing potentially relevant info
            console.warn(`[documentGrader] Error grading document, including it anyway:`, error);
            relevantDocs.push(doc);
        }
    }
    // If no documents passed grading, keep at least the top 3 most similar ones
    if (relevantDocs.length === 0 && docs.length > 0) {
        console.log(`[documentGrader] No documents passed strict grading, keeping top ${Math.min(3, docs.length)} documents`);
        relevantDocs.push(...docs.slice(0, Math.min(3, docs.length)));
    }
    console.log(`[documentGrader] Found ${relevantDocs.length} relevant document(s) out of ${docs.length}`);
    return { ...state, documents: relevantDocs, model };
};
async function buildVectorStore(urls) {
    const docs = await Promise.all(urls.map(async (url) => {
        const loader = new cheerio_1.CheerioWebBaseLoader(url);
        return loader.load();
    }));
    const textSplitter = new textsplitters_1.RecursiveCharacterTextSplitter({
        chunkSize: 500, // Increased from 250 to capture more context
        chunkOverlap: 50, // Increased overlap to prevent losing context at boundaries
    });
    const splitDocs = await textSplitter.splitDocuments(docs.flat());
    const embeddings = new hf_transformers_1.HuggingFaceTransformersEmbeddings({
        model: "Xenova/all-MiniLM-L6-v2",
    });
    const vectorStore = new memory_1.MemoryVectorStore(embeddings);
    await vectorStore.addDocuments(splitDocs);
    return vectorStore;
}
async function retrieveDoc(urls, question) {
    const vectorStoreInstance = await buildVectorStore(urls);
    const retrievedDocs = await vectorStoreInstance
        .asRetriever({ k: 10 }) // Retrieve top 10 documents
        .invoke(question);
    return { documents: retrievedDocs };
}
// Node function for LangGraph that takes state
const retrieveDocNode = async (state) => {
    const urls = state.urls ?? [];
    const vectorStore = state.vectorStore;
    console.log(`[retrieveDocNode] Retrieving documents for question: "${state.question}" from ${urls.length} URL(s)`);
    // Use provided vector store or build a new one
    let vectorStoreInstance;
    if (vectorStore) {
        vectorStoreInstance = vectorStore;
    }
    else {
        const result = await retrieveDoc(urls, state.question);
        console.log(`[retrieveDocNode] Retrieved ${result.documents.length} document(s) from vector store`);
        return { documents: result.documents };
    }
    // Retrieve more documents to increase chances of finding relevant information
    const retrievedDocs = await vectorStoreInstance
        .asRetriever({ k: 10 }) // Retrieve top 10 documents instead of default (usually 4)
        .invoke(state.question);
    console.log(`[retrieveDocNode] Retrieved ${retrievedDocs.length} document(s) from vector store`);
    return { documents: retrievedDocs };
};
// Node function for LangGraph that creates model
const createModelNode = async (state) => {
    const model = await createModel();
    return { model };
};
function formatDocuments(docs) {
    return docs.map((doc) => doc.pageContent);
}
// Define the state schema for LangGraph using Annotation
const GraphState = langgraph_1.Annotation.Root({
    question: (langgraph_1.Annotation),
    urls: (0, langgraph_1.Annotation)({
        reducer: (x, y) => y ?? x,
        default: () => [],
    }),
    generatedAnswer: (0, langgraph_1.Annotation)({
        reducer: (x, y) => y || x,
        default: () => "",
    }),
    documents: (0, langgraph_1.Annotation)({
        reducer: (x, y) => y ?? x,
        default: () => [],
    }),
    model: (0, langgraph_1.Annotation)({
        reducer: (x, y) => y ?? x,
        default: () => undefined,
    }),
    conversationHistory: (0, langgraph_1.Annotation)({
        reducer: (x, y) => y ?? x,
        default: () => [],
    }),
    vectorStore: (0, langgraph_1.Annotation)({
        reducer: (x, y) => y ?? x,
        default: () => undefined,
    }),
});
exports.graph = new langgraph_1.StateGraph(GraphState)
    .addNode("retrieve_documents", retrieveDocNode)
    .addNode("create_model", createModelNode)
    .addNode("grade_documents", documentGrader)
    .addNode("generate_answer", generateAnswer)
    .addNode("grade_generated_answer", gradeGeneratedAnswer)
    .addEdge(langgraph_1.START, "retrieve_documents")
    .addEdge("retrieve_documents", "create_model")
    .addEdge("create_model", "grade_documents")
    .addConditionalEdges("grade_documents", hasRelevantDocs, {
    "yes": "generate_answer",
    "no": langgraph_1.END,
})
    .addEdge("generate_answer", "grade_generated_answer")
    .addEdge("grade_generated_answer", langgraph_1.END)
    .compile();
