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
const collectionName = 'countries';
const collectionNameCache = 'gpt-query-cache';
const collectionNameErrors = 'gpt-query-errors';
const uidKeys = ['name'];
// Replace the following with your MongoDB Atlas connection string
const dbUri = `mongodb+srv://${dbUser}:${dbPassword}@${dbCluster}/?retryWrites=true&w=majority`;

/** @var MongoClient */
const mongoClient = new MongoClient(
  dbName,
  dbPassword,
  dbUri,
  collectionName,
  collectionNameCache,
  collectionNameErrors,
  uidKeys
);

const gptClient = new GptClient(gptApiKey, mongoClient);
const query = `Give me a list of the 50 best countries for taveling. Return the list as JSON array with string values.
Make sure the response is valid JSON.`;

async function run() {
    const countries = await gptClient.getJsonQuery(query);
    for (let i = 0; i < countries.length; i++) {
        const country = countries[i];
        await mongoClient.createDocument({ name: country });
        await sleep(dbTimeout);
    }

  await mongoClient.disconnect();
}

run();//done