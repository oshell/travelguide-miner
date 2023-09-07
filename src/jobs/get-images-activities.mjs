import dotenv from 'dotenv';
import MongoClient from '../classes/MongoClient.mjs';
import { sleep, slugify } from '../helpers/util.mjs';
import {Storage} from '@google-cloud/storage';
import fetch from 'node-fetch';
import fs from 'fs';
import http from 'https';

dotenv.config();

const dbTimeout = 200;
const dbPassword = process.env.MONGO_DB_ATLAS_PW;
const placesApiKey = process.env.GOOGLE_PLACES_API_KEY;
const dbUser = process.env.MONGO_DB_ATLAS_USER;
const dbCluster = process.env.MONGO_DB_ATLAS_CLUSTER;

const dbName = process.env.MONGO_DB_ATLAS_NAME;
const collectionNameCities = 'cities';
const collectionNameCache = 'gpt-query-cache';
const collectionNameErrors = 'gpt-query-errors';
const uidKeys = ['name'];
// Replace the following with your MongoDB Atlas connection string
const dbUri = `mongodb+srv://${dbUser}:${dbPassword}@${dbCluster}/?retryWrites=true&w=majority`;

const bucketName = process.env.GOOGLE_STORAGE_BUCKET_NAME;
const storage = new Storage();

let citiesWithoutImages = [];
async function makeBucketPublic() {
  await storage.bucket(bucketName).makePublic();

  console.log(`Bucket ${bucketName} is now publicly readable`);
}

makeBucketPublic().catch(console.error);

async function uploadFile(filePath, destFileName) {
  const options = {
    destination: destFileName
  };

  await storage.bucket(bucketName).upload(filePath, options);
  console.log(`${filePath} uploaded to ${bucketName}`);
}

async function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    fetch(url).then(res => {
      const dest = fs.createWriteStream(filepath);
      res.body.pipe(dest);
      res.body.on("end", () => resolve());
      dest.on("error", reject);
    })
  })

}

async function getPlaceImage(place, width) {
  const placesUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${place}&key=${placesApiKey}`;
  const placesResult = await fetch(placesUrl).then(res => res.json());
  if (!placesResult.results.length || !placesResult.results[0].hasOwnProperty('photos')) return null;
  const photos = placesResult.results[0].photos;
  const reference = photos[0].photo_reference;
  const attr = photos[0].html_attributions[0];
  const photosUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${width}&photo_reference=${reference}&key=${placesApiKey}`;
  const localImagePath = './places-image.jpg';
  const placeName = place.replace(/\+/g, ' ');
  const bucketFileName = `${slugify(placeName)}.jpg`;
  await downloadImage(photosUrl, localImagePath);
  await uploadFile(localImagePath, bucketFileName);
  const gcloudPublicFile = `https://storage.googleapis.com/${bucketName}/${bucketFileName}`;
  return {
    src: gcloudPublicFile,
    attr
  }
}

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
let counter = 0;
async function run() {
  const cityImageWidth = 1400;
  const docs = await mongoClientCities.fetchAll();
  const resultLength = await docs.count();
  counter = 0;
  while (await docs.hasNext()) {
    counter++;
    const doc = await docs.next();
    console.log(`Fetching images for ${doc.name} (${counter}/${resultLength})`);
    for (let i = 0; i < doc.activities.length; i++) {
      const activity = doc.activities[i];
      if (activity.image) {
        console.log(`Image exists. Skipping...`);
        continue;
      }

      if (!activity.location) {
        console.log(`No location. Skipping...`);
        continue;
      }
      const placeQuery = activity.location.replace(/,/g, '').replace(/\s/g, '+');
      const image = await getPlaceImage(placeQuery, cityImageWidth);

      if (image) {
        console.log(`Image for ${activity.location} fetched succesfully. Saving...`);
        console.log(image);
        doc.activities[i].image = image;
        await mongoClientCities.updateDocument(doc);
        await sleep(dbTimeout);
      }
    }
  }

  mongoClientCities.disconnect();
  console.log(`${citiesWithoutImages.length} cities without image.`);
  console.log(citiesWithoutImages);
  process.exit();
}

run();