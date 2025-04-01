const {
  BedrockAgentRuntimeClient,
  RetrieveAndGenerateCommand,
} = require("@aws-sdk/client-bedrock-agent-runtime");

const client = new BedrockAgentRuntimeClient({ region: "eu-west-2" });
const ASSISTANT_INSTRUCTION = `
You are the Totem website. Speak as the website itself, Provide accurate answers based solely on the knowledge base, without mentioning search results or external sources. If the knowledge base lacks information, say: "I don’t have that information right now. How else can I assist you?" Do not use phrases like "based on the information provided" or "it appears." Answer directly as Totem.`;
const processQuery = async (question) => {
  const prompt = `${ASSISTANT_INSTRUCTION}\n\nUser question: ${question}`;
  const command = new RetrieveAndGenerateCommand({
    input: { text: prompt },
    retrieveAndGenerateConfiguration: {
      type: "KNOWLEDGE_BASE",
      knowledgeBaseConfiguration: {
        knowledgeBaseId: process.env.KNOWLEDGE_BASE_ID,
        modelArn: "arn:aws:bedrock:eu-west-2::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0",
        retrievalConfiguration: {
          vectorSearchConfiguration: {
            numberOfResults: 5,
            overrideSearchType: "SEMANTIC",
          },
        },
      },
    },
  });
  return await client.send(command);
};

const errorResponse = (event, errorDetails) => {
  console.log("Returning error response:", errorDetails);
  return {
    sessionState: {
      dialogAction: { type: "Close" },
      intent: { state: "Failed" },
    },
    messages: [
      {
        contentType: "PlainText",
        content: `Error: ${errorDetails}`,
      },
    ],
  };
};

exports.handler = async (event) => {
  console.log("Received event:", JSON.stringify(event, null, 2));
  try {
    if (event.sessionState && event.bot) {
      const question = event.inputTranscript?.trim();
      console.log("Extracted question:", question);

      if (!question) {
        return errorResponse(event, "No input provided");
      }

      const response = await processQuery(question);
      console.log("Bedrock response:", JSON.stringify(response, null, 2));

      const answer = response.output?.text || "I couldn't find a specific answer.";
      console.log("Final answer:", answer);

      return {
        sessionState: {
          sessionAttributes: {
            bedrockSessionId: response.sessionId,
          },
          dialogAction: { type: "Close" },
          intent: {
            name: event.sessionState.intent.name,
            state: "Fulfilled",
          },
        },
        messages: [
          {
            contentType: "PlainText",
            content: answer,
          },
        ],
      };
    }

    // API Gateway /chat endpoint (unchanged)
    if (!event.body) {
      throw new Error("Missing request body");
    }
    const body = JSON.parse(event.body);
    const question = body.question?.trim();

    if (!question) {
      throw new Error("Question is required");
    }
    const response = await processQuery(question);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        answer: response.output?.text || "I couldn't find a specific answer.",
        sessionId: response.sessionId,
        citations: response.citations?.map((c) => ({
          source: c.retrievedReferences?.[0]?.location?.s3Location?.uri,
          content: c.retrievedReferences?.[0]?.content?.text,
        })),
      }),
    };
  } catch (error) {
    console.error("Detailed Error:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    return event.sessionState && event.bot
      ? errorResponse(event, "Failed to process question")
      : {
          statusCode: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
          body: JSON.stringify({ error: "Internal server error" }),
        };
  }
};