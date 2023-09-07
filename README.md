# travelguide-miner
tool to fetch info from chatgpt related to traveling and saving it into mongodb

## installation

```
npm i
```

## environment

### .env file

For the application to have access to the used third party services you need to create a `.env` file with these values
```
MONGO_DB_ATLAS_USER="admin"
MONGO_DB_ATLAS_PW=""
MONGO_DB_ATLAS_CLUSTER="your-cluster.abcde.mongodb.net"
MONGO_DB_ATLAS_NAME="ai-travel-guide-db"
OPENAI_API_KEY=""
GOOGLE_PLACES_API_KEY=""
GOOGLE_STORAGE_BUCKET_NAME="ai-travel-guide-places-images"

```
### ATLAS DB

Create atlas db and create collections `countries` and `cities`.
For caching also create collection `gpt-query-cache`.
For debugging also create collection `gpt-query-errors`.

## commands

For full list of commands check `package.json`
```
npm run country
npm run country-cities
npm run city-best-months
```