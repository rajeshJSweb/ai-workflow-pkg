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
  console.log("✅ Package successfully installed and working as expected.");
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

  const appData = await App.findOne({ app_id });
  let matchedInstruction = null;

  if (appData?.knowledgeBase?.instructions?.length > 0) {
    matchedInstruction = appData.knowledgeBase.instructions.find(
      (instruction) =>
        instruction.isActive && instruction.tool === appData.service
    );
  }

  if (!matchedInstruction) {
    const allGlobalInstructions = await Instruction.find();
    matchedInstruction = allGlobalInstructions.find(
      (instruction) =>
        instruction.tool === appData.service && instruction.isActive
    );
  }

  const chat = getChatSession(senderId, matchedInstruction);

  if (chat?.historyInternal) {
    chat.historyInternal.push({
      role: "user",
      parts: [{ text: messageText }],
    });
  }

  try {
    const response = await chat.sendMessage(messageText);
    const candidates = response.response?.candidates || response.candidates;
    const functionCall = candidates?.[0]?.content?.parts?.[0]?.functionCall;

    if (functionCall) {
      switch (functionCall.name) {
        case "fetchProductData": {
          const searchParams = functionCall.args;
          const googleDataFromMongo = await fetchCombinedProductData(
            app_id,
            searchParams
          );

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
            searchParams,
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
                response: { results: response },
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
                response: { results: response },
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
                  otp,
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
