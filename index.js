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
    initializeGeminiTextModel,
    createTransaction,
    checkOrderDetails,
    fetchKnowledgeBasedData,
    assignHumanAgent,
    createOrder,
    getFAQAnswer,
    fetchCombinedProductData,
    checkCustomerDataAndSendEmail,
    User,
    system_instruction_for_gemini_3,
    getVertexUserSession,
    updateOrderDataService,
    syncOrderToCustomer,
    buildCustomerContextSummary,
    restoreSessionFromDB,
    buildContextSummary,
    getCustomerByPlatformId,
    getRecentOrderByUser,
    getRecentConversationMessages,
    saveVertexUserSession,
    sendMessageWithRetry,
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

  const finalRobustInstruction = system_instruction_for_gemini_3(
    domain,
    customInstructionText,
    companyName,
  );

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1: Session restore
  // ─────────────────────────────────────────────────────────────────────────
  let currentUserState;
  if (
    typeof restoreSessionFromDB === "function" &&
    typeof getRecentOrderByUser === "function"
  ) {
    currentUserState = await restoreSessionFromDB(
      senderId,
      getRecentOrderByUser,
      app_id,
    );
  } else {
    currentUserState = await getVertexUserSession(senderId, app_id);
  }
  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2: Customer profile fetch
  // ─────────────────────────────────────────────────────────────────────────
  let customerProfile = null;
  if (typeof getCustomerByPlatformId === "function") {
    try {
      customerProfile = await getCustomerByPlatformId(senderId, app_id);
    } catch (e) {
      console.warn(`Customer profile fetch failed for ${senderId}:`, e.message);
    }
  }

  const chat = await initializeGeminiTextModel(
    app_id,
    senderId,
    finalRobustInstruction,
  );

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 3: Recent conversation messages fetch
  // Human agent detection
  // ─────────────────────────────────────────────────────────────────────────
  let recentMessages = [];
  if (typeof getRecentConversationMessages === "function") {
    try {
      const conversationDocs = await getRecentConversationMessages(
        senderId,
        app_id,
      );
      const latestDoc = Array.isArray(conversationDocs)
        ? conversationDocs[0]
        : null;
      if (latestDoc && Array.isArray(latestDoc.messages)) {
        const allMessages = latestDoc.messages.filter(
          (m) => m.text && m.text.trim().length > 0,
        );
        const agentMessages = allMessages.filter(
          (m) => m.sender === "assistant" && m.assistantInfo?.name,
        );

        const regularMessages = allMessages.slice(-20);

        const agentMids = new Set(regularMessages.map((m) => String(m.id)));
        const missedAgentMsgs = agentMessages
          .filter((m) => !agentMids.has(String(m.id)))
          .slice(-3);

        recentMessages = [...missedAgentMsgs, ...regularMessages];
      }
    } catch (e) {
      console.warn("Could not fetch recent conversation messages:", e.message);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 4: Context summary build
  // ─────────────────────────────────────────────────────────────────────────
  let contextSummary = "";

  if (typeof buildCustomerContextSummary === "function") {
    contextSummary = buildCustomerContextSummary(
      currentUserState,
      customerProfile,
      recentMessages,
      from,
    );
  } else if (typeof buildContextSummary === "function") {
    contextSummary = buildContextSummary(currentUserState, recentMessages);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 5: Context injection into historyInternal
  // ─────────────────────────────────────────────────────────────────────────
  if (contextSummary && chat?.historyInternal) {
    const alreadyInjected = chat.historyInternal.some(
      (entry) =>
        entry.role === "model" &&
        entry.parts?.[0]?.text?.startsWith("[SYSTEM CONTEXT]"),
    );

    if (!alreadyInjected) {
      chat.historyInternal.unshift({
        role: "model",
        parts: [{ text: contextSummary }],
      });
      chat.historyInternal.unshift({
        role: "user",
        parts: [{ text: "[context-restore]" }],
      });
      console.log(`Context injected for: ${senderId}`);
    } else {
      const modelEntryIndex = chat.historyInternal.findIndex(
        (entry) =>
          entry.role === "model" &&
          entry.parts?.[0]?.text?.startsWith("[SYSTEM CONTEXT]"),
      );
      if (modelEntryIndex !== -1) {
        chat.historyInternal[modelEntryIndex].parts[0].text = contextSummary;
      }
    }
  }

  if (chat?.historyInternal) {
    chat.historyInternal.push({ role: "user", parts: [{ text: messageText }] });
  }

  try {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalTokens = 0;

    // let response = await chat.sendMessage(messageText);
    let response = await sendMessageWithRetry(chat, messageText);

    const usage = response.response.usageMetadata;
    if (usage) {
      totalInputTokens += usage.promptTokenCount || 0;
      totalOutputTokens += usage.candidatesTokenCount || 0;
      totalTokens += usage.totalTokenCount || 0;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Extract ALL function call parts from the response (not just parts[0]).
    // ─────────────────────────────────────────────────────────────────────────
    let allParts = response.response?.candidates?.[0]?.content?.parts || [];
    let functionCalls = allParts.filter((p) => p.functionCall);

    let loopCount = 0;
    const MAX_LOOPS = 5;
    let productResult = null;

    while (functionCalls.length > 0 && loopCount < MAX_LOOPS) {
      loopCount++;

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
              console.log(functionCall.args);
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
              const searchParams = functionCall.args;
              console.log(functionCall.args);
              const { response } = await fetchKnowledgeBasedData(
                searchParams,
                app_id,
              );
              toolResultResponse = { results: response };
              break;
            }

            case "getFAQAnswer": {
              const searchParams = functionCall.args;
              console.log(functionCall.args);
              const { response } = await getFAQAnswer(searchParams, app_id);
              toolResultResponse = { results: response };
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

              if (typeof saveVertexUserSession === "function") {
                await saveVertexUserSession(senderId, app_id, currentUserState);
              }
              toolResultResponse = {
                result: `Order Created: ${newOrder.orderNumber}`,
              };
              break;
            }

            case "updateRecentOrder": {
              const { productsToAdd, action } = functionCall.args;
              console.log(`♻️ Update Request: ${action}`, productsToAdd);
              let orderNumberToUpdate = null;

              if (
                customerProfile &&
                Array.isArray(customerProfile.purchaseHistory)
              ) {
                const recentPendingOrder = customerProfile.purchaseHistory
                  .filter((o) => o.status === "Pending")
                  .sort(
                    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
                  )[0];
                orderNumberToUpdate = recentPendingOrder?.orderNumber || null;
              }

              const searchString = productsToAdd
                .map((p) => p.productName || "")
                .join(" ");

              const productData = await fetchCombinedProductData(app_id, {
                query: searchString,
              });
              const foundProducts = productData.data || [];

              const enrichedProducts = productsToAdd
                .map((requestedItem) => {
                  if (!requestedItem.productName && !requestedItem.productId)
                    return null;

                  let match = null;

                  if (requestedItem.productId) {
                    match = foundProducts.find(
                      (p) => p.id === requestedItem.productId,
                    );
                  }

                  if (!match && requestedItem.productName) {
                    match = foundProducts.find((p) => {
                      const dbName =
                        p.productName === "Unknown Product" || !p.productName
                          ? p._original?.name ||
                            p._original?.productName ||
                            p.name ||
                            ""
                          : p.productName;

                      return dbName
                        .toLowerCase()
                        .includes(requestedItem.productName.toLowerCase());
                    });
                  }

                  if (!match) return null;

                  const resolvedName =
                    match.productName === "Unknown Product" ||
                    !match.productName
                      ? requestedItem.productName
                      : match.productName;

                  return {
                    productName: resolvedName,
                    cost: Number(match.cost || match.price),
                    quantity: requestedItem.quantity || 1,
                    id: match.id,
                    image: match.image,
                  };
                })
                .filter((item) => item !== null);

              if (enrichedProducts.length === 0) {
                toolResultResponse = {
                  error: "I couldn't verify the products in our database.",
                };
                break;
              }

              if (orderNumberToUpdate) {
                const updateResult = await updateOrderDataService(
                  app_id,
                  orderNumberToUpdate,
                  { newProducts: enrichedProducts, action: action },
                );

                if (updateResult.success) {
                  toolResultResponse = {
                    result: `✅ Order #${orderNumberToUpdate} updated successfully. New Total Cost: ${updateResult.order.totalCost}.`,
                  };
                } else {
                  toolResultResponse = {
                    error: `❌ Failed to update order: ${updateResult.message}`,
                  };
                }
              } else {
                console.log(
                  `🆕 No recent pending order found. Creating new order...`,
                );

                const orderDetails = {
                  name: customerProfile?.name || "Customer",
                  phone: customerProfile?.phone || "",
                  address:
                    customerProfile?.addresses?.[0]?.addressLine ||
                    "Address not specified",
                  products: enrichedProducts.map((p) => ({
                    product_name: p.productName,
                    price: p.cost,
                    quantity: p.quantity,
                  })),
                  deliveryCost: null,
                  discount_amount: 0,
                };

                const newOrder = await createOrder(
                  orderDetails,
                  app_id,
                  senderId,
                  from,
                );

                currentUserState.lastCreatedOrder = {
                  orderNumber: newOrder.orderNumber,
                  createdAt: Date.now(),
                };

                toolResultResponse = {
                  result: `✅ No pending order found. Created new order: ${newOrder.orderNumber}.`,
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

      const loopUsage = response.response.usageMetadata;
      if (loopUsage) {
        totalInputTokens += loopUsage.promptTokenCount || 0;
        totalOutputTokens += loopUsage.candidatesTokenCount || 0;
        totalTokens += loopUsage.totalTokenCount || 0;
      }

      allParts = response.response?.candidates?.[0]?.content?.parts || [];
      functionCalls = allParts.filter((p) => p.functionCall);
    }

    const textResponse =
      response.response?.candidates?.[0]?.content?.parts?.find(
        (p) => p.text,
      )?.text;

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
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalTokens,
      },
    };
  } catch (error) {
    console.error(
      "❌ Vertex AI Error:",
      error.message || "Unknown error occurred",
    );
    return {
      responseContent: null,
      shouldClearCache: false,
      errorType: "AI_TIMEOUT",
    };
  }
};

module.exports = { handleAIFunctionWorkflow };
