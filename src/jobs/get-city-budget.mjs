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
const preQuery = `What's the average monthly cost of living in %CITY%, %COUNTRY%. Return the response as JSON, with the keys city and cost, where cost is the average cost of living in USD!`;

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
    if (doc.costOfLiving && doc.costOfLiving < 100000) {
      console.log(`City: ${doc.name} already contains budget. Skipping...`);
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

    let costOfLiving = null;
    let jsonResponse = null;
    try {
      jsonResponse = JSON.parse(answer);
      const costAnswer = jsonResponse.cost;
      console.log(`Cost answer: $${costAnswer}`);
      let minMax = costAnswer.toString().replace(' to ', '-').split('-');
      let finalCost = minMax.pop();
      costOfLiving = parseInt(finalCost.replace(/[^0-9\.]+/g, ""));
    } catch (error) {
      console.log('Error: parsing JSON response failed. Skipping...');
      console.log(answer);
      continue;
    }
    console.log("Cost fetched sucessfully! Saving...");
    console.log(`Cost is $${costOfLiving} USD!`);
    const doc = await mongoClientCities.fetchOneByValue('name', city.name)
    doc.costOfLiving = costOfLiving;
    await mongoClientCities.updateDocument(doc);
    await sleep(dbTimeout);
  }

  await mongoClientCountries.disconnect();
  await mongoClientCities.disconnect();
}

run();//done