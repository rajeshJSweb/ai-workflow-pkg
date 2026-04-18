const handleAIFunctionWorkflow = async (
  app_id,
  messageText,
  from,
  senderId,
  sessionId,
  providedSecret,
  handlers = {},
  App,
  Instruction,
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
    checkCustomerDataAndSendEmail,
    User,
    getSystemInstruction,
    getVertexUserSession,
    checkTicketStatus,
    updateOrderDataService,
    syncOrderToCustomer
  } = handlers;

  const appData = await App.findOne({ app_id });
  const existingUser = await User.findOne({ app_id: app_id });

  let isOtpServiceEnabled = false;
  if (existingUser && existingUser.permissions) {
    isOtpServiceEnabled =
      typeof existingUser.permissions.get === "function"
        ? existingUser.permissions.get("isOtpService")
        : existingUser.permissions.isOtpService;
  }
  isOtpServiceEnabled = isOtpServiceEnabled === true;

  let currentDomain =
    typeof appData?.service === "string" ? appData.service : "BANKING";
  let matchedInstruction = null;

  if (appData?.knowledgeBase?.instructions?.length > 0) {
    const activeAppInstruction = appData.knowledgeBase.instructions.find(
      (instruction) => instruction.isActive === true,
    );
    if (activeAppInstruction) {
      matchedInstruction = activeAppInstruction;
      if (activeAppInstruction.tool) currentDomain = activeAppInstruction.tool;
    }
  }

  if (!matchedInstruction) {
    const allGlobalInstructions = await Instruction.find();
    matchedInstruction = allGlobalInstructions.find(
      (instruction) =>
        instruction.tool === appData.service && instruction.isActive,
    );
  }

  const customInstructionText =
    matchedInstruction?.instruction ||
    `You are an intelligent support assistant for ${
      appData?.company || "our service"
    }.`;

  const domain = currentDomain.toUpperCase();
  const companyName = appData?.company || "Our Service";

  const finalRobustInstruction = getSystemInstruction(
    domain,
    customInstructionText,
    companyName,
  );

  const chat = getChatSession(app_id, senderId, finalRobustInstruction);
  const currentUserState = getVertexUserSession(senderId);

  if (chat?.historyInternal) {
    chat.historyInternal.push({ role: "user", parts: [{ text: messageText }] });
  }

  try {
    let response = await chat.sendMessage(messageText);

    // ─────────────────────────────────────────────────────────────────────────
    // Extract ALL function call parts from the response (not just parts[0]).
    // Vertex AI can return multiple function calls in a single turn when the
    // model decides to call the same (or different) tools in parallel.
    // We MUST respond with exactly as many functionResponse parts as there
    // were functionCall parts — otherwise Vertex AI throws a 400 error.
    // ─────────────────────────────────────────────────────────────────────────
    let allParts = response.response?.candidates?.[0]?.content?.parts || [];
    let functionCalls = allParts.filter((p) => p.functionCall);

    let loopCount = 0;
    const MAX_LOOPS = 5;
    let productResult = null;

    while (functionCalls.length > 0 && loopCount < MAX_LOOPS) {
      loopCount++;
      console.log(
        `⚙️ [Loop ${loopCount}] Executing ${functionCalls.length} tool call(s): ${functionCalls.map((p) => p.functionCall.name).join(", ")}`,
      );

      // -----------------------------------------------------------------------
      // Execute ALL function calls in parallel, then collect all their results.
      // Each result is wrapped as a functionResponse part with the matching name.
      // -----------------------------------------------------------------------
      const toolResponseParts = await Promise.all(
        functionCalls.map(async ({ functionCall }) => {
          let toolResultResponse = {};

          switch (functionCall.name) {
            case "checkSecurityStatus": {
              const { intent } = functionCall.args;
              const isVerified = currentUserState.isVerified;

              let status = "verification_required";
              let instruction = "ACCESS DENIED. Ask for phone number.";

              console.log(
                `🛡️ OTP Check: Enabled=${isOtpServiceEnabled}, Verified=${isVerified}`,
              );

              if (!isOtpServiceEnabled) {
                status = "approved";
                instruction =
                  "ACCESS GRANTED (OTP Disabled). PROCEED IMMEDIATELY to call the requested data tool.";
              } else if (isVerified) {
                status = "approved";
                instruction = "ACCESS GRANTED. User is verified.";
              }

              toolResultResponse = { status, instruction };
              break;
            }

            case "sendOTPForVerification": {
              let { phoneNumber } = functionCall.args;
              phoneNumber = String(phoneNumber).replace(/\D/g, "");

              if (
                phoneNumber.length === 22 &&
                phoneNumber.substring(0, 11) === phoneNumber.substring(11)
              ) {
                phoneNumber = phoneNumber.substring(0, 11);
              }
              if (phoneNumber.length > 13 && phoneNumber.startsWith("880")) {
                const match = phoneNumber.match(/(01\d{9})/);
                if (match) phoneNumber = match[0];
              }

              const { status, message, generatedOtp } =
                await checkCustomerDataAndSendEmail(phoneNumber);

              if (status && generatedOtp) {
                currentUserState.currentOtp = String(generatedOtp).trim();
                currentUserState.customerPhone = phoneNumber;
                currentUserState.isVerified = false;
                console.log(`🔐 OTP SAVED: ${currentUserState.currentOtp}`);
              }
              toolResultResponse = { status, message };
              break;
            }

            case "verifyOTP": {
              const { otp } = functionCall.args;
              const storedOtp = currentUserState.currentOtp
                ? String(currentUserState.currentOtp).trim()
                : null;
              let inputOtp = otp ? String(otp).trim().replace(/\D/g, "") : "";

              if (
                inputOtp.length > 0 &&
                inputOtp.length % 2 === 0 &&
                inputOtp.substring(0, inputOtp.length / 2) ===
                  inputOtp.substring(inputOtp.length / 2)
              ) {
                inputOtp = inputOtp.substring(0, inputOtp.length / 2);
              }

              console.log(
                `🔐 VERIFYING: Input('${inputOtp}') vs Stored('${storedOtp}')`,
              );

              let isSuccess = false;
              let msg = "";

              if (!storedOtp) {
                isSuccess = false;
                msg =
                  "System Error: OTP expired/not found. Ask for phone number again.";
              } else if (storedOtp === inputOtp) {
                currentUserState.isVerified = true;
                currentUserState.currentOtp = null;
                isSuccess = true;
                msg = "Verification Successful! Access Granted.";
              } else {
                isSuccess = false;
                msg = "Verification Failed. Code incorrect.";
              }
              toolResultResponse = { status: isSuccess, message: msg };
              break;
            }

            case "checkOrderInfo": {
              let { orderNumber } = functionCall.args;
              orderNumber = String(orderNumber).trim();

              if (
                orderNumber.length > 0 &&
                orderNumber.length % 2 === 0 &&
                orderNumber.substring(0, orderNumber.length / 2) ===
                  orderNumber.substring(orderNumber.length / 2)
              ) {
                orderNumber = orderNumber.substring(0, orderNumber.length / 2);
              }

              console.log(`📦 Checking Order: ${orderNumber}`);
              const { responseContent, order } = await checkOrderDetails(
                orderNumber,
                app_id,
              );

              const cleanOrder = order
                ? {
                    id: order.orderNumber,
                    status: order.status,
                    date: order.deliveryDate,
                    address: order.customerAddress || "Not Provided",
                  }
                : "Not Found";

              toolResultResponse = {
                info: responseContent,
                order: cleanOrder,
              };
              break;
            }

            case "fetchProductData": {
              const searchParams = functionCall.args;
              console.log(
                `🔍 fetchProductData: product_name="${searchParams.product_name}"`,
                searchParams,
              );
              const googleDataFromMongo = await fetchCombinedProductData(
                app_id,
                searchParams,
              );

              // Accumulate product results across multiple parallel calls
              if (googleDataFromMongo.data?.length > 0) {
                productResult = productResult
                  ? [...productResult, ...googleDataFromMongo.data]
                  : googleDataFromMongo.data;
              }

              toolResultResponse = {
                results: googleDataFromMongo.data,
                message:
                  googleDataFromMongo.data.length > 0
                    ? "Items found."
                    : "Out of stock.",
              };
              break;
            }

            case "getKnowledgebaseAnswer": {
              const { response } = await fetchKnowledgeBasedData(
                messageText,
                app_id,
              );
              console.log(response);
              toolResultResponse = { results: response };
              break;
            }

            case "getFAQAnswer": {
              const { response } = await getFAQAnswer(messageText, app_id);
              toolResultResponse = { results: response };
              break;
            }

            case "submitOrder": {
              const newOrder = await createOrder(
                functionCall.args.order_details,
                app_id,
                senderId,
                from,
              );

              await syncOrderToCustomer({
                ...functionCall.args.order_details,
                _id: newOrder._id,
                senderId,
                from,
              });

              currentUserState.lastCreatedOrder = {
                orderNumber: newOrder.orderNumber,
                createdAt: Date.now(),
              };

              console.log(
                "✅ Session Updated with Order:",
                currentUserState.lastCreatedOrder,
              );

              toolResultResponse = {
                result: `Order Created: ${newOrder.orderNumber}`,
              };
              break;
            }

            case "assignHumanAgent": {
              console.log(
                "👨‍💻 Assigning Human Agent with details:",
                functionCall.args,
              );

              const { orderNumber, reason, customerName, customerPhone } =
                functionCall.args;

              const { responseContent } = await assignHumanAgent(
                orderNumber,
                app_id,
                senderId,
                reason,
                customerName,
                customerPhone,
              );
              toolResultResponse = { result: responseContent };
              break;
            }

            case "checkTicketStatus": {
              const { ticketNumber, customerPhone, email } = functionCall.args;
              console.log(
                `🎫 Checking Ticket Status: ID=${ticketNumber}, Phone=${customerPhone}`,
              );
              const statusResult = await checkTicketStatus(
                ticketNumber,
                customerPhone,
                email,
                app_id,
              );
              toolResultResponse = { result: statusResult };
              break;
            }

            case "updateRecentOrder": {
              const { productsToAdd, action } = functionCall.args;
              console.log(`♻️ Update Request: ${action}`, productsToAdd);

              const lastOrder = currentUserState.lastCreatedOrder;
              const ONE_HOUR = 60 * 60 * 1000;
              const isRecent =
                lastOrder && Date.now() - lastOrder.createdAt < ONE_HOUR;

              if (isRecent && lastOrder.orderNumber) {
                console.log(
                  `♻️ Updating Order #${lastOrder.orderNumber} with items:`,
                  productsToAdd,
                );
                const searchString = productsToAdd
                  .map((p) => p.productName || "")
                  .join(" ");

                const productData = await fetchCombinedProductData(app_id, {
                  query: searchString,
                });

                const foundProducts = productData.data || [];

                const enrichedProducts = productsToAdd
                  .map((requestedItem) => {
                    if (!requestedItem.productName) return null;

                    const match = foundProducts.find(
                      (p) =>
                        p.productName &&
                        p.productName
                          .toLowerCase()
                          .includes(requestedItem.productName.toLowerCase()),
                    );

                    if (match) {
                      return {
                        productName: match.productName,
                        cost: match.cost || match.price,
                        quantity: requestedItem.quantity || 1,
                        id: match.id,
                        image: match.image,
                      };
                    } else {
                      console.warn(
                        `⚠️ Product not found in DB or Price missing: ${requestedItem.productName}`,
                      );
                      return null;
                    }
                  })
                  .filter((item) => item !== null);

                if (enrichedProducts.length === 0) {
                  toolResultResponse = {
                    error:
                      "I couldn't verify the products in our database. Please check the product names and try again.",
                  };
                  break;
                }

                const updateResult = await updateOrderDataService(
                  app_id,
                  lastOrder.orderNumber,
                  { newProducts: enrichedProducts },
                );

                if (updateResult.success) {
                  const addedItemsList = enrichedProducts
                    .map((p) => p.productName)
                    .join(", ");
                  toolResultResponse = {
                    result: `✅ Successfully updated Order #${lastOrder.orderNumber}. Added: ${addedItemsList}. New Total Cost: ${updateResult.order.totalCost}.`,
                  };
                } else {
                  toolResultResponse = {
                    error: `❌ Failed to update order: ${updateResult.message}`,
                  };
                }
              } else {
                toolResultResponse = {
                  error:
                    "No active recent order found in this session. Please proceed to create a NEW order using 'submitOrder'.",
                };
              }
              break;
            }

            default:
              console.warn(`⚠️ Unknown Tool: ${functionCall.name}`);
              toolResultResponse = { error: "Unknown tool" };
              break;
          }

          // Return a properly shaped functionResponse part for this call
          return {
            functionResponse: {
              name: functionCall.name,
              response: toolResultResponse,
            },
          };
        }),
      );

      // -----------------------------------------------------------------------
      // Send ALL function responses back in ONE message.
      // The number of parts here MUST equal the number of function call parts
      // that Vertex AI returned — this is what fixes the 400 error.
      // -----------------------------------------------------------------------
      response = await chat.sendMessage(toolResponseParts);

      allParts = response.response?.candidates?.[0]?.content?.parts || [];
      functionCalls = allParts.filter((p) => p.functionCall);
    }

    const textResponse =
      response.response?.candidates?.[0]?.content?.parts?.find((p) => p.text)
        ?.text;

    const usedTools =
      response.response?.candidates?.[0]?.content?.parts
        ?.filter((p) => p.functionCall)
        ?.map((p) => p.functionCall.name) || [];

    const shouldClearCache = usedTools.some((tool) =>
      ["submitOrder", "updateRecentOrder", "confirmOrder"].includes(tool),
    );

    return {
      responseContent: textResponse || " ",
      searchParams: undefined,
      foundProducts: productResult,
      shouldClearCache,
    };
  } catch (error) {
    console.error("❌ Error in handleAIFunctionWorkflow:", error.message);
    throw error;
  }
};

module.exports = { handleAIFunctionWorkflow };