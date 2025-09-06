const { systemPrompt } = require("./ai/instruction/systemPrompt");

require("dotenv").config();

const handleAIFunctionWorkflow = async (
  app_id,
  messageText,
  from,
  senderId,
  sessionId,
  providedSecret,
  handlers = {},
  App,
  Instruction
) => {
  const {
    getChatSession,
    createTransaction,
    checkOrderDetails,
    fetchKnowledgeBasedData,
    assignHumanAgent,
    createOrder,
    getFAQAnswer,
    fetchCombinedProductData,
  } = handlers;

  // if (providedSecret !== "a11cf9f7-bda2-48a0-be3a-c56fef2b053a25") {
  //   throw new Error("Unauthorized access to workflow");
  // }

  const app = await App.findOne({ app_id });
  const instructions = await Instruction.find().lean();
  const data = app.knowledgeBase.instructions.find((curElm) => curElm.isActive);

  const systemInstruction = instructions.find(
    (curElm) => curElm.tool === app?.service
  );

  const defaultInstruction =
    "You are a helpful, knowledgeable, and friendly assistant for our brand who communicates clearly and concisely. Always be polite and professional.";

  const chat = getChatSession(
    senderId,
    data?.instruction,
    systemInstruction?.instruction || defaultInstruction
  );
  const roleMap = { user: "User", function: "Data", assistant: "Assistant" };

  if (chat?.historyInternal) {
    chat.historyInternal.push({ role: "user", parts: [{ text: messageText }] });
  }

  try {
    const historyContext = chat.historyInternal
      .map(
        (msg) =>
          `${roleMap[msg.role]}: ${
            msg.role === "function" ? msg.content : msg.parts[0].text
          }`
      )
      .join("\n");

    const response = await chat.sendMessage(messageText);
    const candidates = response.response?.candidates || response.candidates;
    const functionCall = candidates?.[0]?.content?.parts?.[0]?.functionCall;

    console.log("Function Call:", functionCall);

    if (functionCall) {
      switch (functionCall.name) {
        case "fetchProductData": {
          const searchParams = functionCall.args;
          const googleDataFromMongo = await fetchCombinedProductData(
            app_id,
            searchParams
          );
          console.log("From Workflow:-", googleDataFromMongo.data.length);

          const result = await chat.sendMessage([
            {
              functionResponse: {
                name: "fetchProductData",
                response: {
                  results: googleDataFromMongo.data,
                  explanation: null,
                },
              },
            },
          ]);
          return {
            responseContent:
              result.response.candidates[0]?.content?.parts[0]?.text,
            searchParams: searchParams,
          };
        }

        case "getKnowledgebaseAnswer": {
          const { response } = await fetchKnowledgeBasedData(
            messageText,
            app_id
          );
          const result = await chat.sendMessage([
            {
              functionResponse: {
                name: "getKnowledgebaseAnswer",
                response: {
                  results: response,
                },
              },
            },
          ]);
          return {
            responseContent:
              result.response.candidates[0]?.content?.parts[0]?.text,
          };
        }

        case "getFAQAnswer": {
          const { response } = await getFAQAnswer(messageText, app_id);

          const result = await chat.sendMessage([
            {
              functionResponse: {
                name: "getFAQAnswer",
                response: {
                  results: response,
                },
              },
            },
          ]);
          return {
            responseContent:
              result.response.candidates[0]?.content?.parts[0]?.text,
          };
        }

        case "submitOrder": {
          const orderDetails = functionCall.args.order_details;
          const newOrder = await createOrder(orderDetails, app_id, senderId);

          // console.log("Order details args", orderDetails);
          return {
            responseContent: `✅ Your order has been successfully submitted!\n\n🛒 *Order Confirmation Number:* **${newOrder.orderNumber}**\n\nThank you for shopping with us! 🎉`,
          };
        }

        case "collectPaymentInfo": {
          const transactionData = functionCall.args;
          const { responseContent } = await createTransaction(transactionData);
          return { responseContent };
        }

        case "assignHumanAgent": {
          const { orderNumber, reason } = functionCall.args;
          const { responseContent } = await assignHumanAgent(
            orderNumber,
            app_id,
            senderId,
            reason
          );

          return { responseContent };
        }

        case "checkOrderDetails": {
          const { orderNumber } = functionCall.args;
          const { responseContent, otp, order } = await checkOrderDetails(
            orderNumber,
            app_id
          );

          const result = await chat.sendMessage([
            {
              functionResponse: {
                name: "checkOrderDetails",
                response: {
                  explanation: responseContent,
                  otp: otp,
                  order,
                },
              },
            },
          ]);

          return {
            responseContent:
              result.response.candidates[0]?.content?.parts[0]?.text,
          };
        }
        case "getCompanyInfo": {
          const { response } = await fetchKnowledgeBasedData(
            messageText,
            app_id
          );

          const result = await chat.sendMessage([
            {
              functionResponse: {
                name: "getCompanyInfo",
                response: {
                  results: response,
                },
              },
            },
          ]);
          return {
            responseContent:
              result.response.candidates[0]?.content?.parts[0]?.text,
          };
        }
      }
    }

    const textResponse = candidates?.[0]?.content?.parts?.[0]?.text;
    return { responseContent: textResponse };
  } catch (error) {
    console.error("Error in handleConversationFlow:", error);
    throw error;
  }
};

module.exports = { handleAIFunctionWorkflow };
