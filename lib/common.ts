import * as dbg from 'debug'
import * as fs from 'fs'
import * as cp from 'child_process'
import { resolve } from 'path'
import { promisify } from 'util'

const debug = dbg('common')

export function sleep(ms: number, comment: string = ''): Promise<void> {
    if (comment) {
        debug(`Waiting for ${ms}ms: ${comment}`)
    }
    return new Promise<void>((resolve) => {
        setTimeout(resolve, ms)
    })
}

export function consoleLog(msg: string, error = false): void {
    if (error) {
        console.error(msg) // tslint:disable-line no-console
    } else {
        console.log(msg) // tslint:disable-line no-console
    }
}

export function exit(message) {
    consoleLog(message, true)
    process.exit(1)
}

export async function awaitAsyncCondition<T>(
    condition: () => Promise<T>,
    intervalMs: number,
    deadline: number | Date,
    message: string
): Promise<T> {
    let deadlineDate = deadline
    if (typeof deadline == 'number') {
        deadlineDate = new Date(Date.now() + deadline)
    }
    let lastError = null
    while (true) {
        try {
            let result = await condition()
            if (result) {
                return result
            }
        } catch (e) {
            lastError = e
        }

        if (Date.now() > deadlineDate) {
            throw new Error(
                message +
                    ' failed. Last error: ' +
                    (lastError && lastError.stack && lastError.stack.replace(/\s+/g, ' '))
            )
        } else {
            await sleep(intervalMs, message)
        }
    }
}

export function readPackageFile(filename: string) {
    if (fs.existsSync(resolve(__dirname, filename))) {
        // When used as script
        return fs.readFileSync(resolve(__dirname, filename))
    } else {
        // When used as module
        return fs.readFileSync(resolve(__dirname, '..', filename))
    }
}

export function execSync(cmd: string, options?: cp.ExecSyncOptions) {
    debug(cmd)
    return cp.execSync(cmd, options)
}

export function exists(path: string): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
        fs.stat(path, (err) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    resolve(false)
                } else {
                    reject(err)
                }
            } else {
                resolve(true)
            }
        })
    })
}

export async function mkdir(dirname: string): Promise<void> {
    if (!(await exists(dirname))) {
        await promisify(fs.mkdir)(dirname)
    }
}

export async function readJsonFile(filename: string): Promise<any | null> {
    if (!(await exists(filename))) {
        return null
    }
    const contents = await promisify(fs.readFile)(filename, 'utf-8')
    return JSON.parse(contents.toString().trim())
}

export const syeEnvironmentFile = 'sye-environment.tar.gz'
