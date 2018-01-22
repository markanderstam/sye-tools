import * as aws from 'aws-sdk'
import * as dbg from 'debug'

const debug = dbg('common')

export function buildTags(clusterId: string, name: string, extraTags?: { [key: string]: string }): aws.EC2.TagList {
    let tags = [
        {
            Key: 'Name',
            Value: name
        },
        {
            Key: 'SyeClusterId',
            Value: clusterId
        },
        {
            Key: 'SyeCluster_' + clusterId,
            Value: ''
        },
    ]

    if (extraTags) {
        for (let key of Object.keys(extraTags)) {
            tags.push({
                Key: key,
                Value: extraTags[key]
            })
        }
    }

    return tags
}

export async function tagResource(ec2: aws.EC2, resourceId: string, clusterId: string, name: string, extraTags?: { [key:string]: string }) {
    debug('tagResource', resourceId)

    let tags = buildTags(clusterId, name, extraTags)

    return ec2.createTags({
        Resources: [resourceId],
        Tags: tags
    }).promise()
}

export function getTag(tags: aws.EC2.TagList, key: string): string {
    return (tags.find((t) => t.Key === key) || { Value: '' }).Value
}

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
