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
import {getInstances} from './machine'
import {getTag, consoleLog} from './common'

const debug = dbg('cluster')

export interface ClusterMachine {
    Id: string
    Region: string
    AZ: string
    Name: string
    Roles: string
    PrivateIpAddress: string
    PublicIpAddress: string
    Ipv6Address: string
    DataVolumeDevice?: string
}

export async function createCluster(clusterId: string, syeEnvironment: string, authorizedKeys: string) {
    await createBucket(clusterId, syeEnvironment, authorizedKeys)
    await createIamRoles(clusterId)
}

export async function deleteCluster(clusterId: string) {
    await deleteIamRoles(clusterId)
}

export async function showResources(clusterId: string, output = true, raw = false): Promise<ClusterMachine[]> {
    let resources = await getResources(clusterId, ['ec2:vpc', 'ec2:instance'])

    debug('resources', resources.map((r) => r.ResourceARN))
    let regions = new Set(
        resources.map(r => r.ResourceARN.split(':')[3])
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

        let instanceIds = resources
            .filter(r => r.ResourceARN.split(':')[3] === region)
            .filter(r => r.ResourceARN.split(':')[5].split('/')[0] === 'instance')
            .map(r => r.ResourceARN.split(':')[5].split('/')[1])

        const instances = await getInstances(clusterId, region, instanceIds)

        const table = []
        if (instances.length === 0) {
            log('No instances')
        } else {
            instances.forEach(instance => {
                debug('instance', instance.InstanceId)
                table.push({
                    Id: instance.InstanceId,
                    Region: region,
                    AZ: getTag(instance.Tags, 'AvailabilityZone'),
                    Name: getTag(instance.Tags, 'Name'),
                    Roles: getTag(instance.Tags, 'Roles'),
                    PrivateIpAddress: instance.PrivateIpAddress,
                    PublicIpAddress: instance.PublicIpAddress,
                    Ipv6Address: instance.NetworkInterfaces[0].Ipv6Addresses[0].Ipv6Address,
                    DataVolumeDevice: (
                        instance.BlockDeviceMappings.find((v) => v.DeviceName !== instance.RootDeviceName) || {}
                    ).DeviceName
                })
            })
            table.sort((m1, m2) => m1.Name < m2.Name ? -1 : 1)
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

export async function getResources(clusterId: string, resourceTypeFilters: string[]): Promise<aws.ResourceGroupsTaggingAPI.ResourceTagMappingList> {
    const resources: aws.ResourceGroupsTaggingAPI.ResourceTagMappingList = []
    const regions = await listRegions()
    for (let region of regions) {
        const rg = new aws.ResourceGroupsTaggingAPI({ region })
        const getResourcesInput: aws.ResourceGroupsTaggingAPI.GetResourcesInput = {
            TagFilters: [
                {
                    Key: 'SyeClusterId',
                    Values: [clusterId],
                }
            ],
            ResourceTypeFilters: resourceTypeFilters
        }

        let regionResources = await rg.getResources(getResourcesInput).promise()
        resources.push(...regionResources.ResourceTagMappingList)

        while (regionResources.PaginationToken) {
            getResourcesInput.PaginationToken = regionResources.PaginationToken
            regionResources = await rg.getResources(getResourcesInput).promise()
            resources.push(...regionResources.ResourceTagMappingList)
        }
    }

    return resources
}

// Return a list of all Amazon regions available to us
export async function listRegions() {
    let ec2 = new aws.EC2({region: 'eu-central-1'})
    let regions = await ec2.describeRegions().promise()
    return regions.Regions.map( reg => reg.RegionName )
}

async function createBucket(bucketName: string, syeEnvironment: string, authorizedKeys: string) {
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

    await s3.upload({
        Bucket: bucketName,
        Key: 'public/bootstrap.sh',
        Body: readPackageFile('bootstrap.sh'),
        ContentType: 'application/x-sh'
    }).promise()

    await s3.upload({
        Bucket: bucketName,
        Key: 'public/sye-cluster-join.sh',
        Body: readPackageFile('../sye-cluster-join.sh'),
        ContentType: 'application/x-sh'
    }).promise()

    await s3.upload({
        Bucket: bucketName,
        Key: 'private/sye-environment.tar.gz',
        Body: fs.readFileSync(syeEnvironment),
        ContentType: 'application/x-gzip',
    }).promise()

    await s3.upload({
        Bucket: bucketName,
        Key: 'public/authorized_keys',
        Body: fs.readFileSync(authorizedKeys),
    }).promise()
}

function readPackageFile(filename: string) {
    if (fs.existsSync(resolve(__dirname, filename))) {
        // When used as script
        return fs.readFileSync(resolve(__dirname, filename))
    }
    else {
        // When used as module
        return fs.readFileSync(resolve(__dirname, '..', filename))
    }
}

async function createIamRoles(clusterId: string): Promise<void> {
    const basicPolicyDocument = JSON.stringify({
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
    const scalingPolicyDocument = JSON.stringify({
        Version: '2012-10-17',
        Statement: [
            {
                Effect: 'Allow',
                Action: [
                    'ec2:CreateTags',
                    'ec2:DescribeAvailabilityZones',
                    'ec2:DescribeImages',
                    'ec2:DescribeInstances',
                    'ec2:DescribeRegions',
                    'ec2:DescribeSecurityGroups',
                    'ec2:DescribeSubnets',
                    'ec2:DescribeVpcs',
                    'ec2:RunInstances',
                    'ec2:TerminateInstances'
                ],
                Resource: '*'
            },
            {
                Effect: 'Allow',
                Action: [
                    'iam:GetInstanceProfile',
                    'iam:PassRole'
                ],
                Resource: '*'
            },
            {
                Effect: 'Allow',
                Action: [
                    's3:GetObject'
                ],
                Resource: 'arn:aws:s3:::' + clusterId + '/*'
            }
        ]
    })

    // The scaling IAM role will be used only by the machines that will have the scaling
    // machine role. The basic IAM role will be used for the rest of the machines to access
    // the S3 bucket.
    await Promise.all([ createIamRole(clusterId, basicPolicyDocument),
                        createIamRole(clusterId, scalingPolicyDocument, 'scaling') ])
}

async function createIamRole(clusterId: string, policyDocument: string, roleType?: string): Promise<void> {
    const type = roleType || ''
    debug('createIamRole', type)
    const instanceProfileName = type ? `${clusterId}-instance-${type}` : `${clusterId}-instance`
    const roleName = instanceProfileName
    const policyName = type ? `${clusterId}-${type}` : `${clusterId}-s3-read`
    const iam = new aws.IAM()

    debug('createRole', roleName)
    await iam.createRole({
        RoleName: roleName,
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

    debug('createPolicy', policyName)
    const policy = await iam.createPolicy({
        PolicyName: policyName,
        PolicyDocument: policyDocument
    }).promise()

    debug('attachRolePolicy', type)
    await iam.attachRolePolicy({
        RoleName: roleName,
        PolicyArn: policy.Policy.Arn
    }).promise()


    debug('createInstanceProfile', instanceProfileName)
    await iam.createInstanceProfile({
        InstanceProfileName: instanceProfileName
    }).promise()

    debug('addRoleToInstanceProfile', instanceProfileName)
    await iam.addRoleToInstanceProfile({
        RoleName: roleName,
        InstanceProfileName: instanceProfileName
    }).promise()
}

async function deleteIamRoles(clusterId: string) {
    await Promise.all([ deleteIamRole(clusterId),
                        deleteIamRole(clusterId, 'scaling')])
}

async function deleteIamRole(clusterId: string, roleType?: string ) {
    const type = roleType || ''
    debug('deleteIamRole', type)
    const instanceProfileName = type ? `${clusterId}-instance-${type}` : `${clusterId}-instance`
    const roleName = instanceProfileName
    const iam = new aws.IAM()

    debug('removeRoleFromInstanceProfile', instanceProfileName)
    await iam.removeRoleFromInstanceProfile({
        RoleName: roleName,
        InstanceProfileName: instanceProfileName
    }).promise().catch((err) => debug(`removeRoleFromInstanceProfile failed: ${err}`))

    debug('deleteInstanceProfile', instanceProfileName)
    await iam.deleteInstanceProfile({
        InstanceProfileName: instanceProfileName
    }).promise().catch((err) => debug(`deleteInstanceProfile failed: ${err}`))

    debug('listAttachedRolePolicies', roleName)
    const attachedPolicies = await iam.listAttachedRolePolicies({
        RoleName: roleName
    }).promise()
        .then((res) => res.AttachedPolicies)
        .catch(() => new Array<aws.IAM.AttachedPolicy>())

    for (let policy of attachedPolicies) {
        debug('detachRolePolicy', policy.PolicyName)
        await iam.detachRolePolicy({
            RoleName: roleName,
            PolicyArn: policy.PolicyArn
        }).promise().catch((err) => debug(`detachRolePolicy ${policy.PolicyName} failed: ${err}`))
        debug('deletePolicy', policy.PolicyName)
        await iam.deletePolicy({
            PolicyArn: policy.PolicyArn
        }).promise().catch((err) => debug(`deletePolicy ${policy.PolicyName} failed: ${err}`))
    }

    debug('deleteRole', roleName)
    await iam.deleteRole({
        RoleName: roleName
    }).promise().catch((err) => debug(`deleteRole ${roleName} failed: ${err}`))
}
