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

const REGION = process.env.REGION || "us-east-2";
const BUCKET = process.env.BUCKET;

// AWS Configuration (initialize once and reuse)
const s3Client = new S3Client({ region: REGION });
const s3BucketName = BUCKET;

// Check if BUCKET is set
if (!s3BucketName) {
  console.error("BUCKET environment variable is not set.");
  process.exit(1);
}

// Function to get the image URL
const getS3ObjectUrl = async (image) => {
  const s3Key = image;
  try {
    const command = new GetObjectCommand({ Bucket: s3BucketName, Key: s3Key });
    const url = await getSignedUrl(s3Client, command, { expiresIn: 60 });
    return url;
  } catch (error) {
    console.error("Error generating image URL:", error);
    throw new Error("Failed to generate image URL");
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
    message: "Welcome to the VBytes API",
    version: "1.0.0",
    routes: [
      { method: "GET", path: "/health", description: "Health check" },
      { method: "GET", path: "/images/image", description: "Get image URL" }, // CHANGED PATH
    ],
  };
});

// Route to get the image URL  // CHANGED PATH
app.get("/images/image", async (request, reply) => {
  try {
    const { name } = request.query; // Changed to name
    if (!name) {
      return reply.status(400).send({
        error: "Missing image parameter",
        message: "The 'name' query parameter is required.", // Changed message
      });
    }
    const imageUrl = await getS3ObjectUrl(name);
    if (!imageUrl) {
      return reply.status(404).send({
        error: "image not found",
        message: `No image found for image ${name}`, // Changed message
      });
    }
    reply.redirect(imageUrl, 302);
  } catch (error) {
    console.error("Error in /images/image route:", error); // CHANGED LOG
    reply.status(500).send({
      error: `Failed to retrieve image URL for image ${request.query.name}`, // Changed message
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
