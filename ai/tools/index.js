const assignHumanAgent = require("./assignHumanAgent");
const checkOrderInfo = require("./checkOrderInfo");
const collectPaymentInfo = require("./collectPaymentInfo");
const fetchCompanyData = require("./fetchCompanyData");
const fetchProductData = require("./fetchData");
const submitOrder = require("./submitOrder");

const functionDeclarations = [
  {
    functionDeclarations: [
      fetchProductData,
      submitOrder,
      checkOrderInfo,
      fetchCompanyData,
      collectPaymentInfo,
      assignHumanAgent,
    ],
  },
];

module.exports = functionDeclarations;
