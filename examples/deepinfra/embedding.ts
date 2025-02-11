import { DeepInfraEmbedding } from "@llamaindex/deepinfra";

async function main() {
  // API token can be provided as an environment variable too
  // using DEEPINFRA_API_TOKEN variable
  const apiToken = process.env.DEEPINFRA_API_TOKEN ?? "YOUR_API_TOKEN";
  const model = "BAAI/bge-large-en-v1.5";
  const embedModel = new DeepInfraEmbedding({
    model,
    apiToken,
  });
  const texts = ["hello", "world"];
  const embeddings = await embedModel.getTextEmbeddingsBatch(texts);
  console.log(`\nWe have ${embeddings.length} embeddings`);
}

main().catch(console.error);
