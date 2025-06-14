const checkOrderInfo = {
  name: "checkOrderDetails",
  description:
    "Should be called when a customer asks about the status, details, or any issues related to an order by providing an order number.",
  parameters: {
    type: "object",
    properties: {
      orderNumber: {
        type: "string",
        description:
          "The unique identifier for the customer's order, used to retrieve its status and details.",
      },
    },
    required: ["orderNumber"],
  },
  response: {
    type: "object",
    properties: {
      explanation: { type: "string" },
      otp: {
        type: "string",
        description:
          "Don't share this OTP with the customer; only use it for verification when customer provides it.",
      },
      order: {
        type: "object",
        description:
          "Limited order details based on user's question. and dont show order details if otp is not verified",
        properties: {
          orderNumber: { type: "string" },
          status: { type: "string" },
          customerName: { type: "string" },
          deliveryDate: { type: "string", format: "date-time" },
        },
        required: ["orderNumber", "status"],
      },
    },
  },
};

module.exports = checkOrderInfo;
