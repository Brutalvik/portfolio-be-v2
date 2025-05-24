import fastify from "fastify";
import awsLambdaFastify from "@fastify/aws-lambda";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Create a Fastify instance
const app = fastify({
  logger: true,
});

const REGION = process.env.REGION;
const S3_BUCKET_NAME = process.env.country - codes_BUCKET;
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN;

// Check if essential environment variables are set
if (!S3_BUCKET_NAME) {
  console.error("S3_BUCKET_NAME environment variable is not set.");
  process.exit(1);
}
if (!CLOUDFRONT_DOMAIN) {
  console.error("CLOUDFRONT_DOMAIN environment variable is not set.");
  process.exit(1);
}

// Function to get the CloudFront URL for a file
const getCloudFrontUrl = (fileKey) => {
  const cleanFileKey = fileKey.startsWith("/") ? fileKey.substring(1) : fileKey;
  // Construct the URL using the CloudFront domain and the S3 object key
  return `${CLOUDFRONT_DOMAIN}/${cleanFileKey}`;
};

// Route for the root path
app.get("/health", async (request, reply) => {
  return {
    status: "ok",
    message: "API is healthy",
  };
});

app.get("/", async (request, reply) => {
  return {
    message: "Welcome to the VBytes Language Dataset API",
    version: "1.0.0",
    routes: [
      { method: "GET", path: "/health", description: "Health check" },
      {
        method: "GET",
        path: "/country-codes",
        description: "Get List of country-codes (served via CloudFront)",
      },
    ],
  };
});

// Route to get the file URL via CloudFront
app.get("/country-codes", async (request, reply) => {
  try {
    const { file } = request.query;
    if (!file) {
      return reply.status(400).send({
        error: "Missing file parameter",
        message:
          "The 'file' query parameter is required (e.g., ?file=data.json).",
      });
    }

    const fileUrl = getCloudFrontUrl(file);

    // Note: We cannot check if the file *exists* on S3 directly here without an S3 HEAD request,
    // which would make this API slower. CloudFront will handle the 404 if the file is not found.
    // So, we just redirect to the CloudFront URL.
    reply.redirect(fileUrl, 302);
  } catch (error) {
    console.error("Error in /country-codes route:", error);
    reply.status(500).send({
      error: `Failed to generate CloudFront URL for ${request.query.file}`,
      message: error.message,
    });
  }
});

// Lambda handler (for deploying as a Lambda function)
export const handler = awsLambdaFastify(app);

// Local testing
if (process.env.NODE_ENV === "test") {
  app.listen({ port: 5000 }, (err) => {
    if (err) {
      console.error("Error starting server:", err);
    } else {
      console.log("Server listening on http://localhost:5000");
    }
  });
}
