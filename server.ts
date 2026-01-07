import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { retrieveDoc, formatDocuments, graph } from "./rag-chain";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// API endpoint to process queries (must be before static middleware)
app.post("/api/query", async (req, res) => {
  try {
    const { urls, question } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: "Please provide at least one URL" });
    }

    if (!question || question.trim() === "") {
      return res.status(400).json({ error: "Please provide a question" });
    }

    console.log(`Processing query: "${question}" for URLs:`, urls);

    const result = await graph.invoke({ question, urls });
    console.log("Graph result:", {
      documentCount: result.documents?.length ?? 0,
      hasGeneratedAnswer: !!result.generatedAnswer,
    });
    
    const formattedDocs = formatDocuments(result.documents ?? []);

    res.json({
      success: true,
      question,
      documents: formattedDocs,
      documentCount: formattedDocs.length,
      generatedAnswer: result.generatedAnswer,
    });
  } catch (error: any) {
    console.error("Error processing query:", error);
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

