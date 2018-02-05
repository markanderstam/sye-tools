import * as dbg from 'debug'

const debug = dbg('common')

export function sleep(ms: number, comment: string = ''): Promise<void> {
    if (comment) {
        debug(`Waiting for ${ms}ms: ${comment}`)
    }
    return new Promise<void>(resolve => {
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
