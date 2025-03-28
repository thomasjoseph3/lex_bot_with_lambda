const {
  BedrockAgentRuntimeClient,
  RetrieveAndGenerateCommand,
} = require("@aws-sdk/client-bedrock-agent-runtime");

const client = new BedrockAgentRuntimeClient({ region: "eu-west-2" });

const processQuery = async (question) => {
  const command = new RetrieveAndGenerateCommand({
    input: { text: question },
    retrieveAndGenerateConfiguration: {
      type: "KNOWLEDGE_BASE",
      knowledgeBaseConfiguration: {
        knowledgeBaseId: process.env.KNOWLEDGE_BASE_ID,
        modelArn:
          "arn:aws:bedrock:eu-west-2::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0",
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
  // Lex V2 error response format
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
  try {
    // Lex V2 handling
    if (event.sessionState && event.bot) {
      // Extract query from slots or input transcript
      const question = 
        event.sessionState.intent.slots?.QuerySlot?.value?.interpretedValue || 
        event.inputTranscript?.trim();

      if (!question) {
        return errorResponse(event, "No query provided");
      }

      const response = await processQuery(question);

      // Lex V2 response format
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
            content: response.output.text || "I couldn't find a specific answer.",
          },
        ],
      };
    }

    // Fallback for non-Lex invocations (e.g., API Gateway)
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
        answer: response.output.text,
        sessionId: response.sessionId,
        citations: response.citations?.map((c) => ({
          source: c.generatedResponsePart.reference?.location?.s3Location?.uri,
          content: c.generatedResponsePart.reference?.content?.text,
        })),
      }),
    };
  } catch (error) {
    console.error("Detailed Error:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });

    // Differentiate error response based on event type
    return event.sessionState && event.bot 
      ? errorResponse(event, "Failed to process question")
      : {
          statusCode: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
          body: JSON.stringify({ error: error.message }),
        };
  }
};