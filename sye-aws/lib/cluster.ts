/*
Create s3 bucket named after clusterId
Upload sye-cluster-join
Upload sye-environment
Upload metadata for cluster?
- Name of ssh key?
- Name of vpc in each region in case we are reusing VPCs.
- List of regions if we need it.
*/

import * as aws from 'aws-sdk'
import * as dbg from 'debug'
import * as fs from 'fs'
import * as EasyTable from 'easy-table'
import { resolve } from 'path'
import {getInstanceInformation} from './machine'
import {getTag, consoleLog} from './common'

const debug = dbg('cluster')

interface ClusterMachine {
    Id: string
    Region: string
    AZ: string
    Name: string
    Roles: string
    PublicIpAddress: string
    Ipv6Address: string
    DataVolumeDevice?: string
}

export async function createCluster(clusterId: string) {
    await createBucket(clusterId)
    await createIamRole(clusterId)
}

export async function deleteCluster(clusterId: string) {
    await deleteIamRole(clusterId)
}

export async function showResources(clusterId: string, output = true, raw = false): Promise<ClusterMachine[]> {
    let resources = await getResources(clusterId)

    debug('resources', resources)
    let regions = new Set(
        resources
            .filter( r => r.ResourceARN.startsWith('arn:aws:ec2'))
            .map( r => r.ResourceARN.split(':')[3] )
    )

    debug('regions', regions)

    let logOutput = ''
    const log = (msg: string) => logOutput += msg + '\n'

    const machines = []

    for (let region of regions) {
        log('')
        log(`Region ${region}`)
        log('='.repeat( ('Region ' + region).length))
        log('')

        let instances = resources
            .filter(r => r.ResourceARN.split(':')[3] === region )
            .filter( r => r.ResourceARN.split(':')[5].split('/')[0] === 'instance')

        const table = []
        if (instances.length === 0) {
            log('No instances')
        } else {
            for (let instance of instances) {
                debug('instance', instance)
                const instanceInfo = await getInstanceInformation(clusterId, region, getTag(instance.Tags, 'Name'))
                debug('instanceInfo', JSON.stringify(instanceInfo))
                const instanceId = instance.ResourceARN.split(':')[5].split('/')[1]
                if (instanceInfo !== undefined && instanceId === instanceInfo.InstanceId) {
                    table.push({
                        Id: instanceId,
                        Region: region,
                        AZ: getTag(instance.Tags, 'AvailabilityZone'),
                        Name: getTag(instance.Tags, 'Name'),
                        Roles: getTag(instance.Tags, 'Roles'),
                        PublicIpAddress: instanceInfo.PublicIpAddress,
                        Ipv6Address: instanceInfo.NetworkInterfaces[0].Ipv6Addresses[0].Ipv6Address,
                        DataVolumeDevice: (
                            instanceInfo.BlockDeviceMappings.find((v) => v.DeviceName !== instanceInfo.RootDeviceName) || {}
                        ).DeviceName
                    })
                }
            }
            log(EasyTable.print(table))
            log(`https://${region}.console.aws.amazon.com/ec2/v2/home?region=${region}#Instances:tag:SyeClusterId='${clusterId}';sort=keyName`)
        }
        machines.push(...table)
    }

    if (output) {
        if (raw) {
            consoleLog(JSON.stringify(machines, null, 2))
        } else {
            consoleLog(logOutput)
        }
    }

    return machines
}

export async function getMachines(clusterId: string): Promise<ClusterMachine[]> {
    return showResources(clusterId, false)
}

export async function getResources(clusterId: string): Promise<aws.ResourceGroupsTaggingAPI.ResourceTagMappingList> {
    let resources: aws.ResourceGroupsTaggingAPI.ResourceTagMappingList = []
    let regions = await listRegions()
    for( let region of regions) {
        let rg = new aws.ResourceGroupsTaggingAPI({ region })

        let regionResources = await rg.getResources({
            TagFilters: [
                {
                    Key: 'SyeClusterId',
                    Values: [clusterId],
                }
            ]
        }).promise()

        resources.push(...regionResources.ResourceTagMappingList)
    }

    return resources
}

// Return a list of all Amazon regions available to us
export async function listRegions() {
    let ec2 = new aws.EC2({region: 'eu-central-1'})
    let regions = await ec2.describeRegions().promise()
    return regions.Regions.map( reg => reg.RegionName )
}

async function createBucket(bucketName: string) {
    let s3 = new aws.S3({ region: 'us-east-1' })
    let existing = await s3.headBucket({
        Bucket: bucketName
    }).promise().catch( () => false )

    if( !existing ) {
        await s3.createBucket({
            Bucket: bucketName
        }).promise()
    }

    await s3.putBucketTagging({
        Bucket: bucketName,
        Tagging: {
            TagSet: [
                {
                    Key: 'SyeClusterId',
                    Value: bucketName,
                },
                {
                    Key: 'SyeCluster_'+bucketName,
                    Value: ''
                }
            ]
        }
    }).promise()

    // Getting the dirname explicitly because of:
    // https://stackoverflow.com/questions/46729293/configure-webpack-for-nodejs-so-that-you-can-run-the-app-using-the-absolute-path
    let body
    if (fs.existsSync(resolve(__dirname, 'bootstrap.sh'))) {
        // When used as script
        body = fs.readFileSync(resolve(__dirname, 'bootstrap.sh'))
    }
    else {
        // When used as module
        body = fs.readFileSync(resolve(__dirname, '../bootstrap.sh'))
    }

    await s3.upload({
        Bucket: bucketName,
        Key: 'public/bootstrap.sh',
        Body: body,
        ContentType: 'application/x-sh'
    }).promise()
}

async function createIamRole(clusterId: string) {
    debug('createIamRole')
    const clusterIdInstance = clusterId + '-instance'
    const iam = new aws.IAM()

    debug('createRole')
    await iam.createRole({
        RoleName: clusterIdInstance,
        AssumeRolePolicyDocument: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Principal: {
                        Service: 'ec2.amazonaws.com'
                    },
                    Action: 'sts:AssumeRole'
                }
            ]
        }),
    }).promise()

    debug('createPolicy')
    const policy = await iam.createPolicy({
        PolicyName: clusterId + '-s3-read',
        PolicyDocument: JSON.stringify({
           Version: '2012-10-17',
           Statement: [
                {
                   Effect: 'Allow',
                   Action: [
                       's3:GetObject'
                    ],
                   Resource: [
                       'arn:aws:s3:::' + clusterId + '/public/*'
                   ],
                },
            ]
        })
    }).promise()

    debug('attachRolePolicy')
    await iam.attachRolePolicy({
        RoleName: clusterIdInstance,
        PolicyArn: policy.Policy.Arn
    }).promise()


    debug('createInstanceProfile')
    await iam.createInstanceProfile({
        InstanceProfileName: clusterIdInstance
    }).promise()

    debug('addRoleToInstanceProfile')
    await iam.addRoleToInstanceProfile({
        RoleName: clusterIdInstance,
        InstanceProfileName: clusterIdInstance
    }).promise()
}

async function deleteIamRole(clusterId: string) {
    debug('deleteIamRole')
    const clusterIdInstance = clusterId + '-instance'
    const iam = new aws.IAM()

    debug('removeRoleFromInstanceProfile')
    await iam.removeRoleFromInstanceProfile({
        RoleName: clusterIdInstance,
        InstanceProfileName: clusterIdInstance
    }).promise().catch((err) => debug(`removeRoleFromInstanceProfile failed: ${err}`))

    debug('deleteInstanceProfile', clusterIdInstance)
    await iam.deleteInstanceProfile({
        InstanceProfileName: clusterIdInstance
    }).promise().catch((err) => debug(`deleteInstanceProfile failed: ${err}`))

    debug('listAttachedRolePolicies')
    const attachedPolicies = await iam.listAttachedRolePolicies({
        RoleName: clusterIdInstance
    }).promise()
        .then((res) => res.AttachedPolicies)
        .catch(() => new Array<aws.IAM.AttachedPolicy>())

    for (let policy of attachedPolicies) {
        debug('detachRolePolicy', policy.PolicyName)
        await iam.detachRolePolicy({
            RoleName: clusterIdInstance,
            PolicyArn: policy.PolicyArn
        }).promise().catch((err) => debug(`detachRolePolicy ${policy.PolicyName} failed: ${err}`))
        debug('deletePolicy', policy.PolicyName)
        await iam.deletePolicy({
            PolicyArn: policy.PolicyArn
        }).promise().catch((err) => debug(`deletePolicy ${policy.PolicyName} failed: ${err}`))
    }

    debug('deleteRole')
    await iam.deleteRole({
        RoleName: clusterIdInstance
    }).promise().catch((err) => debug(`deleteRole ${clusterIdInstance} failed: ${err}`))
}
