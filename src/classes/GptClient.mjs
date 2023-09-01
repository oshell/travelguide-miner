import { ChatGPTAPI } from 'chatgpt'
import MongoClient from './MongoClient.mjs';

let jsonCache = '';

export default class GptClient {
    /**
     * 
     * @param {string} apiKey 
     * @param {MongoClient} mongoClient 
     */
    constructor(apiKey, mongoClient) {
        this.apiKey = apiKey;
        this.api = new ChatGPTAPI({ apiKey });
        this.mongoClient = mongoClient;
    }

    async runQuery(query, messageId, useCache, isJson) {
        const params = {};
        if (messageId) {
            params.parentMessageId = messageId;
        }

        if (useCache) {
            const existingCache = await this.mongoClient.checkCache(query);
            if (existingCache) {
                const result = {
                    text: existingCache.result
                };

                return result;
            }
        }

        const result = await this.api.sendMessage(query, params);

        if (useCache) {
            let validJSON = true;
            jsonCache += result.text;
            try {
                JSON.parse(jsonCache);
            } catch (error) {
                validJSON = false;
            }

            if (isJson && validJSON) {
                await this.mongoClient.createCache({
                    query,
                    result: jsonCache
                })
            } else if (!isJson) {
                await this.mongoClient.createCache({
                    query,
                    result: result.text
                })
            }
        }
        return result;
    }

    normalizeResult(result, tries) {
        if (tries > 3) return result;
        result = result.replace(/([a-zA-Z]*):/g, '"$1":');
        result = result.replace(/"""/g, '"');

        const match = /([a-zA-Z]\{)/.exec(result);
        if (match) {
            const concatErrorIndex = match.index;
            const before = result.slice(0, concatErrorIndex);
            
            result = before;
        }
        const lastElementSplit = result.lastIndexOf('},');
        const before = result.slice(0, lastElementSplit);
        
        result = before + '}]';
        try {
            JSON.parse(result);
        } catch (error) {
            tries++;
            result = this.normalizeResult(result, tries);
        }
        return result;
    }

    async getJsonQuery(query, useCache) {
        jsonCache = '';
        const isJson = true;
        let result = await this.runQuery(query, null, useCache, isJson);
        let lastChar = result.text.slice(-1);
        let answer = result.text;

        const maxExtensions = 1;
        let extensions = 0;

        while (lastChar !== ']' && extensions < maxExtensions) {
            let validJson = false;
            let parsedAnswer = null;
            try {
                parsedAnswer = JSON.parse(answer);
                validJson = true;
            } catch(e) {
                validJson = false;
            }

            if (validJson) {
                console.log("Error: wrong JSON format. ChatGPT return object instead of array. Trying to access results...");
                if (parsedAnswer.results) {
                    return parsedAnswer.results;
                }
                return [];
            }
            extensions++;
            console.log("Trying to extend query...");
            result = await this.runQuery("continue", result.id);
            answer += result.text;
            lastChar = answer.slice(-1);
        }

        let jsonResult = [];
      
        try {
          jsonResult = JSON.parse(answer);
        } catch(e) {
            console.log("Error: Parsing failed! Trying to normalize data...");
            console.log(answer);
            try {
                answer = this.normalizeResult(answer, 0);
                jsonResult = JSON.parse(answer);
                await this.mongoClient.createCache({
                    query,
                    result: answer
                })
              } catch(error) {
                  console.log("Error: Parsing failed!")
                  await this.mongoClient.cacheError(query, answer, error.message);
              }
        }
      
        return jsonResult;
      }
}