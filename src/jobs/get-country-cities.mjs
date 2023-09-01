import dotenv from 'dotenv';
import MongoClient from '../classes/MongoClient.mjs';
import GptClient from '../classes/GptClient.mjs';
import { sleep, replacePlaceholders } from '../helpers/util.mjs';

dotenv.config();

const dbTimeout = 200;
const useCache = true;
const gptApiKey = process.env.OPENAI_API_KEY;
const dbPassword = process.env.MONGO_DB_ATLAS_PW;

const dbName = 'ai-travel-guide-db';
const collectionNameCountries = 'countries';
const collectionNameCities = 'cities';
const collectionNameCache = 'gpt-query-cache';
const collectionNameErrors = 'gpt-query-errors';
const uidKeys = ['name'];
// Replace the following with your MongoDB Atlas connection string
const dbUri = `mongodb+srv://admin:${dbPassword}@ai-travel-guide-cluster.yurozgs.mongodb.net/?retryWrites=true&w=majority`;

/** @var MongoClient */
const mongoClientCountries = new MongoClient(
  dbName,
  dbPassword,
  dbUri,
  collectionNameCountries,
  collectionNameCache,
  collectionNameErrors,
  uidKeys
);

const mongoClientCities = new MongoClient(
  dbName,
  dbPassword,
  dbUri,
  collectionNameCities,
  collectionNameCache,
  collectionNameErrors,
  uidKeys
);

const gptClient = new GptClient(gptApiKey, mongoClientCities);
const countryQuery = `What are the 10 best cities to visit in %COUNTRY%. Return the result as JSON array. Each value should be a string. Make sure the result is valid JSON.`;

async function run() {
    const docs = await mongoClientCountries.fetchAll();

    while(await docs.hasNext()) {
      const doc = await docs.next();
      const country = doc._id.toString();
      const replacements = {
        '%COUNTRY%': doc.name
      };
  
      console.log(`Fetching cities for ${doc.name}!`);
      const query = replacePlaceholders(countryQuery, replacements);
      const result = await gptClient.getJsonQuery(query, useCache);
      if (result && result.length) {
        console.log("Cities fetched sucessfully! Saving...");
        for (let i = 0; i < result.length; i++) {
          const place = result[i];
          const isString = typeof place === 'string';
          if (!isString) {
            console.log(`Wrong value type (${doc.name})`);
            break;
          }
          const placeDoc = {
            name: place,
            country
          };

          console.log(placeDoc);
          await mongoClientCities.createDocument(placeDoc);
          await sleep(dbTimeout);
        }
      } else {
        console.log("Fetching cities failed.");
      }
    }
    
  await mongoClientCountries.disconnect();
  await mongoClientCities.disconnect();
}

run();//done