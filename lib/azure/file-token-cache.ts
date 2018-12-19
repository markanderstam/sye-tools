import * as fs from 'fs'
import { TokenCache, TokenResponse } from 'adal-node'
import { promisify } from 'util'

const debug = require('debug')('azure/file-token-cache')

/**
 * Cache of Azure tokens that is passed to the Azure Node.js API
 */
export class FileTokenCache implements TokenCache {
    private tokens: TokenResponse[] = []

    /** Load tokens from file, add to the currently loaded set of tokens */
    async load(filename: string): Promise<boolean> {
        try {
            const fileContents = (await promisify(fs.readFile)(filename)).toString()
            const tokens = JSON.parse(fileContents)
            debug('Loaded tokens from file', { count: tokens.length, file: filename })
            tokens.forEach((t) => (t.expiresOn = new Date(t.expiresOn)))
            this.add(tokens, () => {})
            return true
        } catch (e) {
            return false
        }
    }

    empty(): boolean {
        return this.tokens.length === 0
    }

    first(): TokenResponse {
        return this.tokens[0]
    }

    /**
     * Saves the tokens in this cache to disk
     */
    async save(filename: string): Promise<void> {
        this.removeDuplicateEntries()
        await promisify(fs.writeFile)(filename, JSON.stringify(this.tokens))
        debug('Saved tokens to file', { count: this.tokens.length, file: filename })
    }

    /**
     * Removes a collection of entries from the cache in a single batch operation.
     * @param  {Array}   entries  An array of cache entries to remove.
     * @param  {Function} callback This function is called when the operation is complete.  Any error is provided as the
     *                             first parameter.
     */
    remove(entries: TokenResponse[], callback: { (err: Error, result: null): void }): void {
        this.tokens = this.tokens.filter((e) =>
            entries.find((entry) => !Object.keys(entry).every((key) => e[key] === entry[key]))
        )
        callback(null, null)
    }

    /**
     * Remove duplicate credentials, only keeping the one with the newest expiresOn date
     */
    removeDuplicateEntries(): void {
        let result: any[] = []
        for (const entry of this.tokens) {
            const query: any = {
                _authority: entry._authority,
                _clientId: entry._clientId,
                isMRRT: entry.isMRRT,
                oid: entry.oid,
                resource: entry.resource,
                tenantId: entry.tenantId,
                tokenType: entry.tokenType,
                userId: entry.userId,
            }
            // Remove old entries
            const previous = result.find((e) => Object.keys(query).every((key) => e[key] === query[key]))
            if (!previous || previous.expiresOn < entry.expiresOn) {
                result = result.filter((e) => !Object.keys(query).every((key) => e[key] === query[key]))
                result.push(entry)
            }
        }
        this.tokens = result
    }

    /**
     * Adds a collection of entries to the cache in a single batch operation.
     * @param {Array}   entries  An array of entries to add to the cache.
     * @param  {Function} callback This function is called when the operation is complete.  Any error is provided as the
     *                             first parameter.
     */
    add(entries: TokenResponse[], callback: { (err: Error, result: boolean): void }): void {
        this.tokens.push(...entries)
        this.removeDuplicateEntries()
        callback(null, true)
    }

    /**
     * Finds all entries in the cache that match all of the passed in values.
     * @param  {object}   query    This object will be compared to each entry in the cache.  Any entries that
     *                             match all of the values in this object will be returned.  All the values
     *                             in the passed in object must match values in a potentialy returned object
     *                             exactly.  The returned object may have more values than the passed in query
     *                             object. Please take a look at http://underscorejs.org/#where for an example
     *                             on how to provide query.
     * @param  callback
     */
    find(query: any, callback: { (err: Error, results: any[]): void }): void {
        callback(null, this.tokens.filter((e) => Object.keys(query).every((key) => e[key] === query[key])))
    }
}
