import * as aws from 'aws-sdk'
import * as dbg from 'debug'

const debug = dbg('common')

export function buildTags(clusterId: string, name: string, extraTags?: { [key: string]: string }): aws.EC2.TagList {
    let tags = [
        {
            Key: 'Name',
            Value: name,
        },
        {
            Key: 'SyeClusterId',
            Value: clusterId,
        },
        {
            Key: 'SyeCluster_' + clusterId,
            Value: '',
        },
    ]

    if (extraTags) {
        for (let key of Object.keys(extraTags)) {
            tags.push({
                Key: key,
                Value: extraTags[key],
            })
        }
    }

    return tags
}

export async function tagResource(
    ec2: aws.EC2,
    resourceId: string,
    clusterId: string,
    name: string,
    extraTags?: { [key: string]: string }
) {
    debug('tagResource', resourceId)

    let tags = buildTags(clusterId, name, extraTags)

    return ec2
        .createTags({
            Resources: [resourceId],
            Tags: tags,
        })
        .promise()
}

export function getTag(tags: aws.EC2.TagList, key: string): string {
    return (tags.find((t) => t.Key === key) || { Value: '' }).Value
}
