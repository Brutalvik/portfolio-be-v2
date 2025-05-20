import fastify from "fastify";
import awsLambdaFastify from "@fastify/aws-lambda";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Create a Fastify instance (good to initialize once and reuse)
const app = fastify({
  logger: true,
});

const REGION = process.env.REGION;
const BUCKET = process.env.LANGUAGES_BUCKET;

// AWS Configuration (initialize once and reuse)
const s3Client = new S3Client({ region: REGION });
const s3Bucketfile = BUCKET;

// Check if BUCKET is set
if (!s3Bucketfile) {
  console.error("BUCKET environment variable is not set.");
  process.exit(1);
}

// Function to get the image URL
const getS3ObjectUrl = async (file) => {
  const s3Key = file;
  try {
    const command = new GetObjectCommand({ Bucket: s3Bucketfile, Key: s3Key });
    const url = await getSignedUrl(s3Client, command, { expiresIn: 60 });
    return url;
  } catch (error) {
    console.error("Error generating image URL:", error);
    throw new Error("Failed to generate signed URL");
  }
};

//Route for the root path
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
        path: "/languages",
        description: "Get List of languages",
      }, // CHANGED PATH
    ],
  };
});

// Route to get the image URL  // CHANGED PATH
app.get("/languages", async (request, reply) => {
  try {
    const { file } = request.query; // Changed to file
    if (!file) {
      return reply.status(400).send({
        error: "Missing image parameter",
        message: "The 'file' query parameter is required.", // Changed message
      });
    }
    const fileUrl = await getS3ObjectUrl(file);
    if (!fileUrl) {
      return reply.status(404).send({
        error: "File not found",
        message: `No File found for ${file}`, // Changed message
      });
    }
    reply.redirect(fileUrl, 302);
  } catch (error) {
    console.error("Error in /languages route:", error); // CHANGED LOG
    reply.status(500).send({
      error: `Failed to retrieve file URL for ${request.query.file}`, // Changed message
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
