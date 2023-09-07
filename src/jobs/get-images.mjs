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

const dbName = 'ai-travel-guide-db';
const collectionNameCountries = 'countries';
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
let counter = 0;
async function run() {
  const countryImageWidth = 1400;
  const docsCountry = await mongoClientCountries.fetchAll();
  const resultLengthCountries = await docsCountry.count();

  while (await docsCountry.hasNext()) {
    counter++;
    const doc = await docsCountry.next();
    const countryName = doc.name;
    const countryId = doc._id.toString();
    countryMemCache[countryId] = countryName;
    console.log(`Added ${countryName} to memCache (${countryId})`);
    if (doc.image) {
      console.log(`${counter}/${resultLengthCountries}: Image exist already for ${doc.name}. Skipping...`);
      continue;
    }

    let place = `${doc.name}`;
    const placeQuery = place.replace(/\s/, '+');
    const image = await getPlaceImage(placeQuery, countryImageWidth);
    
    if (image) {
      console.log(`Image for ${place} fetched succesfully. Saving...`);
      doc.image = image;
      await mongoClientCountries.updateDocument(doc);
      await sleep(dbTimeout);
    } else {
      console.log("Fetching image failed.");
    }
  }

  mongoClientCountries.disconnect();

  const cityImageWidth = 1400;
  const docs = await mongoClientCities.fetchAll();
  const resultLength = await docs.count();
  counter = 0;
  while (await docs.hasNext()) {
    counter++;
    const doc = await docs.next();
    if (doc.image) {
      console.log(`${counter}/${resultLength}: Image exist already for ${doc.name}. Skipping...`);
      continue;
    }

    const countryId = doc.country;
    const countryName = countryMemCache[countryId];
    let place = `${doc.name} ${countryName}`;
    let fallBackPlace = countryName;
    const placeQuery = place.replace(/\s/g, '+');
    const image = await getPlaceImage(placeQuery, cityImageWidth);
    console.log(image);
    
    if (image) {
      console.log(`Image for ${place} fetched succesfully. Saving...`);
      doc.image = image;
      await mongoClientCities.updateDocument(doc);
      await sleep(dbTimeout);
    } else {
      const image = await getPlaceImage(fallBackPlace, cityImageWidth);
      doc.image = image;
      await mongoClientCities.updateDocument(doc);
      await sleep(dbTimeout);
    }
  }

  mongoClientCities.disconnect();
  console.log(`${citiesWithoutImages.length} cities without image.`);
  console.log(citiesWithoutImages);
  process.exit();
}

run();