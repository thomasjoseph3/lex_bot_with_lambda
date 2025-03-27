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

const errorResponse = (statusCode, errorDetails, isLex = false) => {
  if (isLex) {
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
  }

  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify({ error: errorDetails }),
  };
};

exports.handler = async (event) => {
  try {
    // Handle Lex V2 requests
    if (event.bot && event.sessionState) {
      const question = event.inputTranscript?.trim();

      if (!question) return errorResponse(400, "Empty question", true);

      const response = await processQuery(question);

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
            content: response.output.text,
          },
        ],
      };
    }

    // Handle API Gateway requests
    if (!event.body) return errorResponse(400, "Missing request body");

    let body;
    try {
      body = JSON.parse(event.body);
    } catch (e) {
      return errorResponse(400, "Invalid JSON format");
    }

    const question = body.question?.trim();
    if (!question) return errorResponse(400, "Question is required");

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

    // Lex error format
    if (event.bot) {
      return errorResponse(500, "Failed to process question", true);
    }

    // API Gateway error format
    return errorResponse(500, error.message);
  }
};