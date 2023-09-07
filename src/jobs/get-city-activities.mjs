import dotenv from 'dotenv';
import MongoClient from '../classes/MongoClient.mjs';
import GptClient from '../classes/GptClient.mjs';
import { sleep, replacePlaceholders } from '../helpers/util.mjs';
import { ObjectId } from 'bson';

dotenv.config();

const dbTimeout = 200;
const useCache = true;
const gptApiKey = process.env.OPENAI_API_KEY;
const dbPassword = process.env.MONGO_DB_ATLAS_PW;
const dbUser = process.env.MONGO_DB_ATLAS_USER;
const dbCluster = process.env.MONGO_DB_ATLAS_CLUSTER;

const dbName = process.env.MONGO_DB_ATLAS_NAME;
const collectionNameCountries = 'countries';
const collectionNameCities = 'cities';
const collectionNameCache = 'gpt-query-cache';
const collectionNameErrors = 'gpt-query-errors';
const uidKeys = ['name'];
// Replace the following with your MongoDB Atlas connection string
const dbUri = `mongodb+srv://${dbUser}:${dbPassword}@${dbCluster}/?retryWrites=true&w=majority`;

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
const preQuery = `What are the 10 best things to do in %CITY%, %COUNTRY%. Return the result as JSON array. Each value should be an object with the keys title, description and location. description describes the place and why you would enjoy going there. description is 50 to 100 words long. location is the term that can be searched on google maps to find the related place. Make sure the response is valid JSON.`;

let counter = 0;
async function run() {
  const docs = await mongoClientCities.fetchAll();
  const resultLength = await docs.count();

  while (await docs.hasNext()) {
    counter++;
    const doc = await docs.next();
    if (doc.activities) {
      console.log(`${counter}/${resultLength}: Activities exist already for ${doc.name}. Skipping...`);
      continue;
    }

    const countryId = doc.country;
    const countriesResult = await mongoClientCountries.fetchOneByValue('_id', new ObjectId(countryId));
    const countryName = countriesResult.name;
    const replacements = {
      '%COUNTRY%': countryName,
      '%CITY%': doc.name,
    };
    console.log(`${counter}/${resultLength}: Fetching activites for ${doc.name}, ${countryName}!`);
    const query = replacePlaceholders(preQuery, replacements);
    const result = await gptClient.getJsonQuery(query, useCache);
    if (result && result.length) {
      console.log("Activites fetched sucessfully! Saving...");
      doc.activities = result;
      await mongoClientCities.updateDocument(doc);
      await sleep(dbTimeout);
    } else {
      console.log("Fetching cities failed.");
      console.log(result);
    }
  }

  process.exit();
}

run();//done