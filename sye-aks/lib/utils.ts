import * as cp from "child_process"
import {consoleLog} from '../../lib/common'
const debug = require('debug')('aks/utils')

export function exec(cmd: string, args: string[], options: {input?: string, env?: Object, failOnStderr?: boolean} = {}): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
        let command = cmd
        for (const arg of args) {
            command += ' '
            command += "'"
            command += arg
            command += "'"
        }
        debug(`EXEC: ${command}`, {options})
        const childProcess = cp.exec(command, options, (error, stdout, stderr) => {
            if (error) {
                reject(error.message)
            } else {
                if (stderr && options.failOnStderr) {
                    reject(stderr.toString())
                } else {
                    debug ('result', childProcess)
                    resolve(stdout.split('\n'))
                }
            }
        })
        if (options.input) {
            childProcess.stdin.write(options.input)
            childProcess.stdin.end()
        }
    })
}

export async function ensureLoggedIn(): Promise<void> {
    try {
        await exec('az',['account', 'show'])
        debug('Looks as we already have a session with Azure')
    } catch (ex) {
        consoleLog('Log in into Azure')
        await exec('az',['login'])
    }
}
