import dotenv from 'dotenv';
import MongoClient from '../classes/MongoClient.mjs';
import GptClient from '../classes/GptClient.mjs';
import { sleep, replacePlaceholders } from '../helpers/util.mjs';
import { ObjectId } from 'bson';

dotenv.config();

const dbTimeout = 200;
const useCache = false;
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

const countryMemCache = {};

const gptClient = new GptClient(gptApiKey, mongoClientCities);
const preQuery = `What are the best months to travel to %CITY%, %COUNTRY%. Return the response as an JSON object with the keys 'months' and 'reason'. 'months' is an array of strings with the months that are best to travel to %CITY%. 'reason' is explanaition why these are the best months to travel to %CITY%.`;

const cities = [];
async function run() {
  console.log(`fetching countries...`)
  const docsCountry = await mongoClientCountries.fetchAll();

  while (await docsCountry.hasNext()) {
    const doc = await docsCountry.next();
    const countryName = doc.name;
    const countryId = doc._id.toString();
    countryMemCache[countryId] = countryName;
    console.log(`Added ${countryName} to memCache (${countryId})`);
  }

  console.log(`fetching cities...`)
  const docs = await mongoClientCities.fetchAll();

  while (await docs.hasNext()) {
    const doc = await docs.next();
    if (doc.bestMonths) {
      console.log(`City: ${doc.name} already contains bestMonths. Skipping...`);
      continue;
    }
    const countryId = doc.country;
    const countryName = countryMemCache[countryId];
    const city = {
      name: doc.name,
      country: countryName
    };

    cities.push(city);
    console.log(`pushed ${JSON.stringify(city)}`);
  }


  for (let c = 0; c < cities.length; c++) {
    const city = cities[c];

    const replacements = {
      '%CITY%': city.name,
      '%COUNTRY%': city.country
    };

    const query = replacePlaceholders(preQuery, replacements);
    const result = await gptClient.runQuery(query, null, useCache, false);
    const answer = result.text;

    let answerJson = null;
    try {
      answerJson = JSON.parse(answer);
    } catch (error) {
      console.log('Invalid JSON response from ChatGPT. Skipping...');
      continue;
    }

    if (!answerJson.hasOwnProperty('months') || !answerJson.hasOwnProperty('reason')) {
      console.log('Invalid JSON keys returned from ChatGPT. Skipping...');
      continue;
    }

    console.log("Months fetched sucessfully! Saving...");
    const doc = await mongoClientCities.fetchOneByValue('name', city.name)
    doc.bestMonths = answerJson;
    await mongoClientCities.updateDocument(doc);
    await sleep(dbTimeout);
  }

  await mongoClientCountries.disconnect();
  await mongoClientCities.disconnect();
}

run();