import dotenv from 'dotenv';
import MongoClient from '../classes/MongoClient.mjs';
import GptClient from '../classes/GptClient.mjs';
import { sleep, replacePlaceholders } from '../helpers/util.mjs';

dotenv.config();

const dbTimeout = 200;
const gptApiKey = process.env.OPENAI_API_KEY;
const dbPassword = process.env.MONGO_DB_ATLAS_PW;

const dbName = 'ai-travel-guide-db';
const collectionName = 'countries';
const collectionNameCache = 'gpt-query-cache';
const collectionNameErrors = 'gpt-query-errors';
const uidKeys = ['name'];
// Replace the following with your MongoDB Atlas connection string
const dbUri = `mongodb+srv://admin:${dbPassword}@ai-travel-guide-cluster.yurozgs.mongodb.net/?retryWrites=true&w=majority`;

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
const countryQuery = `Give a 200 word description why %COUNTRY% is a good travel location.`;

async function run() {
    const docs = await mongoClient.fetchAll();

    while(await docs.hasNext()) {
      const doc = await docs.next();
  
      // if (doc.description) {
      //   console.log(`Country description exists (${doc.name}). Checking next.`);
      //   continue;
      // }

      const replacements = {
        '%COUNTRY%': doc.name
      };
  
      console.log(`Fetching description for ${doc.name}!`);
      const query = replacePlaceholders(countryQuery, replacements);
  
      const result = await gptClient.runQuery(query);
      const description = result.text;
      if (description && description.length) {
        console.log("Description created sucessfully! Saving...");
      } else {
        console.log("Fetching description failed.");
        console.log(description);
      }
  
      doc.description = description;
      await mongoClient.updateDocument(doc);
    }
  await mongoClient.disconnect();
}

run();//done