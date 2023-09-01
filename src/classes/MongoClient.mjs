import mongodb from 'mongodb';

export default class MongoClient {
  constructor(dbName, dbPassword, dbUri, collectionName, collectionNameCache, collectionNameErrors, uidKeys) {
    this.client = null;
    this.db = null;
    this.collection = null;
    this.dbName = dbName;
    this.dbPassword = dbPassword;
    this.dbUri = dbUri;
    this.collectionName = collectionName;
    this.collectionNameCache = collectionNameCache;
    this.collectionNameErrors = collectionNameErrors;
    this.uidKeys = uidKeys;
  }

  async connect() {
    const MongoClient = mongodb.MongoClient;
    if (this.client) return;
    this.client = new MongoClient(this.dbUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    await this.client.connect();
  }

  async disconnect() {
    if (!this.client) return;
    await this.client.close();
    this.client = null;
  }

  selectDb(dbName) {
    this.db = this.client.db(dbName);
  }

  selectCollection(collectionName) {
    this.collection = this.db.collection(collectionName);
  }

  async fetchOneByValue(property, value) {
    try {
      await this.connect();
      this.selectDb(this.dbName);
      this.selectCollection(this.collectionName);
      const search = {
        [property]: value
      };
      const result = await this.collection.findOne(search);

      return result;
    } catch (err) {
      console.error(err);
    }
  }

  async fetchByValue(property, value) {
    try {
      await this.connect();
      this.selectDb(this.dbName);
      this.selectCollection(this.collectionName);
      const search = {
        [property]: value
      };
      const result = await this.collection.find(search);

      return result;
    } catch (err) {
      console.error(err);
    }
  }

  async fetchAll() {
    try {
      await this.connect();
      this.selectDb(this.dbName);
      this.selectCollection(this.collectionName);
      const result = await this.collection.find();

      return result;
    } catch (err) {
      console.error(err);
    }
  }

  async fetchDistinct(field) {
    try {
      await this.connect();
      this.selectDb(this.dbName);
      this.selectCollection(this.collectionName);
      const result = await this.collection.distinct(field);

      return result;
    } catch (err) {
      console.error(err);
    }
  }

  async updateDocument(document) {
    await this.connect();
    this.selectDb(this.dbName);
    this.selectCollection(this.collectionName);

    try {
      delete (document._id);
      const docQuery = {};
      this.uidKeys.forEach(uidKey => {
        docQuery[uidKey] = document[uidKey];
      });

      console.log(docQuery);
      await this.collection.replaceOne(docQuery, document);
    } catch (err) {
      console.error(err);
    }
  }

  async createDocument(document) {
    await this.connect();
    this.selectDb(this.dbName);
    this.selectCollection(this.collectionName);

    try {
      const docQuery = {}
      let existingDocument = false;
      if (this.uidKeys.length) {
        this.uidKeys.forEach(uidKey => {
          docQuery[uidKey] = document[uidKey];
        });
        existingDocument = await this.collection.findOne(docQuery);
      }

      if (existingDocument) {
        console.log(`Document already exists.`);
      } else {
        const result = await this.collection.insertOne(document);
        console.log(`Created document with _id: ${result.insertedId}`);
      }

      console.log(docQuery);
    } catch (err) {
      console.error(err);
    }
  }

  async checkCache(query) {
    await this.connect();
    this.selectDb(this.dbName);
    this.selectCollection(this.collectionNameCache);

    try {
      const existingDocument = await this.collection.findOne({ query });

      if (existingDocument) {
        console.log(`Cached value found. Returning cache.`);
        await this.disconnect();
        return existingDocument;
      } else {
        await this.disconnect();
        return false;
      }
    } catch (err) {
      console.error(err);
    }

    return false;
  }

  async createCache(document) {
    const { query } = document;
    await this.connect();
    this.selectDb(this.dbName);
    this.selectCollection(this.collectionNameCache);

    try {
      const existingDocument = await this.collection.findOne({ query });

      if (existingDocument) {
        console.log(`Cache for this query exists`);
      } else {
        const result = await this.collection.insertOne(document);
        console.log(`Created cache with _id: ${result.insertedId}`);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async cacheError(query, result, error) {
    await this.connect();
    this.selectDb(this.dbName);
    this.selectCollection(this.collectionNameErrors);
    try {
      const document = { query, result, error };
      await this.collection.insertOne(document);
      console.log(`Cached Error.`);
    } catch (err) {
      console.error(err);
    }

    // set back selected collection
    // otherwise updateDocument will check cache table and do nothing
    this.selectCollection(this.collectionName);
  }
}