

const fetchProductData = {
  name: "fetchProductData",
  description:
    "Fetch product information from database for any product-related queries.",
  parameters: {
    type: "object",
    properties: {
      product_name: {
        type: "string",
        description: "Full or partial product name to search for",
      },
      category: {
        type: "string",
        description:
          "Category of the product (e.g., electronics, clothing, furniture)",
      },
    },
    required: ["product_name"],
  },
  response: {
    type: "object",
    properties: {
      results: { type: "array" },
      explanation: { type: "string" },
    },
  },
};

module.exports = fetchProductData;
