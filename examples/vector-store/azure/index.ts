/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  DefaultAzureCredential,
  getBearerTokenProvider,
} from "@azure/identity";
import {
  KnownAnalyzerNames,
  KnownVectorSearchAlgorithmKind,
  KnownVectorSearchCompressionKind,
} from "@azure/search-documents";
import dotenv from "dotenv";
import {
  AzureAISearchVectorStore,
  FilterableMetadataFieldKeysType,
  IndexManagement,
  MetadataIndexFieldType,
  NodeWithScore,
  OpenAI,
  OpenAIEmbedding,
  Settings,
  SimpleDirectoryReader,
  storageContextFromDefaults,
  TextNode,
  VectorStoreIndex,
  VectorStoreQueryMode,
} from "llamaindex";
import { DocStoreStrategy } from "llamaindex/ingestion/strategies/index";

dotenv.config();

// Based on https://docs.llamaindex.ai/en/stable/examples/vector_stores/AzureAISearchIndexDemo/
(async () => {
  // ---------------------------------------------------------
  // 1- Setup Azure OpenAI
  const azureADTokenProvider = getBearerTokenProvider(
    new DefaultAzureCredential(),
    "https://cognitiveservices.azure.com/.default",
  );
  // You need to deploy your own embedding model as well as your own chat completion model
  const azure = {
    // TODO: configure and use managed identity
    azureADTokenProvider,
    deployment: process.env.AZURE_DEPLOYMENT_NAME,
  };
  Settings.llm = new OpenAI({ azure });
  Settings.embedModel = new OpenAIEmbedding({
    model: process.env.EMBEDDING_MODEL,
    azure: {
      ...azure,
      deployment: process.env.EMBEDDING_MODEL,
    },
  });

  // ---------------------------------------------------------
  // 2- Setup Azure AI Search
  // Define env variables in .env file
  // AZURE_AI_SEARCH_ENDPOINT=
  // AZURE_AI_SEARCH_KEY=
  // AZURE_OPENAI_ENDPOINT=
  // EMBEDDING_MODEL=text-embedding-ada-002
  // AZURE_DEPLOYMENT_NAME=gpt-4
  // AZURE_API_VERSION=2024-09-01-preview

  // Define index name
  const indexName = "llamaindex-vector-store";

  // ---------------------------------------------------------
  // 3a- Create Index (if it does not exist)
  // id:	      Edm.String
  // chunk:	    Edm.String
  // embedding:	Collection(Edm.Single)
  // metadata:	Edm.String
  // doc_id:	  Edm.String
  // author:	  Edm.String
  // theme:	    Edm.String
  // director:	Edm.String

  // Define metadata fields with their respective configurations
  const metadataFields = {
    author: "author",
    theme: ["topic", MetadataIndexFieldType.STRING],
    director: "director",
  };

  // Define index parameters and vector store configuration
  // Index validation:
  // - IndexManagement.VALIDATE_INDEX: will validate before creating emnbedding index and will throw a runtime error if the index does not exist
  // - IndexManagement.NO_VALIDATION: will try to access the index and will throw a runtime error if the index does not exist
  // - IndexManagement.CREATE_IF_NOT_EXISTS: will create the index if it does not exist
  const vectorStore = new AzureAISearchVectorStore({
    filterableMetadataFieldKeys:
      metadataFields as unknown as FilterableMetadataFieldKeysType,
    indexName,
    indexManagement: IndexManagement.CREATE_IF_NOT_EXISTS,
    idFieldKey: "id",
    chunkFieldKey: "chunk",
    embeddingFieldKey: "embedding",
    embeddingDimensionality: 1536,
    metadataStringFieldKey: "metadata",
    docIdFieldKey: "doc_id",
    languageAnalyzer: KnownAnalyzerNames.EnLucene,
    // store vectors on disk
    vectorAlgorithmType: KnownVectorSearchAlgorithmKind.ExhaustiveKnn,
    // Optional: Set to "scalar" or "binary" if using HNSW
    compressionType: KnownVectorSearchCompressionKind.BinaryQuantization,
  });

  // ---------------------------------------------------------
  // 3a- Loading documents
  // Load the documents stored in the data/paul_graham/ using the SimpleDirectoryReader
  // Load documents using a directory reader
  const documents = await new SimpleDirectoryReader().loadData(
    "data/paul_graham/",
  );
  const storageContext = await storageContextFromDefaults({ vectorStore });

  // Create index from documents with the specified storage context
  const index = await VectorStoreIndex.fromDocuments(documents, {
    storageContext,
    docStoreStrategy: DocStoreStrategy.UPSERTS,
  });

  {
    const queryEngine = index.asQueryEngine();
    const response = await queryEngine.query({
      query: "What did the author do growing up?",
      similarityTopK: 3,
    } as any);
    console.log({ response });
  }

  // // ---------------------------------------------------------
  // // 4- Insert documents into the index
  // {
  //   const queryEngine = index.asQueryEngine();
  //   const response = await queryEngine.query({
  //     query: "What colour is the sky?",
  //   });
  //   console.log({ response });
  // }
  // // The color of the sky varies depending on factors such as the time of day, weather conditions, and location.
  // // The text does not provide information about the color of the sky.

  // {
  //   await index.insert(new Document({ text: "The sky is indigo today." }));

  //   const queryEngine = index.asQueryEngine();
  //   const response = await queryEngine.query({
  //     query: "What colour is the sky?",
  //   });
  //   console.log({ response });
  //   // The color of the sky is indigo.
  // }

  // // ---------------------------------------------------------
  // // 5- Filtering
  // // FIXME: Filtering is not working. The following block will throw an error:
  // // RestError: Invalid expression: Could not find a property named 'theme' on type 'search.document'.
  // try {
  //   const nodes = [
  //     new Document({
  //       text: "The Shawshank Redemption",
  //       metadata: {
  //         author: "Stephen King",
  //         theme: "Friendship",
  //       } as Metadata,
  //     }),
  //     new Document({
  //       text: "The Godfather",
  //       metadata: {
  //         director: "Francis Ford Coppola",
  //         theme: "Mafia",
  //       } as Metadata,
  //     }),
  //     new Document({
  //       text: "Inception",
  //       metadata: {
  //         director: "Christopher Nolan",
  //       } as Metadata,
  //     }),
  //   ];

  //   {
  //     await index.insertNodes(nodes);

  //     const retriever = index.asRetriever({
  //       filters: {
  //         condition: FilterCondition.AND, // required
  //         filters: [
  //           {
  //             key: "theme",
  //             value: "Mafia",
  //             operator: FilterOperator.EQ,
  //           },
  //         ],
  //       },
  //     });
  //     const response = await retriever.retrieve({
  //       query: "Who wrote The Shawshank Redemption?",
  //     });
  //     console.log({ response });
  //   } // Stephen King
  // } catch (error) {
  //   console.error(error);
  // }
  // // ---------------------------------------------------------
  // 6- Query Mode
  // 6a- Perform a Vector Search
  function processResults(response: NodeWithScore[]) {
    response.forEach((nodeWithScore: NodeWithScore) => {
      const node = nodeWithScore.node as TextNode;
      const score = nodeWithScore.score;
      const chunkId = node.id_;

      // Retrieve metadata fields
      const fileName = node.metadata?.file_name || "Unknown";
      const filePath = node.metadata?.file_path || "Unknown";
      const textContent = node.text || "No content available";

      // Output the results
      console.log(`Score: ${score}`);
      console.log(`File Name: ${fileName}`);
      console.log(`File Path: ${filePath}`);
      console.log(`Id: ${chunkId}`);
      console.log("\nExtracted Content:");
      console.log(textContent);
      console.log(
        "\n" + "=".repeat(40) + " End of Result " + "=".repeat(40) + "\n",
      );
    });
  }
  // Execute the query
  {
    const queryEngine = index.asQueryEngine();
    const response = await queryEngine.query({
      query: "What is the meaning of life?",
      mode: VectorStoreQueryMode.DEFAULT,
    } as any);
    console.log({ response });
  }

  // 6b- Perform a Hybrid Search with Semantic Reranking
  {
    const queryEngine = index.asQueryEngine();
    const response = await queryEngine.query({
      query: "What is the meaning of life?",
      mode: VectorStoreQueryMode.HYBRID,
    } as any);
    console.log({ response });
  }

  // 6c- Perform a Hybrid Search with Semantic Reranking
  {
    const queryEngine = index.asQueryEngine();
    const response = await queryEngine.query({
      query: "What is inception about?",
      mode: VectorStoreQueryMode.SEMANTIC_HYBRID,
    } as any);
    console.log({ response });
  }
})();
