const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({
  amount: { type: String, required: true },
  biller: { type: String, required: true },
  fee: { type: String, default: "Tk 0.00" },
  transactionDate: { type: String, required: true },
  status: { type: String, required: true },
  account: { type: String, required: true },
  contact: { type: String, required: false },
  transactionId: { type: String, unique: true, required: true },
});

const Transaction = mongoose.model("Transaction", transactionSchema);
module.exports = Transaction;
