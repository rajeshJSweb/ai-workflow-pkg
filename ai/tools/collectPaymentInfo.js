


const collectPaymentInfo = {
  name: "collectPaymentInfo",
  description:
    "MUST be called for ANY payment/transaction messages image Content Analysis. Extract...",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        description:
          "Transaction status: 'Completed', 'Declined', 'Verification', or raw status text",
      },
      biller: {
        type: "string",
        description: "Merchant name if no phone number (e.g. OVHcloud)",
      },
      contact: {
        type: "string",
        description: "Optional customer reference",
        default: "N/A",
      },
      account: {
        type: "string",
        description: "Card number (masked or full)",
      },
      amount: {
        type: "string",
        description: "Transaction amount with currency",
      },
      fee: {
        type: "string",
        description: "Optional fee amount",
        default: "0.00",
      },
      transactionId: {
        type: "string",
        description: "Client ID if no TrxID available",
      },
      transactionDate: {
        type: "string",
        description: "Date in DD-MMM-YYYY format",
      },
    },
    required: [
      "status",
      "biller",
      "account",
      "amount",
      "transactionId",
      "transactionDate",
      "fee",
    ],
  },
};

module.exports = collectPaymentInfo;
