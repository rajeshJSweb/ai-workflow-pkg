const Transaction = require("../models/transaction.model");


exports.createTransaction = async (transactionData) => {
  try {
    // Check if the transaction already exists
    const existingTransaction = await Transaction.findOne({
      transactionId: transactionData.transactionId,
    });

    if (existingTransaction) {
      return {
        responseContent: `Duplicate transaction detected! The transaction already exists in the system.\n\n**Transaction ID:** ${transactionData.transactionId}`,
        error: "DuplicateTransaction",
        transaction: existingTransaction,
      };
    }

    // Save new transaction if it doesn't exist
    const transaction = new Transaction(transactionData);
    await transaction.save();

    return {
      responseContent: "Payment information collected successfully",
      transaction,
    };
  } catch (error) {
    console.error("Error processing transaction:", error);
    return {
      responseContent: "An error occurred while processing the transaction.",
      error: error.message,
    };
  }
};
