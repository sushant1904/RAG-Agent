# RAG Chatbot - LangChain Agent

A powerful Retrieval-Augmented Generation (RAG) chatbot built with LangChain, LangGraph, and OpenAI. This application allows you to chat with documents by providing URLs, which are processed and indexed for intelligent question-answering.

## 🚀 Features

- **Conversational Interface**: Modern, chat-style UI for natural interactions
- **Document Processing**: Automatically fetches and processes documents from URLs
- **Intelligent Retrieval**: Uses vector embeddings for semantic document search
- **Conversation Context**: Maintains conversation history for follow-up questions
- **Smart Answering**: Leverages GPT-4 with document context for accurate responses
- **Sample Questions**: AI-generated question suggestions based on document content
- **Greeting Handling**: Natural responses to greetings and simple messages
- **CPU Monitoring**: Built-in endpoint for monitoring system resources
- **Vector Store Caching**: Fast subsequent queries with cached embeddings

## 📋 Prerequisites

- **Node.js** (v18 or higher recommended)
- **npm** or **yarn**
- **OpenAI API Key** - Get one from [OpenAI Platform](https://platform.openai.com/api-keys)
- **Internet connection** (for fetching documents and API calls)

## 🔧 Installation

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd "RAG Langchain Agent"
```

### 2. Install Dependencies

```bash
npm install
```

This will install all required packages including:
- LangChain and LangGraph
- OpenAI SDK
- Express.js
- TypeScript
- And other dependencies

### 3. Set Up Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Or create it manually with:

```env
OPENAI_API_KEY=your_openai_api_key_here
PORT=3000
NODE_ENV=development
```

**Important**: Replace `your_openai_api_key_here` with your actual OpenAI API key.

### 4. Build the Project

```bash
npm run build
```

This compiles TypeScript files to JavaScript in the `dist/` directory.

## 🎯 Usage

### Development Mode

Start the development server:

```bash
npm run dev
```

Or use:

```bash
npm start
```

The server will start on `http://localhost:3000` (or the PORT specified in your `.env` file).

### Production Mode

For production, build first and then run:

```bash
npm run build
npm run start:prod
```

### Using the Application

1. **Open your browser** and navigate to `http://localhost:3000`

2. **Configure Document URLs**:
   - Enter one or more URLs in the "Document URLs" field
   - URLs can be comma-separated or on separate lines
   - Maximum 3 URLs at a time
   - Click "Setup URLs" to process the documents

3. **Start Chatting**:
   - Ask questions about the documents you've configured
   - The chatbot will retrieve relevant information and provide answers
   - You can ask follow-up questions - context is maintained
   - Click on suggested questions for quick queries

## 📡 API Endpoints

### Chat Endpoint

**POST** `/api/chat`

Send a chat message and get a response.

**Request Body**:
```json
{
  "urls": ["https://example.com/article"],
  "message": "What is this article about?",
  "conversationHistory": [
    { "role": "user", "content": "Previous question" },
    { "role": "assistant", "content": "Previous answer" }
  ]
}
```

**Response**:
```json
{
  "success": true,
  "message": "The article discusses...",
  "documents": ["Retrieved document chunks..."]
}
```

### Sample Questions Endpoint

**POST** `/api/sample-questions`

Get AI-generated sample questions based on document content.

**Request Body**:
```json
{
  "urls": ["https://example.com/article"]
}
```

**Response**:
```json
{
  "success": true,
  "questions": [
    "What is the main topic?",
    "Can you summarize the key points?",
    ...
  ]
}
```

### Health Check

**GET** `/api/health`

Check if the server is running.

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### CPU Usage Monitoring

**GET** `/api/cpu-usage`

Get CPU and memory usage statistics.

**Response**:
```json
{
  "cpu": {
    "usage": 45,
    "cores": 8,
    "model": "CPU Model",
    "speed": 2400,
    "loadAverage": [1.2, 1.5, 1.8]
  },
  "memory": {
    "used": 256,
    "total": 512,
    "rss": 128
  },
  "system": {
    "freeMemory": 1024,
    "totalMemory": 4096,
    "uptime": 3600
  }
}
```

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `OPENAI_API_KEY` | Your OpenAI API key | - | ✅ Yes |
| `PORT` | Server port number | `3000` | No |
| `NODE_ENV` | Environment mode | `development` | No |

### Timeout Settings

The application uses different timeouts for different scenarios:

- **First-time vector store building**: 3 minutes (180 seconds)
- **Cached queries (development)**: 2 minutes (120 seconds)
- **Cached queries (production)**: 25 seconds
- **Graph execution after vector store**: 1 minute

These are configured in `server.ts` and can be adjusted based on your needs.

## 🏗️ Project Structure

```
RAG Langchain Agent/
├── dist/                 # Compiled JavaScript files
├── public/              # Frontend files
│   └── index.html      # Chatbot UI
├── rag-chain.ts        # RAG chain logic and LangGraph
├── server.ts           # Express server and API endpoints
├── tsconfig.json       # TypeScript configuration
├── package.json        # Dependencies and scripts
├── .env                # Environment variables (create this)
└── README.md           # This file
```

## 🐳 Docker Deployment

A Dockerfile is included for containerized deployment:

```bash
# Build the image
docker build -t rag-chatbot .

# Run the container
docker run -p 3000:3000 --env-file .env rag-chatbot
```

## ☁️ Cloud Deployment

### Railway

1. Connect your GitHub repository to Railway
2. Add `OPENAI_API_KEY` in environment variables
3. Railway will automatically detect and deploy

### Render

1. Create a new Web Service on Render
2. Connect your GitHub repository
3. Set build command: `npm install && npm run build`
4. Set start command: `npm run start:prod`
5. Add `OPENAI_API_KEY` in environment variables

### Vercel

1. Import your repository to Vercel
2. Configure build settings
3. Add `OPENAI_API_KEY` in environment variables
4. Deploy

See `DEPLOYMENT.md` for more detailed deployment instructions.

## 🔍 Monitoring CPU Usage

The application includes built-in CPU monitoring. You can:

1. **Use the API endpoint**:
   ```bash
   curl http://localhost:3000/api/cpu-usage
   ```

2. **Use the monitoring script**:
   ```bash
   ./monitor-cpu.sh
   ```

3. **Check server logs** - CPU and memory stats are logged during operations

See `CPU-USAGE.md` for detailed information about CPU usage patterns and optimization.

## 🐛 Troubleshooting

### Common Issues

#### 1. "Please provide at least one URL" Error

**Solution**: Make sure you've entered valid URLs and clicked "Setup URLs" before sending messages.

#### 2. Request Timeout

**Solution**: 
- First-time vector store building can take 30-90 seconds - be patient
- Reduce the number of URLs (max 3 at a time)
- Check your internet connection

#### 3. OpenAI API Errors

**Solution**:
- Verify your API key is correct in `.env`
- Check your OpenAI account has sufficient credits
- Ensure you have internet connectivity

#### 4. Port Already in Use

**Solution**: Change the PORT in `.env` file or stop the process using port 3000:
```bash
# On Mac/Linux
lsof -ti:3000 | xargs kill

# Or use a different port
PORT=3001 npm start
```

#### 5. TypeScript Compilation Errors

**Solution**:
```bash
# Clean and rebuild
rm -rf dist node_modules
npm install
npm run build
```

#### 6. Module Not Found Errors

**Solution**:
```bash
npm install
npm run build
```

### Performance Tips

1. **Vector Store Caching**: The vector store is cached after first load - subsequent queries are much faster
2. **Limit URLs**: Keep to 3 URLs or fewer for optimal performance
3. **Document Size**: Smaller, focused documents process faster than large ones
4. **Chunk Size**: Currently set to 500 characters - adjust in `rag-chain.ts` if needed

## 📚 How It Works

1. **Document Loading**: When you provide URLs, the application:
   - Fetches content from each URL using CheerioWebBaseLoader
   - Splits documents into chunks (500 characters with 50 overlap)
   - Generates embeddings using HuggingFace Transformers (local)

2. **Vector Store**: 
   - Creates a vector store from document embeddings
   - Caches the vector store for faster subsequent queries
   - Stores in memory for quick access

3. **Query Processing**:
   - Receives user question
   - Retrieves top 10 most relevant document chunks
   - Grades documents for relevance using GPT-4
   - Generates answer using retrieved context
   - Grades answer quality
   - Returns response with conversation context

4. **LangGraph Pipeline**:
   - `retrieve_documents` → `create_model` → `grade_documents` → `generate_answer` → `grade_generated_answer`

## 🛠️ Development

### Running Tests

```bash
# Run TypeScript compilation check
npm run build

# Check for linting errors (if configured)
npm run lint
```

### Adding Features

Key files to modify:
- `rag-chain.ts`: RAG logic, document processing, LangGraph nodes
- `server.ts`: API endpoints, routing, error handling
- `public/index.html`: Frontend UI and JavaScript

### TypeScript Configuration

The project uses TypeScript with strict mode enabled. Configuration in `tsconfig.json`:
- Target: ES2020
- Module: CommonJS
- Strict: true
- Output: `dist/` directory

## 📄 License

MIT License - see LICENSE file for details

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📞 Support

If you encounter any issues or have questions:

1. Check the [Troubleshooting](#-troubleshooting) section
2. Review the `CPU-USAGE.md` and `DEPLOYMENT.md` documentation
3. Open an issue on GitHub

## 🙏 Acknowledgments

- Built with [LangChain](https://js.langchain.com/)
- Powered by [OpenAI](https://openai.com/)
- UI inspired by modern chat applications

## 📝 Version History

- **v1.0.0**: Initial release with full RAG functionality, chatbot UI, and monitoring capabilities

---

**Made with ❤️ using LangChain and TypeScript**
