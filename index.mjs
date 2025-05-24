import fastify from "fastify";
import awsLambdaFastify from "@fastify/aws-lambda";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const app = fastify({ logger: true });

// --- S3 Configuration for Country Data ---
const S3_REGION = process.env.REGION;
const COUNTRY_DATA_BUCKET = process.env.COUNTRY_CODE_BUCKET;
const COUNTRY_DATA_KEY = process.env.COUNTRY_CODE_KEY;

// Initialize S3 Client
const s3Client = new S3Client({ region: S3_REGION });

// Global variable to store country data once loaded
let countryData = null;

// --- Basic Sanity Checks for S3 Country Data Config ---
if (!S3_REGION || !COUNTRY_DATA_BUCKET) {
  console.error(
    "Missing S3 configuration for country data (REGION or COUNTRY_DATA_BUCKET)."
  );
  process.exit(1);
}

/**
 * Function to load country data from S3.
 * This runs once during Lambda cold start.
 */
const loadCountryDataFromS3 = async () => {
  if (countryData) {
    // Data already loaded, no need to fetch again
    return;
  }

  try {
    const command = new GetObjectCommand({
      Bucket: COUNTRY_DATA_BUCKET,
      Key: COUNTRY_DATA_KEY,
    });
    const response = await s3Client.send(command);
    console.log(
      `S3 response for ${COUNTRY_DATA_BUCKET}/${COUNTRY_DATA_KEY}:`,
      response
    );
    // Check if the response is valid

    // Read the stream and parse JSON
    const data = await response.Body.transformToString();
    console.log("S3 response data:", data);
    // Parse the JSON data

    countryData = JSON.parse(data);

    console.log("Parsed country data:", countryData);
    app.log.info("Country data loaded successfully from S3.");
  } catch (error) {
    app.log.error(
      `Failed to load country data from S3://${COUNTRY_DATA_BUCKET}/${COUNTRY_DATA_KEY}:`,
      error
    );
    countryData = [];
  }
};

// --- Call the data loading function immediately ---
// This ensures it runs during the Lambda cold start phase.
loadCountryDataFromS3();

// --- New Endpoint for Geo-IP Lookup ---
app.get("/geolocation", async (request, reply) => {
  // Ensure country data is loaded before proceeding
  if (!countryData) {
    // Attempt to reload if it failed previously or was not initialized
    await loadCountryDataFromS3();
    if (!countryData) {
      // If still null/empty after attempt, return an error
      return reply.status(500).send({
        error: "Country data not available",
        message: "Failed to load country data from S3.",
      });
    }
  }

  const clientIp = request.headers["x-forwarded-for"] || request.ip;

  try {
    const geoResponse = await axios.get(`http://ip-api.com/json/${clientIp}`);
    console.log(`GeoIP response for IP ${clientIp}:`, geoResponse.data);
    const geoData = geoResponse.data;

    if (geoData.status === "success" && geoData.countryCode) {
      const detectedCountryCode = geoData.countryCode;

      const countryInfo = countryData.find(
        (country) => country.code === detectedCountryCode
      );

      if (countryInfo) {
        return reply.status(200).send({
          dial_code: countryInfo.dial_code,
          country_code: countryInfo.code,
          country_name: countryInfo.name,
          flag: countryInfo.flag,
        });
      }
    }

    app.log.warn(
      `Could not detect specific country for IP: ${clientIp}. GeoData:`,
      geoData
    );
    return reply
      .status(200)
      .send({ dial_code: "+1", message: "Defaulting to +1" });
  } catch (error) {
    app.log.error(`Error detecting country code for IP: ${clientIp}`, error);
    return reply
      .status(500)
      .send({ error: "Failed to detect country code", message: error.message });
  }
});

// --- Existing Routes (minimal comments) ---
app.get("/health", async (_, reply) =>
  reply.status(200).send({ message: "API is Healthy", status: "ok" })
);

app.get("/", async (request, reply) => {
  return {
    message: "Welcome to the VBytes geolocation detection API",
    version: "1.0.0",
    routes: [
      { method: "GET", path: "/geolocation", description: "Health check" },
      {
        method: "GET",
        path: "/detectcountry",
        description: "Detect user's country code",
      },
    ],
  };
});

export const handler = awsLambdaFastify(app);

if (process.env.NODE_ENV === "test") {
  app.listen({ port: 5000 }, (err) => {
    if (err) console.error(err);
    else console.log("Server listening on http://localhost:5000");
  });
}
