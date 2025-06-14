const assignHumanAgent = {
  name: "assignHumanAgent",
  description:
    "Call this function when a user expresses dissatisfaction, delivery issues, complaints, or explicitly asks to speak with a human agent. If the user already provided an order number earlier in the conversation, reuse it instead of asking again. Every time this is called, a new ticket must be generated and a human agent must be assigned.",
  parameters: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description:
          "Summarize the user's reason for escalating to a human agent, such as 'order not received' or 'wrong item delivered'.",
      },
      orderNumber: {
        type: "string",
        description:
          "The user's order number (should be reused from previous messages if already provided).",
      },
    },
    required: ["reason", "orderNumber"],
  },
};

module.exports = assignHumanAgent;