module.exports = {
  apiResponseStatusCode: {
    200: "OK",
    201: "Created",
    400: "Bad Request",
    401: "Unauthorized",
    404: "Not Found",
    406: "Not Acceptable",
    422: "Unprocessable Entity",
    500: "Internal Server Error",
  },

  statusCodes: {
    OK: 200,
    Created: 201,
    "Bad Request": 400,
    Unauthorized: 401,
    "Not Found": 404,
    "Not Acceptable": 406,
    "Unprocessable Entity": 422,
    "Internal Server Error": 500,
  },

  defaultResponseMessage: {
    CREATED: "Your new resource has been created successfully!",
    FETCHED: "Here's the resource you requested.",
    UPDATED: "Changes saved! Your resource has been updated.",
    DELETED: "The resource has been deleted.",
    NOT_FOUND: "Sorry, we couldn't find what you're looking for.",
    DISABLED: "The resource has been disabled.",
    ENABLED: "The resource is now enabled.",
    DATABASE: "Connected to MongoDB",
    DATABASE_ERROR: "Error connecting to MongoDB:",
    PORT: "Server is running on port:",
  },
};
