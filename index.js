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

  if (!matchedInstruction) {
    matchedInstruction = `You are an intelligent, friendly, and professional support assistant. 
Your goal is to help users clearly, efficiently, and politely with any questions related to this app’s service: ${appData?.company}`;
  }

  const chat = getChatSession(app_id, senderId, matchedInstruction);

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

    console.log(`📦 Package installation verified — working as expected.`);
    console.log(
      `⚙️ Function call executed successfully: "${
        functionCall?.name || "Unknown"
      }"`
    );

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

const { downsampleTo16k } = require("./src/utils/audioResampler");
const { isNonZeroBuffer } = require("./src/utils/isNonZeroBuffer");

const activeCalls = new Map();

const handleWhatsAppVoiceCallServices = async (change, wrtc, handlers) => {
  const {
    RTCPeerConnection,
    RTCSessionDescription,
    RTCAudioSink,
    RTCAudioSource,
  } = wrtc;
  const {
    sendPreAccept,
    sendAccept,
    createLiveAiSession,
    handleTurn,
    AudioStreamer,
  } = handlers;

  console.log(
    `👽 WhatsApp Calling Package installation verified — working as expected.`
  );

  const call = change?.value?.calls?.[0];
  const phoneNumberId = change?.value?.metadata?.phone_number_id;
  const callId = call?.id;
  const senderId = call?.from;

  if (!call || !phoneNumberId || !callId) {
    console.warn("Invalid webhook payload for call - missing fields.");
    return;
  }

  if (call.event === "terminate" && call.status === "COMPLETED") {
    const callContext = activeCalls.get(callId);
    if (callContext) {
      console.log("⛔ Terminate whatsApp call, cleaning up call:", senderId);
      callContext.cleanup();
    }
    return;
  }

  if (!(call?.session?.sdp && call?.session?.sdp_type === "offer")) {
    console.log("No SDP offer in webhook. Ignoring.");
    return;
  }

  console.log(`📞 Incoming call from ${senderId}, Call ID: ${callId}`);

  const callContext = {
    phoneNumberId,
    senderId,
    callId,
    pc: null,
    audioSink: null,
    audioSource: null,
    streamer: null,
    geminiSession: null,
    responseQueue: [],
    audioParts: [],
    welcomeMessageSent: false,
    audioChunkCount: 0,
    CHUNKS_BEFORE_RESPONSE: 50,
    cleanup: null,
    activeCalls: activeCalls,
  };

  const cleanup = () => {
    console.log(`🧹 Cleaning up resources for call: ${callContext.callId}`);
    try {
      if (callContext.audioSink) callContext.audioSink.stop();
    } catch (e) {
      console.error("Error stopping audioSink:", e.message);
    }
    try {
      if (callContext.pc) callContext.pc.close();
    } catch (e) {
      console.error("Error closing peer connection:", e.message);
    }
    try {
      if (callContext.geminiSession) callContext.geminiSession.close();
    } catch (e) {
      console.error("Error closing Gemini session:", e.message);
    }
    activeCalls.delete(callContext.callId);
  };
  callContext.cleanup = cleanup;

  try {
    callContext.geminiSession = await createLiveAiSession(callContext);

    const iceServers = [
      { urls: "stun:stun.l.google.com:19302" },
      {
        urls: "turn:15.235.209.104:3478",
        username: "rajesh",
        credential: "khoksi",
      },
    ];

    callContext.pc = new RTCPeerConnection({ iceServers });

    callContext.audioSource = new RTCAudioSource();
    callContext.streamer = new AudioStreamer(callContext.audioSource);
    const audioTrack = callContext.audioSource.createTrack();
    callContext.pc.addTrack(audioTrack);
    callContext.pc.addTransceiver("audio", { direction: "recvonly" });

    callContext.pc.ontrack = (event) => {
      try {
        const [track] = event.streams[0].getAudioTracks();
        if (!track) return;

        callContext.audioSink = new RTCAudioSink(track);

        callContext.audioSink.ondata = (data) => {
          try {
            const downBuffer = downsampleTo16k(data.samples, data.sampleRate);

            if (
              callContext.pc.iceConnectionState === "completed" &&
              isNonZeroBuffer(downBuffer)
            ) {
              const base64Audio = downBuffer.toString("base64");
              callContext.geminiSession.sendRealtimeInput({
                audio: {
                  mimeType: "audio/pcm",
                  rate: 16000,
                  data: base64Audio,
                },
              });

              callContext.audioChunkCount++;
              if (
                callContext.audioChunkCount %
                  callContext.CHUNKS_BEFORE_RESPONSE ===
                0
              ) {
                handleTurn(callContext);
              }
            }
          } catch (e) {
            console.error("Error in audioSink.ondata:", e.message);
          }
        };

        callContext.audioSink.onerror = (err) =>
          console.error("❌ RTCAudioSink error:", err.message);
      } catch (err) {
        console.error("Error handling pc.ontrack:", err.message);
      }
    };

    callContext.pc.oniceconnectionstatechange = async () => {
      console.log(
        `ICE Connection State for ${callContext.callId}: ${callContext.pc.iceConnectionState}`
      );
      if (
        (callContext.pc.iceConnectionState === "connected" ||
          callContext.pc.iceConnectionState === "completed") &&
        !callContext.welcomeMessageSent
      ) {
        callContext.welcomeMessageSent = true;

        try {
          await callContext.geminiSession.sendClientContent({
            turns: [
              {
                role: "user",
                parts: [
                  {
                    text: "The WhatsApp voice call has just connected. Please greet the user in your role as AiDOse AI, the official voice assistant for AiDOse.Do not mention Gemini or AI models. Greet warmly and professionally, and ask how you may assist today.",
                  },
                ],
              },
            ],
          });
        } catch (err) {
          console.error("❌ Error playing welcome message:", err.message);
        }
      }

      if (
        callContext.pc.iceConnectionState === "failed" ||
        callContext.pc.iceConnectionState === "disconnected" ||
        callContext.pc.iceConnectionState === "closed"
      ) {
        console.log(
          `⚠️ Peer connection for ${callContext.callId} failed/closed.`
        );
        cleanup();
      }
    };

    await callContext.pc.setRemoteDescription(
      new RTCSessionDescription({ type: "offer", sdp: call.session.sdp })
    );
    const answer = await callContext.pc.createAnswer();
    await callContext.pc.setLocalDescription(answer);

    const sdpAnswer = callContext.pc.localDescription.sdp;
    await sendPreAccept(phoneNumberId, callId, sdpAnswer);
    await sendAccept(phoneNumberId, callId, sdpAnswer);

    activeCalls.set(callId, callContext);
  } catch (err) {
    console.error("❌ Error in main try-catch block:", err.message);
    cleanup();
  }
};

module.exports = { handleAIFunctionWorkflow, handleWhatsAppVoiceCallServices };
