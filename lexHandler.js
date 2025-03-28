const {
  LexRuntimeV2Client,
  RecognizeTextCommand,
} = require("@aws-sdk/client-lex-runtime-v2");

const lexClient = new LexRuntimeV2Client();

// Helper function for exponential backoff
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sendMessageToLex = async (inputText, maxRetries = 3) => {
  const params = {
    botId: process.env.BOT_ID,
    botAliasId: process.env.BOT_ALIAS_ID,
    localeId: process.env.LOCALE_ID,
    text: inputText,
  };

  let attempts = 0;
  let success = false;
  let response;

  while (attempts < maxRetries && !success) {
    try {
      const command = new RecognizeTextCommand(params);
      response = await lexClient.send(command);
      success = true;
      return response;
    } catch (err) {
      attempts += 1;
      console.error(`Attempt ${attempts} failed:`, err.message);

      if (attempts < maxRetries) {
        const delay = Math.pow(2, attempts) * 100; // Exponential backoff
        console.log(`Retrying after ${delay}ms...`);
        await wait(delay);
      } else {
        console.error("Max retries reached. Lex communication failed.");
        throw new Error(
          "Failed to communicate with Lex after multiple attempts."
        );
      }
    }
  }
};

exports.handler = async (event) => {
  try {
    // Parsing the request body
    const body = JSON.parse(event.body);
    const userInput = body.question;

    if (!userInput) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: "Message is required" }),
      };
    }

    // Sending message to Lex
    const lexResponse = await sendMessageToLex(userInput);

    // Checking if response from Lex is valid
    if (
      !lexResponse ||
      !lexResponse.messages ||
      lexResponse.messages.length === 0
    ) {
      return {
        statusCode: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: "Invalid response from Lex" }),
      };
    }

    // Return success response
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        lexResponse: lexResponse.messages[0].content,
      }),
    };
  } catch (err) {
    console.error("Error in handler:", err.message);

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error: "Internal server error",
        details: err.message,
      }),
    };
  }
};
