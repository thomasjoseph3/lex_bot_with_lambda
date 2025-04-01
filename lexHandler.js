const { LexRuntimeV2Client, RecognizeTextCommand } = require("@aws-sdk/client-lex-runtime-v2");

const lexClient = new LexRuntimeV2Client({ region: "eu-west-2" });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sendMessageToLex = async (inputText, sessionId, maxRetries = 3) => {
  const params = {
    botId: process.env.BOT_ID,
    botAliasId: process.env.BOT_ALIAS_ID,
    localeId: "en_US",
    sessionId: sessionId,
    text: inputText,
  };

  let attempts = 0;
  while (attempts < maxRetries) {
    try {
      const command = new RecognizeTextCommand(params);
      const response = await lexClient.send(command);
      return response;
    } catch (err) {
      attempts += 1;
      console.error(`Attempt ${attempts} failed: ${err.message}`);
      if (attempts < maxRetries) {
        const delay = Math.pow(2, attempts) * 100;
        console.info(`Retrying after ${delay}ms...`);
        await wait(delay);
      } else {
        throw new Error("Failed to communicate with Lex after multiple attempts");
      }
    }
  }
};

exports.handler = async (event) => {
  try {
    console.log("Env vars:", process.env.BOT_ID, process.env.BOT_ALIAS_ID);
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

    const sessionId = Date.now().toString(); // Unique per request
    const lexResponse = await sendMessageToLex(userInput, sessionId);

    if (!lexResponse || !lexResponse.messages || lexResponse.messages.length === 0) {
      return {
        statusCode: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: "Invalid response from Lex" }),
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        answer: lexResponse.messages[0].content, 
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
      body: JSON.stringify({ error: "Internal server error", details: err.message }),
    };
  }
};