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
    processMessage,
    fetchKnowledgeBasedData,
    assignHumanAgent,
    createOrder,
  } = handlers;

  // if (providedSecret !== "a11cf9f7-bda2-48a0-be3a-c56fef2b053a25") {
  //   throw new Error("Unauthorized access to workflow");
  // }

  const app = await App.findOne({ app_id });
  const instructions = await Instruction.find().lean();
  const data = app.knowledgeBase.instructions.find((curElm) => curElm.isActive);

  const systemInstruction = instructions.find((curElm) => curElm.tool === app?.service);

  const chat = getChatSession(senderId, data?.instruction, systemInstruction?.instruction || systemPrompt);
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

    if (functionCall) {
      switch (functionCall.name) {
        case "fetchProductData": {
          const searchParams = functionCall.args;
          const { results, explanation, images } = await processMessage(
            app_id,
            historyContext,
            sessionId,
            from,
            senderId,
            searchParams
          );

          const result = await chat.sendMessage([
            {
              functionResponse: {
                name: "fetchProductData",
                response: { results, explanation },
              },
            },
          ]);

          return {
            responseContent:
              result.response.candidates[0]?.content?.parts[0]?.text,
            images,
          };
        }

        case "getCompanyInfo":
          return {
            responseContent: await fetchKnowledgeBasedData(messageText, app_id),
          };

        case "submitOrder": {
          const orderDetails = functionCall.args.order_details;
          const newOrder = await createOrder(orderDetails, app_id, senderId);
          return {
            responseContent: `✅ Your order has been successfully submitted!\n\n🛒 *Order Confirmation Number:* **${newOrder.orderNumber}**`,
          };
        }

        case "collectPaymentInfo": {
          const transactionData = functionCall.args;

          if (!createTransaction)
            throw new Error("createTransaction handler not provided");
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
          if (!checkOrderDetails)
            throw new Error("checkOrderDetails handler not provided");

          const { orderNumber } = functionCall.args;
          const { responseContent, otp, order } = await checkOrderDetails(
            orderNumber,
            app_id
          );

          const result = await chat.sendMessage([
            {
              functionResponse: {
                name: "checkOrderDetails",
                response: { explanation: responseContent, otp, order },
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
    console.error("Error in handleAIFunctionWorkflow:", error);
    throw error;
  }
};

module.exports = { handleAIFunctionWorkflow };
