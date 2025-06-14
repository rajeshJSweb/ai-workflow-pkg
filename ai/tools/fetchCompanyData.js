


const fetchCompanyData = {
  name: "getCompanyInfo",
  description:
    "MUST be called for company-related questions (e.g., office locations, FAQs, policies, system-related queries).",
  parameters: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description:
          "The specific company-related question (e.g., 'Where is the office located?', 'What is the return policy?')",
      },
    },
    required: ["question"],
  },
};

module.exports = fetchCompanyData;
