


const submitOrder = {
  name: "submitOrder",
  description:"Finalize and submit customer order. REQUIRES full order details in exact format: {name: string, phone: string, email: string, address: string, products: [{product_name: string, price: number}]}",
  parameters: {
    type: "object",
    properties: {
      order_details: {
        type: "object",
        properties: {
          name: { type: "string" },
          phone: { type: "string" },
          email: { type: "string" },
          address: { type: "string" },
          products: {
            type: "array",
            items: {
              type: "object",
              properties: {
                product_name: { type: "string" },
                price: { type: "number" },
              },
            },
          },
          grand_total: { type: "number" },
        },
        required: [
          "name",
          "phone",
          "email",
          "address",
          "products",
          "grand_total",
        ],
      },
    },
    required: ["order_details"],
  },
};

module.exports = submitOrder;
